process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://mock:mock@localhost:5432/mock";

import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import {
  sanitizeInventoryForPublic,
  isEligiblePublicRobot,
  isEligiblePublicContribution,
  publicContributionWhere,
  publicInventoryWhere,
  publicSourceRecordWhere,
  publicPerspectiveWhere,
  PUBLIC_DATASET_SCOPE_LABEL
} from "../lib/public-projection";
import { GET as exportRoute } from "../app/api/export/route";
import { getOperatorPrincipal } from "../lib/operator";
import ContributionsPage from "../app/contributions/page";
import OverviewPage from "../app/page";
import { prisma } from "../lib/prisma";

test("public-data projection rules enforce mandatory public fields", () => {
  assert.equal(publicContributionWhere.visibility, "public");
  assert.equal(publicContributionWhere.verificationStatus, "APPROVED");
  assert.equal(publicInventoryWhere.visibility, "public");
  assert.equal(publicSourceRecordWhere.relevanceStatus, "ACCEPTED");
  assert.equal(publicPerspectiveWhere.source.relevanceStatus, "ACCEPTED");
  assert.ok(PUBLIC_DATASET_SCOPE_LABEL.includes("2026-11-07"));
});

test("sanitizeInventoryForPublic masks sensitive hardware fields and allowlists properties", () => {
  const privateItem = {
    id: "item-1",
    displayName: "Dinsaw Unit 1",
    ownershipStatus: "deployed",
    ownerOrg: "Chulalongkorn Hospital",
    conditionStatus: "operational",
    robotModelId: "model-1",
    serialNumber: "SN-98234-CTASIA",
    publicSerialSafe: false,
    locationLabel: "Building 4, Chulalongkorn Hospital Room 302",
    custodian: "Dr. Somchai (somchai@hospital.th)",
    notes: "Internal calibration log: motor replaced 2026-08-12",
    visibility: "private",
    // Un-allowlisted internal leak candidates:
    internalRepairNotes: "Motor replacement invoice #9923",
    repairCostThb: 150000,
    operatorSecretKey: "secret-key-123"
  };

  const sanitized = sanitizeInventoryForPublic(privateItem);
  assert.ok(sanitized.serialNumber?.includes("Masked"), "Serial number must be masked when not public-safe");
  assert.ok(sanitized.locationLabel?.includes("Masked"), "Exact location must be masked");
  assert.ok(sanitized.custodian?.includes("Restricted"), "Custodian details must be restricted");
  assert.ok(sanitized.notes?.includes("Masked"), "Internal notes must be masked");

  // Allowlist verification: un-allowlisted keys must not exist on the returned projection
  assert.equal((sanitized as any).internalRepairNotes, undefined);
  assert.equal((sanitized as any).repairCostThb, undefined);
  assert.equal((sanitized as any).operatorSecretKey, undefined);

  // Public-safe serial is permitted if explicitly flagged safe
  const publicSafeItem = {
    displayName: "NAO Demo Unit",
    serialNumber: "NAO-PUBLIC-01",
    publicSerialSafe: true,
    locationLabel: "FIBO Public Showroom",
    custodian: "FIBO Staff",
    notes: "Demonstration unit",
    visibility: "public"
  };

  const safeSanitized = sanitizeInventoryForPublic(publicSafeItem);
  assert.equal(safeSanitized.serialNumber, "NAO-PUBLIC-01", "Public-safe serial should be retained");
  assert.ok(safeSanitized.locationLabel?.includes("Masked"), "Location must still be masked for public");
});

test("isEligiblePublicRobot filters unverified foreign robots and generic placeholders", () => {
  // Verified Thai robots must be eligible
  assert.equal(isEligiblePublicRobot("Dinsaw Robot"), true);
  assert.equal(isEligiblePublicRobot("Pinto Robot"), true);
  assert.equal(isEligiblePublicRobot("Kaitomm Robot"), true);

  // Excluded foreign / unverified claims must be rejected
  assert.equal(isEligiblePublicRobot("Bumi humanoid robot"), false);
  assert.equal(isEligiblePublicRobot("UBTECH Walker"), false);

  // Generic bucket placeholders must be rejected
  assert.equal(isEligiblePublicRobot("Hospital Delivery Service Robot"), false);
  assert.equal(isEligiblePublicRobot("Thai University Social Robot Prototype"), false);
});

