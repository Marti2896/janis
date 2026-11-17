import pg from "pg";

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10 });
}

export async function checkDatabase(pool: pg.Pool): Promise<void> {
  await pool.query("select 1");
}
