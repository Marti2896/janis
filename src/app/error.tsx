"use client";

import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-6 py-16">
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>Errore</AlertTitle>
        <AlertDescription>Impossibile caricare la pagina. Riprova tra qualche istante.</AlertDescription>
      </Alert>
      <Button onClick={reset}>Riprova</Button>
    </main>
  );
}
