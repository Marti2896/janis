import Link from "next/link";
import { FileX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ReceivedInvoiceNotFound() {
  return (
    <main className="mx-auto flex w-full min-w-0 max-w-7xl flex-1 flex-col gap-6 px-6 py-10 lg:px-10">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileX className="size-5" />
            Fattura non trovata
          </CardTitle>
          <CardDescription>La fattura richiesta non esiste oppure non è disponibile per il tuo account.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/ricevute">Torna alle fatture ricevute</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
