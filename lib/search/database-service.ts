import { createSearchService } from "./api";
import { exportSearchCorpusFromDb } from "./exporter";
import { revalidateSearchDocument } from "./revalidation";
import type { SearchPostOptions } from "./api";

export function createDatabaseSearchService(
  loadDatabase: () => Promise<any>,
  options: {
    corpusCacheTtlMs?: number;
    loadVectors?: SearchPostOptions["loadVectors"];
    embedQuery?: SearchPostOptions["embedQuery"];
    policy?: SearchPostOptions["policy"];
    clock?: SearchPostOptions["clock"];
  } = {},
) {
  const ttl = options.corpusCacheTtlMs ?? 60_000;
  let cached: {
    data: { documents: any[]; release: { id: string; generatedAt: string }; coverage: { indexed: number; eligible: number } };
    timestamp: number;
  } | null = null;

  return (request: Request) => {
    let database: any;
    return createSearchService({
      loadCorpus: async (signal) => {
        database = await loadDatabase();
        signal?.throwIfAborted();
        const now = Date.now();
        if (cached && now - cached.timestamp < ttl) {
          return cached.data;
        }
        const { documents, manifest } = await exportSearchCorpusFromDb(database, undefined, undefined, signal);
        const data = { documents, release: { id: manifest.releaseId, generatedAt: manifest.generatedAt }, coverage: { indexed: 0, eligible: documents.length } };
        cached = { data, timestamp: now };
        return data;
      },
      revalidate: async (doc) => (await revalidateSearchDocument(doc, database)).isValid,
      loadVectors: options.loadVectors,
      embedQuery: options.embedQuery,
      policy: options.policy,
      clock: options.clock,
    })(request);
  };
}
