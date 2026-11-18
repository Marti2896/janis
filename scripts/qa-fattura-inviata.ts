// Solo sviluppo: crea una fattura di prova già inviata o consegnata per un tenant di test.
// Uso: npm run qa:fattura-inviata -- --tenant alfa|beta --stato sent|delivered
import { parseArgs } from "node:util";
import { getPool } from "../src/server/pool.ts";
import { createQaInvoice, type QaStato, type QaTenant } from "../src/server/qa-invoice.ts";

const { values } = parseArgs({ options: { tenant: { type: "string" }, stato: { type: "string" } } });
const pool = getPool();
try {
  const out = await createQaInvoice(pool, { tenant: values.tenant as QaTenant, stato: values.stato as QaStato });
  console.log(JSON.stringify(out));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
