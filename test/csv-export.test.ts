process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://mock:mock@localhost:5432/mock";

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
  buildExportRobotsQuery,
  buildExportContributionsQuery,
  buildExportInventoryQuery,
  buildExportSubmissionsQuery,
  buildExportPerspectiveAnnotationsQuery,
  buildExportPullJobsQuery,
  buildExportSourcesQuery,
  getSearchWhere,
  getBoundedLimit,
  MAX_EXPORT_ROWS
} from "../lib/csv-export";
import { GET as exportRoute } from "../app/api/export/route";
import { publicContributionWhere, publicRobotWhere } from "../lib/public-projection";
import { prisma } from "../lib/prisma";
import { setOperatorPrincipalResolverForTesting } from "../lib/operator";

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
  assert.equal(normalizeTableName("pull_jobs"), "pull_jobs");
  assert.equal(normalizeTableName("source_pull_jobs"), "pull_jobs");

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
  const robotQuery = buildExportRobotsQuery("dinsaw", 500);
  assert.equal(robotQuery.take, 500);
  assert.ok(robotQuery.where?.OR);
  assert.equal(robotQuery.where.OR.length, 2);
  assert.ok((robotQuery.where as any).thailandStatus);

  // 2. Max limit capped at MAX_EXPORT_ROWS, and NaN/invalid limit falls back to MAX_EXPORT_ROWS safely
  const sourcesQuery = buildExportSourcesQuery(null, 99999);
  assert.equal(sourcesQuery.take, MAX_EXPORT_ROWS);
  assert.equal((sourcesQuery.where as any).relevanceStatus, "ACCEPTED");

  const nanLimitQuery = buildExportSourcesQuery(null, NaN);
  assert.equal(nanLimitQuery.take, MAX_EXPORT_ROWS);
  assert.ok(!Number.isNaN(nanLimitQuery.take));

  const negativeLimitQuery = buildExportSourcesQuery(null, -10);
  assert.equal(negativeLimitQuery.take, MAX_EXPORT_ROWS);

  assert.equal(getBoundedLimit(0), MAX_EXPORT_ROWS);
  assert.equal(getBoundedLimit(-1), MAX_EXPORT_ROWS);
  assert.equal(getBoundedLimit(100), 100);

  // 3. Inventory strictly pins visibility: "public"
  const invQuery = buildExportInventoryQuery("hospital");
  assert.equal((invQuery.where as any).visibility, "public");

  // 4. Contributions strictly pins visibility: "public", verificationStatus: "APPROVED", and excludes placeholders
  const contribQuery = buildExportContributionsQuery();
  assert.equal((contribQuery.where as any).visibility, "public");
  assert.equal((contribQuery.where as any).verificationStatus, "APPROVED");
  assert.ok((contribQuery.where as any).OR); // OR allows sourceUrl: null or NOT excluded URLs

  // Robot query enforces publicRobotWhere exclusions with case-insensitivity
  assert.ok((robotQuery.where as any).NOT);
  for (const clause of (robotQuery.where as any).NOT) {
    assert.equal(clause.canonicalName.mode, "insensitive", "Exclusion clause must enforce case-insensitivity");
  }

  // 5. Submissions strictly pins status: "APPROVED"
  const subQuery = buildExportSubmissionsQuery();
  assert.equal((subQuery.where as any).status, "APPROVED");

  // 6. Perspectives strictly pins parent source relevanceStatus: "ACCEPTED"
  const persQuery = buildExportPerspectiveAnnotationsQuery();
  assert.deepEqual((persQuery.where as any).source, { relevanceStatus: "ACCEPTED" });
});

test("S3 contribution search keeps the public URL exclusions and aligns predicates", () => {
  const query = buildExportContributionsQuery("dinsaw");
  const where = query.where;

  assert.deepEqual(where?.OR, publicContributionWhere.OR);
  assert.ok(where && "AND" in where);
  assert.deepEqual(where.AND, [
    {
      OR: [
        { title: { contains: "dinsaw", mode: "insensitive" } },
        { description: { contains: "dinsaw", mode: "insensitive" } }
      ]
    }
  ]);

  // Aligned database search predicates
  const searchWhere = getSearchWhere("contributions", "dinsaw");
  assert.deepEqual(searchWhere, {
    OR: [
      { title: { contains: "dinsaw", mode: "insensitive" } },
      { description: { contains: "dinsaw", mode: "insensitive" } }
    ]
  });
});

