import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFatturaXml } from "../sdi/fatturapa/build.ts";
import type { FatturaModel } from "../sdi/fatturapa/types.ts";
import { signCadesBes } from "../sdi/sign/cades.ts";
import { generateTestCert } from "../sdi/sign/test-cert.ts";
import { buildDemoReceivedInvoiceSoap } from "../sdi/messaggi/demo-notification.ts";
import { RICEZIONE_FATTURE_PATH, registerRicezioneFatture } from "./http/ricezione-fatture.ts";
import { assignReceived, getReceived, listReceived, listUnassigned } from "./invoice-service.ts";
import { ForbiddenError } from "./scope.ts";
import type { Scope } from "./scope.ts";

const rnd = (n: number) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, "0");
const sede = { indirizzo: "Via Roma 1", cap: "00100", comune: "Roma", provincia: "RM", nazione: "IT" };

async function passiva(cessionario: { piva?: string; cf?: string }, numero = "77") {
  const model: FatturaModel = {
    cedente: { idPaese: "IT", partitaIva: rnd(11), denominazione: "Fornitore Spa", regimeFiscale: "RF01", sede },
    cessionario: {
      ...(cessionario.piva ? { idPaese: "IT", partitaIva: cessionario.piva } : {}),
      ...(cessionario.cf ? { codiceFiscale: cessionario.cf } : {}),
      denominazione: "Destinatario",
      sede,
    },
    codiceDestinatario: "ABCDEFG",
    progressivoInvio: rnd(5),
    tipoDocumento: "TD01",
    data: "2026-03-10",
    numero,
    righe: [{ descrizione: "Servizio", prezzoUnitarioCents: 10000, aliquotaBp: 2200 }],
  };
  const r = await buildFatturaXml(model);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
}

const url = process.env.DATABASE_URL ?? "postgres://sdi:sdi_dev_only@localhost:54320/sdi_channel";
const pool = new pg.Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 1500 });
let dbReady = false;
try {
  await pool.query("select 1 from received_invoices limit 1");
  dbReady = true;
} catch {
  console.warn("[passive.test] Postgres non disponibile o migrazione 0007 non applicata: test DB saltati");
}
afterAll(() => pool.end());

