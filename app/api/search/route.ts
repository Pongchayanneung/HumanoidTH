import { createDatabaseSearchService } from "../../../lib/search/database-service";
import { createSemanticOptionsFromEnv } from "../../../lib/search/semantic-config";

// Semantic dependencies come from the environment (ATLAS_SEMANTIC, EMBEDDING_SERVICE_URL,
// EMBEDDING_SERVICE_API_KEY). Without them this is the keyword-only service it always was.
const searchService = createDatabaseSearchService(
  async () => (await import("../../../lib/prisma")).prisma,
  createSemanticOptionsFromEnv(),
);

export function POST(request: Request): Promise<Response> {
  return searchService(request);
}
export function GET(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
