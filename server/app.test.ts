import { describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";

describe("GET /health", () => {
  it("risponde 200 se tutti i check passano", async () => {
    const app = buildApp({ sdiEnv: "demo", checks: { database: async () => {} } });
    const res = await app.inject("/health");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", checks: { database: "ok" } });
  });

  it("risponde 503 se un check fallisce", async () => {
    const app = buildApp({
      sdiEnv: "demo",
      checks: { redis: async () => { throw new Error("down"); } },
    });
    const res = await app.inject("/health");
    expect(res.statusCode).toBe(503);
  });
});

describe("loadConfig", () => {
  const base = { DATABASE_URL: "postgres://x", REDIS_URL: "redis://x" };

  it("usa demo di default", () => {
    expect(loadConfig(base).sdiEnv).toBe("demo");
  });

  it("in produzione richiede gli endpoint SdI di produzione", () => {
    expect(() => loadConfig({ ...base, SDI_ENV: "production" })).toThrow(/SDI_PROD_/);
  });

  it("rifiuta SDI_ENV sconosciuto", () => {
    expect(() => loadConfig({ ...base, SDI_ENV: "test" })).toThrow();
  });
});
