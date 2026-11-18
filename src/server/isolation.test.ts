import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authenticateApiKey, createApiKey, listApiKeys, revokeApiKey } from "./api-keys.ts";
import { listAudit, logEvent } from "./audit.ts";
import { listCertificates } from "./certificates.ts";
import { saveChannelSettings } from "./channel-settings.ts";
import { ForbiddenError } from "./scope.ts";
import type { Scope } from "./scope.ts";
import { createTenant, getTenant, listTenants } from "./tenants.ts";
import { createClientUser, listUsers, resetPassword, setUserDisabled } from "./users.ts";

const url = process.env.DATABASE_URL ?? "postgres://sdi:sdi_dev_only@localhost:54320/sdi_channel";
const pool = new pg.Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 1500 });
let dbReady = true;
try {
  await pool.query("select 1 from users, api_keys limit 1");
} catch {
  dbReady = false;
  console.warn("Postgres non raggiungibile o non migrato: test di isolamento multi-tenant SALTATI");
}
afterAll(() => pool.end());

const rndPiva = () => String(Math.floor(Math.random() * 1e11)).padStart(11, "0");

// Isolamento multi-tenant: il cliente B non deve MAI vedere dati di A, nemmeno passando l'id di A.
describe.skipIf(!dbReady)("isolamento multi-tenant", () => {
  const admin: Scope = { role: "admin" };
  const tag = randomUUID().slice(0, 8);
  let A: { id: string; scope: Scope; userId: string; keyId: string; keySecret: string };
  let B: { id: string; scope: Scope; userId: string; keyId: string; keySecret: string };

  async function setup(name: string) {
    const t = await createTenant(admin, { denominazione: `${name} ${tag}`, partitaIva: rndPiva(), email: `${name}-${tag}@interscambio.test` }, null, pool);
    const scope: Scope = { role: "cliente", tenantId: t.tenant.id };
    const k = await createApiKey(scope, { name: `chiave ${name}` }, t.user.id, pool);
    await logEvent({ tenantId: t.tenant.id, event: `test.${name}`, entity: "test" }, pool);
    return { id: t.tenant.id, scope, userId: t.user.id, keyId: k.key.id, keySecret: k.secret };
  }

  beforeAll(async () => {
    A = await setup("alfa");
    B = await setup("beta");
  });

  it("audit: il cliente vede solo i propri eventi, anche chiedendo il tenant dell'altro", async () => {
    const own = await listAudit(B.scope, {}, pool);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((r) => r.tenantId === B.id)).toBe(true);
    const forged = await listAudit(B.scope, { tenantId: A.id }, pool);
    expect(forged.every((r) => r.tenantId === B.id)).toBe(true);
    expect(forged.some((r) => r.event === "test.alfa")).toBe(false);
  });

  it("audit: l'admin vede entrambi e puo filtrare", async () => {
    const all = await listAudit(admin, { limit: 200 }, pool);
    expect(all.some((r) => r.tenantId === A.id)).toBe(true);
    expect(all.some((r) => r.tenantId === B.id)).toBe(true);
    expect((await listAudit(admin, { tenantId: A.id }, pool)).every((r) => r.tenantId === A.id)).toBe(true);
  });

  it("api key: elenco, revoca e uso solo sul proprio tenant", async () => {
    expect((await listApiKeys(B.scope, A.id, pool)).every((k) => k.tenantId === B.id)).toBe(true);
    expect((await listApiKeys(B.scope, null, pool)).some((k) => k.id === A.keyId)).toBe(false);
    expect(await revokeApiKey(B.scope, A.keyId, null, pool)).toBe(false);
    const still = await authenticateApiKey(A.keySecret, pool);
    expect(still?.tenantId).toBe(A.id);
    expect(still?.scope).toEqual({ role: "cliente", tenantId: A.id });
    const all = await listApiKeys(admin, null, pool);
    expect(all.some((k) => k.id === A.keyId) && all.some((k) => k.id === B.keyId)).toBe(true);
  });

  it("api key: la chiave del cliente e creata sempre per il suo tenant, anche se ne chiede un altro", async () => {
    const k = await createApiKey(B.scope, { name: "forzata", tenantId: A.id }, B.userId, pool);
    expect(k.key.tenantId).toBe(B.id);
  });

  it("api key: revocata, errata o malformata = non autenticata", async () => {
    expect(await authenticateApiKey(null, pool)).toBeNull();
    expect(await authenticateApiKey("isk_00000000_" + "0".repeat(48), pool)).toBeNull();
    expect(await authenticateApiKey(A.keySecret.slice(0, -1) + (A.keySecret.endsWith("0") ? "1" : "0"), pool)).toBeNull();
    expect(await revokeApiKey(B.scope, B.keyId, B.userId, pool)).toBe(true);
    expect(await authenticateApiKey(B.keySecret, pool)).toBeNull();
    const row = await pool.query("select secret_hash from api_keys where id = $1", [A.keyId]);
    expect(row.rows[0].secret_hash).not.toContain(A.keySecret);
  });

  it("tenant: il cliente vede solo il proprio, l'altro risulta non trovato", async () => {
    expect((await listTenants(B.scope, pool)).map((t) => t.id)).toEqual([B.id]);
    expect(await getTenant(B.scope, A.id, pool)).toBeNull();
    expect((await getTenant(admin, A.id, pool))?.id).toBe(A.id);
    expect((await listTenants(admin, pool)).length).toBeGreaterThanOrEqual(2);
  });

  it("utenti: il cliente vede solo gli utenti del proprio tenant", async () => {
    const mine = await listUsers(B.scope, A.id, pool);
    expect(mine.every((u) => u.tenantId === B.id)).toBe(true);
    expect(mine.some((u) => u.id === A.userId)).toBe(false);
  });

  it("operazioni riservate all'admin: il cliente riceve ForbiddenError", async () => {
    await expect(createTenant(B.scope, { denominazione: "x", partitaIva: rndPiva(), email: "x@x.test" }, null, pool)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createClientUser(B.scope, { tenantId: A.id, email: "y@y.test" }, null, pool)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setUserDisabled(B.scope, A.userId, true, null, pool)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(resetPassword(B.scope, A.userId, null, pool)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listCertificates(B.scope, pool)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveChannelSettings(B.scope, { environment: "demo", endpoint: "" }, null, pool)).rejects.toBeInstanceOf(ForbiddenError);
    const still = await pool.query("select disabled_at from users where id = $1", [A.userId]);
    expect(still.rows[0].disabled_at).toBeNull();
  });
});
