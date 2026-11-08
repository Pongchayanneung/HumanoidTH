import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rekeyRelease } from "../lib/search/rekey-release";
import { createReleaseVectorLoader } from "../lib/search/vector-loader";
import { VectorReleaseBuilder } from "../lib/search/vector-builder";
import { DEFAULT_MODEL_PROFILE } from "../lib/search/vector-types";
import type { SearchDocument, SearchExportManifest } from "../lib/search/types";

const dims = DEFAULT_MODEL_PROFILE.dimensions;
const unit = (axis: number) => { const v = new Float32Array(dims); v[axis] = 1; return v; };
const doc = (typedId: string, kind: SearchDocument["kind"], text: string): SearchDocument => ({
  typedId, kind, title: `T ${text}`, body: text, retrievalText: text, url: null, groupId: typedId, origin: "web", language: "en",
  isTitleOnly: false, isPartial: false, parentTypedId: null, contentHash: `h-${typedId}`, dependencyHash: `d-${typedId}`,
  vectorRow: null, evidence: [], metadata: {},
});
const baseManifest = (releaseId: string): SearchExportManifest => ({
  manifestVersion: "1.0", datasetId: "test-db", releaseId, generatedAt: "2026-11-08T00:00:00.000Z",
  counts: { totalEligible: 0, byKind: {}, byLanguage: {}, excluded: 0, emptyKinds: [] },
} as unknown as SearchExportManifest);

/** A real source release keyed by seed-style ids, built with the real builder and an in-test generator. */
async function makeSourceRelease(dir: string, docs: SearchDocument[]) {
  const documentsPath = join(dir, "documents.json");
  writeFileSync(documentsPath, JSON.stringify(docs));
  let next = 0;
  await new VectorReleaseBuilder({
    documentsPath, outputDir: join(dir, "out"), checkpointDir: join(dir, "ckpt"), stagingDir: join(dir, "stage"), profile: DEFAULT_MODEL_PROFILE, releaseId: "src",
    embeddingGenerator: { generateBatches: async (texts) => texts.map(() => unit(next++)) },
  }).build();
  return join(dir, "out", "releases", "src");
}

