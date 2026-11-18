import { requireSession } from "@/lib/session";
import { getChannelSettings } from "@/server/channel-settings";
import { listCertificates } from "@/server/certificates";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CanaleForm } from "./canale-form";


export default async function CanalePage() {
  const session = await requireSession();
  if (session.user.role !== "admin") {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <Alert variant="destructive">
          <AlertTitle>Accesso negato</AlertTitle>
          <AlertDescription>
            Questa pagina e riservata agli amministratori.
          </AlertDescription>
        </Alert>
      </main>
    );
  }
    const [settings, certs] = await Promise.all([
      getChannelSettings(),
      listCertificates(session.scope),
    ]);
    const hasValidProdCert = certs.some(
      (c) => c.environment === "production" && c.level !== "expired",
    );
    return (
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-16">
        <h1 className="text-2xl font-semibold">Configurazione del canale</h1>
        <Card>
          <CardHeader>
            <CardTitle>Ambiente ed endpoint</CardTitle>
          </CardHeader>
          <CardContent>
            <CanaleForm
              environment={settings.environment}
              endpoint={settings.endpoint ?? ""}
              productionBlocked={!hasValidProdCert || !settings.endpoint}
            />
          </CardContent>
        </Card>
      </main>
    );
}
