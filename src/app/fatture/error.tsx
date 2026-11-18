"use client";

import { AlertCircle, RotateCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function FattureError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full min-w-0 max-w-7xl flex-1 flex-col gap-4 px-6 py-10 lg:px-10">
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>Impossibile caricare le fatture</AlertTitle>
        <AlertDescription>
          <p>Si e verificato un errore. Riprova tra qualche istante.</p>
        </AlertDescription>
      </Alert>
      <Button variant="outline" className="w-fit" onClick={() => reset()}>
        <RotateCw />
        Riprova
      </Button>
    </main>
  );
}
