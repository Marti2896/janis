import { createHash } from "node:crypto";
import type pg from "pg";
import { buildFatturaXml } from "../sdi/fatturapa/build.ts";
import type { FatturaModel, RigaFattura } from "../sdi/fatturapa/types.ts";
import { emitInvoice } from "../sdi/client/emit.ts";
import { signCadesBes, p7mName } from "../sdi/sign/cades.ts";
import { generateTestCert } from "../sdi/sign/test-cert.ts";
import type { TestCert } from "../sdi/sign/test-cert.ts";
import { logEvent } from "./audit.ts";
import { getActiveCertificate } from "./certificates.ts";
import { getChannelSettings } from "./channel-settings.ts";
import { createInvoiceRepo } from "./invoice-repo.ts";
import { getPool } from "./pool.ts";
import { assignReceivedRow, getReceivedDetail, listReceivedRows, listUnassignedRows } from "./received-repo.ts";
import type { ReceivedDetail, ReceivedFilter, ReceivedRow } from "./received-repo.ts";
import { effectiveTenant } from "./scope.ts";
import type { Scope } from "./scope.ts";

export type { ReceivedDetail, ReceivedRow } from "./received-repo.ts";

/** Servizio fatture: unico punto d'accesso a fatture emesse e ricevute per pagine web e API v1. L'isolamento tenant sta qui (ADR 0006). */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const QUEUED_STATUSES = ["draft", "signed", "sending", "send_unknown"] as const;

