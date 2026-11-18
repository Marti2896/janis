import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { processNotification } from "./notifications.ts";
import type { ParsedNotification } from "./notifications.ts";
import { createQaInvoice } from "./qa-invoice.ts";
import { getInvoice } from "./invoice-service.ts";

const url = process.env.DATABASE_URL ?? "postgres://sdi:sdi_dev_only@localhost:54320/sdi_channel";
const pool = new pg.Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 1500 });
let dbReady = false;
try {
  await pool.query("select replaced_by from invoices limit 1");
  dbReady = true;
} catch {
  console.warn("[notifications-order.test] Postgres non disponibile: test saltato");
}
afterAll(() => pool.end());

const note = (type: ParsedNotification["type"], sdiIdentifier: string, nomeFile: string, esito: string | null = null): ParsedNotification => ({
  type,
  sdiIdentifier,
  nomeFile,
  messageId: randomUUID().slice(0, 8),
  fileSha256: "0".repeat(64),
  sdiTimestamp: new Date().toISOString(),
  dataConsegna: null,
  destinatario: null,
  errori: null,
  esito,
  descrizione: null,
});

describe.skipIf(!dbReady)("NE arrivata prima della RC", () => {
  it("non cambia lo stato, e viene applicata dopo la consegna", async () => {
    const inv = await createQaInvoice(pool, { tenant: "alfa", stato: "sent" });
    const ne = await processNotification(pool, note("NE", inv.sdi_identifier, inv.nome_file, "EC02"));
    expect(ne).toBe("incompatible_state");
    let d = await getInvoice({ role: "admin" }, inv.id, { db: pool });
    expect(d?.status).toBe("sent");
    expect(d?.events.find((e) => e.type === "NE")?.ignored).toBe(true);

    await processNotification(pool, note("RC", inv.sdi_identifier, inv.nome_file));
    d = await getInvoice({ role: "admin" }, inv.id, { db: pool });
    expect(d?.status).toBe("refused");
    expect(d?.events.find((e) => e.type === "NE")?.ignored).toBe(false);
    expect(d?.events.filter((e) => e.kind === "status").map((e) => e.to)).toContain("refused");
  });
});