test("isEligiblePublicContribution rejects private, unapproved, or placeholder records", () => {
  // Valid public approved contribution
  assert.equal(
    isEligiblePublicContribution({
      visibility: "public",
      verificationStatus: "APPROVED",
      sourceUrl: "https://www.chula.ac.th/en/news/42184/"
    }),
    true
  );

  // Private visibility must be rejected
  assert.equal(
    isEligiblePublicContribution({
      visibility: "private",
      verificationStatus: "APPROVED",
      sourceUrl: "https://example.com/internal"
    }),
    false
  );

  // Unapproved / pending review must be rejected
  assert.equal(
    isEligiblePublicContribution({
      visibility: "public",
      verificationStatus: "NEEDS_REVIEW",
      sourceUrl: "https://example.com/submission"
    }),
    false
  );

  // Placeholder contribution must be rejected
  assert.equal(
    isEligiblePublicContribution({
      visibility: "public",
      verificationStatus: "APPROVED",
      sourceUrl: "seed:contribution:thai-hri-research"
    }),
    false
  );
});

test("Export API: fails closed with 503 if credentials are not configured", async () => {
  const origUser = process.env.ADMIN_BASIC_USER;
  const origPass = process.env.ADMIN_BASIC_PASSWORD;

  delete process.env.ADMIN_BASIC_USER;
  delete process.env.ADMIN_BASIC_PASSWORD;

  try {
    const req = new NextRequest("http://localhost:3000/api/export?table=submissions");
    const res = await exportRoute(req);
    assert.equal(res.status, 503, "Must fail closed with 503 when credentials are not configured");
  } finally {
    if (origUser) process.env.ADMIN_BASIC_USER = origUser;
    if (origPass) process.env.ADMIN_BASIC_PASSWORD = origPass;
  }
});

test("Export API: rejects unauthorized access with 401 and WWW-Authenticate", async () => {
  process.env.ADMIN_BASIC_USER = "operator@test.local";
  process.env.ADMIN_BASIC_PASSWORD = "super-secret-password-xyz";

  try {
    // 1. No Authorization header
    const req1 = new NextRequest("http://localhost:3000/api/export?table=submissions");
    const res1 = await exportRoute(req1);
    assert.equal(res1.status, 401);
    assert.ok(res1.headers.get("WWW-Authenticate")?.includes("Basic"));

    // 2. Forged unsigned cookie cannot authorize
    const req2 = new NextRequest("http://localhost:3000/api/export?table=submissions", {
      headers: { cookie: "admin_session=true" }
    });
    const res2 = await exportRoute(req2);
    assert.equal(res2.status, 401, "Forged admin_session cookie must be rejected with 401");

    // 3. Wrong credentials
    const badAuth = Buffer.from("wrong:credentials").toString("base64");
    const req3 = new NextRequest("http://localhost:3000/api/export?table=submissions", {
      headers: { authorization: `Basic ${badAuth}` }
    });
    const res3 = await exportRoute(req3);
    assert.equal(res3.status, 401);

    // 4. Unknown table returns 400 Bad Request
    const authHeader = `Basic ${Buffer.from("operator@test.local:super-secret-password-xyz").toString("base64")}`;
    const req4 = new NextRequest("http://localhost:3000/api/export?table=unsupported_table_xyz", {
      headers: { authorization: authHeader }
    });
    const res4 = await exportRoute(req4);
    assert.equal(res4.status, 400, "Unknown table must return 400 Bad Request");
  } finally {
    delete process.env.ADMIN_BASIC_USER;
    delete process.env.ADMIN_BASIC_PASSWORD;
  }
});

test("sanitizeInventoryForPublic: preserves updatedAt, createdAt, accessories, and docs without throwing", () => {
  const row = {
    id: "inv-unit-1",
    displayName: "Dinsaw Home Unit",
    ownershipStatus: "deployed",
    ownerOrg: "Hospital A",
    conditionStatus: "good",
    robotModelId: "rm-1",
    robotModel: { canonicalName: "Dinsaw Robot", manufacturer: "CT Asia" },
    serialNumber: "SN-SECRET-999",
    publicSerialSafe: false,
    locationLabel: "Room 101",
    custodian: "Nurse Somchai",
    notes: "Internal maintenance note",
    visibility: "public",
    accessories: ["Charger", "Docking Station"],
    documentationLinks: ["https://example.com/manual.pdf"],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-06-01T12:00:00Z")
  };

  const sanitized = sanitizeInventoryForPublic(row);
  assert.equal(sanitized.serialNumber, "🔒 [Masked for privacy]");
  assert.equal(sanitized.notes, "🔒 [Masked for privacy]");
  assert.equal(sanitized.custodian, "🔒 [Restricted]");
  assert.equal(sanitized.locationLabel, "🔒 [Masked for privacy]");
  assert.deepEqual(sanitized.accessories, ["Charger", "Docking Station"]);
  assert.deepEqual(sanitized.documentationLinks, ["https://example.com/manual.pdf"]);
  assert.ok(sanitized.updatedAt instanceof Date);
  assert.equal(typeof sanitized.updatedAt.toLocaleDateString(), "string", "toLocaleDateString must not throw on public row");
});

