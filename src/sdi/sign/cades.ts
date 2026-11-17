import forge from "node-forge";

/**
 * Firma CAdES-BES (ETSI TS 101 733) in formato p7m: CMS SignedData attached,
 * DER, SHA-256, RSA PKCS#1 v1.5, certificato del firmatario incluso e
 * attributo firmato signing-certificate-v2 (ESSCertIDv2, RFC 5035).
 *
 * node-forge non supporta attributi firmati personalizzati: la struttura CMS
 * viene composta con il modulo asn1 di forge, mentre hash, firma RSA e
 * parsing dei certificati sono quelli della libreria.
 */

const asn1 = forge.asn1;

const OID = {
  data: "1.2.840.113549.1.7.1",
  signedData: "1.2.840.113549.1.7.2",
  sha256: "2.16.840.1.101.3.4.2.1",
  rsaEncryption: "1.2.840.113549.1.1.1",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingTime: "1.2.840.113549.1.9.5",
  signingCertificateV2: "1.2.840.113549.1.9.16.2.47",
} as const;

export interface SignOptions {
  certPem: string;
  keyPem: string;
}

export interface VerifyResult {
  valid: boolean;
  signedContent: Buffer;
  signerCn: string | null;
}

/** Nome del file firmato: NomeFile + ".p7m". */
export function p7mName(nomeFile: string): string {
  return `${nomeFile}.p7m`;
}

function oid(value: string): forge.asn1.Asn1 {
  return asn1.create(
    asn1.Class.UNIVERSAL,
    asn1.Type.OID,
    false,
    asn1.oidToDer(value).getBytes(),
  );
}

function seq(children: forge.asn1.Asn1[]): forge.asn1.Asn1 {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, children);
}

function set(children: forge.asn1.Asn1[]): forge.asn1.Asn1 {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, children);
}

function octets(bytes: string): forge.asn1.Asn1 {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, bytes);
}

function ctx(
  tag: number,
  children: forge.asn1.Asn1[],
): forge.asn1.Asn1 {
  return asn1.create(asn1.Class.CONTEXT_SPECIFIC, tag, true, children);
}

function sha256(bytes: string): string {
  const md = forge.md.sha256.create();
  md.update(bytes);
  return md.digest().getBytes();
}

function attribute(type: string, value: forge.asn1.Asn1): forge.asn1.Asn1 {
  return seq([oid(type), set([value])]);
}

/** Estrae versione/serial/issuer dal TBSCertificate. */
function certParts(certAsn1: forge.asn1.Asn1): {
  serial: forge.asn1.Asn1;
  issuer: forge.asn1.Asn1;
} {
  const tbs = (certAsn1.value as forge.asn1.Asn1[])[0];
  const fields = tbs.value as forge.asn1.Asn1[];
  const i = fields[0].tagClass === asn1.Class.CONTEXT_SPECIFIC ? 1 : 0;
  return { serial: fields[i], issuer: fields[i + 2] };
}

function derOf(node: forge.asn1.Asn1): string {
  return asn1.toDer(node).getBytes();
}

function toBinary(input: string | Buffer): string {
  return typeof input === "string"
    ? Buffer.from(input, "utf8").toString("binary")
    : input.toString("binary");
}

export async function signCadesBes(
  xml: string | Buffer,
  opts: SignOptions,
): Promise<Buffer> {
  const content = toBinary(xml);
  const key = forge.pki.privateKeyFromPem(opts.keyPem) as forge.pki.rsa.PrivateKey;
  const certMsg = forge.pem.decode(opts.certPem).find((m) => m.type === "CERTIFICATE");
  if (!certMsg) throw new Error("Certificato PEM non valido");
  const certDer = certMsg.body;
  const certAsn1 = asn1.fromDer(certDer);
  const { serial, issuer } = certParts(certAsn1);

  // signing-certificate-v2: ESSCertIDv2 con SHA-256 (default, omesso) + IssuerSerial.
  const issuerSerial = seq([
    ctx(4, [issuer]), // GeneralNames: directoryName
    serial,
  ]);
  const essCertIdV2 = seq([octets(sha256(certDer)), issuerSerial]);
  const signingCertV2 = seq([seq([essCertIdV2])]);

  const signingTime = asn1.create(
    asn1.Class.UNIVERSAL,
    asn1.Type.UTCTIME,
    false,
    asn1.dateToUtcTime(new Date()),
  );

  // DER: gli elementi di un SET OF vanno ordinati per codifica.
  const attrs = [
    attribute(OID.contentType, oid(OID.data)),
    attribute(OID.signingTime, signingTime),
    attribute(OID.messageDigest, octets(sha256(content))),
    attribute(OID.signingCertificateV2, signingCertV2),
  ]
    .map((a) => ({ a, der: derOf(a) }))
    .sort((x, y) => Buffer.compare(Buffer.from(x.der, "binary"), Buffer.from(y.der, "binary")))
    .map((x) => x.a);

  const toSign = derOf(set(attrs));
  const md = forge.md.sha256.create();
  md.update(toSign);
  const signature = key.sign(md);

  const signedAttrs = ctx(0, attrs);
  const sha256Alg = seq([oid(OID.sha256), asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, "")]);
  const signerInfo = seq([
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, String.fromCharCode(1)),
    seq([issuer, serial]),
    sha256Alg,
    signedAttrs,
    seq([oid(OID.rsaEncryption), asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, "")]),
    octets(signature),
  ]);

  const signedData = seq([
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, String.fromCharCode(1)),
    set([sha256Alg]),
    seq([oid(OID.data), ctx(0, [octets(content)])]),
    ctx(0, [certAsn1]),
    set([signerInfo]),
  ]);

  const contentInfo = seq([oid(OID.signedData), ctx(0, [signedData])]);
  return Buffer.from(derOf(contentInfo), "binary");
}

