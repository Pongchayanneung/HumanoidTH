import test from "node:test";
import assert from "node:assert/strict";
import type { SearchRequest, SearchReference, SearchCoverage, SearchModelProfile, SearchRankingPolicy, SearchPublicationPolicy, SearchRelease, SearchResultEvidence, SearchBrowseResult, SearchMatchedResult, SearchMatch, SearchResponse, SearchError, SearchContentType, SearchResultGroup } from "../lib/search/types";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type ContractChecks = [
  Assert<Equal<SearchRequest, { query: string; types?: SearchReference["kind"][]; limit?: number }>>,
  Assert<Equal<SearchReference, { kind: "source" | "robot" | "contribution" | "perspective" | "inventory" | "relationship" | "entity"; id: string }>>,
  Assert<Equal<SearchCoverage, { indexed: number; eligible: number }>>,
  Assert<Equal<{ [K in keyof SearchResultEvidence]: SearchResultEvidence[K] }, { fieldName: string; originalText: string; label: string; coverage: "full" | "partial" | "title-only"; startOffset: number; endOffset: number; evidenceKind: "source" | "derived" }>>,
  Assert<Equal<SearchModelProfile, { id: string; revision: string; runtime: string; dimensions: number; pooling: string; precision: string; normalization: string; preprocessing: string }>>,
  Assert<Equal<SearchRankingPolicy, { mode: "keyword" | "hybrid"; semanticCutoff: number | null; modelProfileId: string | null }>>,
  Assert<Equal<SearchPublicationPolicy, { permittedOrigins: string[]; publicFieldsByKind: Record<SearchReference["kind"], string[]>; excludedFields: string[]; excludedReferences: SearchReference[]; exceptions: string[] }>>,
  Assert<Equal<SearchRelease, { id: string; generatedAt: string; coverage: SearchCoverage; model: SearchModelProfile | null; publication: SearchPublicationPolicy; ranking: SearchRankingPolicy }>>,
  Assert<Equal<SearchError, { error: { code: "invalid_request"; message: string } }>>,
  Assert<Equal<keyof SearchBrowseResult, "reference" | "contentType" | "language" | "title" | "url" | "evidence" | "match">>,
  Assert<Equal<Pick<SearchBrowseResult, "reference" | "contentType" | "title" | "url" | "evidence">, { reference: SearchReference; contentType: SearchContentType; title: string; url: string | null; evidence: SearchResultEvidence[] }>>,
  Assert<Equal<SearchContentType, "paper" | "repository" | "video" | "news_web" | "source" | "robot" | "contribution" | "perspective" | "inventory" | "relationship" | "entity">>,
  Assert<Equal<keyof SearchResultGroup, "groupKey" | "results">>,
  Assert<Equal<SearchMatchedResult["match"], SearchMatch>>,
  Assert<Equal<keyof SearchResponse, "release" | "coverage" | "warnings" | "mode" | "view" | "groups">>,
  Assert<Equal<SearchResponse["release"], { id: string; generatedAt: string } | null>>,
  Assert<Equal<SearchResponse["coverage"], SearchCoverage>>,
  Assert<Equal<SearchResponse["warnings"], ("degraded_semantic" | "partial_vector_coverage" | "stale_index" | "unavailable")[]>>,
  Assert<Equal<SearchResponse["mode"], "keyword" | "hybrid" | "unavailable">>,
  Assert<Equal<SearchResponse["view"], "results" | "browse">>,
  Assert<Equal<keyof SearchMatch, "evidence" | "methods" | "ranges">>,
  Assert<Equal<SearchMatch["methods"], ["semantic"] | ["keyword"] | ["keyword", "semantic"] | ["semantic", "keyword"]>>,
  Assert<Equal<SearchMatch["ranges"], { start: number; end: number }[] | undefined>>
];
const evidence: SearchResultEvidence = { fieldName: "title", originalText: "Robot", label: "Constructed title", evidenceKind: "derived", coverage: "full", startOffset: 0, endOffset: 5 };
const semantic: SearchMatch = { methods: ["semantic"], evidence };
const keyword: SearchMatch = { methods: ["keyword"], evidence, ranges: [{ start: 0, end: 5 }] };
const hybrid: SearchMatch = { methods: ["keyword", "semantic"], evidence, ranges: [{ start: 0, end: 5 }] };
const result = { reference: { kind: "robot" as const, id: "robot:fake" }, contentType: "robot" as const, title: "Robot", url: null, evidence: [evidence] };
const common = { release: null, coverage: { indexed: 0, eligible: 1 }, warnings: [] };
const browse: SearchResponse = { ...common, mode: "keyword", view: "browse", groups: [{ groupKey: "robot:fake", results: [result] }] };
const semanticResponse: SearchResponse = { ...common, mode: "hybrid", view: "results", groups: [{ groupKey: "robot:fake", results: [{ ...result, match: semantic }] }] };

// These assertions are checked by tsc; tsx alone does not check types.
// @ts-expect-error A match must name at least one method.
const emptyMethods: SearchMatch = { methods: [], evidence };
// @ts-expect-error Semantic-only evidence cannot claim literal ranges.
const semanticRanges: SearchMatch = { methods: ["semantic"], evidence, ranges: [{ start: 0, end: 5 }] };
// @ts-expect-error Browse results cannot claim a match.
const browseMatch: SearchResponse = { ...common, mode: "keyword", view: "browse", groups: [{ groupKey: "robot:fake", results: [{ ...result, match: keyword }] }] };
// @ts-expect-error Browse is a view, not a retrieval mode.
const browseMode: SearchResponse = { ...common, mode: "browse", view: "browse", groups: [] };
// @ts-expect-error Search results must carry match metadata.
const missingMatch: SearchResponse = { ...common, mode: "hybrid", view: "results", groups: [{ groupKey: "robot:fake", results: [result] }] };
// @ts-expect-error A result must carry a content label.
const missingContentType: SearchResponse = { ...common, mode: "keyword", view: "browse", groups: [{ groupKey: "robot:fake", results: [{ reference: result.reference, title: "Robot", url: null, evidence: [evidence] }] }] };

test("declared response examples distinguish browse and search matches", () => {
  assert.deepEqual(browse, { release: null, coverage: { indexed: 0, eligible: 1 }, warnings: [], mode: "keyword", view: "browse", groups: [{ groupKey: "robot:fake", results: [{ reference: { kind: "robot", id: "robot:fake" }, contentType: "robot", title: "Robot", url: null, evidence: [{ fieldName: "title", originalText: "Robot", label: "Constructed title", evidenceKind: "derived", coverage: "full", startOffset: 0, endOffset: 5 }] }] }] });
  assert.deepEqual(semanticResponse, { ...common, mode: "hybrid", view: "results", groups: [{ groupKey: "robot:fake", results: [{ ...result, match: { methods: ["semantic"], evidence } }] }] });
  assert.deepEqual(hybrid.methods, ["keyword", "semantic"]);
  void [emptyMethods, semanticRanges, browseMatch, browseMode, missingMatch, missingContentType];
  const checks: ContractChecks = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true];
  assert.ok(checks.every(Boolean));
});
