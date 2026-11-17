import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import type { FastifyInstance } from "fastify";
import type pg from "pg";

export type NotificationType = "RC" | "NS";

export interface SdiError {
  codice: string;
  descrizione: string;
  suggerimento?: string;
}

export interface ParsedNotification {
  type: NotificationType;
  sdiIdentifier: string;
  /** NomeFile della fattura a cui la notifica si riferisce (dal messaggio interno). */
  nomeFile: string;
  messageId: string;
  fileSha256: string;
  sdiTimestamp: string | null;
  dataConsegna: string | null;
  destinatario: string | null;
  errori: SdiError[] | null;
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

const OPERATIONS: Record<string, NotificationType> = {
  RicevutaConsegna: "RC",
  NotificaScarto: "NS",
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

export function parseNotification(soapXml: string): ParsedNotification {
  const operation = soapOperation(soapXml);
  const type = OPERATIONS[operation];
  if (!type) throw new SoapFaultError(`Operazione SdI non ancora supportata: ${operation}`, operation);

  const fileSdi = parseXml(soapXml).Envelope.Body[operation];
  const sdiIdentifier = str(fileSdi?.IdentificativoSdI);
  const fileB64 = str(fileSdi?.File);
  if (!sdiIdentifier || !fileB64) throw new SoapFaultError("fileSdI incompleto", operation);

  const bytes = Buffer.from(fileB64, "base64");
  const root = parseXml(bytes.toString("utf8"));
  const msg = root.RicevutaConsegna ?? root.NotificaScarto;
  if (!msg || typeof msg !== "object") throw new SoapFaultError("Notifica interna non valida", operation);
  if (Boolean(root.RicevutaConsegna) !== (type === "RC")) {
    throw new SoapFaultError("Notifica interna incoerente con l'operazione", operation);
  }
  const nomeFile = str(msg.NomeFile) ?? str(fileSdi?.NomeFile);
  if (!nomeFile) throw new SoapFaultError("NomeFile assente", operation);

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
  const dest = msg.Destinatario;
  return {
    type,
    sdiIdentifier: str(msg.IdentificativoSdI) ?? sdiIdentifier,
    nomeFile,
    messageId: str(msg.MessageId) ?? "",
    fileSha256: createHash("sha256").update(bytes).digest("hex"),
    sdiTimestamp: str(msg.DataOraRicezione),
    dataConsegna: type === "RC" ? str(msg.DataOraConsegna) : null,
    destinatario: dest && typeof dest === "object" ? str(dest.Codice) : str(dest),
    errori,
  };
}

export type ProcessResult = "applied" | "duplicate" | "unknown_invoice" | "incompatible_state";

const TARGET: Record<NotificationType, string> = { RC: "delivered", NS: "rejected" };
const ACCEPTED_FROM = ["sent", "send_unknown"];

export async function processNotification(pool: pg.Pool, n: ParsedNotification): Promise<ProcessResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const found = await client.query(
      `select id, tenant_id, status from invoices
        where sdi_identifier = $1 or nome_file = any($2)
        order by (sdi_identifier = $1) desc nulls last limit 1 for update`,
      [n.sdiIdentifier, [n.nomeFile, `${n.nomeFile}.p7m`]],
    );
    const inv = found.rows[0] as { id: string; tenant_id: string; status: string } | undefined;

    const ins = await client.query(
      `insert into sdi_notifications
         (tenant_id, invoice_id, sdi_identifier, type, message_id, nome_file, file_sha256,
          sdi_timestamp, data_consegna, destinatario, errori)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (sdi_identifier, type, message_id) do nothing returning id`,
      [
        inv?.tenant_id ?? null,
        inv?.id ?? null,
        n.sdiIdentifier,
        n.type,
        n.messageId,
        n.nomeFile,
        n.fileSha256,
        n.sdiTimestamp,
        n.dataConsegna,
        n.destinatario,
        n.errori ? JSON.stringify(n.errori) : null,
      ],
    );
    if (ins.rowCount === 0) {
      await client.query("rollback");
      return "duplicate";
    }

    const audit = (event: string, detail: Record<string, unknown>) =>
      client.query(
        `insert into audit_log (tenant_id, event, entity, entity_id, detail) values ($1, $2, 'sdi_notification', $3, $4)`,
        [inv?.tenant_id ?? null, event, String(ins.rows[0].id), JSON.stringify({ type: n.type, sdiIdentifier: n.sdiIdentifier, ...detail })],
      );

    let result: ProcessResult;
    if (!inv) {
      await audit("notification.unknown_invoice", { nomeFile: n.nomeFile });
      result = "unknown_invoice";
    } else if (!ACCEPTED_FROM.includes(inv.status)) {
      await audit("notification.incompatible_state", { status: inv.status });
      result = "incompatible_state";
    } else {
      const to = TARGET[n.type];
      const causale =
        n.type === "RC"
          ? `Ricevuta di consegna${n.destinatario ? ` (destinatario ${n.destinatario})` : ""}`
          : `Notifica di scarto: ${(n.errori ?? []).map((e) => `${e.codice} ${e.descrizione}`).join("; ") || "nessun dettaglio"}`;
      await client.query(
        "update invoices set status = $2, sdi_identifier = coalesce(sdi_identifier, $3), updated_at = now() where id = $1",
        [inv.id, to, n.sdiIdentifier],
      );
      await client.query(
        `insert into invoice_status_history (invoice_id, tenant_id, from_status, to_status, causale, sdi_timestamp, source)
         values ($1, $2, $3, $4, $5, $6, 'sdi_notification')`,
        [inv.id, inv.tenant_id, inv.status, to, causale, n.type === "RC" ? (n.dataConsegna ?? n.sdiTimestamp) : n.sdiTimestamp],
      );
      await audit("notification.applied", { from: inv.status, to });
      result = "applied";
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

/** Registra il parser text/xml e la rotta di ricezione. Con sdiEnv production risponde sempre Fault senza toccare il DB. */
export function registerSdiReceiver(app: FastifyInstance, deps: { pool: pg.Pool; sdiEnv: string }): void {
  app.addContentTypeParser(["text/xml", "application/soap+xml"], { parseAs: "string" }, (_req, body, done) =>
    done(null, body),
  );

  const fault = (reply: import("fastify").FastifyReply, msg: string) =>
    reply.code(500).type("text/xml; charset=utf-8").send(soapFault(msg));

  app.post(RICEZIONE_PATH, async (req, reply) => {
    if (deps.sdiEnv === "production") {
      return fault(reply, "Ricezione notifiche non abilitata in production");
    }
    try {
      const n = parseNotification(typeof req.body === "string" ? req.body : "");
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
