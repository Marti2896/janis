/** Traduzione degli eventi di audit in frasi leggibili (solo presentazione, nessuna dipendenza dal server). */

const NOTIFICA: Record<string, string> = {
  RC: "Consegnata",
  NS: "Scartata",
  MC: "Mancata consegna",
  NE: "Esito del committente",
  DT: "Termini scaduti",
  SE: "Scarto dell'esito",
};

const EVENTS: Record<string, string> = {
  "invoice.created": "Fattura creata",
  "invoice.transition": "Stato della fattura aggiornato",
  "invoice.repair_created": "Fattura ripristinata",
  "auth.login": "Accesso",
  "auth.logout": "Uscita",
  "auth.login_failed": "Tentativo di accesso non riuscito",
  "auth.login_locked": "Accesso bloccato per troppi tentativi",
  "auth.password_changed": "Password cambiata",
  "api_key.created": "Chiave API creata",
  "api_key.revoked": "Chiave API revocata",
  "api.invoice.post": "Fattura inviata da sistema esterno (API)",
  "tenant.created": "Account creato",
  "user.created": "Utente creato",
  "user.password_reset": "Password reimpostata",
  "certificate.uploaded": "Certificato caricato",
  "channel.settings_changed": "Impostazioni del canale modificate",
  "received_invoice.stored": "Fattura ricevuta",
  "received_invoice.assigned": "Fattura ricevuta assegnata a un account",
  "received_invoice.rejected": "Fattura ricevuta rifiutata",
  "notification.unknown_invoice": "Notifica per una fattura sconosciuta",
  "notification.incompatible_state": "Notifica ignorata",
  "notification.rejected": "Notifica rifiutata",
};

export function auditActionLabel(event: string, detail: Record<string, unknown>): string {
  if (event === "notification.applied") {
    const t = typeof detail.type === "string" ? detail.type : "";
    return `Notifica ricevuta: ${NOTIFICA[t] ?? t}`;
  }
  if (event === "notification.incompatible_state") {
    return "Notifica ignorata: arrivata dopo che la fattura aveva già un esito definitivo";
  }
  if (event === "notification.unknown_invoice") {
    const t = typeof detail.type === "string" ? detail.type : "";
    return `${EVENTS[event]}${t && NOTIFICA[t] ? ` (${NOTIFICA[t]})` : ""}`;
  }
  return EVENTS[event] ?? "Attività del sistema";
}

const ERROR_REASON: Record<string, string> = {
  "auth.login_failed": "Email o password non corretti",
  "auth.login_locked": "Troppi tentativi: accesso sospeso per 15 minuti",
  "received_invoice.rejected": "File non valido o non leggibile",
  "notification.rejected": "Notifica non valida",
  "api.invoice.post": "Invio non riuscito: dati non validi o nome file già usato",
};

export function auditErrorReason(event: string, detail: Record<string, unknown>): string | null {
  if (typeof detail.error === "string" && detail.error) return detail.error;
  return ERROR_REASON[event] ?? null;
}

export const AUDIT_CATEGORIES = [
  { value: "fatture", label: "Fatture" },
  { value: "accessi", label: "Accessi" },
  { value: "api", label: "API" },
] as const;

type Settings = { environment?: string; endpoints?: Record<string, string> };

/** Righe di dettaglio leggibili (valori precedenti e nuovi) per le modifiche alla configurazione del canale. */
export function auditChangeLines(event: string, detail: Record<string, unknown>, showUnchanged = false): string[] {
  if (event !== "channel.settings_changed") return [];
  const before = (detail.before ?? {}) as Settings;
  const after = (detail.after ?? {}) as Settings;
  const env = (v?: string) => (v === "production" ? "Produzione" : v === "demo" ? "Demo" : "-");
  const val = (v?: string) => (v ? v : "(vuoto)");
  const lines: string[] = [];
  if (before.environment !== after.environment) lines.push(`Ambiente: ${env(before.environment)} → ${env(after.environment)}`);
  for (const k of ["demo", "production"]) {
    const b = before.endpoints?.[k] ?? "";
    const a = after.endpoints?.[k] ?? "";
    if (a !== b) lines.push(`Endpoint ${k === "demo" ? "demo" : "produzione"}: ${val(b)} → ${val(a)}`);
  }
  if (lines.length === 0 && showUnchanged) {
    const ep = after.endpoints?.[after.environment === "production" ? "production" : "demo"] ?? "";
    lines.push(`Nessuna modifica. Ambiente ${env(after.environment)}, endpoint ${val(ep)}`);
  }
  return lines;
}
