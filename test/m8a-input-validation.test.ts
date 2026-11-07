import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { NextRequest } from "next/server";
import {
  MAX_FILTER_LENGTH,
  readBoundedTextParam,
  truncateParam,
  validateContributionFilters
} from "../lib/contribution-filters";
import { parseNetworkGraphQuery, parseNetworkId, parseNetworkSource } from "../lib/network-query";
import { getTranslation, parseLanguage, translations } from "../lib/translations";
import { GET as graphGet } from "../app/api/network/graph/route";
import { GET as nodeGet } from "../app/api/network/node/[node_id]/route";
import { GET as edgeGet } from "../app/api/network/edge/[edge_id]/route";

const query = (qs: string) => parseNetworkGraphQuery(new URLSearchParams(qs));
const graphRequest = (qs: string) => new NextRequest(`http://localhost:3000/api/network/graph?${qs}`);
const idRequest = (path: string, qs = "") => new Request(`http://localhost:3000/api/network/${path}?${qs}`);

// The file exists but is not valid JSON, so the raw parser error (which quotes file content and
// can carry paths) is what a route would leak if it echoed `error.message`.
async function withBrokenGraphFile<T>(run: () => Promise<T>): Promise<T> {
  const original = process.env.NETWORK_GRAPH_IMPORT_FILE_PATH;
  const originalError = console.error;
  const dir = mkdtempSync(join(tmpdir(), "m8a-"));
  const file = join(dir, "internal-leak-marker.json");
  writeFileSync(file, "{ internal-leak-marker: not json");
  process.env.NETWORK_GRAPH_IMPORT_FILE_PATH = file;
  console.error = () => {};
  try {
    return await run();
  } finally {
    rmSync(dir, { recursive: true, force: true });
    console.error = originalError;
    if (original === undefined) delete process.env.NETWORK_GRAPH_IMPORT_FILE_PATH;
    else process.env.NETWORK_GRAPH_IMPORT_FILE_PATH = original;
  }
}

test("network graph query: defaults and documented bounds", () => {
  const defaults = query("");
  assert.ok(defaults.ok);
  assert.equal(defaults.value.maxNodes, 300);
  assert.equal(defaults.value.maxEdges, 800);
  assert.equal(defaults.value.minConfidence, null);
  assert.equal(defaults.value.sourceMode, undefined);

  const clampedLow = query("limitNodes=0&limitEdges=1");
  assert.ok(clampedLow.ok);
  assert.equal(clampedLow.value.maxNodes, 25);
  assert.equal(clampedLow.value.maxEdges, 50);
  const clampedHigh = query("limitNodes=999999&limitEdges=999999");
  assert.ok(clampedHigh.ok);
  assert.equal(clampedHigh.value.maxNodes, 1000);
  assert.equal(clampedHigh.value.maxEdges, 2500);

  const legacy = query("maxNodes=40&maxEdges=60&minConfidence=0.5&includeLowConfidence=false&source=hybrid");
  assert.ok(legacy.ok);
  assert.deepEqual([legacy.value.maxNodes, legacy.value.maxEdges, legacy.value.minConfidence, legacy.value.includeLowConfidence, legacy.value.sourceMode], [40, 60, 0.5, false, "hybrid"]);
});

test("network graph query: NaN, negative, fractional, empty, repeated and unknown values are rejected by name", () => {
  const cases: Array<[string, string]> = [
    ["limitNodes=abc", "limitNodes"],
    ["limitNodes=-5", "limitNodes"],
    ["limitNodes=1.5", "limitNodes"],
    ["limitNodes=", "limitNodes"],
    ["limitNodes=NaN", "limitNodes"],
    ["limitNodes=Infinity", "limitNodes"],
    ["limitNodes=1e3", "limitNodes"],
    ["limitNodes=30&limitNodes=40", "limitNodes"],
    ["maxEdges=99999999999", "maxEdges"],
    ["limitEdges=%00", "limitEdges"],
    ["limitNodes=30&maxNodes=abc", "maxNodes"],
    ["limitNodes=30&maxNodes=500", "maxNodes"],
    ["limitEdges=60&maxEdges=70", "maxEdges"],
    ["minConfidence=abc", "minConfidence"],
    ["minConfidence=-0.1", "minConfidence"],
    ["minConfidence=1.5", "minConfidence"],
    ["minConfidence=NaN", "minConfidence"],
    ["minConfidence=", "minConfidence"],
    ["minConfidence=0.5&minConfidence=0.6", "minConfidence"],
    ["includeLowConfidence=yes", "includeLowConfidence"],
    ["includeLowConfidence=TRUE", "includeLowConfidence"],
    ["source=bogus", "source"],
    ["source=FILE", "source"],
    ["source=file&source=database", "source"],
    ["cluster=" + "x".repeat(101), "cluster"],
    ["nodeType=%00", "nodeType"],
    ["relation=%20", "relation"],
    ["relation=a&relation=b", "relation"]
  ];
  for (const [qs, param] of cases) {
    const result = query(qs);
    assert.equal(result.ok, false, qs);
    if (!result.ok) assert.equal(result.param, param, qs);
  }
});

