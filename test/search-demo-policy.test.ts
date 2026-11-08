import test from "node:test";
import assert from "node:assert/strict";
import { createSearchService, type SearchFixtureIndex } from "../lib/search/api";
import { createSemanticOptionsFromEnv } from "../lib/search/semantic-config";
import { DEMO_SEMANTIC_POLICY, FROZEN_SEMANTIC_POLICY } from "../lib/search/semantic-policy";
import { DEFAULT_MODEL_PROFILE as profile } from "../lib/search/vector-types";
import { documents } from "./fixtures/search/documents";

const axis = (n: number) => { const v = new Float32Array(profile.dimensions); v[n] = 1; return v; };
const docs = documents.map((d, i) => ({ ...d, vectorRow: i }));
const index = (): SearchFixtureIndex => ({ documents: docs, release: { id: "fixture", generatedAt: "2026-01-01" }, coverage: { indexed: 0, eligible: docs.length } });
const vectors = { profile, rows: new Map(docs.map((_, i) => [i, axis(i)])) };
const req = (query: string) => new Request("http://localhost/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) });
const setup = (extra: Parameters<typeof createSearchService>[0] extends infer T ? Partial<T> : never) =>
  createSearchService({ loadCorpus: async () => index(), revalidate: async () => true, loadVectors: async () => vectors, ...extra });
const run = async (handler: ReturnType<typeof setup>, query: string) => (await handler(req(query))).json();
const ids = (data: { groups: { results: { reference: { id: string } }[] }[] }) => data.groups.flatMap((g) => g.results.map((r) => r.reference.id));

test("demo switch off: the frozen policy never turns semantic on", async () => {
  const options = createSemanticOptionsFromEnv({ EMBEDDING_SERVICE_URL: "http://127.0.0.1:8870" });
  assert.equal(options.policy, FROZEN_SEMANTIC_POLICY);
  assert.equal(FROZEN_SEMANTIC_POLICY.calibrationStatus, "provisional_uncalibrated");
  for (const value of ["", "0", "true", "yes"]) {
    assert.equal(createSemanticOptionsFromEnv({ EMBEDDING_SERVICE_URL: "http://x", ATLAS_SEMANTIC_DEMO: value }).policy?.calibrationStatus, "provisional_uncalibrated");
  }
  const data = await run(setup({ policy: FROZEN_SEMANTIC_POLICY, embedQuery: async () => axis(0) }), "robot");
  assert.equal(data.mode, "keyword");
  assert.equal(data.policyStatus, undefined);
});

test("demo switch on: the env selects the demo policy and a good embedder gives a labelled semantic result", async () => {
  const options = createSemanticOptionsFromEnv({ EMBEDDING_SERVICE_URL: "http://127.0.0.1:8870", ATLAS_SEMANTIC_DEMO: "1" });
  assert.equal(options.policy, DEMO_SEMANTIC_POLICY);
  assert.equal(DEMO_SEMANTIC_POLICY.calibrationStatus, "demo_unvalidated");
  assert.equal(DEMO_SEMANTIC_POLICY.semanticCutoffThreshold, FROZEN_SEMANTIC_POLICY.semanticCutoffThreshold);
  const data = await run(setup({ policy: DEMO_SEMANTIC_POLICY, embedQuery: async () => axis(1) }), "zzqq nothing in text");
  assert.equal(data.mode, "hybrid");
  assert.equal(data.policyStatus, "demo_unvalidated");
  assert.deepEqual(ids(data), [docs[1].typedId]);
  assert.deepEqual(data.groups[0].results[0].match.methods, ["semantic"]);
  assert.deepEqual(data.coverage, { indexed: docs.length, eligible: docs.length });
});

test("demo is semantic-first: an unrelated embedding suppresses keyword-only hits, unlike the RRF blend", async () => {
  const unrelated = async () => axis(docs.length + 5);
  const demo = await run(setup({ policy: DEMO_SEMANTIC_POLICY, embedQuery: unrelated }), "robot");
  assert.equal(demo.policyStatus, "demo_unvalidated");
  assert.deepEqual(ids(demo), []);
  const blend = await run(setup({ policy: { ...FROZEN_SEMANTIC_POLICY, calibrationStatus: "calibrated_on_dev_split" }, embedQuery: unrelated }), "robot");
  assert.ok(ids(blend).length > 0);
  assert.equal(blend.policyStatus, undefined);
});

test("demo keeps keyword hits for records with no vector, but still drops vectored records under the cutoff", async () => {
  const unrelated = async () => axis(docs.length + 5);
  const keywordOnly = ids(await run(setup({ policy: DEMO_SEMANTIC_POLICY }), "robot"));
  assert.ok(keywordOnly.length >= 1, "fixture must have a keyword hit for the query");
  const rowOf = (typedId: string) => docs.findIndex((d) => d.typedId === typedId);
  const withRows = (vectored: string): SearchFixtureIndex["documents"] => docs.map((d) => ({ ...d, vectorRow: d.typedId === vectored ? rowOf(vectored) : null }));
  const handlerFor = (documents: SearchFixtureIndex["documents"]) => setup({ loadCorpus: async () => ({ ...index(), documents }), policy: DEMO_SEMANTIC_POLICY, embedQuery: unrelated });

  // Only a record that does not match the query has a vector: every keyword hit lacks a vector and must still be shown.
  const nonMatching = docs.find((d) => !keywordOnly.includes(d.typedId))!;
  const noVectorHits = await run(handlerFor(withRows(nonMatching.typedId)), "robot");
  assert.equal(noVectorHits.mode, "hybrid");
  assert.equal(noVectorHits.policyStatus, "demo_unvalidated");
  assert.deepEqual([...ids(noVectorHits)].sort(), [...keywordOnly].sort());

  // The top keyword hit has a vector that falls under the cutoff for an unrelated query: it stays suppressed.
  const scored = keywordOnly[0];
  const suppressed = await run(handlerFor(withRows(scored)), "robot");
  assert.ok(!ids(suppressed).includes(scored));
  assert.deepEqual([...ids(suppressed)].sort(), keywordOnly.filter((id) => id !== scored).sort());
});

test("demo ranks semantic results first, then keyword hits of records with no usable vector (zero vector counts as none)", async () => {
  const keywordOnly = ids(await run(setup({ policy: DEMO_SEMANTIC_POLICY }), "robot"));
  const nonMatching = docs.find((d) => !keywordOnly.includes(d.typedId))!;
  const goodRow = docs.findIndex((d) => d.typedId === nonMatching.typedId);
  const zeroRow = docs.length;
  const rows = new Map([...vectors.rows, [zeroRow, new Float32Array(profile.dimensions)]]);
  const documents: SearchFixtureIndex["documents"] = docs.map((d) => ({ ...d, vectorRow: d.typedId === nonMatching.typedId ? goodRow : d.typedId === keywordOnly[0] ? zeroRow : null }));
  const handler = setup({ loadCorpus: async () => ({ ...index(), documents }), loadVectors: async () => ({ profile, rows }), policy: DEMO_SEMANTIC_POLICY, embedQuery: async () => axis(goodRow) });
  const data = await run(handler, "robot");
  const out = ids(data);
  assert.equal(data.policyStatus, "demo_unvalidated");
  assert.equal(out[0], nonMatching.typedId, "the semantic hit comes first");
  assert.ok(out.includes(keywordOnly[0]), "a record whose only vector is all-zero is not scorable, so its keyword hit stays");
  assert.deepEqual([...out.slice(1)].sort(), [...keywordOnly].sort());
});

test("demo switch on but the embedder fails: keyword results with no demo label", async () => {
  for (const embedQuery of [async () => null, async () => { throw new Error("proxy down"); }]) {
    const data = await run(setup({ policy: DEMO_SEMANTIC_POLICY, embedQuery }), "robot");
    assert.equal(data.mode, "keyword");
    assert.equal(data.policyStatus, undefined);
    assert.ok(data.warnings.includes("degraded_semantic"));
    assert.ok(ids(data).length > 0);
  }
});
