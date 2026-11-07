import { validateSearchRequest } from "./types";
import type { SearchBrowseResult, SearchContentType, SearchDocument, SearchResultEvidence, SearchMatchedResult, SearchResponse, SearchResult, SearchResultGroup } from "./types";

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
  return identity.url ? identity.groupId : identity.typedId;
}
function addToGroup<T extends SearchResult>(groups: Map<string, T[]>, limit: number, key: string, result: T) {
  const members = groups.get(key);
  if (members) members.push(result);
  else if (groups.size < limit) groups.set(key, [result]);
}
const toGroups = <T extends SearchResult>(groups: Map<string, T[]>): SearchResultGroup<T>[] =>
  Array.from(groups, ([groupKey, results]) => ({ groupKey, results }));

export interface SearchFixtureIndex {
  documents: SearchDocument[];
  release: { id: string; generatedAt: string };
  coverage: { indexed: number; eligible: number };
}
export type SearchIndexLoader = () => Promise<SearchFixtureIndex | null>;

export function createSearchPost(loadIndex: SearchIndexLoader) {
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
    const view = input.query ? "results" : "browse";
    const unavailable: SearchResponse = { mode: "unavailable", view, release: null, coverage: { indexed: 0, eligible: 0 }, warnings: ["unavailable"], groups: [] };
    try {
      const index = await loadIndex();
      if (!index) return Response.json(unavailable, { status: 503 });
      const browseGroups = new Map<string, SearchBrowseResult[]>();
      const matchedGroups = new Map<string, SearchMatchedResult[]>();
      const byId = new Map(index.documents.map((doc) => [doc.typedId, doc]));
      const pattern = input.query ? new RegExp(input.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu") : null;
      for (const doc of index.documents) {
        if (input.types && !input.types.includes(doc.kind)) continue;
        const evidence: SearchResultEvidence[] = doc.evidence.map(({ fieldName, originalText, label, coverage, startOffset, endOffset }) => ({ fieldName, originalText, label, coverage, startOffset, endOffset, evidenceKind: evidenceKindFor(doc, fieldName) }));
        let match: SearchResult["match"];
        if (pattern) {
          // Stored evidence is original; synthesize a title only when none carries that text.
          const hasTitleEvidence = evidence.some((item) => item.originalText === doc.title);
          const titleEvidence: SearchResultEvidence = hasConstructedTitle(doc)
            ? { fieldName: "title", originalText: doc.title, label: "Constructed title", evidenceKind: "derived", coverage: doc.isTitleOnly ? "title-only" : "full", startOffset: 0, endOffset: doc.title.length }
            : { fieldName: "title", originalText: doc.title, label: "Title", evidenceKind: "source", coverage: doc.isTitleOnly ? "title-only" : "full", startOffset: 0, endOffset: doc.title.length };
          const matchedEvidence = (hasTitleEvidence ? evidence : [titleEvidence, ...evidence]).find((item) => pattern.test(item.originalText));
          if (!matchedEvidence) continue;
          const found = pattern.exec(matchedEvidence.originalText)!;
          match = { methods: ["keyword"], evidence: matchedEvidence, ranges: [{ start: found.index, end: found.index + found[0].length }] };
        }
        const result: SearchBrowseResult = { reference: { kind: doc.kind, id: doc.typedId }, contentType: contentTypeFor(doc), language: doc.language, title: doc.title, url: doc.url, evidence };
        const key = groupKeyFor(doc, byId);
        if (match) addToGroup(matchedGroups, input.limit, key, { ...result, match });
        else addToGroup(browseGroups, input.limit, key, result);
      }
      const common = { release: { id: index.release.id, generatedAt: index.release.generatedAt }, coverage: { indexed: index.coverage.indexed, eligible: index.coverage.eligible }, warnings: [] };
      const response: SearchResponse = input.query ? { ...common, mode: "keyword", view: "results", groups: toGroups(matchedGroups) } : { ...common, mode: "keyword", view: "browse", groups: toGroups(browseGroups) };
      return Response.json(response);
    } catch { return Response.json(unavailable, { status: 503 }); }
  };
}
