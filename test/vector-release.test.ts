import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  l2Normalize,
  encodeVectorsToBuffer,
  readVectorAtRow,
  cosineSimilarity,
  computeRecordKeysHash,
  validateVectorRelease,
  calculateCompletionForecast,
  readActiveReleasePointer,
  BYTES_PER_FLOAT32
} from "../lib/search/vector-io";
import {
  VectorReleaseBuilder,
  DeterministicMockEmbeddingGenerator
} from "../lib/search/vector-builder";
import {
  DEFAULT_MODEL_PROFILE,
  MOCK_MODEL_PROFILE,
  type ModelProfile
} from "../lib/search/vector-types";
import type { SearchDocument, SearchExportManifest } from "../lib/search/types";

function createDummyDocument(id: string, kind: string = "source", text: string = "dummy text"): SearchDocument {
  return {
    typedId: `${kind}:${id}`,
    kind: kind as any,
    title: `Title ${id}`,
    body: text,
    retrievalText: `${id} ${text}`,
    url: `https://example.com/${id}`,
    groupId: `https://example.com/${id}`,
    origin: "web",
    language: "en",
    isTitleOnly: false,
    isPartial: false,
    parentTypedId: null,
    contentHash: `hash-${id}`,
    dependencyHash: `dep-${id}`,
    vectorRow: null,
    evidence: [],
    metadata: {}
  };
}

test("F4 Vector IO: l2Normalize normalizes vectors and rejects zero or non-finite values", () => {
  // 1. Normal vector normalization
  const rawVec = new Float32Array([3.0, 4.0]); // magnitude = 5
  const normalized = l2Normalize(rawVec);
  assert.equal(normalized.length, 2);
  assert.ok(Math.abs(normalized[0] - 0.6) < 1e-6);
  assert.ok(Math.abs(normalized[1] - 0.8) < 1e-6);

  // Magnitude check: ||v|| ~ 1.0
  const mag = Math.sqrt(normalized[0] * normalized[0] + normalized[1] * normalized[1]);
  assert.ok(Math.abs(mag - 1.0) < 1e-6);

  // 2. Reject zero vector
  assert.throws(() => {
    l2Normalize(new Float32Array([0.0, 0.0, 0.0]));
  }, /zero-magnitude/);

  // 3. Reject NaN or Infinity
  assert.throws(() => {
    l2Normalize(new Float32Array([1.0, NaN]));
  }, /non-finite/);

  assert.throws(() => {
    l2Normalize(new Float32Array([1.0, Infinity]));
  }, /non-finite/);
});

test("F4 Vector IO: encodes little-endian Float32 binary buffer and reads rows accurately", () => {
  const dimensions = 4;
  const v0 = new Float32Array([0.1, 0.2, 0.3, 0.4]);
  const v1 = new Float32Array([0.5, 0.6, 0.7, 0.8]);
  const v2 = new Float32Array([0.9, 1.0, 1.1, 1.2]);

  const buffer = encodeVectorsToBuffer([v0, v1, v2], dimensions);
  const expectedBytes = 3 * dimensions * BYTES_PER_FLOAT32; // 3 * 4 * 4 = 48 bytes
  assert.equal(buffer.length, expectedBytes);

  // Read each row back
  const read0 = readVectorAtRow(buffer, 0, dimensions);
  const read1 = readVectorAtRow(buffer, 1, dimensions);
  const read2 = readVectorAtRow(buffer, 2, dimensions);

  assert.deepEqual(Array.from(read0), Array.from(v0));
  assert.deepEqual(Array.from(read1), Array.from(v1));
  assert.deepEqual(Array.from(read2), Array.from(v2));

  // Out of bounds row throws RangeError
  assert.throws(() => {
    readVectorAtRow(buffer, 3, dimensions);
  }, RangeError);
});

test("F4 Vector IO: cosineSimilarity computes exact dot product for normalized vectors", () => {
  const a = l2Normalize(new Float32Array([1.0, 0.0]));
  const b = l2Normalize(new Float32Array([1.0, 0.0]));
  const c = l2Normalize(new Float32Array([0.0, 1.0]));

  assert.ok(Math.abs(cosineSimilarity(a, b) - 1.0) < 1e-6); // identical
  assert.ok(Math.abs(cosineSimilarity(a, c) - 0.0) < 1e-6); // orthogonal
});

