import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
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
  BYTES_PER_FLOAT32
} from "../lib/search/vector-io";
import {
  VectorReleaseBuilder,
  DeterministicMockEmbeddingGenerator
} from "../lib/search/vector-builder";
import {
  DEFAULT_MODEL_PROFILE,
  type ModelProfile
} from "../lib/search/vector-types";
import type { SearchDocument } from "../lib/search/types";

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

test("F4 Release Validation: detects valid releases and rejects invalid ones", () => {
  const dimensions = 1024;
  const doc0 = createDummyDocument("0");
  doc0.vectorRow = 0;
  const doc1 = createDummyDocument("1");
  doc1.vectorRow = 1;

  const gen = new DeterministicMockEmbeddingGenerator(dimensions);
  return gen.generateBatches(["text0", "text1"]).then((vecs) => {
    const validBuffer = encodeVectorsToBuffer(vecs, dimensions);

    // 1. Valid release passes
    const validResult = validateVectorRelease({
      buffer: validBuffer,
      documents: [doc0, doc1],
      expectedDimensions: dimensions,
      expectedVectorCount: 2
    });
    assert.equal(validResult.isValid, true);
    assert.equal(validResult.errors.length, 0);

    // 2. Reject mismatched buffer size
    const truncatedBuffer = validBuffer.subarray(0, validBuffer.length - 10);
    const sizeResult = validateVectorRelease({
      buffer: truncatedBuffer,
      documents: [doc0, doc1],
      expectedDimensions: dimensions,
      expectedVectorCount: 2
    });
    assert.equal(sizeResult.isValid, false);
    assert.ok(sizeResult.errors.some((e) => e.includes("not aligned")));

    // 3. Reject non-finite vector values (NaN)
    const corruptedBuffer = Buffer.from(validBuffer);
    corruptedBuffer.writeFloatLE(NaN, 0);
    const nanResult = validateVectorRelease({
      buffer: corruptedBuffer,
      documents: [doc0, doc1],
      expectedDimensions: dimensions,
      expectedVectorCount: 2
    });
    assert.equal(nanResult.isValid, false);
    assert.ok(nanResult.errors.some((e) => e.includes("non-finite")));

    // 4. Reject un-normalized vectors
    const unnormBuffer = Buffer.from(validBuffer);
    unnormBuffer.writeFloatLE(100.0, 0);
    const unnormResult = validateVectorRelease({
      buffer: unnormBuffer,
      documents: [doc0, doc1],
      expectedDimensions: dimensions,
      expectedVectorCount: 2
    });
    assert.equal(unnormResult.isValid, false);
    assert.ok(unnormResult.errors.some((e) => e.includes("L2 normalization")));

    // 5. Reject document row mapping mismatch
    const badDoc1 = { ...doc1, vectorRow: 5 }; // row out of bounds
    const mappingResult = validateVectorRelease({
      buffer: validBuffer,
      documents: [doc0, badDoc1],
      expectedDimensions: dimensions,
      expectedVectorCount: 2
    });
    assert.equal(mappingResult.isValid, false);
    assert.ok(mappingResult.errors.some((e) => e.includes("mapping mismatch")));
  });
});

test("F4 Resumable Checkpoint Builder: reuses matching checkpoints and rebuilds invalidated ones", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "f4-vector-test-"));
  try {
    const docsDir = join(tempDir, "data");
    const checkpointDir = join(tempDir, "checkpoints");
    const stagingDir = join(tempDir, "staging");

    const docs = [
      createDummyDocument("1", "source", "Thai robotics research"),
      createDummyDocument("2", "robot", "Dinsaw healthcare robot"),
      createDummyDocument("3", "contribution", "FIBO educational initiative")
    ];

    const documentsPath = join(tempDir, "documents.json");
    writeFileSync(documentsPath, JSON.stringify(docs), "utf8");

    const profileA: ModelProfile = {
      ...DEFAULT_MODEL_PROFILE,
      profileHash: "model-profile-test-a"
    };

    // 1. Initial build: Generates all 3 vectors and writes checkpoints
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
    assert.equal(resultA.coverage.vectorCount, 3);
    assert.equal(resultA.coverage.overallCoveragePct, 100);

    // 2. Second build with same profile: Reuses all cached checkpoints without error
    const resultA2 = await builderA.build();
    assert.equal(resultA2.coverage.status, "complete");
    assert.equal(resultA2.coverage.vectorCount, 3);

    // 3. Third build with DIFFERENT profile: Discards cache from profile A and recomputes for profile B
    const profileB: ModelProfile = {
      ...DEFAULT_MODEL_PROFILE,
      profileHash: "model-profile-test-b"
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
    assert.equal(resultB.manifest.modelProfile?.profileHash, "model-profile-test-b");
    assert.equal(resultB.coverage.vectorCount, 3);
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
  // Scenario 1: High throughput -> On track for Hour 4.5 gate
  // 6,746 total docs, 5,000 completed at 3.0 hours (10,800 sec).
  // Rate: 5,000 / 10,800 = 0.463 docs/sec.
  // Remaining: 1,746 docs. Raw time = 1,746 / 0.463 = 3,771 sec (62.8 min).
  // 50% contingency = 1,885 sec (31.4 min).
  // Total forecast remaining = 5,656 sec (~1.57 hrs).
  // Forecast finish = 3.0 + 1.57 = 4.57 hrs -> slightly over
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

  // Scenario 2: Fast throughput -> Comfortably meets deadline
  // 6,746 total docs, 6,000 completed at 3.0 hours
  // Remaining: 746 docs.
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
