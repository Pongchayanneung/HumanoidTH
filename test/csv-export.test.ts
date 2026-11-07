import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  isAllowedTable,
  normalizeTableName,
  escapeCsvValue,
  generateCsv,
  TABLE_COLUMNS,
  ALLOWED_TABLES,
  buildExportPrismaQuery,
  MAX_EXPORT_ROWS
} from "../lib/csv-export";
import { GET as exportRoute } from "../app/api/export/route";

test("S3 Table Validation: validates allowed tables, normalizes names, and rejects unknown ones", () => {
  // Allowed tables
  assert.equal(isAllowedTable("sources"), true);
  assert.equal(isAllowedTable("robots"), true);
  assert.equal(isAllowedTable("contributions"), true);
  assert.equal(isAllowedTable("inventory"), true);
  assert.equal(isAllowedTable("owned_inventory"), true);
  assert.equal(isAllowedTable("submissions"), true);
  assert.equal(isAllowedTable("perspective_annotations"), true);
  assert.equal(isAllowedTable("pull_jobs"), true);

  // Normalization: case-insensitive, whitespace, aliases
  assert.equal(normalizeTableName("ROBOTS"), "robots");
  assert.equal(normalizeTableName("  sources  "), "sources");
  assert.equal(normalizeTableName("owned_inventory"), "inventory");
  assert.equal(normalizeTableName("perspectives"), "perspective_annotations");

  // Rejected / unknown tables
  assert.equal(isAllowedTable("users"), false);
  assert.equal(isAllowedTable("passwords"), false);
  assert.equal(isAllowedTable("accounts"), false);
  assert.equal(isAllowedTable(""), false);
  assert.equal(isAllowedTable(null), false);
  assert.equal(isAllowedTable(undefined), false);
  assert.equal(normalizeTableName("users"), null);
});

test("S3 Formula Injection Neutralization: neutralizes formula trigger characters", () => {
  // 1. Equal sign (=)
  const eqVal = escapeCsvValue("=1+1");
  assert.ok(eqVal.startsWith(`"'=1+1"`), "Must prefix formula with single quote and wrap in quotes");

  // 2. Plus sign (+)
  const plusVal = escapeCsvValue("+cmd|' /C calc'!A0");
  assert.ok(plusVal.startsWith(`"'+cmd`));

  // 3. Minus sign (-)
  const minusVal = escapeCsvValue("-2+3");
  assert.ok(minusVal.startsWith(`"'-2+3"`));

  // 4. At sign (@)
  const atVal = escapeCsvValue("@SUM(A1:A10)");
  assert.ok(atVal.startsWith(`"'@SUM`));

  // 5. Tab character (\t)
  const tabVal = escapeCsvValue("\tDDE");
  assert.ok(tabVal.startsWith(`"'\tDDE"`));

  // 6. Carriage return (\r)
  const crVal = escapeCsvValue("\rpayload");
  assert.ok(crVal.startsWith(`"'\rpayload"`));

  // 7. Pipe (|)
  const pipeVal = escapeCsvValue("|command");
  assert.ok(pipeVal.startsWith(`"'|command"`));

  // 8. Percent (%)
  const pctVal = escapeCsvValue("%0a");
  assert.ok(pctVal.startsWith(`"'%0a"`));

  // 9. Standard safe strings without formula characters
  assert.equal(escapeCsvValue("Dinsaw Robot"), "Dinsaw Robot");
  assert.equal(escapeCsvValue("หุ่นยนต์ดินสอ"), "หุ่นยนต์ดินสอ");

  // 10. Commas and quotes escaping
  assert.equal(escapeCsvValue('Hello, "World"'), '"Hello, ""World"""');

  // 11. Null / undefined
  assert.equal(escapeCsvValue(null), "");
  assert.equal(escapeCsvValue(undefined), "");

  // 12. Date formatting
  const d = new Date("2026-11-07T08:00:00.000Z");
  assert.equal(escapeCsvValue(d), "2026-11-07T08:00:00.000Z");
});

test("S3 CSV Generation: empty tables return headers only instead of bogus rows or plaintext", () => {
  const headers = ["id", "title", "excerpt"];

  // 1. Empty rows
  const emptyCsv = generateCsv(headers, []);
  assert.equal(emptyCsv, "id,title,excerpt\r\n");
  assert.equal(emptyCsv.includes("No data available"), false);
  assert.equal(emptyCsv.includes("empty"), false);

  // 2. Populated rows
  const rows = [
    { id: "1", title: "Dinsaw", excerpt: "Healthcare robot" },
    { id: "2", title: "Mirror", excerpt: 'Telepresence, "COVID-19"' }
  ];
  const populatedCsv = generateCsv(headers, rows);
  assert.ok(populatedCsv.startsWith("id,title,excerpt\r\n"));
  assert.ok(populatedCsv.includes("1,Dinsaw,Healthcare robot"));
  assert.ok(populatedCsv.includes('2,Mirror,"Telepresence, ""COVID-19"""'));
});