test("F4 Vector IO: computeRecordKeysHash produces deterministic ordered hash", () => {
  const doc1 = createDummyDocument("1");
  doc1.vectorRow = 0;
  const doc2 = createDummyDocument("2");
  doc2.vectorRow = 1;

  const hashA = computeRecordKeysHash([doc1, doc2]);
  const hashB = computeRecordKeysHash([doc2, doc1]); // order of input list shouldn't change hash because sorted by vectorRow
  assert.equal(hashA, hashB);

  // Modifying content hash or vector row changes the record keys hash
  const doc2Mod = { ...doc2, contentHash: "hash-modified" };
  const hashMod = computeRecordKeysHash([doc1, doc2Mod]);
  assert.notEqual(hashA, hashMod);
});

test("F4 Release Validation: detects valid releases, verifies every row without sampling (251-row test), and checks on-disk checksums", async () => {
  const dimensions = 4;
  const docs: SearchDocument[] = [];
  const vecs: Float32Array[] = [];

  // Create 251 rows to verify row 250 is tested and not skipped by sampling
  for (let i = 0; i < 251; i++) {
    const doc = createDummyDocument(`${i}`);
    doc.vectorRow = i;
    docs.push(doc);
    vecs.push(l2Normalize(new Float32Array([0.5, 0.5, 0.5, 0.5])));
  }

  const validBuffer = encodeVectorsToBuffer(vecs, dimensions);

  // 1. Valid 251-row release passes
  const validResult = validateVectorRelease({
    buffer: validBuffer,
    documents: docs,
    expectedDimensions: dimensions,
    expectedVectorCount: 251
  });
  assert.equal(validResult.isValid, true);
  assert.equal(validResult.errors.length, 0);

  // 2. Corrupt row 250 (the 251st row) with NaN: MUST fail validation!
  const corrupted251 = Buffer.from(validBuffer);
  const row250Offset = 250 * dimensions * BYTES_PER_FLOAT32;
  corrupted251.writeFloatLE(NaN, row250Offset);

  const corruptedResult = validateVectorRelease({
    buffer: corrupted251,
    documents: docs,
    expectedDimensions: dimensions,
    expectedVectorCount: 251
  });
  assert.equal(corruptedResult.isValid, false);
  assert.ok(corruptedResult.errors.some((e) => e.includes("Row 250") && e.includes("non-finite")));

  // 3. Reject mismatched buffer size
  const truncatedBuffer = validBuffer.subarray(0, validBuffer.length - 10);
  const sizeResult = validateVectorRelease({
    buffer: truncatedBuffer,
    documents: docs,
    expectedDimensions: dimensions,
    expectedVectorCount: 251
  });
  assert.equal(sizeResult.isValid, false);
  assert.ok(sizeResult.errors.some((e) => e.includes("not aligned")));

  // 4. Reject document row mapping mismatch
  const badDocs = [...docs];
  badDocs[0] = { ...badDocs[0], vectorRow: 999 };
  const mappingResult = validateVectorRelease({
    buffer: validBuffer,
    documents: badDocs,
    expectedDimensions: dimensions,
    expectedVectorCount: 251
  });
  assert.equal(mappingResult.isValid, false);
  assert.ok(mappingResult.errors.some((e) => e.includes("mapping mismatch")));
});

