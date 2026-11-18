"use client";

import { useRouter } from "next/navigation";
import { TableRow } from "@/components/ui/table";

/** Riga cliccabile: la navigazione per tastiera passa dal link nel numero. */
export function InvoiceRowLink({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <TableRow className="cursor-pointer" onClick={(ev) => {
        // Link e pulsanti dentro la riga (es. Scarica) hanno la loro azione.
        if ((ev.target as HTMLElement).closest("a, button")) return;
        router.push(href);
      }}>
      {children}
    </TableRow>
  );
}
