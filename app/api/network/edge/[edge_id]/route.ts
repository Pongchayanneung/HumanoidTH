import { NextResponse } from "next/server";
import { getNetworkEdge } from "@/lib/network-graph";
import { invalidNetworkRequest, networkUnavailable, parseNetworkId, parseNetworkSource } from "@/lib/network-query";

export const dynamic = "force-dynamic";

type Params = Promise<{ edge_id: string }>;

export async function GET(req: Request, { params }: { params: Params }) {
  const { edge_id } = await params;
  const edgeId = parseNetworkId(edge_id);
  if (!edgeId) return invalidNetworkRequest("edge_id");
  const source = parseNetworkSource(new URL(req.url).searchParams);
  if (!source.ok) return invalidNetworkRequest(source.param);

  try {
    const result = await getNetworkEdge(edgeId, { sourceMode: source.value });
    if (!result) {
      return NextResponse.json({ error: "Edge not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("Network edge API failed:", error);
    return networkUnavailable();
  }
}
