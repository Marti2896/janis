import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { checkDatabase, createPool } from "./db.ts";
import { checkRedis } from "./redis.ts";
import { registerSdiReceiver } from "../src/server/notifications.ts";

const config = loadConfig();
const pool = createPool(config.databaseUrl);

const app = buildApp({
  sdiEnv: config.sdiEnv,
  checks: {
    database: () => checkDatabase(pool),
    redis: () => checkRedis(config.redisUrl),
  },
});

registerSdiReceiver(app, { pool, sdiEnv: config.sdiEnv });

app.addHook("onClose", async () => {
  await pool.end();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void app.close().then(() => process.exit(0)));
}

await app.listen({ port: config.apiPort, host: "0.0.0.0" });
