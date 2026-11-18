import { beforeAll, describe, expect, it } from "vitest";
import { buildFatturaXml } from "./build";
import { FatturaParseError, parseFatturaRicevuta } from "./parse";
import type { FatturaModel } from "./types";
import { signCadesBes } from "../sign/cades";
import { generateTestCert, type TestCert } from "../sign/test-cert";

const sede = { indirizzo: "Via Roma 1", cap: "00100", comune: "Roma", provincia: "RM", nazione: "IT" };

const model: FatturaModel = {
  cedente: { idPaese: "IT", partitaIva: "01234567890", denominazione: "Fornitore Srl", regimeFiscale: "RF01", sede },
  cessionario: { idPaese: "IT", partitaIva: "09876543210", denominazione: "Cliente SpA", sede },
  codiceDestinatario: "ABC1234",
  progressivoInvio: "00001",
  tipoDocumento: "TD01",
  data: "2026-11-17",
  numero: "7/2026",
  righe: [
    { descrizione: "Consulenza", quantitaMilli: 2000, prezzoUnitarioCents: 10000, aliquotaBp: 2200 },
    { descrizione: "Libro", prezzoUnitarioCents: 5000, aliquotaBp: 400 },
    { descrizione: "Rimborso", prezzoUnitarioCents: 1000, aliquotaBp: 0, natura: "N4", riferimentoNormativo: "Esente art. 10" },
  ],
  pagamento: { condizioni: "TP02", modalita: "MP05", iban: "IT60X0542811101000000123456" },
};

let xml: string;
let tc: TestCert;

beforeAll(async () => {
  tc = generateTestCert("Test Firmatario");
  const r = await buildFatturaXml(model);
  if (!r.ok) throw new Error("fixture non valida");
  xml = r.xml;
});

describe("parseFatturaRicevuta", () => {
  it("legge un XML con piu righe e aliquote", () => {
    const f = parseFatturaRicevuta(Buffer.from(xml), "IT01234567890_00001.xml");
    expect(f.fornitore.denominazione).toBe("Fornitore Srl");
    expect(f.fornitore.partitaIva).toBe("01234567890");
    expect(f.fornitore.sede).toContain("Roma");
    expect(f.cliente.partitaIva).toBe("09876543210");
    expect(f.documenti).toHaveLength(1);
    const d = f.documenti[0];
    expect(d.numero).toBe("7/2026");
    expect(d.data).toBe("2026-11-17");
    expect(d.righe).toHaveLength(3);
    expect(d.righe[0]).toMatchObject({ descrizione: "Consulenza", quantita: 2, prezzoUnitarioCents: 10000, aliquota: 22, totaleCents: 20000 });
    expect(d.righe[2].natura).toBe("N4");
    expect(d.riepilogo.length).toBeGreaterThanOrEqual(3);
    expect(d.totaleCents).toBe(20000 + 4400 + 5000 + 200 + 1000);
    expect(d.pagamenti[0]).toMatchObject({ modalita: "MP05", iban: "IT60X0542811101000000123456" });
  });

  it("estrae l'XML da un P7M", async () => {
    const p7m = await signCadesBes(xml, tc);
    const f = parseFatturaRicevuta(p7m, "IT01234567890_00001.xml.p7m");
    expect(f.documenti[0].righe).toHaveLength(3);
    expect(f.fornitore.denominazione).toBe("Fornitore Srl");
  });

  it("legge un lotto con piu documenti", () => {
    const body = /<FatturaElettronicaBody>[\s\S]*<\/FatturaElettronicaBody>/.exec(xml)![0];
    const lotto = xml.replace(body, body + body);
    expect(parseFatturaRicevuta(Buffer.from(lotto), "x.xml").documenti).toHaveLength(2);
  });

  it("file non leggibile: errore di parsing", () => {
    expect(() => parseFatturaRicevuta(Buffer.from("<non-una-fattura/>"), "x.xml")).toThrow(FatturaParseError);
    expect(() => parseFatturaRicevuta(Buffer.from([0x30, 0x01, 0x02]), "x.xml.p7m")).toThrow(FatturaParseError);
  });
});
