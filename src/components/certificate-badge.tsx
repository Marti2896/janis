import { Badge } from "@/components/ui/badge";

export type CertificateLevel = "expired" | "critical" | "warning" | "ok";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Soglie: scaduto o entro 7 giorni = rosso, entro 30 giorni = giallo, oltre = nessun badge. */
export function certificateLevel(
  notAfter: Date | string,
  now: Date = new Date(),
): CertificateLevel {
  const days = (new Date(notAfter).getTime() - now.getTime()) / DAY_MS;
  if (days < 0) return "expired";
  if (days <= 7) return "critical";
  if (days <= 30) return "warning";
  return "ok";
}

export function CertificateBadge({
  notAfter,
  now,
}: {
  notAfter: Date | string;
  now?: Date;
}) {
  const level = certificateLevel(notAfter, now);
  if (level === "ok") return null;
  if (level === "expired") return <Badge variant="danger">Scaduto</Badge>;
  if (level === "critical")
    return <Badge variant="danger">Scade entro 7 giorni</Badge>;
  return <Badge variant="warning">Scade entro 30 giorni</Badge>;
}
