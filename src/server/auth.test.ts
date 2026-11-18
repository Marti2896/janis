import { randomBytes, randomUUID } from "node:crypto";
import forge from "node-forge";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authenticate, changePassword, destroySession, getSession } from "./auth.ts";
import { expiryLevel, addCertificate, getActiveCertificate, hasValidCertificate } from "./certificates.ts";
import { getChannelSettings, saveChannelSettings } from "./channel-settings.ts";
import { generateTemporaryPassword, hashPassword, verifyPassword } from "./password.ts";
import { createDbSecretStore, decryptSecret, encryptSecret } from "./secrets.ts";
import { createTenant } from "./tenants.ts";
import { resetPassword, setUserDisabled } from "./users.ts";

const DAY = 86_400_000;

describe("password", () => {
  it("hash argon2id e verifica", async () => {
    const h = await hashPassword("Password-lunga-1");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "Password-lunga-1")).toBe(true);
    expect(await verifyPassword(h, "sbagliata")).toBe(false);
    expect(await verifyPassword("non-un-hash", "x")).toBe(false);
  });
  it("la password temporanea e lunga almeno 12 caratteri", () => {
    expect(generateTemporaryPassword().length).toBeGreaterThanOrEqual(12);
  });
});

describe("cifratura segreti AES-256-GCM", () => {
  it("cifra e decifra, rifiuta chiave errata o dato manomesso", () => {
    const key = randomBytes(32);
    const payload = encryptSecret(Buffer.from("chiave-privata"), key);
    expect(payload).not.toContain("chiave-privata");
    expect(decryptSecret(payload, key).toString()).toBe("chiave-privata");
    expect(() => decryptSecret(payload, randomBytes(32))).toThrow();
    const raw = Buffer.from(payload, "base64");
    raw[raw.length - 1] ^= 1;
    expect(() => decryptSecret(raw.toString("base64"), key)).toThrow();
  });
});

describe("soglie badge scadenza certificato", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  it("rosso se scaduto o entro 7 giorni, giallo entro 30, altrimenti ok", () => {
    expect(expiryLevel(new Date(now.getTime() - DAY), now)).toBe("expired");
    expect(expiryLevel(new Date(now.getTime() + 7 * DAY), now)).toBe("critical");
    expect(expiryLevel(new Date(now.getTime() + 8 * DAY), now)).toBe("warning");
    expect(expiryLevel(new Date(now.getTime() + 30 * DAY), now)).toBe("warning");
    expect(expiryLevel(new Date(now.getTime() + 31 * DAY), now)).toBe("ok");
  });
});

const url = process.env.DATABASE_URL ?? "postgres://sdi:sdi_dev_only@localhost:54320/sdi_channel";
const pool = new pg.Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 1500 });
let dbReady = true;
try {
  await pool.query("select 1 from users, sessions, certificates, channel_settings limit 1");
} catch {
  dbReady = false;
  console.warn("Postgres non raggiungibile o non migrato: test auth con DB saltati");
}
afterAll(() => pool.end());

function makeP12(password: string, notAfter: Date): Buffer {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - DAY);
  cert.validity.notAfter = notAfter;
  const attrs = [{ name: "commonName", value: "Test Interscambio" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey);
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password);
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary");
}

