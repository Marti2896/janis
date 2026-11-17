import type {
  BuildOptions,
  BuildResult,
  EsigibilitaIva,
  FatturaModel,
  FieldError,
  RigaFattura,
  Sede,
} from "./types";
import { validateFatturaXml } from "./validate";

const NS = "http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2";

/** Formatta un intero con `decimals` decimali, senza float. */
export function formatFixed(value: number, scale: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const int = Math.floor(abs / scale);
  const frac = String(abs % scale).padStart(String(scale).length - 1, "0");
  return `${sign}${int}.${frac}`;
}

const cents = (v: number) => formatFixed(v, 100);
const rate = (bp: number) => formatFixed(bp, 100);
const qty = (milli: number) => formatFixed(milli, 1000);

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const tag = (name: string, value: string | undefined) =>
  value === undefined || value === "" ? "" : `<${name}>${esc(value)}</${name}>`;

export function nomeFileFor(idPaese: string, idCodice: string, progressivo: string): string {
  return `${idPaese}${idCodice}_${progressivo}.xml`;
}

interface Line {
  riga: RigaFattura;
  totale: number;
}

interface Riepilogo {
  aliquotaBp: number;
  natura?: string;
  esigibilita?: EsigibilitaIva;
  riferimentoNormativo?: string;
  imponibile: number;
}

function validateModel(m: FatturaModel): FieldError[] {
  const errors: FieldError[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });
  if (m.codiceDestinatario.length !== 7)
    err("CodiceDestinatario", "CodiceDestinatario deve essere di 7 caratteri");
  if (!/^[A-Za-z0-9]{5}$/.test(m.progressivoInvio))
    err("ProgressivoInvio", "ProgressivoInvio deve essere alfanumerico di 5 caratteri");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.data)) err("Data", "Data deve essere nel formato YYYY-MM-DD");
  if (!m.numero) err("Numero", "Numero obbligatorio");
  if (m.tipoDocumento !== "TD01") err("TipoDocumento", "Supportato solo TD01");
  if (m.righe.length === 0) err("DettaglioLinee", "La fattura deve avere almeno una riga");
  m.righe.forEach((r, i) => {
    const p = `DettaglioLinee[${i + 1}]`;
    for (const [k, v] of [
      ["PrezzoUnitario", r.prezzoUnitarioCents],
      ["AliquotaIVA", r.aliquotaBp],
      ["Quantita", r.quantitaMilli ?? 1000],
    ] as const) {
      if (!Number.isInteger(v)) err(`${p}.${k}`, `${k} deve essere un intero (centesimi, punti base, millesimi)`);
    }
    if (r.aliquotaBp === 0 && !r.natura) err(`${p}.Natura`, "Natura obbligatoria con aliquota 0");
    if (r.aliquotaBp > 0 && r.natura) err(`${p}.Natura`, "Natura non ammessa con aliquota diversa da 0");
    if (r.natura && !r.riferimentoNormativo)
      err(`${p}.RiferimentoNormativo`, "RiferimentoNormativo obbligatorio con Natura");
    if (r.natura?.startsWith("N6") && !/^N6\.[1-9]$/.test(r.natura))
      err(`${p}.Natura`, "Natura reverse charge non valida (N6.1 - N6.9)");
    if (r.esigibilita === "S" && r.aliquotaBp === 0)
      err(`${p}.EsigibilitaIVA`, "Split payment (S) richiede un'aliquota IVA valorizzata");
  });
  return errors;
}

function sedeXml(s: Sede): string {
  return `<Sede>${tag("Indirizzo", s.indirizzo)}${tag("CAP", s.cap)}${tag("Comune", s.comune)}${tag("Provincia", s.provincia)}${tag("Nazione", s.nazione)}</Sede>`;
}

/**
 * Genera il file FatturaPA FPR12 dal modello e lo valida contro gli XSD ufficiali.
 * Pura: nessun accesso a DB o rete.
 */
