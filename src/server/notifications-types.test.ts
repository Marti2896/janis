import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { buildDemoNotificationSoap } from "../sdi/messaggi/demo-notification.ts";
import type { DemoNotificationOptions } from "../sdi/messaggi/demo-notification.ts";
import { RICEZIONE_PATH, parseNotification, registerSdiReceiver } from "./notifications.ts";

// Notifiche MC, NE, DT, SE: parsing (XSD) e transizioni di stato senza regressioni.

describe("parseNotification MC, NE, DT, SE", () => {
  it("MC: legge descrizione e data di ricezione", async () => {
    const n = await parseNotification(buildDemoNotificationSoap({ tipo: "MC", sdiIdentifier: "11", nomeFile: "f.xml.p7m", descrizione: "Casella piena" }));
    expect(n).toMatchObject({ type: "MC", sdiIdentifier: "11", nomeFile: "f.xml.p7m", descrizione: "Casella piena", esito: null });
  });
  it("NE: legge l'esito EC01 ed EC02", async () => {
    const a = await parseNotification(buildDemoNotificationSoap({ tipo: "NE", sdiIdentifier: "12", nomeFile: "f.xml.p7m" }));
    expect(a).toMatchObject({ type: "NE", esito: "EC01", sdiIdentifier: "12" });
    const b = await parseNotification(buildDemoNotificationSoap({ tipo: "NE", sdiIdentifier: "12", nomeFile: "f.xml.p7m", esito: "EC02", descrizione: "Importo errato", messageId: "M9" }));
    expect(b).toMatchObject({ esito: "EC02", descrizione: "Importo errato", messageId: "M9" });
  });
  it("DT: legge la decorrenza dei termini", async () => {
    const n = await parseNotification(buildDemoNotificationSoap({ tipo: "DT", sdiIdentifier: "13", nomeFile: "f.xml.p7m" }));
    expect(n).toMatchObject({ type: "DT", descrizione: "Decorrenza dei termini" });
  });
  it("SE: legge il codice di scarto", async () => {
    const n = await parseNotification(buildDemoNotificationSoap({ tipo: "SE", sdiIdentifier: "14", nomeFile: "f.xml", esito: "EN01" }));
    expect(n).toMatchObject({ type: "SE", esito: "EN01", sdiIdentifier: "14" });
  });
  it("rifiuta un NE con operazione incoerente", async () => {
    const soap = buildDemoNotificationSoap({ tipo: "NE", sdiIdentifier: "12", nomeFile: "f.xml" }).replace(/NotificaEsito/g, "NotificaDecorrenzaTermini");
    await expect(parseNotification(soap)).rejects.toThrow();
  });
});

const url = process.env.DATABASE_URL ?? "postgres://sdi:sdi_dev_only@localhost:54320/sdi_channel";
const pool = new pg.Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 1500 });
let dbReady = false;
try {
  await pool.query("select 1 from invoices, received_invoices limit 1");
  dbReady = true;
} catch {
  console.warn("[notifications-types.test] Postgres non disponibile o migrazione 0007 non applicata: test DB saltati");
}
afterAll(() => pool.end());

