// Seed di sviluppo idempotente: admin, tenant Alfa Srl e Beta Spa con utenti e fatture in stati diversi.
// Password solo di sviluppo (vedi testing.md). Genera SECRETS_MASTER_KEY in .env se manca.
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { getPool } from "../src/server/pool.ts";
import { hashPassword } from "../src/server/password.ts";

const pool = getPool();

function ensureMasterKey(): void {
  if (process.env.SECRETS_MASTER_KEY) return;
  const file = ".env";
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (/^SECRETS_MASTER_KEY=.+/m.test(current)) return;
  appendFileSync(file, `${current && !current.endsWith("\n") ? "\n" : ""}SECRETS_MASTER_KEY=${randomBytes(32).toString("base64")}\n`);
  console.log("SECRETS_MASTER_KEY generata in .env (solo sviluppo)");
}

const TENANTS = [
  { piva: "01234567890", name: "Alfa Srl", cf: "01234567890", prefix: "alfa", email: "cliente.alfa@interscambio.test" },
  { piva: "09876543210", name: "Beta Spa", cf: "09876543210", prefix: "beta", email: "cliente.beta@interscambio.test" },
];
const INVOICES = [
  { n: "1/2026", data: "2026-01-15", status: "delivered", sdi: 1 },
  { n: "2/2026", data: "2026-02-10", status: "sent", sdi: 2 },
  { n: "3/2026", data: "2026-03-05", status: "rejected", sdi: 3 },
  { n: "4/2026", data: "2026-04-20", status: "send_error", sdi: null },
];

async function upsertUser(email: string, password: string, role: "admin" | "cliente", tenantId: string | null): Promise<void> {
  const exists = await pool.query("select 1 from users where lower(email) = lower($1)", [email]);
  if (exists.rowCount) return;
  await pool.query("insert into users (email, password_hash, role, tenant_id) values ($1, $2, $3, $4)", [email, await hashPassword(password), role, tenantId]);
}

try {
  ensureMasterKey();
  await pool.query("begin");
  await upsertUser("admin@interscambio.test", "Admin-dev-2026!", "admin", null);
  let created = 0;
  for (const [i, t] of TENANTS.entries()) {
    const r = await pool.query(
      `insert into tenants (partita_iva, denominazione, codice_fiscale) values ($1, $2, $3)
       on conflict (partita_iva) do update set denominazione = excluded.denominazione, codice_fiscale = excluded.codice_fiscale
       returning id`,
      [t.piva, t.name, t.cf],
    );
    const tenantId = r.rows[0].id as string;
    await upsertUser(t.email, "Cliente-dev-2026!", "cliente", tenantId);
    for (const inv of INVOICES) {
      const nomeFile = `IT${t.piva}_${t.prefix}${inv.n.split("/")[0]}.xml.p7m`;
      const ins = await pool.query(
        `insert into invoices (tenant_id, numero, data, nome_file, sha256_xml, sha256_p7m, sdi_identifier, status)
         values ($1, $2, $3, $4, repeat('a', 64), repeat('b', 64), $5, $6)
         on conflict (nome_file) do nothing returning id`,
        [tenantId, inv.n, inv.data, nomeFile, inv.sdi ? `99${i}00000${inv.sdi}` : null, inv.status],
      );
      if (ins.rowCount) {
        created++;
        await pool.query(
          `insert into invoice_status_history (invoice_id, tenant_id, from_status, to_status, causale, source)
           values ($1, $2, null, $3, 'Seed sviluppo', 'seed')`,
          [ins.rows[0].id, tenantId, inv.status],
        );
        await pool.query(
          `insert into audit_log (tenant_id, event, entity, entity_id, detail) values ($1, 'seed.invoice_created', 'invoice', $2, $3::jsonb)`,
          [tenantId, ins.rows[0].id, JSON.stringify({ numero: inv.n })],
        );
      }
    }
  }
  await pool.query("commit");
  console.log(created ? `seed applicato (${created} fatture nuove)` : "seed gia presente");
} catch (err) {
  await pool.query("rollback");
  throw err;
} finally {
  await pool.end();
}
