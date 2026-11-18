import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { buildDemoNotificationSoap, buildDemoNotificationXml } from "../sdi/messaggi/demo-notification.ts";
import { buildApp } from "../../server/app.ts";
import { createInvoiceRepo } from "./invoice-repo.ts";
import { RICEZIONE_PATH, parseNotification, registerSdiReceiver, soapOperation } from "./notifications.ts";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

function soap(op: string, inner: string, id = "123"): string {
  return `<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><types:${op} xmlns:types="http://www.fatturapa.it/TrasmissioneFatture"><IdentificativoSdI>${id}</IdentificativoSdI><NomeFile>IT01234567890_00001_RC_001.xml</NomeFile><File>${b64(inner)}</File></types:${op}></soapenv:Body></soapenv:Envelope>`;
}


// Notifiche conformi allo XSD, firmate a runtime dal generatore unico (ADR 0005).
const rcXml = (id: string, nome: string, msgId = "M1") =>
  buildDemoNotificationXml({ tipo: "RC", sdiIdentifier: id, nomeFile: nome, messageId: msgId });
const nsXml = (id: string, nome: string) =>
  buildDemoNotificationXml({ tipo: "NS", sdiIdentifier: id, nomeFile: nome, messageId: "M2" });

describe("parseNotification", () => {
  it("legge una Ricevuta di Consegna", async () => {
    const n = await parseNotification(soap("RicevutaConsegna", rcXml("9900000001", "IT01234567890_00001.xml.p7m"), "9900000001"));
    expect(n).toMatchObject({
      type: "RC",
      sdiIdentifier: "9900000001",
      nomeFile: "IT01234567890_00001.xml.p7m",
      messageId: "M1",
      destinatario: "ABCDEF",
      dataConsegna: "2026-02-01T10:00:05.000+01:00",
      errori: null,
    });
    expect(n.fileSha256).toHaveLength(64);
  });

  it("legge una Notifica di Scarto con i codici errore", async () => {
    const n = await parseNotification(soap("NotificaScarto", nsXml("5", "f.xml"), "5"));
    expect(n.type).toBe("NS");
    expect(n.errori).toEqual([{ codice: "00311", descrizione: "Codice destinatario non valido" }]);
  });

  it("il generatore produce RC e NS accettate dalla validazione e senza firma sono rifiutate", async () => {
    const rc = await parseNotification(
      buildDemoNotificationSoap({ tipo: "RC", sdiIdentifier: "42", nomeFile: "f.xml", destinatarioCodice: "ABC123" }),
    );
    expect(rc).toMatchObject({ type: "RC", sdiIdentifier: "42", destinatario: "ABC123" });
    const ns = await parseNotification(
      buildDemoNotificationSoap({ tipo: "NS", sdiIdentifier: "43", nomeFile: "f.xml", errori: [{ codice: "00200", descrizione: "File non conforme" }] }),
    );
    expect(ns.errori).toEqual([{ codice: "00200", descrizione: "File non conforme" }]);
    const unsigned = rcXml("1", "f.xml").replace(/<ds:Signature[\s\S]*<\/ds:Signature>/, "");
    await expect(parseNotification(soap("RicevutaConsegna", unsigned, "1"))).rejects.toThrow(/non valido/);
  });

  it("rifiuta una RC senza MessageId (obbligatorio per XSD)", async () => {
    const xml = rcXml("1", "f.xml").replace(/<MessageId>.*<\/MessageId>/, "");
    await expect(parseNotification(soap("RicevutaConsegna", xml, "1"))).rejects.toThrow(/non valido/);
  });

  it("rifiuta una RC senza DataOraConsegna", async () => {
    const xml = rcXml("1", "f.xml").replace(/<DataOraConsegna>.*<\/DataOraConsegna>/, "");
    await expect(parseNotification(soap("RicevutaConsegna", xml, "1"))).rejects.toThrow(/Messaggio SdI non valido/);
  });

  it("rifiuta un messaggio interno troncato", async () => {
    const xml = `<ns3:RicevutaConsegna xmlns:ns3="http://www.fatturapa.gov.it/sdi/messaggi/v1.0"><IdentificativoSdI>1</IdentificativoSdI><NomeFile>`;
    await expect(parseNotification(soap("RicevutaConsegna", xml, "1"))).rejects.toThrow();
  });

  it("rifiuta operazioni non supportate", async () => {
    await expect(parseNotification(soap("NotificaFileNonRecapitabile", "<x/>"))).rejects.toThrow(/non ancora supportata: NotificaFileNonRecapitabile/);
    expect(soapOperation(soap("NotificaEsito", "<x/>"))).toBe("NotificaEsito");
  });

  it("rifiuta XML malformato o senza Body", async () => {
    await expect(parseNotification("<a><b></a>")).rejects.toThrow();
    await expect(parseNotification("<a/>")).rejects.toThrow();
  });
});

