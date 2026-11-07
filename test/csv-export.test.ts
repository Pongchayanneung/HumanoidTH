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
  fetchExportableRecords,
  getSearchWhere,
  getBoundedLimit,
  DEFAULT_EXPORT_LIMIT,
  MAX_EXPORT_ROWS,
  type AllowedTable
} from "../lib/csv-export";
import { GET as exportRoute } from "../app/api/export/route";
import { publicContributionWhere, publicRobotWhere } from "../lib/public-projection";
import { prisma } from "../lib/prisma";
import { setOperatorPrincipalResolverForTesting } from "../lib/operator";

test("S3 Table Validation: validates allowed tables, normalizes names, and rejects disabled submissions / unknown tables", () => {
  // Retained allowed tables
  assert.equal(isAllowedTable("sources"), true);
  assert.equal(isAllowedTable("robots"), true);
  assert.equal(isAllowedTable("contributions"), true);
  assert.equal(isAllowedTable("inventory"), true);
  assert.equal(isAllowedTable("owned_inventory"), true);
  assert.equal(isAllowedTable("perspective_annotations"), true);
  assert.equal(isAllowedTable("pull_jobs"), true);

  // Submissions export is disabled pending review workflow policy confirmation
  assert.equal(isAllowedTable("submissions"), false);
  assert.equal(isAllowedTable("submission"), false);
  assert.equal(normalizeTableName("submissions"), null);
  assert.equal(normalizeTableName("submission"), null);

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

  // 2. Submissions is excluded from TABLE_COLUMNS
  assert.equal((TABLE_COLUMNS as any).submissions, undefined);

  // 3. Contributions whitelists public fields and strictly omits internal visibility / notes
  const contribCols = TABLE_COLUMNS.contributions;
  assert.equal(contribCols.includes("visibility"), false);
  assert.ok(contribCols.includes("title"));
  assert.ok(contribCols.includes("verificationStatus"));
  assert.ok(contribCols.includes("sourceUrl"));

  // 4. Robots whitelists public fields only
  const robotCols = TABLE_COLUMNS.robots;
  assert.equal(robotCols.includes("rawMeta"), false);
  assert.equal(robotCols.includes("sourceMeta"), false);
  assert.ok(robotCols.includes("canonicalName"));
  assert.ok(robotCols.includes("thailandStatus"));

  // 5. Sources whitelists valid Prisma fields only (no non-existent country)
  const sourceCols = TABLE_COLUMNS.sources;
  assert.equal(sourceCols.includes("country"), false);
  assert.ok(sourceCols.includes("title"));
  assert.ok(sourceCols.includes("url"));
});

test("S3 Query Builder & Retained Tables: bounds take, aligns ordering, and applies public policy predicates", () => {
  // 1. Robots query uses createdAt: "desc", Thailand status, and mode: "insensitive"
  const robotQuery = buildExportRobotsQuery("dinsaw", 500);
  assert.equal(robotQuery.take, 500);
  assert.deepEqual(robotQuery.orderBy, { createdAt: "desc" });
  assert.ok(robotQuery.where?.OR);
  assert.equal(robotQuery.where.OR.length, 2);
  assert.ok((robotQuery.where as any).thailandStatus);
  assert.ok((robotQuery.where as any).NOT);
  for (const clause of (robotQuery.where as any).NOT) {
    assert.equal(clause.canonicalName.mode, "insensitive", "Exclusion clause must enforce case-insensitivity");
  }

  // 2. Max limit capped at MAX_EXPORT_ROWS, and NaN/invalid limit falls back to DEFAULT_EXPORT_LIMIT safely
  const sourcesQuery = buildExportSourcesQuery(null, 99999);
  assert.equal(sourcesQuery.take, MAX_EXPORT_ROWS);
  assert.deepEqual(sourcesQuery.orderBy, { createdAt: "desc" });
  assert.equal((sourcesQuery.where as any).relevanceStatus, "ACCEPTED");

  const nanLimitQuery = buildExportSourcesQuery(null, NaN);
  assert.equal(nanLimitQuery.take, DEFAULT_EXPORT_LIMIT);

  const negativeLimitQuery = buildExportSourcesQuery(null, -10);
  assert.equal(negativeLimitQuery.take, DEFAULT_EXPORT_LIMIT);

  assert.equal(getBoundedLimit(0), DEFAULT_EXPORT_LIMIT);
  assert.equal(getBoundedLimit(-1), DEFAULT_EXPORT_LIMIT);
  assert.equal(getBoundedLimit(100), 100);

  // 3. Inventory strictly pins visibility: "public" and orderBy: { createdAt: "desc" }
  const invQuery = buildExportInventoryQuery("hospital");
  assert.equal((invQuery.where as any).visibility, "public");
  assert.deepEqual(invQuery.orderBy, { createdAt: "desc" });

  // 4. Contributions selects visibility: true (for verification) and pins publicContributionWhere
  const contribQuery = buildExportContributionsQuery();
  assert.equal((contribQuery.select as any).visibility, true, "Must select visibility for in-memory predicate");
  assert.deepEqual(contribQuery.orderBy, { createdAt: "desc" });
  assert.equal((contribQuery.where as any).visibility, "public");
  assert.equal((contribQuery.where as any).verificationStatus, "APPROVED");
  assert.ok((contribQuery.where as any).OR);

  // 5. Perspectives strictly pins parent source relevanceStatus: "ACCEPTED" and orderBy: { createdAt: "desc" }
  const persQuery = buildExportPerspectiveAnnotationsQuery();
  assert.deepEqual((persQuery.where as any).source, { relevanceStatus: "ACCEPTED" });
  assert.deepEqual(persQuery.orderBy, { createdAt: "desc" });

  // 6. Pull jobs enforces orderBy: { createdAt: "desc" }
  const pullQuery = buildExportPullJobsQuery();
  assert.deepEqual(pullQuery.orderBy, { createdAt: "desc" });
});

