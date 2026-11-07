import assert from "node:assert/strict";
import { test } from "node:test";
import { PrismaClient } from "../generated/prisma";
import type { CmsCollection } from "../lib/admin-inspection/contracts";
import { businessSnapshot, createAcceptanceDatabase } from "../test-integration/fixture";

const fixtures = [
  {
    collection: "source-records",
    table: "SourceRecord",
    columns: '"sourceType", "title", "excerpt", "relevanceStatus", "url", "rawMeta", "relevanceReason"',
    values: `'SEED', 'Source ' || n, 'Source excerpt', 'UNCERTAIN', 'https://source.example.invalid/' || n,
      '{"private":"excluded source metadata"}'::jsonb, 'excluded source reason'`,
    select: ["title", "excerpt", "relevanceStatus", "url"],
    record: { displayName: "Source 1", summary: "Source excerpt", status: "UNCERTAIN", url: "https://source.example.invalid/1" }
  },
  {
    collection: "robot-models",
    table: "RobotModel",
    columns: '"canonicalName", "description", "officialUrl", "sourceMeta"',
    values: `'Robot ' || n, NULL, NULL, '{"private":"excluded robot metadata"}'::jsonb`,
    select: ["canonicalName", "description", "officialUrl"],
    record: { displayName: "Robot 1", summary: null, status: null, url: null }
  },
  {
    collection: "contributions",
    table: "Contribution",
    columns: '"title", "contributionType", "description", "verificationStatus", "sourceUrl", "contributorName", "visibility"',
    values: `'Contribution ' || n, 'study', 'Contribution summary', 'NEEDS_REVIEW',
      'javascript:synthetic' || n, 'excluded contributor name', 'private'`,
    select: ["title", "description", "verificationStatus", "sourceUrl"],
    record: { displayName: "Contribution 1", summary: "Contribution summary", status: "NEEDS_REVIEW", url: "javascript:synthetic1" }
  },
  {
    collection: "submitted-data",
    table: "SubmittedData",
    columns: '"title", "submissionType", "status", "url", "payloadJson", "submitterName", "submitterContact", "notes", "reviewNotes"',
    values: `'Submission ' || n, 'paper', 'QUEUED', NULL, '{"private":"excluded payload"}'::jsonb,
      'excluded submitter name', 'excluded submitter contact', 'excluded submission note', 'excluded review note'`,
    select: ["title", "submissionType", "status", "url"],
    record: { displayName: "Submission 1", summary: "paper", status: "QUEUED", url: null }
  }
] as const;

test("PostgreSQL reads the exact oldest ID in each collection using only the approved columns", {
  skip: process.env.ISSUE4_AUTH_ACCEPTANCE !== "1"
}, async () => {
  const { createPostgresInspectionRepository } = await import("../lib/admin-inspection/postgres-repository");
  const fixture = await createAcceptanceDatabase();
  const prisma = new PrismaClient({ datasourceUrl: fixture.url, log: [{ emit: "event", level: "query" }] });
  const queries: { query: string; params: string }[] = [];
  prisma.$on("query", event => { queries.push(event); });
  const oldestId = "  Legacy-ก-🤖  ";
  try {
    for (const { collection, table, columns, values } of fixtures) {
      await fixture.sql.query(`
        INSERT INTO "${table}" ("id", "createdAt", "updatedAt", ${columns})
        SELECT CASE WHEN n = 1 THEN $1 ELSE $2 || '-' || n END,
          timestamp '2025-01-01' + (n - 1) * interval '1 second',
          timestamp '2025-01-02' + (n - 1) * interval '1 second', ${values}
        FROM generate_series(1, 102) AS series(n)
      `, [oldestId, collection]);
      assert.equal((await fixture.sql.query(`DELETE FROM "${table}" WHERE "id" = $1`, [`${collection}-102`])).rowCount, 1);
      const count = await fixture.sql.query<{ count: number }>(`SELECT count(*)::int AS count FROM "${table}"`);
      assert.equal(count.rows[0].count, 101);
    }
    const before = await businessSnapshot(fixture.sql);
    const repository = createPostgresInspectionRepository(prisma);

    async function findExact(collection: CmsCollection, id: string) {
      const lastQueryCount = queries.length;
      const result = await repository.findExact(collection, id);
      assert.equal(queries.length, lastQueryCount + 1, "exact lookup issues one database query");
      const { query, params } = queries[lastQueryCount];
      const { table, select } = fixtures.find(item => item.collection === collection)!;
      const projectedFields = [...query.split(" FROM ")[0].matchAll(/"[^"]+"\."[^"]+"\."([^"]+)"/g)].map(match => match[1]);
      assert.deepEqual(projectedFields.sort(), ["id", "createdAt", "updatedAt", ...select].sort());
      assert.match(query, new RegExp(` FROM "public"\\."${table}" WHERE `));
      assert.match(query, /"id"\s*=\s*\$1/);
      assert.equal(JSON.parse(params)[0], id);
      return result;
    }

    for (const [index, { collection, record }] of fixtures.entries()) {
      assert.deepEqual(await findExact(collection, oldestId), {
        collection,
        id: oldestId,
        ...record,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-02T00:00:00.000Z"
      });
      const otherCollection = fixtures[(index + 1) % fixtures.length].collection;
      assert.equal(await findExact(collection, `${otherCollection}-2`), null);
      assert.equal(await findExact(collection, `${collection}-102`), null);
      assert.equal(await findExact(collection, "never-created"), null);
      assert.equal(await findExact(collection, oldestId.trim()), null);
      assert.equal(await findExact(collection, oldestId.replace("Legacy", "legacy")), null);
    }

    assert.equal(await businessSnapshot(fixture.sql), before);
  } finally {
    await Promise.all([prisma.$disconnect(), fixture.sql.end()]);
  }
});