describe.skipIf(!dbReady)("login e sessioni con Postgres", () => {
  const admin = { role: "admin" } as const;
  const tag = randomUUID().slice(0, 8);
  const piva = String(Math.floor(Math.random() * 1e11)).padStart(11, "0");
  let email = "";
  let userId = "";
  let tenantId = "";
  let temp = "";

  it("crea account con password temporanea e login riuscito", async () => {
    email = `t-${tag}@interscambio.test`;
    const r = await createTenant(admin, { denominazione: `Test ${tag}`, partitaIva: piva, email }, null, pool);
    userId = r.user.id;
    tenantId = r.tenant.id;
    temp = r.temporaryPassword;
    const a = await authenticate(email.toUpperCase(), temp, "1.1.1.1", pool);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.expiresAt.getTime()).toBeGreaterThan(Date.now() + 11 * 3600_000);
    const s = await getSession(a.token, pool);
    expect(s).toMatchObject({ userId, role: "cliente", tenantId, mustChangePassword: true });
    // in DB c'e solo l'hash del token
    const raw = await pool.query("select token_hash from sessions where user_id = $1", [userId]);
    expect(raw.rows.every((x) => x.token_hash !== a.token)).toBe(true);
  });

  it("password errata ed email inesistente danno lo stesso esito", async () => {
    expect(await authenticate(email, "sbagliata-sbagliata", "", pool)).toEqual({ ok: false, reason: "invalid" });
    expect(await authenticate(`nessuno-${tag}@x.test`, "qualunque-password", "", pool)).toEqual({ ok: false, reason: "invalid" });
  });

  it("logout invalida la sessione", async () => {
    const a = await authenticate(email, temp, "", pool);
    if (!a.ok) throw new Error("login atteso");
    await destroySession(a.token, pool);
    expect(await getSession(a.token, pool)).toBeNull();
  });

  it("sessione scaduta non e valida", async () => {
    const a = await authenticate(email, temp, "", pool);
    if (!a.ok) throw new Error("login atteso");
    await pool.query("update sessions set expires_at = now() - interval '1 minute' where user_id = $1", [userId]);
    expect(await getSession(a.token, pool)).toBeNull();
  });

  it("utente disabilitato: sessione persa e login rifiutato con lo stesso messaggio", async () => {
    const a = await authenticate(email, temp, "", pool);
    if (!a.ok) throw new Error("login atteso");
    await setUserDisabled(admin, userId, true, null, pool);
    expect(await getSession(a.token, pool)).toBeNull();
    expect(await authenticate(email, temp, "", pool)).toEqual({ ok: false, reason: "invalid" });
    await setUserDisabled(admin, userId, false, null, pool);
    await pool.query("delete from login_attempts where email_lc = $1", [email]);
  });

  it("cambio password: richiede la attuale, minimo 12 caratteri, azzera il flag", async () => {
    const a = await authenticate(email, temp, "", pool);
    if (!a.ok) throw new Error("login atteso");
    await expect(changePassword(userId, temp, "corta", a.token, pool)).rejects.toThrow(/12/);
    expect(await changePassword(userId, "errata-errata-1", "Nuova-password-1", a.token, pool)).toEqual({ ok: false, reason: "invalid" });
    expect(await changePassword(userId, temp, "Nuova-password-1", a.token, pool)).toEqual({ ok: true });
    expect((await getSession(a.token, pool))?.mustChangePassword).toBe(false);
    temp = "Nuova-password-1";
  });

  it("reset password dell'admin: nuova password temporanea, vecchia non vale piu, solo admin", async () => {
    await expect(resetPassword({ role: "cliente", tenantId }, userId, null, pool)).rejects.toThrow();
    const r = await resetPassword(admin, userId, null, pool);
    expect(r?.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    expect((await authenticate(email, temp, "", pool)).ok).toBe(false);
    const ok = await authenticate(email, r!.temporaryPassword, "", pool);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect((await getSession(ok.token, pool))?.mustChangePassword).toBe(true);
    await pool.query("delete from login_attempts where email_lc = $1", [email]);
  });

  it("blocco dopo 5 tentativi falliti: anche la password giusta viene rifiutata", async () => {
    const r = await createTenant(admin, { denominazione: `Lock ${tag}`, partitaIva: String(Math.floor(Math.random() * 1e11)).padStart(11, "0"), email: `lock-${tag}@interscambio.test` }, null, pool);
    const mail = r.user.email;
    for (let i = 0; i < 5; i++) expect(await authenticate(mail, "sbagliata-sbagliata", "9.9.9.9", pool)).toEqual({ ok: false, reason: "invalid" });
    expect(await authenticate(mail, r.temporaryPassword, "9.9.9.9", pool)).toEqual({ ok: false, reason: "locked" });
    // passati 15 minuti il blocco cade
    await pool.query("update login_attempts set attempted_at = now() - interval '16 minutes' where email_lc = $1", [mail]);
    expect((await authenticate(mail, r.temporaryPassword, "9.9.9.9", pool)).ok).toBe(true);
  });

  it("scrive audit di login riuscito, fallito e logout", async () => {
    const r = await pool.query("select distinct event from audit_log where actor_user_id = $1 or detail->>'email' = $2", [userId, email]);
    const ev = r.rows.map((x) => x.event);
    expect(ev).toEqual(expect.arrayContaining(["auth.login", "auth.login_failed", "auth.logout"]));
  });
});

