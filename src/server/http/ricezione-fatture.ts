import { XMLParser } from "fast-xml-parser";
import type { FastifyInstance, FastifyReply } from "fastify";
import type pg from "pg";
import {
  SoapFaultError,
  ensureXmlParser,
  isNotificationOperation,
  parseNotification,
  processNotification,
  soapFault,
  soapOk,
  soapOperation,
} from "../notifications.ts";
import { storeReceivedInvoice } from "../received-repo.ts";

export const RICEZIONE_FATTURE_PATH = "/sdi/ricezione/ricezione-fatture";

const parser = new XMLParser({ removeNSPrefix: true, parseTagValue: false, trimValues: true });

const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : null);

/** Legge IdentificativoSdI, NomeFile e File (base64) dall'operazione RiceviFatture. */
export function parseRiceviFatture(soapXml: string): { sdiIdentifier: string; fileName: string; bytes: Buffer } {
  let node: Record<string, unknown> | undefined;
  try {
    node = (parser.parse(soapXml) as { Envelope?: { Body?: { RiceviFatture?: Record<string, unknown> } } }).Envelope?.Body?.RiceviFatture;
  } catch {
    throw new SoapFaultError("XML malformato");
  }
  const sdiIdentifier = text(node?.IdentificativoSdI);
  const fileName = text(node?.NomeFile);
  const b64 = text(node?.File);
  if (!sdiIdentifier || !fileName || !b64) throw new SoapFaultError("fileSdIConMetadati incompleto", "RiceviFatture");
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length === 0) throw new SoapFaultError("File vuoto", "RiceviFatture");
  return { sdiIdentifier, fileName, bytes };
}

/**
 * Servizio SOAP RicezioneFatture: SdI consegna le fatture passive (RiceviFatture); sullo stesso endpoint
 * arrivano anche DT e SE. Con sdiEnv production risponde sempre Fault senza toccare il DB.
 */
export function registerRicezioneFatture(app: FastifyInstance, deps: { pool: pg.Pool; sdiEnv: string }): void {
  ensureXmlParser(app);
  const fault = (reply: FastifyReply, msg: string) => reply.code(500).type("text/xml; charset=utf-8").send(soapFault(msg));

  app.post(RICEZIONE_FATTURE_PATH, async (req, reply) => {
    if (deps.sdiEnv === "production") return fault(reply, "Ricezione fatture non abilitata in production");
    const body = typeof req.body === "string" ? req.body : "";
    try {
      const op = soapOperation(body);
      if (op === "RiceviFatture") {
        const r = await storeReceivedInvoice(deps.pool, parseRiceviFatture(body));
        req.log.info({ result: r.result, receivedId: r.id, assigned: r.tenantId !== null }, "fattura passiva elaborata");
        if (r.result === "duplicate") throw new SoapFaultError("IdentificativoSdI duplicato: fattura già ricevuta", "RiceviFatture");
      } else if (op === "NotificaDecorrenzaTermini" || op === "ScartoEsitoCommittente") {
        const n = await parseNotification(body);
        const result = await processNotification(deps.pool, n);
        req.log.info({ result, type: n.type }, "notifica SdI elaborata");
      } else {
        const hint = isNotificationOperation(op) ? "usare l'endpoint trasmissione-fatture" : "operazione non supportata";
        throw new SoapFaultError(`Operazione SdI non supportata su RicezioneFatture: ${op} (${hint})`, op);
      }
      return reply.code(200).type("text/xml; charset=utf-8").send(soapOk);
    } catch (err) {
      if (err instanceof SoapFaultError) {
        await deps.pool
          .query(
            `insert into audit_log (event, entity, entity_id, detail, outcome) values ('received_invoice.rejected', 'received_invoice', $1, $2, 'error')`,
            [err.operation ?? "", JSON.stringify({ motivo: err.message })],
          )
          .catch(() => {});
        return fault(reply, err.message);
      }
      req.log.error({ err }, "errore ricezione fattura passiva");
      return fault(reply, "Errore interno");
    }
  });
}
