import { spawn } from "node:child_process";

const watchSeedEnabled = process.env.WATCH_SEED === "1";
if (!watchSeedEnabled) {
  console.log("[dev] Seed watcher disabled by default (it writes to DATABASE_URL on every file change). Set WATCH_SEED=1 to enable.");
}

const nextDev = spawn("pnpm", ["dev:next"], { stdio: "inherit", shell: true });
const seedWatch = watchSeedEnabled
  ? spawn("pnpm", ["seed:watch"], { stdio: "inherit", shell: true })
  : null;

function shutdown(code = 0) {
  nextDev.kill();
  seedWatch?.kill();
  process.exit(code);
}

nextDev.on("exit", (code) => shutdown(code ?? 0));
seedWatch?.on("exit", (code) => shutdown(code ?? 0));

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));
