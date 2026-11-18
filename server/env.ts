import { existsSync, readFileSync } from "node:fs";

/** Legge KEY=VALUE da testo .env (commenti e righe vuote ignorati, virgolette esterne rimosse). */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, "").trim();
    let value = line.slice(eq + 1).trim();
    if (/^(".*"|'.*')$/.test(value)) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

/**
 * Imposta in `env` le variabili del file .env che mancano o sono stringa vuota.
 * Non sovrascrive i valori presenti; senza file non fa nulla. Non logga mai i valori.
 */
export function loadEnvFile(path: string, env: NodeJS.ProcessEnv = process.env): string[] {
  if (!existsSync(path)) return [];
  const set: string[] = [];
  for (const [key, value] of Object.entries(parseEnv(readFileSync(path, "utf8")))) {
    if (env[key] === undefined || env[key] === "") {
      if (value === "") continue;
      env[key] = value;
      set.push(key);
    }
  }
  return set;
}
