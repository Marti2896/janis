import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

// I test girano sul DB di sviluppo: i certificati cifrati li' dentro usano la chiave di .env, se presente.
function devMasterKey(): string | undefined {
  try {
    const m = /^SECRETS_MASTER_KEY=(.+)$/m.exec(readFileSync(path.resolve(__dirname, ".env"), "utf8"));
    return m?.[1].trim().replace(/^["']|["']$/g, "") || undefined;
  } catch {
    return undefined;
  }
}

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    globalSetup: ["./vitest.global-setup.ts"],
    env: {
      LOG_LEVEL: "silent",
      SECRETS_MASTER_KEY: devMasterKey() ?? "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
    },
    include: ["server/**/*.test.ts", "src/**/*.test.ts"],
  },
});