describe.skipIf(!dbReady)("transizioni di stato per MC, NE, DT, SE", () => {
  const app = Fastify();
  registerSdiReceiver(app, { pool, sdiEnv: "demo" });
  const rnd = (n: number) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, "0");

  async function setup(status: string) {
    const piva = rnd(11);
    const t = await pool.query("insert into tenants (partita_iva, denominazione) values ($1, 'T') returning id", [piva]);
    const sdiId = rnd(12);
    const nome = `IT${piva}_${randomUUID().slice(0, 5)}.xml.p7m`;
    const i = await pool.query(
      "insert into invoices (tenant_id, numero, data, nome_file, sdi_identifier, status) values ($1, 'N1', '2026-01-01', $2, $3, $4) returning id",
      [t.rows[0].id, nome, sdiId, status],
    );
    return { invoiceId: i.rows[0].id as string, tenantId: t.rows[0].id as string, sdiId, nome };
  }
  const send = (o: DemoNotificationOptions) =>
    app.inject({ method: "POST", url: RICEZIONE_PATH, headers: { "content-type": "text/xml" }, payload: buildDemoNotificationSoap(o) });
  const status = async (id: string) => (await pool.query("select status from invoices where id = $1", [id])).rows[0].status as string;
  const notes = async (id: string) => (await pool.query("select type, esito from sdi_notifications where invoice_id = $1 order by id", [id])).rows;

  it("MC dopo inviata: mancata consegna con storico", async () => {
    const s = await setup("sent");
    expect((await send({ tipo: "MC", sdiIdentifier: s.sdiId, nomeFile: s.nome })).statusCode).toBe(200);
    expect(await status(s.invoiceId)).toBe("not_delivered");
    const h = await pool.query("select from_status, to_status, source from invoice_status_history where invoice_id = $1", [s.invoiceId]);
    expect(h.rows[0]).toMatchObject({ from_status: "sent", to_status: "not_delivered", source: "sdi_notification" });
  });

  it("MC su una fattura gia consegnata viene registrata ma non fa regredire lo stato", async () => {
    const s = await setup("delivered");
    expect((await send({ tipo: "MC", sdiIdentifier: s.sdiId, nomeFile: s.nome })).statusCode).toBe(200);
    expect(await status(s.invoiceId)).toBe("delivered");
    expect(await notes(s.invoiceId)).toEqual([{ type: "MC", esito: null }]);
  });

  it("NE EC01 e EC02 dopo consegnata: accettata e rifiutata", async () => {
    const a = await setup("delivered");
    await send({ tipo: "NE", sdiIdentifier: a.sdiId, nomeFile: a.nome, esito: "EC01" });
    expect(await status(a.invoiceId)).toBe("accepted");
    const b = await setup("delivered");
    await send({ tipo: "NE", sdiIdentifier: b.sdiId, nomeFile: b.nome, esito: "EC02" });
    expect(await status(b.invoiceId)).toBe("refused");
    expect(await notes(b.invoiceId)).toEqual([{ type: "NE", esito: "EC02" }]);
  });

  it("NE e DT prima della consegna non cambiano lo stato", async () => {
    const s = await setup("sent");
    await send({ tipo: "NE", sdiIdentifier: s.sdiId, nomeFile: s.nome });
    await send({ tipo: "DT", sdiIdentifier: s.sdiId, nomeFile: s.nome });
    expect(await status(s.invoiceId)).toBe("sent");
    expect((await notes(s.invoiceId)).map((n) => n.type)).toEqual(["NE", "DT"]);
  });

  it("DT dopo consegnata: termini scaduti; poi un'altra notifica non regredisce", async () => {
    const s = await setup("delivered");
    await send({ tipo: "DT", sdiIdentifier: s.sdiId, nomeFile: s.nome });
    expect(await status(s.invoiceId)).toBe("terms_expired");
    await send({ tipo: "NE", sdiIdentifier: s.sdiId, nomeFile: s.nome, messageId: "M5" });
    await send({ tipo: "RC", sdiIdentifier: s.sdiId, nomeFile: s.nome, messageId: "M6" });
    expect(await status(s.invoiceId)).toBe("terms_expired");
  });

  it("la stessa notifica due volte e idempotente", async () => {
    const s = await setup("sent");
    await send({ tipo: "MC", sdiIdentifier: s.sdiId, nomeFile: s.nome });
    await send({ tipo: "MC", sdiIdentifier: s.sdiId, nomeFile: s.nome });
    expect(await notes(s.invoiceId)).toHaveLength(1);
    expect((await pool.query("select 1 from invoice_status_history where invoice_id = $1", [s.invoiceId])).rowCount).toBe(1);
  });

  it("SE si registra sulla fattura ricevuta e non tocca le fatture emesse", async () => {
    const s = await setup("delivered");
    const sdiId = rnd(12);
    const r = await pool.query(
      `insert into received_invoices (tenant_id, sdi_identifier, file_name, file_kind, original_bytes, sha256, stato)
       values ($1, $2, 'IT1_1.xml', 'xml', 'x', repeat('a', 64), 'received') returning id`,
      [s.tenantId, sdiId],
    );
    expect((await send({ tipo: "SE", sdiIdentifier: sdiId, nomeFile: "IT1_1.xml", esito: "EN00" })).statusCode).toBe(200);
    const h = await pool.query("select event, detail from received_invoice_history where received_invoice_id = $1", [r.rows[0].id]);
    expect(h.rows[0]).toMatchObject({ event: "SE" });
    expect(h.rows[0].detail.scarto).toBe("EN00");
    expect(await status(s.invoiceId)).toBe("delivered");
    const n = await pool.query("select tenant_id, received_invoice_id from sdi_notifications where sdi_identifier = $1", [sdiId]);
    expect(n.rows[0]).toMatchObject({ tenant_id: s.tenantId, received_invoice_id: r.rows[0].id });
  });

  it("la storia dei ricevuti e append-only", async () => {
    await expect(pool.query("delete from received_invoice_history")).rejects.toThrow(/append-only/);
  });
});
