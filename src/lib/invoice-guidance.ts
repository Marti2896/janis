/** Frasi guida per stato fattura e traduzioni dello storico (solo presentazione). */

export const STATUS_GUIDANCE: Record<string, string> = {
  draft: "La fattura è pronta e verrà inviata appena il canale è attivo. Non devi fare nulla.",
  signed: "La fattura è pronta e verrà inviata appena il canale è attivo. Non devi fare nulla.",
  sending: "L'invio al Sistema di Interscambio è in corso. Non devi fare nulla.",
  sent: "La fattura è stata inviata al Sistema di Interscambio: attendi l'esito della consegna.",
  delivered: "La fattura è stata consegnata al cliente. Non devi fare nulla.",
  rejected: "Il Sistema di Interscambio ha rifiutato il file: correggi gli errori indicati e crea una nuova fattura.",
  not_delivered:
    "Il destinatario non è raggiungibile: la fattura è comunque valida e disponibile nella sua area riservata dell'Agenzia delle Entrate. Avvisa il cliente.",
  accepted: "Il cliente ha accettato la fattura. Non devi fare nulla.",
  refused: "Il cliente ha rifiutato la fattura: contattalo; se serve emetti una nota di credito.",
  terms_expired: "Il cliente non ha risposto entro 15 giorni: la fattura è considerata ricevuta.",
  send_error: "L'invio non è riuscito: controlla i dati e crea di nuovo la fattura, oppure contatta l'assistenza.",
  send_unknown: "Non sappiamo se l'invio sia andato a buon fine: attendi la notifica del Sistema di Interscambio prima di reinviare.",
};

STATUS_GUIDANCE.replaced = "Questa fattura è stata rifatta: il numero è passato alla nuova fattura.";

export const NOTIFICATION_LABEL: Record<string, string> = {
  RC: "Ricevuta di consegna",
  NS: "Notifica di scarto",
  MC: "Mancata consegna",
  NE: "Esito del cliente",
  DT: "Decorrenza termini",
  SE: "Scarto dell'esito del cliente",
};

/** Cosa fare per i codici di scarto più frequenti; per gli altri, una frase generale. */
const SCARTO_ADVICE: Record<string, string> = {
  "00200": "Il file non rispetta il formato: controlla i dati e crea di nuovo la fattura.",
  "00300": "Il codice identificativo del cedente non è valido: controlla la Partita IVA del tuo account.",
  "00301": "Il codice identificativo del cedente non è valido: controlla la Partita IVA del tuo account.",
  "00305": "La Partita IVA del cedente non esiste: controlla i dati del tuo account.",
  "00311": "Il codice destinatario non è valido: controlla il codice o la PEC del cliente e crea di nuovo la fattura.",
  "00312": "Il codice destinatario non è valido: controlla il codice o la PEC del cliente e crea di nuovo la fattura.",
  "00313": "La Partita IVA del cessionario non è valida: controlla i dati del cliente.",
  "00400": "La data o il numero della fattura non sono corretti: controlla e crea di nuovo la fattura.",
  "00404": "Questa fattura risulta già inviata: controlla se esiste già una fattura con lo stesso numero.",
  "00417": "Manca la Partita IVA o il codice fiscale del cliente: inseriscili e crea di nuovo la fattura.",
};

export function scartoAdvice(code: string): string {
  return SCARTO_ADVICE[code] ?? "Il Sistema di Interscambio ha rifiutato il file: controlla i dati indicati e crea di nuovo la fattura.";
}

/** Riga leggibile per un errore di scarto: prima la spiegazione, poi il codice tra parentesi. */
export function scartoLine(e: { codice: string; descrizione: string }): string {
  return `${e.descrizione} (${e.codice})`;
}

/**
 * Messaggio per Stato canale a partire dalla causale registrata nello storico.
 * Es. «Mancata consegna: Impossibile recapitare...» diventa una frase unica senza ripetizioni.
 */
export function errorSummary(status: string, causale: string | null | undefined): string {
  const c = (causale ?? "").trim();
  if (status === "not_delivered") return "non consegnata. Il file non è stato recapitato al cliente.";
  if (status === "rejected") {
    const m = /^Notifica di scarto:\s*(.*)$/i.exec(c);
    const list = (m?.[1] ?? "").split(/;\s*/).filter(Boolean);
    const parts = list.map((x) => {
      const mm = /^(\d{4,5})\s+(.*)$/.exec(x);
      return mm ? scartoLine({ codice: mm[1], descrizione: mm[2] }) : x;
    });
    return `scartata dal Sistema di Interscambio${parts.length ? `: ${parts.join("; ")}` : ""}.`;
  }
  if (status === "send_error") return `invio non riuscito${c ? `: ${c}` : ""}.`;
  return `${statusWord(status)}.`;
}

function statusWord(status: string): string {
  return status === "send_unknown" ? "esito dell'invio incerto" : status;
}

const OUTCOME: Record<string, string> = {
  EC01: "Accettata dal cliente",
  EC02: "Rifiutata dal cliente",
};

export function outcomeLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return OUTCOME[code] ?? null;
}

const LABELS: [string, string][] = [
  ["XML validato e firmato CAdES-BES", "File controllato e firmato digitalmente"],
  ["Notifica esito committente", "Risposta del cliente"],
  ["Scarto dell'esito committente", "Risposta del cliente non accettata dal Sistema di Interscambio"],
];

export function eventLabel(label: string): string {
  let out = label;
  for (const [from, to] of LABELS) out = out.replace(from, to);
  return out;
}
