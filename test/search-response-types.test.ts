import test from "node:test";
import assert from "node:assert/strict";
import type { SearchEvidence, SearchMatch, SearchResponse } from "../lib/search/types";

const evidence: SearchEvidence = { fieldName: "title", originalText: "Robot", label: "Title", coverage: "full", startOffset: 0, endOffset: 5 };
const semantic: SearchMatch = { methods: ["semantic"], evidence };
const keyword: SearchMatch = { methods: ["keyword"], evidence, ranges: [{ start: 0, end: 5 }] };
const hybrid: SearchMatch = { methods: ["keyword", "semantic"], evidence, ranges: [{ start: 0, end: 5 }] };
const result = { reference: { kind: "robot" as const, id: "robot:fake" }, title: "Robot", url: null, evidence: [evidence] };
const common = { release: null, coverage: { indexed: 0, eligible: 1 }, warnings: [] };
const browse: SearchResponse = { ...common, mode: "browse", groups: [{ kind: "robot", results: [result] }] };
const semanticResponse: SearchResponse = { ...common, mode: "hybrid", groups: [{ kind: "robot", results: [{ ...result, match: semantic }] }] };

// These assertions are checked by tsc; tsx alone does not check types.
// @ts-expect-error A match must name at least one method.
const emptyMethods: SearchMatch = { methods: [], evidence };
// @ts-expect-error Semantic-only evidence cannot claim literal ranges.
const semanticRanges: SearchMatch = { methods: ["semantic"], evidence, ranges: [{ start: 0, end: 5 }] };
// @ts-expect-error Browse results cannot claim a match.
const browseMatch: SearchResponse = { ...common, mode: "browse", groups: [{ kind: "robot", results: [{ ...result, match: keyword }] }] };
// @ts-expect-error Search results must carry match metadata.
const missingMatch: SearchResponse = { ...common, mode: "hybrid", groups: [{ kind: "robot", results: [result] }] };

test("declared response examples distinguish browse and search matches", () => {
  assert.equal(browse.mode, "browse");
  assert.deepEqual(semanticResponse.groups[0].results[0].match, semantic);
  assert.deepEqual(hybrid.methods, ["keyword", "semantic"]);
  void [emptyMethods, semanticRanges, browseMatch, missingMatch];
});
