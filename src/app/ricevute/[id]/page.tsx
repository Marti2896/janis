import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCircle, ArrowLeft, Download } from "lucide-react";
import { requireSession } from "@/lib/session";
import { getReceived } from "@/server/invoice-service";
import {
  FatturaParseError,
  MODALITA_PAGAMENTO,
  TIPO_DOCUMENTO,
  parseFatturaRicevuta,
  type FatturaLetta,
  type ParteFattura,
} from "@/sdi/fatturapa/parse";
import { formatDateShort, formatEuro } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Fattura ricevuta" };

const money = (c: number | null) => (c == null ? "-" : formatEuro(c));
const qty = (n: number | null) => (n == null ? "-" : n.toLocaleString("it-IT", { maximumFractionDigits: 3 }));

function Anagrafica({ title, p }: { title: string; p: ParteFattura }) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-sm">
        <p className="break-words font-medium">{p.denominazione ?? "-"}</p>
        {p.partitaIva && <p className="text-muted-foreground">P.IVA {p.partitaIva}</p>}
        {p.codiceFiscale && <p className="text-muted-foreground">CF {p.codiceFiscale}</p>}
        {p.sede && <p className="text-muted-foreground">{p.sede}</p>}
      </CardContent>
    </Card>
  );
}

export default async function RicevutaDettaglioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const r = await getReceived(session.scope, id);
  if (!r) notFound();

  let fattura: FatturaLetta | null = null;
  try {
    fattura = parseFatturaRicevuta(r.bytes, r.fileName);
  } catch (err) {
    if (!(err instanceof FatturaParseError)) console.error("parseFatturaRicevuta", err);
  }

  const tech: [string, string][] = [
    ["Numero SdI", String(r.sdiIdentifier)],
    ["Nome file", r.fileName],
    ["SHA-256", r.sha256],
  ];

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
      <Button asChild variant="ghost" className="w-fit">
        <Link href="/ricevute">
          <ArrowLeft />
          Fatture ricevute
        </Link>
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-3xl font-semibold">Fattura {r.numero ?? "ricevuta"}</h1>
          <p className="text-muted-foreground">
            {r.cedenteDenominazione ?? r.cedentePiva ?? "Fornitore sconosciuto"} - ricevuta il{" "}
            {formatDateShort(r.receivedAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{r.stato === "received" ? "Ricevuta" : "Non assegnata"}</Badge>
          <Button asChild>
            <a href={`/ricevute/${r.id}/download`}>
              <Download /> Scarica file originale
            </a>
          </Button>
        </div>
      </div>

      {!fattura && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Contenuto non leggibile</AlertTitle>
          <AlertDescription>
            <p>Non è stato possibile leggere il contenuto della fattura: scarica il file originale.</p>
          </AlertDescription>
        </Alert>
      )}

      {fattura && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Anagrafica title="Fornitore" p={fattura.fornitore} />
            <Anagrafica title="Cliente" p={fattura.cliente} />
          </div>
          {fattura.documenti.map((d, i) => (
            <section key={i} className="flex min-w-0 flex-col gap-4">
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle className="text-lg">
                    {fattura.documenti.length > 1 ? `Documento ${i + 1} di ${fattura.documenti.length}` : "Documento"}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid gap-4 sm:grid-cols-3">
                    <div className="flex flex-col gap-1">
                      <dt className="text-sm text-muted-foreground">Tipo</dt>
                      <dd className="font-medium">{(d.tipoDocumento && TIPO_DOCUMENTO[d.tipoDocumento]) ?? d.tipoDocumento ?? "-"}</dd>
                    </div>
                    <div className="flex flex-col gap-1">
                      <dt className="text-sm text-muted-foreground">Numero</dt>
                      <dd className="font-medium">{d.numero ?? "-"}</dd>
                    </div>
                    <div className="flex flex-col gap-1">
                      <dt className="text-sm text-muted-foreground">Data</dt>
                      <dd className="font-medium">{formatDateShort(d.data)}</dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>

              <Card className="min-w-0 max-w-full">
                <CardHeader>
                  <CardTitle className="text-lg">Righe</CardTitle>
                </CardHeader>
                <CardContent className="min-w-0 max-w-full">
                  <div className="max-w-full overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Descrizione</TableHead>
                          <TableHead className="text-right">Quantità</TableHead>
                          <TableHead className="text-right">Prezzo</TableHead>
                          <TableHead className="text-right">IVA</TableHead>
                          <TableHead className="text-right">Totale</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {d.righe.map((riga) => (
                          <TableRow key={riga.numero}>
                            <TableCell>{riga.descrizione}</TableCell>
                            <TableCell className="whitespace-nowrap text-right">{qty(riga.quantita)}</TableCell>
                            <TableCell className="whitespace-nowrap text-right">{money(riga.prezzoUnitarioCents)}</TableCell>
                            <TableCell className="whitespace-nowrap text-right">
                              {riga.aliquota ? `${riga.aliquota.toLocaleString("it-IT")}%` : (riga.natura ?? "0%")}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right">{money(riga.totaleCents)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle className="text-lg">Riepilogo IVA e totale</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="max-w-full overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Aliquota</TableHead>
                          <TableHead className="text-right">Imponibile</TableHead>
                          <TableHead className="text-right">Imposta</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {d.riepilogo.map((x, k) => (
                          <TableRow key={k}>
                            <TableCell>{x.aliquota ? `${x.aliquota.toLocaleString("it-IT")}%` : (x.natura ?? "0%")}</TableCell>
                            <TableCell className="whitespace-nowrap text-right">{money(x.imponibileCents)}</TableCell>
                            <TableCell className="whitespace-nowrap text-right">{money(x.impostaCents)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <p className="text-right text-lg font-semibold">Totale documento: {money(d.totaleCents)}</p>
                </CardContent>
              </Card>

              {d.pagamenti.length > 0 && (
                <Card className="min-w-0 max-w-full">
                  <CardHeader>
                    <CardTitle className="text-lg">Pagamento</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="max-w-full overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Modalità</TableHead>
                            <TableHead>Scadenza</TableHead>
                            <TableHead className="text-right">Importo</TableHead>
                            <TableHead>IBAN</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {d.pagamenti.map((p, k) => (
                            <TableRow key={k}>
                              <TableCell>{(p.modalita && MODALITA_PAGAMENTO[p.modalita]) ?? p.modalita ?? "-"}</TableCell>
                              <TableCell className="whitespace-nowrap">{formatDateShort(p.scadenza)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right">{money(p.importoCents)}</TableCell>
                              <TableCell className="font-mono text-xs">{p.iban ?? "-"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </section>
          ))}
        </>
      )}

      <Card className="min-w-0">
        <CardContent>
          <details>
            <summary className="cursor-pointer text-sm font-medium">Dettagli tecnici</summary>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              {tech.map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="break-all text-sm">{v}</dd>
                </div>
              ))}
            </dl>
          </details>
        </CardContent>
      </Card>
    </main>
  );
}
