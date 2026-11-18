import { randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import { logEvent } from "./audit.ts";
import { createAndSendInvoice } from "./invoice-service.ts";
import { processNotification } from "./notifications.ts";

/**
 * Solo sviluppo e QA: crea una fattura di prova già inviata o consegnata, passando dal flusso reale
 * (numero dal contatore del tenant, file firmato con il certificato di test, storico e audit coerenti).
 */

export type QaTenant = "alfa" | "beta";
export type QaStato = "sent" | "delivered";

export interface QaInvoiceResult {
  id: string;
  numero: string;
  nome_file: string;
  sdi_identifier: string;
  stato: string;
}

export async function createQaInvoice(db: pg.Pool, opts: { tenant: QaTenant; stato: QaStato; sdiEnv?: string }): Promise<QaInvoiceResult> {
  if ((opts.sdiEnv ?? process.env.SDI_ENV) === "production") throw new Error("Rifiuto di girare con SDI_ENV=production");
  if (opts.tenant !== "alfa" && opts.tenant !== "beta") throw new Error("--tenant deve essere alfa o beta");
  if (opts.stato !== "sent" && opts.stato !== "delivered") throw new Error("--stato deve essere sent o delivered");

  const t = await db.query("select id, denominazione from tenants where lower(denominazione) like $1 order by created_at limit 1", [`${opts.tenant}%`]);
  const tenant = t.rows[0] as { id: string; denominazione: string } | undefined;
  if (!tenant) throw new Error(`Tenant ${opts.tenant} non trovato: esegui prima npm run db:seed`);

  const suffix = randomBytes(3).toString("hex");
  const res = await createAndSendInvoice(
    { role: "admin" },
    {
      tenantId: tenant.id,
      cessionarioDenominazione: `Cliente prova ${suffix}`,
      cessionarioPartitaIva: "12345678903",
      destinazione: { tipo: "codice", valore: "0000000" },
      tipoDocumento: "TD01",
      data: new Date().toISOString().slice(0, 10),
      righe: [{ descrizione: "Prestazione di prova", quantita: 1, prezzoUnitario: 100, aliquota: 22 }],
    },
    { db, source: "web", channel: { environment: "demo", endpoint: "" } },
  );
  if ("errors" in res) throw new Error(`Creazione non riuscita: ${JSON.stringify(res.errors)}`);

  const sdi = `99${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
  const inv = await db.query("select nome_file, numero, status from invoices where id = $1", [res.id]);
  const nomeFile = inv.rows[0].nome_file as string;

  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query("update invoices set status = 'sent', sdi_identifier = $2, updated_at = now() where id = $1 and status = 'signed'", [res.id, sdi]);
    await client.query(
      `insert into invoice_status_history (invoice_id, tenant_id, from_status, to_status, causale, source) values ($1, $2, 'signed', 'sent', $3, 'client')`,
      [res.id, tenant.id, "Fattura inviata al Sistema di Interscambio (prova di sviluppo)"],
    );
    await logEvent({ tenantId: tenant.id, event: "invoice.sent", entity: "invoice", entityId: res.id, detail: { sdiIdentifier: sdi, qa: true } }, client);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  if (opts.stato === "delivered") {
    const now = new Date().toISOString();
    const r = await processNotification(db, {
      type: "RC",
      sdiIdentifier: sdi,
      nomeFile,
      messageId: randomUUID(),
      fileSha256: randomBytes(32).toString("hex"),
      sdiTimestamp: now,
      dataConsegna: now,
      destinatario: "0000000",
      errori: null,
      esito: null,
      descrizione: null,
    });
    if (r !== "applied") throw new Error(`Notifica RC non applicata: ${r}`);
  }

  const out = await db.query("select numero, status from invoices where id = $1", [res.id]);
  return { id: res.id, numero: out.rows[0].numero as string, nome_file: nomeFile, sdi_identifier: sdi, stato: out.rows[0].status as string };
}