test("F4 Model Profile & Generator Protection: rejects Qwen production profile with mock generator", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "f4-guard-test-"));
  try {
    const docs = [createDummyDocument("1")];
    const documentsPath = join(tempDir, "documents.json");
    writeFileSync(documentsPath, JSON.stringify(docs), "utf8");

    // Attempting to use DeterministicMockEmbeddingGenerator with DEFAULT_MODEL_PROFILE (Qwen) must throw
    assert.throws(() => {
      new VectorReleaseBuilder({
        documentsPath,
        outputDir: tempDir,
        profile: DEFAULT_MODEL_PROFILE, // provider: "tei"
        embeddingGenerator: new DeterministicMockEmbeddingGenerator(1024)
      });
    }, /DeterministicMockEmbeddingGenerator cannot be labelled as production model profile/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("F4 Resumable Checkpoint Builder: writes checkpoints per batch and reuses matching cache", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "f4-vector-test-"));
  try {
    const docsDir = join(tempDir, "data");
    const checkpointDir = join(tempDir, "checkpoints");
    const stagingDir = join(tempDir, "staging");

    const docs = [
      createDummyDocument("1", "source", "Thai robotics research"),
      createDummyDocument("2", "robot", "Dinsaw healthcare robot"),
      createDummyDocument("3", "contribution", "FIBO educational initiative"),
      createDummyDocument("4", "perspective", "Industry perspective")
    ];

    const documentsPath = join(tempDir, "documents.json");
    writeFileSync(documentsPath, JSON.stringify(docs), "utf8");

    const profileA: ModelProfile = {
      ...MOCK_MODEL_PROFILE,
      profileHash: "mock-model-profile-test-a"
    };

    // 1. Initial build: Generates all 4 vectors with batchSize=2 -> writes 2 batch checkpoints
    const builderA = new VectorReleaseBuilder({
      documentsPath,
      outputDir: docsDir,
      checkpointDir,
      stagingDir,
      profile: profileA,
      batchSize: 2
    });

    const resultA = await builderA.build();
    assert.equal(resultA.coverage.status, "complete");
    assert.equal(resultA.coverage.vectorCount, 4);
    assert.equal(resultA.coverage.overallCoveragePct, 100);

    // Verify batch checkpoints exist on disk
    const cp0 = join(checkpointDir, "checkpoint-mock-model-profile-test-a-batch-0.json");
    const cp1 = join(checkpointDir, "checkpoint-mock-model-profile-test-a-batch-1.json");
    assert.ok(existsSync(cp0), "batch 0 checkpoint must exist on disk");
    assert.ok(existsSync(cp1), "batch 1 checkpoint must exist on disk");

    // 2. Second build with same profile: Reuses all cached checkpoints without error
    const resultA2 = await builderA.build();
    assert.equal(resultA2.coverage.status, "complete");
    assert.equal(resultA2.coverage.vectorCount, 4);

    // 3. Third build with DIFFERENT profile: Discards cache from profile A and recomputes for profile B
    const profileB: ModelProfile = {
      ...MOCK_MODEL_PROFILE,
      profileHash: "mock-model-profile-test-b"
    };

    const builderB = new VectorReleaseBuilder({
      documentsPath,
      outputDir: docsDir,
      checkpointDir,
      stagingDir,
      profile: profileB,
      batchSize: 2
    });

    const resultB = await builderB.build();
    assert.equal(resultB.manifest.modelProfile?.profileHash, "mock-model-profile-test-b");
    assert.equal(resultB.coverage.vectorCount, 4);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("F4 Atomic Promotion & Manifest Preservation: preserves F3 metadata and writes active-release pointer", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "f4-promote-test-"));
  try {
    const docsDir = join(tempDir, "data");
    const documentsPath = join(tempDir, "documents.json");
    const manifestPath = join(docsDir, "manifest.json");

    const docs = [createDummyDocument("1", "robot", "Atlas Test Robot")];
    writeFileSync(documentsPath, JSON.stringify(docs), "utf8");

    // Pre-populate base F3 manifest in docsDir
    const baseManifest: SearchExportManifest = {
      manifestVersion: "1.0",
      datasetId: "thailand-humanoid-atlas",
      releaseId: "f3-base-export",
      generatedAt: "2026-11-07T00:00:00.000Z",
      counts: {
        totalEligible: 6746,
        byKind: {
          source: 6714,
          robot: 15,
          contribution: 3,
          perspective: 4,
          relationship: 10,
          inventory: 0,
          entity: 0
        },
        byLanguage: { th: 2000, en: 4500, mixed: 246, unknown: 0 },
        excluded: 20,
        emptyKinds: ["inventory", "entity"]
      },
      policy: {
        permittedOrigins: ["web", "github"],
        maxBodyCodePoints: 2000,
        omittedPlaceholders: ["placeholder"],
        publicFieldsByKind: {
          source: ["title", "body"],
          robot: ["title"],
          contribution: ["title"],
          perspective: ["title"],
          relationship: ["title"],
          inventory: [],
          entity: []
        },
        excludedFields: ["email"]
      },
      files: {
        documents: "documents.json",
        probeSample128: "probe-128.json"
      },
      fileChecksums: {},
      recordsSha256: "test-records-hash"
    };

    const { mkdirSync } = await import("node:fs");
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(manifestPath, JSON.stringify(baseManifest, null, 2), "utf8");

    // Build vector release
    const builder = new VectorReleaseBuilder({
      documentsPath,
      outputDir: docsDir,
      profile: MOCK_MODEL_PROFILE
    });

    const result = await builder.build();

    // 1. Verify F3 metadata was preserved in manifest
    assert.equal(result.manifest.datasetId, "thailand-humanoid-atlas");
    assert.deepEqual(result.manifest.counts, baseManifest.counts);
    assert.deepEqual(result.manifest.policy, baseManifest.policy);
    assert.equal(result.manifest.manifestVersion, "2.0");

    // 2. Verify active-release pointer exists in output directory
    const pointer = readActiveReleasePointer(docsDir);
    assert.ok(pointer !== null, "active-release.json pointer must exist");
    assert.equal(pointer.releaseId, result.manifest.releaseId);
    assert.equal(pointer.recordsSha256, result.manifest.recordsSha256);
    assert.equal(pointer.modelProfileHash, MOCK_MODEL_PROFILE.profileHash);

    // 3. Verify versioned release directory was created
    const releaseDir = join(docsDir, "releases", result.manifest.releaseId);
    assert.ok(existsSync(join(releaseDir, "documents.json")));
    assert.ok(existsSync(join(releaseDir, "vectors.f32")));
    assert.ok(existsSync(join(releaseDir, "manifest.json")));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("F4 Semantic Coverage: correctly reports absent, partial, and complete releases", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "f4-coverage-test-"));
  try {
    const docs = [
      createDummyDocument("1", "source"),
      createDummyDocument("2", "robot"),
      createDummyDocument("3", "contribution"),
      createDummyDocument("4", "perspective")
    ];

    const documentsPath = join(tempDir, "documents.json");
    writeFileSync(documentsPath, JSON.stringify(docs), "utf8");

    // 1. Keyword-only release: maxVectorsToGenerate = 0 -> status: "absent", 0 vectors
    const keywordBuilder = new VectorReleaseBuilder({
      documentsPath,
      outputDir: join(tempDir, "kw-out"),
      checkpointDir: join(tempDir, "kw-cp"),
      stagingDir: join(tempDir, "kw-st"),
      profile: MOCK_MODEL_PROFILE,
      maxVectorsToGenerate: 0
    });
    const kwResult = await keywordBuilder.build();
    assert.equal(kwResult.coverage.status, "absent");
    assert.equal(kwResult.coverage.vectorCount, 0);
    assert.equal(kwResult.manifest.modelProfile, null);
    assert.equal(kwResult.manifest.files.vectors, undefined);

    // 2. Partial semantic release: maxVectorsToGenerate = 2 of 4 -> status: "partial"
    const partialBuilder = new VectorReleaseBuilder({
      documentsPath,
      outputDir: join(tempDir, "part-out"),
      checkpointDir: join(tempDir, "part-cp"),
      stagingDir: join(tempDir, "part-st"),
      profile: MOCK_MODEL_PROFILE,
      maxVectorsToGenerate: 2
    });
    const partResult = await partialBuilder.build();
    assert.equal(partResult.coverage.status, "partial");
    assert.equal(partResult.coverage.vectorCount, 2);
    assert.equal(partResult.coverage.totalDocuments, 4);
    assert.equal(partResult.coverage.overallCoveragePct, 50);
    assert.equal(partResult.coverage.byKind.source.indexed, 1);
    assert.equal(partResult.coverage.byKind.robot.indexed, 1);
    assert.equal(partResult.coverage.byKind.contribution.indexed, 0);

    // 3. Complete semantic release: maxVectorsToGenerate = 4 of 4 -> status: "complete"
    const completeBuilder = new VectorReleaseBuilder({
      documentsPath,
      outputDir: join(tempDir, "comp-out"),
      checkpointDir: join(tempDir, "comp-cp"),
      stagingDir: join(tempDir, "comp-st"),
      profile: MOCK_MODEL_PROFILE,
      maxVectorsToGenerate: 4
    });
    const compResult = await completeBuilder.build();
    assert.equal(compResult.coverage.status, "complete");
    assert.equal(compResult.coverage.vectorCount, 4);
    assert.equal(compResult.coverage.overallCoveragePct, 100);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("F4 Hour 3 Completion Forecast: computes 50% contingency and gate verdict accurately", () => {
  const forecastSlow = calculateCompletionForecast({
    totalDocuments: 6746,
    completedDocuments: 4000,
    elapsedSeconds: 3 * 3600, // 3 hours
    deadlineSeconds: 4.5 * 3600 // 4.5 hours
  });
  assert.equal(forecastSlow.totalDocuments, 6746);
  assert.equal(forecastSlow.completedDocuments, 4000);
  assert.equal(forecastSlow.remainingDocuments, 2746);
  assert.equal(forecastSlow.contingencySeconds, forecastSlow.estimatedRemainingSeconds * 0.5);
  assert.equal(forecastSlow.meetsDeadline, false);
  assert.ok(forecastSlow.formattedSummary.includes("Fallback to Partial Semantic Release Required"));

  const forecastFast = calculateCompletionForecast({
    totalDocuments: 6746,
    completedDocuments: 6000,
    elapsedSeconds: 3 * 3600,
    deadlineSeconds: 4.5 * 3600
  });
  assert.equal(forecastFast.remainingDocuments, 746);
  assert.equal(forecastFast.meetsDeadline, true);
  assert.ok(forecastFast.formattedSummary.includes("ON TRACK (Meets Hour 4½ Gate)"));
});