describe("rotta di ricezione in production", () => {
  it("risponde Fault senza toccare il DB", async () => {
    const pool = { query: () => { throw new Error("DB toccato"); }, connect: () => { throw new Error("DB toccato"); } } as unknown as pg.Pool;
    const app = Fastify();
    registerSdiReceiver(app, { pool, sdiEnv: "production" });
    const res = await app.inject({ method: "POST", url: RICEZIONE_PATH, headers: { "content-type": "text/xml" }, payload: soap("RicevutaConsegna", rcXml("1", "f")) });
    expect(res.statusCode).toBe(500);
    expect(res.body).toContain("Fault");
  });

  it("server reale (buildApp) con sdiEnv production: Fault per RC e NS e zero query", async () => {
    const queries: string[] = [];
    const spy = (name: string) => (...args: unknown[]) => {
      queries.push(`${name}:${String(args[0])}`);
      throw new Error("DB toccato");
    };
    const pool = { query: spy("query"), connect: spy("connect") } as unknown as pg.Pool;
    const app = buildApp({ sdiEnv: "production", checks: {}, pool });
    const send = (payload: string) =>
      app.inject({ method: "POST", url: RICEZIONE_PATH, headers: { "content-type": "text/xml" }, payload });

    const rc = await send(soap("RicevutaConsegna", rcXml("9900000001", "IT01234567890_00001.xml.p7m"), "9900000001"));
    const ns = await send(soap("NotificaScarto", nsXml("9900000001", "IT01234567890_00001.xml.p7m"), "9900000001"));
    for (const res of [rc, ns]) {
      expect(res.statusCode).toBe(500);
      expect(res.body).toContain("Fault");
    }
    expect(queries).toEqual([]);
    await app.close();
  });
});

// --- Test con Postgres: saltati in modo esplicito se non raggiungibile o senza migrazioni ---
const databaseUrl = process.env.DATABASE_URL ?? "postgres://sdi:sdi_dev_only@localhost:54320/sdi_channel";
const pool = new pg.Pool({ connectionString: databaseUrl, max: 3, connectionTimeoutMillis: 1500 });
let dbReady = false;
try {
  await pool.query("select 1 from invoices limit 1");
  dbReady = true;
} catch (err) {
  console.warn(`[notifications.test] Postgres non disponibile o migrazione 0002 non applicata: test DB saltati (${(err as Error).message})`);
}
afterAll(() => pool.end());

