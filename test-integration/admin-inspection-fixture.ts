import assert from "node:assert/strict";
import { PrismaClient } from "../generated/prisma/index.js";
import { readOperatorConfig } from "../lib/operator-auth/config";
import { hashOperatorPassword } from "../lib/operator-auth/credentials";
import { createPostgresAuthStore } from "../lib/operator-auth/postgres-store";
import { createAcceptanceDatabase, operatorPassword, syntheticEnvironment, type SqlClient } from "./fixture";

export const inspectionOrigin = "http://localhost:3105";
export const oldestId = "  legacy-Case-ก-🤖  ";
export const createdAt = "2025-02-01T00:00:00.000Z";
export const updatedAt = "2025-02-02T00:00:00.000Z";
export const hostileText = '<img src="https://inspection-probe.invalid/pixel" onerror="globalThis.inspectionExecuted = true"><script>globalThis.inspectionExecuted = true</script>';
export const hostileUrl = "javascript:globalThis.inspectionExecuted=true";
export const excluded = {
  sourceMeta: "private-source-raw-inspection-sentinel",
  robotMeta: "private-robot-raw-inspection-sentinel",
  contributor: "private-contributor-inspection-sentinel",
  submissionJson: "private-submission-json-inspection-sentinel",
  submissionContact: "private-contact@inspection.invalid",
  submissionName: "private-submitter-inspection-sentinel",
  submissionNotes: "private-notes-inspection-sentinel"
};

export const collections = [
  {
    name: "source-records", table: "SourceRecord", title: "Inspection source 1", status: "UNCERTAIN",
    columns: '"sourceType", "title", "excerpt", "url", "rawMeta", "relevanceStatus"',
    values: "'SEED', 'Inspection source ' || n, 'Source excerpt', 'https://inspection-probe.invalid/source/' || n, jsonb_build_object('raw', $3::text), 'UNCERTAIN'",
    parameters: [excluded.sourceMeta]
  },
  {
    name: "robot-models", table: "RobotModel", title: "Inspection robot 1", status: "Not provided",
    columns: '"canonicalName", "description", "officialUrl", "sourceMeta"',
    values: "'Inspection robot ' || n, 'Robot description', 'https://inspection-probe.invalid/robot/' || n, jsonb_build_object('raw', $3::text)",
    parameters: [excluded.robotMeta]
  },
  {
    name: "contributions", table: "Contribution", title: "Inspection contribution 1", status: "NEEDS_REVIEW",
    columns: '"title", "contributionType", "description", "sourceUrl", "contributorName", "verificationStatus", "visibility"',
    values: "'Inspection contribution ' || n, 'paper', $3, CASE WHEN n = 1 THEN $4 ELSE NULL END, $5, 'NEEDS_REVIEW', 'private'",
    parameters: [hostileText, hostileUrl, excluded.contributor]
  },
  {
    name: "submitted-data", table: "SubmittedData", title: "Inspection submission 1", status: "QUEUED",
    columns: '"title", "submissionType", "status", "payloadJson", "submitterContact", "submitterName", "notes"',
    values: "'Inspection submission ' || n, 'paper', 'QUEUED', jsonb_build_object('raw', $3::text), $4, $5, $6",
    parameters: [excluded.submissionJson, excluded.submissionContact, excluded.submissionName, excluded.submissionNotes]
  }
] as const;

export function inspectionEnvironment(url: string, passwordHash: string, epoch?: string) {
  return { ...syntheticEnvironment(url, passwordHash, epoch), OPERATOR_APP_ORIGIN: inspectionOrigin };
}

async function seedInspectionRecords(sql: SqlClient) {
  for (const { name, table, columns, values, parameters } of collections) {
    await sql.query(`
      INSERT INTO "${table}" ("id", "createdAt", "updatedAt", ${columns})
      SELECT CASE WHEN n = 1 THEN $1 ELSE $2 || '-' || n END,
        timestamp '2025-02-01' + (n - 1) * interval '1 second',
        timestamp '2025-02-02' + (n - 1) * interval '1 second', ${values}
      FROM generate_series(1, 102) AS series(n)
    `, [oldestId, name, ...parameters]);
    assert.equal((await sql.query(`DELETE FROM "${table}" WHERE "id" = $1`, [`${name}-102`])).rowCount, 1);
    const count = await sql.query<{ count: number }>(`SELECT count(*)::int AS count FROM "${table}"`);
    assert.equal(count.rows[0].count, 101);
  }
}

export async function createInspectionFixture(name?: string, productionOrigin?: string) {
  const fixture = await createAcceptanceDatabase(name);
  const prisma = new PrismaClient({ datasourceUrl: fixture.url, log: [] });
  try {
    const synthetic = inspectionEnvironment(fixture.url, await hashOperatorPassword(operatorPassword));
    const environment = productionOrigin
      ? { ...synthetic, NODE_ENV: "production" as const, OPERATOR_APP_ORIGIN: productionOrigin }
      : synthetic;
    const config = readOperatorConfig(environment);
    assert.ok(config, "Synthetic inspection config must be valid");
    assert.equal(await createPostgresAuthStore(prisma).initialize(config), true);
    await seedInspectionRecords(fixture.sql);
    return { ...fixture, environment };
  } catch (error) {
    await fixture.sql.end();
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}
