import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadCheckedDemoManifest,
  isPublicCheckedRecord,
  isExcludedDemoRecord,
  getPublicCheckedRecords,
  validateCheckedDemoManifest
} from "../lib/manifest/demo-manifest";

test("demo manifest loads and passes structural validation", () => {
  const manifest = loadCheckedDemoManifest();
  assert.ok(manifest, "Manifest should load successfully");
  assert.equal(manifest.manifestVersion, "1.0.0");
  assert.equal(manifest.datasetId, "thailand-humanoid-atlas-checked-demo-v1");
  assert.equal(manifest.reviewer, "Suk-Nsr");
  assert.doesNotThrow(() => validateCheckedDemoManifest(manifest));
});

test("demonstration dataset contains useful source-backed public records", () => {
  const publicRecords = getPublicCheckedRecords();
  assert.ok(publicRecords.length >= 20, "Should contain at least 20 checked records");

  const robots = getPublicCheckedRecords("robot_model");
  assert.ok(robots.length >= 10, "Should contain verified Thai robot models");
  assert.ok(
    robots.some((r) => r.typedId === "robot_model:dinsaw-robot"),
    "Must include Dinsaw Robot"
  );
  assert.ok(
    robots.some((r) => r.typedId === "robot_model:pinto-robot"),
    "Must include Pinto Robot"
  );

  const contributions = getPublicCheckedRecords("contribution");
  assert.ok(contributions.length >= 3, "Should contain verified contributions");

  const sources = getPublicCheckedRecords("source_record");
  assert.ok(sources.length >= 5, "Should contain verified source records");
});

test("every checked record has required factual verification fields", () => {
  const publicRecords = getPublicCheckedRecords();

  for (const record of publicRecords) {
    assert.ok(record.typedId.includes(":"), `typedId must have format type:name: ${record.typedId}`);
    assert.ok(record.canonicalUrl.startsWith("http"), `canonicalUrl must be HTTP(S): ${record.canonicalUrl}`);
    assert.ok(record.title.length > 0, `title must not be empty`);
    assert.ok(record.checkedClaims.length > 0, `checkedClaims must not be empty for ${record.typedId}`);
    assert.equal(record.reviewer, "Suk-Nsr", `reviewer must be identifiable human reviewer`);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(record.reviewedDate), `reviewedDate must be ISO date: ${record.reviewedDate}`);
    assert.ok(record.uncertainty >= 0 && record.uncertainty <= 0.3, `uncertainty must be calibrated: ${record.uncertainty}`);
    assert.equal(record.publicEligibility, true, `public record must have publicEligibility: true`);
    assert.ok(record.evidence.length > 0, `evidence must not be empty for ${record.typedId}`);
  }
});

test("explicitly excludes placeholders, duplicates, and unverified claims", () => {
  // Acceptance check: Placeholders like seed:contribution:thai-hri-research must be excluded
  assert.equal(
    isExcludedDemoRecord("seed:contribution:thai-hri-research"),
    true,
    "seed:contribution:thai-hri-research must be in excluded list"
  );
  assert.equal(
    isPublicCheckedRecord("seed:contribution:thai-hri-research"),
    false,
    "seed:contribution:thai-hri-research must NOT be a public checked record"
  );

  // Unverified foreign robots and generic buckets must be excluded
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

test("preserves the original corpus without modification", () => {
  const corpusPath = resolve(process.cwd(), "thailand_humanoid_atlas_seed_records.json");
  assert.ok(existsSync(corpusPath), "Original corpus file must exist");

  const content = readFileSync(corpusPath);
  const actualHash = createHash("sha256").update(content).digest("hex");

  const manifest = loadCheckedDemoManifest();
  assert.equal(
    actualHash,
    manifest.originalCorpus.sha256,
    "Original corpus SHA-256 hash must match manifest recorded hash"
  );
  assert.equal(manifest.originalCorpus.preserved, true);
});

test("query helpers return expected records and reject unknown identifiers", () => {
  assert.equal(isPublicCheckedRecord("robot_model:dinsaw-robot"), true);
  assert.equal(isPublicCheckedRecord("https://www.ctasia.com/about-us/"), true);

  assert.equal(isPublicCheckedRecord("robot_model:nonexistent-fake-robot"), false);
  assert.equal(isPublicCheckedRecord("https://fake-url-not-in-manifest.com"), false);
});
