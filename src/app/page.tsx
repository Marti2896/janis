import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const modules = [
  { name: "Trasmissione", description: "Generazione, firma e invio al SdI" },
  { name: "Ricezione", description: "Notifiche ed esiti dal SdI" },
  { name: "Tenant", description: "Clienti e API key" },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <Badge variant="secondary" className="w-fit">
          Ambiente demo
        </Badge>
        <h1 className="text-3xl font-semibold">SDI Channel</h1>
        <p className="text-muted-foreground">
          Dashboard operativa del canale SDICoop. Scheletro del progetto: le
          funzionalità arriveranno con le prossime issue.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        {modules.map((m) => (
          <Card key={m.name}>
            <CardHeader>
              <CardTitle>{m.name}</CardTitle>
              <CardDescription>{m.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Badge variant="outline">Non attivo</Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