export async function buildFatturaXml(m: FatturaModel, opts: BuildOptions = {}): Promise<BuildResult> {
  const modelErrors = validateModel(m);
  if (modelErrors.length) return { ok: false, errors: modelErrors };

  const divisa = m.divisa ?? "EUR";
  const lines: Line[] = m.righe.map((riga) => ({
    riga,
    totale: Math.round(((riga.quantitaMilli ?? 1000) * riga.prezzoUnitarioCents) / 1000),
  }));

  // DatiRiepilogo raggruppato per aliquota / natura / esigibilita / riferimento.
  const groups = new Map<string, Riepilogo>();
  for (const { riga, totale } of lines) {
    const key = [riga.aliquotaBp, riga.natura ?? "", riga.esigibilita ?? "", riga.riferimentoNormativo ?? ""].join("|");
    const g = groups.get(key) ?? {
      aliquotaBp: riga.aliquotaBp,
      natura: riga.natura,
      esigibilita: riga.esigibilita,
      riferimentoNormativo: riga.riferimentoNormativo,
      imponibile: 0,
    };
    g.imponibile += totale;
    groups.set(key, g);
  }
  const riepiloghi = [...groups.values()].map((g) => ({
    ...g,
    imposta: Math.round((g.imponibile * g.aliquotaBp) / 10000),
  }));

  const totaleImponibile = riepiloghi.reduce((a, r) => a + r.imponibile, 0);
  const totaleImposta = riepiloghi.reduce((a, r) => a + r.imposta, 0);
  const totaleDocumento = totaleImponibile + totaleImposta;
  const impostaSplit = riepiloghi.filter((r) => r.esigibilita === "S").reduce((a, r) => a + r.imposta, 0);

  const c = m.cedente;
  const d = m.cessionario;
  const nomeFile = nomeFileFor(c.idPaese, c.partitaIva, m.progressivoInvio);

  const header =
    `<FatturaElettronicaHeader>` +
    `<DatiTrasmissione><IdTrasmittente>${tag("IdPaese", c.idPaese)}${tag("IdCodice", c.partitaIva)}</IdTrasmittente>` +
    `${tag("ProgressivoInvio", m.progressivoInvio)}<FormatoTrasmissione>FPR12</FormatoTrasmissione>` +
    `${tag("CodiceDestinatario", m.codiceDestinatario)}${tag("PECDestinatario", m.pecDestinatario)}</DatiTrasmissione>` +
    `<CedentePrestatore><DatiAnagrafici><IdFiscaleIVA>${tag("IdPaese", c.idPaese)}${tag("IdCodice", c.partitaIva)}</IdFiscaleIVA>` +
    `${tag("CodiceFiscale", c.codiceFiscale)}<Anagrafica>${tag("Denominazione", c.denominazione)}</Anagrafica>` +
    `${tag("RegimeFiscale", c.regimeFiscale)}</DatiAnagrafici>${sedeXml(c.sede)}</CedentePrestatore>` +
    `<CessionarioCommittente><DatiAnagrafici>` +
    (d.partitaIva ? `<IdFiscaleIVA>${tag("IdPaese", d.idPaese ?? "IT")}${tag("IdCodice", d.partitaIva)}</IdFiscaleIVA>` : "") +
    `${tag("CodiceFiscale", d.codiceFiscale)}<Anagrafica>${tag("Denominazione", d.denominazione)}</Anagrafica>` +
    `</DatiAnagrafici>${sedeXml(d.sede)}</CessionarioCommittente>` +
    `</FatturaElettronicaHeader>`;

  const dettaglio = lines
    .map(({ riga, totale }, i) =>
      `<DettaglioLinee>${tag("NumeroLinea", String(i + 1))}${tag("Descrizione", riga.descrizione)}` +
      `${tag("Quantita", qty(riga.quantitaMilli ?? 1000))}${tag("PrezzoUnitario", cents(riga.prezzoUnitarioCents))}` +
      `${tag("PrezzoTotale", cents(totale))}${tag("AliquotaIVA", rate(riga.aliquotaBp))}${tag("Natura", riga.natura)}</DettaglioLinee>`,
    )
    .join("");
  const riepilogo = riepiloghi
    .map(
      (r) =>
        `<DatiRiepilogo>${tag("AliquotaIVA", rate(r.aliquotaBp))}${tag("Natura", r.natura)}` +
        `${tag("ImponibileImporto", cents(r.imponibile))}${tag("Imposta", cents(r.imposta))}` +
        `${tag("EsigibilitaIVA", r.esigibilita)}${tag("RiferimentoNormativo", r.riferimentoNormativo)}</DatiRiepilogo>`,
    )
    .join("");

  // Con split payment il cessionario paga solo l'imponibile (l'IVA e versata dalla PA).
  const pagamento = m.pagamento
    ? `<DatiPagamento>${tag("CondizioniPagamento", m.pagamento.condizioni)}<DettaglioPagamento>` +
      `${tag("ModalitaPagamento", m.pagamento.modalita)}${tag("ImportoPagamento", cents(totaleDocumento - impostaSplit))}` +
      `${tag("IBAN", m.pagamento.iban)}</DettaglioPagamento></DatiPagamento>`
    : "";

  const body =
    `<FatturaElettronicaBody><DatiGenerali><DatiGeneraliDocumento>${tag("TipoDocumento", m.tipoDocumento)}` +
    `${tag("Divisa", divisa)}${tag("Data", m.data)}${tag("Numero", m.numero)}` +
    `${tag("ImportoTotaleDocumento", cents(totaleDocumento))}${tag("Causale", m.causale)}</DatiGeneraliDocumento></DatiGenerali>` +
    `<DatiBeniServizi>${dettaglio}${riepilogo}</DatiBeniServizi>${pagamento}</FatturaElettronicaBody>`;

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<p:FatturaElettronica versione="FPR12" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:p="${NS}" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${header}${body}</p:FatturaElettronica>\n`;

  const validation = await validateFatturaXml(xml);
  if (!validation.ok) return { ok: false, errors: validation.errors };
  return opts.replacesInvoiceId
    ? { ok: true, xml, nomeFile, replacesInvoiceId: opts.replacesInvoiceId }
    : { ok: true, xml, nomeFile };
}
