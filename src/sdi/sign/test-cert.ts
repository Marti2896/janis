import forge from "node-forge";

export interface TestCert {
  certPem: string;
  keyPem: string;
}

/**
 * Genera a runtime un certificato self-signed (RSA 2048, SHA-256) solo per i test.
 * Nessuna chiave o certificato vengono salvati nel repository.
 */
export function generateTestCert(commonName = "Test Firmatario SDI"): TestCert {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01" + forge.util.bytesToHex(forge.random.getBytesSync(8));
  const now = new Date();
  cert.validity.notBefore = new Date(now.getTime() - 60_000);
  cert.validity.notAfter = new Date(now.getTime() + 24 * 3600 * 1000);
  const attrs = [
    { name: "commonName", value: commonName },
    { name: "countryName", value: "IT" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "keyUsage", critical: true, digitalSignature: true, nonRepudiation: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}
