import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { createInvoiceRepo } from "./invoice-repo.ts";
import { RICEZIONE_PATH, parseNotification, registerSdiReceiver, soapOperation } from "./notifications.ts";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

function soap(op: string, inner: string, id = "123"): string {
  return `<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><types:${op} xmlns:types="http://www.fatturapa.it/TrasmissioneFatture"><IdentificativoSdI>${id}</IdentificativoSdI><NomeFile>IT01234567890_00001_RC_001.xml</NomeFile><File>${b64(inner)}</File></types:${op}></soapenv:Body></soapenv:Envelope>`;
}

const rcXml = (id: string, nome: string, msgId = "M1") =>
  `<ns3:RicevutaConsegna xmlns:ns3="http://www.fatturapa.gov.it/sdi/messaggi/v1.0"><IdentificativoSdI>${id}</IdentificativoSdI><NomeFile>${nome}</NomeFile><DataOraRicezione>2026-02-01T10:00:00.000+01:00</DataOraRicezione><DataOraConsegna>2026-02-01T10:00:05.000+01:00</DataOraConsegna><Destinatario><Codice>ABCDEFG</Codice><Descrizione>Dest</Descrizione></Destinatario><MessageId>${msgId}</MessageId></ns3:RicevutaConsegna>`;

const nsXml = (id: string, nome: string) =>
  `<ns3:NotificaScarto xmlns:ns3="http://www.fatturapa.gov.it/sdi/messaggi/v1.0"><IdentificativoSdI>${id}</IdentificativoSdI><NomeFile>${nome}</NomeFile><DataOraRicezione>2026-02-01T10:00:00.000+01:00</DataOraRicezione><ListaErrori><Errore><Codice>00311</Codice><Descrizione>Codice destinatario non valido</Descrizione><Suggerimento>Controllare</Suggerimento></Errore></ListaErrori><MessageId>M2</MessageId></ns3:NotificaScarto>`;

describe("parseNotification", () => {
  it("legge una Ricevuta di Consegna", () => {
    const n = parseNotification(soap("RicevutaConsegna", rcXml("9900000001", "IT01234567890_00001.xml.p7m"), "9900000001"));
    expect(n).toMatchObject({
      type: "RC",
      sdiIdentifier: "9900000001",
      nomeFile: "IT01234567890_00001.xml.p7m",
      messageId: "M1",
      destinatario: "ABCDEFG",
      dataConsegna: "2026-02-01T10:00:05.000+01:00",
      errori: null,
    });
    expect(n.fileSha256).toHaveLength(64);
  });

  it("legge una Notifica di Scarto con i codici errore", () => {
    const n = parseNotification(soap("NotificaScarto", nsXml("5", "f.xml"), "5"));
    expect(n.type).toBe("NS");
    expect(n.errori).toEqual([{ codice: "00311", descrizione: "Codice destinatario non valido", suggerimento: "Controllare" }]);
  });

  it("MessageId assente diventa stringa vuota", () => {
    const xml = rcXml("1", "f.xml").replace(/<MessageId>.*<\/MessageId>/, "");
    expect(parseNotification(soap("RicevutaConsegna", xml, "1")).messageId).toBe("");
  });

  it("rifiuta operazioni non supportate", () => {
    expect(() => parseNotification(soap("MancataConsegna", "<x/>"))).toThrow(/non ancora supportata: MancataConsegna/);
    expect(soapOperation(soap("NotificaEsito", "<x/>"))).toBe("NotificaEsito");
  });

  it("rifiuta XML malformato o senza Body", () => {
    expect(() => parseNotification("<a><b></a>")).toThrow();
    expect(() => parseNotification("<a/>")).toThrow();
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
    expect((await post(soap("MancataConsegna", "<x/>"))).statusCode).toBe(500);
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
