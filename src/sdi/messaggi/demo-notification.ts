import { createHash } from "node:crypto";
import forge from "node-forge";
import { generateTestCert, type TestCert } from "../sign/test-cert.ts";

/**
 * Generatore unico di notifiche SdI di prova (RC, NS, MC, NE, DT, SE), conformi a MessaggiTypes_v1.0.xsd.
 * Usato dai test Vitest e dallo script `npm run sdi:notifica-demo`. Solo demo e test:
 * la ds:Signature e strutturalmente valida ma firmata con un certificato self-signed
 * generato a runtime (ADR 0005). Nessuna chiave viene salvata.
 */

const NS_MSG = "http://www.fatturapa.gov.it/sdi/messaggi/v1.0";
const NS_DS = "http://www.w3.org/2000/09/xmldsig#";

export type DemoNotificationType = "RC" | "NS" | "MC" | "NE" | "DT" | "SE";

/** Nome dell'elemento radice (coincide con l'operazione SOAP). */
export const ROOT_BY_TYPE: Record<DemoNotificationType, string> = {
  RC: "RicevutaConsegna",
  NS: "NotificaScarto",
  MC: "NotificaMancataConsegna",
  NE: "NotificaEsito",
  DT: "NotificaDecorrenzaTermini",
  SE: "ScartoEsitoCommittente",
};

export interface DemoError {
  codice: string;
  descrizione: string;
}

export interface DemoNotificationOptions {
  tipo: DemoNotificationType;
  sdiIdentifier: string;
  nomeFile: string;
  messageId?: string;
  dataOraRicezione?: string;
  /** Solo RC. */
  dataOraConsegna?: string;
  /** Solo RC: codice destinatario di 6 caratteri [A-Z0-9]. */
  destinatarioCodice?: string;
  /** Solo NS; se vuoto ne viene inserito uno di esempio. */
  errori?: DemoError[];
  /** Solo NE: EC01 (accettazione, default) o EC02 (rifiuto). Solo SE: EN00 (default) o EN01. */
  esito?: "EC01" | "EC02" | "EN00" | "EN01";
  /** MC, NE, DT: testo descrittivo opzionale. */
  descrizione?: string;
  cert?: TestCert;
}

let sharedCert: TestCert | undefined;
function defaultCert(): TestCert {
  sharedCert ??= generateTestCert("Test SdI Notifiche");
  return sharedCert;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const el = (name: string, value: string | undefined) => (value ? `<${name}>${esc(value)}</${name}>` : "");

function signature(body: string, cert: TestCert): string {
  const digest = createHash("sha256").update(body, "utf8").digest("base64");
  const signedInfo =
    `<ds:SignedInfo xmlns:ds="${NS_DS}">` +
    `<ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>` +
    `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>` +
    `<ds:Reference URI=""><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/></ds:Transforms>` +
    `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${digest}</ds:DigestValue></ds:Reference>` +
    `</ds:SignedInfo>`;
  const key = forge.pki.privateKeyFromPem(cert.keyPem) as forge.pki.rsa.PrivateKey;
  const md = forge.md.sha256.create();
  md.update(signedInfo, "utf8");
  const sigValue = forge.util.encode64(key.sign(md));
  const certB64 = forge.util.encode64(forge.pem.decode(cert.certPem)[0].body);
  return (
    `<ds:Signature xmlns:ds="${NS_DS}">${signedInfo.replace(` xmlns:ds="${NS_DS}"`, "")}` +
    `<ds:SignatureValue>${sigValue}</ds:SignatureValue>` +
    `<ds:KeyInfo><ds:X509Data><ds:X509Certificate>${certB64}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></ds:Signature>`
  );
}

/** XML della notifica (il contenuto del campo File, prima del base64). */
export function buildDemoNotificationXml(o: DemoNotificationOptions): string {
  const ricezione = o.dataOraRicezione ?? "2026-02-01T10:00:00.000+01:00";
  const root = ROOT_BY_TYPE[o.tipo];
  const id = `<IdentificativoSdI>${esc(o.sdiIdentifier)}</IdentificativoSdI>`;
  const nome = `<NomeFile>${esc(o.nomeFile)}</NomeFile>`;
  const msgId = `<MessageId>${esc(o.messageId ?? "M1")}</MessageId>`;
  let body: string;
  switch (o.tipo) {
    case "RC":
      body =
        `${id}${nome}<DataOraRicezione>${ricezione}</DataOraRicezione>` +
        `<DataOraConsegna>${o.dataOraConsegna ?? "2026-02-01T10:00:05.000+01:00"}</DataOraConsegna>` +
        `<Destinatario><Codice>${o.destinatarioCodice ?? "ABCDEF"}</Codice><Descrizione>Destinatario di prova</Descrizione></Destinatario>${msgId}`;
      break;
    case "NS": {
      const errori = o.errori?.length ? o.errori : [{ codice: "00311", descrizione: "Codice destinatario non valido" }];
      body =
        `${id}${nome}<DataOraRicezione>${ricezione}</DataOraRicezione><ListaErrori>${errori
          .map((e) => `<Errore><Codice>${esc(e.codice)}</Codice><Descrizione>${esc(e.descrizione)}</Descrizione></Errore>`)
          .join("")}</ListaErrori>${msgId}`;
      break;
    }
    case "MC":
      body = `${id}${nome}<DataOraRicezione>${ricezione}</DataOraRicezione>${el("Descrizione", o.descrizione ?? "Impossibile recapitare il file al destinatario")}${msgId}`;
      break;
    case "NE":
      body = `${id}${nome}<EsitoCommittente versione="1.0">${id}<Esito>${o.esito ?? "EC01"}</Esito>${el("Descrizione", o.descrizione)}</EsitoCommittente>${msgId}`;
      break;
    case "DT":
      body = `${id}${nome}${el("Descrizione", o.descrizione ?? "Decorrenza dei termini")}${msgId}`;
      break;
    case "SE":
      body = `${id}<Scarto>${o.esito === "EN01" ? "EN01" : "EN00"}</Scarto>${msgId}`;
      break;
  }
  const open = `<ns3:${root} xmlns:ns3="${NS_MSG}" versione="1.0">`;
  return `${open}${body}${signature(open + body, o.cert ?? defaultCert())}</ns3:${root}>`;
}

/** Busta SOAP completa per POST /sdi/ricezione/trasmissione-fatture. */
export function buildDemoNotificationSoap(o: DemoNotificationOptions): string {
  const op = ROOT_BY_TYPE[o.tipo];
  const file = Buffer.from(buildDemoNotificationXml(o), "utf8").toString("base64");
  return (
    `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>` +
    `<types:${op} xmlns:types="http://www.fatturapa.it/TrasmissioneFatture"><IdentificativoSdI>${esc(o.sdiIdentifier)}</IdentificativoSdI>` +
    `<NomeFile>${esc(o.nomeFile)}</NomeFile><File>${file}</File></types:${op}></soapenv:Body></soapenv:Envelope>`
  );
}

/** Busta SOAP RiceviFatture (fattura passiva) per POST /sdi/ricezione/ricezione-fatture. */
export function buildDemoReceivedInvoiceSoap(o: { sdiIdentifier: string; nomeFile: string; bytes: Buffer }): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>` +
    `<types:RiceviFatture xmlns:types="http://www.fatturapa.it/RicezioneFatture"><IdentificativoSdI>${esc(o.sdiIdentifier)}</IdentificativoSdI>` +
    `<NomeFile>${esc(o.nomeFile)}</NomeFile><File>${o.bytes.toString("base64")}</File></types:RiceviFatture></soapenv:Body></soapenv:Envelope>`
  );
}
