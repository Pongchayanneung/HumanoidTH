import { createSearchPost } from "../../../lib/search/api";

export const POST = createSearchPost(async () => null);
export function GET(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
