import test from "node:test";
import assert from "node:assert/strict";
import { embeddingHeaders, resolveEmbeddingApiKey, resolveEmbeddingProtocol } from "../lib/search/embedding-env";

test("api key: canonical name wins, legacy alias works, blank is no key", () => {
  assert.equal(resolveEmbeddingApiKey({}), undefined);
  assert.equal(resolveEmbeddingApiKey({ EMBEDDING_SERVICE_KEY: "legacy" }), "legacy");
  assert.equal(resolveEmbeddingApiKey({ EMBEDDING_SERVICE_API_KEY: "canon", EMBEDDING_SERVICE_KEY: "legacy" }), "canon");
  assert.equal(resolveEmbeddingApiKey({ EMBEDDING_SERVICE_API_KEY: "  ", EMBEDDING_SERVICE_KEY: "legacy" }), "legacy");
  assert.equal(resolveEmbeddingApiKey({ EMBEDDING_SERVICE_API_KEY: "  " }), undefined);
});

test("protocol: defaults to proxy, accepts tei case-insensitively, rejects anything else", () => {
  assert.equal(resolveEmbeddingProtocol({}), "proxy");
  assert.equal(resolveEmbeddingProtocol({ EMBEDDING_SERVICE_PROTOCOL: "" }), "proxy");
  assert.equal(resolveEmbeddingProtocol({ EMBEDDING_SERVICE_PROTOCOL: " TEI " }), "tei");
  assert.equal(resolveEmbeddingProtocol({ EMBEDDING_SERVICE_PROTOCOL: "proxy" }), "proxy");
  assert.equal(resolveEmbeddingProtocol({ EMBEDDING_SERVICE_PROTOCOL: "grpc" }), null);
});

test("headers: bearer only when a key is present", () => {
  assert.deepEqual(embeddingHeaders(undefined), { "Content-Type": "application/json" });
  assert.deepEqual(embeddingHeaders("k"), { "Content-Type": "application/json", Authorization: "Bearer k" });
});

test("builder reads the key through the shared helper at call time (alias honoured)", async () => {
  const { TeiEmbeddingGenerator } = await import("../lib/search/vector-builder");
  const seen: Array<Record<string, string>> = [];
  const realFetch = globalThis.fetch;
  const saved = { a: process.env.EMBEDDING_SERVICE_API_KEY, b: process.env.EMBEDDING_SERVICE_KEY };
  delete process.env.EMBEDDING_SERVICE_API_KEY;
  process.env.EMBEDDING_SERVICE_KEY = "legacy-key";
  globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
    seen.push(init?.headers as Record<string, string>);
    return new Response(JSON.stringify([[1, 0, 0]]), { status: 200 });
  }) as typeof fetch;
  try {
    await new TeiEmbeddingGenerator("http://x", 3).generateBatches(["a"]);
    assert.equal(seen[0].Authorization, "Bearer legacy-key");
  } finally {
    globalThis.fetch = realFetch;
    if (saved.a === undefined) delete process.env.EMBEDDING_SERVICE_API_KEY; else process.env.EMBEDDING_SERVICE_API_KEY = saved.a;
    if (saved.b === undefined) delete process.env.EMBEDDING_SERVICE_KEY; else process.env.EMBEDDING_SERVICE_KEY = saved.b;
  }
});
