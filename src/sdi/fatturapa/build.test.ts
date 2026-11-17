import { describe, expect, it } from "vitest";
import { buildFatturaXml, formatFixed } from "./build";
import { validateFatturaXml } from "./validate";
import type { FatturaModel } from "./types";

const sede = { indirizzo: "Via Roma 1", cap: "00100", comune: "Roma", provincia: "RM", nazione: "IT" };

function model(over: Partial<FatturaModel> = {}): FatturaModel {
  return {
    cedente: {
      idPaese: "IT",
      partitaIva: "01234567890",
      denominazione: "Demo Srl",
      regimeFiscale: "RF01",
      sede,
    },
    cessionario: { idPaese: "IT", partitaIva: "09876543210", denominazione: "Cliente SpA", sede },
    codiceDestinatario: "ABC1234",
    progressivoInvio: "00001",
    tipoDocumento: "TD01",
    data: "2026-11-17",
    numero: "DEMO-0001",
    righe: [{ descrizione: "Consulenza", prezzoUnitarioCents: 10000, aliquotaBp: 2200 }],
    pagamento: { condizioni: "TP02", modalita: "MP05" },
    ...over,
  };
}

describe("formatFixed", () => {
  it("formatta senza float", () => {
    expect(formatFixed(5, 100)).toBe("0.05");
    expect(formatFixed(12345, 100)).toBe("123.45");
    expect(formatFixed(1500, 1000)).toBe("1.500");
  });
});

describe("buildFatturaXml", () => {
  it("riga singola: XML valido e nome file corretto", async () => {
    const r = await buildFatturaXml(model());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nomeFile).toBe("IT01234567890_00001.xml");
    expect(r.nomeFile).toMatch(/^IT01234567890_[A-Za-z0-9]{5}\.xml$/);
    expect(r.xml).toContain("<ImponibileImporto>100.00</ImponibileImporto>");
    expect(r.xml).toContain("<Imposta>22.00</Imposta>");
    expect(r.xml).toContain("<ImportoTotaleDocumento>122.00</ImportoTotaleDocumento>");
    expect((await validateFatturaXml(r.xml)).ok).toBe(true);
  });

  it("split payment (S) valido, pagamento al netto dell'IVA", async () => {
    const r = await buildFatturaXml(
      model({ righe: [{ descrizione: "Servizio PA", prezzoUnitarioCents: 10000, aliquotaBp: 2200, esigibilita: "S" }] }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.xml).toContain("<EsigibilitaIVA>S</EsigibilitaIVA>");
    expect(r.xml).toContain("<ImportoPagamento>100.00</ImportoPagamento>");
  });

  it("reverse charge N6.x con TD01 valido", async () => {
    const r = await buildFatturaXml(
      model({
        righe: [
          {
            descrizione: "Lavori edili",
            prezzoUnitarioCents: 50000,
            aliquotaBp: 0,
            natura: "N6.3",
            riferimentoNormativo: "Art. 17 c.6 DPR 633/72",
          },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.xml).toContain("<Natura>N6.3</Natura>");
    expect(r.xml).toContain("<TipoDocumento>TD01</TipoDocumento>");
  });

  it("aliquota 0 senza Natura e rifiutata", async () => {
    const r = await buildFatturaXml(model({ righe: [{ descrizione: "x", prezzoUnitarioCents: 100, aliquotaBp: 0 }] }));
    expect(r.ok).toBe(false);
  });

  it("modello senza righe: errore di validazione", async () => {
    const r = await buildFatturaXml(model({ righe: [] }));
    expect(r.ok).toBe(false);
  });

  it("CodiceDestinatario di 6 caratteri rifiutato nominando il campo", async () => {
    const r = await buildFatturaXml(model({ codiceDestinatario: "ABC123" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].path).toBe("CodiceDestinatario");
    expect(r.errors[0].message).toContain("7 caratteri");
  });

  it("validateFatturaXml rifiuta un XML con 6 caratteri anche se lo schema li ammette", async () => {
    const r = await buildFatturaXml(model());
    if (!r.ok) throw new Error("setup");
    const bad = r.xml.replace("ABC1234", "ABC123");
    const v = await validateFatturaXml(bad);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors[0].path).toBe("CodiceDestinatario");
  });

  it("validateFatturaXml segnala errori XSD con campo e messaggio", async () => {
    const r = await buildFatturaXml(model());
    if (!r.ok) throw new Error("setup");
    const v = await validateFatturaXml(r.xml.replace("<Divisa>EUR</Divisa>", "<Divisa>EURO</Divisa>"));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.some((e) => e.path === "Divisa")).toBe(true);
  });

  it("propaga replacesInvoiceId", async () => {
    const r = await buildFatturaXml(model(), { replacesInvoiceId: "abc" });
    expect(r.ok && r.replacesInvoiceId).toBe("abc");
  });

  it("escape dei caratteri speciali", async () => {
    const r = await buildFatturaXml(model({ cessionario: { ...model().cessionario, denominazione: "A & B <srl>" } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.xml).toContain("A &amp; B &lt;srl&gt;");
  });
});
