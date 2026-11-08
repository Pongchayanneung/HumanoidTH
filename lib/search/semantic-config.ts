import { resolve } from "node:path";
import type { SearchPostOptions } from "./api";
import { resolveEmbeddingApiKey, resolveEmbeddingProtocol } from "./embedding-env";
import { createQueryEmbedder } from "./query-embedder";
import { createReleaseVectorLoader, withKeywordFallback } from "./vector-loader";
import { DEMO_SEMANTIC_POLICY, FROZEN_SEMANTIC_POLICY } from "./semantic-policy";
import { DEFAULT_MODEL_PROFILE } from "./vector-types";

export interface SemanticServingOptions {
  embedQuery?: SearchPostOptions["embedQuery"];
  loadVectors?: SearchPostOptions["loadVectors"];
  policy?: SearchPostOptions["policy"];
}

/**
 * Builds the optional semantic dependencies for the search route from the environment.
 * Server-only. Returns {} (keyword-only search, today's behaviour) when:
 *  - ATLAS_SEMANTIC is "off" (kill switch; a restart is enough), or
 *  - no embedding endpoint is configured (EMBEDDING_SERVICE_URL, or TEI_ENDPOINT as a fallback), or
 *  - EMBEDDING_SERVICE_PROTOCOL is set to something other than "proxy" or "tei" (logged; never guessed).
 * The key is EMBEDDING_SERVICE_API_KEY (legacy alias EMBEDDING_SERVICE_KEY). The protocol defaults
 * to "proxy"; set EMBEDDING_SERVICE_PROTOCOL=tei for a direct text-embeddings-inference server.
 * Even when configured, semantic ranking only turns on if the policy is frozen AND calibrated
 * (`calibrationStatus: "calibrated_on_dev_split"` in semantic-policy.ts), or the demo switch
 * ATLAS_SEMANTIC_DEMO=1 selects DEMO_SEMANTIC_POLICY (`demo_unvalidated`, semantic-first, labelled
 * as an unvalidated experiment). Otherwise the search API ignores these dependencies and answers
 * in keyword mode.
 */
export function createSemanticOptionsFromEnv(
  env: Record<string, string | undefined> = process.env,
  searchDir: string = resolve(process.cwd(), "data", "search"),
): SemanticServingOptions {
  if ((env.ATLAS_SEMANTIC ?? "").trim().toLowerCase() === "off") return {};
  const endpoint = (env.EMBEDDING_SERVICE_URL ?? "").trim() || (env.TEI_ENDPOINT ?? "").trim();
  if (!endpoint) return {};
  // TEI_ENDPOINT is the legacy name for a direct text-embeddings-inference server, which does not speak the proxy
  // format. Alone, it implies the "tei" protocol; an explicit EMBEDDING_SERVICE_PROTOCOL always wins.
  const legacyTeiOnly = !(env.EMBEDDING_SERVICE_URL ?? "").trim() && Boolean((env.TEI_ENDPOINT ?? "").trim());
  const protocol = legacyTeiOnly && !(env.EMBEDDING_SERVICE_PROTOCOL ?? "").trim() ? "tei" : resolveEmbeddingProtocol(env);
  if (!protocol) {
    console.warn("[atlas-search] EMBEDDING_SERVICE_PROTOCOL must be \"proxy\" or \"tei\"; serving keyword results");
    return {};
  }
  return {
    embedQuery: createQueryEmbedder({
      endpoint,
      apiKey: resolveEmbeddingApiKey(env),
      protocol,
      profile: DEFAULT_MODEL_PROFILE,
      onFailure: (reason) => console.warn(`[atlas-search] query embedding failed (${reason}); serving keyword results`),
    }),
    loadVectors: withKeywordFallback(createReleaseVectorLoader({ searchDir })),
    policy: (env.ATLAS_SEMANTIC_DEMO ?? "").trim() === "1" ? DEMO_SEMANTIC_POLICY : FROZEN_SEMANTIC_POLICY,
  };
}
