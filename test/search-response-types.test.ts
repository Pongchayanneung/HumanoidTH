import test from "node:test";
import assert from "node:assert/strict";
import type { SearchRequest, SearchReference, SearchCoverage, SearchModelProfile, SearchRankingPolicy, SearchPublicationPolicy, SearchRelease, SearchResultEvidence, SearchBrowseResult, SearchMatchedResult, SearchMatch, SearchResponse, SearchError } from "../lib/search/types";

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
  Assert<Equal<keyof SearchBrowseResult, "reference" | "title" | "url" | "evidence" | "match">>,
  Assert<Equal<Pick<SearchBrowseResult, "reference" | "title" | "url" | "evidence">, { reference: SearchReference; title: string; url: string | null; evidence: SearchResultEvidence[] }>>,
  Assert<Equal<SearchMatchedResult["match"], SearchMatch>>,
  Assert<Equal<keyof SearchResponse, "release" | "coverage" | "warnings" | "mode" | "groups">>,
  Assert<Equal<SearchResponse["release"], { id: string; generatedAt: string } | null>>,
  Assert<Equal<SearchResponse["coverage"], SearchCoverage>>,
  Assert<Equal<SearchResponse["warnings"], ("degraded_semantic" | "partial_vector_coverage" | "stale_index" | "unavailable")[]>>,
  Assert<Equal<SearchResponse["mode"], "browse" | "keyword" | "hybrid" | "unavailable">>,
  Assert<Equal<keyof SearchMatch, "evidence" | "methods" | "ranges">>,
  Assert<Equal<SearchMatch["methods"], ["semantic"] | ["keyword"] | ["keyword", "semantic"] | ["semantic", "keyword"]>>,
  Assert<Equal<SearchMatch["ranges"], { start: number; end: number }[] | undefined>>
];
const evidence: SearchResultEvidence = { fieldName: "title", originalText: "Robot", label: "Constructed title", evidenceKind: "derived", coverage: "full", startOffset: 0, endOffset: 5 };
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
  assert.deepEqual(browse, { release: null, coverage: { indexed: 0, eligible: 1 }, warnings: [], mode: "browse", groups: [{ kind: "robot", results: [{ reference: { kind: "robot", id: "robot:fake" }, title: "Robot", url: null, evidence: [{ fieldName: "title", originalText: "Robot", label: "Constructed title", evidenceKind: "derived", coverage: "full", startOffset: 0, endOffset: 5 }] }] }] });
  assert.deepEqual(semanticResponse, { ...common, mode: "hybrid", groups: [{ kind: "robot", results: [{ ...result, match: { methods: ["semantic"], evidence } }] }] });
  assert.deepEqual(hybrid.methods, ["keyword", "semantic"]);
  void [emptyMethods, semanticRanges, browseMatch, missingMatch];
  const checks: ContractChecks = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true];
  assert.ok(checks.every(Boolean));
});
