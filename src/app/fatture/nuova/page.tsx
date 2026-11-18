import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { getInvoicePrefill, listTenants } from "@/lib/server-api";
import { requireSession } from "@/lib/session";
import { InvoiceForm } from "./invoice-form";

export const metadata: Metadata = { title: "Nuova fattura" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ correggi?: string }> }) {
  const { correggi } = await searchParams;
  const { user, scope } = await requireSession("/fatture/nuova");
  const tenants = await listTenants(scope);
  // Fattura scartata da rifare: solo se è del proprio tenant e in stato Scartata, altrimenti form vuoto.
  const prefill = correggi && UUID.test(correggi) ? await getInvoicePrefill(scope, correggi) : null;
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
      <h1 className="text-3xl font-semibold">{prefill ? "Correggi e crea di nuovo" : "Nuova fattura"}</h1>
      <InvoiceForm
        key={prefill?.replacesId ?? "nuova"}
        idempotencyKey={randomUUID()}
        today={new Date().toISOString().slice(0, 10)}
        role={user.role}
        tenants={tenants}
        prefill={prefill ?? undefined}
      />
    </main>
  );
}
