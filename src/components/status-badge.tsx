import { Badge } from "@/components/ui/badge";

type Tone = "neutral" | "info" | "success-soft" | "warning" | "danger";

const STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "In coda", tone: "neutral" },
  queued: { label: "In coda", tone: "neutral" },
  signed: { label: "In coda", tone: "neutral" },
  sending: { label: "Invio in corso", tone: "neutral" },
  sent: { label: "Inviata", tone: "info" },
  delivered: { label: "Consegnata", tone: "success-soft" },
  rejected: { label: "Scartata", tone: "danger" },
  not_delivered: { label: "Mancata consegna", tone: "warning" },
  accepted: { label: "Accettata", tone: "success-soft" },
  refused: { label: "Rifiutata", tone: "danger" },
  terms_expired: { label: "Termini scaduti", tone: "warning" },
  send_error: { label: "Errore invio", tone: "danger" },
  send_unknown: { label: "Esito incerto", tone: "warning" },
  replaced: { label: "Sostituita", tone: "neutral" },
};

/** Stati selezionabili nel filtro della lista, nell'ordine della spec. */
export const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "queued", label: "In coda" },
  { value: "sent", label: "Inviata" },
  { value: "delivered", label: "Consegnata" },
  { value: "rejected", label: "Scartata" },
  { value: "not_delivered", label: "Mancata consegna" },
  { value: "accepted", label: "Accettata" },
  { value: "refused", label: "Rifiutata" },
  { value: "terms_expired", label: "Termini scaduti" },
  { value: "send_error", label: "Errore invio" },
  { value: "send_unknown", label: "Esito incerto" },
  { value: "replaced", label: "Sostituita" },
];

export function statusLabel(status: string): string {
  return STATUS[status]?.label ?? status;
}

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return <Badge variant={s.tone}>{s.label}</Badge>;
}
