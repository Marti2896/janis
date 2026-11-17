// Avvia tutto: docker compose (postgres, redis) -> migrazioni -> API Fastify + dashboard Next.
// Ctrl+C ferma tutto insieme.
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
if (!existsSync(`${root}.env`)) {
  copyFileSync(`${root}.env.example`, `${root}.env`);
  console.log("[dev] creato .env da .env.example");
}
process.loadEnvFile(`${root}.env`);

const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, stdio: "inherit", env: process.env });

console.log("[dev] avvio postgres e redis (docker compose)…");
if (run("docker", ["compose", "up", "-d", "--wait"]).status !== 0) {
  console.error("[dev] docker compose non è partito: Docker è acceso?");
  process.exit(1);
}
if (run("node", ["scripts/migrate.mjs"]).status !== 0) process.exit(1);

const children = [
  spawn("node", ["--watch", "server/index.ts"], { cwd: root, stdio: "inherit", env: process.env }),
  spawn("npx", ["next", "dev", "-p", process.env.WEB_PORT ?? "3000"], { cwd: root, stdio: "inherit", env: process.env }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill("SIGTERM");
  run("docker", ["compose", "stop"]);
  process.exit(code);
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
for (const c of children) c.on("exit", (code) => stop(code ?? 1));

console.log(`[dev] web http://localhost:${process.env.WEB_PORT ?? 3000}  api http://localhost:${process.env.API_PORT ?? 4000}/health`);
