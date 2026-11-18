import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { logEvent } from "./audit.ts";
import { getPool } from "./pool.ts";
import type { Db } from "./pool.ts";
import { ValidationError, effectiveTenant } from "./scope.ts";
import type { Scope } from "./scope.ts";

export type ApiKeyRow = {
  id: string;
  tenantId: string;
  tenantName: string | null;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revoked: boolean;
};

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const KEY_RE = /^isk_([0-9a-f]{8})_([0-9a-f]{48})$/;

const map = (x: Record<string, unknown>): ApiKeyRow => ({
  id: x.id as string,
  tenantId: x.tenant_id as string,
  tenantName: (x.tenant_name as string | null) ?? null,
  name: x.name as string,
  prefix: `isk_${x.prefix as string}`,
  createdAt: x.created_at as Date,
  lastUsedAt: (x.last_used_at as Date | null) ?? null,
  revoked: x.revoked_at != null,
});

/** Genera isk_<prefisso>_<segreto>: la chiave completa si restituisce una sola volta, in DB resta l'hash. */
export async function createApiKey(
  scope: Scope,
  input: { name: string; tenantId?: string | null },
  actorUserId: string | null,
  db: Db = getPool(),
): Promise<{ key: ApiKeyRow; secret: string }> {
  const name = input.name.trim();
  if (!name) throw new ValidationError("Il nome della chiave e obbligatorio.", "name");
  const tenantId = effectiveTenant(scope, input.tenantId);
  if (!tenantId) throw new ValidationError("Scegli l'account della chiave.", "tenantId");
  const t = await db.query("select 1 from tenants where id = $1", [tenantId]);
  if (!t.rowCount) throw new ValidationError("Account non trovato.", "tenantId");
  const prefix = randomBytes(4).toString("hex");
  const secret = `isk_${prefix}_${randomBytes(24).toString("hex")}`;
  const r = await db.query(
    `insert into api_keys (tenant_id, name, prefix, secret_hash, created_by) values ($1, $2, $3, $4, $5)
     returning id, tenant_id, name, prefix, created_at, last_used_at, revoked_at`,
    [tenantId, name, prefix, sha256(secret), actorUserId],
  );
  await logEvent({ tenantId, actorUserId, event: "api_key.created", entity: "api_key", entityId: r.rows[0].id, detail: { name, prefix: `isk_${prefix}` } }, db);
  return { key: map(r.rows[0]), secret };
}

export async function listApiKeys(scope: Scope, tenantId?: string | null, db: Db = getPool()): Promise<ApiKeyRow[]> {
  const tenant = effectiveTenant(scope, tenantId);
  const r = await db.query(
    `select k.id, k.tenant_id, t.denominazione as tenant_name, k.name, k.prefix, k.created_at, k.last_used_at, k.revoked_at
       from api_keys k join tenants t on t.id = k.tenant_id
      ${tenant ? "where k.tenant_id = $1" : ""} order by k.created_at desc`,
    tenant ? [tenant] : [],
  );
  return r.rows.map(map);
}

/** Chiave di un altro tenant: false (non trovata). */
export async function revokeApiKey(scope: Scope, id: string, actorUserId: string | null, db: Db = getPool()): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const tenant = effectiveTenant(scope, null);
  const r = await db.query(
    `update api_keys set revoked_at = now() where id = $1 and revoked_at is null ${tenant ? "and tenant_id = $2" : ""}
     returning tenant_id, prefix`,
    tenant ? [id, tenant] : [id],
  );
  if (!r.rowCount) return false;
  await logEvent({ tenantId: r.rows[0].tenant_id, actorUserId, event: "api_key.revoked", entity: "api_key", entityId: id, detail: { prefix: `isk_${r.rows[0].prefix}` } }, db);
  return true;
}

/** Autentica un sistema esterno: restituisce lo scope del tenant della chiave, o null (mancante, errata, revocata). */
export async function authenticateApiKey(
  raw: string | undefined | null,
  db: Db = getPool(),
): Promise<{ scope: Scope; tenantId: string; keyId: string } | null> {
  const m = raw ? KEY_RE.exec(raw.trim()) : null;
  if (!m) return null;
  const r = await db.query("select id, tenant_id, secret_hash from api_keys where prefix = $1 and revoked_at is null", [m[1]]);
  const row = r.rows[0];
  if (!row) return null;
  const a = Buffer.from(row.secret_hash as string, "hex");
  const b = Buffer.from(sha256(raw!.trim()), "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  await db.query("update api_keys set last_used_at = now() where id = $1", [row.id]);
  return { scope: { role: "cliente", tenantId: row.tenant_id }, tenantId: row.tenant_id, keyId: row.id };
}
