import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { PrismaClient } from "../generated/prisma/index.js";
import { readOperatorConfig } from "../lib/operator-auth/config";
import { hashOperatorPassword } from "../lib/operator-auth/credentials";
import { createPostgresAuthStore } from "../lib/operator-auth/postgres-store";
import { createAcceptanceDatabase, operatorPassword, syntheticEnvironment } from "../test-integration/fixture";

// Explicit disposable-local guard and committed migration replay live in fixture.ts.
// Start Next directly, never the application's dev/seed-watch wrapper.
const name = process.env.ISSUE4_BROWSER_DATABASE_NAME;
if (!name) throw new Error("The dedicated Playwright configuration must provide a scratch database name");
const fixture = await createAcceptanceDatabase(name);
const passwordHash = await hashOperatorPassword(operatorPassword);
const environment = syntheticEnvironment(fixture.url, passwordHash);
const config = readOperatorConfig(environment);
if (!config) throw new Error("Invalid synthetic acceptance configuration");
const prisma = new PrismaClient({ datasourceUrl: fixture.url, log: [] });
try {
  if (!await createPostgresAuthStore(prisma).initialize(config)) throw new Error("Scratch operator activation failed");
} finally { await prisma.$disconnect(); await fixture.sql.end(); }

const require = createRequire(import.meta.url);
const env: NodeJS.ProcessEnv = { ...process.env, ...environment, NEXT_TELEMETRY_DISABLED: "1", PRISMA_LOG_LEVEL: "silent", NETWORK_GRAPH_SOURCE: "file" };
for (const key of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GITHUB_TOKEN", "YOUTUBE_API_KEY"]) delete env[key];
const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--hostname", "localhost", "--port", "3104"], {
  cwd: process.cwd(), env, stdio: "inherit", windowsHide: true
});
let stopping = false;
function stop(signal: NodeJS.Signals) {
  if (stopping) return;
  stopping = true;
  if (process.platform === "win32" && child.pid) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else child.kill(signal);
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
child.on("error", () => { process.stderr.write("Dedicated Next authentication server failed to start\n"); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = stopping ? 0 : code ?? 1; });
