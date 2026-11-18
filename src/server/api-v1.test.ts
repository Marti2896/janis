import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import Fastify from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDemoNotificationSoap } from "../sdi/messaggi/demo-notification.ts";
import { createApiKey, revokeApiKey } from "./api-keys.ts";
import { registerApiV1 } from "./http/api-v1.ts";
import { openApiDocument } from "./http/openapi.ts";
import { processNotification, parseNotification } from "./notifications.ts";
import { channelCounters, createAndSendInvoice, getInvoice, getInvoiceFile, listInvoices, validateNewInvoice } from "./invoice-service.ts";
import type { NewInvoiceInput } from "./invoice-service.ts";
import type { Scope } from "./scope.ts";
import { createTenant } from "./tenants.ts";

process.env.SECRETS_MASTER_KEY ??= "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
process.env.SDI_RETRY_BASE_MS = "1";
process.env.SDI_RETRY_CAP_MS = "2";

const rnd = (n: number) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, "0");

const input = (over: Partial<NewInvoiceInput> = {}): NewInvoiceInput => ({
  cessionarioDenominazione: "Cliente Srl",
  cessionarioPartitaIva: "01234567890",
  destinazione: { tipo: "codice", valore: "ABCDEFG" },
  tipoDocumento: "TD01",
  data: "2026-03-10",
  righe: [{ descrizione: "Consulenza", quantita: 2, prezzoUnitario: 50, aliquota: 22 }],
  ...over,
});

describe("validateNewInvoice", () => {
  it("accetta un input valido", () => {
    expect(validateNewInvoice(input())).toEqual({});
  });
  it("messaggi chiari per campo", () => {
    const e = validateNewInvoice(
      input({
        cessionarioDenominazione: " ",
        cessionarioPartitaIva: "123",
        destinazione: { tipo: "codice", valore: "ABC" },
        data: "2026-02-31",
        righe: [{ descrizione: "", quantita: 0, prezzoUnitario: -1, aliquota: 21 as 22 }],
      }),
    );
    expect(e.cessionarioPartitaIva).toBe("La partita IVA deve avere 11 cifre");
    expect(e.destinazione).toMatch(/7 caratteri/);
    expect(Object.keys(e)).toEqual(
      expect.arrayContaining(["cessionarioDenominazione", "data", "righe.0.descrizione", "righe.0.quantita", "righe.0.prezzoUnitario", "righe.0.aliquota"]),
    );
  });
  it("PEC e FPA12", () => {
    expect(validateNewInvoice(input({ destinazione: { tipo: "pec", valore: "x" } })).destinazione).toMatch(/PEC/);
    expect(validateNewInvoice(input({ destinazione: { tipo: "pec", valore: "a@pec.it" } }))).toEqual({});
    expect(validateNewInvoice(input({ formato: "FPA12", destinazione: { tipo: "codice", valore: "UFABCD" } }))).toEqual({});
    expect(validateNewInvoice(input({ formato: "FPA12", destinazione: { tipo: "pec", valore: "a@pec.it" } })).destinazione).toMatch(/IPA/);
  });
});

const url = process.env.DATABASE_URL ?? "postgres://sdi:sdi_dev_only@localhost:54320/sdi_channel";
const pool = new pg.Pool({ connectionString: url, max: 6, connectionTimeoutMillis: 1500 });
let dbReady = false;
try {
  await pool.query("select 1 from invoice_counters, api_idempotency, api_keys limit 1");
  dbReady = true;
} catch {
  console.warn("[api-v1.test] Postgres non disponibile o migrazione 0007 non applicata: test DB saltati");
}
afterAll(() => pool.end());

