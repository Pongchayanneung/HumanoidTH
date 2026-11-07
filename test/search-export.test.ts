import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  cleanSearchText,
  detectLanguage,
  computeContentHash,
  computeDependencyHash,
  createSearchEvidence,
  MAX_BODY_CODE_POINTS
} from "../lib/search/text-utils";
import {
  PERMITTED_ORIGINS,
  EXCLUDED_ORIGINS,
  PUBLIC_FIELDS_BY_KIND,
  STRICTLY_EXCLUDED_FIELDS,
  isPermittedOrigin,
  hasAdmissionPolicy
} from "../lib/search/policy";
import {
  exportSearchCorpusFromSeed,
  createProbeSample
} from "../lib/search/exporter";
import {
  revalidateSearchDocument,
  revalidateSearchDocuments
} from "../lib/search/revalidation";
import type { SearchDocument } from "../lib/search/types";

test("F3 Policy: permitted origins and admission rules", () => {
  assert.equal(isPermittedOrigin("openalex"), true);
  assert.equal(isPermittedOrigin("web"), true);
  assert.equal(isPermittedOrigin("submission"), false);
  assert.equal(isPermittedOrigin("internal"), false);
  assert.equal(isPermittedOrigin("unknown-origin-foo"), false);

  assert.equal(hasAdmissionPolicy("source"), true);
  assert.equal(hasAdmissionPolicy("robot"), true);
  assert.equal(hasAdmissionPolicy("contribution"), true);
  assert.equal(hasAdmissionPolicy("perspective"), true);
  assert.equal(hasAdmissionPolicy("inventory"), true);
  assert.equal(hasAdmissionPolicy("relationship"), true);
  assert.equal(hasAdmissionPolicy("entity"), true);
});

test("F3 Text Utils: cleanSearchText strips placeholders and caps at 2,000 Unicode code points", () => {
  // Placeholder omission
  const placeholderResult = cleanSearchText("OpenAlex abstract metadata available.");
  assert.equal(placeholderResult.isPlaceholderOmitted, true);
  assert.equal(placeholderResult.cleanedText, "");

  // Empty string
  const emptyResult = cleanSearchText("");
  assert.equal(emptyResult.cleanedText, "");

  // Normal text
  const normalResult = cleanSearchText("  Humanoid robot assistance for hospital in Bangkok.  ");
  assert.equal(normalResult.cleanedText, "Humanoid robot assistance for hospital in Bangkok.");
  assert.equal(normalResult.isTruncated, false);

  // Unicode code points cap (Thai text with combining characters)
  const longThai = "หุ่นยนต์".repeat(500); // 8 * 500 = 4000 code points
  const truncatedResult = cleanSearchText(longThai);
  assert.equal(truncatedResult.isTruncated, true);
  assert.equal(Array.from(truncatedResult.cleanedText).length, MAX_BODY_CODE_POINTS);
});

test("F3 Language Detection: classifies Thai, English, and Mixed correctly", () => {
  assert.equal(detectLanguage("Dinsaw Robot is an AI healthcare robot."), "en");
  assert.equal(detectLanguage("หุ่นยนต์ดินสอเพื่อการดูแลผู้สูงอายุ"), "th");
  assert.equal(detectLanguage("Dinsaw Robot หุ่นยนต์ดินสอ AI healthcare ในไทย"), "mixed");
  assert.equal(detectLanguage(""), "unknown");
});

test("F3 Evidence and Hashes: computes deterministic hashes and evidence ranges", () => {
  const hash1 = computeContentHash({
    typedId: "source:1",
    title: "Test Title",
    body: "Test Body",
    url: "https://example.com"
  });
  const hash2 = computeContentHash({
    typedId: "source:1",
    title: "Test Title",
    body: "Test Body",
    url: "https://example.com"
  });
  const hash3 = computeContentHash({
    typedId: "source:1",
    title: "Test Title (Updated)",
    body: "Test Body",
    url: "https://example.com"
  });

  assert.equal(hash1, hash2);
  assert.notEqual(hash1, hash3);

  const evidence = createSearchEvidence({
    fieldName: "evidence_excerpt",
    originalText: "Sample text for offset testing",
    label: "Excerpt"
  });
  assert.equal(evidence.fieldName, "evidence_excerpt");
  assert.equal(evidence.startOffset, 0);
  assert.equal(evidence.endOffset, 30);
  assert.equal(evidence.coverage, "full");
});

