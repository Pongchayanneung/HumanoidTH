/**
 * F9 handoff check (issue #21). Run from the repo root:
 *   npx tsx scripts/f9-handoff-check.ts
 * Read-only: reports pass/fail, prints a JSON summary and a table, exits 1 on any failure.
 * It does not deploy, edit package.json or contact any network.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, join, relative, resolve } from "node:path";

export interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface ManifestLike {
  releaseId?: string;
  modelProfile?: unknown;
  coverage?: unknown;
  fileChecksums?: Record<string, { sha256: string; bytes: number }>;
  [key: string]: unknown;
}

export const REQUIRED_SCRIPTS = ["typecheck", "test", "build"] as const;

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set(["node_modules", ".next", ".git"]);

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (st.isFile()) out.push(full);
  }
  return out;
}

function extOf(file: string): string {
  const i = file.lastIndexOf(".");
  return i < 0 ? "" : file.slice(i);
}

/** (a) Verify every file in manifest.fileChecksums exists with matching bytes and SHA-256. */
export function checkManifestChecksums(searchDir: string): CheckResult {
  const name = "manifest_checksums";
  const manifestPath = join(searchDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    return { name, passed: false, detail: `missing ${manifestPath}` };
  }
  let manifest: ManifestLike;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ManifestLike;
  } catch (err) {
    return { name, passed: false, detail: `manifest.json unreadable: ${(err as Error).message}` };
  }
  const entries = Object.entries(manifest.fileChecksums ?? {});
  if (entries.length === 0) {
    return { name, passed: false, detail: "manifest lists no fileChecksums" };
  }
  const errors: string[] = [];
  for (const [file, expected] of entries) {
    const p = join(searchDir, file);
    if (!existsSync(p)) {
      errors.push(`${file}: missing`);
      continue;
    }
    const bytes = readFileSync(p);
    if (bytes.length !== expected.bytes) {
      errors.push(`${file}: bytes expected ${expected.bytes}, found ${bytes.length}`);
    }
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (sha !== expected.sha256) errors.push(`${file}: sha256 mismatch`);
  }
  return errors.length === 0
    ? { name, passed: true, detail: `${entries.length} file(s) verified` }
    : { name, passed: false, detail: errors.join("; ") };
}

/** (b1) Search release files must not be shipped under public/. */
export function checkNoReleaseUnderPublic(root: string): CheckResult {
  const name = "release_not_in_public";
  const manifestPath = join(root, "data", "search", "manifest.json");
  const releaseNames = new Set<string>(["manifest.json", "active-release.json"]);
  if (existsSync(manifestPath)) {
    try {
      const m = JSON.parse(readFileSync(manifestPath, "utf8")) as ManifestLike;
      for (const f of Object.keys(m.fileChecksums ?? {})) releaseNames.add(f);
    } catch {
      // fall through with defaults
    }
  }
  const publicDir = join(root, "public");
  const hits = walk(publicDir)
    .filter((f) => {
      const rel = relative(publicDir, f).split("\\").join("/");
      return (
        rel.split("/").includes("search") ||
        rel.endsWith(".f32") ||
        rel.endsWith(".vec") ||
        releaseNames.has(basename(f)) && /search|vector|release|probe|documents/i.test(rel)
      );
    })
    .map((f) => relative(root, f));
  return hits.length === 0
    ? { name, passed: true, detail: "no search release files under public/" }
    : { name, passed: false, detail: `under public/: ${hits.join(", ")}` };
}

/** (b2) No client component (app/, components/) may reference data/search. */
export function checkNoClientReferences(root: string): CheckResult {
  const name = "release_not_in_client";
  const hits: string[] = [];
  for (const base of ["app", "components"]) {
    for (const f of walk(join(root, base))) {
      if (!SOURCE_EXTENSIONS.has(extOf(f))) continue;
      const text = readFileSync(f, "utf8");
      if (/data\/search/.test(text)) hits.push(relative(root, f));
    }
  }
  return hits.length === 0
    ? { name, passed: true, detail: "no data/search references in app/ or components/" }
    : { name, passed: false, detail: `references data/search: ${hits.join(", ")}` };
}

