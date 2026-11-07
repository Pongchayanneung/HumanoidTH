import test from "node:test";
import assert from "node:assert/strict";
import { createDatabaseSearchService } from "../lib/search/database-service";

const request = (query: string) => new Request("http://localhost/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) });

test("database serving rechecks current eligibility and fails closed on database errors", async () => {
  const record = { id: "fixture", relevanceStatus: "ACCEPTED", title: "Robot fixture", excerpt: "Robot evidence", url: "https://example.test/robot", platform: "web" };
  let current: typeof record | null = record;
  let fail = false;
  const empty = { findMany: async () => [] };
  const db = {
    sourceRecord: { findMany: async ({ cursor }: { cursor?: unknown }) => cursor ? [] : [record], findUnique: async () => { if (fail) throw Error("private database failure"); return current; } },
    robotModel: empty, contribution: empty, perspectiveAnnotation: empty, ownedInventory: empty, triplet: empty, entity: empty,
  };
  const handler = createDatabaseSearchService(async () => db);
  for (const query of ["robot", ""]) {
    const response = await handler(request(query));
    assert.equal(response.status, 200); assert.equal((await response.json()).groups[0].results[0].title, record.title);
    for (const changed of [null, { ...record, relevanceStatus: "REJECTED" }, { ...record, title: "Changed" }]) {
      current = changed;
      const stale = await handler(request(query));
      assert.equal(stale.status, 200); assert.deepEqual((await stale.json()).groups, []);
    }
    current = record;
  }
  fail = true;
  const failed = await handler(request("robot"));
  const body = await failed.json();
  assert.equal(failed.status, 503); assert.equal(body.mode, "unavailable"); assert.deepEqual(body.groups, []); assert.doesNotMatch(JSON.stringify(body), /Robot fixture|private/);
});
