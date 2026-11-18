import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, Download, RotateCcw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { NOTIFICATION_LABEL, STATUS_GUIDANCE, eventLabel, outcomeLabel, scartoAdvice, scartoLine } from "@/lib/invoice-guidance";
import { formatDate, formatDateTime, formatEuro } from "@/lib/format";
import { getInvoiceDetail } from "@/lib/server-api";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Dettaglio fattura" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ coda?: string }>;
}) {
  const { id } = await params;
  await searchParams;
  const { scope } = await requireSession(`/fatture/${id}`);
  // Id malformato o di un altro tenant: stessa risposta, nessuna rivelazione.
  if (!UUID.test(id)) notFound();
  const invoice = await getInvoiceDetail(scope, id);
  if (!invoice) notFound();

  const fields: [string, string][] = [
    ["Numero", invoice.numero],
    ["Data", formatDate(invoice.data)],
    ["Cedente", invoice.cedente],
    ["Cliente", invoice.cessionario],
    ["Importo", formatEuro(invoice.importoCents)],
  ];
  if (invoice.ambiente) fields.push(["Ambiente", invoice.ambiente]);
  if (invoice.sdiIdentifier) fields.push(["Numero SdI", invoice.sdiIdentifier]);

  // Una notifica e il cambio di stato che provoca arrivano nello stesso istante: si mostra una sola voce.
  const notifTimes = invoice.events.filter((e) => e.kind === "notifica").map((e) => new Date(e.at).getTime());
  const events = invoice.events.filter(
    (e) => e.kind !== "stato" || !notifTimes.some((t) => Math.abs(t - new Date(e.at).getTime()) <= 2000),
  );
  const guidance = STATUS_GUIDANCE[invoice.status];
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
      <Button asChild variant="ghost" className="w-fit">
        <Link href="/fatture">
          <ArrowLeft />
          Fatture emesse
        </Link>
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold">Fattura {invoice.numero}</h1>
        <StatusBadge status={invoice.status} />
      </div>
      {guidance && <p className="-mt-2 text-muted-foreground">{guidance}</p>}

      {invoice.status === "rejected" && (
        <Button asChild className="w-fit">
          <Link href={`/fatture/nuova?correggi=${invoice.id}`}>
            <RotateCcw />
            Correggi e crea di nuovo
          </Link>
        </Button>
      )}
      {invoice.replacedBy && (
        <Alert>
          <AlertDescription>
            <p>
              Questa fattura è stata sostituita da una nuova fattura con lo stesso numero.{" "}
              <Link href={`/fatture/${invoice.replacedBy}`} className="underline underline-offset-4">
                Apri la nuova fattura
              </Link>
            </p>
          </AlertDescription>
        </Alert>
      )}
      {invoice.replaces && (
        <p className="text-sm text-muted-foreground">
          Sostituisce una fattura scartata dal Sistema di Interscambio:{" "}
          <Link href={`/fatture/${invoice.replaces}`} className="underline underline-offset-4">
            vedi la fattura scartata
          </Link>
          .
        </p>
      )}

      {(invoice.status === "draft" || invoice.status === "signed") && (
        <Alert variant="warning">
          <Clock />
          <AlertTitle>Fattura in coda</AlertTitle>
          <AlertDescription>
            <p>
              Fattura salvata e in attesa di invio: il collegamento al Sistema di Interscambio non è ancora attivo. Resta in coda
              finché il canale non viene attivato.
            </p>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Dati principali</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid gap-4 sm:grid-cols-2">
            {fields.map(([k, v]) => (
              <div key={k} className="flex flex-col gap-1">
                <dt className="text-sm text-muted-foreground">{k}</dt>
                <dd className="break-words font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          {invoice.hasFile && (
            <Button asChild variant="outline" className="w-fit">
              <a href={`/fatture/${invoice.id}/download`}>
                <Download />
                Scarica XML firmato
              </a>
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Storico</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-muted-foreground">Nessun evento registrato.</p>
          ) : (
            <ol className="flex flex-col border-l">
              {events.map((e, i) => (
                <li key={`${e.at}-${i}`} className="relative flex flex-col gap-1 pb-6 pl-6 last:pb-0">
                  <span className="absolute top-1.5 -left-1.5 size-3 rounded-full border bg-primary" />
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">
                      {e.kind === "invio" ? "Invio" : e.kind === "notifica" ? ((e.type && NOTIFICATION_LABEL[e.type]) ?? "Notifica") : "Cambio stato"}
                    </Badge>
                    {e.label && <span className="font-medium">{eventLabel(e.label)}</span>}
                  </div>
                  <time className="text-sm text-muted-foreground">{formatDateTime(e.at)}</time>
                  {outcomeLabel(e.outcome) && <p className="text-sm">{outcomeLabel(e.outcome)}</p>}
                  {e.errors?.length ? (
                    <ul className="flex flex-col gap-1 text-sm">
                      {e.errors.map((x) => (
                        <li key={x.codice}>
                          <span className="text-destructive">{scartoLine(x)}</span>
                          <span className="block text-muted-foreground">{scartoAdvice(x.codice)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    e.error && <p className="text-sm text-destructive">{e.error}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
