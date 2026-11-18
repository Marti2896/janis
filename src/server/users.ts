import { logEvent } from "./audit.ts";
import { assertPasswordPolicy, generateTemporaryPassword, hashPassword } from "./password.ts";
import { getPool } from "./pool.ts";
import type { Db } from "./pool.ts";
import { ValidationError, requireAdmin } from "./scope.ts";
import type { Scope } from "./scope.ts";

export type UserRow = {
  id: string;
  email: string;
  role: "admin" | "cliente";
  tenantId: string | null;
  mustChangePassword: boolean;
  disabled: boolean;
  createdAt: Date;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const map = (x: Record<string, unknown>): UserRow => ({
  id: x.id as string,
  email: x.email as string,
  role: x.role as "admin" | "cliente",
  tenantId: x.tenant_id as string | null,
  mustChangePassword: x.must_change_password as boolean,
  disabled: x.disabled_at != null,
  createdAt: x.created_at as Date,
});

/** Admin: tutti gli utenti (o quelli di un tenant). Cliente: solo gli utenti del proprio tenant. */
export async function listUsers(scope: Scope, tenantId?: string | null, db: Db = getPool()): Promise<UserRow[]> {
  const tenant = scope.role === "cliente" ? scope.tenantId : (tenantId ?? null);
  const r = await db.query(
    `select id, email, role, tenant_id, must_change_password, disabled_at, created_at from users
      ${tenant ? "where tenant_id = $1" : ""} order by created_at`,
    tenant ? [tenant] : [],
  );
  return r.rows.map(map);
}

/** Crea un utente cliente con password temporanea (mostrata una sola volta). Solo admin. */
export async function createClientUser(
  scope: Scope,
  input: { tenantId: string; email: string },
  actorUserId: string | null,
  db: Db = getPool(),
): Promise<{ user: UserRow; temporaryPassword: string }> {
  requireAdmin(scope);
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new ValidationError("Email non valida.", "email");
  const exists = await db.query("select 1 from users where lower(email) = $1", [email]);
  if (exists.rowCount) throw new ValidationError("Esiste già un utente con questa email.", "email");
  const tenant = await db.query("select id from tenants where id = $1", [input.tenantId]);
  if (!tenant.rowCount) throw new ValidationError("Account non trovato.", "tenantId");
  const temporaryPassword = generateTemporaryPassword();
  const r = await db.query(
    `insert into users (email, password_hash, role, tenant_id, must_change_password)
     values ($1, $2, 'cliente', $3, true)
     returning id, email, role, tenant_id, must_change_password, disabled_at, created_at`,
    [email, await hashPassword(temporaryPassword), input.tenantId],
  );
  const user = map(r.rows[0]);
  await logEvent({ tenantId: input.tenantId, actorUserId, event: "user.created", entity: "user", entityId: user.id, detail: { email } }, db);
  return { user, temporaryPassword };
}

/** Crea un admin (usato dal seed). Password con policy minima. */
export async function createAdminUser(email: string, password: string, db: Db = getPool()): Promise<UserRow> {
  assertPasswordPolicy(password);
  const r = await db.query(
    `insert into users (email, password_hash, role) values ($1, $2, 'admin')
     returning id, email, role, tenant_id, must_change_password, disabled_at, created_at`,
    [email.trim().toLowerCase(), await hashPassword(password)],
  );
  return map(r.rows[0]);
}

/** Disattiva o riattiva: le sessioni attive spariscono alla richiesta successiva. Solo admin. */
export async function setUserDisabled(scope: Scope, userId: string, disabled: boolean, actorUserId: string | null, db: Db = getPool()): Promise<boolean> {
  requireAdmin(scope);
  const r = await db.query(
    "update users set disabled_at = case when $2 then now() else null end where id = $1 returning tenant_id",
    [userId, disabled],
  );
  if (!r.rowCount) return false;
  if (disabled) await db.query("delete from sessions where user_id = $1", [userId]);
  await logEvent({ tenantId: r.rows[0].tenant_id, actorUserId, event: disabled ? "user.disabled" : "user.enabled", entity: "user", entityId: userId }, db);
  return true;
}

/** Reset password: solo admin, password casuale mostrata una volta, cambio obbligatorio al primo accesso. */
export async function resetPassword(scope: Scope, userId: string, actorUserId: string | null, db: Db = getPool()): Promise<{ temporaryPassword: string } | null> {
  requireAdmin(scope);
  const temporaryPassword = generateTemporaryPassword();
  const r = await db.query(
    "update users set password_hash = $2, must_change_password = true where id = $1 returning tenant_id",
    [userId, await hashPassword(temporaryPassword)],
  );
  if (!r.rowCount) return null;
  await db.query("delete from sessions where user_id = $1", [userId]);
  await logEvent({ tenantId: r.rows[0].tenant_id, actorUserId, event: "user.password_reset", entity: "user", entityId: userId }, db);
  return { temporaryPassword };
}
