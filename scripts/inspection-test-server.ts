import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createInspectionFixture, inspectionOrigin } from "../test-integration/admin-inspection-fixture";

// Run Next directly against a freshly migrated local fixture, without the seed watcher.
const name = process.env.ISSUE8_BROWSER_DATABASE_NAME;
if (!name?.startsWith("hri_issue4_acceptance_inspect_")) {
  throw new Error("Use playwright.inspection.config.ts to provide a disposable inspection database name");
}
const fixture = await createInspectionFixture(name);
await fixture.sql.end();

const require = createRequire(import.meta.url);
const origin = new URL(inspectionOrigin);
const env: NodeJS.ProcessEnv = {
  ...process.env,
  ...fixture.environment,
  NEXT_TELEMETRY_DISABLED: "1",
  PRISMA_LOG_LEVEL: "silent",
  NETWORK_GRAPH_SOURCE: "file",
  GEMINI_API_KEY: "",
  GOOGLE_API_KEY: "",
  GITHUB_TOKEN: "",
  YOUTUBE_API_KEY: ""
};
const child = spawn(process.execPath, [
  require.resolve("next/dist/bin/next"), "dev", "--hostname", origin.hostname, "--port", origin.port
], { cwd: process.cwd(), env, stdio: "inherit", windowsHide: true });

let stopping = false;
function stop(signal: NodeJS.Signals) {
  if (stopping) return;
  stopping = true;
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    child.kill(signal);
  }
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
child.on("error", () => {
  process.stderr.write("Dedicated Next inspection server failed to start\n");
  process.exitCode = 1;
});
child.on("exit", code => { process.exitCode = stopping ? 0 : code ?? 1; });