test("S3 Export Route Handler: fails closed for unauthenticated visitors, unsigned cookies, and Basic auth", async () => {
  // Test attempts: empty, forged unsigned admin cookie, Basic auth header
  const forged = Buffer.from("operator@test.local:super-secret-password-xyz").toString("base64");
  const attempts: Record<string, string>[] = [
    {},
    { cookie: "admin_session=true; user_role=ADMIN" },
    { authorization: `Basic ${forged}` }
  ];

  for (const headers of attempts) {
    const req = new NextRequest("http://localhost:3000/api/export?table=submissions", { headers });
    const res = await exportRoute(req);
    assert.equal(res.status, 403, "Unauthenticated / forged / basic credentials must return 403");
    const json = await res.json();
    assert.equal(json.ok, false);
    assert.equal(json.code, "WORKFLOW_UNAVAILABLE");
  }
});

test("S3 Export Route Handler: validates allowed tables and rejects unknown ones for operator sessions", async () => {
  // Mock operator principal
  const originalSourceFindMany = prisma.sourceRecord.findMany;
  let queriedArgs: any = null;

  (prisma.sourceRecord as any).findMany = async (args: any) => {
    queriedArgs = args;
    return [
      {
        id: "source-1",
        sourceType: "SEED",
        title: "Dinsaw Telepresence",
        url: "https://example.com/dinsaw",
        excerpt: "Robot in hospital",
        author: "CT Asia",
        platform: "Web",
        publishedAt: new Date("2026-01-01"),
        relevanceStatus: "ACCEPTED"
      }
    ];
  };

  try {
    setOperatorPrincipalResolverForTesting(async () => ({
      ok: true,
      principal: { kind: "operator", email: "operator@example.invalid" }
    }));

    // 1. Unknown table "users" rejects with 400
    const invalidReq = new NextRequest("http://localhost:3000/api/export?table=users");
    const invalidRes = await exportRoute(invalidReq);
    assert.equal(invalidRes.status, 400);
    const invalidJson = await invalidRes.json();
    assert.ok(invalidJson.error.includes("Invalid table 'users'"));

    // 2. Valid table "sources" succeeds with 200 and text/csv
    const validReq = new NextRequest("http://localhost:3000/api/export?table=sources&q=dinsaw");
    const validRes = await exportRoute(validReq);
    assert.equal(validRes.status, 200);
    assert.equal(validRes.headers.get("content-type"), "text/csv; charset=utf-8");
    assert.equal(validRes.headers.get("content-disposition"), 'attachment; filename="sources.csv"');

    const csv = await validRes.text();
    assert.ok(csv.startsWith("id,sourceType,title,url,excerpt,author,platform,publishedAt,relevanceStatus\r\n"));
    assert.ok(csv.includes("source-1,SEED,Dinsaw Telepresence"));
    assert.ok(queriedArgs);
  } finally {
    setOperatorPrincipalResolverForTesting(null);
    prisma.sourceRecord.findMany = originalSourceFindMany;
  }
});

