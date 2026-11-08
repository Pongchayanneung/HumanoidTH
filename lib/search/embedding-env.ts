/**
 * Shared environment handling for the embedding service. Used by the vector builder and by the
 * website's query embedder so both read the same variables. Server-only.
 *
 * Key: EMBEDDING_SERVICE_API_KEY is canonical. EMBEDDING_SERVICE_KEY is accepted as a legacy alias
 * (the canonical name wins when both are set). The key is never logged or placed in an error.
 *
 * Protocol: EMBEDDING_SERVICE_PROTOCOL selects the wire format of the query embedder.
 *  - "proxy" (default): the authenticated GPU proxy. POST /embed {"inputs":[text],"kind":"query"};
 *    the proxy adds the `Instruct:` prefix itself and answers {"vectors":[[...]]}.
 *  - "tei": a direct text-embeddings-inference server. POST /embed {"inputs":[prefixed text],...};
 *    the client adds the prefix and the server answers a bare [[...]].
 * An unrecognised value resolves to `null` (never silently to a default), so the caller can serve
 * keyword results instead of sending the wrong wire format.
 */
export type EmbeddingProtocol = "proxy" | "tei";

export const EMBEDDING_KEY_ENV = "EMBEDDING_SERVICE_API_KEY";
export const LEGACY_EMBEDDING_KEY_ENV = "EMBEDDING_SERVICE_KEY";
export const EMBEDDING_PROTOCOL_ENV = "EMBEDDING_SERVICE_PROTOCOL";
export const DEFAULT_EMBEDDING_PROTOCOL: EmbeddingProtocol = "proxy";

type Env = Record<string, string | undefined>;

export function resolveEmbeddingApiKey(env: Env = process.env): string | undefined {
  return (env[EMBEDDING_KEY_ENV] ?? "").trim() || (env[LEGACY_EMBEDDING_KEY_ENV] ?? "").trim() || undefined;
}

/** Returns the configured protocol, the default when unset, or null when the value is not recognised. */
export function resolveEmbeddingProtocol(env: Env = process.env): EmbeddingProtocol | null {
  const raw = (env[EMBEDDING_PROTOCOL_ENV] ?? "").trim().toLowerCase();
  if (raw === "") return DEFAULT_EMBEDDING_PROTOCOL;
  return raw === "proxy" || raw === "tei" ? raw : null;
}

/**
 * JSON headers plus a bearer token when a key is given. The key is a required argument on purpose:
 * an omitted key must never fall back to the ambient process env, because the caller may be working
 * from an injected env. Pass `resolveEmbeddingApiKey(env)`.
 */
export function embeddingHeaders(apiKey: string | undefined): Record<string, string> {
  return { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };
}
