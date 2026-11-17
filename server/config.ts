export type SdiEnvironment = "demo" | "production";

export interface Config {
  sdiEnv: SdiEnvironment;
  apiPort: number;
  databaseUrl: string;
  redisUrl: string;
  /** Endpoint SdI dell'ambiente attivo (da specifiche tecniche, mai hardcoded). */
  sdi: {
    trasmissioneUrl: string;
    ricezioneBaseUrl: string;
    /** Retry dell'invio: solo errori di rete, timeout e 5xx. */
    retry: { maxAttempts: number; baseMs: number; capMs: number };
  };
}

function positiveInt(env: Record<string, string | undefined>, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${key} deve essere un intero positivo: ${raw}`);
  return n;
}

function required(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`Variabile d'ambiente mancante: ${key}`);
  return value;
}

/**
 * Configurazione separata demo/produzione: le variabili SDI_DEMO_* e
 * SDI_PROD_* non si mescolano mai, si sceglie con SDI_ENV.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  const sdiEnv = (env.SDI_ENV ?? "demo") as SdiEnvironment;
  if (sdiEnv !== "demo" && sdiEnv !== "production") {
    throw new Error(`SDI_ENV non valido: ${sdiEnv} (demo | production)`);
  }
  const prefix = sdiEnv === "demo" ? "SDI_DEMO" : "SDI_PROD";
  const optional = (key: string) =>
    sdiEnv === "production" ? required(env, key) : (env[key] ?? "");

  return {
    sdiEnv,
    apiPort: Number(env.API_PORT ?? 4000),
    databaseUrl: required(env, "DATABASE_URL"),
    redisUrl: required(env, "REDIS_URL"),
    sdi: {
      trasmissioneUrl: optional(`${prefix}_TRASMISSIONE_URL`),
      ricezioneBaseUrl: optional(`${prefix}_RICEZIONE_BASE_URL`),
      retry: {
        maxAttempts: positiveInt(env, "SDI_RETRY_MAX_ATTEMPTS", 3),
        baseMs: positiveInt(env, "SDI_RETRY_BASE_MS", 1000),
        capMs: positiveInt(env, "SDI_RETRY_CAP_MS", 8000),
      },
    },
  };
}
