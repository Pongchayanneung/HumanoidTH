import { resolve } from "node:path";
import type { SearchPostOptions } from "./api";
import { createTeiQueryEmbedder } from "./query-embedder";
import { createReleaseVectorLoader, withKeywordFallback } from "./vector-loader";
import { FROZEN_SEMANTIC_POLICY } from "./semantic-policy";
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
 *  - no embedding endpoint is configured (EMBEDDING_SERVICE_URL, or TEI_ENDPOINT as a fallback).
 * Even when configured, hybrid ranking only turns on if the policy is frozen AND calibrated
 * (`calibrationStatus: "calibrated_on_dev_split"` in semantic-policy.ts); until then the search API
 * ignores these dependencies and answers in keyword mode.
 */
export function createSemanticOptionsFromEnv(
  env: Record<string, string | undefined> = process.env,
  searchDir: string = resolve(process.cwd(), "data", "search"),
): SemanticServingOptions {
  if ((env.ATLAS_SEMANTIC ?? "").trim().toLowerCase() === "off") return {};
  const endpoint = (env.EMBEDDING_SERVICE_URL || env.TEI_ENDPOINT || "").trim();
  if (!endpoint) return {};
  return {
    embedQuery: createTeiQueryEmbedder({
      endpoint,
      apiKey: env.EMBEDDING_SERVICE_API_KEY || undefined,
      profile: DEFAULT_MODEL_PROFILE,
      onFailure: (reason) => console.warn(`[atlas-search] query embedding failed (${reason}); serving keyword results`),
    }),
    loadVectors: withKeywordFallback(createReleaseVectorLoader({ searchDir })),
    policy: FROZEN_SEMANTIC_POLICY,
  };
}
