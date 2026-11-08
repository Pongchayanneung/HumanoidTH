import { canonicalizeUrl } from "../url";
import { validateSearchRequest } from "./types";
import type { SearchBrowseResult, SearchContentType, SearchDocument, SearchMatch, SearchResultEvidence, SearchMatchedResult, SearchResponse, SearchResult, SearchResultGroup, SearchWarning } from "./types";
import { fuseRankings, prepareQuery, rankKeyword, semanticFirstRanking, semanticRank } from "./ranking";
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
export function groupKeyFor(doc: SearchDocument, byId: Map<string, SearchDocument>): string {
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
export type SearchIndexLoader = (signal?: AbortSignal) => Promise<SearchFixtureIndex | null>;
export interface SearchPostOptions {
  /** Supplied by the caller; this module never calls a model. Receives the normalized full request, negation included. */
  embedQuery?: (text: string, signal?: AbortSignal) => Promise<Float32Array | null>;
  loadVectors?: (index: SearchFixtureIndex, signal: AbortSignal) => Promise<SearchSemanticVectors | null>;
  revalidate?: (doc: SearchDocument, signal: AbortSignal) => Promise<boolean>;
  clock?: { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (id: unknown) => void };
  requirePolicy?: boolean;
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
    const controller = new AbortController();
    const clock = options.clock ?? { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>) };
    let timeoutView: "browse" | "results" = "results";
    const unavailableResponse = () => Response.json({ mode: "unavailable", view: timeoutView, release: null, coverage: { indexed: 0, eligible: 0 }, warnings: ["unavailable"], groups: [] }, { status: 503 });
    let totalTimer: unknown;
    const timeout = new Promise<Response>((resolve) => { totalTimer = clock.setTimeout(() => { controller.abort(); resolve(unavailableResponse()); }, 5000); });
    const work = async (): Promise<Response> => {
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
    timeoutView = view;
    const unavailable: SearchResponse = { mode: "unavailable", view, release: null, coverage: { indexed: 0, eligible: 0 }, warnings: ["unavailable"], groups: [] };
    try {
      const loaded = await loadIndex(controller.signal);
      controller.signal.throwIfAborted();
      const index = loaded && { ...loaded };
      if (!index || !index.release?.id || !index.release?.generatedAt || !Array.isArray(index.documents)) return Response.json(unavailable, { status: 503 });
      const policyReady = !options.requirePolicy || Boolean(options.policy?.isFrozen && (options.policy.calibrationStatus === "calibrated_on_dev_split" || options.policy.calibrationStatus === "demo_unvalidated") && Number.isFinite(options.policy.semanticCutoffThreshold));
      if (!prepared.isBrowse && policyReady && options.embedQuery && options.loadVectors) index.vectors = (await options.loadVectors(index, controller.signal)) ?? undefined;
      controller.signal.throwIfAborted();
      const policy = options.policy ?? FROZEN_SEMANTIC_POLICY;
      const byId = new Map(index.documents.map((doc) => [doc.typedId, doc]));
      // Type and survival filters first: scoring, candidate caps and the group limit only ever see selected kinds.
      // Group identity still reads the whole index, so a perspective keeps its parent source's key.
      const selected = index.documents.filter((doc) => (!input.types || input.types.includes(doc.kind)) && (!input.subtype || contentTypeFor(doc) === input.subtype) && (options.isEligible?.(doc) ?? true));
      const toResult = (doc: SearchDocument, evidence: SearchResultEvidence[]): SearchBrowseResult =>
        ({ reference: { kind: doc.kind, id: doc.typedId }, contentType: contentTypeFor(doc), language: doc.language, title: doc.title, url: doc.url, evidence });
      const evidenceOf = new Map(selected.map((doc) => [doc.typedId, doc.evidence.map(({ fieldName, originalText, label, coverage, startOffset, endOffset }): SearchResultEvidence => ({ fieldName, originalText, label, coverage, startOffset, endOffset, evidenceKind: evidenceKindFor(doc, fieldName) }))]));
      const common = { release: { id: index.release.id, generatedAt: index.release.generatedAt }, coverage: { indexed: 0, eligible: selected.length } };

      let checks = 0;
      const survives = async (doc: SearchDocument) => {
        controller.signal.throwIfAborted();
        if (!options.revalidate) return true;
        checks++;
        const valid = await options.revalidate(doc, controller.signal);
        controller.signal.throwIfAborted();
        return valid;
      };
      if (prepared.isBrowse) {
        const browseGroups = new Map<string, SearchBrowseResult[]>();
        for (const doc of selected) {
          const key = groupKeyFor(doc, byId);
          if (options.revalidate && checks >= policy.limits.maxCurrentRecordChecks) break;
          if (!browseGroups.has(key) && browseGroups.size >= input.limit) continue;
          if (await survives(doc)) addToGroup(browseGroups, input.limit, key, toResult(doc, evidenceOf.get(doc.typedId)!));
        }
        return Response.json({ ...common, warnings: [], mode: "keyword", view: "browse", groups: toGroups(browseGroups) } satisfies SearchResponse);
      }

      const candidates = new Map(selected.map((doc) => [doc.typedId, candidateEvidence(doc, evidenceOf.get(doc.typedId)!)]));
      const keyword = rankKeyword(prepared, selected.map((doc) => ({ id: doc.typedId, title: doc.title, texts: candidates.get(doc.typedId)!.map((item) => item.originalText) })), policy.lexicalWeights);
      const keywordHits = new Map(keyword.map((hit) => [hit.id, hit]));

      const warnings: SearchWarning[] = [];
      let semanticIds: string[] = [];
      let hybrid = false;
      let compatibleCount = 0;
      if (options.embedQuery && index.vectors && selected.length > 0 && policyReady) {
        const { profile, rows } = index.vectors;
        let queryVector: Float32Array | null = null;
        const indexed = selected.filter((doc) => {
          const v = doc.vectorRow === null ? undefined : rows.get(doc.vectorRow);
          return v?.length === profile.dimensions && v.every(Number.isFinite) && v.some((n) => n !== 0);
        }).length;
        common.coverage.indexed = indexed;
        if (isProfileCompatibleWithPolicy(profile, policy) && indexed < selected.length && options.requirePolicy) warnings.push("partial_vector_coverage");
        // No model call for a profile the policy cannot use.
        if (isProfileCompatibleWithPolicy(profile, policy) && (indexed > 0 || !options.requirePolicy)) {
          let timer: unknown;
          const inferenceController = new AbortController();
          const abort = () => inferenceController.abort();
          controller.signal.addEventListener("abort", abort, { once: true });
          try {
            queryVector = await Promise.race([options.embedQuery(prepared.embeddingText, inferenceController.signal), new Promise<null>((resolve) => { timer = clock.setTimeout(() => { inferenceController.abort(); resolve(null); }, 2500); })]);
          } catch { queryVector = null; } finally { clock.clearTimeout(timer); controller.signal.removeEventListener("abort", abort); }
        }
        controller.signal.throwIfAborted();
        const semantic = semanticRank({ queryVector, profile, policy, candidates: selected.map((doc) => ({ id: doc.typedId, vector: doc.vectorRow === null ? null : rows.get(doc.vectorRow) })) });
        if (semantic.status === "available") {
          hybrid = true;
          compatibleCount = semantic.compatibleCount;
          semanticIds = semantic.ranked;
          if (!options.requirePolicy && semantic.compatibleCount < selected.length) warnings.push("partial_vector_coverage");
        } else if (!isProfileCompatibleWithPolicy(profile, policy) || indexed > 0) warnings.push("degraded_semantic");
      }
      if (hybrid) {
        common.coverage = { indexed: compatibleCount, eligible: selected.length };
      }
      const semanticSet = new Set(semanticIds);

      const matchedGroups = new Map<string, SearchMatchedResult[]>();
      const demo = hybrid && policy.calibrationStatus === "demo_unvalidated";
      const groupOf = (docId: string) => groupKeyFor(byId.get(docId)!, byId);
      const canScore = (id: string) => {
        const row = byId.get(id)?.vectorRow;
        return row !== null && row !== undefined && Boolean(index.vectors?.rows.get(row));
      };
      for (const id of demo ? semanticFirstRanking(keyword, semanticIds, groupOf, canScore) : fuseRankings(keyword, semanticIds, policy, groupOf)) {
        const doc = byId.get(id)!;
        const key = groupKeyFor(doc, byId);
        if (options.revalidate && checks >= policy.limits.maxCurrentRecordChecks) break;
        if (!matchedGroups.has(key) && matchedGroups.size >= input.limit) continue;
        if (!await survives(doc)) continue;
        const hit = keywordHits.get(id);
        const shown = candidates.get(id)!;
        const evidence = hit ? shown[hit.evidenceIndex] : shown.find((item) => item.originalText !== doc.title) ?? shown[0];
        const ranges = hit && hit.ranges.length ? { ranges: hit.ranges } : {};
        const match: SearchMatch = hit
          ? { methods: semanticSet.has(id) ? ["keyword", "semantic"] : ["keyword"], evidence, ...ranges }
          : { methods: ["semantic"], evidence };
        addToGroup(matchedGroups, input.limit, key, { ...toResult(doc, evidenceOf.get(id)!), match });
      }
      return Response.json({ ...common, warnings, mode: hybrid ? "hybrid" : "keyword", ...(demo ? { policyStatus: "demo_unvalidated" as const } : {}), view: "results", groups: toGroups(matchedGroups) } satisfies SearchResponse);
    } catch { return Response.json(unavailable, { status: 503 }); }
    };
    try { return await Promise.race([work(), timeout]); } finally { clock.clearTimeout(totalTimer); }
  };
}

/** Serving dependencies must validate releases and fail on failed eligibility checks. */
export function createSearchService(deps: {
  loadCorpus: SearchIndexLoader;
  loadVectors?: SearchPostOptions["loadVectors"];
  embedQuery?: SearchPostOptions["embedQuery"];
  revalidate: NonNullable<SearchPostOptions["revalidate"]>;
  policy?: SemanticRetrievalPolicy;
  clock?: SearchPostOptions["clock"];
}) {
  return createSearchPost(deps.loadCorpus, { ...deps, requirePolicy: true });
}
