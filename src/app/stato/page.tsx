import { Activity, AlertTriangle, Bell, Clock } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { errorSummary } from "@/lib/invoice-guidance";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Stato del canale" };
import { channelCounters } from "@/server/invoice-service";
import { getChannelSettings } from "@/server/channel-settings";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";


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
    const [counters, settings, healthy] = await Promise.all([
      channelCounters(session.scope),
      getChannelSettings(),
      isAdmin ? checkHealth() : Promise.resolve(null),
    ]);
    const prod = settings.environment === "production";
    const items = [
      { label: "In coda", value: counters.queued, icon: Clock, href: "/fatture?stato=queued" },
      { label: "Errori ultime 24 ore", value: counters.errors24h, icon: AlertTriangle, href: "/fatture?stato=errors" },
      { label: "Notifiche ricevute", value: counters.notifications, icon: Bell, href: null },
    ];
    return (
      <main className="mx-auto w-full min-w-0 max-w-7xl space-y-6 px-6 py-10 lg:px-10">
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
            <p>
              <span className="text-muted-foreground">Collegamento al Sistema di Interscambio: </span>
              <span className="font-medium">
                {settings.endpoint
                  ? "Collegamento attivo"
                  : "Collegamento non attivo: le fatture restano in coda finché il canale non viene attivato"}
              </span>
            </p>
            {!prod && !isAdmin && (
              <p className="text-muted-foreground">Ambiente di prova: le fatture non hanno valore fiscale.</p>
            )}
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
          {items.map(({ label, value, icon: Icon, href }) => {
            const card = (
              <Card className={href ? "h-full hover:bg-accent" : "h-full"}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <Icon className="size-4" /> {label}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-3xl font-semibold">{value}</CardContent>
              </Card>
            );
            return href ? (
              <Link key={label} href={href} aria-label={`${label}: ${value}. Apri l'elenco delle fatture`}>
                {card}
              </Link>
            ) : (
              <div key={label}>{card}</div>
            );
          })}
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
                  <li key={`${e.invoiceId}-${String(e.at)}`} className="flex justify-between gap-4">
                    <Link href={`/fatture/${e.invoiceId}`} className="underline-offset-4 hover:underline">
                      Fattura {e.numero}
                      {e.cliente ? ` a ${e.cliente}` : ""}: {errorSummary(e.status, e.message)}
                    </Link>
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
}
