import { Badge } from "@/components/ui/badge";

type Tone = "default" | "secondary" | "destructive" | "outline" | "warning";

const STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "In coda", tone: "secondary" },
  queued: { label: "In coda", tone: "secondary" },
  signed: { label: "In coda", tone: "secondary" },
  sending: { label: "Invio in corso", tone: "secondary" },
  sent: { label: "Inviata", tone: "outline" },
  delivered: { label: "Consegnata", tone: "default" },
  rejected: { label: "Scartata", tone: "destructive" },
  not_delivered: { label: "Mancata consegna", tone: "warning" },
  accepted: { label: "Accettata", tone: "default" },
  refused: { label: "Rifiutata", tone: "destructive" },
  terms_expired: { label: "Termini scaduti", tone: "warning" },
  send_error: { label: "Errore invio", tone: "destructive" },
  send_unknown: { label: "Esito incerto", tone: "warning" },
  replaced: { label: "Sostituita", tone: "outline" },
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
  const s = STATUS[status] ?? { label: status, tone: "outline" as Tone };
  if (s.tone === "warning") {
    return (
      <Badge variant="outline" className="border-warning bg-warning/20 text-foreground">
        {s.label}
      </Badge>
    );
  }
  return <Badge variant={s.tone}>{s.label}</Badge>;
}