test("S3 Privacy & Column Allowlist: excludes sensitive hardware, notes, and submitter contacts", () => {
  // 1. Inventory must NOT leak serialNumber, custodian, locationLabel, notes
  const inventoryCols = TABLE_COLUMNS.inventory;
  assert.equal(inventoryCols.includes("serialNumber"), false);
  assert.equal(inventoryCols.includes("custodian"), false);
  assert.equal(inventoryCols.includes("locationLabel"), false);
  assert.equal(inventoryCols.includes("notes"), false);
  assert.equal(inventoryCols.includes("acquisitionCost"), false);
  assert.equal(inventoryCols.includes("robotModelName"), false); // does not exist in Prisma schema
  assert.ok(inventoryCols.includes("displayName"));
  assert.ok(inventoryCols.includes("ownerOrg"));
  assert.ok(inventoryCols.includes("robotModelId"));

  // 2. Submissions must NOT leak submitterContact, and only project valid Prisma fields
  const submissionCols = TABLE_COLUMNS.submissions;
  assert.equal(submissionCols.includes("submitterContact"), false);
  assert.equal(submissionCols.includes("submitterEmail"), false);
  assert.equal(submissionCols.includes("description"), false); // does not exist on SubmittedData
  assert.equal(submissionCols.includes("category"), false);    // does not exist on SubmittedData
  assert.equal(submissionCols.includes("sourceUrl"), false);   // does not exist on SubmittedData
  assert.ok(submissionCols.includes("title"));
  assert.ok(submissionCols.includes("status"));
  assert.ok(submissionCols.includes("submissionType"));

  // 3. Robots whitelists public fields only
  const robotCols = TABLE_COLUMNS.robots;
  assert.equal(robotCols.includes("rawMeta"), false);
  assert.equal(robotCols.includes("sourceMeta"), false);
  assert.ok(robotCols.includes("canonicalName"));
  assert.ok(robotCols.includes("thailandStatus"));

  // 4. Sources whitelists valid Prisma fields only (no non-existent country)
  const sourceCols = TABLE_COLUMNS.sources;
  assert.equal(sourceCols.includes("country"), false);
  assert.ok(sourceCols.includes("title"));
  assert.ok(sourceCols.includes("url"));
});

test("S3 Query Builder: bounds take, applies search filter q, and enforces public policy row predicates", () => {
  // 1. Robots query
  const robotQuery = buildExportPrismaQuery("robots", "dinsaw", 500);
  assert.equal(robotQuery.take, 500);
  assert.ok(robotQuery.where?.OR);
  assert.equal(robotQuery.where.OR.length, 2);
  assert.ok((robotQuery.where as any).thailandStatus);

  // 2. Max limit capped at MAX_EXPORT_ROWS
  const sourcesQuery = buildExportPrismaQuery("sources", null, 99999);
  assert.equal(sourcesQuery.take, MAX_EXPORT_ROWS);
  assert.equal((sourcesQuery.where as any).relevanceStatus, "ACCEPTED");

  // 3. Inventory strictly pins visibility: "public"
  const invQuery = buildExportPrismaQuery("inventory", "hospital");
  assert.equal((invQuery.where as any).visibility, "public");

  // 4. Contributions strictly pins visibility: "public" and verificationStatus: "APPROVED"
  const contribQuery = buildExportPrismaQuery("contributions");
  assert.equal((contribQuery.where as any).visibility, "public");
  assert.equal((contribQuery.where as any).verificationStatus, "APPROVED");

  // 5. Submissions strictly pins status: "APPROVED"
  const subQuery = buildExportPrismaQuery("submissions");
  assert.equal((subQuery.where as any).status, "APPROVED");

  // 6. Perspectives strictly pins parent source relevanceStatus: "ACCEPTED"
  const persQuery = buildExportPrismaQuery("perspective_annotations");
  assert.deepEqual((persQuery.where as any).source, { relevanceStatus: "ACCEPTED" });
});

test("S3 Export Route Handler: rejects invalid table with 400 Bad Request and normalizes valid tables", async () => {
  process.env.ADMIN_BASIC_USER = "operator@test.local";
  process.env.ADMIN_BASIC_PASSWORD = "super-secret-password-xyz";

  const authHeader = `Basic ${Buffer.from("operator@test.local:super-secret-password-xyz").toString("base64")}`;

  // Unknown table "users"
  const req = new NextRequest("http://localhost:3000/api/export?table=users", {
    headers: { authorization: authHeader }
  });
  const res = await exportRoute(req);
  assert.equal(res.status, 400, "Unknown table must reject with 400 Bad Request");

  const json = await res.json();
  assert.ok(json.error.includes("Invalid table 'users'"));
  assert.ok(json.error.includes("Allowed tables:"));
});
