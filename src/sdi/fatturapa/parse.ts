import { XMLParser } from "fast-xml-parser";
import { verifyP7m } from "../sign/cades.ts";

/** Lettura di una fattura ricevuta (XML o P7M) in una struttura leggibile. Importi in centesimi. */

export interface ParteFattura {
  denominazione: string | null;
  partitaIva: string | null;
  codiceFiscale: string | null;
  sede: string | null;
}

export interface RigaLetta {
  numero: number;
  descrizione: string;
  quantita: number | null;
  prezzoUnitarioCents: number | null;
  aliquota: number | null;
  natura: string | null;
  totaleCents: number | null;
}

export interface RiepilogoIva {
  aliquota: number | null;
  natura: string | null;
  imponibileCents: number | null;
  impostaCents: number | null;
}

export interface PagamentoLetto {
  modalita: string | null;
  scadenza: string | null;
  importoCents: number | null;
  iban: string | null;
}

export interface DocumentoLetto {
  tipoDocumento: string | null;
  numero: string | null;
  data: string | null;
  divisa: string | null;
  totaleCents: number | null;
  righe: RigaLetta[];
  riepilogo: RiepilogoIva[];
  pagamenti: PagamentoLetto[];
}

export interface FatturaLetta {
  fornitore: ParteFattura;
  cliente: ParteFattura;
  /** Un lotto contiene piu documenti (FatturaElettronicaBody). */
  documenti: DocumentoLetto[];
}

export class FatturaParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatturaParseError";
  }
}

const ARRAYS = new Set(["FatturaElettronicaBody", "DettaglioLinee", "DatiRiepilogo", "DatiPagamento", "DettaglioPagamento"]);

const parser = new XMLParser({
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ARRAYS.has(name),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = Record<string, any>;

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : null);

function num(v: unknown): number | null {
  const t = str(v);
  if (t == null) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function cents(v: unknown): number | null {
  const n = num(v);
  return n == null ? null : Math.round(n * 100);
}

function date(v: unknown): string | null {
  const t = str(v);
  return t && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
}

function parte(p: Node | undefined): ParteFattura {
  const da: Node = p?.DatiAnagrafici ?? {};
  const a: Node = da.Anagrafica ?? {};
  const sede: Node = p?.Sede ?? {};
  const via = [str(sede.Indirizzo), str(sede.NumeroCivico)].filter(Boolean).join(" ");
  const citta = [str(sede.CAP), str(sede.Comune), str(sede.Provincia) ? `(${str(sede.Provincia)})` : null].filter(Boolean).join(" ");
  return {
    denominazione: str(a.Denominazione) ?? ([str(a.Nome), str(a.Cognome)].filter(Boolean).join(" ") || null),
    partitaIva: str(da.IdFiscaleIVA?.IdCodice),
    codiceFiscale: str(da.CodiceFiscale),
    sede: [via, citta].filter(Boolean).join(", ") || null,
  };
}

function documento(body: Node): DocumentoLetto {
  const doc: Node = body.DatiGenerali?.DatiGeneraliDocumento ?? {};
  const beni: Node = body.DatiBeniServizi ?? {};
  const righe: RigaLetta[] = ((beni.DettaglioLinee as Node[] | undefined) ?? []).map((l, i) => ({
    numero: num(l.NumeroLinea) ?? i + 1,
    descrizione: str(l.Descrizione) ?? "",
    quantita: num(l.Quantita),
    prezzoUnitarioCents: cents(l.PrezzoUnitario),
    aliquota: num(l.AliquotaIVA),
    natura: str(l.Natura),
    totaleCents: cents(l.PrezzoTotale),
  }));
  const riepilogo: RiepilogoIva[] = ((beni.DatiRiepilogo as Node[] | undefined) ?? []).map((r) => ({
    aliquota: num(r.AliquotaIVA),
    natura: str(r.Natura),
    imponibileCents: cents(r.ImponibileImporto),
    impostaCents: cents(r.Imposta),
  }));
  const pagamenti: PagamentoLetto[] = [];
  for (const dp of (body.DatiPagamento as Node[] | undefined) ?? []) {
    for (const p of (dp.DettaglioPagamento as Node[] | undefined) ?? []) {
      pagamenti.push({
        modalita: str(p.ModalitaPagamento),
        scadenza: date(p.DataScadenzaPagamento),
        importoCents: cents(p.ImportoPagamento),
        iban: str(p.IBAN),
      });
    }
  }
  return {
    tipoDocumento: str(doc.TipoDocumento),
    numero: str(doc.Numero),
    data: date(doc.Data),
    divisa: str(doc.Divisa),
    totaleCents: cents(doc.ImportoTotaleDocumento),
    righe,
    riepilogo,
    pagamenti,
  };
}

/** Estrae l'XML (da P7M se serve) e lo legge. Lancia FatturaParseError se il file non e leggibile. */
export function parseFatturaRicevuta(bytes: Buffer | Uint8Array, fileName = ""): FatturaLetta {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let xml: string;
  if (/\.p7m$/i.test(fileName) || buf[0] === 0x30) {
    try {
      xml = verifyP7m(buf).xml.toString("utf8");
    } catch {
      throw new FatturaParseError("File P7M non leggibile");
    }
  } else {
    xml = buf.toString("utf8");
  }
  let root: Node;
  try {
    root = parser.parse(xml) as Node;
  } catch {
    throw new FatturaParseError("XML malformato");
  }
  const fe: Node | undefined = root?.FatturaElettronica;
  if (!fe) throw new FatturaParseError("Il file non e una fattura elettronica");
  const head: Node = fe.FatturaElettronicaHeader ?? {};
  const bodies = (fe.FatturaElettronicaBody as Node[] | undefined) ?? [];
  if (bodies.length === 0) throw new FatturaParseError("La fattura non contiene documenti");
  return {
    fornitore: parte(head.CedentePrestatore),
    cliente: parte(head.CessionarioCommittente),
    documenti: bodies.map(documento),
  };
}

export const TIPO_DOCUMENTO: Record<string, string> = {
  TD01: "Fattura",
  TD02: "Acconto o anticipo su fattura",
  TD03: "Acconto o anticipo su parcella",
  TD04: "Nota di credito",
  TD05: "Nota di debito",
  TD06: "Parcella",
  TD16: "Integrazione fattura (reverse charge interno)",
  TD17: "Integrazione per acquisto di servizi dall'estero",
  TD24: "Fattura differita",
  TD25: "Fattura differita (triangolazione)",
  TD27: "Autofattura per autoconsumo o cessioni gratuite",
};

export const MODALITA_PAGAMENTO: Record<string, string> = {
  MP01: "Contanti",
  MP02: "Assegno",
  MP05: "Bonifico",
  MP08: "Carta di pagamento",
  MP12: "Ricevuta bancaria (RIBA)",
  MP19: "Addebito diretto SEPA",
  MP23: "PagoPA",
};
