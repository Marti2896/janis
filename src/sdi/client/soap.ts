import { DEFAULT_RETRY, withRetry, type RetryConfig } from "./retry";

export interface SoapClientConfig {
  sdiEnv: "demo" | "production";
  trasmissioneUrl: string;
  retry?: RetryConfig;
  timeoutMs?: number;
  /** Punto di estensione: fetch iniettabile (mock, mutua TLS via dispatcher). */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export type RiceviFileResult =
  | { status: "sent"; identificativoSdi: string; dataOraRicezione?: string }
  | { status: "send_error"; codice: string; messaggio: string }
  | { status: "send_unknown" };

export const SOAP_ACTION = "http://www.fatturapa.it/SdIRiceviFile/RiceviFile";
const NS = "http://www.fatturapa.gov.it/sdi/ws/trasmissione/v1.0/types";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Busta SOAP 1.1 con File inline base64 (MTOM da valutare sul demo reale). */
export function buildEnvelope(nomeFile: string, p7m: Buffer): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:types="${NS}">` +
    `<soapenv:Header/><soapenv:Body><types:fileSdIAccoglienza>` +
    `<NomeFile>${escapeXml(nomeFile)}</NomeFile>` +
    `<File>${p7m.toString("base64")}</File>` +
    `</types:fileSdIAccoglienza></soapenv:Body></soapenv:Envelope>`
  );
}

function tag(xml: string, name: string): string | undefined {
  const m = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`).exec(xml);
  return m ? m[1].trim() : undefined;
}

type Attempt =
  | { kind: "ok"; result: RiceviFileResult }
  | { kind: "retry" };

export async function riceviFile(
  input: { nomeFile: string; p7m: Buffer },
  cfg: SoapClientConfig,
): Promise<RiceviFileResult> {
  if (cfg.sdiEnv === "production") {
    return {
      status: "send_error",
      codice: "ENV_PRODUCTION",
      messaggio: "Invio bloccato: sdiEnv production non è abilitato in questa versione",
    };
  }
  if (!cfg.trasmissioneUrl) {
    return { status: "send_error", codice: "CONFIG", messaggio: "sdi.trasmissioneUrl non configurato" };
  }
  const doFetch = cfg.fetch ?? fetch;
  const body = buildEnvelope(input.nomeFile, input.p7m);

  const attempt = async (): Promise<Attempt> => {
    let res: Response;
    let text: string;
    try {
      res = await doFetch(cfg.trasmissioneUrl, {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"${SOAP_ACTION}"` },
        body,
        signal: AbortSignal.timeout(cfg.timeoutMs ?? 30000),
      });
      text = await res.text();
    } catch {
      return { kind: "retry" };
    }
    if (res.status >= 500 && !/<(?:[\w-]+:)?Fault[\s>]/.test(text)) return { kind: "retry" };
    if (res.status >= 500 && res.status !== 500) return { kind: "retry" };
    const fault = tag(text, "faultstring");
    if (/<(?:[\w-]+:)?Fault[\s>]/.test(text)) {
      return {
        kind: "ok",
        result: { status: "send_error", codice: "FAULT", messaggio: fault ?? "SOAP Fault" },
      };
    }
    const errore = tag(text, "Errore");
    if (errore !== undefined) {
      return {
        kind: "ok",
        result: {
          status: "send_error",
          codice: tag(errore, "Codice") ?? errore,
          messaggio: tag(errore, "Descrizione") ?? errore,
        },
      };
    }
    const id = tag(text, "IdentificativoSdI");
    if (res.ok && id) {
      return {
        kind: "ok",
        result: { status: "sent", identificativoSdi: id, dataOraRicezione: tag(text, "DataOraRicezione") },
      };
    }
    if (res.status >= 400) {
      return {
        kind: "ok",
        result: { status: "send_error", codice: `HTTP_${res.status}`, messaggio: `Risposta HTTP ${res.status}` },
      };
    }
    // Risposta 2xx non interpretabile: l'invio potrebbe essere avvenuto, niente retry.
    return { kind: "ok", result: { status: "send_unknown" } };
  };

  const { outcome } = await withRetry(attempt, {
    cfg: cfg.retry ?? DEFAULT_RETRY,
    shouldRetry: (o) => o.kind === "retry",
    sleep: cfg.sleep,
    random: cfg.random,
  });
  return outcome.kind === "ok" ? outcome.result : { status: "send_unknown" };
}
