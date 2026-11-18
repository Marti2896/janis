import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Pagina non trovata</CardTitle>
          <CardDescription>La pagina richiesta non esiste oppure non e disponibile per il tuo account.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/fatture">Vai alle fatture emesse</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