test("S3 Export Route Handler: filters mixed-case placeholders and foreign models from robot export", async () => {
  const originalRobotFindMany = prisma.robotModel.findMany;

  (prisma.robotModel as any).findMany = async () => {
    return [
      {
        id: "robot-1",
        canonicalName: "Dinsaw Robot",
        description: "Thai healthcare companion",
        manufacturer: "CT Asia Robotics",
        developerOrg: "CT Asia",
        countryOfOrigin: "Thailand",
        robotType: "humanoid",
        embodimentLevel: "full",
        officialUrl: "https://example.com/dinsaw",
        firstSeenYear: 2019,
        thailandStatus: "deployed_in_thailand"
      },
      {
        id: "robot-2",
        canonicalName: "pLaCeHoLdEr",
        description: "Mixed case test",
        manufacturer: "None",
        developerOrg: null,
        countryOfOrigin: null,
        robotType: "other",
        embodimentLevel: null,
        officialUrl: null,
        firstSeenYear: null,
        thailandStatus: "deployed_in_thailand"
      },
      {
        id: "robot-3",
        canonicalName: "Generic pLaCeHoLdEr Model",
        description: "Generic placeholder bucket",
        manufacturer: null,
        developerOrg: null,
        countryOfOrigin: null,
        robotType: "other",
        embodimentLevel: null,
        officialUrl: null,
        firstSeenYear: null,
        thailandStatus: "deployed_in_thailand"
      },
      {
        id: "robot-4",
        canonicalName: "bUmI hUmAnOiD rObOt",
        description: "Foreign unverified model",
        manufacturer: "Noetix",
        developerOrg: null,
        countryOfOrigin: "China",
        robotType: "humanoid",
        embodimentLevel: "full",
        officialUrl: null,
        firstSeenYear: 2024,
        thailandStatus: "observed_in_thailand"
      },
      {
        id: "robot-5",
        canonicalName: "UBTECH Walker",
        description: "Unverified claim",
        manufacturer: "UBTECH",
        developerOrg: null,
        countryOfOrigin: "China",
        robotType: "humanoid",
        embodimentLevel: "full",
        officialUrl: null,
        firstSeenYear: 2023,
        thailandStatus: "observed_in_thailand"
      }
    ];
  };

  try {
    setOperatorPrincipalResolverForTesting(async () => ({
      ok: true,
      principal: { kind: "operator", email: "operator@example.invalid" }
    }));

    const req = new NextRequest("http://localhost:3000/api/export?table=robots");
    const res = await exportRoute(req);
    assert.equal(res.status, 200);

    const csv = await res.text();
    // Valid robot must be exported
    assert.ok(csv.includes("robot-1,Dinsaw Robot"));

    // Mixed-case placeholders and excluded foreign models must NOT appear in CSV
    assert.equal(csv.includes("pLaCeHoLdEr"), false, "pLaCeHoLdEr must be filtered out");
    assert.equal(csv.includes("Generic pLaCeHoLdEr Model"), false, "Generic pLaCeHoLdEr Model must be filtered out");
    assert.equal(csv.includes("bUmI hUmAnOiD rObOt"), false, "bUmI hUmAnOiD rObOt must be filtered out");
    assert.equal(csv.includes("UBTECH Walker"), false, "UBTECH Walker must be filtered out");
  } finally {
    setOperatorPrincipalResolverForTesting(null);
    prisma.robotModel.findMany = originalRobotFindMany;
  }
});

test("S3 Export Route Handler: exports only APPROVED submissions and strictly redacts PII and internal notes", async () => {
  const originalSubmissionsFindMany = prisma.submittedData.findMany;

  (prisma.submittedData as any).findMany = async () => {
    return [
      {
        id: "sub-1",
        title: "Community Telepresence",
        submissionType: "robot_model",
        status: "APPROVED",
        url: "https://example.com/submission",
        createdAt: new Date("2026-11-01"),
        submitterContact: "operator@secret.mail",
        notes: "Internal secret note"
      },
      {
        id: "sub-2",
        title: "Pending Community Data",
        submissionType: "robot_model",
        status: "QUEUED",
        url: "https://example.com/pending",
        createdAt: new Date("2026-11-02"),
        submitterContact: "spammer@external.mail",
        notes: "Unverified external input"
      },
      {
        id: "sub-3",
        title: "Review In Progress",
        submissionType: "inventory",
        status: "UNDER_REVIEW",
        url: null,
        createdAt: new Date("2026-11-03"),
        submitterContact: "user@domain.com",
        notes: "Needs verification"
      }
    ];
  };

  try {
    setOperatorPrincipalResolverForTesting(async () => ({
      ok: true,
      principal: { kind: "operator", email: "operator@example.invalid" }
    }));

    const req = new NextRequest("http://localhost:3000/api/export?table=submissions");
    const res = await exportRoute(req);
    assert.equal(res.status, 200);

    const csv = await res.text();
    // Headers must strictly exclude submitterContact, submitterName, and notes
    assert.ok(csv.startsWith("id,title,submissionType,status,url,createdAt\r\n"));
    assert.equal(csv.includes("submitterContact"), false);
    assert.equal(csv.includes("notes"), false);

    // Only APPROVED submission must be in output
    assert.ok(csv.includes("sub-1,Community Telepresence"));

    // Pending / Under review submissions must NOT appear
    assert.equal(csv.includes("Pending Community Data"), false);
    assert.equal(csv.includes("Review In Progress"), false);
    assert.equal(csv.includes("operator@secret.mail"), false);
    assert.equal(csv.includes("Internal secret note"), false);
  } finally {
    setOperatorPrincipalResolverForTesting(null);
    prisma.submittedData.findMany = originalSubmissionsFindMany;
  }
});
