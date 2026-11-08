import { embeddingHeaders, DEFAULT_EMBEDDING_PROTOCOL, type EmbeddingProtocol } from "./embedding-env";
import { l2Normalize } from "./vector-io";
import type { ModelProfile } from "./vector-types";

/**
 * Query-side embedding for Atlas Search. Server-only: it carries an API key and must never be
 * imported from client code.
 *
 * Qwen3-Embedding expects queries (and only queries) to carry an instruction prefix:
 * `Instruct: <task>\nQuery:<text>`. Documents are embedded without any prefix. Calibration
 * scripts and the direct-TEI path call `formatQueryForEmbedding`; the proxy path sends the bare
 * text with `kind: "query"` and the proxy applies the same prefix itself, so the cutoff is
 * measured on exactly what production embeds.
 */
export function formatQueryForEmbedding(profile: Pick<ModelProfile, "queryInstructionTask">, text: string): string {
  return `Instruct: ${profile.queryInstructionTask}\nQuery:${text}`;
}

/** Per-input character limit enforced by the embedding proxy. */
export const PROXY_MAX_INPUT_CHARS = 4000;

export interface QueryEmbedderOptions {
  endpoint: string;
  /** Bearer token for the embedding server. Optional for an unauthenticated loopback server. */
  apiKey?: string;
  /** Wire format. Defaults to "proxy" (see embedding-env.ts). */
  protocol?: EmbeddingProtocol;
  profile: ModelProfile;
  fetchImpl?: typeof fetch;
  /** Called with a short reason code only: never the query text, the key or the response body. */
  onFailure?: (reason: "http" | "shape" | "dimension" | "value" | "network") => void;
}

/**
 * Returns a function matching `SearchPostOptions["embedQuery"]`. It never throws: any failure
 * (network, abort, HTTP error, wrong shape or size, non-finite or zero vector) yields `null`, which
 * makes the search route answer in labelled keyword mode.
 */
export function createQueryEmbedder(options: QueryEmbedderOptions): (text: string, signal?: AbortSignal) => Promise<Float32Array | null> {
  const endpoint = options.endpoint.replace(/\/+$/, "");
  const protocol = options.protocol ?? DEFAULT_EMBEDDING_PROTOCOL;
  const doFetch = options.fetchImpl ?? fetch;
  const fail = (reason: Parameters<NonNullable<QueryEmbedderOptions["onFailure"]>>[0]) => {
    options.onFailure?.(reason);
    return null;
  };
  return async (text, signal) => {
    // The proxy rejects inputs over this size; skip the round trip (and its rate-limit budget).
    if (protocol === "proxy" && (text.length === 0 || text.length > PROXY_MAX_INPUT_CHARS)) return fail("shape");
    let response: Response;
    try {
      response = await doFetch(`${endpoint}/embed`, {
        method: "POST",
        headers: embeddingHeaders(options.apiKey),
        body: JSON.stringify(
          protocol === "proxy"
            ? { inputs: [text], kind: "query" }
            : { inputs: [formatQueryForEmbedding(options.profile, text)], normalize: true, truncate: true },
        ),
        signal,
      });
    } catch {
      return fail("network");
    }
    if (!response.ok) return fail("http");
    let data: unknown;
    try { data = await response.json(); } catch { return fail("shape"); }
    const rows = protocol === "proxy" ? (data as { vectors?: unknown } | null)?.vectors : data;
    const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (!Array.isArray(row)) return fail("shape");
    if (row.length !== options.profile.dimensions) return fail("dimension");
    if (!row.every((n) => typeof n === "number")) return fail("value");
    const vector = new Float32Array(row as number[]);
    try { return l2Normalize(vector); } catch { return fail("value"); }
  };
}
