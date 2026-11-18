import { forbidden } from "next/navigation";
import { requireSession } from "@/lib/session";
import { listCertificates } from "@/server/certificates";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { CertificateBadge, certificateLevel } from "@/components/certificate-badge";
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


export const metadata: Metadata = { title: "Certificati" };

/** Nome comune (CN) di un distinguished name; se manca, il DN intero. */
function commonName(dn: string): string {
  return /(?:^|,\s*)CN=([^,]+)/.exec(dn)?.[1]?.trim() ?? dn;
}

export default async function CertificatiPage() {
  const session = await requireSession();
  if (session.user.role !== "admin") forbidden();
    const certs = await listCertificates(session.scope);
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
                      <TableCell title={c.subject}>{commonName(c.subject)}</TableCell>
                      <TableCell title={c.issuer}>{commonName(c.issuer)}</TableCell>
                      <TableCell>{c.environment}</TableCell>
                      <TableCell>
                        {new Date(c.notAfter).toLocaleDateString("it-IT")}
                      </TableCell>
                      <TableCell>
                        {certificateLevel(c.notAfter) === "ok" ? (
                          <Badge variant="success">Valido</Badge>
                        ) : (
                          <CertificateBadge notAfter={c.notAfter} />
                        )}
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
