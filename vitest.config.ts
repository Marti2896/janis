import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { env: { LOG_LEVEL: "silent" }, include: ["server/**/*.test.ts", "src/**/*.test.ts"] },
});
