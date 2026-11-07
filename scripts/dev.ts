import { spawn } from "node:child_process";

// Spawn the tools through node directly: no pnpm/.cmd spelling, no shell, and no
// dependence on pnpm's deps-status check. Checked on macOS; Windows and Linux
// untested. Next reads PORT from the inherited environment.
const watchSeedRequested = process.env.WATCH_SEED === "1";

if (watchSeedRequested && process.env.ATLAS_ALLOW_SEED !== "1") {
  console.error("[dev] WATCH_SEED=1 reseeds the database on every dataset change and also requires ATLAS_ALLOW_SEED=1 (disposable local database only).");
  process.exit(1);
}

const nextDev = spawn(process.execPath, ["./node_modules/next/dist/bin/next", "dev"], { stdio: "inherit" });
const seedWatch = watchSeedRequested
  ? spawn(process.execPath, ["--import", "tsx", "scripts/watch-seed.ts"], { stdio: "inherit" })
  : null;

if (!seedWatch) {
  console.log("[dev] Seed watcher disabled (default). Set WATCH_SEED=1 and ATLAS_ALLOW_SEED=1 to opt in.");
}

function shutdown(code = 0) {
  nextDev.kill();
  seedWatch?.kill();
  process.exit(code);
}

nextDev.on("exit", (code, signal) => shutdown(code ?? (signal ? 1 : 0)));
seedWatch?.on("exit", (code, signal) => shutdown(code ?? (signal ? 1 : 0)));

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));
