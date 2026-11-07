import test from "node:test";
import assert from "node:assert/strict";
import { createSearchPost, type SearchFixtureIndex } from "../lib/search/api";
import { fuseRankings, keywordMatch, prepareQuery, rankKeyword, semanticRank, wordSegments } from "../lib/search/ranking";
import { groupCandidates } from "../lib/search/evaluation";
import { FROZEN_SEMANTIC_POLICY } from "../lib/search/semantic-policy";
import { DEFAULT_MODEL_PROFILE, MOCK_MODEL_PROFILE } from "../lib/search/vector-types";
import type { SearchDocument } from "../lib/search/types";
import { documents } from "./fixtures/search/documents";

const base = documents[0];
const ev = (fieldName: string, originalText: string, label = fieldName) => ({ fieldName, originalText, label, coverage: "full" as const, startOffset: 0, endOffset: originalText.length });
function doc(over: Partial<SearchDocument> & Pick<SearchDocument, "typedId" | "kind" | "title">, body = ""): SearchDocument {
  return { ...base, url: null, groupId: over.typedId, parentTypedId: null, metadata: {}, vectorRow: null, body, evidence: [ev("title", over.title, "Title"), ...(body ? [ev("excerpt", body, "Excerpt")] : [])], ...over };
}
type Data = { mode: string; view: string; warnings: string[]; groups: { groupKey: string; results: { reference: { id: string }; match?: { methods: string[]; ranges?: { start: number; end: number }[]; evidence: { originalText: string } } }[] }[] };
async function search(docs: SearchDocument[], body: object, extra: Partial<SearchFixtureIndex> = {}, options: Parameters<typeof createSearchPost>[1] = {}): Promise<Data> {
  const handler = createSearchPost(async () => ({ documents: docs, release: { id: "fixture", generatedAt: "2026-01-01" }, coverage: { indexed: docs.length, eligible: docs.length }, ...extra }), options);
  return (await handler(new Request("http://localhost/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }))).json();
}
const ids = (data: Data) => data.groups.flatMap((group) => group.results.map((result) => result.reference.id));

// Unit vectors in the policy-bound 1024-d space: cosine(e0, mix(c)) = c.
const DIM = DEFAULT_MODEL_PROFILE.dimensions;
const mix = (cosine: number) => { const v = new Float32Array(DIM); v[0] = cosine; v[1] = Math.sqrt(1 - cosine * cosine); return v; };
const queryVector = mix(1);
const vectorsFor = (cosines: number[]) => ({ profile: DEFAULT_MODEL_PROFILE, rows: new Map(cosines.map((c, row) => [row, mix(c)])) });

test("Intl.Segmenter splits Thai into words and keeps offsets into the original string", () => {
  const text = "หุ่นยนต์ช่วยนักวิจัย";
  const words = wordSegments(text);
  assert.ok(words.length >= 3, "Thai text with no spaces is segmented into several words");
  assert.ok(words.every((word) => text.slice(word.start, word.end).length > 0));
  assert.equal(text.slice(words[0].start, words.at(-1)!.end), text);
  const emoji = "A 😀 robot";
  const [a, robot] = wordSegments(emoji);
  assert.deepEqual([emoji.slice(a.start, a.end), emoji.slice(robot.start, robot.end)], ["A", "robot"]);
});

test("a Thai request matches by word, not only by an exact contiguous phrase", async () => {
  const care = doc({ typedId: "robot:care", kind: "robot", title: "หุ่นยนต์ดูแล" }, "ช่วยดูแลผู้สูงอายุที่บ้าน");
  const data = await search([care, doc({ typedId: "robot:other", kind: "robot", title: "หุ่นยนต์ส่งของ" }, "ส่งอาหารในโรงพยาบาล")], { query: "ผู้สูงอายุ ดูแล" });
  assert.deepEqual(ids(data), ["robot:care"]);
  const { ranges, evidence } = data.groups[0].results[0].match!;
  assert.ok(ranges!.every((range) => evidence.originalText.slice(range.start, range.end).length > 0));
});

test("matching uses a normalized query copy while evidence keeps the original string and offsets", async () => {
  const wide = doc({ typedId: "source:wide", kind: "source", title: "Arm" }, "The ＲＯＢＯＴ arm lifts boxes.");
  const data = await search([wide], { query: "robot" });
  const { evidence, ranges } = data.groups[0].results[0].match!;
  assert.equal(evidence.originalText, "The ＲＯＢＯＴ arm lifts boxes.");
  assert.equal(evidence.originalText.slice(ranges![0].start, ranges![0].end), "ＲＯＢＯＴ");
});

test("an exact full title or name has priority over a higher weighted score, in keyword and hybrid", async () => {
  const exact = doc({ typedId: "robot:exact", kind: "robot", title: "Dinsaw Robot", vectorRow: 0 });
  const richer = doc({ typedId: "robot:richer", kind: "robot", title: "Dinsaw Robot guide", vectorRow: 1 }, "Dinsaw Robot manual with Dinsaw Robot details");
  const thaiExact = doc({ typedId: "robot:th", kind: "robot", title: "หุ่นยนต์ทดลอง", vectorRow: 2 });
  const thaiRicher = doc({ typedId: "robot:thr", kind: "robot", title: "หุ่นยนต์ทดลอง รุ่นใหม่", vectorRow: 3 }, "หุ่นยนต์ทดลอง");
  const rankKw = rankKeyword(prepareQuery("Dinsaw Robot"), [richer, exact].map((d) => ({ id: d.typedId, title: d.title, texts: d.evidence.map((e) => e.originalText) })));
  assert.ok(rankKw[0].id === "robot:exact" && rankKw[1].score > rankKw[0].score, "exact title wins although another score is higher");
  for (const [query, first, second] of [["Dinsaw Robot", exact, richer], ["หุ่นยนต์ทดลอง", thaiExact, thaiRicher]] as const) {
    assert.equal(ids(await search([second, first], { query }))[0], first.typedId);
    const hybrid = await search([second, first], { query }, { vectors: vectorsFor([0.9, 0.99, 0.9, 0.99]) }, { embedQuery: async () => queryVector });
    assert.equal(hybrid.mode, "hybrid");
    assert.equal(ids(hybrid)[0], first.typedId);
  }
});

test("blank, generic-only and negation-only requests give a labelled browse view with no match claim", async () => {
  const docs = [doc({ typedId: "source:1", kind: "source", title: "Robot research" }), doc({ typedId: "robot:2", kind: "robot", title: "หุ่นยนต์" })];
  for (const query of ["", "   ", "the of and", "ที่ และ ของ", "without", "!!!"]) {
    const data = await search(docs, { query });
    assert.equal(data.view, "browse", query);
    assert.equal(data.mode, "keyword");
    assert.deepEqual(ids(data), ["source:1", "robot:2"]);
    assert.ok(data.groups.every((group) => group.results.every((result) => !("match" in result))));
  }
  assert.equal((await search(docs, { query: "the robot" })).view, "results");
});

test("selected types apply before the candidate cap, so unselected records cannot crowd them out", async () => {
  const policy = { ...FROZEN_SEMANTIC_POLICY, limits: { ...FROZEN_SEMANTIC_POLICY.limits, candidatesPerBranch: 2 } };
  const robots = [0, 1, 2].map((i) => doc({ typedId: `robot:${i}`, kind: "robot", title: `Robot ${i}`, vectorRow: i }));
  const wanted = doc({ typedId: "source:wanted", kind: "source", title: "Unrelated words", vectorRow: 3 });
  const extra = { vectors: vectorsFor([0.99, 0.98, 0.97, 0.7]) };
  const options = { embedQuery: async () => queryVector, policy };
  const filtered = await search([...robots, wanted], { query: "robot", types: ["source"] }, extra, options);
  assert.deepEqual(ids(filtered), ["source:wanted"]);
  assert.deepEqual(filtered.groups[0].results[0].match!.methods, ["semantic"]);
  assert.equal(filtered.mode, "hybrid");
  const keywordOnly = await search([...robots, wanted], { query: "robot", types: ["source"] });
  assert.deepEqual(ids(keywordOnly), []);
});

test("duplicates share one canonical group and the group ranks by its best member, not by member count", async () => {
  const U = "https://example.org/dup";
  const dups = [1, 2, 3].map((i) => doc({ typedId: `source:d${i}`, kind: "source", title: "Humanoid overview", url: U, groupId: U }));
  const single = doc({ typedId: "source:single", kind: "source", title: "Humanoid hands design", url: "https://example.org/single", groupId: "https://example.org/single" });
  const data = await search([...dups, single], { query: "humanoid hands" });
  assert.deepEqual(data.groups.map((group) => group.groupKey), ["https://example.org/single", U]);
  assert.equal(data.groups[1].results.length, 3);
});

test("null-URL records stay typed singletons and robots do not merge through a manufacturer link", async () => {
  const twins = [doc({ typedId: "source:n1", kind: "source", title: "Same title" }), doc({ typedId: "source:n2", kind: "source", title: "Same title" }), doc({ typedId: "robot:n3", kind: "robot", title: "Same title" })];
  assert.deepEqual((await search(twins, { query: "same title" })).groups.map((group) => group.groupKey), ["source:n1", "source:n2", "robot:n3"]);
  const M = "https://example.org/maker";
  const robot = doc({ typedId: "robot:r", kind: "robot", title: "Maker robot", url: M, groupId: M });
  const article = doc({ typedId: "source:a", kind: "source", title: "Maker robot news", url: M, groupId: M });
  const data = await search([robot, article], { query: "maker robot" });
  assert.deepEqual(data.groups.map((group) => group.groupKey).sort(), ["robot:r", M].sort());
});

test("only surviving selected-type members qualify, score and supply evidence for a group", async () => {
  const U = "https://example.org/paper";
  const source = doc({ typedId: "source:s", kind: "source", title: "Quadruped gait study", url: U, groupId: U }, "Quadruped gait with secretsource marker");
  const linked = doc({ typedId: "perspective:p", kind: "perspective", title: "safety: gait", url: U, groupId: U, parentTypedId: "source:s" }, "A quote about gait.");
  const standalone = doc({ typedId: "perspective:q", kind: "perspective", title: "Quadruped gait notes", url: "https://example.org/q", groupId: "https://example.org/q" });
  const all = [source, linked, standalone];
  const unfiltered = await search(all, { query: "quadruped gait" });
  assert.equal(unfiltered.groups[0].groupKey, U);
  const data = await search(all, { query: "quadruped gait", types: ["perspective"] });
  assert.deepEqual(ids(data), ["perspective:q", "perspective:p"]);
  assert.deepEqual(data.groups.map((group) => group.groupKey), ["https://example.org/q", U]);
  assert.deepEqual(data.groups[1].results.map((result) => result.reference.id), ["perspective:p"]);
  assert.doesNotMatch(JSON.stringify(data), /secretsource|Quadruped gait study/);
  assert.deepEqual(ids(await search(all, { query: "secretsource", types: ["perspective"] })), []);
});

test("unrelated, partial and negated requests rank by relatedness and claim nothing more", async () => {
  const camera = doc({ typedId: "robot:cam", kind: "robot", title: "Humanoid with cameras" }, "Stereo cameras give optical vision.");
  const blind = doc({ typedId: "robot:blind", kind: "robot", title: "Humanoid walker" }, "Walks using touch only.");
  const th = doc({ typedId: "robot:th", kind: "robot", title: "หุ่นยนต์ฮิวแมนนอยด์" }, "ติดตั้งกล้องสำหรับมองเห็น");
  const docs = [camera, blind, th];
  const partial = await search(docs, { query: "humanoid robot in Thailand" });
  assert.deepEqual(ids(partial).sort(), ["robot:blind", "robot:cam"]);
  assert.deepEqual(ids(await search(docs, { query: "quantum cryptography" })), []);
  assert.deepEqual(ids(await search(docs, { query: "ควอนตัม" })), []);
  for (const query of ["humanoid robots without cameras", "หุ่นยนต์ฮิวแมนนอยด์ที่ไม่ติดตั้งกล้อง"]) {
    const data = await search(docs, { query });
    assert.ok(ids(data).includes(query.startsWith("humanoid") ? "robot:cam" : "robot:th"), "a related record is still returned; negation is not Boolean exclusion");
    assert.doesNotMatch(JSON.stringify(data), /suitab|satisf|score|similarity|rrf|vector|negat/i);
  }
  const onlyNegation = doc({ typedId: "source:w", kind: "source", title: "Report" }, "Works without supervision.");
  assert.deepEqual(ids(await search([onlyNegation], { query: "robots without cameras" })), []);
  const prepared = prepareQuery("Humanoid robots WITHOUT cameras");
  assert.equal(prepared.hasNegation, true);
  assert.equal(prepared.embeddingText, "humanoid robots without cameras");
  assert.ok(!prepared.tokens.includes("without"));
  let embedded = "";
  await search(docs, { query: "humanoid robots without cameras" }, { vectors: vectorsFor([]) }, { embedQuery: async (text) => { embedded = text; return queryVector; } });
  assert.equal(embedded, "humanoid robots without cameras");
});

test("thai and english exact titles on the checked-in corpus", async () => {
  const corpus = (await import("../data/search/documents.json", { with: { type: "json" } })).default as SearchDocument[];
  const first = async (query: string) => (await search(corpus, { query, limit: 5 })).groups[0]?.results[0]?.reference.id;
  assert.equal(await first("Dinsaw Robot"), "robot:seed-1");
  const thaiTitle = corpus.find((d) => /^[\u0E00-\u0E7F ]{6,40}$/.test(d.title))!;
  assert.ok(thaiTitle, "the corpus has a short Thai title");
  const thaiHit = await search(corpus, { query: thaiTitle.title, limit: 5 });
  assert.ok(thaiHit.groups[0].results.some((r) => r.reference.id === thaiTitle.typedId));
  const partialThai = await search(corpus, { query: "หุ่นยนต์ดูแลผู้สูงอายุที่บ้าน", limit: 5 });
  assert.ok(partialThai.groups.length > 0, "a partial Thai request still returns related records");
  assert.equal((await search(corpus, { query: "zzqxzzqx" })).groups.length, 0);
});

test("cosine retrieval is a pure function of supplied vectors and is unavailable without compatible ones", () => {
  const candidates = [{ id: "high", vector: mix(0.9) }, { id: "low", vector: mix(0.5) }, { id: "edge", vector: mix(0.62 + 1e-4) }, { id: "none", vector: null }, { id: "short", vector: new Float32Array(8) }];
  const ranked = semanticRank({ queryVector, candidates, profile: DEFAULT_MODEL_PROFILE });
  assert.deepEqual(ranked.status === "available" && ranked.ranked, ["high", "edge"]);
  assert.equal(FROZEN_SEMANTIC_POLICY.calibrationStatus, "provisional_uncalibrated");
  assert.equal(semanticRank({ queryVector, candidates: [{ id: "none", vector: null }, { id: "short", vector: new Float32Array(8) }], profile: DEFAULT_MODEL_PROFILE }).status, "unavailable");
  assert.equal(semanticRank({ queryVector, candidates, profile: MOCK_MODEL_PROFILE }).status, "unavailable");
  assert.equal(semanticRank({ queryVector, candidates, profile: null }).status, "unavailable");
  assert.equal(semanticRank({ queryVector: new Float32Array(8), candidates, profile: DEFAULT_MODEL_PROFILE }).status, "unavailable");
  assert.equal(semanticRank({ queryVector: null, candidates, profile: DEFAULT_MODEL_PROFILE }).status, "unavailable");
  const available = semanticRank({ queryVector, candidates: [{ id: "low", vector: mix(0.5) }], profile: DEFAULT_MODEL_PROFILE });
  assert.deepEqual(available, { status: "available", ranked: [], compatibleCount: 1 });
});

test("hybrid ranking is reciprocal rank fusion of keyword and semantic ranks with k=60", () => {
  const hit = (id: string) => ({ id, exactTitle: false, evidenceIndex: 0, ranges: [], score: 1 });
  assert.deepEqual(fuseRankings([hit("a"), hit("b"), hit("c")], ["c", "a"]), ["a", "c", "b"]);
  assert.deepEqual(fuseRankings([hit("a"), hit("b")], ["z", "b"]), ["b", "a", "z"]);
  assert.deepEqual(fuseRankings([hit("a"), hit("b")], []), ["a", "b"]);
  const capped = { ...FROZEN_SEMANTIC_POLICY, limits: { ...FROZEN_SEMANTIC_POLICY.limits, candidatesPerBranch: 1 } };
  // Only the top candidate of each branch is fused (a and b tie at 1/61); b is kept after the cap as a keyword remainder.
  assert.deepEqual(fuseRankings([hit("a"), hit("b")], ["b", "a"], capped), ["a", "b"]);
  assert.deepEqual(fuseRankings([hit("a"), hit("b")], ["b"], capped), ["a", "b"]);
});

test("hybrid API responses expose methods and evidence but never scores, and degrade honestly", async () => {
  const kw = doc({ typedId: "robot:kw", kind: "robot", title: "Walker robot", vectorRow: 0 });
  const sem = doc({ typedId: "robot:sem", kind: "robot", title: "Unrelated name", vectorRow: 1 }, "Biped locomotion notes.");
  const noVec = doc({ typedId: "robot:nv", kind: "robot", title: "Walker rover" });
  const run = (extra: Partial<SearchFixtureIndex>, embedQuery?: () => Promise<Float32Array | null>) => search([kw, sem, noVec], { query: "walker" }, extra, { embedQuery });
  const hybrid = await run({ vectors: vectorsFor([0.95, 0.9]) }, async () => queryVector);
  assert.equal(hybrid.mode, "hybrid");
  assert.deepEqual(hybrid.warnings, ["partial_vector_coverage"]);
  const byId = Object.fromEntries(hybrid.groups.flatMap((group) => group.results).map((result) => [result.reference.id, result.match!]));
  assert.deepEqual(byId["robot:kw"].methods, ["keyword", "semantic"]);
  assert.deepEqual(byId["robot:sem"].methods, ["semantic"]);
  assert.equal(byId["robot:sem"].ranges, undefined);
  assert.equal(byId["robot:sem"].evidence.originalText, "Biped locomotion notes.");
  assert.deepEqual(byId["robot:nv"].methods, ["keyword"]);
  const keysOf = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(keysOf) : value && typeof value === "object" ? Object.entries(value).flatMap(([key, child]) => [key, ...keysOf(child)]) : [];
  const responseKeys = keysOf(JSON.parse(JSON.stringify(hybrid)));
  assert.ok(responseKeys.includes("methods") && responseKeys.includes("evidence"), "the walk reaches the nested match objects");
  assert.deepEqual(responseKeys.filter((key) => /score|similarity|rrf|vector|vectors|embedding/i.test(key)), []);
  let calls = 0;
  const mockProfile = await run({ vectors: { ...vectorsFor([0.9]), profile: MOCK_MODEL_PROFILE } }, async () => { calls++; return queryVector; });
  assert.deepEqual([mockProfile.mode, mockProfile.warnings, calls], ["keyword", ["degraded_semantic"], 0]);
  const failing = await run({ vectors: vectorsFor([0.9]) }, async () => { throw new Error("provider down"); });
  assert.deepEqual([failing.mode, failing.warnings], ["keyword", ["degraded_semantic"]]);
  assert.doesNotMatch(JSON.stringify(failing), /provider down/);
  const plain = await run({}, async () => queryVector);
  assert.deepEqual([plain.mode, plain.warnings], ["keyword", []]);
});

test("a request typed with decomposed Thai sara am still matches composed text and ranges point into the original", async () => {
  const composed = "ระบบสำหรับดำน้ำ";
  const decomposed = composed.normalize("NFKD");
  assert.notEqual(decomposed, composed);
  for (const [text, query] of [[composed, decomposed], [decomposed, composed]]) {
    const data = await search([doc({ typedId: "robot:am", kind: "robot", title: "x" }, text)], { query: "สำหรับ".normalize(query === decomposed ? "NFKD" : "NFC") });
    assert.deepEqual(ids(data), ["robot:am"]);
    const { ranges, evidence } = data.groups[0].results[0].match!;
    assert.equal(evidence.originalText, text);
    assert.equal(evidence.originalText.slice(ranges![0].start, ranges![0].end).normalize("NFKC"), "สำหรับ".normalize("NFKC"));
  }
  assert.equal(prepareQuery(decomposed).embeddingText, composed);
});

test("negation contractions and Thai ไร้ are preserved as negation, not required words", () => {
  for (const query of ["robots that don't use cameras", "หุ่นยนต์ไร้กล้อง"]) {
    const prepared = prepareQuery(query);
    assert.equal(prepared.hasNegation, true, query);
    assert.ok(prepared.embeddingText.includes(query.includes("don't") ? "don't" : "ไร้"));
  }
  assert.ok(!prepareQuery("robots don't use cameras").tokens.includes("don't"));
});

test("a record that fails the survival check never qualifies, scores or supplies group evidence", async () => {
  const U = "https://example.org/paper";
  const source = doc({ typedId: "source:gone", kind: "source", title: "Biped gait", url: U, groupId: U }, "withdrawnmarker");
  const linked = doc({ typedId: "perspective:kept", kind: "perspective", title: "gait: notes", url: U, groupId: U, parentTypedId: "source:gone" }, "Biped notes.");
  const other = doc({ typedId: "source:other", kind: "source", title: "Biped lab" });
  const options = { isEligible: (d: SearchDocument) => d.typedId !== "source:gone" };
  const data = await search([source, linked, other], { query: "biped gait" }, {}, options);
  assert.deepEqual(ids(data).sort(), ["perspective:kept", "source:other"]);
  assert.doesNotMatch(JSON.stringify(data), /withdrawnmarker|Biped gait/);
  assert.deepEqual(ids(await search([source, linked], { query: "withdrawnmarker" }, {}, options)), []);
  assert.equal((await search([source], { query: "" }, {}, options)).groups.length, 0);
});

test("URLs that differ only by trailing slash, fragment or tracking parameters share one canonical group", async () => {
  const a = doc({ typedId: "source:u1", kind: "source", title: "Shared paper", url: "https://Example.org/paper/", groupId: "https://Example.org/paper/" });
  const b = doc({ typedId: "source:u2", kind: "source", title: "Shared paper copy", url: "https://example.org/paper?utm_source=rss#x", groupId: "https://example.org/paper?utm_source=rss#x" });
  const data = await search([a, b], { query: "shared paper" });
  assert.equal(data.groups.length, 1);
  assert.equal(data.groups[0].results.length, 2);
});

test("an empty selected kind makes no embedding call and reports no degraded semantic", async () => {
  let calls = 0;
  const data = await search([doc({ typedId: "robot:1", kind: "robot", title: "Walker", vectorRow: 0 })], { query: "walker", types: ["inventory"] }, { vectors: vectorsFor([0.9]) }, { embedQuery: async () => { calls++; return queryVector; } });
  assert.deepEqual([data.groups.length, data.warnings, calls], [0, [], 0]);
});

test("a semantic group-mate beyond the candidate cap stays with its admitted group", async () => {
  const policy = { ...FROZEN_SEMANTIC_POLICY, limits: { ...FROZEN_SEMANTIC_POLICY.limits, candidatesPerBranch: 1 } };
  const U = "https://example.org/g";
  const head = doc({ typedId: "source:head", kind: "source", title: "Head", url: U, groupId: U, vectorRow: 0 });
  const mate = doc({ typedId: "perspective:mate", kind: "perspective", title: "Mate", url: U, groupId: U, parentTypedId: "source:head", vectorRow: 1 });
  const data = await search([head, mate], { query: "zzz" }, { vectors: vectorsFor([0.99, 0.8]) }, { embedQuery: async () => queryVector, policy, });
  assert.deepEqual(data.groups.map((g) => g.results.length), [2]);
});

test("policy lexical weights are honoured by the API", async () => {
  const titleHit = doc({ typedId: "robot:t", kind: "robot", title: "Gripper unit" });
  const bodyHit = doc({ typedId: "robot:b", kind: "robot", title: "Arm" }, "Gripper details");
  assert.equal(ids(await search([bodyHit, titleHit], { query: "gripper" }))[0], "robot:t");
  const bodyHeavy = { ...FROZEN_SEMANTIC_POLICY, lexicalWeights: { title: 1, body: 4 } };
  assert.equal(ids(await search([titleHit, bodyHit], { query: "gripper" }, {}, { policy: bodyHeavy }))[0], "robot:b");
});

test("keywordMatch only qualifies a record through text it can show", () => {
  const query = prepareQuery("hands");
  assert.equal(keywordMatch(query, { id: "x", title: "Arm", texts: ["Arm"] }), null);
  assert.equal(keywordMatch(prepareQuery("the"), { id: "x", title: "the", texts: ["the"] }), null);
});

const hitOf = (id: string) => ({ id, exactTitle: false, evidenceIndex: 0, ranges: [], score: 1 });
const withLimits = (candidatesPerBranch: number, rrfConstantK = FROZEN_SEMANTIC_POLICY.rrfConstantK) => ({ ...FROZEN_SEMANTIC_POLICY, rrfConstantK, limits: { ...FROZEN_SEMANTIC_POLICY.limits, candidatesPerBranch } });

test("a record beyond both branch caps is returned once", () => {
  const fused = fuseRankings([hitOf("a"), hitOf("x")], ["b", "x"], withLimits(1));
  assert.deepEqual(fused, ["a", "b", "x"]);
});

test("duplicate copies of one identity do not change the group order or fused outcome of any group", async () => {
  const groupOf = (id: string) => id.replace(/\d+$/, "");
  const groupsOf = (list: string[]) => Array.from(new Set(list.map(groupOf)));
  const firstOf = (list: string[]) => groupsOf(list).map((group) => list.find((id) => groupOf(id) === group));
  for (const policy of [withLimits(2), FROZEN_SEMANTIC_POLICY]) {
    const plain = fuseRankings(["a", "b", "c"].map(hitOf), ["c", "b"], policy, groupOf);
    const duplicated = fuseRankings(["a", "a2", "a3", "b", "c", "c2"].map(hitOf), ["c", "c2", "b"], policy, groupOf);
    assert.deepEqual(groupsOf(duplicated), groupsOf(plain));
    assert.deepEqual(firstOf(duplicated), firstOf(plain));
    assert.equal(new Set(duplicated).size, duplicated.length, "each record once");
  }
  assert.deepEqual(groupsOf(fuseRankings(["a", "b", "c"].map(hitOf), ["c", "b"], withLimits(2), groupOf)), ["b", "a", "c"]);

  // Same property through the API: the extra copies join their group and nothing else moves.
  const url = (name: string) => `https://example.org/${name}`;
  const robot = (id: string, name: string, vectorRow: number | null) => doc({ typedId: `source:${id}`, kind: "source", title: `Robot ${id}`, url: url(name), groupId: url(name), vectorRow });
  const cosinesOf = (rows: number[]) => ({ profile: DEFAULT_MODEL_PROFILE, rows: new Map(rows.map((c, row) => [row, mix(c)])) });
  const options = { embedQuery: async () => queryVector, policy: withLimits(2) };
  const before = await search([robot("a", "a", null), robot("b", "b", 0), robot("c", "c", 1)], { query: "robot" }, { vectors: cosinesOf([0.9, 0.99]) }, options);
  const after = await search(
    [robot("a", "a", null), robot("a2", "a", null), robot("a3", "a", null), robot("b", "b", 0), robot("c", "c", 1), robot("c2", "c", 2)],
    { query: "robot" }, { vectors: cosinesOf([0.9, 0.99, 0.985]) }, options);
  assert.equal(before.mode, "hybrid");
  assert.equal(after.mode, "hybrid");
  assert.deepEqual(before.groups.map((group) => group.groupKey), [url("b"), url("a"), url("c")]);
  assert.deepEqual(after.groups.map((group) => group.groupKey), before.groups.map((group) => group.groupKey));
  assert.deepEqual(after.groups.map((group) => group.results[0].reference.id), before.groups.map((group) => group.results[0].reference.id));
  assert.deepEqual(after.groups.map((group) => group.results[0].match!.methods), before.groups.map((group) => group.results[0].match!.methods));
  assert.deepEqual(after.groups.map((group) => group.results.length), [1, 3, 2]);
  assert.equal(new Set(ids(after)).size, ids(after).length, "no member is returned twice");
});

test("a candidate is normalized inside the cosine: magnitude is ignored and a zero vector is skipped", () => {
  const scaled = (vector: Float32Array, factor: number) => vector.map((value) => value * factor);
  const candidates = [
    { id: "half", vector: scaled(mix(1), 0.5) },
    { id: "big", vector: scaled(mix(0.9), 7) },
    { id: "weak", vector: scaled(mix(0.5), 7) },
    { id: "zero", vector: new Float32Array(DIM) },
  ];
  assert.deepEqual(semanticRank({ queryVector, candidates, profile: DEFAULT_MODEL_PROFILE }), { status: "available", ranked: ["half", "big"], compatibleCount: 3 });
  assert.deepEqual(semanticRank({ queryVector: scaled(queryVector, 3), candidates: [candidates[0]], profile: DEFAULT_MODEL_PROFILE }), { status: "available", ranked: ["half"], compatibleCount: 1 });
  assert.equal(semanticRank({ queryVector, candidates: [candidates[3]], profile: DEFAULT_MODEL_PROFILE }).status, "unavailable");
});

test("the RRF constant is 60 and a different constant would flip the order", () => {
  assert.equal(FROZEN_SEMANTIC_POLICY.rrfConstantK, 60);
  // y is rank 5 in both branches, x is rank 1 in one: 2/(k+5) beats 1/(k+1) for k = 60 but not for k = 1.
  const keyword = ["x", "f1", "f2", "f3", "y"].map(hitOf);
  const semantic = ["g1", "g2", "g3", "g4", "y"];
  assert.equal(fuseRankings(keyword, semantic)[0], "y");
  assert.equal(fuseRankings(keyword, semantic, withLimits(50, 1))[0], "x");
});

test("selected-type filtering happens before the candidate cap and fusion", async () => {
  const wanted = (typedId: string, title: string, vectorRow: number, body = "") => doc({ typedId, kind: "source", title, vectorRow }, body);
  const crowder = doc({ typedId: "robot:crowd", kind: "robot", title: "Robot", vectorRow: 0 });
  const first = wanted("source:first", "Robot arm", 1);
  const second = wanted("source:second", "Other", 2, "robot parts");
  const extra = { vectors: vectorsFor([0.99, 0.3, 0.9]) };
  const options = { embedQuery: async () => queryVector, policy: withLimits(2) };
  const filtered = await search([crowder, first, second], { query: "robot", types: ["source"] }, extra, options);
  // With the robot filtered first: keyword [first, second], semantic [second]; second is in both branches and wins.
  // If the robot took a cap slot first, second would miss the keyword cap and follow first instead.
  assert.equal(filtered.mode, "hybrid");
  assert.deepEqual(ids(filtered), ["source:second", "source:first"]);
  assert.deepEqual(filtered.groups[0].results[0].match!.methods, ["keyword", "semantic"]);
});

test("evaluation groups URL variants with the same canonical key as the API", () => {
  const a = doc({ typedId: "source:e1", kind: "source", title: "Shared paper", url: "https://Example.org/paper/", groupId: "https://Example.org/paper/" });
  const b = doc({ typedId: "source:e2", kind: "source", title: "Shared paper copy", url: "https://example.org/paper?utm_source=rss", groupId: "https://example.org/paper?utm_source=rss" });
  const other = doc({ typedId: "source:e3", kind: "source", title: "Other paper", url: "https://example.org/other", groupId: "https://example.org/other" });
  const groups = groupCandidates([{ document: a, score: 1 }, { document: b, score: 2 }, { document: other, score: 0.5 }], []);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].members.map((member) => member.typedId), ["source:e1", "source:e2"]);
  assert.equal(groups[0].primaryDocument.typedId, "source:e2");
});
