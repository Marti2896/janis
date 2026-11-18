import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { requireSession } from "@/lib/session";
import { getReceived } from "@/server/invoice-service";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function RicevutaDettaglioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const r = await getReceived(session.scope, id);
  if (!r) notFound();
  const rows: [string, string][] = [
    ["Ricevuta il", new Date(r.receivedAt).toLocaleString("it-IT")],
    ["Fornitore (P.IVA)", r.cedentePiva ?? "-"],
    ["Numero", r.numero ?? "-"],
    ["Data fattura", r.data ? String(r.data).slice(0, 10) : "-"],
    [
      "Importo",
      r.importo == null
        ? "-"
        : Number(r.importo).toLocaleString("it-IT", {
            style: "currency",
            currency: "EUR",
          }),
    ],
    ["IdentificativoSdI", String(r.sdiIdentifier)],
    ["Nome file", r.fileName],
    ["SHA-256", r.sha256],
  ];
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-16">
      <Button asChild variant="ghost" size="sm">
        <Link href="/ricevute">Torna alle fatture ricevute</Link>
      </Button>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Fattura ricevuta</CardTitle>
          <Badge variant="secondary">{r.stato}</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-3 sm:grid-cols-2">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="break-all text-sm">{v}</dd>
              </div>
            ))}
          </dl>
          <Button asChild>
            <a href={`/ricevute/${r.id}/download`}>
              <Download /> Scarica file originale
            </a>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
