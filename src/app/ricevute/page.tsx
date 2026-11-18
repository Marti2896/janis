import Link from "next/link";
import { Inbox } from "lucide-react";
import { requireSession } from "@/lib/session";
import { listReceived, listUnassigned } from "@/server/invoice-service";
import { listTenants } from "@/server/tenants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AssignDialog } from "./assign-dialog";

export const dynamic = "force-dynamic";

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
const fmtMoney = (v: number | string | null) =>
  v == null
    ? "-"
    : Number(v).toLocaleString("it-IT", { style: "currency", currency: "EUR" });

export default async function RicevutePage() {
  const session = await requireSession();
  const isAdmin = session.user.role === "admin";
  try {
    const [rows, unassigned, tenants] = await Promise.all([
      listReceived(session.scope),
      isAdmin ? listUnassigned(session.scope) : Promise.resolve([]),
      isAdmin ? listTenants() : Promise.resolve([]),
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
                      <TableHead className="text-right">Azione</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unassigned.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{fmtDate(r.receivedAt)}</TableCell>
                        <TableCell>{r.cedentePiva}</TableCell>
                        <TableCell>{r.numero ?? "-"}</TableCell>
                        <TableCell className="text-right">
                          <AssignDialog
                            id={r.id}
                            tenants={tenants.map((t) => ({
                              id: t.id,
                              label: t.denominazione,
                            }))}
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
                    <TableHead>Numero</TableHead>
                    <TableHead>Importo</TableHead>
                    <TableHead>Stato</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link
                          href={`/ricevute/${r.id}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {fmtDate(r.receivedAt)}
                        </Link>
                      </TableCell>
                      <TableCell>{r.cedentePiva}</TableCell>
                      <TableCell>{r.numero ?? "-"}</TableCell>
                      <TableCell>{fmtMoney(r.importo)}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{r.stato}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    );
  } catch {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <Alert variant="destructive">
          <AlertTitle>Errore</AlertTitle>
          <AlertDescription>
            Impossibile caricare le fatture ricevute. Ricarica la pagina per
            riprovare.
          </AlertDescription>
        </Alert>
      </main>
    );
  }
}
