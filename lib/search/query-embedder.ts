import { l2Normalize } from "./vector-io";
import type { ModelProfile } from "./vector-types";

/**
 * Query-side embedding for Atlas Search. Server-only: it carries an API key and must never be
 * imported from client code.
 *
 * Qwen3-Embedding expects queries (and only queries) to carry an instruction prefix:
 * `Instruct: <task>\nQuery:<text>`. Documents are embedded without any prefix. Calibration
 * scripts and the website must both call `formatQueryForEmbedding` so the cutoff is measured on
 * exactly what production sends.
 */
export function formatQueryForEmbedding(profile: Pick<ModelProfile, "queryInstructionTask">, text: string): string {
  return `Instruct: ${profile.queryInstructionTask}\nQuery:${text}`;
}

export interface TeiQueryEmbedderOptions {
  endpoint: string;
  /** Bearer token for the embedding server. Optional for an unauthenticated loopback server. */
  apiKey?: string;
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
export function createTeiQueryEmbedder(options: TeiQueryEmbedderOptions): (text: string, signal?: AbortSignal) => Promise<Float32Array | null> {
  const endpoint = options.endpoint.replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? fetch;
  const fail = (reason: Parameters<NonNullable<TeiQueryEmbedderOptions["onFailure"]>>[0]) => {
    options.onFailure?.(reason);
    return null;
  };
  return async (text, signal) => {
    let response: Response;
    try {
      response = await doFetch(`${endpoint}/embed`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify({ inputs: [formatQueryForEmbedding(options.profile, text)], normalize: true, truncate: true }),
        signal,
      });
    } catch {
      return fail("network");
    }
    if (!response.ok) return fail("http");
    let data: unknown;
    try { data = await response.json(); } catch { return fail("shape"); }
    const row = Array.isArray(data) && data.length === 1 ? data[0] : null;
    if (!Array.isArray(row)) return fail("shape");
    if (row.length !== options.profile.dimensions) return fail("dimension");
    const vector = new Float32Array(row as number[]);
    try { return l2Normalize(vector); } catch { return fail("value"); }
  };
}
