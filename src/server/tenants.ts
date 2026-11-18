import { logEvent } from "./audit.ts";
import { getPool } from "./pool.ts";
import type { Db } from "./pool.ts";
import { ValidationError, requireAdmin } from "./scope.ts";
import type { Scope } from "./scope.ts";
import { createClientUser } from "./users.ts";
import type { UserRow } from "./users.ts";

export type TenantRow = {
  id: string;
  partitaIva: string;
  codiceFiscale: string | null;
  denominazione: string;
  usersCount: number;
  activeUsersCount: number;
  createdAt: Date;
};

const SELECT = `select t.id, t.partita_iva, t.codice_fiscale, t.denominazione, t.created_at,
  (select count(*)::int from users u where u.tenant_id = t.id) as users_count,
  (select count(*)::int from users u where u.tenant_id = t.id and u.disabled_at is null) as active_users_count
  from tenants t`;

const map = (x: Record<string, unknown>): TenantRow => ({
  id: x.id as string,
  partitaIva: (x.partita_iva as string).trim(),
  codiceFiscale: (x.codice_fiscale as string | null) ?? null,
  denominazione: x.denominazione as string,
  usersCount: x.users_count as number,
  activeUsersCount: x.active_users_count as number,
  createdAt: x.created_at as Date,
});

/** Admin: tutti i tenant. Cliente: solo il proprio. */
export async function listTenants(scope: Scope, db: Db = getPool()): Promise<TenantRow[]> {
  const r =
    scope.role === "admin"
      ? await db.query(`${SELECT} order by t.denominazione`)
      : await db.query(`${SELECT} where t.id = $1`, [scope.tenantId]);
  return r.rows.map(map);
}

/** Tenant di un altro account: null (non trovato), mai un errore che ne riveli l'esistenza. */
export async function getTenant(scope: Scope, id: string, db: Db = getPool()): Promise<TenantRow | null> {
  if (scope.role === "cliente" && scope.tenantId !== id) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await db.query(`${SELECT} where t.id = $1`, [id]);
  return r.rows[0] ? map(r.rows[0]) : null;
}

export type NewTenantInput = { denominazione: string; partitaIva: string; codiceFiscale?: string | null; email: string };

/** Crea tenant e primo utente cliente (password temporanea mostrata una sola volta). Solo admin. */
export async function createTenant(
  scope: Scope,
  input: NewTenantInput,
  actorUserId: string | null,
  db: Db = getPool(),
): Promise<{ tenant: TenantRow; user: UserRow; temporaryPassword: string }> {
  requireAdmin(scope);
  const denominazione = input.denominazione.trim();
  const piva = input.partitaIva.trim();
  const cf = input.codiceFiscale?.trim().toUpperCase() || null;
  if (!denominazione) throw new ValidationError("La denominazione e obbligatoria.", "denominazione");
  if (!/^\d{11}$/.test(piva)) throw new ValidationError("La partita IVA deve avere 11 cifre.", "partitaIva");
  if (cf && !/^([A-Z0-9]{16}|\d{11})$/.test(cf)) throw new ValidationError("Codice fiscale non valido.", "codiceFiscale");
  const dup = await db.query("select 1 from tenants where partita_iva = $1", [piva]);
  if (dup.rowCount) throw new ValidationError("Esiste gia un account con questa partita IVA.", "partitaIva");
  const r = await db.query(
    "insert into tenants (partita_iva, denominazione, codice_fiscale) values ($1, $2, $3) returning id",
    [piva, denominazione, cf],
  );
  const id = r.rows[0].id as string;
  await logEvent({ tenantId: id, actorUserId, event: "tenant.created", entity: "tenant", entityId: id, detail: { denominazione, partitaIva: piva } }, db);
  const { user, temporaryPassword } = await createClientUser(scope, { tenantId: id, email: input.email }, actorUserId, db);
  const tenant = (await getTenant(scope, id, db))!;
  return { tenant, user, temporaryPassword };
}
