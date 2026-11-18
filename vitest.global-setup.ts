import { execFileSync } from "node:child_process";
import pg from "pg";

// I test girano in uno schema Postgres dedicato (sdi_test), ricreato a ogni esecuzione e poi eliminato:
// i tenant, gli utenti e le fatture di prova non finiscono mai nel DB di sviluppo (schema public).
const SCHEMA = "sdi_test";
const DEFAULT_URL = "postgres://sdi:sdi_dev_only@localhost:54320/sdi_channel";

function withSchema(url: string): string {
  const u = new URL(url);
  u.searchParams.set("options", `-c search_path=${SCHEMA}`);
  return u.toString();
}

let baseUrl = "";

export async function setup() {
  if (process.env.SDI_ENV === "production") return;
  baseUrl = process.env.DATABASE_URL ?? DEFAULT_URL;
  const client = new pg.Client({ connectionString: baseUrl, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
  } catch {
    // DB non raggiungibile: i test che ne hanno bisogno si saltano da soli, come prima.
    baseUrl = "";
    return;
  }
  try {
    await client.query(`drop schema if exists ${SCHEMA} cascade`);
    await client.query(`create schema ${SCHEMA}`);
  } finally {
    await client.end();
  }
  const url = withSchema(baseUrl);
  const env = { ...process.env, DATABASE_URL: url };
  execFileSync(process.execPath, ["scripts/migrate.mjs"], { env, stdio: "ignore" });
  try {
    execFileSync(process.execPath, ["scripts/seed.ts"], { env, stdio: "ignore" });
  } catch {
    // il seed e' un di piu': i test creano i loro dati
  }
  process.env.DATABASE_URL = url;
}

export async function teardown() {
  if (!baseUrl) return;
  const client = new pg.Client({ connectionString: baseUrl });
  try {
    await client.connect();
    await client.query(`drop schema if exists ${SCHEMA} cascade`);
  } catch {
    // niente da fare
  } finally {
    await client.end().catch(() => {});
  }
}