describe.skipIf(!dbReady)("ricezione notifiche con Postgres", () => {
  const app = Fastify();
  registerSdiReceiver(app, { pool, sdiEnv: "demo" });

  async function setup(status: string) {
    const piva = String(Math.floor(Math.random() * 1e11)).padStart(11, "0");
    const t = await pool.query("insert into tenants (partita_iva, denominazione) values ($1, 'T') returning id", [piva]);
    const sdiId = String(Math.floor(Math.random() * 1e12));
    const nome = `IT${piva}_${randomUUID().slice(0, 5)}.xml.p7m`;
    const i = await pool.query(
      "insert into invoices (tenant_id, numero, data, nome_file, sdi_identifier, status) values ($1, 'N1', '2026-01-01', $2, $3, $4) returning id",
      [t.rows[0].id, nome, sdiId, status],
    );
    return { invoiceId: i.rows[0].id as string, sdiId, nome };
  }
  const post = (payload: string) =>
    app.inject({ method: "POST", url: RICEZIONE_PATH, headers: { "content-type": "text/xml" }, payload });
  const status = async (id: string) => (await pool.query("select status from invoices where id = $1", [id])).rows[0].status;

  it("RC porta la fattura a delivered con storico e causale", async () => {
    const s = await setup("sent");
    const res = await post(soap("RicevutaConsegna", rcXml(s.sdiId, s.nome), s.sdiId));
    expect(res.statusCode).toBe(200);
    expect(await status(s.invoiceId)).toBe("delivered");
    const h = await pool.query("select * from invoice_status_history where invoice_id = $1", [s.invoiceId]);
    expect(h.rows[0]).toMatchObject({ from_status: "sent", to_status: "delivered", source: "sdi_notification" });
    expect(h.rows[0].causale).toContain("Ricevuta di consegna");
  });

  it("NS da send_unknown porta a rejected e salva i codici", async () => {
    const s = await setup("send_unknown");
    const res = await post(soap("NotificaScarto", nsXml(s.sdiId, s.nome), s.sdiId));
    expect(res.statusCode).toBe(200);
    expect(await status(s.invoiceId)).toBe("rejected");
    const n = await pool.query("select errori from sdi_notifications where sdi_identifier = $1", [s.sdiId]);
    expect(n.rows[0].errori[0].codice).toBe("00311");
  });

  it("duplicato: una sola riga, storico invariato, risposta OK", async () => {
    const s = await setup("sent");
    const body = soap("RicevutaConsegna", rcXml(s.sdiId, s.nome), s.sdiId);
    expect((await post(body)).statusCode).toBe(200);
    expect((await post(body)).statusCode).toBe(200);
    expect((await pool.query("select 1 from sdi_notifications where sdi_identifier = $1", [s.sdiId])).rowCount).toBe(1);
    expect((await pool.query("select 1 from invoice_status_history where invoice_id = $1", [s.invoiceId])).rowCount).toBe(1);
  });

  it("fattura sconosciuta: notifica con invoice_id nullo, OK", async () => {
    const id = String(Math.floor(Math.random() * 1e12));
    const res = await post(soap("RicevutaConsegna", rcXml(id, "IT00000000000_zzzzz.xml"), id));
    expect(res.statusCode).toBe(200);
    const n = await pool.query("select invoice_id from sdi_notifications where sdi_identifier = $1", [id]);
    expect(n.rows[0].invoice_id).toBeNull();
  });

  it("stato incompatibile: registrata, nessuna transizione, OK", async () => {
    const s = await setup("draft");
    const res = await post(soap("RicevutaConsegna", rcXml(s.sdiId, s.nome), s.sdiId));
    expect(res.statusCode).toBe(200);
    expect(await status(s.invoiceId)).toBe("draft");
    expect((await pool.query("select 1 from sdi_notifications where invoice_id = $1", [s.invoiceId])).rowCount).toBe(1);
  });

  it("operazione non supportata o XML malformato: Fault 500", async () => {
    expect((await post(soap("NotificaFileNonRecapitabile", "<x/>"))).statusCode).toBe(500);
    expect((await post("<a><b></a>")).statusCode).toBe(500);
  });

  it("audit e storico sono append-only", async () => {
    const s = await setup("sent");
    await post(soap("RicevutaConsegna", rcXml(s.sdiId, s.nome), s.sdiId));
    await expect(pool.query("update audit_log set event = 'x'")).rejects.toThrow(/append-only/);
    await expect(pool.query("delete from invoice_status_history")).rejects.toThrow(/append-only/);
    await expect(pool.query("update sdi_notifications set type = 'NS'")).rejects.toThrow(/append-only/);
  });

  it("repo: riparazione solo da rejected o send_error, originale intatto", async () => {
    const repo = createInvoiceRepo(pool);
    const bad = await setup("sent");
    await expect(repo.createRepair({ replacesInvoiceId: bad.invoiceId, nomeFile: `x${randomUUID()}.xml` })).rejects.toThrow(
      "Riparazione non consentita: la fattura è in stato sent",
    );
    const rej = await setup("rejected");
    const { id } = await repo.createRepair({ replacesInvoiceId: rej.invoiceId, nomeFile: `r${randomUUID()}.xml` });
    expect(await status(id)).toBe("draft");
    expect(await status(rej.invoiceId)).toBe("rejected");
  });

  it("repo: transizione non consentita rifiutata", async () => {
    const repo = createInvoiceRepo(pool);
    const s = await setup("draft");
    await expect(repo.transition({ invoiceId: s.invoiceId, to: "sent", reason: "x" })).rejects.toThrow(
      "Transizione non consentita: da draft a sent",
    );
    await repo.transition({ invoiceId: s.invoiceId, to: "signed", reason: "firmata" });
    expect(await status(s.invoiceId)).toBe("signed");
  });
});
