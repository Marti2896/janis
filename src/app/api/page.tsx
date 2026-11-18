import { requireSession } from "@/lib/session";
import { listApiKeys } from "@/server/api-keys";
import { listTenants } from "@/server/tenants";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

export const dynamic = "force-dynamic";

const fmt = (d: Date | string | null) =>
  d ? new Date(d).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : "mai";

export default async function ApiPage() {
  const session = await requireSession();
  const isAdmin = session.user.role === "admin";
  try {
    const [keys, tenants] = await Promise.all([
      listApiKeys(session.scope),
      isAdmin ? listTenants() : Promise.resolve([]),
    ]);
    return (
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-16">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">API</h1>
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
          <a className="underline" href="/api/v1/openapi.json">
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
                        <Badge variant={k.revokedAt ? "destructive" : "secondary"}>
                          {k.revokedAt ? "Revocata" : "Attiva"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {!k.revokedAt && <RevokeKeyDialog id={k.id} name={k.name} />}
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
            Impossibile caricare le chiavi API. Ricarica la pagina.
          </AlertDescription>
        </Alert>
      </main>
    );
  }
}
