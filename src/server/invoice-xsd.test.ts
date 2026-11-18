import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { createAndSendInvoice, xsdMessageIt } from "./invoice-service.ts";
import type { NewInvoiceInput } from "./invoice-service.ts";

const url = process.env.DATABASE_URL ?? "postgres://sdi:sdi_dev_only@localhost:54320/sdi_channel";
const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 1500 });
let tenantId: string | null = null;
try {
  const r = await pool.query("select id from tenants where denominazione = 'Alfa Srl' limit 1");
  tenantId = r.rows[0]?.id ?? null;
} catch {
  console.warn("[invoice-xsd.test] Postgres non disponibile: test DB saltato");
}
afterAll(() => pool.end());

describe("xsdMessageIt", () => {
  it("mappa il percorso del campo in una frase italiana", () => {
    const m = xsdMessageIt("/FatturaElettronica/FatturaElettronicaBody/DatiBeniServizi/DettaglioLinee/Descrizione", "maxLength");
    expect(m).toMatch(/descrizione/i);
  });
  it("usa una frase generica per un campo sconosciuto", () => {
    expect(xsdMessageIt("/A/B/Sconosciuto", "boh")).toBe("Un campo della fattura non è valido.");
  });
});

describe.skipIf(!tenantId)("errore XSD in createAndSendInvoice", () => {
  it("restituisce errors._xsd e non crea la fattura", async () => {
    const input: NewInvoiceInput = {
      cessionarioDenominazione: "Cliente XSD",
      cessionarioPartitaIva: "12345678903",
      destinazione: { tipo: "codice", valore: "0000000" },
      tipoDocumento: "TD01",
      data: "2026-05-10",
      righe: [{ descrizione: "x".repeat(1500), quantita: 1, prezzoUnitario: 10, aliquota: 22 }],
      tenantId: tenantId!,
    };
    // Nessun certificato salvato: la firma usa quello di test generato a runtime (indipendente dalla chiave del DB di sviluppo).
    const db = {
      query: (text: unknown, ...rest: unknown[]) =>
        /from certificates/i.test(String(text)) ? Promise.resolve({ rows: [], rowCount: 0 }) : (pool.query as (...a: unknown[]) => unknown)(text, ...rest),
      connect: () => pool.connect(),
    } as unknown as pg.Pool;
    const res = await createAndSendInvoice({ role: "admin" }, input, { db, channel: { environment: "demo", endpoint: "" } });
    expect("errors" in res).toBe(true);
    if ("errors" in res) {
      expect(res.errors._xsd).toMatch(/descrizione/i);
    }
    const after = await pool.query("select count(*)::int as c from invoices where tenant_id = $1 and cessionario_denominazione = 'Cliente XSD'", [tenantId]);
    expect(after.rows[0].c).toBe(0);
  });
});
