import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { validateMessaggioXml } from "../sdi/messaggi/validate.ts";

export type NotificationType = "RC" | "NS" | "MC" | "NE" | "DT" | "SE";

export interface SdiError {
  codice: string;
  descrizione: string;
  suggerimento?: string;
}

export interface ParsedNotification {
  type: NotificationType;
  sdiIdentifier: string;
  /** NomeFile della fattura a cui la notifica si riferisce (dal messaggio interno). Vuoto per SE senza NomeFile. */
  nomeFile: string;
  messageId: string;
  fileSha256: string;
  sdiTimestamp: string | null;
  dataConsegna: string | null;
  destinatario: string | null;
  errori: SdiError[] | null;
  /** NE: EC01 o EC02. SE: EN00 o EN01. */
  esito: string | null;
  descrizione: string | null;
}

export class SoapFaultError extends Error {
  readonly operation?: string;
  constructor(message: string, operation?: string) {
    super(message);
    this.operation = operation;
  }
}

const parser = new XMLParser({
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

/** Operazione SOAP (= elemento radice del messaggio) e tipo di notifica. */
const OPERATIONS: Record<string, NotificationType> = {
  RicevutaConsegna: "RC",
  NotificaScarto: "NS",
  NotificaMancataConsegna: "MC",
  NotificaEsito: "NE",
  NotificaDecorrenzaTermini: "DT",
  ScartoEsitoCommittente: "SE",
};

const str = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : null;

// Albero prodotto da fast-xml-parser: la forma è verificata a runtime dalle funzioni sotto.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type XmlNode = Record<string, any>;

function parseXml(xml: string): XmlNode {
  try {
    return parser.parse(xml) as XmlNode;
  } catch {
    throw new SoapFaultError("XML malformato");
  }
}

/** Estrae il nome dell'operazione SOAP senza validare il contenuto. */
export function soapOperation(xml: string): string {
  const body = parseXml(xml).Envelope?.Body;
  if (!body || typeof body !== "object") throw new SoapFaultError("Busta SOAP non valida");
  const op = Object.keys(body).find((k) => !k.startsWith("@_") && !k.startsWith("#"));
  if (!op) throw new SoapFaultError("Busta SOAP senza operazione");
  return op;
}

export function isNotificationOperation(op: string): boolean {
  return op in OPERATIONS;
}

export async function parseNotification(soapXml: string): Promise<ParsedNotification> {
  const operation = soapOperation(soapXml);
  const type = OPERATIONS[operation];
  if (!type) throw new SoapFaultError(`Operazione SdI non ancora supportata: ${operation}`, operation);

  const fileSdi = parseXml(soapXml).Envelope.Body[operation];
  const sdiIdentifier = str(fileSdi?.IdentificativoSdI);
  const fileB64 = str(fileSdi?.File);
  if (!sdiIdentifier || !fileB64) throw new SoapFaultError("fileSdI incompleto", operation);

  const bytes = Buffer.from(fileB64, "base64");
  const innerXml = bytes.toString("utf8");
  const root = parseXml(innerXml);
  const valid = await validateMessaggioXml(innerXml);
  if (!valid.ok) {
    throw new SoapFaultError(`Messaggio SdI non valido: ${valid.errors[0] ?? "errore XSD"}`, operation);
  }
  const msg = root[operation];
  if (!msg || typeof msg !== "object") {
    throw new SoapFaultError("Notifica interna incoerente con l'operazione", operation);
  }
  const nomeFile = str(msg.NomeFile) ?? str(fileSdi?.NomeFile) ?? (type === "SE" ? "" : null);
  if (nomeFile === null) throw new SoapFaultError("NomeFile assente", operation);

  let errori: SdiError[] | null = null;
  if (type === "NS") {
    const raw = msg.ListaErrori?.Errore;
    const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    errori = list.map((e: XmlNode) => ({
      codice: str(e.Codice) ?? "",
      descrizione: str(e.Descrizione) ?? "",
      ...(str(e.Suggerimento) ? { suggerimento: str(e.Suggerimento)! } : {}),
    }));
  }
  let esito: string | null = null;
  let descrizione: string | null = str(msg.Descrizione);
  let innerId = str(msg.IdentificativoSdI);
  if (type === "NE") {
    const ec = msg.EsitoCommittente as XmlNode | undefined;
    esito = str(ec?.Esito);
    descrizione = str(ec?.Descrizione);
    innerId = str(ec?.IdentificativoSdI) ?? innerId;
  } else if (type === "SE") {
    esito = str(msg.Scarto);
  }
  const dest = msg.Destinatario;
  return {
    type,
    sdiIdentifier: innerId ?? sdiIdentifier,
    nomeFile,
    messageId: str(msg.MessageId) ?? "",
    fileSha256: createHash("sha256").update(bytes).digest("hex"),
    sdiTimestamp: str(msg.DataOraRicezione),
    dataConsegna: type === "RC" ? str(msg.DataOraConsegna) : null,
    destinatario: dest && typeof dest === "object" ? str(dest.Codice) : str(dest),
    errori,
    esito,
    descrizione,
  };
}

/** Prefisso della causale quando un esito già ricevuto viene applicato dopo la consegna. */
export const REAPPLIED_PREFIX = "Esito già ricevuto, applicato dopo la consegna: ";

export type ProcessResult = "applied" | "duplicate" | "unknown_invoice" | "incompatible_state";

/** Stati da cui la notifica e accettata. Una notifica fuori sequenza si registra ma non fa regredire lo stato. */
const ACCEPTED_FROM: Record<Exclude<NotificationType, "SE">, string[]> = {
  RC: ["sent", "send_unknown"],
  NS: ["sent", "send_unknown"],
  MC: ["sent", "send_unknown"],
  NE: ["delivered"],
  DT: ["delivered"],
};

function targetStatus(n: ParsedNotification): string | null {
  switch (n.type) {
    case "RC":
      return "delivered";
    case "NS":
      return "rejected";
    case "MC":
      return "not_delivered";
    case "DT":
      return "terms_expired";
    case "NE":
      return n.esito === "EC01" ? "accepted" : n.esito === "EC02" ? "refused" : null;
    default:
      return null;
  }
}

function causaleFor(n: ParsedNotification): string {
  switch (n.type) {
    case "RC":
      return `Ricevuta di consegna${n.destinatario ? ` (destinatario ${n.destinatario})` : ""}`;
    case "NS":
      return `Notifica di scarto: ${(n.errori ?? []).map((e) => `${e.codice} ${e.descrizione}`).join("; ") || "nessun dettaglio"}`;
    case "MC":
      return `Mancata consegna${n.descrizione ? `: ${n.descrizione}` : ""}`;
    case "NE":
      return `Notifica esito committente: ${n.esito === "EC01" ? "accettata" : "rifiutata"}${n.descrizione ? ` (${n.descrizione})` : ""}`;
    case "DT":
      return `Decorrenza termini${n.descrizione ? `: ${n.descrizione}` : ""}`;
    case "SE":
      return `Scarto dell'esito committente ${n.esito ?? ""}`.trim();
  }
}

function statusTimestamp(n: ParsedNotification): string | null {
  return n.type === "RC" ? (n.dataConsegna ?? n.sdiTimestamp) : n.sdiTimestamp;
}

export async function processNotification(pool: pg.Pool, n: ParsedNotification): Promise<ProcessResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");

    // SE riguarda un esito inviato da noi come destinatari: si registra sulla fattura ricevuta.
    let rec: { id: string; tenant_id: string | null } | undefined;
    let inv: { id: string; tenant_id: string; status: string } | undefined;
    if (n.type === "SE") {
      const f = await client.query("select id, tenant_id from received_invoices where sdi_identifier = $1 for update", [n.sdiIdentifier]);
      rec = f.rows[0];
    } else {
      const found = await client.query(
        `select id, tenant_id, status from invoices
          where sdi_identifier = $1 or nome_file = any($2)
          order by (sdi_identifier = $1) desc nulls last limit 1 for update`,
        [n.sdiIdentifier, [n.nomeFile, `${n.nomeFile}.p7m`]],
      );
      inv = found.rows[0];
    }
    const tenantId = (n.type === "SE" ? rec?.tenant_id : inv?.tenant_id) ?? null;

    const ins = await client.query(
      `insert into sdi_notifications
         (tenant_id, invoice_id, received_invoice_id, sdi_identifier, type, message_id, nome_file, file_sha256,
          sdi_timestamp, data_consegna, destinatario, errori, esito, descrizione)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       on conflict (sdi_identifier, type, message_id) do nothing returning id`,
      [
        tenantId,
        inv?.id ?? null,
        rec?.id ?? null,
        n.sdiIdentifier,
        n.type,
        n.messageId,
        n.nomeFile,
        n.fileSha256,
        n.sdiTimestamp,
        n.dataConsegna,
        n.destinatario,
        n.errori ? JSON.stringify(n.errori) : null,
        n.esito,
        n.descrizione,
      ],
    );
    if (ins.rowCount === 0) {
      await client.query("rollback");
      return "duplicate";
    }

    const audit = (event: string, detail: Record<string, unknown>) =>
      client.query(
        `insert into audit_log (tenant_id, event, entity, entity_id, detail) values ($1, $2, 'sdi_notification', $3, $4)`,
        [tenantId, event, String(ins.rows[0].id), JSON.stringify({ type: n.type, sdiIdentifier: n.sdiIdentifier, ...detail })],
      );

    let result: ProcessResult;
    if (n.type === "SE") {
      if (!rec) {
        await audit("notification.unknown_invoice", { nomeFile: n.nomeFile });
        result = "unknown_invoice";
      } else {
        await client.query(
          `insert into received_invoice_history (received_invoice_id, tenant_id, event, detail) values ($1, $2, 'SE', $3)`,
          [rec.id, rec.tenant_id, JSON.stringify({ scarto: n.esito, messageId: n.messageId, causale: causaleFor(n) })],
        );
        await audit("notification.applied", { scarto: n.esito });
        result = "applied";
      }
    } else if (!inv) {
      await audit("notification.unknown_invoice", { nomeFile: n.nomeFile });
      result = "unknown_invoice";
    } else {
      const to = targetStatus(n);
      if (!to || !ACCEPTED_FROM[n.type].includes(inv.status)) {
        await audit("notification.incompatible_state", { status: inv.status, esito: n.esito });
        result = "incompatible_state";
      } else {
        await client.query(
          "update invoices set status = $2, sdi_identifier = coalesce(sdi_identifier, $3), updated_at = now() where id = $1",
          [inv.id, to, n.sdiIdentifier],
        );
        await client.query(
          `insert into invoice_status_history (invoice_id, tenant_id, from_status, to_status, causale, sdi_timestamp, source)
           values ($1, $2, $3, $4, $5, $6, 'sdi_notification')`,
          [inv.id, inv.tenant_id, inv.status, to, causaleFor(n), statusTimestamp(n)],
        );
        await audit("notification.applied", { from: inv.status, to });
        result = "applied";

        // Dopo la consegna si riapplicano gli esiti NE/DT arrivati prima (registrati ma fuori sequenza).
        if (n.type === "RC") {
          const early = await client.query(
            `select id, type, esito, descrizione, sdi_timestamp, message_id from sdi_notifications
              where invoice_id = $1 and type in ('NE', 'DT') and id <> $2
              order by coalesce(sdi_timestamp, received_at), id`,
            [inv.id, ins.rows[0].id],
          );
          let current = to;
          for (const row of early.rows) {
            const pn = { type: row.type, esito: row.esito, descrizione: row.descrizione, sdiTimestamp: row.sdi_timestamp } as ParsedNotification;
            const next = targetStatus(pn);
            if (!next || !ACCEPTED_FROM[pn.type as Exclude<NotificationType, "SE">].includes(current)) continue;
            await client.query("update invoices set status = $2, updated_at = now() where id = $1", [inv.id, next]);
            await client.query(
              `insert into invoice_status_history (invoice_id, tenant_id, from_status, to_status, causale, sdi_timestamp, source)
               values ($1, $2, $3, $4, $5, $6, 'sdi_notification')`,
              [inv.id, inv.tenant_id, current, next, `${REAPPLIED_PREFIX}${causaleFor(pn)}`, row.sdi_timestamp],
            );
            await client.query(
              `insert into audit_log (tenant_id, event, entity, entity_id, detail) values ($1, 'notification.applied', 'sdi_notification', $2, $3)`,
              [tenantId, String(row.id), JSON.stringify({ type: row.type, from: current, to: next, reapplied: true })],
            );
            current = next;
          }
        }
      }
    }
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const SOAP_NS = "http://schemas.xmlsoap.org/soap/envelope/";

export const soapOk = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="${SOAP_NS}"><soapenv:Body/></soapenv:Envelope>`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function soapFault(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="${SOAP_NS}"><soapenv:Body><soapenv:Fault><faultcode>soapenv:Server</faultcode><faultstring>${esc(message)}</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>`;
}

export const RICEZIONE_PATH = "/sdi/ricezione/trasmissione-fatture";

/** Registra (una sola volta) il parser per i body SOAP text/xml. */
export function ensureXmlParser(app: FastifyInstance): void {
  if (app.hasContentTypeParser("text/xml")) return;
  app.addContentTypeParser(["text/xml", "application/soap+xml"], { parseAs: "string" }, (_req, body, done) =>
    done(null, body),
  );
}

/** Registra il parser text/xml e la rotta di ricezione. Con sdiEnv production risponde sempre Fault senza toccare il DB. */
export function registerSdiReceiver(app: FastifyInstance, deps: { pool: pg.Pool; sdiEnv: string }): void {
  ensureXmlParser(app);

  const fault = (reply: import("fastify").FastifyReply, msg: string) =>
    reply.code(500).type("text/xml; charset=utf-8").send(soapFault(msg));

  app.post(RICEZIONE_PATH, async (req, reply) => {
    if (deps.sdiEnv === "production") {
      return fault(reply, "Ricezione notifiche non abilitata in production");
    }
    try {
      const n = await parseNotification(typeof req.body === "string" ? req.body : "");
      const result = await processNotification(deps.pool, n);
      req.log.info({ result, type: n.type, sdiIdentifier: n.sdiIdentifier }, "notifica SdI elaborata");
      return reply.code(200).type("text/xml; charset=utf-8").send(soapOk);
    } catch (err) {
      if (err instanceof SoapFaultError) {
        await deps.pool
          .query(
            `insert into audit_log (event, entity, entity_id, detail) values ('notification.rejected', 'sdi_notification', $1, $2)`,
            [err.operation ?? "", JSON.stringify({ motivo: err.message })],
          )
          .catch(() => {});
        return fault(reply, err.message);
      }
      req.log.error({ err }, "errore elaborazione notifica");
      return fault(reply, "Errore interno");
    }
  });
}
