import assert from "node:assert/strict";
import { test } from "node:test";
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

test("public-data projection rules enforce mandatory public fields", () => {
  assert.equal(publicContributionWhere.visibility, "public");
  assert.equal(publicContributionWhere.verificationStatus, "APPROVED");
  assert.equal(publicInventoryWhere.visibility, "public");
  assert.equal(publicSourceRecordWhere.relevanceStatus, "ACCEPTED");
  assert.equal(publicPerspectiveWhere.source.relevanceStatus, "ACCEPTED");
  assert.ok(PUBLIC_DATASET_SCOPE_LABEL.includes("2026-11-07"));
});

test("sanitizeInventoryForPublic masks sensitive hardware fields", () => {
  const privateItem = {
    displayName: "Dinsaw Unit 1",
    serialNumber: "SN-98234-CTASIA",
    publicSerialSafe: false,
    locationLabel: "Building 4, Chulalongkorn Hospital Room 302",
    custodian: "Dr. Somchai (somchai@hospital.th)",
    notes: "Internal calibration log: motor replaced 2026-08-12",
    visibility: "private"
  };

  const sanitized = sanitizeInventoryForPublic(privateItem);
  assert.ok(sanitized.serialNumber?.includes("Masked"), "Serial number must be masked when not public-safe");
  assert.ok(sanitized.locationLabel?.includes("Masked"), "Exact location must be masked");
  assert.ok(sanitized.custodian?.includes("Restricted"), "Custodian details must be restricted");
  assert.ok(sanitized.notes?.includes("Masked"), "Internal notes must be masked");

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
