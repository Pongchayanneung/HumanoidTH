import assert from "node:assert/strict";
import { test } from "node:test";
import { loadGraphRecordsFromFile } from "../lib/network-graph";

test("Graph file loader drops robots the checked manifest excludes and all submission records", async () => {
  const records = await loadGraphRecordsFromFile();
  assert.ok(records.length > 0, "graph must still load public records");
  const names = records.filter((r) => r.category === "robot_model").map((r) => (r.canonical_name || "").toLowerCase());
  assert.ok(!names.some((n) => n.includes("bumi")), "excluded robot Bumi must not reach the graph");
  assert.ok(!records.some((r) => r.category === "submission_record" || r.category === "source_pull_job"));
});