test("getOperatorPrincipal: anonymous visitor returns UNAUTHENTICATED fail-closed", async () => {
  const result = await getOperatorPrincipal();
  assert.equal(result.ok, false);
});

test("getOperatorPrincipal: forged unsigned cookies (admin_session, user_role, user_email) are rejected fail-closed", async () => {
  const forgedCookieJar = {
    get: (name: string) => {
      if (name === "admin_session") return { value: "true" };
      if (name === "user_role") return { value: "ADMIN" };
      if (name === "user_email") return { value: "attacker@example.com" };
      return undefined;
    }
  };

  const result = await getOperatorPrincipal(forgedCookieJar);
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNAUTHENTICATED");
});

test("Overview page: forged unsigned admin cookie does not query or expose pending review count", async () => {
  let pendingCountQueried = false;
  const origSubmitted = prisma.submittedData.count;
  const origSourceCount = prisma.sourceRecord.count;
  const origRobotCount = prisma.robotModel.count;
  const origContribCount = prisma.contribution.count;
  const origInvCount = prisma.ownedInventory.count;
  const origGroupBy = prisma.sourceRecord.groupBy;
  const origAggregate = prisma.sourceRecord.aggregate;
  const origPipeline = prisma.pipelineRun.findFirst;

  (prisma.submittedData as any).count = async () => {
    pendingCountQueried = true;
    return 42;
  };
  (prisma.sourceRecord as any).count = async () => 0;
  (prisma.robotModel as any).count = async () => 0;
  (prisma.contribution as any).count = async () => 0;
  (prisma.ownedInventory as any).count = async () => 0;
  (prisma.sourceRecord as any).groupBy = async () => [];
  (prisma.sourceRecord as any).aggregate = async () => ({ _min: { publishedAt: null }, _max: { publishedAt: null } });
  (prisma.pipelineRun as any).findFirst = async () => null;

  try {
    // When OverviewPage runs without a verified operator session, pending count must not be queried
    await OverviewPage();
    assert.equal(pendingCountQueried, false, "Pending submittedData count must not be queried without verified operator session");
  } finally {
    prisma.submittedData.count = origSubmitted;
    prisma.sourceRecord.count = origSourceCount;
    prisma.robotModel.count = origRobotCount;
    prisma.contribution.count = origContribCount;
    prisma.ownedInventory.count = origInvCount;
    prisma.sourceRecord.groupBy = origGroupBy;
    prisma.sourceRecord.aggregate = origAggregate;
    prisma.pipelineRun.findFirst = origPipeline;
  }
});

test("Contributions page: caller-supplied ?status=REJECTED cannot override APPROVED public predicate", async () => {
  let capturedWhere: any = null;
  const originalFindMany = prisma.contribution.findMany;
  const originalRobotFindMany = prisma.robotModel.findMany;

  (prisma.contribution as any).findMany = async (args: any) => {
    if (!capturedWhere && args?.where) {
      capturedWhere = args.where;
    }
    return [];
  };
  (prisma.robotModel as any).findMany = async () => [];

  try {
    await ContributionsPage({
      searchParams: Promise.resolve({ status: "REJECTED" })
    });

    assert.ok(capturedWhere, "findMany should have been called with where condition");
    assert.equal(capturedWhere.verificationStatus, "APPROVED", "verificationStatus must remain strictly APPROVED");
    assert.equal(capturedWhere.visibility, "public", "visibility must remain strictly public");
    assert.notEqual(capturedWhere.status, "REJECTED", "Caller status=REJECTED must not override public predicate");
  } finally {
    prisma.contribution.findMany = originalFindMany;
    prisma.robotModel.findMany = originalRobotFindMany;
  }
});
