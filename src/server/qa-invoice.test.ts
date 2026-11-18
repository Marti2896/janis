import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { createAndSendInvoice, getInvoice, validateNewInvoice } from "./invoice-service.ts";
import type { NewInvoiceInput } from "./invoice-service.ts";
import { createQaInvoice } from "./qa-invoice.ts";

const url = process.env.DATABASE_URL ?? "postgres://sdi:sdi_dev_only@localhost:54320/sdi_channel";
const pool = new pg.Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 1500 });
let dbReady = false;
try {
  await pool.query("select replaced_by from invoices limit 1");
  await pool.query("select documenti_count from received_invoices limit 1");
  dbReady = true;
} catch {
  console.warn("[qa-invoice.test] Postgres non disponibile o migrazione 0010 non applicata: test DB saltati");
}
afterAll(() => pool.end());

const base: NewInvoiceInput = {
  cessionarioDenominazione: "Cliente",
  cessionarioPartitaIva: "12345678903",
  destinazione: { tipo: "codice", valore: "0000000" },
  tipoDocumento: "TD01",
  data: "2026-05-10",
  righe: [{ descrizione: "Servizio", quantita: 1, prezzoUnitario: 10, aliquota: 22 }],
};

describe("validazione cessionario: P.IVA oppure codice fiscale", () => {
  it("accetta il solo codice fiscale di un privato", () => {
    const e = validateNewInvoice({ ...base, cessionarioPartitaIva: "", cessionarioCodiceFiscale: "RSSMRA80A01F205X" });
    expect(e.cessionarioPartitaIva).toBeUndefined();
  });
  it("rifiuta quando mancano entrambi", () => {
    const e = validateNewInvoice({ ...base, cessionarioPartitaIva: "", cessionarioCodiceFiscale: "" });
    expect(e.cessionarioPartitaIva).toBe("Inserisci la Partita IVA o il codice fiscale");
  });
  it("rifiuta una P.IVA scritta male", () => {
    expect(validateNewInvoice({ ...base, cessionarioPartitaIva: "12345" }).cessionarioPartitaIva).toMatch(/11 cifre/);
  });
});

describe.skipIf(!dbReady)("script qa:fattura-inviata e fattura scartata rifatta", () => {
  it("crea una fattura inviata e una consegnata con storico coerente", async () => {
    const sent = await createQaInvoice(pool, { tenant: "alfa", stato: "sent" });
    expect(sent.stato).toBe("sent");
    expect(sent.sdi_identifier).toBeTruthy();
    const del = await createQaInvoice(pool, { tenant: "beta", stato: "delivered" });
    expect(del.stato).toBe("delivered");
    const n = await pool.query("select type from sdi_notifications where sdi_identifier = $1", [del.sdi_identifier]);
    expect(n.rows.map((r) => r.type)).toEqual(["RC"]);
    const h = await pool.query("select to_status from invoice_status_history where invoice_id = $1 order by recorded_at, id", [del.id]);
    expect(h.rows.map((r) => r.to_status)).toEqual(["draft", "signed", "sent", "delivered"]);
  });

  it("usa la denominazione del cessionario nel DB e nell'XML firmato", async () => {
    const r = await createQaInvoice(pool, { tenant: "alfa", stato: "sent", cessionario: "qa-Cessionario Prova Srl", pivaCessionario: "12345678903" });
    const row = await pool.query("select * from invoices where id = $1", [r.id]);
    expect(JSON.stringify(row.rows[0])).toContain("qa-Cessionario Prova Srl");
    const bytes = Object.values(row.rows[0]).find((v) => Buffer.isBuffer(v)) as Buffer | undefined;
    if (bytes) expect(bytes.toString("latin1")).toContain("qa-Cessionario Prova Srl");
  });

  it("rifiuta di girare in produzione", async () => {
    await expect(createQaInvoice(pool, { tenant: "alfa", stato: "sent", sdiEnv: "production" })).rejects.toThrow(/production/);
  });

  it("rifare una scartata riusa numero e data, la vecchia diventa Sostituita e il contatore non avanza", async () => {
    const sent = await createQaInvoice(pool, { tenant: "alfa", stato: "sent" });
    const inv = await pool.query("select tenant_id, nome_file from invoices where id = $1", [sent.id]);
    // Notifica di scarto sulla fattura inviata.
    const { processNotification } = await import("./notifications.ts");
    await processNotification(pool, {
      type: "NS",
      sdiIdentifier: sent.sdi_identifier,
      nomeFile: inv.rows[0].nome_file as string,
      messageId: randomUUID(),
      fileSha256: "0".repeat(64),
      sdiTimestamp: new Date().toISOString(),
      dataConsegna: null,
      destinatario: null,
      errori: [{ codice: "00200", descrizione: "File non conforme al formato" }],
      esito: null,
      descrizione: null,
    });
    expect((await getInvoice({ role: "admin" }, sent.id))?.status).toBe("rejected");
    const tenantId = inv.rows[0].tenant_id as string;
    const counterBefore = await pool.query("select ultimo from invoice_counters where tenant_id = $1 and anno > 0 order by anno desc limit 1", [tenantId]);

    const res = await createAndSendInvoice({ role: "admin" }, { ...base, tenantId, data: "2020-01-01" }, {
      db: pool,
      channel: { environment: "demo", endpoint: "" },
      replacesInvoiceId: sent.id,
    });
    expect("errors" in res).toBe(false);
    if ("errors" in res) return;
    const nuova = await getInvoice({ role: "admin" }, res.id);
    const vecchia = await getInvoice({ role: "admin" }, sent.id);
    expect(nuova?.numero).toBe(sent.numero);
    expect(vecchia?.status).toBe("replaced");
    expect(vecchia?.replacedBy).toBe(res.id);
    expect(nuova?.replaces).toBe(sent.id);
    expect(nuova?.nomeFile).not.toBe(inv.rows[0].nome_file);
    const counterAfter = await pool.query("select ultimo from invoice_counters where tenant_id = $1 and anno > 0 order by anno desc limit 1", [tenantId]);
    expect(counterAfter.rows[0]?.ultimo).toBe(counterBefore.rows[0]?.ultimo);

    // Una fattura non scartata non si può sostituire.
    const again = await createAndSendInvoice({ role: "admin" }, { ...base, tenantId }, { db: pool, channel: { environment: "demo", endpoint: "" }, replacesInvoiceId: res.id });
    expect("errors" in again).toBe(true);
  });
});
