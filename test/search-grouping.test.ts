import test from "node:test";
import assert from "node:assert/strict";
import { createSearchPost } from "../lib/search/api";
import type { SearchDocument } from "../lib/search/types";
import { documents } from "./fixtures/search/documents";

const base = documents[0];
const ev = (fieldName: string, originalText: string, label = fieldName) => ({ fieldName, originalText, label, coverage: "full" as const, startOffset: 0, endOffset: originalText.length });
function doc(over: Partial<SearchDocument> & Pick<SearchDocument, "typedId" | "kind" | "title">): SearchDocument {
  return { ...base, url: null, groupId: over.typedId, parentTypedId: null, metadata: {}, evidence: [ev("title", over.title, "Title")], ...over };
}
function search(docs: SearchDocument[], body: object) {
  const handler = createSearchPost(async () => ({ documents: docs, release: { id: "fixture", generatedAt: "2026-01-01" }, coverage: { indexed: docs.length, eligible: docs.length } }));
  return handler(new Request("http://localhost/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).then((res) => res.json());
}

const URL_A = "https://example.org/paper-a";
const source = doc({ typedId: "source:a", kind: "source", title: "Humanoid walking study", url: URL_A, groupId: URL_A, evidence: [ev("title", "Humanoid walking study", "Title"), ev("excerpt", "Walking gait of a humanoid.", "Excerpt")] });
const perspective = doc({ typedId: "perspective:a", kind: "perspective", title: "safety: humanoid", url: URL_A, groupId: URL_A, parentTypedId: "source:a", evidence: [ev("evidence_excerpt", "Humanoid gait raises safety concerns.", "Perspective Evidence")] });
const other = doc({ typedId: "source:b", kind: "source", title: "Humanoid hands", url: "https://example.org/b", groupId: "https://example.org/b" });

test("limit counts groups and a linked perspective keeps its evidence", async () => {
  for (const body of [{ query: "humanoid", limit: 1 }, { query: "", limit: 1 }]) {
    const data = await search([source, perspective, other], body);
    assert.equal(data.groups.length, 1);
    assert.equal(data.groups[0].groupKey, URL_A);
    assert.deepEqual(data.groups[0].results.map((r: { reference: { kind: string } }) => r.reference.kind), ["source", "perspective"]);
    assert.match(JSON.stringify(data.groups[0].results[1].evidence), /safety concerns/);
  }
  const both = await search([source, perspective, other], { query: "humanoid", limit: 2 });
  assert.equal(both.groups.length, 2);
  const filtered = await search([source, perspective, other], { query: "humanoid", types: ["perspective"], limit: 5 });
  assert.deepEqual(filtered.groups.map((g: { results: unknown[] }) => g.results.length), [1]);
});

test("a late member of an already-admitted group is kept after the limit is reached", async () => {
  const data = await search([source, other, perspective], { query: "humanoid", limit: 1 });
  assert.equal(data.groups.length, 1);
  assert.equal(data.groups[0].results.length, 2);
});

test("null-URL records stay typed singletons and similar titles never merge", async () => {
  const twins = [doc({ typedId: "source:n1", kind: "source", title: "Same title" }), doc({ typedId: "source:n2", kind: "source", title: "Same title" }), doc({ typedId: "robot:n3", kind: "robot", title: "Same title" })];
  const data = await search(twins, { query: "" });
  assert.deepEqual(data.groups.map((g: { groupKey: string; results: unknown[] }) => [g.groupKey, g.results.length]), [["source:n1", 1], ["source:n2", 1], ["robot:n3", 1]]);
  assert.equal((await search(twins, { query: "", limit: 2 })).groups.length, 2);
});

test("response keeps retrieval mode separate from the results or browse view", async () => {
  const query = await search([source], { query: "humanoid" });
  assert.equal(query.mode, "keyword");
  assert.equal(query.view, "results");
  const blank = await search([source], { query: "  " });
  assert.equal(blank.mode, "keyword");
  assert.equal(blank.view, "browse");
  assert.equal("match" in blank.groups[0].results[0], false);
});

test("results expose a public content type derived from document data", async () => {
  const src = (typedId: string, url: string | null, platform?: string) => doc({ typedId, kind: "source", title: "Item " + typedId, url, groupId: url ?? typedId, metadata: platform ? { platform } : {} });
  const docs = [
    src("source:p", "https://openalex.org/W1", "openalex"), src("source:g", "https://github.com/a/b", "github"), src("source:y", "https://youtu.be/x", "youtube"),
    src("source:n", "https://news.example/a", "gdelt"), src("source:doi", "https://doi.org/10.1/x"), src("source:gh", "https://www.github.com/a/c"),
    src("source:w", "https://lab.example/page"), src("source:u", null), doc({ typedId: "robot:r", kind: "robot", title: "Item r" }),
    doc({ typedId: "relationship:x", kind: "relationship", title: "Item x" }),
  ];
  const data = await search(docs, { query: "", limit: 20 });
  const types = Object.fromEntries(data.groups.flatMap((g: { results: { reference: { id: string }; contentType: string }[] }) => g.results).map((r: { reference: { id: string }; contentType: string }) => [r.reference.id, r.contentType]));
  assert.deepEqual(types, { "source:p": "paper", "source:g": "repository", "source:y": "video", "source:n": "news_web", "source:doi": "paper", "source:gh": "repository", "source:w": "news_web", "source:u": "source", "robot:r": "robot", "relationship:x": "relationship" });
});

test("a stored source title keeps original provenance instead of Constructed title", async () => {
  const hit = (await search([source], { query: "walking study" })).groups[0].results[0];
  assert.equal(hit.match.evidence.fieldName, "title");
  assert.equal(hit.match.evidence.label, "Title");
  assert.equal(hit.match.evidence.evidenceKind, "source");
  const excerptOnly = doc({ typedId: "source:e", kind: "source", title: "Only stored title", evidence: [ev("excerpt", "unrelated text", "Excerpt")] });
  const titleHit = (await search([excerptOnly], { query: "stored title" })).groups[0].results[0];
  assert.deepEqual([titleHit.match.evidence.label, titleHit.match.evidence.evidenceKind], ["Title", "source"]);
});

test("provenance follows the underlying field, not text equality with the title", async () => {
  const title = "safety: humanoid";
  const genuine = doc({ typedId: "perspective:g", kind: "perspective", title, evidence: [ev("evidence_excerpt", title, "Perspective Evidence")] });
  const generated = doc({ typedId: "perspective:c", kind: "perspective", title, evidence: [ev("perspective_theme", title, "Perspective Theme")] });
  const unmatched = doc({ typedId: "perspective:u", kind: "perspective", title, evidence: [ev("evidence_excerpt", "a real quote", "Perspective Evidence")] });
  const [g, c, u] = (await search([genuine, generated, unmatched], { query: "safety" })).groups.map((x: { results: { evidence: { evidenceKind: string }[]; match: { evidence: { evidenceKind: string; label: string } } }[] }) => x.results[0]);
  assert.equal(g.evidence[0].evidenceKind, "source");
  assert.equal(g.match.evidence.evidenceKind, "source");
  assert.equal(c.evidence[0].evidenceKind, "derived");
  assert.equal(c.match.evidence.evidenceKind, "derived");
  assert.equal(u.match.evidence.label, "Constructed title");
  assert.equal(u.match.evidence.evidenceKind, "derived");
});
