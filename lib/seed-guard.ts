// Guard for every explicit seeding path. No Prisma import on purpose, so it
// can be unit-tested without a generated client or a database.
//
// Seeding resets reviewed relevance status, re-grants the seed admin and
// appends duplicate job/submission rows (see docs/vercel-deploy.md), so it
// must be deliberate (ATLAS_ALLOW_SEED=1) and aimed at a local database.

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const ALLOWED_PROTOCOLS = new Set(["postgres:", "postgresql:"]);
// pg-connection-string lets these query keys override the host in the
// authority, so a hostname check on the authority alone is bypassable.
const HOST_OVERRIDE_KEYS = ["host", "hostaddr", "service"];

export function assertSeedAllowed(
  connectionString: string | undefined,
  env: Record<string, string | undefined> = process.env
): void {
  if (env.ATLAS_ALLOW_SEED !== "1") {
    throw new Error(
      "Seeding resets reviewed status and re-grants the seed admin. Re-run with ATLAS_ALLOW_SEED=1 against a disposable local database."
    );
  }
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for seeding.");
  }

  // Error messages never include the connection string (it may hold credentials).
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("Refusing to seed: DATABASE_URL is not a valid postgresql:// URL.");
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new Error("Refusing to seed: DATABASE_URL must be a direct postgresql:// URL.");
  }
  for (const key of HOST_OVERRIDE_KEYS) {
    if (url.searchParams.has(key)) {
      throw new Error(`Refusing to seed: DATABASE_URL must not set the "${key}" query parameter.`);
    }
  }
  if (!LOCAL_HOSTNAMES.has(url.hostname.toLowerCase())) {
    throw new Error("Refusing to seed a non-local database. Seed only localhost, 127.0.0.1 or [::1].");
  }
}
