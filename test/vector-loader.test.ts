import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VectorReleaseBuilder } from "../lib/search/vector-builder";
import { MOCK_MODEL_PROFILE } from "../lib/search/vector-types";
import { createReleaseVectorLoader, withKeywordFallback } from "../lib/search/vector-loader";
import { createSemanticOptionsFromEnv } from "../lib/search/semantic-config";
import type { SearchDocument } from "../lib/search/types";
import type { SearchFixtureIndex } from "../lib/search/api";

function doc(id: string, contentHash = `hash-${id}`): SearchDocument {
  return {
    typedId: `source:${id}`, kind: "source", title: `Title ${id}`, body: `body ${id}`, retrievalText: `${id} text`,
    url: `https://example.com/${id}`, groupId: `https://example.com/${id}`, origin: "web", language: "en",
    isTitleOnly: false, isPartial: false, parentTypedId: null, contentHash, dependencyHash: `dep-${id}`,
    vectorRow: null, evidence: [], metadata: {},
  };
}
const indexOf = (documents: SearchDocument[]): SearchFixtureIndex => ({ documents, release: { id: "live", generatedAt: "2026-11-08T00:00:00.000Z" }, coverage: { indexed: 0, eligible: documents.length } });
const signal = new AbortController().signal;

async function buildRelease(dir: string, docs: SearchDocument[]) {
  const documentsPath = join(dir, "input-documents.json");
  writeFileSync(documentsPath, JSON.stringify(docs), "utf8");
  const searchDir = join(dir, "search");
  mkdirSync(searchDir, { recursive: true });
  await new VectorReleaseBuilder({ documentsPath, outputDir: searchDir, profile: MOCK_MODEL_PROFILE, checkpointDir: join(dir, "ck"), stagingDir: join(dir, "stage") }).build();
  return searchDir;
}

test("loader attaches release rows to live documents by typedId and contentHash", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vector-loader-"));
  try {
    const searchDir = await buildRelease(dir, [doc("a"), doc("b"), doc("c")]);
    const live = [doc("c"), doc("a"), doc("b", "hash-changed"), doc("new")]; // different order, one changed, one unknown
    const vectors = await createReleaseVectorLoader({ searchDir })(indexOf(live), signal);
    assert.ok(vectors);
    assert.equal(vectors.profile.profileHash, MOCK_MODEL_PROFILE.profileHash);
    const byId = Object.fromEntries(live.map((d) => [d.typedId, d.vectorRow]));
    assert.equal(byId["source:a"], 0);
    assert.equal(byId["source:c"], 2);
    assert.equal(byId["source:b"], null, "a document that changed since the release has no vector");
    assert.equal(byId["source:new"], null);
    for (const row of [0, 2]) assert.equal(vectors.rows.get(row)?.length, 1024);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("loader returns null when there is no active release", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vector-loader-"));
  try {
    assert.equal(await createReleaseVectorLoader({ searchDir: dir })(indexOf([doc("a")]), signal), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("loader throws on a corrupted vector file and keyword fallback turns that into null", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vector-loader-"));
  try {
    const searchDir = await buildRelease(dir, [doc("a"), doc("b")]);
    const vectorsPath = join(searchDir, "releases", "search-v1-hybrid", "vectors.f32");
    const bytes = readFileSync(vectorsPath);
    bytes[10] = bytes[10] ^ 0xff; // flip one byte
    writeFileSync(vectorsPath, bytes);
    const loader = createReleaseVectorLoader({ searchDir });
    await assert.rejects(() => loader(indexOf([doc("a")]), signal), /invalid|checksum/i);
    await assert.rejects(() => loader(indexOf([doc("a")]), signal), /invalid|checksum/i, "a bad release keeps failing without being treated as valid");
    const logged: string[] = [];
    const safe = withKeywordFallback(createReleaseVectorLoader({ searchDir }), (m) => logged.push(m));
    assert.equal(await safe(indexOf([doc("a")]), signal), null);
    assert.equal(logged.length, 1);
    assert.match(logged[0], /keyword results/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("semantic config is empty without an endpoint or with the kill switch, and complete when configured", () => {
  assert.deepEqual(createSemanticOptionsFromEnv({}), {});
  assert.deepEqual(createSemanticOptionsFromEnv({ EMBEDDING_SERVICE_URL: "http://127.0.0.1:8080", ATLAS_SEMANTIC: "off" }), {});
  assert.deepEqual(createSemanticOptionsFromEnv({ EMBEDDING_SERVICE_URL: "http://127.0.0.1:8080", ATLAS_SEMANTIC: " OFF " }), {});
  for (const env of [{ EMBEDDING_SERVICE_URL: "http://127.0.0.1:8080" }, { TEI_ENDPOINT: "http://127.0.0.1:8080" }]) {
    const options = createSemanticOptionsFromEnv(env);
    assert.equal(typeof options.embedQuery, "function");
    assert.equal(typeof options.loadVectors, "function");
    assert.ok(options.policy);
  }
});
