import { createDatabaseSearchService } from "../../../lib/search/database-service";

export function POST(request: Request): Promise<Response> {
  return createDatabaseSearchService(async () => (await import("../../../lib/prisma")).prisma)(request);
}
export function GET(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
