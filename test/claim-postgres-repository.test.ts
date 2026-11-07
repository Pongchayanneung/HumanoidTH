import test from "node:test";
import assert from "node:assert/strict";
import { PostgresClaimVersioningRepository } from "../lib/claim-versioning/postgres-repository";

test("postgres update locks the source and keeps assertion identifiers", async () => {
  const record = {
    id: "s1", sourceType: "test", title: "Title", url: "https://example.org", excerpt: "",
    publishedAt: null, author: null, platform: null, rawMeta: {}, relevanceConfidence: 1,
    relevanceReason: null, relevanceStatus: "ACCEPTED", createdAt: new Date(), updatedAt: new Date(),
    annotations: [{ id: "p1", confidence: 1, evidenceExcerpt: "e", method: "m", perspectiveTheme: "t", sentiment: "s", stance: "s", targetEntity: "x" }],
    triplets: [{ id: "t1", confidence: 1, subject: "a", relation: "b", object: "c" }]
  };
  const events: string[] = [];
  const ids: Array<string | undefined> = [];
  const preserved: unknown[] = [];
  const tx = {
    $queryRaw: async () => { events.push("lock"); },
    sourceRecord: { findUnique: async () => { events.push("read"); return record; }, update: async () => record },
    perspectiveAnnotation: { deleteMany: async ({ where }: any) => { preserved.push(where.id.notIn); return { count: 0 }; }, create: async ({ data }: any) => { ids.push(data.id); }, update: async ({ where }: any) => { ids.push(where.id); } },
    triplet: { deleteMany: async ({ where }: any) => { preserved.push(where.id.notIn); return { count: 0 }; }, create: async ({ data }: any) => { ids.push(data.id); }, update: async ({ where }: any) => { ids.push(where.id); } }
  };
  const repo = new PostgresClaimVersioningRepository({ $transaction: async (fn: any) => fn(tx) } as any);
  await repo.executeAtomicUpdate("s1", async (current) => ({
    updatedSource: { rawMeta: {} }, perspectivesToKeep: current.perspectives, tripletsToKeep: current.triplets
  }));
  assert.deepEqual(events, ["lock", "read"]);
  assert.deepEqual(ids, ["p1", "t1"]);
  assert.deepEqual(preserved, [["p1"], ["t1"]]);
});
