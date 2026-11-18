import Link from "next/link";
import { FileX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function InvoiceNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileX className="size-5" />
            Fattura non trovata
          </CardTitle>
          <CardDescription>La fattura richiesta non esiste oppure non e disponibile per il tuo account.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/fatture">Torna alle fatture emesse</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
