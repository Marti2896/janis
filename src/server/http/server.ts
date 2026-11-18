import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { registerSdiReceiver } from "../notifications.ts";
import { registerApiV1 } from "./api-v1.ts";
import { registerRicezioneFatture } from "./ricezione-fatture.ts";

/** Registra tutte le rotte che dipendono dal database: ricezione SdI (notifiche e fatture passive) e API REST v1. */
export function registerHttp(app: FastifyInstance, deps: { pool: pg.Pool; sdiEnv: string }): void {
  registerSdiReceiver(app, deps);
  registerRicezioneFatture(app, deps);
  registerApiV1(app, { pool: deps.pool });
}
