import { NextRequest, NextResponse } from "next/server";
import { buildNetworkGraph, type NetworkSourceMode } from "@/lib/network-graph";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const maxNodes = Number(searchParams.get("limitNodes") ?? searchParams.get("maxNodes") ?? 300);
  const maxEdges = Number(searchParams.get("limitEdges") ?? searchParams.get("maxEdges") ?? 800);
  const minConfidence = searchParams.get("minConfidence");
  const source = searchParams.get("source") as NetworkSourceMode | null;

  try {
    const graph = await buildNetworkGraph({
      sourceMode: source ?? undefined,
      cluster: searchParams.get("cluster"),
      nodeType: searchParams.get("nodeType"),
      relation: searchParams.get("relation"),
      minConfidence: minConfidence ? Number(minConfidence) : null,
      includeLowConfidence: searchParams.get("includeLowConfidence") === null ? undefined : searchParams.get("includeLowConfidence") === "true",
      // Public API protection (M3 / T03): Public calls can never bypass confidentiality controls
      includePrivate: false,
      maxNodes: Number.isFinite(maxNodes) ? Math.min(Math.max(maxNodes, 25), 1000) : 300,
      maxEdges: Number.isFinite(maxEdges) ? Math.min(Math.max(maxEdges, 50), 2500) : 800
    });
    return NextResponse.json(graph);
  } catch (error) {
    console.error("Network graph API failed:", error);
    return NextResponse.json({
      nodes: [],
      edges: [],
      clusters: [],
      meta: {
        source_mode: source ?? "auto",
        resolved_source: source === "database" ? "database" : "file",
        database_available: false,
        file_available: false,
        warnings: [error instanceof Error ? error.message : "Network graph generation failed"],
        node_count: 0,
        edge_count: 0,
        cluster_count: 0,
        generated_at: new Date().toISOString(),
        truncated: false
      }
    }, { status: source === "database" || source === "file" ? 503 : 200 });
  }
}
