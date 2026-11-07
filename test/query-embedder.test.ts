import test from "node:test";
import assert from "node:assert/strict";
import { createTeiQueryEmbedder, formatQueryForEmbedding } from "../lib/search/query-embedder";
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

test("query embedder sends the prefixed query with a bearer key and returns a unit vector", async () => {
  const { impl, calls } = fakeFetch(() => json([[3, 0, 4, 0]]));
  const embed = createTeiQueryEmbedder({ endpoint: "http://127.0.0.1:8080/", apiKey: "secret-key", profile, fetchImpl: impl });
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

test("query embedder omits Authorization when no key is configured", async () => {
  const { impl, calls } = fakeFetch(() => json([[1, 0, 0, 0]]));
  await createTeiQueryEmbedder({ endpoint: "http://x", profile, fetchImpl: impl })("q");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, undefined);
});

test("query embedder returns null with a short reason for every failure and never throws", async () => {
  const reasons: string[] = [];
  const run = (handler: () => Response | Promise<Response>) =>
    createTeiQueryEmbedder({ endpoint: "http://x", apiKey: "secret-key", profile, fetchImpl: fakeFetch(handler).impl, onFailure: (r) => reasons.push(r) })("secret query text");
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
  await createTeiQueryEmbedder({ endpoint: "http://x", profile, fetchImpl: impl })("q", controller.signal);
  assert.equal(seen, controller.signal);
});
