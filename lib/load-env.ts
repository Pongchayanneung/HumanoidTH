// Replacement for `import "dotenv/config"` on every seed-relevant path
// (prisma.config.ts, prisma/seed.ts, scripts/watch-seed.ts).
//
// ATLAS_ALLOW_SEED is the "I mean it, right now" flag (lib/seed-guard.ts). A copy
// left in an env file would satisfy the guard on every later run without anyone
// choosing it, so it is read from the real environment only. Every other key keeps
// dotenv's behaviour: a file value never overrides one already in the environment.
import dotenv from "dotenv";

const NEVER_FROM_FILE = new Set(["ATLAS_ALLOW_SEED"]);

export function loadEnvFile(
  target: Record<string, string | undefined> = process.env,
  path: string | undefined = process.env.DOTENV_CONFIG_PATH || undefined
): void {
  const fromFile: Record<string, string | undefined> = {};
  // Programmatic config() ignores DOTENV_CONFIG_PATH, so the path is passed here.
  dotenv.config({ processEnv: fromFile, quiet: true, path });
  for (const [key, value] of Object.entries(fromFile)) {
    if (NEVER_FROM_FILE.has(key) || target[key] !== undefined) continue;
    target[key] = value;
  }
}

loadEnvFile();
