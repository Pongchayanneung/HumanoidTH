import type { NetworkSourceMode } from "./network-graph";

// Documented bounds for the public network API (M8-A). Integers inside the
// range are used as given, integers outside are clamped, everything else is rejected.
export const NETWORK_NODE_LIMIT = { min: 25, max: 1000, fallback: 300 } as const;
export const NETWORK_EDGE_LIMIT = { min: 50, max: 2500, fallback: 800 } as const;
export const NETWORK_SOURCE_MODES: readonly NetworkSourceMode[] = ["file", "database", "hybrid", "auto"];
export const NETWORK_TEXT_PARAM_MAX = 100;
export const NETWORK_ID_MAX = 256;

type Limit = { min: number; max: number; fallback: number };
type Parsed<T> = { ok: true; value: T } | { ok: false; param: string };

export type NetworkGraphQuery = {
  sourceMode?: NetworkSourceMode;
  cluster: string | null;
  nodeType: string | null;
  relation: string | null;
  minConfidence: number | null;
  includeLowConfidence?: boolean;
  maxNodes: number;
  maxEdges: number;
};

// A repeated parameter is ambiguous, so it is rejected instead of silently taking the first value.
function single(params: URLSearchParams, name: string): Parsed<string | null> {
  const values = params.getAll(name);
  if (values.length > 1) return { ok: false, param: name };
  return { ok: true, value: values[0] ?? null };
}

// `limitNodes` and `maxNodes` are aliases. Sending both is ambiguous, so it is rejected rather
// than letting one alias bypass validation of the other.
function limit(params: URLSearchParams, names: [string, string], bounds: Limit): Parsed<number> {
  if (names.every((alias) => params.has(alias))) return { ok: false, param: names[1] };
  const name = names.find((alias) => params.has(alias)) ?? names[0];
  const raw = single(params, name);
  if (!raw.ok) return raw;
  if (raw.value === null) return { ok: true, value: bounds.fallback };
  if (!/^\d{1,6}$/.test(raw.value)) return { ok: false, param: name };
  return { ok: true, value: Math.min(Math.max(Number(raw.value), bounds.min), bounds.max) };
}

function text(params: URLSearchParams, name: string): Parsed<string | null> {
  const raw = single(params, name);
  if (!raw.ok || raw.value === null) return raw;
  if (!raw.value.trim() || raw.value.length > NETWORK_TEXT_PARAM_MAX || /[\p{Cc}\p{Cs}]/u.test(raw.value)) return { ok: false, param: name };
  return raw;
}

export function parseNetworkSource(params: URLSearchParams): Parsed<NetworkSourceMode | undefined> {
  const raw = single(params, "source");
  if (!raw.ok || raw.value === null) return raw.ok ? { ok: true, value: undefined } : raw;
  const mode = NETWORK_SOURCE_MODES.find((candidate) => candidate === raw.value);
  return mode ? { ok: true, value: mode } : { ok: false, param: "source" };
}

export function parseNetworkGraphQuery(params: URLSearchParams): Parsed<NetworkGraphQuery> {
  const source = parseNetworkSource(params);
  if (!source.ok) return source;
  const maxNodes = limit(params, ["limitNodes", "maxNodes"], NETWORK_NODE_LIMIT);
  if (!maxNodes.ok) return maxNodes;
  const maxEdges = limit(params, ["limitEdges", "maxEdges"], NETWORK_EDGE_LIMIT);
  if (!maxEdges.ok) return maxEdges;
  const cluster = text(params, "cluster");
  if (!cluster.ok) return cluster;
  const nodeType = text(params, "nodeType");
  if (!nodeType.ok) return nodeType;
  const relation = text(params, "relation");
  if (!relation.ok) return relation;

  const confidence = single(params, "minConfidence");
  if (!confidence.ok) return confidence;
  if (confidence.value !== null && !/^(?:0(?:\.\d{1,6})?|1(?:\.0{1,6})?)$/.test(confidence.value)) return { ok: false, param: "minConfidence" };

  const low = single(params, "includeLowConfidence");
  if (!low.ok) return low;
  if (low.value !== null && low.value !== "true" && low.value !== "false") return { ok: false, param: "includeLowConfidence" };

  return {
    ok: true,
    value: {
      sourceMode: source.value,
      cluster: cluster.value,
      nodeType: nodeType.value,
      relation: relation.value,
      minConfidence: confidence.value === null ? null : Number(confidence.value),
      includeLowConfidence: low.value === null ? undefined : low.value === "true",
      maxNodes: maxNodes.value,
      maxEdges: maxEdges.value
    }
  };
}

// Path ids may arrive percent-encoded or already decoded. A malformed escape is kept literally
// (it simply matches nothing) instead of throwing a URIError. Empty or oversized ids are client errors.
export function parseNetworkId(encoded: string): string | null {
  if (encoded.length > NETWORK_ID_MAX * 3) return null;
  let id = encoded;
  try { id = decodeURIComponent(encoded); } catch { /* keep the literal value */ }
  if (!id.trim() || id.length > NETWORK_ID_MAX || /[\p{Cc}\p{Cs}]/u.test(id)) return null;
  return id;
}

export function invalidNetworkRequest(param: string): Response {
  return Response.json({ error: `Invalid request parameter: ${param}` }, { status: 400 });
}

export function networkUnavailable(): Response {
  return Response.json({ error: "Network graph is unavailable." }, { status: 503 });
}
