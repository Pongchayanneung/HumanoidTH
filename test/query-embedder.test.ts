import test from "node:test";
import assert from "node:assert/strict";
import { createQueryEmbedder, formatQueryForEmbedding } from "../lib/search/query-embedder";
import { MOCK_MODEL_PROFILE, type ModelProfile } from "../lib/search/vector-types";

const profile: ModelProfile = { ...MOCK_MODEL_PROFILE, dimensions: 4, queryInstructionTask: "Find robots." };

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return handler(String(url), init ?? {});
  }) as typeof fetch;
  return { impl, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("formatQueryForEmbedding uses the Qwen3 instruction format and prefixes queries only", () => {
  assert.equal(formatQueryForEmbedding(profile, "hello"), "Instruct: Find robots.\nQuery:hello");
});

test("tei protocol: query embedder sends the prefixed query with a bearer key and returns a unit vector", async () => {
  const { impl, calls } = fakeFetch(() => json([[3, 0, 4, 0]]));
  const embed = createQueryEmbedder({ endpoint: "http://127.0.0.1:8080/", apiKey: "secret-key", protocol: "tei", profile, fetchImpl: impl });
  const vector = await embed("หุ่นยนต์");
  assert.ok(vector);
  assert.equal(vector.length, 4);
  assert.ok(Math.abs(Math.hypot(...vector) - 1) < 1e-6);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:8080/embed");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer secret-key");
  const body = JSON.parse(String(calls[0].init.body));
  assert.deepEqual(body.inputs, ["Instruct: Find robots.\nQuery:หุ่นยนต์"]);
  assert.equal(body.normalize, true);
});

test("tei protocol: query embedder omits Authorization when no key is configured", async () => {
  const { impl, calls } = fakeFetch(() => json([[1, 0, 0, 0]]));
  await createQueryEmbedder({ endpoint: "http://x", protocol: "tei", profile, fetchImpl: impl })("q");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, undefined);
});

test("tei protocol: query embedder returns null with a short reason for every failure and never throws", async () => {
  const reasons: string[] = [];
  const run = (handler: () => Response | Promise<Response>) =>
    createQueryEmbedder({ endpoint: "http://x", apiKey: "secret-key", protocol: "tei", profile, fetchImpl: fakeFetch(handler).impl, onFailure: (r) => reasons.push(r) })("secret query text");
  assert.equal(await run(() => json({ error: "no" }, 401)), null);
  assert.equal(await run(() => json([[1, 2, 3]])), null); // wrong dimension: never padded or truncated
  assert.equal(await run(() => json([[0, 0, 0, 0]])), null); // zero vector
  assert.equal(await run(() => json({ not: "an array" })), null);
  assert.equal(await run(() => new Response("not json", { status: 200 })), null);
  assert.equal(await run(() => { throw new Error("connection refused: secret-key secret query text"); }), null);
  assert.deepEqual(reasons, ["http", "dimension", "value", "shape", "shape", "network"]);
  for (const reason of reasons) assert.ok(!reason.includes("secret"));
});

test("query embedder passes the abort signal through", async () => {
  let seen: AbortSignal | null | undefined;
  const { impl } = fakeFetch((_url, init) => { seen = init.signal; return json([[1, 0, 0, 0]]); });
  const controller = new AbortController();
  await createQueryEmbedder({ endpoint: "http://x", protocol: "tei", profile, fetchImpl: impl })("q", controller.signal);
  assert.equal(seen, controller.signal);
});

// ---- proxy protocol (the authenticated GPU proxy) ----

test("proxy protocol sends kind=query with no client-side prefix and reads .vectors[0]", async () => {
  const { impl, calls } = fakeFetch(() => json({ dim: 4, count: 1, vectors: [[3, 0, 4, 0]] }));
  const embed = createQueryEmbedder({ endpoint: "https://proxy.example/", apiKey: "secret-key", protocol: "proxy", profile, fetchImpl: impl });
  const vector = await embed("หุ่นยนต์");
  assert.ok(vector);
  assert.equal(vector.length, 4);
  assert.ok(Math.abs(Math.hypot(...vector) - 1) < 1e-6);
  assert.equal(calls[0].url, "https://proxy.example/embed");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer secret-key");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { inputs: ["หุ่นยนต์"], kind: "query" });
});

