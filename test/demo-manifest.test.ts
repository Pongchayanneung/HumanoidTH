import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  loadCheckedDemoManifest,
  isPublicCheckedRecord,
  isPublicCheckedUrl,
  isExcludedDemoRecord,
  getPublicCheckedRecords,
  validateCheckedDemoManifest,
  CANONICAL_CORPUS_LF_SHA256,
  type CheckedManifest
} from "../lib/manifest/demo-manifest";

test("demo manifest loads and passes structural validation", () => {
  const manifest = loadCheckedDemoManifest();

  assert.equal(manifest.manifestVersion, "1.0.0");
  assert.equal(manifest.datasetId, "thailand-humanoid-atlas-checked-demo-v1");
  assert.equal(manifest.counts.checkedPublicRecords, 29);
  assert.equal(manifest.counts.robotModels, 11);
  assert.equal(manifest.counts.contributions, 3);
  assert.equal(manifest.counts.sourceRecords, 8);
  assert.equal(manifest.counts.tripletRelations, 5);
  assert.equal(manifest.counts.perspectiveAnnotations, 2);
  assert.equal(manifest.counts.excludedDocumentedRecords, 7);
  assert.equal(manifest.records.length, 29);
  assert.equal(manifest.excludedRecords.length, 7);
});

test("demonstration dataset contains useful source-backed public records", () => {
  const manifest = loadCheckedDemoManifest();

  // Robot models verification
  const robotModels = manifest.records.filter((r) => r.recordType === "robot_model");
  assert.equal(robotModels.length, 11);

  const dinsaw = robotModels.find((r) => r.typedId === "robot_model:dinsaw-robot");
  assert.ok(dinsaw, "Dinsaw Robot must be present");
  assert.equal(dinsaw?.title, "Dinsaw Robot");
  assert.equal(dinsaw?.origin, "Thailand");

  const pinto = robotModels.find((r) => r.typedId === "robot_model:pinto-robot");
  assert.ok(pinto, "Pinto Robot must be present");

  // Contributions verification
  const contributions = manifest.records.filter((r) => r.recordType === "contribution");
  assert.equal(contributions.length, 3);

  // Sources verification
  const sources = manifest.records.filter((r) => r.recordType === "source_record");
  assert.equal(sources.length, 8);

  // Triplets verification
  const triplets = manifest.records.filter((r) => r.recordType === "triplet");
  assert.equal(triplets.length, 5);

  // Perspectives verification
  const perspectives = manifest.records.filter((r) => r.recordType === "perspective_annotation");
  assert.equal(perspectives.length, 2);
});

test("every checked record has required factual verification fields", () => {
  const manifest = loadCheckedDemoManifest();

  for (const record of manifest.records) {
    assert.ok(record.typedId.includes(":"), "typedId must follow format type:slug");
    assert.ok(
      record.canonicalUrl.startsWith("http://") || record.canonicalUrl.startsWith("https://"),
      "canonicalUrl must be a valid http(s) URL"
    );
    assert.ok(record.title.length > 0, "title must be non-empty");
    assert.ok(record.checkedClaims.length > 0, "must have at least one checked claim");
    assert.equal(record.reviewer, "Suk-Nsr", "Auditor / Reviewer must be recorded");
    assert.ok(
      /^\d{4}-\d{2}-\d{2}$/.test(record.reviewedDate),
      "reviewedDate must follow YYYY-MM-DD format"
    );
    assert.ok(
      typeof record.uncertainty === "number" &&
        record.uncertainty >= 0 &&
        record.uncertainty <= 0.3,
      "Demonstration records must have uncertainty <= 0.3"
    );
    assert.equal(record.publicEligibility, true, "Checked records must be public-eligible");
    assert.ok(record.evidence.length > 0, "evidence field must be non-empty");
  }
});

test("explicitly excludes placeholders, duplicates, and unverified claims", () => {
  assert.equal(isExcludedDemoRecord("seed:contribution:thai-hri-research"), true);
  assert.equal(isPublicCheckedRecord("seed:contribution:thai-hri-research"), false);

  assert.equal(isExcludedDemoRecord("seed:contribution:hospital-field-observation"), true);
  assert.equal(isPublicCheckedRecord("seed:contribution:hospital-field-observation"), false);

  assert.equal(isExcludedDemoRecord("robot_model:bumi-humanoid-robot"), true);
  assert.equal(isPublicCheckedRecord("robot_model:bumi-humanoid-robot"), false);

  assert.equal(isExcludedDemoRecord("robot_model:ubtech-walker"), true);
  assert.equal(isPublicCheckedRecord("robot_model:ubtech-walker"), false);

  assert.equal(isExcludedDemoRecord("robot_model:hospital-delivery-service-robot"), true);
  assert.equal(isPublicCheckedRecord("robot_model:hospital-delivery-service-robot"), false);

  // Pending submissions requiring admin review must not be auto-published
  assert.equal(isExcludedDemoRecord("submission:robo-buddy"), true);
  assert.equal(isPublicCheckedRecord("submission:robo-buddy"), false);
});

