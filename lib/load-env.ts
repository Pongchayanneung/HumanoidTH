// Replacement for `import "dotenv/config"` on every seed-relevant and disposable-check path
// (prisma.config.ts, prisma/seed.ts, scripts/watch-seed.ts, scripts/m7-crud-restart.ts).
//
// ATLAS_ALLOW_SEED and M7_DISPOSABLE_DATABASE are the "I mean it, right now" flags
// (lib/seed-guard.ts, lib/m7-test-guard.ts). A copy left in an env file would satisfy
// the guard on every later run without anyone choosing it, so they are read from the
// real environment only. The key is matched after uppercasing because process.env is
// case-insensitive on Windows, where atlas_allow_seed / m7_disposable_database
// would otherwise be copied in and read as the flag. Every other key keeps
// dotenv's behaviour: a file value never overrides one already in the environment.
import dotenv from "dotenv";

const NEVER_FROM_FILE = new Set(["ATLAS_ALLOW_SEED", "M7_DISPOSABLE_DATABASE"]);

export function loadEnvFile(
  target: Record<string, string | undefined> = process.env,
  path: string | undefined = process.env.DOTENV_CONFIG_PATH || undefined
): void {
  const fromFile: Record<string, string | undefined> = {};
  // Programmatic config() ignores DOTENV_CONFIG_PATH, so the path is passed here.
  dotenv.config({ processEnv: fromFile, quiet: true, path });
  for (const [key, value] of Object.entries(fromFile)) {
    if (NEVER_FROM_FILE.has(key.toUpperCase()) || target[key] !== undefined) continue;
    target[key] = value;
  }
}

loadEnvFile();