test("F3 Corpus Exporter: exports eligible documents and correctly excludes non-eligible kinds", () => {
  const { documents, manifest, probe128 } = exportSearchCorpusFromSeed();

  // Basic counts
  assert.ok(documents.length > 5000, "Should export thousands of documents");
  assert.equal(manifest.counts.totalEligible, documents.length);
  assert.ok(manifest.counts.excluded >= 3, "Excluded at least jobs, submissions, and foreign robot");

  // Empty category reporting
  assert.ok(manifest.counts.emptyKinds.includes("inventory"), "Inventory is reported as empty kind");

  // Kinds coverage
  assert.ok(manifest.counts.byKind.source > 0);
  assert.ok(manifest.counts.byKind.robot > 0);
  assert.ok(manifest.counts.byKind.contribution > 0);
  assert.ok(manifest.counts.byKind.perspective > 0);
  assert.ok(manifest.counts.byKind.relationship > 0);
  assert.ok(manifest.counts.byKind.entity > 0);

  // Languages coverage
  assert.ok(manifest.counts.byLanguage.th > 0);
  assert.ok(manifest.counts.byLanguage.mixed > 0);
  assert.ok(manifest.counts.byLanguage.en > 0);

  // Foreign robot exclusion verification (Bumi humanoid robot from China without Thai connection)
  const bumiRobot = documents.find((d) => d.kind === "robot" && d.title.toLowerCase().includes("bumi"));
  assert.equal(bumiRobot, undefined, "Bumi foreign robot must be excluded from robot catalog");

  // Check that no private fields are leaked in metadata or body
  for (const doc of probe128) {
    for (const field of STRICTLY_EXCLUDED_FIELDS) {
      assert.equal(field in doc.metadata, false, `Field ${field} must not be present in metadata`);
    }
  }

  // Exact 128 probe sample verification
  assert.equal(probe128.length, 128, "Probe sample must contain exactly 128 documents");

  // Probe diversity verification
  const probeThai = probe128.filter((d) => d.language === "th");
  const probeMixed = probe128.filter((d) => d.language === "mixed");
  const probeRobots = probe128.filter((d) => d.kind === "robot");
  const probeContribs = probe128.filter((d) => d.kind === "contribution");
  const probePersp = probe128.filter((d) => d.kind === "perspective");

  assert.ok(probeThai.length > 0, "Probe must include Thai records");
  assert.ok(probeMixed.length > 0, "Probe must include Mixed records");
  assert.ok(probeRobots.length > 0, "Probe must include robot catalog records");
  assert.ok(probeContribs.length > 0, "Probe must include contribution records");
  assert.ok(probePersp.length > 0, "Probe must include perspective records");
});

test("F3 Output Files: documents.json, manifest.json, probe-128.json are valid on disk", () => {
  const docsPath = resolve(process.cwd(), "data", "search", "documents.json");
  const manifestPath = resolve(process.cwd(), "data", "search", "manifest.json");
  const probePath = resolve(process.cwd(), "data", "search", "probe-128.json");

  assert.ok(existsSync(docsPath), "documents.json must exist");
  assert.ok(existsSync(manifestPath), "manifest.json must exist");
  assert.ok(existsSync(probePath), "probe-128.json must exist");

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.manifestVersion, "1.0");
  assert.ok(manifest.recordsSha256.length === 64, "recordsSha256 must be valid SHA-256");

  const probe = JSON.parse(readFileSync(probePath, "utf8"));
  assert.equal(probe.length, 128);
});

test("F3 Revalidation: suppresses deleted, hidden, or modified records", async () => {
  const dummyDoc: SearchDocument = {
    typedId: "source:test-1",
    kind: "source",
    title: "Elderly Care Robotics",
    body: "Excerpt on hospital robot deployment.",
    retrievalText: "Elderly Care Robotics Excerpt on hospital robot deployment.",
    url: "https://example.com/source-1",
    groupId: "https://example.com/source-1",
    origin: "web",
    language: "en",
    isTitleOnly: false,
    isPartial: false,
    parentTypedId: null,
    contentHash: computeContentHash({
      typedId: "source:test-1",
      title: "Elderly Care Robotics",
      body: "Excerpt on hospital robot deployment.",
      url: "https://example.com/source-1",
      metadata: {}
    }),
    dependencyHash: computeDependencyHash(null),
    vectorRow: null,
    evidence: [],
    metadata: {}
  };

  // Mock Prisma Client
  const mockPrisma = {
    sourceRecord: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (where.id === "deleted-id") return null;
        if (where.id === "rejected-id") {
          return {
            id: "rejected-id",
            relevanceStatus: "REJECTED",
            title: "Elderly Care Robotics",
            excerpt: "Excerpt on hospital robot deployment.",
            url: "https://example.com/source-1"
          };
        }
        if (where.id === "changed-id") {
          return {
            id: "changed-id",
            relevanceStatus: "ACCEPTED",
            title: "Modified Title",
            excerpt: "Changed excerpt.",
            url: "https://example.com/source-1"
          };
        }
        return {
          id: "test-1",
          relevanceStatus: "ACCEPTED",
          title: "Elderly Care Robotics",
          excerpt: "Excerpt on hospital robot deployment.",
          url: "https://example.com/source-1"
        };
      }
    }
  };

  // 1. Valid record
  const resValid = await revalidateSearchDocument(dummyDoc, mockPrisma);
  assert.equal(resValid.isValid, true);

  // 2. Deleted record
  const deletedDoc = { ...dummyDoc, typedId: "source:deleted-id" };
  const resDeleted = await revalidateSearchDocument(deletedDoc, mockPrisma);
  assert.equal(resDeleted.isValid, false);
  assert.equal(resDeleted.reason, "DELETED");

  // 3. Ineligible status
  const rejectedDoc = { ...dummyDoc, typedId: "source:rejected-id" };
  const resRejected = await revalidateSearchDocument(rejectedDoc, mockPrisma);
  assert.equal(resRejected.isValid, false);
  assert.equal(resRejected.reason, "STATUS_INELIGIBLE");

  // 4. Content changed
  const changedDoc = { ...dummyDoc, typedId: "source:changed-id" };
  const resChanged = await revalidateSearchDocument(changedDoc, mockPrisma);
  assert.equal(resChanged.isValid, false);
  assert.equal(resChanged.reason, "CONTENT_CHANGED");

  // 5. Batch revalidation
  const batchResult = await revalidateSearchDocuments(
    [dummyDoc, deletedDoc, rejectedDoc, changedDoc],
    mockPrisma
  );
  assert.equal(batchResult.validDocs.length, 1);
  assert.equal(batchResult.suppressedDocs.length, 3);
});
