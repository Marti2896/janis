import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function Forbidden() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Alert variant="destructive">
        <AlertTitle>Accesso negato</AlertTitle>
        <AlertDescription>Questa pagina e riservata agli amministratori.</AlertDescription>
      </Alert>
    </main>
  );
}