test("S3 Retained Tables and Filter Combinations: verifies queries for all retained tables with and without filters", () => {
  const retainedTables: AllowedTable[] = [
    "sources",
    "robots",
    "contributions",
    "inventory",
    "owned_inventory",
    "perspective_annotations",
    "pull_jobs"
  ];

  for (const table of retainedTables) {
    // 1. Unfiltered query
    const unfiltered = buildExportPrismaQuery(table, null, 100);
    assert.equal(unfiltered.take, 100);
    assert.deepEqual(unfiltered.orderBy, { createdAt: "desc" });
    assert.ok(unfiltered.select);

    // 2. Filtered query
    const filtered = buildExportPrismaQuery(table, "telepresence", 50);
    assert.equal(filtered.take, 50);
    assert.deepEqual(filtered.orderBy, { createdAt: "desc" });
    assert.ok(filtered.where);

    // 3. Default limit
    const defaultQuery = buildExportPrismaQuery(table);
    assert.equal(defaultQuery.take, DEFAULT_EXPORT_LIMIT);
  }
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
  const forged = Buffer.from("operator@test.local:super-secret-password-xyz").toString("base64");
  const attempts: Record<string, string>[] = [
    {},
    { cookie: "admin_session=true; user_role=ADMIN" },
    { authorization: `Basic ${forged}` }
  ];

  for (const headers of attempts) {
    const req = new NextRequest("http://localhost:3000/api/export?table=sources", { headers });
    const res = await exportRoute(req);
    assert.equal(res.status, 403, "Unauthenticated / forged / basic credentials must return 403");
    const json = await res.json();
    assert.equal(json.ok, false);
    assert.equal(json.code, "WORKFLOW_UNAVAILABLE");
  }
});

test("S3 Export Route Handler: rejects submissions export fail-closed with 403 WORKFLOW_UNAVAILABLE", async () => {
  try {
    setOperatorPrincipalResolverForTesting(async () => ({
      ok: true,
      principal: { kind: "operator", email: "operator@example.invalid" }
    }));

    // Both "submissions" and "submission" must fail closed with 403 WORKFLOW_UNAVAILABLE
    for (const raw of ["submissions", "submission", "SUBMISSIONS"]) {
      const req = new NextRequest(`http://localhost:3000/api/export?table=${raw}`);
      const res = await exportRoute(req);
      assert.equal(res.status, 403);
      const json = await res.json();
      assert.equal(json.ok, false);
      assert.equal(json.code, "WORKFLOW_UNAVAILABLE");
      assert.ok(json.error.includes("Submissions export is disabled"));
    }
  } finally {
    setOperatorPrincipalResolverForTesting(null);
  }
});

