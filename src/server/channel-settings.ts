import { logEvent } from "./audit.ts";
import { hasValidCertificate } from "./certificates.ts";
import type { SdiEnvironment } from "./certificates.ts";
import { getPool } from "./pool.ts";
import type { Db } from "./pool.ts";
import { ValidationError, requireAdmin } from "./scope.ts";
import type { Scope } from "./scope.ts";

export type ChannelSettings = {
  environment: SdiEnvironment;
  /** Endpoint di trasmissione dell'ambiente attivo (stringa vuota se non configurato). */
  endpoint: string;
  endpoints: Record<SdiEnvironment, string>;
};

const envEndpoint = (env: SdiEnvironment) =>
  (env === "demo" ? process.env.SDI_DEMO_TRASMISSIONE_URL : process.env.SDI_PROD_TRASMISSIONE_URL) ?? "";

/** Valori salvati dall'admin; in mancanza si usano le variabili d'ambiente (SDI_ENV, SDI_*_TRASMISSIONE_URL). */
export async function getChannelSettings(db: Db = getPool()): Promise<ChannelSettings> {
  const r = await db.query("select key, value from channel_settings");
  const m = new Map<string, string>(r.rows.map((x) => [x.key as string, x.value as string]));
  const envRaw = m.get("environment") ?? process.env.SDI_ENV ?? "demo";
  const environment: SdiEnvironment = envRaw === "production" ? "production" : "demo";
  const endpoints = {
    demo: m.get("endpoint_demo") ?? envEndpoint("demo"),
    production: m.get("endpoint_production") ?? envEndpoint("production"),
  };
  return { environment, endpoint: endpoints[environment], endpoints };
}

/** Controlla se si puo passare a produzione: serve un certificato valido e un endpoint. */
export async function productionBlockers(endpoint: string, db: Db = getPool()): Promise<string[]> {
  const out: string[] = [];
  if (!(await hasValidCertificate("production", db))) out.push("Manca un certificato di produzione valido.");
  if (!endpoint.trim()) out.push("Manca l'endpoint di produzione.");
  return out;
}

function checkUrl(url: string): void {
  if (!url) return;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("proto");
  } catch {
    throw new ValidationError("L'endpoint deve essere un URL valido.", "endpoint");
  }
}

/** Salva ambiente ed endpoint (dell'ambiente scelto). Solo admin; ogni salvataggio e in audit con valori vecchi e nuovi. */
export async function saveChannelSettings(
  scope: Scope,
  input: { environment: SdiEnvironment; endpoint: string },
  actorUserId: string | null,
  db: Db = getPool(),
): Promise<ChannelSettings> {
  requireAdmin(scope);
  if (input.environment !== "demo" && input.environment !== "production") throw new ValidationError("Ambiente non valido.", "environment");
  const endpoint = input.endpoint.trim();
  checkUrl(endpoint);
  if (input.environment === "production") {
    const blockers = await productionBlockers(endpoint, db);
    if (blockers.length) throw new ValidationError(`Produzione bloccata. ${blockers.join(" ")}`, "environment");
  }
  const before = await getChannelSettings(db);
  const upsert = (key: string, value: string) =>
    db.query(
      `insert into channel_settings (key, value, updated_by) values ($1, $2, $3)
       on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`,
      [key, value, actorUserId],
    );
  await upsert("environment", input.environment);
  await upsert(input.environment === "demo" ? "endpoint_demo" : "endpoint_production", endpoint);
  const after = await getChannelSettings(db);
  await logEvent(
    {
      actorUserId,
      event: "channel.settings_changed",
      entity: "channel_settings",
      detail: { before: { environment: before.environment, endpoints: before.endpoints }, after: { environment: after.environment, endpoints: after.endpoints } },
    },
    db,
  );
  return after;
}
