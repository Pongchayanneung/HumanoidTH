import { NextRequest, NextResponse } from "next/server";
import { buildNetworkGraph } from "@/lib/network-graph";
import { invalidNetworkRequest, networkUnavailable, parseNetworkGraphQuery } from "@/lib/network-query";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const query = parseNetworkGraphQuery(new URL(req.url).searchParams);
  if (!query.ok) return invalidNetworkRequest(query.param);

  try {
    const graph = await buildNetworkGraph({
      ...query.value,
      // Public API protection (M3 / T03): Public calls can never bypass confidentiality controls
      includePrivate: false
    });
    return NextResponse.json(graph);
  } catch (error) {
    // Detail stays in server logs; the response never carries Prisma, path or stack text.
    console.error("Network graph API failed:", error);
    return networkUnavailable();
  }
}
