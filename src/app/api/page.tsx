import type { Metadata } from "next";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Chiavi API" };
import { listApiKeys } from "@/server/api-keys";
import { listTenants } from "@/server/tenants";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NewKeyDialog, RevokeKeyDialog } from "./keys-client";


const fmt = (d: Date | string | null) =>
  d ? new Date(d).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : "mai";

export default async function ApiPage() {
  const session = await requireSession();
  const isAdmin = session.user.role === "admin";
    const [keys, tenants] = await Promise.all([
      listApiKeys(session.scope),
      isAdmin ? listTenants(session.scope) : Promise.resolve([]),
    ]);
    return (
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-16">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">API</h1>
            <p className="text-sm text-muted-foreground">
              Le chiavi servono a collegare il tuo gestionale o CRM: crea una chiave e consegnala al tuo tecnico.
            </p>
          </div>
          <NewKeyDialog
            tenants={
              isAdmin
                ? tenants.map((t) => ({ id: t.id, label: t.denominazione }))
                : undefined
            }
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Usa una chiave nell&apos;header X-API-Key. Documentazione in{" "}
          <a className="underline" href="/api/docs">
            OpenAPI
          </a>
          .
        </p>
        <Card>
          <CardContent className="overflow-x-auto pt-6">
            {keys.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">
                Nessuna chiave API.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Prefisso</TableHead>
                    <TableHead>Creata il</TableHead>
                    <TableHead>Ultimo uso</TableHead>
                    <TableHead>Stato</TableHead>
                    <TableHead className="text-right">Azioni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map((k) => (
                    <TableRow key={k.id}>
                      <TableCell>{k.name}</TableCell>
                      <TableCell className="font-mono">{k.prefix}</TableCell>
                      <TableCell>{fmt(k.createdAt)}</TableCell>
                      <TableCell>{fmt(k.lastUsedAt)}</TableCell>
                      <TableCell>
                        <Badge variant={k.revoked ? "destructive" : "secondary"}>
                          {k.revoked ? "Revocata" : "Attiva"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {!k.revoked && <RevokeKeyDialog id={k.id} name={k.name} />}
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
}
