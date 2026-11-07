import { createDatabaseSearchService } from "../../../lib/search/database-service";

const searchService = createDatabaseSearchService(async () => (await import("../../../lib/prisma")).prisma);

export function POST(request: Request): Promise<Response> {
  return searchService(request);
}
export function GET(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