describe.skipIf(!dbReady)("fatture passive (RicezioneFatture)", () => {
  const app = Fastify();
  registerRicezioneFatture(app, { pool, sdiEnv: "demo" });
  const admin: Scope = { role: "admin" };
  const pivaA = rnd(11);
  const pivaB = rnd(11);
  const cfB = `T${Date.now().toString(36).toUpperCase()}${rnd(3)}`;
  let A: Scope;
  let B: Scope;
  let tenantA: string;
  let tenantB: string;

  const post = (payload: string) => app.inject({ method: "POST", url: RICEZIONE_FATTURE_PATH, headers: { "content-type": "text/xml" }, payload });

  beforeAll(async () => {
    tenantA = (await pool.query("insert into tenants (partita_iva, denominazione) values ($1, 'Passive A') returning id", [pivaA])).rows[0].id;
    tenantB = (await pool.query("insert into tenants (partita_iva, denominazione, codice_fiscale) values ($1, 'Passive B', $2) returning id", [pivaB, cfB])).rows[0].id;
    A = { role: "cliente", tenantId: tenantA };
    B = { role: "cliente", tenantId: tenantB };
  });

  it("XML: salva il file originale identico, con hash, e lo assegna per partita IVA", async () => {
    const f = await passiva({ piva: pivaA });
    const bytes = Buffer.from(f.xml, "utf8");
    const sdiId = rnd(12);
    const res = await post(buildDemoReceivedInvoiceSoap({ sdiIdentifier: sdiId, nomeFile: f.nomeFile, bytes }));
    expect(res.statusCode).toBe(200);
    const list = await listReceived(A, {}, { db: pool });
    const row = list.find((x) => x.sdiIdentifier === sdiId)!;
    expect(row).toMatchObject({ tenantId: tenantA, fileKind: "xml", numero: "77", importoCents: 12200, stato: "received", data: "2026-03-10" });
    const det = (await getReceived(A, row.id, { db: pool }))!;
    expect(Buffer.compare(det.bytes, bytes)).toBe(0);
    expect(det.sha256).toBe((await import("node:crypto")).createHash("sha256").update(bytes).digest("hex"));
    expect(det.history.map((h) => h.event)).toEqual(["received"]);
  });

  it("P7M: verifica la firma, estrae l'XML e conserva i byte del p7m", async () => {
    const f = await passiva({ piva: pivaA }, "78");
    const p7m = await signCadesBes(f.xml, generateTestCert("Fornitore"));
    const sdiId = rnd(12);
    expect((await post(buildDemoReceivedInvoiceSoap({ sdiIdentifier: sdiId, nomeFile: `${f.nomeFile}.p7m`, bytes: p7m }))).statusCode).toBe(200);
    const row = (await listReceived(A, {}, { db: pool })).find((x) => x.sdiIdentifier === sdiId)!;
    expect(row).toMatchObject({ fileKind: "p7m", numero: "78" });
    const det = (await getReceived(A, row.id, { db: pool }))!;
    expect(Buffer.compare(det.bytes, p7m)).toBe(0);
    expect(det.contentType).toBe("application/pkcs7-mime");
  });

  it("P7M con firma alterata: Fault e nessuna fattura salvata", async () => {
    const f = await passiva({ piva: pivaA }, "79");
    const p7m = await signCadesBes(f.xml, generateTestCert("Fornitore"));
    p7m[p7m.length - 5] ^= 0xff;
    const sdiId = rnd(12);
    const res = await post(buildDemoReceivedInvoiceSoap({ sdiIdentifier: sdiId, nomeFile: `${f.nomeFile}.p7m`, bytes: p7m }));
    expect(res.statusCode).toBe(500);
    expect((await pool.query("select 1 from received_invoices where sdi_identifier = $1", [sdiId])).rowCount).toBe(0);
  });

  it("idempotenza: lo stesso IdentificativoSdI due volte salva una sola fattura", async () => {
    const f = await passiva({ piva: pivaA }, "80");
    const soap = buildDemoReceivedInvoiceSoap({ sdiIdentifier: rnd(12), nomeFile: f.nomeFile, bytes: Buffer.from(f.xml) });
    expect((await post(soap)).statusCode).toBe(200);
    // Il duplicato è rifiutato con un Fault SOAP e non crea un secondo record.
    const dup = await post(soap);
    expect(dup.statusCode).toBe(500);
    expect(dup.body).toMatch(/duplicato/);
    const id = /<IdentificativoSdI>(\d+)</.exec(soap)![1];
    expect((await pool.query("select 1 from received_invoices where sdi_identifier = $1", [id])).rowCount).toBe(1);
  });

  it("senza partita IVA corrispondente si usa il codice fiscale", async () => {
    const f = await passiva({ cf: cfB }, "81");
    const sdiId = rnd(12);
    await post(buildDemoReceivedInvoiceSoap({ sdiIdentifier: sdiId, nomeFile: f.nomeFile, bytes: Buffer.from(f.xml) }));
    const row = (await listReceived(B, {}, { db: pool })).find((x) => x.sdiIdentifier === sdiId);
    expect(row?.tenantId).toBe(tenantB);
  });

  it("nessuna corrispondenza: non assegnata, visibile solo all'admin, poi assegnabile", async () => {
    const f = await passiva({ piva: rnd(11) }, "82");
    const sdiId = rnd(12);
    await post(buildDemoReceivedInvoiceSoap({ sdiIdentifier: sdiId, nomeFile: f.nomeFile, bytes: Buffer.from(f.xml) }));
    const un = (await listUnassigned(admin, { db: pool })).find((x) => x.sdiIdentifier === sdiId)!;
    expect(un).toMatchObject({ tenantId: null, stato: "unassigned" });
    await expect(listUnassigned(A, { db: pool })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listReceived(A, {}, { db: pool })).some((x) => x.sdiIdentifier === sdiId)).toBe(false);
    expect(await getReceived(A, un.id, { db: pool })).toBeNull();
    await expect(assignReceived(A, un.id, tenantA, null, { db: pool })).rejects.toBeInstanceOf(ForbiddenError);

    expect(await assignReceived(admin, un.id, tenantB, null, { db: pool })).toBe(true);
    expect(await assignReceived(admin, un.id, tenantA, null, { db: pool })).toBe(false);
    expect((await getReceived(B, un.id, { db: pool }))?.stato).toBe("received");
    expect(await getReceived(A, un.id, { db: pool })).toBeNull();
    const ev = await pool.query("select 1 from audit_log where event = 'received_invoice.assigned' and entity_id = $1", [un.id]);
    expect(ev.rowCount).toBe(1);
  });

  it("isolamento: A non vede le ricevute di B, nemmeno per id", async () => {
    const f = await passiva({ piva: pivaB }, "83");
    const sdiId = rnd(12);
    await post(buildDemoReceivedInvoiceSoap({ sdiIdentifier: sdiId, nomeFile: f.nomeFile, bytes: Buffer.from(f.xml) }));
    const rowB = (await listReceived(B, {}, { db: pool })).find((x) => x.sdiIdentifier === sdiId)!;
    expect(await getReceived(A, rowB.id, { db: pool })).toBeNull();
    expect((await listReceived(A, { tenantId: tenantB }, { db: pool })).every((x) => x.tenantId === tenantA)).toBe(true);
    expect((await listReceived(admin, {}, { db: pool })).some((x) => x.id === rowB.id)).toBe(true);
  });

  it("operazione sconosciuta o file non FatturaPA: Fault", async () => {
    expect((await post(buildDemoReceivedInvoiceSoap({ sdiIdentifier: rnd(12), nomeFile: "x.xml", bytes: Buffer.from("<a/>") }))).statusCode).toBe(500);
    expect((await post("<a><b></a>")).statusCode).toBe(500);
  });

  it("in production risponde Fault senza toccare il DB", async () => {
    const q = () => {
      throw new Error("DB toccato");
    };
    const prod = Fastify();
    registerRicezioneFatture(prod, { pool: { query: q, connect: q } as unknown as pg.Pool, sdiEnv: "production" });
    const f = await passiva({ piva: pivaA }, "84");
    const res = await prod.inject({
      method: "POST",
      url: RICEZIONE_FATTURE_PATH,
      headers: { "content-type": "text/xml" },
      payload: buildDemoReceivedInvoiceSoap({ sdiIdentifier: randomUUID(), nomeFile: f.nomeFile, bytes: Buffer.from(f.xml) }),
    });
    expect(res.statusCode).toBe(500);
  });
});
