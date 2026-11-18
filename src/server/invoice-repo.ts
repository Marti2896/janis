import type pg from "pg";
import type { InvoiceRepo, InvoiceStatus } from "../sdi/client/repo.ts";
// Il file di firma e il numero progressivo sono gestiti da invoice-service.ts: qui solo le transizioni di stato.

const ALLOWED: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ["signed"],
  signed: ["sending"],
  sending: ["sent", "send_error", "send_unknown"],
  sent: ["delivered", "rejected", "not_delivered"],
  send_unknown: ["delivered", "rejected", "not_delivered"],
  send_error: [],
  // NE e DT solo dopo la consegna (RC); MC solo dopo l'invio. Nessuna regressione di stato.
  delivered: ["accepted", "refused", "terms_expired"],
  rejected: [],
  not_delivered: [],
  accepted: [],
  refused: [],
  terms_expired: [],
};

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function createInvoiceRepo(pool: pg.Pool): InvoiceRepo {
  return {
    async findByNomeFile(nomeFile) {
      const r = await pool.query("select id, status from invoices where nome_file = $1", [nomeFile]);
      return r.rows;
    },

    async getInvoice(id) {
      const r = await pool.query("select id, status, tenant_id from invoices where id = $1", [id]);
      if (r.rowCount === 0) return null;
      return { id: r.rows[0].id, status: r.rows[0].status, tenantId: r.rows[0].tenant_id };
    },

    async transition({ invoiceId, to, reason, payload }) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const cur = await client.query(
          "select status, tenant_id from invoices where id = $1 for update",
          [invoiceId],
        );
        if (cur.rowCount === 0) throw new Error(`Fattura non trovata: ${invoiceId}`);
        const from = cur.rows[0].status as InvoiceStatus;
        const tenantId = cur.rows[0].tenant_id as string;
        if (!canTransition(from, to)) throw new Error(`Transizione non consentita: da ${from} a ${to}`);
        const rawId = payload?.sdiIdentifier ?? payload?.identificativoSdi;
        const sdiId = typeof rawId === "string" ? rawId : null;
        await client.query(
          "update invoices set status = $2, sdi_identifier = coalesce($3, sdi_identifier), updated_at = now() where id = $1",
          [invoiceId, to, sdiId],
        );
        await client.query(
          `insert into invoice_status_history (invoice_id, tenant_id, from_status, to_status, causale, source)
           values ($1, $2, $3, $4, $5, 'client')`,
          [invoiceId, tenantId, from, to, reason],
        );
        await client.query(
          `insert into audit_log (tenant_id, event, entity, entity_id, detail)
           values ($1, 'invoice.transition', 'invoice', $2, $3)`,
          [tenantId, invoiceId, JSON.stringify({ from, to, causale: reason })],
        );
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw err;
      } finally {
        client.release();
      }
    },

    async createRepair({ replacesInvoiceId, nomeFile }) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const cur = await client.query(
          "select tenant_id, numero, data, status from invoices where id = $1 for update",
          [replacesInvoiceId],
        );
        if (cur.rowCount === 0) throw new Error(`Fattura non trovata: ${replacesInvoiceId}`);
        const orig = cur.rows[0];
        if (orig.status !== "rejected" && orig.status !== "send_error") {
          throw new Error(`Riparazione non consentita: la fattura è in stato ${orig.status}`);
        }
        const ins = await client.query(
          `insert into invoices (tenant_id, numero, data, nome_file, replaces_invoice_id, status)
           values ($1, $2, $3, $4, $5, 'draft') returning id`,
          [orig.tenant_id, orig.numero, orig.data, nomeFile, replacesInvoiceId],
        );
        const id = ins.rows[0].id as string;
        await client.query(
          `insert into invoice_status_history (invoice_id, tenant_id, from_status, to_status, causale, source)
           values ($1, $2, null, 'draft', $3, 'client')`,
          [id, orig.tenant_id, `Riparazione della fattura ${replacesInvoiceId}`],
        );
        await client.query(
          `insert into audit_log (tenant_id, event, entity, entity_id, detail)
           values ($1, 'invoice.repair_created', 'invoice', $2, $3)`,
          [orig.tenant_id, id, JSON.stringify({ replacesInvoiceId })],
        );
        await client.query("commit");
        return { id };
      } catch (err) {
        await client.query("rollback");
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
