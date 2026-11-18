import type { Metadata } from "next";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { forbidden } from "next/navigation";
import { requireSession } from "@/lib/session";
import { listTenants } from "@/server/tenants";
import { listUsers } from "@/server/users";
import { listApiKeys } from "@/server/api-keys";
import { RevokeKeyDialog } from "@/app/api/keys-client";
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


export const metadata: Metadata = { title: "Account" };

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireSession();
  if (session.user.role !== "admin") forbidden();
    const { q } = await searchParams;
    const term = (q ?? "").trim().toLowerCase();
    const [allTenants, users, keys] = await Promise.all([listTenants(session.scope), listUsers(session.scope), listApiKeys(session.scope)]);
    const tenants = term
      ? allTenants.filter(
          (t) =>
            t.denominazione.toLowerCase().includes(term) ||
            users.some((u) => u.tenantId === t.id && u.email.toLowerCase().includes(term)),
        )
      : allTenants;
    return (
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-16">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">Account</h1>
          <NewAccountDialog />
        </div>
        <form className="flex gap-2" role="search">
          <Input name="q" defaultValue={q ?? ""} placeholder="Cerca per nome azienda o email" aria-label="Cerca account" />
          <Button type="submit" variant="outline"><Search /> Cerca</Button>
        </form>
        {tenants.length === 0 && (
          <p className="text-muted-foreground">{term ? "Nessun account corrisponde alla ricerca." : "Nessun account cliente."}</p>
        )}
        {tenants.length > 0 && (
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle className="text-lg">Account clienti</CardTitle>
            </CardHeader>
            <CardContent className="max-w-full overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Denominazione</TableHead>
                    <TableHead>Partita IVA</TableHead>
                    <TableHead>Codice fiscale</TableHead>
                    <TableHead>Utenti</TableHead>
                    <TableHead>Stato</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenants.map((t) => {
                    const count = users.filter((u) => u.tenantId === t.id).length;
                    return (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">{t.denominazione}</TableCell>
                        <TableCell className="whitespace-nowrap">{t.partitaIva}</TableCell>
                        <TableCell className="whitespace-nowrap">{t.codiceFiscale ?? "-"}</TableCell>
                        <TableCell>{count}</TableCell>
                        <TableCell>
                          <Badge variant={t.activeUsersCount > 0 ? "secondary" : "destructive"}>
                            {t.activeUsersCount > 0 ? "Attivo" : "Disattivato"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
        {tenants.map((t) => {
          const tu = users.filter((u) => u.tenantId === t.id);
          return (
            <Card key={t.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
                  Utenti di {t.denominazione}
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
                          <Badge variant={u.disabled ? "destructive" : "secondary"}>
                            {u.disabled ? "Disattivato" : "Attivo"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <UserActions
                            userId={u.id}
                            email={u.email}
                            disabled={u.disabled}
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
        <Card>
          <CardHeader>
            <CardTitle>Chiavi API di tutti gli account</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {keys.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">Nessuna chiave API.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Prefisso</TableHead>
                    <TableHead>Stato</TableHead>
                    <TableHead className="text-right">Azioni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map((k) => (
                    <TableRow key={k.id}>
                      <TableCell>{k.tenantName ?? "-"}</TableCell>
                      <TableCell>{k.name}</TableCell>
                      <TableCell className="font-mono">{k.prefix}</TableCell>
                      <TableCell>
                        <Badge variant={k.revoked ? "destructive" : "secondary"}>{k.revoked ? "Revocata" : "Attiva"}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{!k.revoked && <RevokeKeyDialog id={k.id} name={k.name} />}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    );
}