test("S3 Export Route Handler: validates allowed tables and rejects unknown ones for operator sessions", async () => {
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

test("S3 Export Route Handler: exports eligible contributions with query-shaped results including visibility while omitting visibility from CSV headers", async () => {
  const originalContribFindMany = prisma.contribution.findMany;

  // Real query-shaped results matching buildExportContributionsQuery.select
  (prisma.contribution as any).findMany = async () => {
    return [
      {
        id: "contrib-1",
        title: "Open Humanoid Teleop Dataset",
        description: "Teleoperation trajectories in Thai clinical trials",
        contributorName: "RoboLab Chula",
        organization: "Chulalongkorn University",
        contributionType: "dataset",
        license: "CC-BY-4.0",
        sourceUrl: "https://example.com/teleop-dataset",
        verificationStatus: "APPROVED",
        visibility: "public",
        createdAt: new Date("2026-06-01")
      },
      {
        id: "contrib-2",
        title: "Private Ineligible Trajectories",
        description: "Confidential internal telemetry",
        contributorName: "Secret Contributor",
        organization: "Confidential Inc",
        contributionType: "telemetry",
        license: "Proprietary",
        sourceUrl: "https://example.com/private",
        verificationStatus: "APPROVED",
        visibility: "private", // Must be rejected by isEligiblePublicContribution
        createdAt: new Date("2026-06-02")
      },
      {
        id: "contrib-3",
        title: "Unverified Community Contribution",
        description: "Pending verification",
        contributorName: "Community Dev",
        organization: null,
        contributionType: "code",
        license: "MIT",
        sourceUrl: "https://example.com/unverified",
        verificationStatus: "PENDING", // Must be rejected by isEligiblePublicContribution
        visibility: "public",
        createdAt: new Date("2026-06-03")
      },
      {
        id: "contrib-4",
        title: "Excluded Research Placeholder",
        description: "Contains placeholder seed token",
        contributorName: "Researcher",
        organization: "Lab",
        contributionType: "paper",
        license: "Open",
        sourceUrl: "seed:contribution:thai-hri-research", // Must be rejected by URL exclusions
        verificationStatus: "APPROVED",
        visibility: "public",
        createdAt: new Date("2026-06-04")
      }
    ];
  };

  try {
    setOperatorPrincipalResolverForTesting(async () => ({
      ok: true,
      principal: { kind: "operator", email: "operator@example.invalid" }
    }));

    const req = new NextRequest("http://localhost:3000/api/export?table=contributions");
    const res = await exportRoute(req);
    assert.equal(res.status, 200);

    const csv = await res.text();

    // 1. Headers must match TABLE_COLUMNS.contributions and must NOT contain internal visibility column
    assert.ok(csv.startsWith("id,title,description,contributorName,organization,contributionType,license,sourceUrl,verificationStatus\r\n"));
    assert.equal(csv.split("\r\n")[0].includes("visibility"), false);

    // 2. Eligible contribution is exported
    assert.ok(csv.includes("contrib-1,Open Humanoid Teleop Dataset"));

    // 3. Ineligible contributions are strictly excluded
    assert.equal(csv.includes("contrib-2"), false, "Private contribution must be excluded");
    assert.equal(csv.includes("contrib-3"), false, "Pending contribution must be excluded");
    assert.equal(csv.includes("contrib-4"), false, "Excluded seed placeholder URL must be excluded");
  } finally {
    setOperatorPrincipalResolverForTesting(null);
    prisma.contribution.findMany = originalContribFindMany;
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

test("S3 Display & Export Membership Parity: fetchExportableRecords ensures exact alignment between browser view and CSV export", async () => {
  const originalRobotFindMany = prisma.robotModel.findMany;

  (prisma.robotModel as any).findMany = async (args: any) => {
    assert.deepEqual(args.orderBy, { createdAt: "desc" });
    assert.equal(args.take, DEFAULT_EXPORT_LIMIT);
    return [
      {
        id: "r1",
        canonicalName: "Dinsaw Robot",
        description: "Companion",
        manufacturer: "CT Asia",
        developerOrg: "CT Asia",
        countryOfOrigin: "Thailand",
        robotType: "humanoid",
        embodimentLevel: "full",
        officialUrl: "https://example.com/dinsaw",
        firstSeenYear: 2019,
        thailandStatus: "deployed_in_thailand"
      }
    ];
  };

  try {
    const records = await fetchExportableRecords("robots", null, DEFAULT_EXPORT_LIMIT);
    assert.equal(records.length, 1);
    assert.equal(records[0].canonicalName, "Dinsaw Robot");

    // CSV generator on these records matches TABLE_COLUMNS.robots
    const csv = generateCsv(TABLE_COLUMNS.robots, records);
    assert.ok(csv.includes("r1,Dinsaw Robot"));
  } finally {
    prisma.robotModel.findMany = originalRobotFindMany;
  }
});
