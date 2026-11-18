import forge from "node-forge";
import { logEvent } from "./audit.ts";
import { getPool } from "./pool.ts";
import type { Db } from "./pool.ts";
import { createDbSecretStore } from "./secrets.ts";
import type { SecretStore } from "./secrets.ts";
import { ValidationError, requireAdmin } from "./scope.ts";
import type { Scope } from "./scope.ts";

export type SdiEnvironment = "demo" | "production";
export type ExpiryLevel = "expired" | "critical" | "warning" | "ok";

const DAY = 24 * 60 * 60 * 1000;

/** Scaduto o entro 7 giorni = critical (rosso); entro 30 giorni = warning (giallo); oltre = ok (nessun badge). */
export function expiryLevel(notAfter: Date, now: Date = new Date()): ExpiryLevel {
  const left = notAfter.getTime() - now.getTime();
  if (left <= 0) return "expired";
  if (left <= 7 * DAY) return "critical";
  if (left <= 30 * DAY) return "warning";
  return "ok";
}

export type CertificateRow = {
  id: string;
  subject: string;
  issuer: string;
  notAfter: Date;
  environment: SdiEnvironment;
  active: boolean;
  createdAt: Date;
  level: ExpiryLevel;
};

const dn = (attrs: forge.pki.CertificateField[]) =>
  attrs.map((a) => `${a.shortName ?? a.name}=${String(a.value)}`).join(", ");

const MSG_BAD = "Password errata o file non valido.";

/** Estrae certificato e chiave privata (PEM non cifrato) da PKCS#12 oppure PEM. */
export function parseCertificateFile(file: Buffer, password?: string): { certPem: string; keyPem: string; cert: forge.pki.Certificate } {
  try {
    const text = file.toString("latin1");
    let cert: forge.pki.Certificate | undefined;
    let key: forge.pki.PrivateKey | undefined;
    if (text.includes("-----BEGIN")) {
      for (const m of forge.pem.decode(text)) {
        if (m.type === "CERTIFICATE" && !cert) cert = forge.pki.certificateFromPem(forge.pem.encode(m));
        else if (m.type === "ENCRYPTED PRIVATE KEY") {
          const info = forge.pki.decryptPrivateKeyInfo(forge.asn1.fromDer(forge.util.createBuffer(m.body)), password ?? "");
          if (!info) throw new Error("password");
          key = forge.pki.privateKeyFromAsn1(info);
        } else if (m.type === "RSA PRIVATE KEY" || m.type === "PRIVATE KEY") {
          key = m.procType?.type === "ENCRYPTED" ? forge.pki.decryptRsaPrivateKey(forge.pem.encode(m), password ?? "") : forge.pki.privateKeyFromPem(forge.pem.encode(m));
        }
      }
    } else {
      const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(file.toString("binary")), password ?? "");
      const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];
      const plainBags = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? [];
      key = [...keyBags, ...plainBags][0]?.key;
      const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
      cert = certBags.find((b) => b.cert)?.cert;
    }
    if (!cert || !key) throw new Error("incompleto");
    return { certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(key), cert };
  } catch {
    throw new ValidationError(MSG_BAD, "file");
  }
}

const map = (x: Record<string, unknown>): CertificateRow => ({
  id: x.id as string,
  subject: x.subject as string,
  issuer: x.issuer as string,
  notAfter: x.not_after as Date,
  environment: x.environment as SdiEnvironment,
  active: x.active as boolean,
  createdAt: x.created_at as Date,
  level: expiryLevel(x.not_after as Date),
});

/** Carica un certificato: la chiave privata va cifrata nel SecretStore, in DB restano solo i metadati. Solo admin. */
export async function addCertificate(
  scope: Scope,
  input: { file: Buffer; password?: string; environment: SdiEnvironment },
  actorUserId: string | null,
  db: Db = getPool(),
  store: SecretStore = createDbSecretStore(db),
): Promise<CertificateRow> {
  requireAdmin(scope);
  if (input.environment !== "demo" && input.environment !== "production") throw new ValidationError("Ambiente non valido.", "environment");
  const { certPem, keyPem, cert } = parseCertificateFile(input.file, input.password);
  const ref = await store.put(Buffer.from(certPem + keyPem, "utf8"));
  await db.query("update certificates set active = false where environment = $1", [input.environment]);
  const r = await db.query(
    `insert into certificates (subject, issuer, not_after, environment, secret_ref, active)
     values ($1, $2, $3, $4, $5, true) returning id, subject, issuer, not_after, environment, active, created_at`,
    [dn(cert.subject.attributes), dn(cert.issuer.attributes), cert.validity.notAfter, input.environment, ref],
  );
  await logEvent({ actorUserId, event: "certificate.uploaded", entity: "certificate", entityId: r.rows[0].id, detail: { subject: r.rows[0].subject, environment: input.environment } }, db);
  return map(r.rows[0]);
}

export async function listCertificates(scope: Scope, db: Db = getPool()): Promise<CertificateRow[]> {
  requireAdmin(scope);
  const r = await db.query("select id, subject, issuer, not_after, environment, active, created_at from certificates order by not_after desc");
  return r.rows.map(map);
}

/** Certificato attivo e non scaduto per l'ambiente (uso interno del servizio di firma). */
export async function getActiveCertificate(
  environment: SdiEnvironment,
  db: Db = getPool(),
  store: SecretStore = createDbSecretStore(db),
): Promise<{ id: string; certPem: string; keyPem: string; notAfter: Date } | null> {
  const r = await db.query(
    "select id, secret_ref, not_after from certificates where environment = $1 and active and not_after > now() order by created_at desc limit 1",
    [environment],
  );
  if (!r.rows[0]) return null;
  const bundle = await store.get(r.rows[0].secret_ref);
  if (!bundle) return null;
  const text = bundle.toString("utf8");
  const split = text.indexOf("-----BEGIN RSA PRIVATE KEY-----");
  const k = split >= 0 ? split : text.indexOf("-----BEGIN PRIVATE KEY-----");
  return { id: r.rows[0].id, certPem: text.slice(0, k), keyPem: text.slice(k), notAfter: r.rows[0].not_after };
}

export async function hasValidCertificate(environment: SdiEnvironment, db: Db = getPool()): Promise<boolean> {
  const r = await db.query("select 1 from certificates where environment = $1 and active and not_after > now() limit 1", [environment]);
  return (r.rowCount ?? 0) > 0;
}
