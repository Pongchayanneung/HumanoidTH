import test from "node:test";
import assert from "node:assert/strict";
import { createSearchService, type SearchFixtureIndex } from "../lib/search/api";
import { FROZEN_SEMANTIC_POLICY } from "../lib/search/semantic-policy";
import { DEFAULT_MODEL_PROFILE as profile, MOCK_MODEL_PROFILE } from "../lib/search/vector-types";
import { documents } from "./fixtures/search/documents";

const policy = { ...FROZEN_SEMANTIC_POLICY, calibrationStatus: "calibrated_on_dev_split" as const };
const vector = new Float32Array(profile.dimensions); vector[0] = 1;
const docs = documents.map((d, i) => ({ ...d, vectorRow: i }));
const index = (): SearchFixtureIndex => ({ documents: docs, release: { id: "fixture", generatedAt: "2026-01-01" }, coverage: { indexed: 0, eligible: 2 } });
const vectors = { profile, rows: new Map([[0, vector]]) };
const req = (body: unknown) => new Request("http://localhost/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const setup = (extra: Partial<Parameters<typeof createSearchService>[0]> = {}) => createSearchService({ loadCorpus: async () => index(), revalidate: async () => true, ...extra });
const run = async (handler: ReturnType<typeof setup>, body: unknown) => { const response = await handler(req(body)); return { status: response.status, data: await response.json() }; };

test("serving validates Unicode and body bounds with typed errors and caps limits", async () => {
  const handler = setup();
  for (const body of [{ query: "😀".repeat(301) }, { query: "x", limit: 0 }, { query: "x", limit: 1.5 }, { query: "x".repeat(8200) }]) {
    const { status, data } = await run(handler, body); assert.equal(status, 400); assert.deepEqual(data.error, { code: "invalid_request", message: "Invalid search request." });
  }
  assert.equal((await run(handler, { query: ` ${"😀".repeat(300)} `, limit: 21 })).status, 200);
  assert.equal((await run(handler, { query: "", limit: 1 })).data.groups.length, 1);
});

test("browse skips inference and contains no match claims", async () => {
  let calls = 0;
  const handler = setup({ policy, loadVectors: async () => { calls++; return vectors; }, embedQuery: async () => { calls++; return vector; } });
  for (const query of ["", "the and", "ที่ และ"]) {
    const { data } = await run(handler, { query }); assert.equal(data.view, "browse"); assert.ok(data.groups.every((g: any) => g.results.every((r: any) => !("match" in r))));
  }
  assert.equal(calls, 0);
});

test("policy and vectors gate hybrid; partial coverage and provider failures are visible", async () => {
  const common = { loadVectors: async () => vectors, embedQuery: async () => vector };
  assert.equal((await run(setup(common), { query: "robot" })).data.mode, "keyword");
  assert.equal((await run(setup({ policy, embedQuery: common.embedQuery }), { query: "robot" })).data.mode, "keyword");
  const hybrid = (await run(setup({ ...common, policy }), { query: "robot" })).data;
  assert.equal(hybrid.mode, "hybrid"); assert.deepEqual(hybrid.coverage, { indexed: 1, eligible: 2 }); assert.ok(hybrid.warnings.includes("partial_vector_coverage"));
  for (const error of ["401 credential", "overloaded"]) {
    const data = (await run(setup({ ...common, policy, embedQuery: async () => { throw Error(error); } }), { query: "robot" })).data;
    assert.equal(data.mode, "keyword"); assert.ok(data.warnings.includes("degraded_semantic")); assert.ok(!JSON.stringify(data).includes(error));
  }
  const mismatch = (await run(setup({ ...common, policy, loadVectors: async () => ({ ...vectors, profile: MOCK_MODEL_PROFILE }) }), { query: "robot" })).data;
  assert.equal(mismatch.mode, "keyword"); assert.ok(mismatch.warnings.includes("degraded_semantic"));
  assert.doesNotMatch(JSON.stringify(hybrid), /score|vectorRow|similarity/);
});

test("invalid release and failed revalidation fail closed; rejected candidates refill", async () => {
  const bad = await run(setup({ loadCorpus: async () => { throw Error("secret release"); } }), { query: "robot" });
  assert.equal(bad.status, 503); assert.doesNotMatch(JSON.stringify(bad.data), /secret|research/);
  const failed = await run(setup({ revalidate: async () => { throw Error("secret check"); } }), { query: "robot" });
  assert.equal(failed.status, 503); assert.doesNotMatch(JSON.stringify(failed.data), /secret|research/);
  const invalidVectors = await run(setup({ policy, loadVectors: async () => { throw Error("invalid vector release"); }, embedQuery: async () => vector }), { query: "robot" });
  assert.equal(invalidVectors.status, 503); assert.equal(invalidVectors.data.mode, "unavailable"); assert.deepEqual(invalidVectors.data.groups, []); assert.doesNotMatch(JSON.stringify(invalidVectors.data), /Robot|หุ่นยนต์|invalid vector/);
  let checked = 0;
  const lateFailure = await run(setup({ revalidate: async () => { if (++checked === 2) throw Error("private check"); return true; } }), { query: "", limit: 2 });
  assert.equal(checked, 2); assert.equal(lateFailure.status, 503); assert.equal(lateFailure.data.mode, "unavailable"); assert.deepEqual(lateFailure.data.groups, []); assert.doesNotMatch(JSON.stringify(lateFailure.data), /Robot|หุ่นยนต์|private/);
  const refill = await run(setup({ revalidate: async (doc) => doc.typedId !== docs[0].typedId }), { query: "", limit: 1 });
  assert.equal(refill.data.groups[0].results[0].reference.id, docs[1].typedId);
  assert.deepEqual((await run(setup(), { query: "zzzzunknown" })).data.groups, []);
  let count = 0;
  const many = Array.from({ length: 210 }, (_, i) => ({ ...docs[0], typedId: `source:${i}`, groupId: `source:${i}` }));
  const bounded = await run(setup({ loadCorpus: async () => ({ ...index(), documents: many }), revalidate: async () => { count++; return false; } }), { query: "robot" });
  assert.equal(count, 200); assert.equal(bounded.status, 200); assert.deepEqual(bounded.data.groups, []);
});

test("matched ranges select original English and Thai text; semantic-only has excerpt and no ranges", async () => {
  const handler = setup();
  for (const [query, expected] of [["robot", "Robot"], ["หุ่นยนต์", "หุ่นยนต์"]]) {
    const data = (await run(handler, { query })).data;
    const matches = data.groups.flatMap((group: any) => group.results.map((result: any) => result.match));
    assert.ok(matches.length > 0);
    for (const match of matches) {
      assert.ok(match.ranges.length > 0);
      for (const range of match.ranges) assert.equal(match.evidence.originalText.slice(range.start, range.end).toLocaleLowerCase(), expected.toLocaleLowerCase());
    }
  }
  const data = (await run(setup({ policy, loadVectors: async () => vectors, embedQuery: async () => vector }), { query: "unrelated" })).data;
  const match = data.groups[0].results[0].match;
  assert.deepEqual(match.methods, ["semantic"]); assert.equal(match.ranges, undefined); assert.equal(match.evidence.originalText, docs[0].evidence[1].originalText);
});

test("injected deadlines abort inference and total work without sleeping", async () => {
  const jobs = new Map<number, () => void>();
  const clock = { setTimeout: (fn: () => void, ms: number) => { jobs.set(ms, fn); return ms; }, clearTimeout: (id: unknown) => { jobs.delete(id as number); } };
  let signal: AbortSignal | undefined;
  const pending = run(setup({ clock, policy, loadVectors: async () => vectors, embedQuery: async (_, s) => { signal = s; return new Promise(() => {}); } }), { query: "robot" });
  while (!jobs.has(2500)) await Promise.resolve();
  jobs.get(2500)!();
  const degraded = await pending; assert.equal(signal?.aborted, true); assert.equal(degraded.data.mode, "keyword"); assert.ok(degraded.data.warnings.includes("degraded_semantic"));
  const stuck = run(setup({ clock, loadCorpus: async () => new Promise(() => {}) }), { query: "robot" });
  while (!jobs.has(5000)) await Promise.resolve(); jobs.get(5000)!();
  assert.equal((await stuck).status, 503);
});

test("missing or uncalibrated policy skips vector loading and inference", async () => {
  let calls = 0;
  for (const candidate of [undefined, FROZEN_SEMANTIC_POLICY, { ...policy, isFrozen: false }]) {
    const data = (await run(setup({ policy: candidate, loadVectors: async () => { calls++; throw Error("private"); }, embedQuery: async () => { calls++; return vector; } }), { query: "robot" })).data;
    assert.equal(data.mode, "keyword"); assert.equal(data.groups.length, 1);
  }
  assert.equal(calls, 0);
});

test("check budget returns validated results and honors the policy limit", async () => {
  let checks = 0;
  const many = Array.from({ length: 10 }, (_, i) => ({ ...docs[0], typedId: `source:${i}`, groupId: `source:${i}` }));
  const limited = { ...policy, limits: { ...policy.limits, maxCurrentRecordChecks: 5 } };
  for (const query of ["", "robot"]) {
    checks = 0;
    const result = await run(setup({ policy: limited, loadCorpus: async () => ({ ...index(), documents: many }), revalidate: async () => ++checks === 1 }), { query, limit: 2 });
    assert.equal(result.status, 200); assert.equal(checks, 5); assert.equal(result.data.groups.length, 1);
  }
});

test("filtered vector coverage is disclosed without unnecessary inference", async () => {
  let calls = 0;
  const handler = setup({ policy, loadVectors: async () => vectors, embedQuery: async () => { calls++; return vector; } });
  const data = (await run(handler, { query: "หุ่นยนต์", types: ["robot"] })).data;
  assert.equal(calls, 0); assert.equal(data.mode, "keyword"); assert.deepEqual(data.coverage, { indexed: 0, eligible: 1 }); assert.deepEqual(data.warnings, ["partial_vector_coverage"]);
  const empty = (await run(handler, { query: "robot", types: ["inventory"] })).data;
  assert.equal(empty.mode, "keyword"); assert.deepEqual(empty.coverage, { indexed: 0, eligible: 0 }); assert.equal(calls, 0);
  const absent = (await run(setup({ policy, loadVectors: async () => ({ ...vectors, rows: new Map() }), embedQuery: async () => { calls++; return vector; } }), { query: "robot" })).data;
  assert.equal(calls, 0); assert.equal(absent.mode, "keyword"); assert.deepEqual(absent.coverage, { indexed: 0, eligible: 2 }); assert.deepEqual(absent.warnings, ["partial_vector_coverage"]);
});

test("fusion does not repeat candidates beyond the branch cap", async () => {
  const { fuseRankings } = await import("../lib/search/ranking");
  const hits = Array.from({ length: 52 }, (_, i) => ({ id: String(i), exactTitle: false, evidenceIndex: 0, ranges: [], score: 1 }));
  const fused = fuseRankings(hits, hits.map((hit) => hit.id), policy);
  assert.equal(fused.length, 52); assert.equal(new Set(fused).size, 52);
});
