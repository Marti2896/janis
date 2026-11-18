// Script di sviluppo una tantum: nasconde i tenant creati dai vecchi test automatici.
// Audit, storico e notifiche sono append-only, quindi i tenant non si cancellano: si disattivano
// i loro utenti, cosi' spariscono dai selettori Account (che mostrano solo i tenant attivi).
// Restano intatti Alfa, Beta e i tenant qa* documentati in testing.md.
// Uso: node scripts/clean-test-tenants.ts [--dry-run]
import pg from "pg";

if (process.env.SDI_ENV === "production") {
  console.error("Rifiuto di girare con SDI_ENV=production.");
  process.exit(1);
}

const dry = process.argv.includes("--dry-run");
const url = process.env.DATABASE_URL ?? "postgres://sdi:sdi_dev_only@localhost:54320/sdi_channel";
const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  const keep = `lower(t.denominazione) not in ('alfa srl', 'beta spa') and lower(t.denominazione) !~ '^qa'`;
  const { rows } = await db.query(
    `select t.id, t.denominazione,
            (select count(*)::int from users u where u.tenant_id = t.id and u.disabled_at is null) as attivi
       from tenants t where ${keep} order by t.denominazione`,
  );
  const todo = rows.filter((r) => r.attivi > 0);
  console.log(`Tenant di prova da nascondere: ${todo.length} (su ${rows.length} non protetti)`);
  if (!dry && todo.length) {
    const res = await db.query(
      `update users set disabled_at = now()
        where disabled_at is null and tenant_id = any($1::uuid[])`,
      [todo.map((r) => r.id)],
    );
    await db.query(
      `delete from sessions where user_id in (select id from users where tenant_id = any($1::uuid[]))`,
      [todo.map((r) => r.id)],
    );
    console.log(`Utenti disattivati: ${res.rowCount}`);
  }
} finally {
  await db.end();
}