export function isSecretLikeName(fileName: string): boolean {
  const n = fileName.toLowerCase();
  return n === ".env" || n.startsWith(".env.") || n.endsWith(".pem") || n.includes("token");
}

/** (c) No secret-like file names under public/. */
export function checkNoSecretsInPublic(root: string): CheckResult {
  const name = "no_secret_names_in_public";
  const hits = walk(join(root, "public"))
    .filter((f) => isSecretLikeName(basename(f)))
    .map((f) => relative(root, f));
  return hits.length === 0
    ? { name, passed: true, detail: "no secret-like names under public/" }
    : { name, passed: false, detail: `secret-like: ${hits.join(", ")}` };
}

/** (d) Report required package.json scripts (read only). */
export function checkRequiredScripts(
  root: string,
  required: readonly string[] = REQUIRED_SCRIPTS
): CheckResult {
  const name = "required_scripts";
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return { name, passed: false, detail: "package.json missing" };
  let scripts: Record<string, string> = {};
  try {
    scripts = (JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> })
      .scripts ?? {};
  } catch (err) {
    return { name, passed: false, detail: `package.json unreadable: ${(err as Error).message}` };
  }
  const missing = required.filter((s) => !scripts[s]);
  return missing.length === 0
    ? { name, passed: true, detail: `present: ${required.join(", ")}` }
    : { name, passed: false, detail: `missing: ${missing.join(", ")}` };
}

export interface ReleaseInfo {
  commitSha: string;
  nodeVersion: string;
  releaseId: string;
  profile: unknown;
  coverage: unknown;
}

/** (e) Handoff facts. Values that are absent are reported as "UNRUN", never invented. */
export function collectReleaseInfo(root: string, commitSha: string, nodeVersion: string): ReleaseInfo {
  let manifest: ManifestLike = {};
  try {
    manifest = JSON.parse(readFileSync(join(root, "data", "search", "manifest.json"), "utf8")) as ManifestLike;
  } catch {
    // leave empty
  }
  return {
    commitSha,
    nodeVersion,
    releaseId: manifest.releaseId ?? "UNRUN",
    profile: manifest.modelProfile ?? "UNRUN",
    coverage: manifest.coverage ?? "UNRUN"
  };
}

export function runAllChecks(root: string): CheckResult[] {
  return [
    checkManifestChecksums(join(root, "data", "search")),
    checkNoReleaseUnderPublic(root),
    checkNoClientReferences(root),
    checkNoSecretsInPublic(root),
    checkRequiredScripts(root)
  ];
}

export function formatTable(results: CheckResult[]): string {
  const width = Math.max(...results.map((r) => r.name.length), 4);
  return results
    .map((r) => `${r.passed ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${r.detail}`)
    .join("\n");
}

function gitSha(root: string): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "UNRUN";
  }
}

export function main(root: string = resolve(process.cwd())): number {
  const results = runAllChecks(root);
  const info = collectReleaseInfo(root, gitSha(root), process.version);
  const ok = results.every((r) => r.passed);
  console.log(JSON.stringify({ ok, info, checks: results }, null, 2));
  console.log("");
  console.log(formatTable(results));
  console.log("");
  console.log(`commit:   ${info.commitSha}`);
  console.log(`node:     ${info.nodeVersion}`);
  console.log(`release:  ${info.releaseId}`);
  console.log(`profile:  ${JSON.stringify(info.profile)}`);
  console.log(`coverage: ${JSON.stringify(info.coverage)}`);
  console.log(ok ? "\nRESULT: PASS" : "\nRESULT: FAIL");
  return ok ? 0 : 1;
}

if (process.argv[1] && /f9-handoff-check\.[cm]?[jt]s$/.test(process.argv[1])) {
  process.exit(main());
}
