// Seed demo idempotente: tenant IT01234567890 e fattura DEMO-0001 in stato 'sent'.
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("begin");
  const tenant = await client.query(
    `insert into tenants (partita_iva, denominazione) values ('01234567890', 'Azienda Demo Srl')
     on conflict (partita_iva) do update set denominazione = excluded.denominazione
     returning id`,
  );
  const tenantId = tenant.rows[0].id;
  const inv = await client.query(
    `insert into invoices (tenant_id, numero, data, nome_file, sha256_xml, sha256_p7m, sdi_identifier, status)
     values ($1, 'DEMO-0001', '2026-01-15', 'IT01234567890_00001.xml.p7m', repeat('a', 64), repeat('b', 64), '9900000001', 'sent')
     on conflict (nome_file) do nothing
     returning id`,
    [tenantId],
  );
  if (inv.rowCount > 0) {
    await client.query(
      `insert into invoice_status_history (invoice_id, tenant_id, from_status, to_status, causale, source)
       values ($1, $2, null, 'sent', 'Seed demo', 'seed')`,
      [inv.rows[0].id, tenantId],
    );
    await client.query(
      `insert into audit_log (tenant_id, event, entity, entity_id, detail)
       values ($1, 'seed.invoice_created', 'invoice', $2, '{"numero":"DEMO-0001"}')`,
      [tenantId, inv.rows[0].id],
    );
  }
  await client.query("commit");
  console.log(inv.rowCount > 0 ? "seed applicato" : "seed già presente");
} catch (err) {
  await client.query("rollback");
  throw err;
} finally {
  await client.end();
}
