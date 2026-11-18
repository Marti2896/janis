/**
 * Modello della fattura FPR12 (ordinaria, TD01). Tutti gli importi sono interi:
 * centesimi per i prezzi, millesimi per le quantita, punti base per le aliquote
 * (2200 = 22,00%). Nessun float nei calcoli.
 */

export type EsigibilitaIva = "I" | "D" | "S";

export interface Sede {
  indirizzo: string;
  cap: string;
  comune: string;
  provincia?: string;
  nazione: string;
}

export interface Cedente {
  idPaese: string;
  partitaIva: string;
  codiceFiscale?: string;
  denominazione: string;
  /** Es. RF01 (ordinario). */
  regimeFiscale: string;
  sede: Sede;
}

export interface Cessionario {
  idPaese?: string;
  partitaIva?: string;
  codiceFiscale?: string;
  denominazione: string;
  sede: Sede;
}

export interface RigaFattura {
  descrizione: string;
  /** Quantita in millesimi (1000 = 1 unita). Default 1000. */
  quantitaMilli?: number;
  /** Prezzo unitario in centesimi. */
  prezzoUnitarioCents: number;
  /** Aliquota IVA in punti base (2200 = 22%). */
  aliquotaBp: number;
  /** Obbligatoria quando l'aliquota e 0. N6.x = reverse charge. */
  natura?: string;
  /** Obbligatorio con Natura (reverse charge incluso). */
  riferimentoNormativo?: string;
  /** I immediata, D differita, S scissione dei pagamenti (split payment). */
  esigibilita?: EsigibilitaIva;
}

export interface Pagamento {
  /** TP01 rate, TP02 completo, TP03 anticipo. */
  condizioni: "TP01" | "TP02" | "TP03";
  /** Es. MP05 bonifico. */
  modalita: string;
  iban?: string;
}

export interface FatturaModel {
  cedente: Cedente;
  cessionario: Cessionario;
  /** 7 caratteri alfanumerici con FPR12 ("0000000" se serve la PEC), 6 con FPA12 (codice IPA). */
  codiceDestinatario: string;
  pecDestinatario?: string;
  /** FPR12 (privati, default) o FPA12 (pubblica amministrazione). */
  formato?: "FPR12" | "FPA12";
  /** 5 caratteri alfanumerici. */
  progressivoInvio: string;
  tipoDocumento: "TD01" | "TD04";
  divisa?: string;
  /** YYYY-MM-DD */
  data: string;
  numero: string;
  causale?: string;
  righe: RigaFattura[];
  pagamento?: Pagamento;
}

export interface BuildOptions {
  /** Id della fattura rifiutata/in errore che questa sostituisce (Flusso D). */
  replacesInvoiceId?: string;
}

export interface FieldError {
  path: string;
  message: string;
}

export type BuildResult =
  | { ok: true; xml: string; nomeFile: string; replacesInvoiceId?: string }
  | { ok: false; errors: FieldError[] };

export type ValidationResult = { ok: true } | { ok: false; errors: FieldError[] };
