import { requireSession } from "@/lib/session";
import { listCertificates } from "@/server/certificates";
import { CertificateBadge } from "@/components/certificate-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UploadDialog } from "./upload-dialog";

export const dynamic = "force-dynamic";

export default async function CertificatiPage() {
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
    const certs = await listCertificates();
    return (
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-16">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">Certificati</h1>
          <UploadDialog />
        </div>
        <Card>
          <CardContent className="overflow-x-auto pt-6">
            {certs.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">
                Nessun certificato configurato.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Soggetto</TableHead>
                    <TableHead>Emittente</TableHead>
                    <TableHead>Ambiente</TableHead>
                    <TableHead>Scadenza</TableHead>
                    <TableHead>Stato</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {certs.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>{c.subject}</TableCell>
                      <TableCell>{c.issuer}</TableCell>
                      <TableCell>{c.environment}</TableCell>
                      <TableCell>
                        {new Date(c.notAfter).toLocaleDateString("it-IT")}
                      </TableCell>
                      <TableCell>
                        <CertificateBadge notAfter={c.notAfter} />
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
            Impossibile caricare i certificati. Ricarica la pagina.
          </AlertDescription>
        </Alert>
      </main>
    );
  }
}
