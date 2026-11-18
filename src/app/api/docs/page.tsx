import Link from "next/link";
import { BookOpen, FileJson } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const ENDPOINTS: [string, string, string][] = [
  ["GET", "/api/v1/health", "Stato del servizio (pubblico)"],
  ["GET", "/api/v1/openapi.json", "Specifica OpenAPI 3.1 (pubblico)"],
  ["GET", "/api/v1/invoices", "Elenco fatture emesse (filtri stato, cursor)"],
  ["POST", "/api/v1/invoices", "Crea e invia una fattura (Idempotency-Key opzionale)"],
  ["GET", "/api/v1/invoices/{id}", "Dettaglio fattura con notifiche"],
  ["GET", "/api/v1/received-invoices", "Elenco fatture ricevute"],
  ["GET", "/api/v1/received-invoices/{id}/file", "File originale della fattura ricevuta"],
];

export default function ApiDocsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-6 py-16">
      <h1 className="flex items-center gap-2 text-2xl font-semibold">
        <BookOpen className="size-6" />
        Documentazione API
      </h1>
      <Card>
        <CardHeader>
          <CardTitle>Autenticazione</CardTitle>
          <CardDescription>Invia la chiave del tuo account nell&apos;header X-API-Key. Ogni chiave vede solo i dati del proprio account.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <a href="/api/v1/openapi.json">
              <FileJson />
              Apri openapi.json
            </a>
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Endpoint</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {ENDPOINTS.map(([m, path, d]) => (
            <div key={m + path} className="flex flex-col gap-1 border-b pb-3 last:border-0 last:pb-0">
              <p className="font-mono text-sm">
                <span className="font-semibold">{m}</span> {path}
              </p>
              <p className="text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </CardContent>
      </Card>
      <Button asChild variant="ghost">
        <Link href="/api">Torna alle chiavi API</Link>
      </Button>
    </main>
  );
}
