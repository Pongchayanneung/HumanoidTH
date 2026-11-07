import { validateSearchRequest } from "./types";
import type { SearchBrowseResult, SearchDocument, SearchEvidence, SearchMatchedResult, SearchResponse, SearchResult, SearchResultGroup } from "./types";

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
    const unavailable: SearchResponse = { mode: "unavailable", release: null, coverage: { indexed: 0, eligible: 0 }, warnings: ["unavailable"], groups: [] };
    try {
      const index = await loadIndex();
      if (!index) return Response.json(unavailable, { status: 503 });
      const browseGroups: SearchResultGroup<SearchBrowseResult>[] = [];
      const matchedGroups: SearchResultGroup<SearchMatchedResult>[] = [];
      function addResult<T extends SearchResult>(groups: SearchResultGroup<T>[], kind: SearchDocument["kind"], result: T) {
        let group = groups.find((item) => item.kind === kind);
        if (!group) { group = { kind, results: [] }; groups.push(group); }
        group.results.push(result);
      }
      let count = 0;
      for (const doc of index.documents) {
        if (input.types && !input.types.includes(doc.kind)) continue;
        const evidence = doc.evidence.map(({ fieldName, originalText, label, coverage, startOffset, endOffset }) => ({ fieldName, originalText, label, coverage, startOffset, endOffset }));
        let match: SearchResult["match"];
        if (input.query) {
          const pattern = new RegExp(input.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
          const titleEvidence: SearchEvidence = { fieldName: "title", originalText: doc.title, label: "Title", coverage: doc.isTitleOnly ? "title-only" : "full", startOffset: 0, endOffset: doc.title.length };
          const matchedEvidence: SearchEvidence | undefined = [titleEvidence, ...evidence].find((item) => pattern.test(item.originalText));
          if (!matchedEvidence) continue;
          const found = pattern.exec(matchedEvidence.originalText)!;
          match = { methods: ["keyword"], evidence: matchedEvidence, ranges: [{ start: found.index, end: found.index + found[0].length }] };
        }
        const result: SearchBrowseResult = { reference: { kind: doc.kind, id: doc.typedId }, title: doc.title, url: doc.url, evidence };
        if (match) addResult(matchedGroups, doc.kind, { ...result, match });
        else addResult(browseGroups, doc.kind, result);
        if (++count === input.limit) break;
      }
      const common = { release: { id: index.release.id, generatedAt: index.release.generatedAt }, coverage: { indexed: index.coverage.indexed, eligible: index.coverage.eligible }, warnings: [] };
      const response: SearchResponse = input.query ? { ...common, mode: "keyword", groups: matchedGroups } : { ...common, mode: "browse", groups: browseGroups };
      return Response.json(response);
    } catch { return Response.json(unavailable, { status: 503 }); }
  };
}
