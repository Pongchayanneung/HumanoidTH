export type SearchRecordKind =
  | "source"
  | "robot"
  | "contribution"
  | "perspective"
  | "inventory"
  | "relationship"
  | "entity";

export type LanguageTag = "th" | "en" | "mixed" | "unknown";

export interface SearchEvidence {
  fieldName: string;
  originalText: string;
  label: string;
  coverage: "full" | "partial" | "title-only";
  startOffset: number; // UTF-16 offset into original field
  endOffset: number;   // UTF-16 offset into original field
}

export interface SearchDocument {
  typedId: string;
  kind: SearchRecordKind;
  title: string;
  body: string;
  retrievalText: string;
  url: string | null;
  groupId: string;
  origin: string;
  language: LanguageTag;
  isTitleOnly: boolean;
  isPartial: boolean;
  parentTypedId: string | null;
  contentHash: string;
  dependencyHash: string;
  vectorRow: number | null;
  evidence: SearchEvidence[];
  metadata: Record<string, unknown>;
}

export interface SearchExportManifest {
  manifestVersion: string;
  datasetId: string;
  releaseId: string;
  generatedAt: string;
  counts: {
    totalEligible: number;
    byKind: Record<SearchRecordKind, number>;
    byLanguage: Record<LanguageTag, number>;
    excluded: number;
    emptyKinds: SearchRecordKind[];
  };
  policy: {
    permittedOrigins: string[];
    maxBodyCodePoints: number;
    omittedPlaceholders: string[];
    publicFieldsByKind: Record<SearchRecordKind, string[]>;
    excludedFields: string[];
  };
  files: {
    documents: string;
    probeSample128: string;
    vectors?: string;
  };
  fileChecksums?: Record<string, { sha256: string; bytes: number }>;
  recordsSha256: string;
}

export interface DocumentFilterOptions {
  kind?: SearchRecordKind;
  language?: LanguageTag;
  origin?: string;
  query?: string;
}

export interface RevalidationResult {
  isValid: boolean;
  reason:
    | "DELETED"
    | "STATUS_INELIGIBLE"
    | "PARENT_INELIGIBLE"
    | "ROBOT_INELIGIBLE"
    | "CONTRIBUTION_INELIGIBLE"
    | "INVENTORY_HIDDEN"
    | "CONTENT_CHANGED"
    | "DEPENDENCY_CHANGED"
    | null;
  currentContentHash?: string;
  expectedContentHash?: string;
  currentDoc?: SearchDocument | null;
}

export const SEARCH_RECORD_KINDS = ["source", "robot", "contribution", "perspective", "inventory", "relationship", "entity"] as const satisfies readonly SearchRecordKind[];
export type SearchMode = "keyword" | "hybrid" | "unavailable";
export type SearchView = "results" | "browse";
export const SEARCH_SOURCE_SUBTYPES = ["paper", "repository", "video", "news_web", "source"] as const;
export type SearchSourceSubtype = typeof SEARCH_SOURCE_SUBTYPES[number];
export type SearchContentType = SearchSourceSubtype | Exclude<SearchRecordKind, "source">;
export type SearchWarning = "degraded_semantic" | "partial_vector_coverage" | "stale_index" | "unavailable";
export interface SearchReference { kind: SearchRecordKind; id: string }
export interface SearchRequest { query: string; types?: SearchRecordKind[]; subtype?: SearchSourceSubtype; limit?: number }
export interface SearchCoverage { indexed: number; eligible: number }
export interface SearchModelProfile {
  id: string; revision: string; runtime: string; dimensions: number;
  pooling: string; precision: string; normalization: string; preprocessing: string;
}
export interface SearchRankingPolicy {
  mode: "keyword" | "hybrid";
  semanticCutoff: number | null;
  modelProfileId: string | null;
}
export const INITIAL_SEARCH_RANKING_POLICY: SearchRankingPolicy = {
  mode: "keyword", semanticCutoff: null, modelProfileId: null,
};
export interface SearchPublicationPolicy {
  permittedOrigins: string[]; publicFieldsByKind: Record<SearchRecordKind, string[]>;
  excludedFields: string[]; excludedReferences: SearchReference[]; exceptions: string[];
}
export interface SearchRelease {
  id: string; generatedAt: string; coverage: SearchCoverage;
  model: SearchModelProfile | null; publication: SearchPublicationPolicy;
  ranking: SearchRankingPolicy;
}
export type SearchResultEvidence = SearchEvidence & { evidenceKind: "source" | "derived" };
export type SearchMatch = { evidence: SearchResultEvidence } & (
  | { methods: ["semantic"]; ranges?: never }
  | { methods: ["keyword"] | ["keyword", "semantic"] | ["semantic", "keyword"]; ranges?: { start: number; end: number }[] }
);
interface SearchResultFields {
  reference: SearchReference; contentType: SearchContentType; language?: LanguageTag; title: string; url: string | null; evidence: SearchResultEvidence[];
}
export type SearchBrowseResult = SearchResultFields & { match?: never };
export type SearchMatchedResult = SearchResultFields & { match: SearchMatch };
export type SearchResult = SearchBrowseResult | SearchMatchedResult;
/** One canonical source or parent association. Members are typed and may differ in kind; `groupKey` is the shared external identity or a singleton typed id. */
export interface SearchResultGroup<T extends SearchResult = SearchResult> { groupKey: string; results: T[] }
export type SearchResponse = {
  release: { id: string; generatedAt: string } | null;
  coverage: SearchCoverage; warnings: SearchWarning[];
} & (
  | { mode: "keyword" | "hybrid"; view: "browse"; groups: SearchResultGroup<SearchBrowseResult>[] }
  | { mode: "keyword" | "hybrid"; view: "results"; groups: SearchResultGroup<SearchMatchedResult>[] }
  | { mode: "unavailable"; view: SearchView; groups: SearchResultGroup<SearchBrowseResult>[] }
);
export interface SearchError { error: { code: "invalid_request"; message: string } }

export function validateSearchRequest(value: unknown): (SearchRequest & { limit: number }) | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["query", "types", "subtype", "limit"].includes(key))) return null;
  if (typeof input.query !== "string") return null;
  const query = input.query.trim();
  if (Array.from(query).length > 300) return null;
  if (input.types !== undefined && (!Array.isArray(input.types) ||
    !input.types.every((kind) => typeof kind === "string" && SEARCH_RECORD_KINDS.includes(kind as SearchRecordKind)))) return null;
  if (input.subtype !== undefined && (typeof input.subtype !== "string" || !SEARCH_SOURCE_SUBTYPES.includes(input.subtype as SearchSourceSubtype))) return null;
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || (input.limit as number) < 1)) return null;
  return {
    query,
    types: input.types as SearchRecordKind[] | undefined,
    ...(typeof input.subtype === "string" ? { subtype: input.subtype as SearchSourceSubtype } : {}),
    limit: Math.min((input.limit as number | undefined) ?? 10, 20),
  };
}
