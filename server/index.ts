import { fileURLToPath } from "node:url";
import { loadEnvFile } from "./env.ts";

// Prima di tutto: le variabili mancanti o vuote vengono lette da .env (SECRETS_MASTER_KEY inclusa).
loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));

const { buildApp } = await import("./app.ts");
const { loadConfig } = await import("./config.ts");
const { checkDatabase, createPool } = await import("./db.ts");
const { checkRedis } = await import("./redis.ts");

const config = loadConfig();
const pool = createPool(config.databaseUrl);

const app = buildApp({
  sdiEnv: config.sdiEnv,
  pool,
  checks: {
    database: () => checkDatabase(pool),
    redis: () => checkRedis(config.redisUrl),
  },
});

app.addHook("onClose", async () => {
  await pool.end();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void app.close().then(() => process.exit(0)));
}

await app.listen({ port: config.apiPort, host: "0.0.0.0" });
