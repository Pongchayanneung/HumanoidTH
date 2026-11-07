import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateContributionFilters,
  buildContributionWhere,
  normalizeScalarParam,
  CONTRIBUTION_TYPES,
  VALID_STATUSES
} from "../lib/contribution-filters";

test("valid statuses and contribution types pass filter validation", () => {
  for (const status of ["APPROVED", "NEEDS_REVIEW", "REJECTED"]) {
    const res = validateContributionFilters({ status });
    assert.equal(res.filterError, null, `Status ${status} should be valid`);
  }

  for (const type of CONTRIBUTION_TYPES) {
    const res = validateContributionFilters({ type });
    assert.equal(res.filterError, null, `Type ${type} should be valid`);
  }
});

test("unknown filter values fail clearly rather than silently broadening results", () => {
  // Legacy or fabricated statuses must fail
  const legacyVerified = validateContributionFilters({ status: "VERIFIED" });
  assert.ok(legacyVerified.filterError?.includes('Unknown verification status "VERIFIED"'));

  const unknownFlagged = validateContributionFilters({ status: "FLAGGED" });
  assert.ok(unknownFlagged.filterError?.includes('Unknown verification status "FLAGGED"'));

  const unknownType = validateContributionFilters({ type: "unknown_hack_type" });
  assert.ok(unknownType.filterError?.includes('Unknown contribution type "unknown_hack_type"'));
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
    filterError: null
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
    filterError: null
  });
  assert.equal(safeWhere.verificationStatus, "APPROVED", "Public where clause must remain pinned to APPROVED");
});
