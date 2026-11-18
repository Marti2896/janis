import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { listTenants } from "@/lib/server-api";
import { requireSession } from "@/lib/session";
import { InvoiceForm } from "./invoice-form";

export const metadata: Metadata = { title: "Nuova fattura" };

export default async function NewInvoicePage() {
  const { user, scope } = await requireSession("/fatture/nuova");
  const tenants = await listTenants(scope);
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
      <h1 className="text-3xl font-semibold">Nuova fattura</h1>
      <InvoiceForm
        idempotencyKey={randomUUID()}
        today={new Date().toISOString().slice(0, 10)}
        role={user.role}
        tenants={tenants}
      />
    </main>
  );
}
