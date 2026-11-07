import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { saveSources } from "../lib/ingest/save";
import { computeAssertionsHash, verifySnapshotIntegrity } from "../lib/claim-versioning";

test("reingestion retains history and hashes the surviving assertions", async () => {
  const original = prisma.$transaction;
  const geo = { geo: { latitude: 1, longitude: 1 } };
  let source: any = { id: "s1", sourceType: "OPENALEX", title: "Old", url: "https://example.org/item", excerpt: "Old text", author: null, platform: null, publishedAt: null, relevanceStatus: "ACCEPTED", relevanceReason: "review", relevanceConfidence: 1, createdAt: new Date(), updatedAt: new Date(), rawMeta: { _versioning: { version: 1, history: [{ version: 1, reason: "review" }] } } };
  let annotations: any[] = [{ id: "old", sourceId: "s1", method: "rules_with_evidence", perspectiveTheme: "old", targetEntity: "old", evidenceExcerpt: "old", stance: "supportive", sentiment: "positive", confidence: 1 }, { id: "human", sourceId: "s1", method: "human_review", perspectiveTheme: "human", targetEntity: "x", evidenceExcerpt: "e", stance: "supportive", sentiment: "positive", confidence: 1 }];
  let triplets: any[] = [{ id: "old-triplet", sourceId: "s1", subject: "old", relation: "old", object: "old", confidence: 1 }];
  const withClaims = () => ({ ...source, annotations: [...annotations], triplets: [...triplets] });
  const tx: any = { $queryRaw: async () => [], sourceRecord: {
    findUnique: async () => withClaims(),
    upsert: async ({ update }: any) => (source = { ...source, ...update }),
    findUniqueOrThrow: async () => withClaims(),
    update: async ({ data }: any) => (source = { ...source, ...data })
  }, perspectiveAnnotation: {
    deleteMany: async ({ where }: any) => { annotations = annotations.filter((a) => !where.method.in.includes(a.method)); },
    upsert: async ({ create }: any) => { annotations.push({ ...create, id: "new" }); }
  }, triplet: { deleteMany: async () => { triplets = []; }, upsert: async () => {} } };
  (prisma as any).$transaction = async (fn: any) => fn(tx);
  try {
    await saveSources([{ sourceType: "OPENALEX", title: "Home - English - Dinsaw Robot", url: source.url, excerpt: "Dinsaw Robot is an artificial intelligence or AI that can listen and respond to gestures or spoken words, developed by CT Asia Robotics in Thailand.", publishedAt: new Date("2024-01-01"), rawMeta: { networkGeo: geo } }]);
    const history = source.rawMeta._versioning.history;
    assert.equal(history.length, 2);
    assert.equal(history[0].snapshot.source.title, "Old");
    assert.equal(history[0].snapshot.assertions.triplets[0].id, "old-triplet");
    assert.equal(source.relevanceStatus, "ACCEPTED");
    assert.ok(annotations.every((a) => a.id !== "old"));
    assert.ok(annotations.some((a) => a.id === "human"));
    assert.deepEqual(triplets, []);
    assert.equal(source.rawMeta._versioning.assertionsHash, computeAssertionsHash(annotations, triplets));
    assert.ok(history.every((entry: any) => verifySnapshotIntegrity(entry.snapshot).isValid));
  } finally { (prisma as any).$transaction = original; }
});