test("preserves the original corpus without modification (LF canonical hash)", () => {
  const corpusPath = resolve(process.cwd(), "thailand_humanoid_atlas_seed_records.json");
  assert.ok(existsSync(corpusPath), "Original corpus file must exist");

  const rawText = readFileSync(corpusPath, "utf8");
  // Normalize CRLF to LF to match git object representation across all OS platforms
  const normalizedLf = rawText.replace(/\r\n/g, "\n");
  const actualHash = createHash("sha256").update(normalizedLf, "utf8").digest("hex");

  const manifest = loadCheckedDemoManifest();
  assert.equal(
    actualHash,
    CANONICAL_CORPUS_LF_SHA256,
    "Computed LF SHA-256 hash must match canonical git LF hash"
  );
  assert.equal(
    manifest.originalCorpus.sha256,
    CANONICAL_CORPUS_LF_SHA256,
    "Manifest recorded hash must match canonical git LF hash"
  );
  assert.equal(manifest.originalCorpus.preserved, true);
});

test("query helpers return expected records and reject unknown identifiers", () => {
  // Membership by exact typedId
  assert.equal(isPublicCheckedRecord("robot_model:dinsaw-robot"), true);
  assert.equal(isPublicCheckedRecord("robot_model:nonexistent-fake-robot"), false);

  // URL lookups do NOT grant membership to isPublicCheckedRecord
  assert.equal(isPublicCheckedRecord("https://www.ctasia.com/about-us/"), false);

  // Separate isPublicCheckedUrl provides URL citation check
  assert.equal(isPublicCheckedUrl("https://www.ctasia.com/about-us/"), true);
  assert.equal(isPublicCheckedUrl("https://fake-url-not-in-manifest.com"), false);

  // Excluded records sharing URL with a public record cannot bypass membership
  assert.equal(isPublicCheckedRecord("submission:robo-buddy"), false);
  assert.equal(isExcludedDemoRecord("submission:robo-buddy"), true);
});

test("cache mutation safety: mutating returned records does not affect subsequent queries", () => {
  const records = getPublicCheckedRecords();
  const initialLength = records.length;
  assert.equal(initialLength, 29);

  // Mutate returned array
  records.pop();
  records.pop();
  assert.equal(records.length, 27);

  // Subsequent call must still return full 29 records
  const freshRecords = getPublicCheckedRecords();
  assert.equal(freshRecords.length, 29);
});

test("validateCheckedDemoManifest: strict schema validation and negative cases", () => {
  const validManifest = loadCheckedDemoManifest();

  // 1. Should pass on valid manifest
  assert.doesNotThrow(() => validateCheckedDemoManifest(validManifest));

  // 2. Reject bad recordType
  const badTypeManifest: CheckedManifest = structuredClone(validManifest);
  (badTypeManifest.records[0] as any).recordType = "banana";
  assert.throws(() => validateCheckedDemoManifest(badTypeManifest), /unknown recordType/);

  // 3. Reject bad typedId prefix
  const mismatchedPrefixManifest: CheckedManifest = structuredClone(validManifest);
  mismatchedPrefixManifest.records[0].typedId = "contribution:dinsaw-robot";
  assert.throws(() => validateCheckedDemoManifest(mismatchedPrefixManifest), /prefix does not match/);

  // 4. Reject malformed URL (e.g. javascript:alert(1))
  const xssUrlManifest: CheckedManifest = structuredClone(validManifest);
  xssUrlManifest.records[0].canonicalUrl = "javascript:alert(1)";
  assert.throws(() => validateCheckedDemoManifest(xssUrlManifest), /invalid canonicalUrl/);

  // 5. Reject invalid reviewedDate
  const badDateManifest: CheckedManifest = structuredClone(validManifest);
  badDateManifest.records[0].reviewedDate = "yesterday";
  assert.throws(() => validateCheckedDemoManifest(badDateManifest), /invalid reviewedDate/);

  // 6. Reject non-string claim
  const nonStringClaimManifest: CheckedManifest = structuredClone(validManifest);
  (nonStringClaimManifest.records[0].checkedClaims as any) = ["Valid claim", 12345];
  assert.throws(() => validateCheckedDemoManifest(nonStringClaimManifest), /non-string claim/);

  // 7. Reject empty evidence
  const emptyEvidenceManifest: CheckedManifest = structuredClone(validManifest);
  emptyEvidenceManifest.records[0].evidence = "";
  assert.throws(() => validateCheckedDemoManifest(emptyEvidenceManifest), /non-empty evidence/);

  // 8. Reject count mismatch
  const wrongCountManifest: CheckedManifest = structuredClone(validManifest);
  wrongCountManifest.counts.checkedPublicRecords = 999;
  assert.throws(() => validateCheckedDemoManifest(wrongCountManifest), /Counts mismatch/);

  // 9. Reject wrong corpus hash
  const wrongHashManifest: CheckedManifest = structuredClone(validManifest);
  wrongHashManifest.originalCorpus.sha256 = "deadbeef1234";
  assert.throws(() => validateCheckedDemoManifest(wrongHashManifest), /sha256 mismatch/);
});
