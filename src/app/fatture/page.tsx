import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { formatDate, formatEuro } from "@/lib/format";
import { listInvoices, listTenants, type Scope } from "@/lib/server-api";
import { requireSession } from "@/lib/session";
import { InvoiceFilters } from "./invoice-filters";
import { InvoiceRowLink } from "./invoice-row-link";

export const metadata: Metadata = { title: "Fatture emesse" };

type SearchParams = Promise<{ stato?: string; account?: string }>;

function InvoicesSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Caricamento fatture">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

async function InvoicesTable({ scope, searchParams }: { scope: Scope; searchParams: SearchParams }) {
  const { stato, account } = await searchParams;
  const rows = await listInvoices(scope, {
    stato: stato || undefined,
    tenantId: scope.role === "admin" ? account || undefined : undefined,
  });

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <p className="text-muted-foreground">
          {stato || account ? "Nessuna fattura corrisponde ai filtri." : "Nessuna fattura emessa. Crea la prima fattura."}
        </p>
        <Button asChild>
          <Link href="/fatture/nuova">
            <FilePlus2 />
            Nuova fattura
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Numero</TableHead>
          <TableHead>Data</TableHead>
          <TableHead>Cessionario</TableHead>
          <TableHead className="text-right">Importo</TableHead>
          <TableHead>Stato</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <InvoiceRowLink key={r.id} href={`/fatture/${r.id}`}>
            <TableCell className="font-medium">
              <Link href={`/fatture/${r.id}`} className="underline-offset-4 hover:underline">
                {r.numero}
              </Link>
            </TableCell>
            <TableCell>{formatDate(r.data)}</TableCell>
            <TableCell>{r.cessionario}</TableCell>
            <TableCell className="text-right">{formatEuro(r.importoCents)}</TableCell>
            <TableCell>
              <StatusBadge status={r.status} />
            </TableCell>
          </InvoiceRowLink>
        ))}
      </TableBody>
    </Table>
  );
}

export default async function FatturePage({ searchParams }: { searchParams: SearchParams }) {
  const { scope } = await requireSession("/fatture");
  const tenants = scope.role === "admin" ? await listTenants(scope) : undefined;
  const key = JSON.stringify(await searchParams);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold">Fatture emesse</h1>
        <Button asChild>
          <Link href="/fatture/nuova">
            <FilePlus2 />
            Nuova fattura
          </Link>
        </Button>
      </div>
      <InvoiceFilters tenants={tenants} />
      <Card>
        <CardContent>
          <Suspense key={key} fallback={<InvoicesSkeleton />}>
            <InvoicesTable scope={scope} searchParams={searchParams} />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}