export type InvoiceRow = {
  id: string;
  tenantId: string;
  tenantName: string | null;
  numero: string;
  /** YYYY-MM-DD */
  data: string;
  nomeFile: string;
  status: string;
  sdiIdentifier: string | null;
  cessionarioDenominazione: string | null;
  cessionarioPiva: string | null;
  importoCents: number | null;
  tipoDocumento: string | null;
  formato: string | null;
  ambiente: string | null;
  destinazione: string | null;
  hasFile: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type InvoiceEvent = {
  at: Date;
  /** status = cambio di stato; notification = notifica SdI. */
  kind: "status" | "notification";
  /** Notifiche: RC, NS, MC, NE, DT, SE. Stati: "status". */
  type: string;
  from: string | null;
  to: string | null;
  description: string;
  esito: string | null;
  errori: { codice: string; descrizione: string }[] | null;
  source: string | null;
};

export type InvoiceDetail = InvoiceRow & {
  cedenteDenominazione: string | null;
  cedentePiva: string | null;
  events: InvoiceEvent[];
};

const COLS = `i.id, i.tenant_id, t.denominazione as tenant_name, i.numero, to_char(i.data, 'YYYY-MM-DD') as data, i.nome_file,
  i.status, i.sdi_identifier, i.cessionario_denominazione, i.cessionario_piva, i.importo_cents, i.tipo_documento, i.formato,
  i.ambiente, i.destinazione, (i.p7m is not null) as has_file, i.created_at, i.updated_at`;

const toRow = (x: Record<string, unknown>): InvoiceRow => ({
  id: x.id as string,
  tenantId: x.tenant_id as string,
  tenantName: (x.tenant_name as string | null) ?? null,
  numero: x.numero as string,
  data: x.data as string,
  nomeFile: x.nome_file as string,
  status: x.status as string,
  sdiIdentifier: (x.sdi_identifier as string | null) ?? null,
  cessionarioDenominazione: (x.cessionario_denominazione as string | null) ?? null,
  cessionarioPiva: (x.cessionario_piva as string | null) ?? null,
  importoCents: x.importo_cents == null ? null : Number(x.importo_cents),
  tipoDocumento: (x.tipo_documento as string | null) ?? null,
  formato: (x.formato as string | null) ?? null,
  ambiente: (x.ambiente as string | null) ?? null,
  destinazione: (x.destinazione as string | null) ?? null,
  hasFile: Boolean(x.has_file),
  createdAt: x.created_at as Date,
  updatedAt: x.updated_at as Date,
});

export type ListInvoicesFilter = {
  /** Stato esatto, oppure "queued" per il gruppo In coda (draft, signed, sending, send_unknown). */
  stato?: string | null;
  tenantId?: string | null;
  limit?: number;
  offset?: number;
};

type Opts = { db?: pg.Pool };

/** Il cliente vede solo le proprie fatture, qualunque filtro passi; l'admin tutte (filtro account opzionale). */
export async function listInvoices(scope: Scope, filter: ListInvoicesFilter = {}, opts: Opts = {}): Promise<InvoiceRow[]> {
  const db = opts.db ?? getPool();
  const tenant = effectiveTenant(scope, filter.tenantId);
  if (tenant && !UUID.test(tenant)) return [];
  const params: unknown[] = [];
  const where: string[] = [];
  if (tenant) {
    params.push(tenant);
    where.push(`i.tenant_id = $${params.length}`);
  }
  if (filter.stato === "queued") {
    params.push([...QUEUED_STATUSES]);
    where.push(`i.status = any($${params.length})`);
  } else if (filter.stato) {
    params.push(filter.stato);
    where.push(`i.status = $${params.length}`);
  }
  params.push(Math.min(filter.limit ?? 100, 500), filter.offset ?? 0);
  const r = await db.query(
    `select ${COLS} from invoices i join tenants t on t.id = i.tenant_id
      ${where.length ? "where " + where.join(" and ") : ""}
      order by i.created_at desc, i.id limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return r.rows.map(toRow);
}

/** Dettaglio con eventi (stati e notifiche) in ordine cronologico. Fattura di un altro tenant: null (non trovata). */
export async function getInvoice(scope: Scope, id: string, opts: Opts = {}): Promise<InvoiceDetail | null> {
  const db = opts.db ?? getPool();
  if (!UUID.test(id)) return null;
  const tenant = effectiveTenant(scope, null);
  const r = await db.query(
    `select ${COLS}, t.partita_iva as cedente_piva, t.denominazione as cedente_denominazione
       from invoices i join tenants t on t.id = i.tenant_id
      where i.id = $1 ${tenant ? "and i.tenant_id = $2" : ""}`,
    tenant ? [id, tenant] : [id],
  );
  const x = r.rows[0];
  if (!x) return null;
  const [hist, notes] = await Promise.all([
    db.query(
      `select from_status, to_status, causale, source, coalesce(sdi_timestamp, recorded_at) as at, recorded_at
         from invoice_status_history where invoice_id = $1 and tenant_id = $2 order by recorded_at, id`,
      [id, x.tenant_id],
    ),
    db.query(
      `select type, esito, descrizione, errori, message_id, coalesce(sdi_timestamp, received_at) as at, received_at
         from sdi_notifications where invoice_id = $1 and tenant_id = $2 order by received_at, id`,
      [id, x.tenant_id],
    ),
  ]);
  const events: InvoiceEvent[] = [
    ...hist.rows.map(
      (h): InvoiceEvent => ({
        at: h.recorded_at as Date,
        kind: "status",
        type: "status",
        from: (h.from_status as string | null) ?? null,
        to: h.to_status as string,
        description: h.causale as string,
        esito: null,
        errori: null,
        source: h.source as string,
      }),
    ),
    ...notes.rows.map(
      (n): InvoiceEvent => ({
        at: n.received_at as Date,
        kind: "notification",
        type: n.type as string,
        from: null,
        to: null,
        description: (n.descrizione as string | null) ?? "",
        esito: (n.esito as string | null) ?? null,
        errori: (n.errori as { codice: string; descrizione: string }[] | null) ?? null,
        source: "sdi_notification",
      }),
    ),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  return { ...toRow(x), cedenteDenominazione: x.cedente_denominazione as string, cedentePiva: (x.cedente_piva as string).trim(), events };
}

/** File firmato inviato (.xml.p7m). Fattura di un altro tenant o non firmata: null. */
export async function getInvoiceFile(scope: Scope, id: string, opts: Opts = {}): Promise<{ fileName: string; bytes: Buffer } | null> {
  const db = opts.db ?? getPool();
  if (!UUID.test(id)) return null;
  const tenant = effectiveTenant(scope, null);
  const r = await db.query(
    `select nome_file, p7m from invoices where id = $1 and p7m is not null ${tenant ? "and tenant_id = $2" : ""}`,
    tenant ? [id, tenant] : [id],
  );
  const x = r.rows[0];
  return x ? { fileName: x.nome_file as string, bytes: x.p7m as Buffer } : null;
}

// ---------------------------------------------------------------- nuova fattura

export type NewInvoiceInput = {
  /** Solo admin: account per cui si emette. Il cliente e inchiodato al proprio. */
  tenantId?: string | null;
  cessionarioDenominazione: string;
  cessionarioPartitaIva: string;
  cessionarioCodiceFiscale?: string | null;
  destinazione: { tipo: "codice" | "pec"; valore: string };
  tipoDocumento: "TD01" | "TD04";
  formato?: "FPR12" | "FPA12";
  /** YYYY-MM-DD */
  data: string;
  righe: { descrizione: string; quantita: number; prezzoUnitario: number; aliquota: 22 | 10 | 4 | 0 }[];
  idempotencyKey?: string | null;
};

export type CreateInvoiceResult =
  | { id: string; status: string; queued?: boolean; warning?: string; replay?: boolean }
  | { errors: Record<string, string>; conflict?: boolean };

export type CreateOptions = {
  db?: pg.Pool;
  actorUserId?: string | null;
  source?: "web" | "api";
  fetch?: typeof fetch;
  /** Solo test: ambiente ed endpoint al posto di quelli salvati in channel_settings. */
  channel?: { environment: "demo" | "production"; endpoint: string };
};

const ALIQUOTE = [22, 10, 4, 0];
const SEDE_DEFAULT = { indirizzo: "Non indicato", cap: "00000", comune: "Non indicato", nazione: "IT" };

function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Validazione lato server con messaggi chiari per campo. Le chiavi sono i nomi dei campi del form (righe.0.prezzoUnitario ...). */
export function validateNewInvoice(input: NewInvoiceInput): Record<string, string> {
  const e: Record<string, string> = {};
  if (!input.cessionarioDenominazione?.trim()) e.cessionarioDenominazione = "La denominazione del cessionario e obbligatoria";
  if (!/^\d{11}$/.test((input.cessionarioPartitaIva ?? "").trim())) e.cessionarioPartitaIva = "La partita IVA deve avere 11 cifre";
  const cf = (input.cessionarioCodiceFiscale ?? "").trim();
  if (cf && !/^([A-Za-z0-9]{16}|\d{11})$/.test(cf)) e.cessionarioCodiceFiscale = "Il codice fiscale deve avere 16 caratteri (o 11 cifre)";
  if (input.tipoDocumento !== "TD01" && input.tipoDocumento !== "TD04") e.tipoDocumento = "Tipo documento non valido (TD01 o TD04)";
  const formato = input.formato ?? "FPR12";
  if (formato !== "FPR12" && formato !== "FPA12") e.formato = "Formato non valido (FPR12 o FPA12)";
  const d = input.destinazione;
  const valore = (d?.valore ?? "").trim();
  if (d?.tipo === "codice") {
    const len = formato === "FPA12" ? 6 : 7;
    if (!new RegExp(`^[A-Za-z0-9]{${len}}$`).test(valore)) e.destinazione = `Il codice destinatario deve avere ${len} caratteri alfanumerici`;
  } else if (d?.tipo === "pec") {
    if (formato === "FPA12") e.destinazione = "Con FPA12 serve il codice destinatario (codice IPA), non la PEC";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valore)) e.destinazione = "Inserisci un indirizzo PEC valido";
  } else {
    e.destinazione = "Scegli codice destinatario oppure PEC";
  }
  if (!validDate(input.data ?? "")) e.data = "La data deve essere valida (AAAA-MM-GG)";
  if (!Array.isArray(input.righe) || input.righe.length === 0) {
    e.righe = "Aggiungi almeno una riga";
  } else {
    input.righe.forEach((r, i) => {
      const p = `righe.${i}`;
      if (!r.descrizione?.trim()) e[`${p}.descrizione`] = "La descrizione e obbligatoria";
      if (!Number.isFinite(r.quantita) || r.quantita <= 0 || Math.abs(Math.round(r.quantita * 1000) - r.quantita * 1000) > 1e-6)
        e[`${p}.quantita`] = "La quantita deve essere maggiore di zero (massimo 3 decimali)";
      if (!Number.isFinite(r.prezzoUnitario) || r.prezzoUnitario < 0 || Math.abs(Math.round(r.prezzoUnitario * 100) - r.prezzoUnitario * 100) > 1e-6)
        e[`${p}.prezzoUnitario`] = "Il prezzo deve essere zero o piu, con al massimo 2 decimali";
      if (!ALIQUOTE.includes(r.aliquota)) e[`${p}.aliquota`] = "Aliquota non valida (22, 10, 4 o 0)";
    });
  }
  return e;
}

function toModel(
  input: NewInvoiceInput,
  tenant: { partita_iva: string; codice_fiscale: string | null; denominazione: string },
  numero: string,
  progressivo: string,
): FatturaModel {
  const formato = input.formato ?? "FPR12";
  const righe: RigaFattura[] = input.righe.map((r) => ({
    descrizione: r.descrizione.trim(),
    quantitaMilli: Math.round(r.quantita * 1000),
    prezzoUnitarioCents: Math.round(r.prezzoUnitario * 100),
    aliquotaBp: r.aliquota * 100,
    ...(r.aliquota === 0 ? { natura: "N2.2", riferimentoNormativo: "Operazione non soggetta a IVA" } : {}),
  }));
  const valore = input.destinazione.valore.trim();
  const cf = (input.cessionarioCodiceFiscale ?? "").trim();
  return {
    cedente: {
      idPaese: "IT",
      partitaIva: tenant.partita_iva.trim(),
      ...(tenant.codice_fiscale ? { codiceFiscale: tenant.codice_fiscale } : {}),
      denominazione: tenant.denominazione,
      regimeFiscale: "RF01",
      sede: SEDE_DEFAULT,
    },
    cessionario: {
      idPaese: "IT",
      partitaIva: input.cessionarioPartitaIva.trim(),
      ...(cf ? { codiceFiscale: cf.toUpperCase() } : {}),
      denominazione: input.cessionarioDenominazione.trim(),
      sede: SEDE_DEFAULT,
    },
    codiceDestinatario: input.destinazione.tipo === "codice" ? valore.toUpperCase() : "0000000",
    ...(input.destinazione.tipo === "pec" ? { pecDestinatario: valore } : {}),
    formato,
    progressivoInvio: progressivo,
    tipoDocumento: input.tipoDocumento,
    data: input.data,
    numero,
    righe,
  };
}

let testCert: { cert: TestCert; at: number } | null = null;

/** Certificato attivo per l'ambiente; in demo, se manca, certificato di test generato a runtime (nessun certificato qualificato in sviluppo). */
async function signingCert(environment: "demo" | "production", db: pg.Pool): Promise<{ certPem: string; keyPem: string } | null> {
  const real = await getActiveCertificate(environment, db);
  if (real) return real;
  if (environment === "production") return null;
  if (!testCert || Date.now() - testCert.at > 12 * 3600 * 1000) testCert = { cert: generateTestCert("Interscambio test"), at: Date.now() };
  return testCert.cert;
}

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

function retryFromEnv() {
  const n = (k: string, d: number) => {
    const v = Number(process.env[k]);
    return Number.isInteger(v) && v >= 1 ? v : d;
  };
  return { maxAttempts: n("SDI_RETRY_MAX_ATTEMPTS", 3), baseMs: n("SDI_RETRY_BASE_MS", 1000), capMs: n("SDI_RETRY_CAP_MS", 8000) };
}

const normalizedBody = (i: NewInvoiceInput) =>
  sha(
    JSON.stringify({
      c: [i.cessionarioDenominazione, i.cessionarioPartitaIva, i.cessionarioCodiceFiscale ?? "", i.destinazione, i.tipoDocumento, i.formato ?? "FPR12", i.data, i.righe],
    }),
  );

/**
 * Genera l'XML FatturaPA, lo valida (XSD), lo firma CAdES-BES e lo invia a SdI con il client esistente (idempotente per NomeFile).
 * Numero progressivo per tenant e anno, assegnato in transazione con lock sul contatore: niente buchi ne duplicati.
 * Con endpoint dell'ambiente vuoto la fattura resta in coda (firmata) e ritorna un avviso.
 */
export async function createAndSendInvoice(scope: Scope, input: NewInvoiceInput, opts: CreateOptions = {}): Promise<CreateInvoiceResult> {
  const db = opts.db ?? getPool();
  const errors = validateNewInvoice(input);
  const tenantId = effectiveTenant(scope, input.tenantId);
  if (!tenantId) errors.tenantId = "Scegli l'account per cui emettere la fattura";
  else if (!UUID.test(tenantId)) errors.tenantId = "Account non valido";
  if (Object.keys(errors).length) return { errors };

  const t = await db.query("select id, partita_iva, codice_fiscale, denominazione from tenants where id = $1", [tenantId]);
  const tenant = t.rows[0] as { id: string; partita_iva: string; codice_fiscale: string | null; denominazione: string } | undefined;
  if (!tenant) return { errors: { tenantId: "Account non trovato" } };

  const idemKey = input.idempotencyKey?.trim() || null;
  const bodyHash = normalizedBody(input);
  const replay = async (): Promise<CreateInvoiceResult | null> => {
    if (!idemKey) return null;
    const r = await db.query(
      "select body_hash, invoice_id, created_at > now() - interval '24 hours' as fresh from api_idempotency where tenant_id = $1 and idem_key = $2",
      [tenant.id, idemKey],
    );
    const x = r.rows[0];
    if (!x) return null;
    if (!x.fresh) {
      await db.query("delete from api_idempotency where tenant_id = $1 and idem_key = $2", [tenant.id, idemKey]);
      return null;
    }
    if ((x.body_hash as string).trim() !== bodyHash) {
      return { errors: { idempotencyKey: "La stessa Idempotency-Key e gia stata usata con un corpo diverso" }, conflict: true };
    }
    if (!x.invoice_id) return { errors: { idempotencyKey: "Richiesta con questa chiave ancora in corso" }, conflict: true };
    const s = await db.query("select status from invoices where id = $1", [x.invoice_id]);
    const status = s.rows[0]?.status as string;
    return status === "signed"
      ? { id: x.invoice_id as string, status, queued: true, warning: "Fattura in coda: l'endpoint SdI dell'ambiente attivo non e configurato.", replay: true }
      : { id: x.invoice_id as string, status, replay: true };
  };
  const already = await replay();
  if (already) return already;

  const settings = opts.channel ?? (await getChannelSettings(db));
  const cert = await signingCert(settings.environment, db);
  if (!cert) return { errors: { _form: "Nessun certificato di firma valido per l'ambiente attivo" } };

  const anno = Number(input.data.slice(0, 4));
  const client = await db.connect();
  let invoiceId: string;
  let nomeFile: string;
  let p7m: Buffer;
  try {
    await client.query("begin");
    if (idemKey) {
      const ins = await client.query(
        "insert into api_idempotency (tenant_id, idem_key, body_hash) values ($1, $2, $3) on conflict do nothing returning idem_key",
        [tenant.id, idemKey, bodyHash],
      );
      if (!ins.rowCount) {
        await client.query("rollback");
        return (await replay()) ?? { errors: { idempotencyKey: "Richiesta con questa chiave ancora in corso" }, conflict: true };
      }
    }
    // Lock sui contatori del tenant: numero dell'anno (anno) e progressivo di invio (anno = 0).
    const bump = (a: number) =>
      client.query(
        `insert into invoice_counters (tenant_id, anno, ultimo) values ($1, $2, 1)
         on conflict (tenant_id, anno) do update set ultimo = invoice_counters.ultimo + 1 returning ultimo`,
        [tenant.id, a],
      );
    const numeroProg = (await bump(anno)).rows[0].ultimo as number;
    // Il NomeFile e unico: salta i progressivi di invio gia usati dal tenant (es. fatture importate).
    let invioProg = (await bump(0)).rows[0].ultimo as number;
    for (let i = 0; i < 1000; i++) {
      const taken = await client.query(
        "select 1 from invoices where tenant_id = $1 and nome_file like $2 limit 1",
        [tenant.id, `%\\_${invioProg.toString(36).toUpperCase().padStart(5, "0")}.xml.p7m`],
      );
      if (!taken.rowCount) break;
      invioProg = (await bump(0)).rows[0].ultimo as number;
    }
    const numero = `${numeroProg}/${anno}`;
    const progressivo = invioProg.toString(36).toUpperCase().padStart(5, "0");

    const built = await buildFatturaXml(toModel(input, tenant, numero, progressivo));
    if (!built.ok) {
      await client.query("rollback");
      const detail = built.errors.slice(0, 3).map((x) => `${x.path}: ${x.message}`).join("; ");
      return { errors: { _xsd: detail } };
    }
    p7m = await signCadesBes(built.xml, cert);
    nomeFile = p7mName(built.nomeFile);
    const total = /<ImportoTotaleDocumento>(-?[\d.]+)</.exec(built.xml);
    const importoCents = total ? Math.round(Number(total[1]) * 100) : null;
    const destinazione = input.destinazione.tipo === "codice" ? input.destinazione.valore.trim().toUpperCase() : input.destinazione.valore.trim();
    const ins = await client.query(
      `insert into invoices (tenant_id, numero, data, nome_file, sha256_xml, sha256_p7m, status, anno, progressivo,
         cessionario_denominazione, cessionario_piva, cessionario_cf, importo_cents, tipo_documento, formato, ambiente, destinazione, p7m)
       values ($1, $2, $3, $4, $5, $6, 'draft', $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) returning id`,
      [
        tenant.id,
        numero,
        input.data,
        nomeFile,
        sha(built.xml),
        sha(p7m),
        anno,
        numeroProg,
        input.cessionarioDenominazione.trim(),
        input.cessionarioPartitaIva.trim(),
        (input.cessionarioCodiceFiscale ?? "").trim() || null,
        importoCents,
        input.tipoDocumento,
        input.formato ?? "FPR12",
        settings.environment,
        destinazione,
        p7m,
      ],
    );
    invoiceId = ins.rows[0].id as string;
    const hist = (from: string | null, to: string, causale: string) =>
      client.query(
        `insert into invoice_status_history (invoice_id, tenant_id, from_status, to_status, causale, source) values ($1, $2, $3, $4, $5, 'client')`,
        [invoiceId, tenant.id, from, to, causale],
      );
    await hist(null, "draft", "Fattura creata");
    await client.query("update invoices set status = 'signed', updated_at = now() where id = $1", [invoiceId]);
    await hist("draft", "signed", "XML validato e firmato CAdES-BES");
    if (idemKey) await client.query("update api_idempotency set invoice_id = $3 where tenant_id = $1 and idem_key = $2", [tenant.id, idemKey, invoiceId]);
    await logEvent(
      {
        tenantId: tenant.id,
        actorUserId: opts.actorUserId ?? null,
        event: "invoice.created",
        entity: "invoice",
        entityId: invoiceId,
        detail: { numero, nomeFile, via: opts.source ?? "web" },
      },
      client,
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    if ((err as { code?: string }).code === "23505") {
      return { errors: { _form: "Conflitto su un identificativo gia usato: riprova." }, conflict: true };
    }
    throw err;
  } finally {
    client.release();
  }

  // Invio fuori dalla transazione: la fattura esiste gia, firmata, e resta recuperabile.
  if (!settings.endpoint) {
    return { id: invoiceId, status: "signed", queued: true, warning: "Fattura in coda: l'endpoint SdI dell'ambiente attivo non e configurato." };
  }
  const sent = await emitInvoice(
    { invoiceId, nomeFile, p7m },
    {
      repo: createInvoiceRepo(db),
      cfg: { sdiEnv: settings.environment, trasmissioneUrl: settings.endpoint, retry: retryFromEnv(), ...(opts.fetch ? { fetch: opts.fetch } : {}) },
    },
  );
  const s = await db.query("select status from invoices where id = $1", [invoiceId]);
  const status = s.rows[0].status as string;
  if (!sent.ok) return { id: invoiceId, status, queued: true, warning: `Fattura in coda: ${sent.error}` };
  if (sent.result.status === "send_error") return { id: invoiceId, status, warning: `Invio rifiutato da SdI: ${sent.result.codice} ${sent.result.messaggio}` };
  if (sent.result.status === "send_unknown") return { id: invoiceId, status, warning: "Esito dell'invio incerto: SdI non ha risposto, riprovare piu tardi." };
  return { id: invoiceId, status };
}

// ---------------------------------------------------------------- fatture ricevute

export async function listReceived(scope: Scope, filter: ReceivedFilter = {}, opts: Opts = {}): Promise<ReceivedRow[]> {
  return listReceivedRows(scope, filter, opts.db ?? getPool());
}

export async function getReceived(scope: Scope, id: string, opts: Opts = {}): Promise<ReceivedDetail | null> {
  return getReceivedDetail(scope, id, opts.db ?? getPool());
}

/** Solo admin (un cliente riceve ForbiddenError). */
export async function listUnassigned(scope: Scope, opts: Opts = {}): Promise<ReceivedRow[]> {
  return listUnassignedRows(scope, opts.db ?? getPool());
}

/** Solo admin. false se la fattura non esiste o e gia assegnata. */
export async function assignReceived(
  scope: Scope,
  id: string,
  tenantId: string,
  actorUserId: string | null = null,
  opts: Opts = {},
): Promise<boolean> {
  return assignReceivedRow(scope, id, tenantId, actorUserId, opts.db ?? getPool());
}

// ---------------------------------------------------------------- contatori canale

export type ChannelCounters = {
  queued: number;
  errors24h: number;
  notifications: number;
  recentErrors: { at: Date; invoiceId: string; numero: string; status: string; message: string }[];
};

/** Contatori della pagina Stato canale. Il cliente vede solo quelli del proprio tenant. */
export async function channelCounters(scope: Scope, opts: Opts = {}): Promise<ChannelCounters> {
  const db = opts.db ?? getPool();
  const tenant = effectiveTenant(scope, null);
  const p = tenant ? [tenant] : [];
  const and = (col: string) => (tenant ? `and ${col} = $1` : "");
  const [q, e, n, recent] = await Promise.all([
    db.query(`select count(*)::int as c from invoices i where i.status = any('{draft,signed,sending,send_unknown}') ${and("i.tenant_id")}`, p),
    db.query(
      `select count(*)::int as c from invoice_status_history h
        where h.to_status in ('send_error', 'rejected', 'not_delivered') and h.recorded_at > now() - interval '24 hours' ${and("h.tenant_id")}`,
      p,
    ),
    db.query(`select count(*)::int as c from sdi_notifications s where true ${and("s.tenant_id")}`, p),
    db.query(
      `select h.recorded_at, h.invoice_id, i.numero, h.to_status, h.causale
         from invoice_status_history h join invoices i on i.id = h.invoice_id
        where h.to_status in ('send_error', 'rejected', 'not_delivered') ${and("h.tenant_id")}
        order by h.recorded_at desc, h.id desc limit 5`,
      p,
    ),
  ]);
  return {
    queued: q.rows[0].c as number,
    errors24h: e.rows[0].c as number,
    notifications: n.rows[0].c as number,
    recentErrors: recent.rows.map((x) => ({
      at: x.recorded_at as Date,
      invoiceId: x.invoice_id as string,
      numero: x.numero as string,
      status: x.to_status as string,
      message: x.causale as string,
    })),
  };
}
