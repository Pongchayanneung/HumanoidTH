import { resolve } from "node:path";
import { exportSearchCorpusFromDb } from "../lib/search/exporter";
import { DEFAULT_MIN_REKEY_COVERAGE, rekeyRelease } from "../lib/search/rekey-release";

/**
 * Re-keys an existing vector release onto the database the service actually serves.
 *   DATABASE_URL=... tsx scripts/rekey-search-release.ts --source <release dir> --out <dir>
 *     [--release-id <id>] [--min-coverage 0.95]
 * The database is only read (exportSearchCorpusFromDb issues findMany calls). Nothing is written
 * unless coverage reaches the minimum. --out should be OUTSIDE the repository: vector files are
 * never committed.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = process.argv[i + 1];
  if (value === undefined || value.startsWith("--")) { console.error(`--${name} needs a value.`); process.exit(2); }
  return value;
}

async function main() {
  const source = arg("source");
  const out = arg("out");
  if (!source || !out) {
    console.error("Usage: tsx scripts/rekey-search-release.ts --source <release dir> --out <dir> [--release-id id] [--min-coverage 0.95]");
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required (read-only use)."); process.exit(2); }
  const minCoverage = arg("min-coverage") === undefined ? DEFAULT_MIN_REKEY_COVERAGE : Number(arg("min-coverage"));
  if (!(minCoverage > 0 && minCoverage <= 1)) { console.error("--min-coverage must be in (0, 1]."); process.exit(2); }
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const releaseId = arg("release-id") ?? `search-v1-hybrid-db-${day}`;

  const { prisma } = await import("../lib/prisma");
  try {
    const { documents, manifest } = await exportSearchCorpusFromDb(prisma);
    const result = await rekeyRelease({ sourceDir: resolve(source), documents, baseManifest: manifest, outputDir: resolve(out), releaseId, minCoverage });
    console.log(`Documents served by this database: ${result.total}`);
    console.log(`With a vector: ${result.matched} (${(result.coverage * 100).toFixed(2)}%)`);
    for (const [kind, s] of Object.entries(result.byKind)) console.log(`  ${kind}: ${s.matched} / ${s.total}${s.matched === 0 ? "   <-- WARNING: no vectors, this kind is keyword-only" : ""}`);
    console.log(`Unmatched ids (first ${result.unmatchedIds.length}): ${result.unmatchedIds.join(", ") || "none"}`);
    if (!result.written) { console.error(`REFUSED: ${result.reason}`); process.exit(1); }
    console.log(`Wrote releases/${releaseId}/ and active-release.json under ${resolve(out)}`);
  } finally {
    await (prisma as { $disconnect?: () => Promise<void> }).$disconnect?.();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "rekey failed"); process.exit(1); });