test("protocol defaults to proxy when omitted", async () => {
  const { impl, calls } = fakeFetch(() => json({ vectors: [[1, 0, 0, 0]] }));
  assert.ok(await createQueryEmbedder({ endpoint: "http://x", profile, fetchImpl: impl })("q"));
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { inputs: ["q"], kind: "query" });
});

test("proxy protocol returns null with a short reason for every failure, so search falls back to keywords", async () => {
  const reasons: string[] = [];
  const run = (handler: () => Response | Promise<Response>) =>
    createQueryEmbedder({ endpoint: "http://x", apiKey: "secret-key", protocol: "proxy", profile, fetchImpl: fakeFetch(handler).impl, onFailure: (r) => reasons.push(r) })("secret query text");
  assert.equal(await run(() => json({ error: "unauthorized" }, 401)), null);
  assert.equal(await run(() => json({ error: "rate limit" }, 429)), null);
  assert.equal(await run(() => json({ vectors: [[1, 2, 3]] })), null); // wrong dimension
  assert.equal(await run(() => json({ vectors: [[0, 0, 0, 0]] })), null); // zero vector
  assert.equal(await run(() => json({ vectors: [] })), null); // no vector
  assert.equal(await run(() => json({ vectors: [[1, 0, 0, 0], [0, 1, 0, 0]] })), null); // more than asked for
  assert.equal(await run(() => json([[1, 0, 0, 0]])), null); // bare TEI shape is not a proxy answer
  assert.equal(await run(() => json(null)), null);
  assert.equal(await run(() => json({ vectors: [["1", "0", "0", "0"]] })), null); // strings are not numbers
  assert.equal(await run(() => json({ error: "busy" }, 503)), null);
  assert.equal(await run(() => new Response("not json", { status: 200 })), null);
  assert.equal(await run(() => { throw new Error("connection refused: secret-key secret query text"); }), null);
  assert.deepEqual(reasons, ["http", "http", "dimension", "value", "shape", "shape", "shape", "shape", "value", "http", "shape", "network"]);
  for (const reason of reasons) assert.ok(!reason.includes("secret"));
});

test("proxy protocol skips the call for empty or over-long queries, and an abort yields null", async () => {
  const { impl, calls } = fakeFetch(() => json({ vectors: [[1, 0, 0, 0]] }));
  const embed = createQueryEmbedder({ endpoint: "http://x", protocol: "proxy", profile, fetchImpl: impl });
  assert.equal(await embed(""), null);
  assert.equal(await embed("x".repeat(4001)), null);
  assert.ok(await embed("x".repeat(4000)));
  assert.equal(calls.length, 1);
  const aborting = createQueryEmbedder({ endpoint: "http://x", protocol: "proxy", profile, fetchImpl: (async () => { throw new DOMException("aborted", "AbortError"); }) as typeof fetch });
  assert.equal(await aborting("q"), null);
});

test("an omitted apiKey sends no Authorization even when the process env has a key", async () => {
  const saved = process.env.EMBEDDING_SERVICE_API_KEY;
  process.env.EMBEDDING_SERVICE_API_KEY = "ambient-key";
  try {
    const { impl, calls } = fakeFetch(() => json({ vectors: [[1, 0, 0, 0]] }));
    await createQueryEmbedder({ endpoint: "http://x", profile, fetchImpl: impl })("q");
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, undefined);
  } finally {
    if (saved === undefined) delete process.env.EMBEDDING_SERVICE_API_KEY; else process.env.EMBEDDING_SERVICE_API_KEY = saved;
  }
});
