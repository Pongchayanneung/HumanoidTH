import { canonicalizeUrl } from "../url";
import { validateSearchRequest } from "./types";
import type { SearchBrowseResult, SearchContentType, SearchDocument, SearchMatch, SearchResultEvidence, SearchMatchedResult, SearchResponse, SearchResult, SearchResultGroup, SearchWarning } from "./types";
import { fuseRankings, prepareQuery, rankKeyword, semanticRank } from "./ranking";
import { FROZEN_SEMANTIC_POLICY, isProfileCompatibleWithPolicy, type SemanticRetrievalPolicy } from "./semantic-policy";
import type { ModelProfile } from "./vector-types";

// Evidence fields whose text the exporter builds itself (perspective "theme: target" titles and
// "subject relation object" titles). Everything else is stored text from the record.
const CONSTRUCTED_FIELDS = new Set(["perspective_theme", "perspectiveTheme", "relation"]);
const hasConstructedTitle = (doc: SearchDocument) => doc.kind === "perspective" || doc.kind === "relationship";
const evidenceKindFor = (doc: SearchDocument, fieldName: string): SearchResultEvidence["evidenceKind"] =>
  hasConstructedTitle(doc) && CONSTRUCTED_FIELDS.has(fieldName) ? "derived" : "source";

const hostMatches = (host: string, domains: string[]) => domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
function contentTypeFor(doc: SearchDocument): SearchContentType {
  if (doc.kind !== "source") return doc.kind;
  const platform = String(doc.metadata.platform ?? "").toLowerCase();
  let host = "";
  try { host = doc.url ? new URL(doc.url).hostname.toLowerCase() : ""; } catch { /* unparseable URL: platform alone decides */ }
  if (platform === "openalex" || hostMatches(host, ["openalex.org", "doi.org", "arxiv.org"])) return "paper";
  if (platform === "github" || hostMatches(host, ["github.com"])) return "repository";
  if (platform === "youtube" || hostMatches(host, ["youtube.com", "youtu.be"])) return "video";
  return doc.url || platform ? "news_web" : "source";
}

// Group by canonical external identity (URL) or explicit parent-source association; records
// without either stay typed singletons. Titles and empty URLs never merge records.
function groupKeyFor(doc: SearchDocument, byId: Map<string, SearchDocument>): string {
  if (doc.kind === "robot") return doc.typedId;
  const parent = doc.parentTypedId ? byId.get(doc.parentTypedId) : undefined;
  const identity = parent?.kind === "source" ? parent : doc;
  return identity.url ? canonicalizeUrl(identity.groupId) : identity.typedId;
}
function addToGroup<T extends SearchResult>(groups: Map<string, T[]>, limit: number, key: string, result: T) {
  const members = groups.get(key);
  if (members) members.push(result);
  else if (groups.size < limit) groups.set(key, [result]);
}
const toGroups = <T extends SearchResult>(groups: Map<string, T[]>): SearchResultGroup<T>[] =>
  Array.from(groups, ([groupKey, results]) => ({ groupKey, results }));

/** Optional vectors for the semantic branch, keyed by `SearchDocument.vectorRow`. Absent means keyword only. */
export interface SearchSemanticVectors { profile: ModelProfile; rows: ReadonlyMap<number, Float32Array> }
export interface SearchFixtureIndex {
  documents: SearchDocument[];
  release: { id: string; generatedAt: string };
  coverage: { indexed: number; eligible: number };
  vectors?: SearchSemanticVectors;
}
export type SearchIndexLoader = () => Promise<SearchFixtureIndex | null>;
export interface SearchPostOptions {
  /** Supplied by the caller; this module never calls a model. Receives the normalized full request, negation included. */
  embedQuery?: (text: string) => Promise<Float32Array | null>;
  policy?: SemanticRetrievalPolicy;
  /** Per-record survival check (for example current eligibility). Records that fail never qualify, score or supply group evidence. */
  isEligible?: (doc: SearchDocument) => boolean;
}

// Candidate evidence for matching and display: stored evidence, plus a title candidate only
// when no stored evidence carries the title text.
function candidateEvidence(doc: SearchDocument, evidence: SearchResultEvidence[]): SearchResultEvidence[] {
  if (evidence.some((item) => item.originalText === doc.title)) return evidence;
  const coverage = doc.isTitleOnly ? "title-only" : "full";
  const title: SearchResultEvidence = hasConstructedTitle(doc)
    ? { fieldName: "title", originalText: doc.title, label: "Constructed title", evidenceKind: "derived", coverage, startOffset: 0, endOffset: doc.title.length }
    : { fieldName: "title", originalText: doc.title, label: "Title", evidenceKind: "source", coverage, startOffset: 0, endOffset: doc.title.length };
  return [title, ...evidence];
}

