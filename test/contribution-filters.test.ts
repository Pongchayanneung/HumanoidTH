import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateContributionFilters,
  buildContributionWhere,
  normalizeScalarParam,
  truncateParam,
  CONTRIBUTION_TYPES,
  VALID_STATUSES
} from "../lib/contribution-filters";
import ContributionsPage from "../app/contributions/page";
import { prisma } from "../lib/prisma";

test("valid statuses and contribution types pass filter validation", () => {
  // APPROVED produces neither error nor notice
  const approvedRes = validateContributionFilters({ status: "APPROVED" });
  assert.equal(approvedRes.filterError, null);
  assert.equal(approvedRes.statusNotice, null);

  // Non-approved valid statuses produce a helpful public notice and are ignored in query
  for (const status of ["NEEDS_REVIEW", "REJECTED", "QUEUED", "ANALYZED", "FAILED"]) {
    const res = validateContributionFilters({ status });
    assert.equal(res.filterError, null, `Status ${status} should not be an error`);
    assert.ok(res.statusNotice?.includes("Status filtering is disabled for public visitors"), `Status ${status} should have statusNotice`);
  }

  for (const type of CONTRIBUTION_TYPES) {
    const res = validateContributionFilters({ type });
    assert.equal(res.filterError, null, `Type ${type} should be valid`);
  }
});

test("unknown filter values fail clearly and truncate excessively long inputs", () => {
  // Legacy or fabricated statuses must fail
  const legacyVerified = validateContributionFilters({ status: "VERIFIED" });
  assert.ok(legacyVerified.filterError?.includes('Unknown verification status "VERIFIED"'));

  const unknownFlagged = validateContributionFilters({ status: "FLAGGED" });
  assert.ok(unknownFlagged.filterError?.includes('Unknown verification status "FLAGGED"'));

  const unknownType = validateContributionFilters({ type: "unknown_hack_type" });
  assert.ok(unknownType.filterError?.includes('Unknown contribution type "unknown_hack_type"'));

  // Very long invalid values must be safely truncated to avoid unbounded memory/HTML reflection
  const hugeString = "A".repeat(100000);
  const truncatedStatus = validateContributionFilters({ status: hugeString });
  assert.ok(truncatedStatus.filterError);
  assert.ok(truncatedStatus.filterError.length < 300, "Error message must remain safely bounded");
  assert.ok(truncatedStatus.filterError.includes("..."));

  const truncatedType = validateContributionFilters({ type: hugeString });
  assert.ok(truncatedType.filterError);
  assert.ok(truncatedType.filterError.length < 300, "Error message must remain safely bounded");
  assert.ok(truncatedType.filterError.includes("..."));
});

test("repeated query parameters are normalized to scalars without throwing", () => {
  // Next.js passes repeated parameters as string[]: ?q=a&q=b
  const res = validateContributionFilters({
    q: ["first-query", "second-query"],
    org: ["OrgA", "OrgB"],
    type: ["research_paper", "dataset"]
  });

  assert.equal(res.q, "first-query");
  assert.equal(res.org, "OrgA");
  assert.equal(res.type, "research_paper");
  assert.equal(res.filterError, null);

  assert.equal(normalizeScalarParam(undefined), undefined);
  assert.equal(normalizeScalarParam(["  sample  ", "other"]), "sample");
  assert.equal(normalizeScalarParam("  single  "), "single");
});

test("constructed where clause strictly enforces M3/M5 public membership", () => {
  const where = buildContributionWhere({
    type: "software_repository",
    org: "KMUTT FIBO",
    q: "ROS2 navigation",
    filterError: null,
    statusNotice: null
  });

  // Strict public isolation
  assert.equal(where.visibility, "public");
  assert.equal(where.verificationStatus, "APPROVED");
  assert.equal(where.contributionType, "software_repository");
  assert.equal(where.organization, "KMUTT FIBO");
  assert.ok(Array.isArray(where.AND));

  // Placeholder exclusion preserved
  const notList = Array.isArray(where.NOT) ? where.NOT : [where.NOT];
  const containsPlaceholder = notList.some(
    (cond: any) => cond.sourceUrl?.contains === "placeholder" || cond.sourceUrl?.contains?.includes("placeholder")
  );
  assert.ok(containsPlaceholder, "Must exclude placeholder sourceUrls");

  // Even if a caller passes status="NEEDS_REVIEW", public where clause must remain APPROVED
  const safeWhere = buildContributionWhere({
    status: "NEEDS_REVIEW",
    filterError: null,
    statusNotice: null
  });
  assert.equal(safeWhere.verificationStatus, "APPROVED", "Public where clause must remain pinned to APPROVED");
});

test("ContributionsPage: directly exercises page execution with filtered queries and status notice", async () => {
  let capturedContributionWhere: any = null;
  let capturedRobotWhere: any = null;
  const originalContributionFindMany = prisma.contribution.findMany;
  const originalRobotFindMany = prisma.robotModel.findMany;

  (prisma.contribution as any).findMany = async (args: any) => {
    if (!capturedContributionWhere && args?.where) {
      capturedContributionWhere = args.where;
    }
    return [
      {
        id: "contrib-1",
        title: "Test Public Contribution",
        contributorName: "Author",
        contributionType: "software_repository",
        organization: "KMUTT FIBO",
        license: "MIT",
        verificationStatus: "APPROVED",
        description: "Test description",
        sourceUrl: "https://example.com/repo",
        relatedRobotModel: { canonicalName: "Dinsaw Robot" },
        updatedAt: new Date("2026-11-01T00:00:00Z")
      }
    ];
  };

  (prisma.robotModel as any).findMany = async (args: any) => {
    capturedRobotWhere = args?.where;
    return [{ id: "robot-1", canonicalName: "Dinsaw Robot" }];
  };

  try {
    const pageJsx = await ContributionsPage({
      searchParams: Promise.resolve({
        type: "software_repository",
        status: "QUEUED"
      })
    });

    assert.ok(pageJsx, "Page JSX should render successfully");
    assert.equal(capturedContributionWhere.verificationStatus, "APPROVED");
    assert.equal(capturedContributionWhere.visibility, "public");
    assert.equal(capturedContributionWhere.contributionType, "software_repository");
    // Verify robot dropdown query filters by public contributions
    assert.ok(capturedRobotWhere?.contributions?.some, "Robot query must only list robots with public contributions");
  } finally {
    prisma.contribution.findMany = originalContributionFindMany;
    prisma.robotModel.findMany = originalRobotFindMany;
  }
});

test("Thai localization: validation errors, notices, and UI labels are accurately localized", () => {
  // Thai error on invalid contribution type
  const thTypeErr = validateContributionFilters({ type: "bad_type" }, "th");
  assert.ok(thTypeErr.filterError?.includes("ไม่พบประเภทผลงาน"));
  assert.ok(thTypeErr.filterError?.includes("bad_type"));

  // Thai error on invalid status
  const thStatusErr = validateContributionFilters({ status: "UNKNOWN" }, "th");
  assert.ok(thStatusErr.filterError?.includes("ไม่พบสถานะการตรวจสอบ"));
  assert.ok(thStatusErr.filterError?.includes("UNKNOWN"));

  // Thai notice on non-approved status
  const thNotice = validateContributionFilters({ status: "QUEUED" }, "th");
  assert.equal(thNotice.filterError, null);
  assert.ok(thNotice.statusNotice?.includes("ระบบปิดการกรองตามสถานะสำหรับผู้ใช้ทั่วไป"));
  assert.ok(thNotice.statusNotice?.includes("QUEUED"));
});