function children(node: forge.asn1.Asn1): forge.asn1.Asn1[] {
  return Array.isArray(node.value) ? (node.value as forge.asn1.Asn1[]) : [];
}

function octetContent(node: forge.asn1.Asn1): string {
  if (Array.isArray(node.value)) {
    return (node.value as forge.asn1.Asn1[]).map(octetContent).join("");
  }
  return node.value as string;
}

function oidOf(node: forge.asn1.Asn1): string {
  return asn1.derToOid(node.value as string);
}

function invalid(): VerifyResult {
  return { valid: false, signedContent: Buffer.alloc(0), signerCn: null };
}

/**
 * Verifica firma e integrita di un p7m CAdES-BES attached (DER).
 * Non lancia mai: in caso di struttura malformata o firma errata ritorna valid=false.
 */
export function verifyCadesBes(p7m: Buffer): VerifyResult {
  try {
    const root = asn1.fromDer(p7m.toString("binary"));
    const sd = children(children(root)[1])[0];
    const parts = children(sd);
    const encap = parts[2];
    const content = octetContent(children(children(encap)[1])[0]);

    const certsNode = parts.find(
      (p) => p.tagClass === asn1.Class.CONTEXT_SPECIFIC && p.type === 0,
    );
    const signerInfos = parts[parts.length - 1];
    const si = children(children(signerInfos)[0]);
    const [, sid, digestAlg, signedAttrsNode, , sigNode] = si;
    if (!certsNode || signedAttrsNode?.type !== 0 || oidOf(children(digestAlg)[0]) !== OID.sha256) {
      return invalid();
    }

    // Certificato del firmatario individuato da issuer+serial.
    const sidIssuer = derOf(children(sid)[0]);
    const sidSerial = derOf(children(sid)[1]);
    const certAsn1 = children(certsNode).find((c) => {
      const p = certParts(c);
      return derOf(p.issuer) === sidIssuer && derOf(p.serial) === sidSerial;
    });
    if (!certAsn1) return invalid();
    const cert = forge.pki.certificateFromAsn1(certAsn1);
    const signerCn = (cert.subject.getField("CN")?.value as string | undefined) ?? null;

    // Attributi firmati.
    const attrs = new Map<string, forge.asn1.Asn1>();
    for (const a of children(signedAttrsNode)) {
      const [t, v] = children(a);
      attrs.set(oidOf(t), children(v)[0]);
    }
    const md = attrs.get(OID.messageDigest);
    const ct = attrs.get(OID.contentType);
    const scv2 = attrs.get(OID.signingCertificateV2);
    if (!md || !ct || !scv2) return invalid();
    if (oidOf(ct) !== OID.data) return invalid();
    if (md.value !== sha256(content)) return invalid();

    // signing-certificate-v2 deve riferirsi al certificato del firmatario.
    const essId = children(children(children(scv2)[0])[0]);
    const hashNode = essId.find((n) => n.type === asn1.Type.OCTETSTRING);
    if (!hashNode || hashNode.value !== sha256(derOf(certAsn1))) return invalid();

    // Firma RSA sugli attributi codificati come SET OF.
    const asSet = asn1.create(
      asn1.Class.UNIVERSAL,
      asn1.Type.SET,
      true,
      signedAttrsNode.value as forge.asn1.Asn1[],
    );
    const h = forge.md.sha256.create();
    h.update(derOf(asSet));
    const publicKey = cert.publicKey as forge.pki.rsa.PublicKey;
    const ok = publicKey.verify(h.digest().getBytes(), sigNode.value as string);
    if (!ok) return invalid();

    return { valid: true, signedContent: Buffer.from(content, "binary"), signerCn };
  } catch {
    return invalid();
  }
}