describe.skipIf(!dbReady)("servizio fatture e API v1", () => {
  const admin: Scope = { role: "admin" };
  const tag = randomUUID().slice(0, 8);
  let A: { id: string; scope: Scope; secret: string; keyId: string; userId: string };
  let B: { id: string; scope: Scope; secret: string; keyId: string; userId: string };
  const app = Fastify();
  let sdi: http.Server;
  let sdiUrl = "";
  let sdiCalls = 0;
  let sdiMode: "ok" | "fault" = "ok";

  async function mk(name: string) {
    const t = await createTenant(admin, { denominazione: `${name} ${tag}`, partitaIva: rnd(11), indirizzo: "Via Prova 1", cap: "00100", comune: "Roma", provincia: "RM", email: `${name}-${tag}@interscambio.test` }, null, pool);
    const scope: Scope = { role: "cliente", tenantId: t.tenant.id };
    const k = await createApiKey(scope, { name: "crm" }, t.user.id, pool);
    return { id: t.tenant.id, scope, secret: k.secret, keyId: k.key.id, userId: t.user.id };
  }

  beforeAll(async () => {
    A = await mk("alfa");
    B = await mk("beta");
    registerApiV1(app, { pool });
    sdi = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        sdiCalls++;
        res.setHeader("content-type", "text/xml");
        if (sdiMode === "fault") {
          res.statusCode = 500;
          res.end("<Envelope><Body><Fault><faultstring>Errore SdI</faultstring></Fault></Body></Envelope>");
        } else {
          res.end(`<Envelope><Body><fileSdIRiceviFile><IdentificativoSdI>${rnd(12)}</IdentificativoSdI><DataOraRicezione>2026-03-10T10:00:00Z</DataOraRicezione></fileSdIRiceviFile></Body></Envelope>`);
        }
      });
    });
    await new Promise<void>((r) => sdi.listen(0, "127.0.0.1", r));
    sdiUrl = `http://127.0.0.1:${(sdi.address() as AddressInfo).port}/`;
  });
  afterAll(() => new Promise<void>((r) => sdi.close(() => r())));

  const channel = () => ({ channel: { environment: "demo" as const, endpoint: sdiUrl }, db: pool });
  const H = (key: string) => ({ "x-api-key": key });

  it("crea, firma e invia: stato inviata, numero 1/2026, file p7m scaricabile, audit", async () => {
    sdiMode = "ok";
    const before = sdiCalls;
    const r = await createAndSendInvoice(A.scope, input(), channel());
    if ("errors" in r) throw new Error(JSON.stringify(r.errors));
    expect(r.status).toBe("sent");
    expect(sdiCalls).toBe(before + 1);
    const d = (await getInvoice(A.scope, r.id, { db: pool }))!;
    expect(d).toMatchObject({ numero: "1/2026", importoCents: 12200, cessionarioDenominazione: "Cliente Srl", hasFile: true, ambiente: "demo" });
    expect(d.events.map((e) => e.to)).toEqual(["draft", "signed", "sending", "sent"]);
    const f = (await getInvoiceFile(A.scope, r.id, { db: pool }))!;
    expect(f.fileName).toMatch(/^IT\d{11}_[0-9A-Z]{5}\.xml\.p7m$/);
    expect(f.bytes[0]).toBe(0x30);
    expect((await pool.query("select 1 from audit_log where event = 'invoice.created' and entity_id = $1", [r.id])).rowCount).toBe(1);
  });

  it("numerazione progressiva per tenant e anno, senza buchi dopo un errore", async () => {
    const r2 = await createAndSendInvoice(A.scope, input(), channel());
    const bad = await createAndSendInvoice(A.scope, input({ cessionarioPartitaIva: "1" }), channel());
    expect("errors" in bad).toBe(true);
    const r3 = await createAndSendInvoice(A.scope, input({ data: "2027-01-05" }), channel());
    const r4 = await createAndSendInvoice(A.scope, input(), channel());
    const num = async (r: unknown) => (await getInvoice(A.scope, (r as { id: string }).id, { db: pool }))!.numero;
    expect(await num(r2)).toBe("2/2026");
    expect(await num(r3)).toBe("1/2027");
    expect(await num(r4)).toBe("3/2026");
    const firstB = await createAndSendInvoice(B.scope, input(), channel());
    expect(await getInvoice(B.scope, (firstB as { id: string }).id, { db: pool })).toMatchObject({ numero: "1/2026" });
  });

  it("emissioni concorrenti non duplicano il numero", async () => {
    const rs = await Promise.all(Array.from({ length: 4 }, () => createAndSendInvoice(B.scope, input(), channel())));
    const nums = await Promise.all(rs.map(async (r) => (await getInvoice(B.scope, (r as { id: string }).id, { db: pool }))!.numero));
    expect(new Set(nums).size).toBe(4);
  });

  it("endpoint vuoto: la fattura resta in coda con avviso e nessuna chiamata", async () => {
    const before = sdiCalls;
    const r = await createAndSendInvoice(A.scope, input(), { db: pool, channel: { environment: "demo", endpoint: "" } });
    expect(r).toMatchObject({ status: "signed", queued: true });
    expect("warning" in r && r.warning).toMatch(/in coda/);
    expect(sdiCalls).toBe(before);
  });

  it("errore SdI: send_error con avviso; produzione bloccata resta in coda", async () => {
    sdiMode = "fault";
    const r = await createAndSendInvoice(A.scope, input(), channel());
    expect(r).toMatchObject({ status: "send_error" });
    sdiMode = "ok";
    const p = await createAndSendInvoice(A.scope, input(), { db: pool, channel: { environment: "production", endpoint: sdiUrl } });
    expect(p).toMatchObject({ errors: { _form: expect.stringMatching(/certificato/) } });
  });

  it("l'XSD respinge il codice destinatario errato con FPA12: nessuna fattura creata", async () => {
    const before = (await listInvoices(A.scope, {}, { db: pool })).length;
    const r = await createAndSendInvoice(A.scope, input({ formato: "FPA12", destinazione: { tipo: "codice", valore: "ABCDEFG" } }), channel());
    expect(r).toMatchObject({ errors: { destinazione: expect.stringMatching(/6 caratteri/) } });
    expect((await listInvoices(A.scope, {}, { db: pool })).length).toBe(before);
  });

  it("TD04 e FPA12 validi passano l'XSD", async () => {
    const r = await createAndSendInvoice(A.scope, input({ tipoDocumento: "TD04", formato: "FPA12", destinazione: { tipo: "codice", valore: "UFABCD" } }), channel());
    expect(r).toMatchObject({ status: "sent" });
    expect(await listInvoices(A.scope, { stato: "sent" }, { db: pool })).not.toHaveLength(0);
  });

  it("il cliente non puo emettere per un altro tenant: tenantId ignorato", async () => {
    const r = await createAndSendInvoice(A.scope, input({ tenantId: B.id }), channel());
    const d = (await getInvoice(admin, (r as { id: string }).id, { db: pool }))!;
    expect(d.tenantId).toBe(A.id);
    const noTenant = await createAndSendInvoice(admin, input(), channel());
    expect(noTenant).toMatchObject({ errors: { tenantId: expect.any(String) } });
    expect(await createAndSendInvoice(admin, input({ tenantId: B.id }), channel())).toMatchObject({ status: "sent" });
  });

  it("isolamento: B non vede fatture, dettaglio, file ne contatori di A", async () => {
    const r = (await createAndSendInvoice(A.scope, input(), channel())) as { id: string };
    expect(await getInvoice(B.scope, r.id, { db: pool })).toBeNull();
    expect(await getInvoiceFile(B.scope, r.id, { db: pool })).toBeNull();
    expect((await listInvoices(B.scope, { tenantId: A.id }, { db: pool })).every((i) => i.tenantId === B.id)).toBe(true);
    expect(await getInvoice(admin, r.id, { db: pool })).not.toBeNull();
    const c = await channelCounters(B.scope, { db: pool });
    expect(c.recentErrors.every((e) => e.invoiceId !== r.id)).toBe(true);
  });

  it("contatori: in coda ed errori recenti", async () => {
    const c = await channelCounters(A.scope, { db: pool });
    expect(c.queued).toBeGreaterThanOrEqual(1);
    expect(c.errors24h).toBeGreaterThanOrEqual(1);
    expect(c.recentErrors[0]).toHaveProperty("message");
  });

  it("la timeline mostra le notifiche con timestamp e tipo", async () => {
    const r = (await createAndSendInvoice(A.scope, input(), channel())) as { id: string };
    const d = (await getInvoice(A.scope, r.id, { db: pool }))!;
    const n = await parseNotification(buildDemoNotificationSoap({ tipo: "RC", sdiIdentifier: d.sdiIdentifier!, nomeFile: d.nomeFile }));
    expect(await processNotification(pool, n)).toBe("applied");
    const ev = (await getInvoice(A.scope, r.id, { db: pool }))!.events;
    expect(ev.some((e) => e.kind === "notification" && e.type === "RC")).toBe(true);
    expect(ev.at(-1)).toBeDefined();
    expect((await getInvoice(A.scope, r.id, { db: pool }))!.status).toBe("delivered");
  });

  describe("API v1", () => {
    const body = JSON.stringify(input());
    const post = (key: string, idem?: string, payload = body) =>
      app.inject({ method: "POST", url: "/api/v1/invoices", headers: { ...H(key), "content-type": "application/json", ...(idem ? { "idempotency-key": idem } : {}) }, payload });

    it("health e openapi sono pubblici", async () => {
      expect((await app.inject({ url: "/api/v1/health" })).statusCode).toBe(200);
      const o = (await app.inject({ url: "/api/v1/openapi.json" })).json();
      expect(o.openapi).toBe("3.1.0");
      expect(Object.keys(o.paths)).toEqual(Object.keys(openApiDocument.paths));
    });

    it("chiave mancante, errata o revocata: 401", async () => {
      expect((await app.inject({ url: "/api/v1/invoices" })).statusCode).toBe(401);
      expect((await app.inject({ url: "/api/v1/invoices", headers: H("isk_00000000_" + "0".repeat(48)) })).statusCode).toBe(401);
      expect((await app.inject({ url: "/api/v1/invoices", headers: H("sbagliata") })).statusCode).toBe(401);
      const k = await createApiKey(A.scope, { name: "tmp" }, A.userId, pool);
      expect((await app.inject({ url: "/api/v1/invoices", headers: H(k.secret) })).statusCode).toBe(200);
      await revokeApiKey(A.scope, k.key.id, A.userId, pool);
      expect((await app.inject({ url: "/api/v1/invoices", headers: H(k.secret) })).statusCode).toBe(401);
      expect((await app.inject({ method: "POST", url: "/api/v1/invoices", headers: H(k.secret), payload: {} })).statusCode).toBe(401);
    });

    it("la chiave di B non legge le fatture di A: 404 e liste separate", async () => {
      const created = await post(A.secret);
      expect(created.statusCode).toBe(201);
      const { id } = created.json();
      expect((await app.inject({ url: `/api/v1/invoices/${id}`, headers: H(B.secret) })).statusCode).toBe(404);
      expect((await app.inject({ url: `/api/v1/invoices/${id}/file`, headers: H(B.secret) })).statusCode).toBe(404);
      expect((await app.inject({ url: `/api/v1/invoices/${id}`, headers: H(A.secret) })).statusCode).toBe(200);
      const listB = (await app.inject({ url: "/api/v1/invoices", headers: H(B.secret) })).json();
      expect(listB.data.some((i: { id: string }) => i.id === id)).toBe(false);
      const listA = (await app.inject({ url: "/api/v1/invoices", headers: H(A.secret) })).json();
      expect(listA.data.some((i: { id: string }) => i.id === id)).toBe(true);
      const detail = (await app.inject({ url: `/api/v1/invoices/${id}`, headers: H(A.secret) })).json();
      expect(detail).toHaveProperty("notifications");
      expect(detail.numero).toMatch(/^\d+\/2026$/);
    });

    it("il tenantId nel corpo e ignorato: la fattura va al tenant della chiave", async () => {
      const r = await post(B.secret, undefined, JSON.stringify({ ...input(), tenantId: A.id }));
      expect(r.statusCode).toBe(201);
      expect((await getInvoice(B.scope, r.json().id, { db: pool }))?.tenantId).toBe(B.id);
    });

    it("Idempotency-Key: replay 200 senza duplicare, corpo diverso 409", async () => {
      const key = `k-${randomUUID()}`;
      const first = await post(A.secret, key);
      expect(first.statusCode).toBe(201);
      const again = await post(A.secret, key);
      expect(again.statusCode).toBe(200);
      expect(again.json().id).toBe(first.json().id);
      const other = await post(A.secret, key, JSON.stringify(input({ cessionarioDenominazione: "Altro" })));
      expect(other.statusCode).toBe(409);
      expect(other.json().error).toBe("conflict");
      expect((await pool.query("select count(*)::int c from invoices where id = $1", [first.json().id])).rows[0].c).toBe(1);
      // la stessa chiave su un altro tenant e indipendente
      expect((await post(B.secret, key)).statusCode).toBe(201);
    });

    it("validazione: 422 con i campi", async () => {
      const r = await post(A.secret, undefined, JSON.stringify(input({ cessionarioPartitaIva: "12" })));
      expect(r.statusCode).toBe(422);
      expect(r.json()).toMatchObject({ error: "validation", fields: { cessionarioPartitaIva: "La partita IVA deve avere 11 cifre" } });
      expect((await post(A.secret, undefined, "{}")).statusCode).toBe(422);
    });

    it("ogni POST genera un evento di audit", async () => {
      const n = async () => (await pool.query("select count(*)::int c from audit_log where tenant_id = $1 and event = 'api.invoice.post'", [A.id])).rows[0].c as number;
      const before = await n();
      await post(A.secret);
      await post(A.secret, undefined, "{}");
      expect(await n()).toBe(before + 2);
    });

    it("fatture ricevute: lista, dettaglio e file solo del proprio tenant", async () => {
      const bytes = Buffer.from("<x>originale</x>");
      const ins = await pool.query(
        `insert into received_invoices (tenant_id, sdi_identifier, file_name, file_kind, original_bytes, sha256, stato)
         values ($1, $2, 'IT1_1.xml', 'xml', $3, repeat('b', 64), 'received') returning id`,
        [A.id, rnd(12), bytes],
      );
      const id = ins.rows[0].id;
      const list = (await app.inject({ url: "/api/v1/received-invoices", headers: H(A.secret) })).json();
      expect(list.data.some((r: { id: string }) => r.id === id)).toBe(true);
      const file = await app.inject({ url: `/api/v1/received-invoices/${id}/file`, headers: H(A.secret) });
      expect(file.statusCode).toBe(200);
      expect(file.rawPayload.equals(bytes)).toBe(true);
      expect(file.headers["content-type"]).toContain("application/octet-stream");
      expect((await app.inject({ url: `/api/v1/received-invoices/${id}`, headers: H(B.secret) })).statusCode).toBe(404);
      expect((await app.inject({ url: `/api/v1/received-invoices/${id}/file`, headers: H(B.secret) })).statusCode).toBe(404);
    });

    it("paginazione con cursor", async () => {
      const p1 = (await app.inject({ url: "/api/v1/invoices?limit=2", headers: H(A.secret) })).json();
      expect(p1.data).toHaveLength(2);
      expect(p1.nextCursor).toBe("2");
      const p2 = (await app.inject({ url: `/api/v1/invoices?limit=2&cursor=${p1.nextCursor}`, headers: H(A.secret) })).json();
      expect(p2.data[0].id).not.toBe(p1.data[0].id);
    });
  });
});
