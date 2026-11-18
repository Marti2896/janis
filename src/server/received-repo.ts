import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import type pg from "pg";
import { parseFatturaRicevuta } from "../sdi/fatturapa/parse.ts";
import { verifyP7m } from "../sdi/sign/cades.ts";
import { logEvent } from "./audit.ts";
import { SoapFaultError } from "./notifications.ts";
import { getPool } from "./pool.ts";
import { ValidationError, effectiveTenant, requireAdmin } from "./scope.ts";
import type { Scope } from "./scope.ts";

/** Fatture ricevute (passive): file originale conservato byte per byte, instradamento per P.IVA o CF (ADR 0006). */

export type ReceivedKind = "xml" | "p7m";

export interface ReceivedMeta {
  cedenteDenominazione: string | null;
  cedentePiva: string | null;
  cedenteCf: string | null;
  cessionarioPiva: string | null;
  cessionarioCf: string | null;
  numero: string | null;
  data: string | null;
  importoCents: number | null;
}

const xmlParser = new XMLParser({ removeNSPrefix: true, parseTagValue: false, trimValues: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type XmlNode = Record<string, any>;

const s = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : null);

export function detectKind(fileName: string, bytes: Buffer): ReceivedKind {
  return /\.p7m$/i.test(fileName) || bytes[0] === 0x30 ? "p7m" : "xml";
}

function anagrafica(a: XmlNode | undefined): string | null {
  if (!a) return null;
  return s(a.Denominazione) ?? ([s(a.Nome), s(a.Cognome)].filter(Boolean).join(" ") || null);
}

function cents(v: unknown): number | null {
  const t = s(v);
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Estrae XML (anche da P7M, verificando la firma) e metadati principali. Lancia SoapFaultError se illeggibile. */
export function extractReceivedMeta(fileName: string, bytes: Buffer): { kind: ReceivedKind; xml: string; meta: ReceivedMeta } {
  const kind = detectKind(fileName, bytes);
  let xml: string;
  if (kind === "p7m") {
    try {
      xml = verifyP7m(bytes).xml.toString("utf8");
    } catch {
      throw new SoapFaultError("File P7M non valido: firma CAdES-BES non verificabile", "RiceviFatture");
    }
  } else {
    xml = bytes.toString("utf8");
  }
  let root: XmlNode;
  try {
    root = xmlParser.parse(xml) as XmlNode;
  } catch {
    throw new SoapFaultError("Fattura XML malformata", "RiceviFatture");
  }
  const fe = root.FatturaElettronica as XmlNode | undefined;
  if (!fe) throw new SoapFaultError("Il file non e una FatturaPA", "RiceviFatture");
  const head = fe.FatturaElettronicaHeader ?? {};
  const body = Array.isArray(fe.FatturaElettronicaBody) ? fe.FatturaElettronicaBody[0] : fe.FatturaElettronicaBody;
  const ced = head.CedentePrestatore?.DatiAnagrafici ?? {};
  const ces = head.CessionarioCommittente?.DatiAnagrafici ?? {};
  const doc = body?.DatiGenerali?.DatiGeneraliDocumento ?? {};
  return {
    kind,
    xml,
    meta: {
      cedenteDenominazione: anagrafica(ced.Anagrafica),
      cedentePiva: s(ced.IdFiscaleIVA?.IdCodice),
      cedenteCf: s(ced.CodiceFiscale),
      cessionarioPiva: s(ces.IdFiscaleIVA?.IdCodice),
      cessionarioCf: s(ces.CodiceFiscale),
      numero: s(doc.Numero),
      data: /^\d{4}-\d{2}-\d{2}/.test(s(doc.Data) ?? "") ? s(doc.Data)!.slice(0, 10) : null,
      importoCents: cents(doc.ImportoTotaleDocumento),
    },
  };
}

/** Tenant destinatario: prima la partita IVA del cessionario, poi il codice fiscale. Nessuna corrispondenza = null. */
export async function matchTenant(db: Pick<pg.Pool, "query">, meta: Pick<ReceivedMeta, "cessionarioPiva" | "cessionarioCf">): Promise<string | null> {
  if (meta.cessionarioPiva) {
    const r = await db.query("select id from tenants where partita_iva = $1", [meta.cessionarioPiva]);
    if (r.rows[0]) return r.rows[0].id as string;
  }
  if (meta.cessionarioCf) {
    const r = await db.query("select id from tenants where upper(codice_fiscale) = upper($1) or partita_iva = $1 limit 1", [meta.cessionarioCf]);
    if (r.rows[0]) return r.rows[0].id as string;
  }
  return null;
}

export type StoreReceivedResult = { result: "stored" | "duplicate"; id: string; tenantId: string | null };

export interface ReceivedSummary {
  cessionarioDenominazione: string | null;
  documenti: number;
  importoTotaleCents: number | null;
  numeri: string | null;
}

/** Riepilogo del lotto (tutti i documenti del file). Null se il file non e leggibile. */
export function summarizeReceived(fileName: string, bytes: Buffer): ReceivedSummary | null {
  try {
    const f = parseFatturaRicevuta(bytes, fileName);
    const tot = f.documenti.reduce<number | null>((a, d) => (d.totaleCents == null ? a : (a ?? 0) + d.totaleCents), null);
    return {
      cessionarioDenominazione: f.cliente.denominazione,
      documenti: f.documenti.length,
      importoTotaleCents: tot,
      numeri: f.documenti.map((d) => d.numero).filter(Boolean).join("|") || null,
    };
  } catch {
    return null;
  }
}

/** Completa il riepilogo delle righe ricevute prima dell'introduzione delle colonne (migliore sforzo, poche righe per volta). */
async function backfillSummary(db: Pick<pg.Pool, "query">): Promise<void> {
  try {
    const r = await db.query(
      "select id, file_name, original_bytes from received_invoices where documenti_count is null order by received_at desc limit 50",
    );
    for (const x of r.rows) {
      const sm = summarizeReceived(x.file_name as string, x.original_bytes as Buffer);
      await db.query(
        "update received_invoices set cessionario_denominazione = $2, documenti_count = $3, importo_totale_cents = $4, numeri = $5 where id = $1",
        [x.id, sm?.cessionarioDenominazione ?? null, sm?.documenti ?? 1, sm?.importoTotaleCents ?? null, sm?.numeri ?? null],
      );
    }
  } catch {
    /* il riepilogo e accessorio: l'elenco funziona anche senza */
  }
}

/** Salva la fattura passiva con file originale e hash. Idempotente per IdentificativoSdI. */
export async function storeReceivedInvoice(
  pool: pg.Pool,
  input: { sdiIdentifier: string; fileName: string; bytes: Buffer },
): Promise<StoreReceivedResult> {
  const { kind, meta } = extractReceivedMeta(input.fileName, input.bytes);
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const summary = summarizeReceived(input.fileName, input.bytes);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const tenantId = await matchTenant(client, meta);
    const ins = await client.query(
      `insert into received_invoices
         (tenant_id, sdi_identifier, file_name, file_kind, original_bytes, sha256, cedente_denominazione, cedente_piva,
          cedente_cf, cessionario_piva, cessionario_cf, numero, data, importo_cents, stato,
          cessionario_denominazione, documenti_count, importo_totale_cents, numeri)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       on conflict (sdi_identifier) do nothing returning id`,
      [
        tenantId,
        input.sdiIdentifier,
        input.fileName,
        kind,
        input.bytes,
        sha256,
        meta.cedenteDenominazione,
        meta.cedentePiva,
        meta.cedenteCf,
        meta.cessionarioPiva,
        meta.cessionarioCf,
        meta.numero,
        meta.data,
        meta.importoCents,
        tenantId ? "received" : "unassigned",
        summary?.cessionarioDenominazione ?? null,
        summary?.documenti ?? 1,
        summary?.importoTotaleCents ?? null,
        summary?.numeri ?? null,
      ],
    );
    if (ins.rowCount === 0) {
      const ex = await client.query("select id, tenant_id from received_invoices where sdi_identifier = $1", [input.sdiIdentifier]);
      await client.query("rollback");
      return { result: "duplicate", id: ex.rows[0].id as string, tenantId: (ex.rows[0].tenant_id as string | null) ?? null };
    }
    const id = ins.rows[0].id as string;
    await client.query(
      `insert into received_invoice_history (received_invoice_id, tenant_id, event, detail) values ($1, $2, $3, $4)`,
      [id, tenantId, tenantId ? "received" : "received_unassigned", JSON.stringify({ sha256, fileName: input.fileName, kind })],
    );
    await logEvent(
      {
        tenantId,
        event: "received_invoice.stored",
        entity: "received_invoice",
        entityId: id,
        detail: { sdiIdentifier: input.sdiIdentifier, assigned: tenantId !== null },
      },
      client,
    );
    await client.query("commit");
    return { result: "stored", id, tenantId };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export type ReceivedRow = {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  sdiIdentifier: string;
  fileName: string;
  fileKind: ReceivedKind;
  sha256: string;
  cedenteDenominazione: string | null;
  cedentePiva: string | null;
  cedenteCf: string | null;
  cessionarioPiva: string | null;
  cessionarioCf: string | null;
  numero: string | null;
  data: string | null;
  importoCents: number | null;
  /** received = assegnata a un account, unassigned = in attesa di assegnazione (solo admin). */
  stato: "received" | "unassigned";
  receivedAt: Date;
  /** Destinatario scritto nel file (denominazione). */
  cessionarioDenominazione: string | null;
  /** Numero di documenti nel file (lotto). */
  documenti: number;
  /** Totale di tutti i documenti del file. */
  importoTotaleCents: number | null;
  /** Numeri di tutti i documenti del file. */
  numeri: string[];
};

export type ReceivedDetail = ReceivedRow & {
  /** File originale, byte per byte. */
  bytes: Buffer;
  contentType: string;
  /** Notifiche SdI registrate sulla fattura (es. SE con esito EN00 o EN01). */
  notifications: { type: string; esito: string | null; descrizione: string | null; at: Date }[];
  history: { event: string; at: Date; detail: Record<string, unknown> }[];
};

const COLS = `r.id, r.tenant_id, t.denominazione as tenant_name, r.sdi_identifier, r.file_name, r.file_kind, r.sha256,
  r.cedente_denominazione, r.cedente_piva, r.cedente_cf, r.cessionario_piva, r.cessionario_cf, r.numero,
  to_char(r.data, 'YYYY-MM-DD') as data, r.importo_cents, r.stato, r.received_at,
  r.cessionario_denominazione, r.documenti_count, r.importo_totale_cents, r.numeri`;

const toRow = (x: Record<string, unknown>): ReceivedRow => ({
  id: x.id as string,
  tenantId: (x.tenant_id as string | null) ?? null,
  tenantName: (x.tenant_name as string | null) ?? null,
  sdiIdentifier: x.sdi_identifier as string,
  fileName: x.file_name as string,
  fileKind: x.file_kind as ReceivedKind,
  sha256: (x.sha256 as string).trim(),
  cedenteDenominazione: (x.cedente_denominazione as string | null) ?? null,
  cedentePiva: (x.cedente_piva as string | null) ?? null,
  cedenteCf: (x.cedente_cf as string | null) ?? null,
  cessionarioPiva: (x.cessionario_piva as string | null) ?? null,
  cessionarioCf: (x.cessionario_cf as string | null) ?? null,
  numero: (x.numero as string | null) ?? null,
  data: (x.data as string | null) ?? null,
  importoCents: x.importo_cents == null ? null : Number(x.importo_cents),
  stato: x.stato as "received" | "unassigned",
  receivedAt: x.received_at as Date,
  cessionarioDenominazione: (x.cessionario_denominazione as string | null) ?? null,
  documenti: x.documenti_count == null ? 1 : Number(x.documenti_count),
  importoTotaleCents: x.importo_totale_cents == null ? (x.importo_cents == null ? null : Number(x.importo_cents)) : Number(x.importo_totale_cents),
  numeri: typeof x.numeri === "string" && x.numeri ? (x.numeri as string).split("|") : x.numero ? [x.numero as string] : [],
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReceivedFilter = { tenantId?: string | null; limit?: number; offset?: number };

/** Fatture ricevute e assegnate. Il cliente vede solo le proprie; l'admin tutte le assegnate (filtro account opzionale). */
export async function listReceivedRows(scope: Scope, filter: ReceivedFilter = {}, db: Pick<pg.Pool, "query"> = getPool()): Promise<ReceivedRow[]> {
  const tenant = effectiveTenant(scope, filter.tenantId);
  await backfillSummary(db);
  const params: unknown[] = [];
  const where = ["r.tenant_id is not null"];
  if (tenant) {
    params.push(tenant);
    where.push(`r.tenant_id = $${params.length}`);
  }
  params.push(Math.min(filter.limit ?? 100, 500), filter.offset ?? 0);
  const r = await db.query(
    `select ${COLS} from received_invoices r left join tenants t on t.id = r.tenant_id
      where ${where.join(" and ")} order by r.received_at desc, r.id limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return r.rows.map(toRow);
}

/** Dettaglio con file originale. Fattura di un altro tenant (o non assegnata per un cliente): null. */
export async function getReceivedDetail(scope: Scope, id: string, db: Pick<pg.Pool, "query"> = getPool()): Promise<ReceivedDetail | null> {
  if (!UUID.test(id)) return null;
  const tenant = effectiveTenant(scope, null);
  const r = await db.query(
    `select ${COLS}, r.original_bytes from received_invoices r left join tenants t on t.id = r.tenant_id
      where r.id = $1 ${tenant ? "and r.tenant_id = $2" : ""}`,
    tenant ? [id, tenant] : [id],
  );
  const x = r.rows[0];
  if (!x) return null;
  const h = await db.query(
    "select event, recorded_at, detail from received_invoice_history where received_invoice_id = $1 order by recorded_at, id",
    [id],
  );
  const n = await db.query(
    `select type, esito, descrizione, received_at from sdi_notifications
      where received_invoice_id = $1 ${tenant ? "and tenant_id = $2" : ""} order by received_at, id`,
    tenant ? [id, tenant] : [id],
  );
  const row = toRow(x);
  return {
    ...row,
    notifications: n.rows.map((e) => ({
      type: e.type as string,
      esito: (e.esito as string | null) ?? null,
      descrizione: (e.descrizione as string | null) ?? null,
      at: e.received_at as Date,
    })),
    bytes: x.original_bytes as Buffer,
    contentType: row.fileKind === "p7m" ? "application/pkcs7-mime" : "application/xml",
    history: h.rows.map((e) => ({ event: e.event as string, at: e.recorded_at as Date, detail: e.detail as Record<string, unknown> })),
  };
}

/** Fatture passive senza account: solo admin. */
export async function listUnassignedRows(scope: Scope, db: Pick<pg.Pool, "query"> = getPool()): Promise<ReceivedRow[]> {
  requireAdmin(scope);
  await backfillSummary(db);
  const r = await db.query(
    `select ${COLS} from received_invoices r left join tenants t on t.id = r.tenant_id
      where r.tenant_id is null order by r.received_at desc, r.id limit 500`,
  );
  return r.rows.map(toRow);
}

/** Assegna una fattura non assegnata a un account. Solo admin; ritorna false se non esiste o e gia assegnata. */
export async function assignReceivedRow(
  scope: Scope,
  id: string,
  tenantId: string,
  actorUserId: string | null = null,
  db: pg.Pool = getPool(),
): Promise<boolean> {
  requireAdmin(scope);
  if (!UUID.test(id)) return false;
  if (!UUID.test(tenantId)) throw new ValidationError("Account non valido.", "tenantId");
  const client = await db.connect();
  try {
    await client.query("begin");
    const t = await client.query("select 1 from tenants where id = $1", [tenantId]);
    if (!t.rowCount) throw new ValidationError("Account non trovato.", "tenantId");
    const u = await client.query(
      "update received_invoices set tenant_id = $2, stato = 'received' where id = $1 and tenant_id is null returning sdi_identifier",
      [id, tenantId],
    );
    if (!u.rowCount) {
      await client.query("rollback");
      return false;
    }
    await client.query(
      "insert into received_invoice_history (received_invoice_id, tenant_id, event, detail) values ($1, $2, 'assigned', $3)",
      [id, tenantId, JSON.stringify({ by: actorUserId })],
    );
    await logEvent(
      { tenantId, actorUserId, event: "received_invoice.assigned", entity: "received_invoice", entityId: id, detail: { sdiIdentifier: u.rows[0].sdi_identifier } },
      client,
    );
    await client.query("commit");
    return true;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
