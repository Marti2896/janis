import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEnvFile } from "./env.ts";

function envFile(content: string): string {
  const p = join(mkdtempSync(join(tmpdir(), "env-")), ".env");
  writeFileSync(p, content);
  return p;
}

describe("loadEnvFile", () => {
  it("imposta variabile mancante e vuota, non sovrascrive quella valorizzata", () => {
    const p = envFile("# c\nA=uno\nB=due\nC=\"tre\"\n");
    const env = { B: "", C: "gia" } as unknown as NodeJS.ProcessEnv;
    const set = loadEnvFile(p, env);
    expect(env.A).toBe("uno");
    expect(env.B).toBe("due");
    expect(env.C).toBe("gia");
    expect(set.sort()).toEqual(["A", "B"]);
  });

  it("senza file non fa niente", () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(loadEnvFile("/nonexistent/.env", env)).toEqual([]);
    expect(env).toEqual({});
  });
});
