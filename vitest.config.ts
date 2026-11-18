import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    env: {
      LOG_LEVEL: "silent",
      // Chiave fissa di test: tutti i file di test condividono lo stesso DB e quindi la stessa chiave.
      SECRETS_MASTER_KEY: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
    },
    include: ["server/**/*.test.ts", "src/**/*.test.ts"],
  },
});
