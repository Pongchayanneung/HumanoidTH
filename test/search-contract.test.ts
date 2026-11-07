import test from "node:test";
import assert from "node:assert/strict";
import { createSearchPost } from "../lib/search/api";
import { INITIAL_SEARCH_RANKING_POLICY, validateSearchRequest } from "../lib/search/types";
import { GET, POST } from "../app/api/search/route";
import { documents } from "./fixtures/search/documents";

const post = createSearchPost(async () => ({ documents, release: { id: "fixture", generatedAt: "2026-01-01" }, coverage: { indexed: 0, eligible: 2 } }));
function request(body: string, contentType = "application/json") {
  return new Request("http://localhost/api/search", { method: "POST", headers: { "content-type": contentType }, body });
}
const send = (value: unknown) => post(request(JSON.stringify(value)));

test("request validation handles trimming, code points, filters and bounds", () => {
  assert.deepEqual(validateSearchRequest({ query: "  " }), { query: "", types: undefined, limit: 10 });
  assert.equal(validateSearchRequest({ query: "😀".repeat(300) })?.query.length, 600);
  assert.equal(validateSearchRequest({ query: "😀".repeat(301) }), null);
  for (const value of [{ query: "x", types: ["bad"] }, { query: "x", types: "source" }, { query: "x", limit: 0 }, { query: "x", limit: -1 }, { query: "x", limit: 1.5 }, { query: 1 }, { query: "x", extra: true }, { query: "x", contentType: "paper" }]) assert.equal(validateSearchRequest(value), null);
  assert.equal(validateSearchRequest({ query: "x", limit: 21 })?.limit, 20);
  assert.equal(validateSearchRequest({ query: " x ", types: ["source"], limit: 20 })?.query, "x");
  assert.deepEqual(INITIAL_SEARCH_RANKING_POLICY, { mode: "keyword", semanticCutoff: null, modelProfileId: null });
});

test("API enforces JSON and byte limit with typed errors", async () => {
  for (const req of [request("{}", "text/plain"), request("{"), ...[0, -1, 1.5].map(limit => request(JSON.stringify({ query: "x", limit }))), request(" ".repeat(8193)), request(JSON.stringify({ query: "😀".repeat(2100) }))]) {
    const res = await post(req);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: { code: "invalid_request", message: "Invalid search request." } });
  }
  const body = JSON.stringify({ query: "" });
  assert.equal((await post(request(body + " ".repeat(8192 - Buffer.byteLength(body))))).status, 200);
  const oversized = body + " ".repeat(8193 - Buffer.byteLength(body));
  assert.deepEqual(JSON.parse(oversized), { query: "" });
  assert.equal((await post(request(oversized))).status, 400);
});

test("API defaults and clamps the result limit", async () => {
  const many = createSearchPost(async () => ({ documents: Array.from({ length: 25 }, (_, i) => ({ ...documents[0], typedId: `source:${i}` })), release: { id: "fixture", generatedAt: "2026-01-01" }, coverage: { indexed: 25, eligible: 25 } }));
  for (const [limit, expected] of [[undefined, 10], [1, 1], [100, 20]] as const) {
    const res = await many(request(JSON.stringify({ query: "", limit })));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).groups.length, expected);
  }
});

test("source subtype is validated and filters before matching and the group limit", async () => {
  for (const subtype of [null, "robot", "PAPER", [], 1]) assert.equal(validateSearchRequest({ query: "", subtype }), null);
  for (const subtype of ["paper", "repository", "video", "news_web", "source"]) assert.equal(validateSearchRequest({ query: "", subtype })?.subtype, subtype);
  const source = documents[0];
  const records = Array.from({ length: 10 }, (_, i) => ({ ...source, typedId: `source:repo-${i}`, groupId: `repo-${i}`, url: `https://github.com/example/${i}` }));
  records.push({ ...source, typedId: "source:paper", groupId: "paper", url: "https://doi.org/10.1/example" });
  const handler = createSearchPost(async () => ({ documents: records, release: { id: "fixture", generatedAt: "2026-01-01" }, coverage: { indexed: 0, eligible: 11 } }));
  for (const query of ["", "robot"]) {
    const broad = await (await handler(request(JSON.stringify({ query, types: ["source"] })))).json();
    assert.equal(broad.groups.length, 10);
    assert.ok(broad.groups.every((group: { results: { contentType: string }[] }) => group.results[0].contentType === "repository"));
    const filtered = await (await handler(request(JSON.stringify({ query, types: ["source"], subtype: "paper" })))).json();
    assert.equal(filtered.groups.length, 1);
    assert.equal(filtered.groups[0].results[0].reference.id, "source:paper");
  }
  const intersection = await (await handler(request(JSON.stringify({ query: "", types: ["robot"], subtype: "paper" })))).json();
  assert.deepEqual(intersection.groups, []);
  assert.equal((await handler(request(JSON.stringify({ query: "", subtype: "invalid" })))).status, 400);
});

