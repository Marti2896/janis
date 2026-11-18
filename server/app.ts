import Fastify, { type FastifyInstance } from "fastify";
import type pg from "pg";
import { registerHttp } from "../src/server/http/server.ts";

export interface AppDeps {
  sdiEnv: string;
  checks: Record<string, () => Promise<void>>;
  /** Pool Postgres per la ricezione notifiche; se assente la rotta non viene registrata. */
  pool?: pg.Pool;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

  app.get("/health", async (_req, reply) => {
    const results: Record<string, "ok" | "error"> = {};
    for (const [name, check] of Object.entries(deps.checks)) {
      try {
        await check();
        results[name] = "ok";
      } catch (err) {
        app.log.warn({ err, check: name }, "health check fallito");
        results[name] = "error";
      }
    }
    const healthy = Object.values(results).every((r) => r === "ok");
    return reply
      .code(healthy ? 200 : 503)
      .send({ status: healthy ? "ok" : "degraded", sdiEnv: deps.sdiEnv, checks: results });
  });

  if (deps.pool) registerHttp(app, { pool: deps.pool, sdiEnv: deps.sdiEnv });

  return app;
}
