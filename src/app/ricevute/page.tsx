import Link from "next/link";
import type { Metadata } from "next";
import { Download, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InvoiceRowLink } from "@/app/fatture/invoice-row-link";
import { requireSession } from "@/lib/session";
import { listReceived, listUnassigned } from "@/server/invoice-service";
import { listTenants } from "@/server/tenants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AssignDialog } from "./assign-dialog";


export const metadata: Metadata = { title: "Fatture ricevute" };

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
const fmtMoney = (v: number | null) =>
  v == null
    ? "-"
    : (v / 100).toLocaleString("it-IT", { style: "currency", currency: "EUR" });

const receivedLabel = (s: string) => (s === "received" ? "Ricevuta" : s === "unassigned" ? "Non assegnata" : s);

function numeroLabel(r: { numeri: string[]; numero: string | null; documenti: number }): string {
  const first = r.numeri[0] ?? r.numero ?? "-";
  return r.documenti > 1 ? `${first} e altre ${r.documenti - 1}` : first;
}

export default async function RicevutePage() {
  const session = await requireSession();
  const isAdmin = session.user.role === "admin";
    const [rows, unassigned, tenants] = await Promise.all([
      listReceived(session.scope),
      isAdmin ? listUnassigned(session.scope) : Promise.resolve([]),
      isAdmin ? listTenants(session.scope) : Promise.resolve([]),
    ]);
    return (
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-16">
        <h1 className="text-2xl font-semibold">Fatture ricevute</h1>

        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle>Non assegnate</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {unassigned.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nessuna fattura da assegnare.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ricevuta il</TableHead>
                      <TableHead>Fornitore</TableHead>
                      <TableHead>Numero</TableHead>
                      <TableHead>Intestata a</TableHead>
                      <TableHead className="text-right">Azione</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unassigned.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{fmtDate(r.receivedAt)}</TableCell>
                        <TableCell>{r.cedenteDenominazione ?? r.cedentePiva ?? "-"}</TableCell>
                        <TableCell>{numeroLabel(r)}</TableCell>
                        <TableCell>
                          <div className="font-medium">{r.cessionarioDenominazione ?? "-"}</div>
                          {(r.cessionarioPiva ?? r.cessionarioCf) && (
                            <div className="text-xs text-muted-foreground">
                              {r.cessionarioPiva ? `P.IVA ${r.cessionarioPiva}` : `C.F. ${r.cessionarioCf}`}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <AssignDialog
                            id={r.id}
                            recipient={{ denominazione: r.cessionarioDenominazione, piva: r.cessionarioPiva, cf: r.cessionarioCf }}
                            supplier={r.cedenteDenominazione ?? r.cedentePiva ?? "-"}
                            tenants={tenants.map((t) => ({ id: t.id, nome: t.denominazione, piva: t.partitaIva, cf: t.codiceFiscale }))}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="overflow-x-auto pt-6">
            {rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <Inbox className="size-6" />
                <p>Nessuna fattura ricevuta.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data ricezione</TableHead>
                    <TableHead>Fornitore</TableHead>
                    {isAdmin && <TableHead>Account</TableHead>}
                    <TableHead>Numero</TableHead>
                    <TableHead>Importo</TableHead>
                    <TableHead>Stato</TableHead>
                    <TableHead className="text-right">File</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <InvoiceRowLink key={r.id} href={`/ricevute/${r.id}`}>
                      <TableCell className="whitespace-nowrap">
                        <Link
                          href={`/ricevute/${r.id}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {fmtDate(r.receivedAt)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{r.cedenteDenominazione ?? r.cedentePiva ?? "-"}</div>
                        {r.cedenteDenominazione && r.cedentePiva && (
                          <div className="text-xs text-muted-foreground">P.IVA {r.cedentePiva}</div>
                        )}
                      </TableCell>
                      {isAdmin && <TableCell>{r.tenantName ?? "-"}</TableCell>}
                      <TableCell>
                        <div>{numeroLabel(r)}</div>
                        {r.documenti > 1 && <Badge variant="outline">{r.documenti} fatture</Badge>}
                      </TableCell>
                      <TableCell>{fmtMoney(r.importoTotaleCents)}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{receivedLabel(r.stato)}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="outline" size="sm">
                          <a href={`/ricevute/${r.id}/download`} aria-label={`Scarica la fattura ${r.numero ?? ""}`}>
                            <Download /> Scarica
                          </a>
                        </Button>
                      </TableCell>
                    </InvoiceRowLink>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    );
}
