import { Activity, AlertTriangle, Bell, Clock } from "lucide-react";
import { requireSession } from "@/lib/session";
import { channelCounters } from "@/server/invoice-service";
import { getChannelSettings } from "@/server/channel-settings";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

async function checkHealth(): Promise<boolean> {
  const port = process.env.API_PORT ?? process.env.PORT_API ?? "4811";
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export default async function StatoPage() {
  const session = await requireSession();
  const isAdmin = session.user.role === "admin";
  try {
    const [counters, settings, healthy] = await Promise.all([
      channelCounters(session.scope),
      getChannelSettings(),
      isAdmin ? checkHealth() : Promise.resolve(null),
    ]);
    const prod = settings.environment === "production";
    const items = [
      { label: "In coda", value: counters.queued, icon: Clock },
      { label: "Errori ultime 24 ore", value: counters.errors24h, icon: AlertTriangle },
      { label: "Notifiche ricevute", value: counters.notifications, icon: Bell },
    ];
    return (
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-16">
        <h1 className="text-2xl font-semibold">Stato del canale</h1>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4" /> Ambiente
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant={prod ? "destructive" : "secondary"}>
                {prod ? "Produzione" : "Demo"}
              </Badge>
            </div>
            {isAdmin && (
              <>
                <p className="text-muted-foreground">
                  Endpoint SdI: {settings.endpoint || "non configurato"}
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Servizio /health:</span>
                  <Badge variant={healthy ? "secondary" : "destructive"}>
                    {healthy ? "ok" : "errore"}
                  </Badge>
                </div>
              </>
            )}
          </CardContent>
        </Card>
        <div className="grid gap-4 sm:grid-cols-3">
          {items.map(({ label, value, icon: Icon }) => (
            <Card key={label}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Icon className="size-4" /> {label}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-3xl font-semibold">{value}</CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Ultimi errori</CardTitle>
          </CardHeader>
          <CardContent>
            {counters.recentErrors.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nessun errore recente.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {counters.recentErrors.map((e) => (
                  <li key={e.id} className="flex justify-between gap-4">
                    <span>{e.message}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {new Date(e.at).toLocaleString("it-IT")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
    );
  } catch {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <Alert variant="destructive">
          <AlertTitle>Errore</AlertTitle>
          <AlertDescription>
            Impossibile leggere lo stato del canale. Ricarica la pagina.
          </AlertDescription>
        </Alert>
      </main>
    );
  }
}
