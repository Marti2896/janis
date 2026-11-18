import { createHash, randomBytes } from "node:crypto";
import { logEvent } from "./audit.ts";
import { assertPasswordPolicy, hashPassword, verifyPassword } from "./password.ts";
import { getPool } from "./pool.ts";
import type { Db } from "./pool.ts";
import { ValidationError } from "./scope.ts";

export const SESSION_COOKIE = "interscambio_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const LOCK_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILED_ATTEMPTS = 5;

export type SessionUser = {
  userId: string;
  email: string;
  role: "admin" | "cliente";
  tenantId: string | null;
  mustChangePassword: boolean;
};

export type AuthResult =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; reason: "invalid" | "locked" };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Opzioni del cookie di sessione (httpOnly, SameSite=Lax, Secure in produzione, 12 ore). */
export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  };
}

// Hash fittizio per tenere costante il tempo di risposta con email inesistente.
let dummyHash: Promise<string> | undefined;

/**
 * Login. Messaggio identico per email inesistente, password errata e utente disabilitato.
 * Blocco: 5 fallimenti in 15 minuti sulla stessa email fanno rifiutare anche la password giusta
 * finche il quinto fallimento non e piu nella finestra di 15 minuti.
 */
export async function authenticate(email: string, password: string, ip = "", db: Db = getPool()): Promise<AuthResult> {
  const emailLc = email.trim().toLowerCase();
  const since = new Date(Date.now() - LOCK_WINDOW_MS);
  const failed = await db.query(
    "select count(*)::int as n from login_attempts where email_lc = $1 and attempted_at > $2",
    [emailLc, since],
  );
  if (failed.rows[0].n >= MAX_FAILED_ATTEMPTS) {
    await logEvent({ event: "auth.login_locked", entity: "user", detail: { email: emailLc, ip }, outcome: "error" }, db);
    return { ok: false, reason: "locked" };
  }

  const u = await db.query(
    "select id, password_hash, tenant_id, disabled_at from users where lower(email) = $1",
    [emailLc],
  );
  const user = u.rows[0] as { id: string; password_hash: string; tenant_id: string | null; disabled_at: Date | null } | undefined;
  dummyHash ??= hashPassword("interscambio-dummy-password");
  const okPwd = await verifyPassword(user ? user.password_hash : await dummyHash, password);

  if (!user || !okPwd || user.disabled_at) {
    await db.query("insert into login_attempts (email_lc, ip) values ($1, $2)", [emailLc, ip]);
    await logEvent(
      { tenantId: user?.tenant_id ?? null, actorUserId: user?.id ?? null, event: "auth.login_failed", entity: "user", entityId: user?.id ?? null, detail: { email: emailLc, ip }, outcome: "error" },
      db,
    );
    return { ok: false, reason: "invalid" };
  }

  await db.query("delete from login_attempts where email_lc = $1", [emailLc]);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.query("insert into sessions (user_id, token_hash, expires_at) values ($1, $2, $3)", [user.id, sha256(token), expiresAt]);
  await db.query("delete from sessions where expires_at < now()");
  await logEvent({ tenantId: user.tenant_id, actorUserId: user.id, event: "auth.login", entity: "user", entityId: user.id, detail: { ip } }, db);
  return { ok: true, token, expiresAt };
}

/** Sessione valida solo se non scaduta e con utente ancora attivo (la disattivazione ha effetto subito). */
export async function getSession(token: string | undefined | null, db: Db = getPool()): Promise<SessionUser | null> {
  if (!token) return null;
  const r = await db.query(
    `select u.id, u.email, u.role, u.tenant_id, u.must_change_password
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now() and u.disabled_at is null`,
    [sha256(token)],
  );
  const row = r.rows[0];
  if (!row) return null;
  return { userId: row.id, email: row.email, role: row.role, tenantId: row.tenant_id, mustChangePassword: row.must_change_password };
}

export async function destroySession(token: string | undefined | null, db: Db = getPool()): Promise<void> {
  if (!token) return;
  const r = await db.query(
    `delete from sessions s using users u where s.token_hash = $1 and u.id = s.user_id returning u.id, u.tenant_id`,
    [sha256(token)],
  );
  if (r.rows[0]) {
    await logEvent({ tenantId: r.rows[0].tenant_id, actorUserId: r.rows[0].id, event: "auth.logout", entity: "user", entityId: r.rows[0].id }, db);
  }
}

/** Cambio password dell'utente stesso: richiede la password attuale e chiude le altre sessioni. */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  keepToken?: string | null,
  db: Db = getPool(),
): Promise<{ ok: true } | { ok: false; reason: "invalid" }> {
  assertPasswordPolicy(newPassword);
  if (newPassword === currentPassword) throw new ValidationError("La nuova password deve essere diversa dalla attuale.", "password");
  const u = await db.query("select password_hash, tenant_id from users where id = $1 and disabled_at is null", [userId]);
  if (!u.rows[0] || !(await verifyPassword(u.rows[0].password_hash, currentPassword))) return { ok: false, reason: "invalid" };
  await db.query("update users set password_hash = $2, must_change_password = false where id = $1", [userId, await hashPassword(newPassword)]);
  await db.query("delete from sessions where user_id = $1 and token_hash <> $2", [userId, keepToken ? sha256(keepToken) : ""]);
  await logEvent({ tenantId: u.rows[0].tenant_id, actorUserId: userId, event: "auth.password_changed", entity: "user", entityId: userId }, db);
  return { ok: true };
}
