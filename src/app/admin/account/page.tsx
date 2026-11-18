import { requireSession } from "@/lib/session";
import { listTenants } from "@/server/tenants";
import { listUsers } from "@/server/users";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NewAccountDialog, UserActions } from "./account-client";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await requireSession();
  if (session.user.role !== "admin") {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <Alert variant="destructive">
          <AlertTitle>Accesso negato</AlertTitle>
          <AlertDescription>
            Questa pagina e riservata agli amministratori.
          </AlertDescription>
        </Alert>
      </main>
    );
  }
  try {
    const [tenants, users] = await Promise.all([listTenants(), listUsers()]);
    return (
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-16">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">Account</h1>
          <NewAccountDialog />
        </div>
        {tenants.length === 0 && (
          <p className="text-muted-foreground">Nessun account cliente.</p>
        )}
        {tenants.map((t) => {
          const tu = users.filter((u) => u.tenantId === t.id);
          return (
            <Card key={t.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {t.denominazione}
                  <Badge variant="secondary">P.IVA {t.partitaIva}</Badge>
                  {t.codiceFiscale && (
                    <Badge variant="outline">CF {t.codiceFiscale}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Utente</TableHead>
                      <TableHead>Stato</TableHead>
                      <TableHead className="text-right">Azioni</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tu.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell>{u.email}</TableCell>
                        <TableCell>
                          <Badge variant={u.disabledAt ? "destructive" : "secondary"}>
                            {u.disabledAt ? "Disattivato" : "Attivo"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <UserActions
                            userId={u.id}
                            email={u.email}
                            disabled={!!u.disabledAt}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          );
        })}
      </main>
    );
  } catch {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <Alert variant="destructive">
          <AlertTitle>Errore</AlertTitle>
          <AlertDescription>
            Impossibile caricare gli account. Ricarica la pagina.
          </AlertDescription>
        </Alert>
      </main>
    );
  }
}
