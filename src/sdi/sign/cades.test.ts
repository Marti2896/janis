import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import forge from "node-forge";
import { p7mName, signCadesBes, verifyCadesBes } from "./cades";
import { generateTestCert, type TestCert } from "./test-cert";

const XML = '<?xml version="1.0" encoding="UTF-8"?><p:FatturaElettronica xmlns:p="x">àè€</p:FatturaElettronica>';

let tc: TestCert;
beforeAll(() => {
  tc = generateTestCert("Test Firmatario");
});

describe("CAdES-BES", () => {
  it("firma e verifica: contenuto identico byte per byte", async () => {
    const p7m = await signCadesBes(XML, tc);
    const r = verifyCadesBes(p7m);
    expect(r.valid).toBe(true);
    expect(r.signerCn).toBe("Test Firmatario");
    expect(r.signedContent.equals(Buffer.from(XML, "utf8"))).toBe(true);
  });

  it("accetta Buffer in ingresso", async () => {
    const bytes = Buffer.from(XML, "utf8");
    const r = verifyCadesBes(await signCadesBes(bytes, tc));
    expect(r.valid).toBe(true);
    expect(r.signedContent.equals(bytes)).toBe(true);
  });

  it("contiene signing-certificate-v2 con hash SHA-256 del certificato", async () => {
    const p7m = await signCadesBes(XML, tc);
    const certDer = Buffer.from(forge.pem.decode(tc.certPem)[0].body, "binary");
    const hash = createHash("sha256").update(certDer).digest();
    const oidDer = Buffer.from(forge.asn1.oidToDer("1.2.840.113549.1.9.16.2.47").getBytes(), "binary");
    expect(p7m.includes(oidDer)).toBe(true);
    expect(p7m.includes(hash)).toBe(true);
    // certificato incluso
    expect(p7m.includes(certDer)).toBe(true);
  });

  it("produce DER con SignedData e SHA-256", async () => {
    const p7m = await signCadesBes(XML, tc);
    const root = forge.asn1.fromDer(p7m.toString("binary"));
    const oid = forge.asn1.derToOid((root.value as forge.asn1.Asn1[])[0].value as string);
    expect(oid).toBe("1.2.840.113549.1.7.2");
    const sha256Der = Buffer.from(forge.asn1.oidToDer("2.16.840.1.101.3.4.2.1").getBytes(), "binary");
    expect(p7m.includes(sha256Der)).toBe(true);
  });

  it("rileva contenuto alterato", async () => {
    const p7m = await signCadesBes(XML, tc);
    const idx = p7m.indexOf(Buffer.from("FatturaElettronica"));
    const bad = Buffer.from(p7m);
    bad[idx] = bad[idx] ^ 0x01;
    expect(verifyCadesBes(bad).valid).toBe(false);
  });

  it("rileva firma manomessa", async () => {
    const p7m = await signCadesBes(XML, tc);
    const bad = Buffer.from(p7m);
    bad[bad.length - 5] = bad[bad.length - 5] ^ 0xff;
    expect(verifyCadesBes(bad).valid).toBe(false);
  });

  it("rifiuta input non CMS senza lanciare", () => {
    expect(verifyCadesBes(Buffer.from("non e un p7m")).valid).toBe(false);
  });

  it("p7mName aggiunge .p7m", () => {
    expect(p7mName("IT01234567890_00001.xml")).toBe("IT01234567890_00001.xml.p7m");
  });
});

describe("verifyP7m e struttura signing-certificate-v2", () => {
  it("accetta DER e base64 e restituisce l'xml identico", async () => {
    const { verifyP7m } = await import("./cades");
    const p7m = await signCadesBes(XML, tc);
    expect(verifyP7m(p7m).xml.equals(Buffer.from(XML, "utf8"))).toBe(true);
    expect(verifyP7m(p7m.toString("base64")).xml.equals(Buffer.from(XML, "utf8"))).toBe(true);
    const wrapped = p7m.toString("base64").replace(/(.{64})/g, "$1\n");
    expect(verifyP7m(wrapped).xml.equals(Buffer.from(XML, "utf8"))).toBe(true);
  });

  it("verifyP7m lancia su firma manomessa o input non valido", async () => {
    const { verifyP7m } = await import("./cades");
    const p7m = Buffer.from(await signCadesBes(XML, tc));
    p7m[p7m.length - 1] ^= 0xff;
    expect(() => verifyP7m(p7m)).toThrow();
    expect(() => verifyP7m("non-un-p7m")).toThrow();
  });

  it("IssuerSerial = SEQUENCE { GeneralNames (SEQUENCE OF), serialNumber } (RFC 5035)", async () => {
    const p7m = await signCadesBes(XML, tc);
    const root = forge.asn1.fromDer(p7m.toString("binary"));
    const kids = (n: forge.asn1.Asn1) => n.value as forge.asn1.Asn1[];
    const sd = kids(kids(root)[1])[0];
    const signerInfos = kids(sd)[kids(sd).length - 1];
    const signedAttrs = kids(kids(signerInfos)[0]).find((n) => n.tagClass === 128 && n.type === 0)!;
    const attr = kids(signedAttrs).find(
      (a) => forge.asn1.derToOid(kids(a)[0].value as string) === "1.2.840.113549.1.9.16.2.47",
    )!;
    const scv2 = kids(kids(attr)[1])[0];
    const essCertIdV2 = kids(kids(scv2)[0])[0];
    const [certHash, issuerSerial] = kids(essCertIdV2);
    expect(certHash.type).toBe(forge.asn1.Type.OCTETSTRING);
    const [generalNames, serial] = kids(issuerSerial);
    expect(generalNames.tagClass).toBe(forge.asn1.Class.UNIVERSAL);
    expect(generalNames.type).toBe(forge.asn1.Type.SEQUENCE);
    const directoryName = kids(generalNames)[0];
    expect(directoryName.tagClass).toBe(forge.asn1.Class.CONTEXT_SPECIFIC);
    expect(directoryName.type).toBe(4);
    expect(serial.type).toBe(forge.asn1.Type.INTEGER);
  });
});
