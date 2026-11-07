import { NextResponse } from "next/server";
import { getNetworkNode } from "@/lib/network-graph";
import { invalidNetworkRequest, networkUnavailable, parseNetworkId, parseNetworkSource } from "@/lib/network-query";

export const dynamic = "force-dynamic";

type Params = Promise<{ node_id: string }>;

export async function GET(req: Request, { params }: { params: Params }) {
  const { node_id } = await params;
  const nodeId = parseNetworkId(node_id);
  if (!nodeId) return invalidNetworkRequest("node_id");
  const source = parseNetworkSource(new URL(req.url).searchParams);
  if (!source.ok) return invalidNetworkRequest(source.param);

  try {
    const result = await getNetworkNode(nodeId, { sourceMode: source.value });
    if (!result) {
      return NextResponse.json({ error: "Node not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("Network node API failed:", error);
    return networkUnavailable();
  }
}
