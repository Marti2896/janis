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
