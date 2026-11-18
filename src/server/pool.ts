import pg from "pg";

export type Db = Pick<pg.Pool, "query">;

const KEY = Symbol.for("interscambio.pool");
type G = { [KEY]?: pg.Pool };

/** Pool Postgres condiviso dal lato Next (una sola istanza anche con il hot reload). */
export function getPool(): pg.Pool {
  const g = globalThis as unknown as G;
  g[KEY] ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL ?? "postgres://sdi:sdi_dev_only@localhost:54320/sdi_channel",
    max: 10,
  });
  return g[KEY];
}
