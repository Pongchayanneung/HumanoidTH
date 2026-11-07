import { createSearchService } from "./api";
import { exportSearchCorpusFromDb } from "./exporter";
import { revalidateSearchDocument } from "./revalidation";

export function createDatabaseSearchService(loadDatabase: () => Promise<any>) {
  return (request: Request) => {
    let database: any;
    return createSearchService({
      loadCorpus: async () => {
        database = await loadDatabase();
        const { documents, manifest } = await exportSearchCorpusFromDb(database);
        return { documents, release: { id: manifest.releaseId, generatedAt: manifest.generatedAt }, coverage: { indexed: 0, eligible: documents.length } };
      },
      revalidate: async (doc) => (await revalidateSearchDocument(doc, database)).isValid,
    })(request);
  };
}