test("network ids and source mode: literal escapes pass through, control chars, oversize ids and unknown sources are rejected", () => {
  assert.equal(parseNetworkId("node:one"), "node:one");
  assert.equal(parseNetworkId("node%3Aone"), "node%3Aone");
  assert.equal(parseNetworkId("%E0%A4%A"), "%E0%A4%A");
  assert.equal(parseNetworkId(""), null);
  assert.equal(parseNetworkId("a".repeat(257)), null);
  assert.equal(parseNetworkId("a\u0000b"), null);
  const bad = parseNetworkSource(new URLSearchParams("source=evil"));
  assert.equal(bad.ok, false);
});

test("graph route returns 400 for invalid parameters", async () => {
  for (const qs of ["source=bogus", "limitNodes=-1", "limitNodes=abc", "minConfidence=2", "includeLowConfidence=maybe"]) {
    const res = await graphGet(graphRequest(qs));
    assert.equal(res.status, 400, qs);
    assert.deepEqual(await res.json(), { error: `Invalid request parameter: ${qs.split("=")[0]}` });
  }
});

test("graph route serves a valid bounded request", async () => {
  const res = await graphGet(graphRequest("source=file&limitNodes=25&limitEdges=50"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.nodes.length <= 25);
  assert.ok(body.edges.length <= 50);
  assert.equal(body.meta.source_mode, "file");
});

test("graph, node and edge routes report failures as a generic 503 without paths or system text", async () => {
  await withBrokenGraphFile(async () => {
    const responses = [
      await graphGet(graphRequest("source=file")),
      await nodeGet(idRequest("node/x", "source=file"), { params: Promise.resolve({ node_id: "x" }) }),
      await edgeGet(idRequest("edge/x", "source=file"), { params: Promise.resolve({ edge_id: "x" }) })
    ];
    for (const res of responses) {
      assert.equal(res.status, 503);
      const text = await res.text();
      assert.doesNotMatch(text, /internal-leak-marker|m8a-|JSON|position|at \S+ \(/);
      assert.deepEqual(JSON.parse(text), { error: "Network graph is unavailable." });
    }
  });
});

test("node and edge routes validate ids and source, and malformed escapes are a client error rather than a crash", async () => {
  const nodeParams = (node_id: string) => ({ params: Promise.resolve({ node_id }) });
  const edgeParams = (edge_id: string) => ({ params: Promise.resolve({ edge_id }) });

  assert.equal((await nodeGet(idRequest("node/x", "source=bogus"), nodeParams("x"))).status, 400);
  assert.equal((await edgeGet(idRequest("edge/x", "source=bogus"), edgeParams("x"))).status, 400);
  assert.equal((await nodeGet(idRequest("node/x"), nodeParams("a".repeat(257)))).status, 400);
  assert.equal((await nodeGet(idRequest("node/x"), nodeParams("a\u0000b"))).status, 400);
  assert.equal((await edgeGet(idRequest("edge/x"), edgeParams(""))).status, 400);

  const malformedNode = await nodeGet(idRequest("node/x", "source=file"), nodeParams("%E0%A4%A"));
  assert.equal(malformedNode.status, 404);
  const malformedEdge = await edgeGet(idRequest("edge/x", "source=file"), edgeParams("%"));
  assert.equal(malformedEdge.status, 404);
});

test("node and edge routes pass literal percent-escaped ids (%3A) through unchanged and look them up as-is", async () => {
  const graph = await (await graphGet(graphRequest("source=file&limitNodes=1000&limitEdges=2500"))).json();
  const colonNode = graph.nodes.find((n: { id: string }) => n.id.includes(":"));
  assert.ok(colonNode, "expected a seed node with ':' in its id");

  const literalPercentNodeId = colonNode.id.replace(":", "%3A");
  assert.equal(parseNetworkId(literalPercentNodeId), literalPercentNodeId);

  const directNodeRes = await nodeGet(idRequest(`node/${encodeURIComponent(colonNode.id)}`, "source=file"), {
    params: Promise.resolve({ node_id: colonNode.id })
  });
  assert.equal(directNodeRes.status, 200);

  const literalNodeRes = await nodeGet(idRequest(`node/${encodeURIComponent(literalPercentNodeId)}`, "source=file"), {
    params: Promise.resolve({ node_id: literalPercentNodeId })
  });
  assert.equal(literalNodeRes.status, 404);

  const colonEdge = graph.edges.find((e: { id: string }) => e.id.includes(":"));
  assert.ok(colonEdge, "expected a seed edge with ':' in its id");
  const literalPercentEdgeId = colonEdge.id.replace(":", "%3A");
  assert.equal(parseNetworkId(literalPercentEdgeId), literalPercentEdgeId);
  assert.equal(
    (await edgeGet(idRequest(`edge/${encodeURIComponent(colonEdge.id)}`, "source=file"), {
      params: Promise.resolve({ edge_id: colonEdge.id })
    })).status,
    200
  );
  assert.equal(
    (await edgeGet(idRequest(`edge/${encodeURIComponent(literalPercentEdgeId)}`, "source=file"), {
      params: Promise.resolve({ edge_id: literalPercentEdgeId })
    })).status,
    404
  );
});

test("language cookie cannot reach prototype members of the translation dictionary", () => {
  for (const hostile of ["constructor", "__proto__", "toString", "hasOwnProperty", "fr", "TH", "", undefined, null]) {
    assert.equal(parseLanguage(hostile), "en", String(hostile));
  }
  assert.equal(parseLanguage("th"), "th");
  for (const hostile of ["constructor", "__proto__", "toString"]) {
    assert.equal(getTranslation(hostile as "en"), translations.en, hostile);
  }
});

test("contribution filters: oversized or control-character text is flagged and never echoed, bounded text passes", () => {
  const long = "x".repeat(MAX_FILTER_LENGTH + 1);
  for (const field of ["q", "org", "robot"] as const) {
    assert.ok(validateContributionFilters({ [field]: long }).filterError, `${field} too long`);
    assert.ok(validateContributionFilters({ [field]: "a\u0000b" }).filterError, `${field} NUL`);
    const trailingNewline = validateContributionFilters({ [field]: "robot\n" });
    assert.ok(trailingNewline.filterError, `${field} trailing newline`);
    assert.equal(trailingNewline[field], undefined);
    assert.ok(validateContributionFilters({ [field]: "\trobot" }).filterError, `${field} leading tab`);
    assert.ok(validateContributionFilters({ [field]: ["ok", long] }).filterError === null, `${field} repeated keeps only the first value`);
    assert.ok(validateContributionFilters({ [field]: "x".repeat(MAX_FILTER_LENGTH) }, "th").filterError === null, `${field} at the limit`);
  }
  assert.match(validateContributionFilters({ q: long }, "th").filterError ?? "", /ตัวอักษร/);
  assert.deepEqual(readBoundedTextParam(["  robot  ", "ignored"]), { value: "robot", invalid: false });
  assert.deepEqual(readBoundedTextParam(undefined), { invalid: false });
  assert.equal(readBoundedTextParam("robot\n").invalid, true);
  assert.equal(readBoundedTextParam("\trobot").invalid, true);
  assert.equal(readBoundedTextParam("\ud800").invalid, true);
  assert.equal(readBoundedTextParam(" \ud800 ").invalid, true);
});

test("auto source with no database and no seed file is a 503 on graph, node and edge, never 200 or 404", async () => {
  const keys = ["NETWORK_GRAPH_IMPORT_FILE_PATH", "NETWORK_GRAPH_SOURCE", "DATABASE_URL"] as const;
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalError = console.error;
  process.env.NETWORK_GRAPH_IMPORT_FILE_PATH = join(tmpdir(), "m8a-missing", "absent.json");
  process.env.DATABASE_URL = "postgresql://x:y@127.0.0.1:1/x";
  delete process.env.NETWORK_GRAPH_SOURCE;
  console.error = () => {};
  try {
    for (const res of [
      await graphGet(graphRequest("")),
      await graphGet(graphRequest("source=auto")),
      await nodeGet(idRequest("node/x"), { params: Promise.resolve({ node_id: "x" }) }),
      await edgeGet(idRequest("edge/x"), { params: Promise.resolve({ edge_id: "x" }) })
    ]) {
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { error: "Network graph is unavailable." });
    }
  } finally {
    console.error = originalError;
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test("contribution filters never echo rejected free text and truncation keeps surrogate pairs whole", () => {
  const rejected = validateContributionFilters({ q: "x".repeat(300), org: "a\u0000b", robot: "ok" });
  assert.ok(rejected.filterError);
  assert.equal(rejected.q, undefined);
  assert.equal(rejected.org, undefined);
  assert.equal(rejected.robot, "ok");

  // 39 ASCII chars + surrogate-pair emoji as the 40th code point (UTF-16 units 39..40) + trailing char to force truncation.
  const boundaryInput = `${"a".repeat(39)}😀z`;
  const truncated = truncateParam(boundaryInput);
  assert.ok(truncated.endsWith("..."));
  const truncatedBody = truncated.slice(0, -3);
  assert.equal(Array.from(truncatedBody).length, 40);
  assert.equal(truncatedBody, `${"a".repeat(39)}😀`);
  assert.doesNotMatch(truncated, /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);

  const emoji = validateContributionFilters({ type: boundaryInput });
  assert.ok(emoji.filterError?.includes(`${"a".repeat(39)}😀...`));
  assert.doesNotMatch(emoji.filterError ?? "", /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
  assert.doesNotMatch(validateContributionFilters({ type: "bad\u0000type" }).filterError ?? "", /\u0000/);
});
