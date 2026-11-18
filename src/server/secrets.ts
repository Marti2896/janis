import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { getPool } from "./pool.ts";
import type { Db } from "./pool.ts";

/** Interfaccia SecretStore: oggi cifratura in DB, domani vault/secret manager senza toccare i chiamanti. */
export interface SecretStore {
  put(plaintext: Buffer): Promise<string>;
  get(ref: string): Promise<Buffer | null>;
}

/** SECRETS_MASTER_KEY: 32 byte in base64 o in esadecimale (64 caratteri). */
export function loadMasterKey(raw = process.env.SECRETS_MASTER_KEY): Buffer {
  if (!raw) throw new Error("SECRETS_MASTER_KEY non configurata (vedi .env.example).");
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("SECRETS_MASTER_KEY deve essere di 32 byte (base64 o esadecimale).");
  return key;
}

/** payload = base64(iv[12] | tag[16] | ciphertext) con AES-256-GCM. */
export function encryptSecret(plaintext: Buffer, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function decryptSecret(payload: string, key: Buffer): Buffer {
  const raw = Buffer.from(payload, "base64");
  const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]);
}

export function createDbSecretStore(db: Db = getPool(), masterKey?: Buffer): SecretStore {
  return {
    async put(plaintext) {
      const ref = `db:${randomUUID()}`;
      await db.query("insert into secrets (ref, payload) values ($1, $2)", [ref, encryptSecret(plaintext, masterKey ?? loadMasterKey())]);
      return ref;
    },
    async get(ref) {
      const r = await db.query("select payload from secrets where ref = $1", [ref]);
      return r.rows[0] ? decryptSecret(r.rows[0].payload, masterKey ?? loadMasterKey()) : null;
    },
  };
}
