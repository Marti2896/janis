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

const OUTCOME: Record<string, string> = {
  EC01: "Accettata dal committente",
  EC02: "Rifiutata dal committente",
};

export function outcomeLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return OUTCOME[code] ?? null;
}

const LABELS: [string, string][] = [
  ["XML validato e firmato CAdES-BES", "File controllato e firmato digitalmente"],
];

export function eventLabel(label: string): string {
  let out = label;
  for (const [from, to] of LABELS) out = out.replace(from, to);
  return out;
}