describe.skipIf(!dbReady)("certificati e configurazione canale con Postgres", () => {
  const admin = { role: "admin" } as const;
  const key = randomBytes(32);
  const store = () => createDbSecretStore(pool, key);
  let snapshot: { key: string; value: string }[] = [];
  let preexisting: string[] = [];
  beforeAll(async () => {
    snapshot = (await pool.query("select key, value from channel_settings")).rows;
    preexisting = (await pool.query("select id from certificates")).rows.map((x) => x.id);
  });
  afterAll(async () => {
    // ripristina lo stato del DB di sviluppo
    const created = (await pool.query("select id, secret_ref from certificates where id <> all($1::uuid[])", [preexisting])).rows;
    await pool.query("delete from certificates where id <> all($1::uuid[])", [preexisting]);
    await pool.query("delete from secrets where ref = any($1)", [created.map((c) => c.secret_ref)]);
    await pool.query("delete from channel_settings");
    for (const r of snapshot) await pool.query("insert into channel_settings (key, value) values ($1, $2)", [r.key, r.value]);
  });

  it("password errata o file non valido", async () => {
    const p12 = makeP12("pw-corretta", new Date(Date.now() + 365 * DAY));
    await expect(addCertificate(admin, { file: p12, password: "errata", environment: "demo" }, null, pool, store())).rejects.toThrow("Password errata o file non valido.");
    await expect(addCertificate(admin, { file: Buffer.from("spazzatura"), environment: "demo" }, null, pool, store())).rejects.toThrow("Password errata o file non valido.");
  });

  it("nel DB non c'e nessuna chiave privata in chiaro e la si recupera dal SecretStore", async () => {
    const p12 = makeP12("pw-corretta", new Date(Date.now() + 365 * DAY));
    const c = await addCertificate(admin, { file: p12, password: "pw-corretta", environment: "demo" }, null, pool, store());
    expect(c.level).toBe("ok");
    const dump = JSON.stringify((await pool.query("select * from secrets")).rows) + JSON.stringify((await pool.query("select * from certificates")).rows);
    expect(dump).not.toMatch(/PRIVATE KEY/);
    const active = await getActiveCertificate("demo", pool, store());
    expect(active?.keyPem).toContain("PRIVATE KEY");
    expect(active?.certPem).toContain("BEGIN CERTIFICATE");
  });

  it("produzione rifiutata senza certificato valido o senza endpoint, accettata con entrambi", async () => {
    const before = await getChannelSettings(pool);
    const hadProd = await hasValidCertificate("production", pool);
    if (!hadProd) {
      await expect(saveChannelSettings(admin, { environment: "production", endpoint: "https://sdi.example/x" }, null, pool)).rejects.toThrow(/certificato/);
    }
    await addCertificate(admin, { file: makeP12("p", new Date(Date.now() + 365 * DAY)), password: "p", environment: "production" }, null, pool, store());
    await expect(saveChannelSettings(admin, { environment: "production", endpoint: "" }, null, pool)).rejects.toThrow(/endpoint/);
    const s = await saveChannelSettings(admin, { environment: "production", endpoint: "https://sdi.example/x" }, null, pool);
    expect(s.environment).toBe("production");
    const a = await pool.query("select detail from audit_log where event = 'channel.settings_changed' order by id desc limit 1");
    expect(a.rows[0].detail.before).toBeDefined();
    expect(before.environment).toBeDefined();
  });
});