test("constructed titles are labelled derived in matches and result evidence", async () => {
  for (const [kind, fieldName] of [["perspective", "perspective_theme"], ["relationship", "relation"]] as const) {
    const title = "Constructed title";
    const doc = { ...documents[0], kind, title, evidence: [{ ...documents[0].evidence[0], fieldName, originalText: title }] };
    const handler = createSearchPost(async () => ({ documents: [doc], release: { id: "fixture", generatedAt: "2026-01-01" }, coverage: { indexed: 1, eligible: 1 } }));
    const result = (await (await handler(request(JSON.stringify({ query: "Constructed" })))).json()).groups[0].results[0];
    assert.equal(result.match.evidence.evidenceKind, "derived");
    assert.equal(result.evidence[0].evidenceKind, "derived");
  }
});

test("fixture search returns grouped original evidence and UTF-16 literal ranges", async () => {
  for (const query of ["researchers", "หุ่นยนต์", "ROBOT"]) {
    const res = await send({ query });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.mode, "keyword");
    assert.deepEqual(data.coverage, { indexed: 0, eligible: 2 });
    assert.ok(data.groups.length);
    const result = data.groups[0].results[0];
    assert.equal(data.groups[0].groupKey, result.reference.id);
    assert.equal(data.view, "results");
    const { evidence, ranges, methods } = result.match;
    assert.deepEqual(methods, ["keyword"]);
    assert.equal(evidence.evidenceKind, evidence.label === "Constructed title" ? "derived" : "source");
    assert.equal(evidence.originalText.slice(ranges[0].start, ranges[0].end).toLowerCase(), query.toLowerCase());
    assert.doesNotMatch(JSON.stringify(data), /vector|score|retrievalText|contentHash/i);
  }
  const titleOnlyIndex = createSearchPost(async () => ({ documents: [{ ...documents[0], evidence: documents[0].evidence.slice(1) }], release: { id: "fixture", generatedAt: "2026-01-01" }, coverage: { indexed: 0, eligible: 1 } }));
  const titleHit = await (await titleOnlyIndex(request(JSON.stringify({ query: "research" })))).json();
  assert.equal(titleHit.groups[0].results[0].match.evidence.originalText, "Robot research");
  const thai = await (await send({ query: "หุ่นยนต์", types: ["source"] })).json();
  assert.deepEqual(thai.groups, []);
  const limited = await (await send({ query: "", limit: 1 })).json();
  assert.equal(limited.mode, "keyword");
  assert.equal(limited.view, "browse");
  assert.equal(limited.groups[0].results.length, 1);
  assert.equal("match" in limited.groups[0].results[0], false);
});

test("missing or failed index is unavailable without leaking errors, GET is rejected", async () => {
  for (const handler of [createSearchPost(async () => { throw new Error("secret provider error"); })]) {
    const res = await handler(request('{"query":"test"}'));
    assert.equal(res.status, 503);
    const text = await res.text();
    assert.equal(JSON.parse(text).mode, "unavailable");
    assert.equal(JSON.parse(text).view, "results");
    assert.doesNotMatch(text, /secret|provider/);
  }
  assert.equal(GET().status, 405);
  assert.equal(GET().headers.get("allow"), "POST");
});

test('private fields never reach responses', async () => {
  const source = documents[0];
  const records = Array.from({length: 25}, (_, i) => ({...source, typedId:`source:repo-${i}`, groupId:`repo-${i}`, url:`https://github.com/example/repo-${i}`, metadata:{platform:'github', token:'secret-token', vector:[999], score:0.123}}));
  records.push({...source, typedId:'source:paper', groupId:'paper', url:'https://doi.org/10.1/example', metadata:{platform:'openalex', token:'secret-token', vector:[999], score:0.123}});
  const handler=createSearchPost(async()=>({documents:records, release:{id:'fixture',generatedAt:'2026-01-01'}, coverage:{indexed:0,eligible:26}}));
  for (const query of ['', 'robot']) {
    const response=await handler(request(JSON.stringify({query, types:['source'],limit:20})));
    const text=await response.text(); const data=JSON.parse(text);
    assert.equal(data.groups.length,20);
    assert.doesNotMatch(text,/secret-token|token|vector|score|999|0\.123/i);
    assert.equal(data.groups[0].results[0].language,'mixed');
  }
});