test("rekey moves vectors onto database ids by identical text, writes a release the loader accepts, and reports ids only", async () => {
  const root = mkdtempSync(join(tmpdir(), "rekey-test-"));
  try {
    const sourceDir = await makeSourceRelease(root, [doc("source:seed-0", "source", "alpha"), doc("robot:seed-1", "robot", "beta"), doc("source:seed-2", "source", "gamma")]);
    // The served database: same texts under new ids, one edited record, one new record, one same text of another kind.
    const served = [doc("source:cuid-a", "source", "alpha"), doc("robot:cuid-b", "robot", "beta"), doc("source:cuid-c", "source", "gamma edited"), doc("source:cuid-d", "source", "delta"), doc("contribution:cuid-e", "contribution", "alpha")];
    const outputDir = join(root, "deploy");
    const result = await rekeyRelease({ sourceDir, documents: served, baseManifest: baseManifest("rk"), outputDir, releaseId: "rk", minCoverage: 0.4 });
    assert.equal(result.written, true);
    assert.deepEqual([result.total, result.matched], [5, 2]);
    assert.deepEqual(result.byKind, { source: { total: 3, matched: 1 }, robot: { total: 1, matched: 1 }, contribution: { total: 1, matched: 0 } });
    assert.deepEqual(result.unmatchedIds, ["contribution:cuid-e", "source:cuid-c", "source:cuid-d"]);
    assert.ok(!JSON.stringify(result).includes("edited"), "the report carries ids, never record content");
    for (const file of ["documents.json", "manifest.json", "vectors.f32", "probe-128.json"]) assert.ok(existsSync(join(outputDir, "releases", "rk", file)), file);
    const pointer = JSON.parse(readFileSync(join(outputDir, "active-release.json"), "utf8"));
    assert.equal(pointer.releaseId, "rk");
    assert.equal(pointer.files.vectors, "releases/rk/vectors.f32");

    // The real loader (full validation) accepts it and attaches the right vectors to the served ids only.
    const index = { documents: served.map((d) => ({ ...d })), release: { id: "rk", generatedAt: "x" }, coverage: { indexed: 0, eligible: 5 } };
    const vectors = await createReleaseVectorLoader({ searchDir: outputDir })(index, new AbortController().signal);
    assert.ok(vectors);
    const rows = Object.fromEntries(index.documents.map((d) => [d.typedId, d.vectorRow]));
    assert.equal(rows["source:cuid-c"], null);
    assert.equal(rows["source:cuid-d"], null);
    assert.equal(rows["contribution:cuid-e"], null);
    assert.deepEqual(Array.from(vectors.rows.get(rows["source:cuid-a"]!)!.slice(0, 3)), [1, 0, 0]);
    assert.equal(vectors.rows.get(rows["robot:cuid-b"]!)![1], 1);

    // A later edit to a record changes its contentHash, so the old vector no longer attaches: it drops to keyword.
    const edited = { ...index, documents: served.map((d) => ({ ...d, contentHash: d.typedId === "source:cuid-a" ? "changed" : d.contentHash })) };
    await createReleaseVectorLoader({ searchDir: outputDir })(edited, new AbortController().signal);
    assert.equal(edited.documents.find((d) => d.typedId === "source:cuid-a")!.vectorRow, null);
    assert.notEqual(edited.documents.find((d) => d.typedId === "robot:cuid-b")!.vectorRow, null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("rekey refuses to write below the coverage threshold and leaves the output untouched", async () => {
  const root = mkdtempSync(join(tmpdir(), "rekey-test-"));
  try {
    const sourceDir = await makeSourceRelease(root, [doc("source:seed-0", "source", "alpha"), doc("source:seed-1", "source", "beta")]);
    const outputDir = join(root, "deploy");
    const served = [doc("source:x", "source", "alpha"), doc("source:y", "source", "other"), doc("source:z", "source", "another")];
    const refused = await rekeyRelease({ sourceDir, documents: served, baseManifest: baseManifest("rk"), outputDir, releaseId: "rk" });
    assert.equal(refused.written, false);
    assert.match(refused.reason ?? "", /below the minimum 95%/);
    assert.equal(existsSync(outputDir), false);
    const none = await rekeyRelease({ sourceDir, documents: [doc("source:q", "source", "nothing alike")], baseManifest: baseManifest("rk"), outputDir, releaseId: "rk", minCoverage: 0.01 });
    assert.equal(none.written, false);
    assert.equal(existsSync(outputDir), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("rekey rejects a source release bound to another model profile", async () => {
  const root = mkdtempSync(join(tmpdir(), "rekey-test-"));
  try {
    const sourceDir = await makeSourceRelease(root, [doc("source:seed-0", "source", "alpha")]);
    const manifestPath = join(sourceDir, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.modelProfile.profileHash = "other-profile";
    writeFileSync(manifestPath, JSON.stringify(manifest));
    await assert.rejects(rekeyRelease({ sourceDir, documents: [doc("source:x", "source", "alpha")], baseManifest: baseManifest("rk"), outputDir: join(root, "deploy"), releaseId: "rk", minCoverage: 0.5 }), /pinned model profile/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("rekey never overwrites a published release or its pointer, and leaves no temporary files", async () => {
  const root = mkdtempSync(join(tmpdir(), "rekey-test-"));
  try {
    const sourceDir = await makeSourceRelease(root, [doc("source:seed-0", "source", "alpha"), doc("source:seed-1", "source", "")]);
    const outputDir = join(root, "deploy");
    const served = [doc("source:x", "source", "alpha"), doc("source:y", "source", "")];
    const first = await rekeyRelease({ sourceDir, documents: served, baseManifest: baseManifest("rk"), outputDir, releaseId: "rk", minCoverage: 0.9 });
    assert.equal(first.matched, 2, "an empty retrievalText falls back to the title, as the builder embeds it");
    const pointerBefore = readFileSync(join(outputDir, "active-release.json"), "utf8");
    const vectorsBefore = readFileSync(join(outputDir, "releases", "rk", "vectors.f32"));
    await assert.rejects(rekeyRelease({ sourceDir, documents: served, baseManifest: baseManifest("rk"), outputDir, releaseId: "rk", minCoverage: 0.9 }), /already exists/);
    assert.equal(readFileSync(join(outputDir, "active-release.json"), "utf8"), pointerBefore);
    assert.ok(readFileSync(join(outputDir, "releases", "rk", "vectors.f32")).equals(vectorsBefore));
    // A refused run (low coverage) with a pointer already in place leaves the pointer untouched.
    const refused = await rekeyRelease({ sourceDir, documents: [doc("source:q", "source", "nothing")], baseManifest: baseManifest("rk2"), outputDir, releaseId: "rk2" });
    assert.equal(refused.written, false);
    assert.equal(readFileSync(join(outputDir, "active-release.json"), "utf8"), pointerBefore);
    assert.deepEqual(readdirSync(join(outputDir, "releases")), ["rk"]);
    assert.deepEqual(readdirSync(outputDir).sort(), ["active-release.json", "releases"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