export function createSearchPost(loadIndex: SearchIndexLoader, options: SearchPostOptions = {}) {
  return async (request: Request): Promise<Response> => {
    const invalid = () => Response.json({ error: { code: "invalid_request", message: "Invalid search request." } }, { status: 400 });
    if (!/^application\/json\s*(?:;|$)/i.test(request.headers.get("content-type") ?? "")) return invalid();
    let value: unknown;
    try {
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          size += chunk.byteLength;
          if (size > 8192) { await reader.cancel(); return invalid(); }
          chunks.push(chunk);
        }
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch { return invalid(); }
    const input = validateSearchRequest(value);
    if (!input) return invalid();
    const prepared = prepareQuery(input.query);
    const view = prepared.isBrowse ? "browse" : "results";
    const unavailable: SearchResponse = { mode: "unavailable", view, release: null, coverage: { indexed: 0, eligible: 0 }, warnings: ["unavailable"], groups: [] };
    try {
      const index = await loadIndex();
      if (!index) return Response.json(unavailable, { status: 503 });
      const policy = options.policy ?? FROZEN_SEMANTIC_POLICY;
      const byId = new Map(index.documents.map((doc) => [doc.typedId, doc]));
      // Type and survival filters first: scoring, candidate caps and the group limit only ever see selected kinds.
      // Group identity still reads the whole index, so a perspective keeps its parent source's key.
      const selected = index.documents.filter((doc) => (!input.types || input.types.includes(doc.kind)) && (options.isEligible?.(doc) ?? true));
      const toResult = (doc: SearchDocument, evidence: SearchResultEvidence[]): SearchBrowseResult =>
        ({ reference: { kind: doc.kind, id: doc.typedId }, contentType: contentTypeFor(doc), title: doc.title, url: doc.url, evidence });
      const evidenceOf = new Map(selected.map((doc) => [doc.typedId, doc.evidence.map(({ fieldName, originalText, label, coverage, startOffset, endOffset }): SearchResultEvidence => ({ fieldName, originalText, label, coverage, startOffset, endOffset, evidenceKind: evidenceKindFor(doc, fieldName) }))]));
      const common = { release: { id: index.release.id, generatedAt: index.release.generatedAt }, coverage: { indexed: index.coverage.indexed, eligible: index.coverage.eligible } };

      if (prepared.isBrowse) {
        const browseGroups = new Map<string, SearchBrowseResult[]>();
        for (const doc of selected) addToGroup(browseGroups, input.limit, groupKeyFor(doc, byId), toResult(doc, evidenceOf.get(doc.typedId)!));
        return Response.json({ ...common, warnings: [], mode: "keyword", view: "browse", groups: toGroups(browseGroups) } satisfies SearchResponse);
      }

      const candidates = new Map(selected.map((doc) => [doc.typedId, candidateEvidence(doc, evidenceOf.get(doc.typedId)!)]));
      const keyword = rankKeyword(prepared, selected.map((doc) => ({ id: doc.typedId, title: doc.title, texts: candidates.get(doc.typedId)!.map((item) => item.originalText) })), policy.lexicalWeights);
      const keywordHits = new Map(keyword.map((hit) => [hit.id, hit]));

      const warnings: SearchWarning[] = [];
      let semanticIds: string[] = [];
      let hybrid = false;
      if (options.embedQuery && index.vectors && selected.length > 0) {
        const { profile, rows } = index.vectors;
        let queryVector: Float32Array | null = null;
        // No model call for a profile the policy cannot use.
        if (isProfileCompatibleWithPolicy(profile, policy)) {
          try { queryVector = await options.embedQuery(prepared.embeddingText); } catch { queryVector = null; }
        }
        const semantic = semanticRank({ queryVector, profile, policy, candidates: selected.map((doc) => ({ id: doc.typedId, vector: doc.vectorRow === null ? null : rows.get(doc.vectorRow) })) });
        if (semantic.status === "available") {
          hybrid = true;
          semanticIds = semantic.ranked;
          if (semantic.compatibleCount < selected.length) warnings.push("partial_vector_coverage");
        } else warnings.push("degraded_semantic");
      }
      const semanticSet = new Set(semanticIds);

      const matchedGroups = new Map<string, SearchMatchedResult[]>();
      for (const id of fuseRankings(keyword, semanticIds, policy)) {
        const doc = byId.get(id)!;
        const hit = keywordHits.get(id);
        const shown = candidates.get(id)!;
        const evidence = hit ? shown[hit.evidenceIndex] : shown.find((item) => item.originalText !== doc.title) ?? shown[0];
        const ranges = hit && hit.ranges.length ? { ranges: hit.ranges } : {};
        const match: SearchMatch = hit
          ? { methods: semanticSet.has(id) ? ["keyword", "semantic"] : ["keyword"], evidence, ...ranges }
          : { methods: ["semantic"], evidence };
        addToGroup(matchedGroups, input.limit, groupKeyFor(doc, byId), { ...toResult(doc, evidenceOf.get(id)!), match });
      }
      return Response.json({ ...common, warnings, mode: hybrid ? "hybrid" : "keyword", view: "results", groups: toGroups(matchedGroups) } satisfies SearchResponse);
    } catch { return Response.json(unavailable, { status: 503 }); }
  };
}
