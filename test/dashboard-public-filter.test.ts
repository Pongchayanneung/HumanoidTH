import { test } from "node:test";
import assert from "node:assert/strict";
import { publicContributionWhere } from "../lib/public-projection";

// Run only against a disposable database prepared for this test.
test("public contribution aggregates include eligible null URLs and exclude private and pending rows", { skip: !process.env.DASHBOARD_TEST_DATABASE }, async () => {
  const { prisma } = await import("../lib/prisma");
  const marker = `dashboard-test-${Date.now()}`;
  const rollback = new Error("rollback fixture");
  try {
    await prisma.$transaction(async (tx) => {
      await tx.contribution.createMany({ data: [
        { title: marker, contributionType: `${marker}-public`, visibility: "public", verificationStatus: "APPROVED", sourceUrl: `https://example.invalid/${marker}` },
        { title: marker, contributionType: `${marker}-null`, visibility: "public", verificationStatus: "APPROVED", sourceUrl: null },
        { title: marker, contributionType: `${marker}-private`, visibility: "private", verificationStatus: "APPROVED" },
        { title: marker, contributionType: `${marker}-pending`, visibility: "public", verificationStatus: "NEEDS_REVIEW" },
        { title: marker, contributionType: `${marker}-placeholder`, visibility: "public", verificationStatus: "APPROVED", sourceUrl: `https://example.invalid/placeholder/${marker}` }
      ] });
      const rows = await tx.contribution.groupBy({
        by: ["contributionType"],
        where: { AND: [publicContributionWhere, { title: marker }] },
        _count: { _all: true }
      });
      assert.deepEqual(rows.map((row) => row.contributionType).sort(), [`${marker}-null`, `${marker}-public`]);
      throw rollback;
    });
    assert.fail("fixture transaction must roll back");
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await prisma.$disconnect();
  }
});
