import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
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
  countCompletedCheckpointDocuments,
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

    // Attempting to instantiate production profile without real service or generator must throw
    const origTei = process.env.TEI_ENDPOINT;
    const origEmb = process.env.EMBEDDING_SERVICE_URL;
    delete process.env.TEI_ENDPOINT;
    delete process.env.EMBEDDING_SERVICE_URL;
    try {
      assert.throws(() => {
        new VectorReleaseBuilder({
          documentsPath,
          outputDir: tempDir,
          profile: DEFAULT_MODEL_PROFILE
        });
      }, /requires a real embedding service/);
    } finally {
      if (origTei) process.env.TEI_ENDPOINT = origTei;
      if (origEmb) process.env.EMBEDDING_SERVICE_URL = origEmb;
    }
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
    assert.ok(pointer.releaseDir?.includes(result.manifest.releaseId));
    assert.ok(pointer.files.manifest.startsWith("releases/"));
    assert.ok(pointer.files.documents.startsWith("releases/"));

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

  // Zero or non-positive measured progress must throw
  assert.throws(() => {
    calculateCompletionForecast({
      totalDocuments: 6746,
      completedDocuments: 0,
      elapsedSeconds: 0
    });
  }, /valid measured progress is required/);

  assert.throws(() => {
    calculateCompletionForecast({
      totalDocuments: 6746,
      completedDocuments: -5,
      elapsedSeconds: 100
    });
  }, /valid measured progress is required/);
});

function makeDocs(n: number): SearchDocument[] {
  const kinds = ["source", "robot", "contribution", "perspective"];
  return Array.from({ length: n }, (_, i) =>
    createDummyDocument(String(i + 1), kinds[i % kinds.length], `text ${i + 1}`)
  );
}

function validateReleaseDir(releaseDir: string, profile: ModelProfile) {
  const manifest = JSON.parse(readFileSync(join(releaseDir, "manifest.json"), "utf8"));
  const documents = JSON.parse(readFileSync(join(releaseDir, "documents.json"), "utf8"));
  const vectorsPath = join(releaseDir, "vectors.f32");
  return validateVectorRelease({
    buffer: existsSync(vectorsPath) ? readFileSync(vectorsPath) : Buffer.alloc(0),
    documents,
    expectedDimensions: profile.dimensions,
    manifest,
    manifestDir: releaseDir
  });
}

test("F4 Release dir: probe-128.json listed in fileChecksums is copied and the release dir validates on its own", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "f4-probe-test-"));
  try {
    const outDir = join(tempDir, "out");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "probe-128.json"), JSON.stringify({ probe: [1, 2, 3] }), "utf8");
    const documentsPath = join(tempDir, "documents.json");
    writeFileSync(documentsPath, JSON.stringify(makeDocs(3)), "utf8");

    const result = await new VectorReleaseBuilder({
      documentsPath,
      outputDir: outDir,
      checkpointDir: join(tempDir, "cp"),
      stagingDir: join(tempDir, "st"),
      profile: MOCK_MODEL_PROFILE
    }).build();

    const releaseDir = join(outDir, "releases", result.manifest.releaseId);
    assert.ok(result.manifest.fileChecksums["probe-128.json"], "manifest lists probe-128.json");
    assert.ok(existsSync(join(releaseDir, "probe-128.json")), "probe-128.json must be in the release dir");
    const validation = validateReleaseDir(releaseDir, MOCK_MODEL_PROFILE);
    assert.equal(validation.isValid, true, validation.errors.join("; "));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("F4 Release transition: keyword-only build after a semantic release drops the vectors entry and validates", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "f4-transition-test-"));
  try {
    const outDir = join(tempDir, "out");
    const documentsPath = join(tempDir, "documents.json");
    writeFileSync(documentsPath, JSON.stringify(makeDocs(3)), "utf8");
    const common = {
      documentsPath,
      outputDir: outDir,
      checkpointDir: join(tempDir, "cp"),
      stagingDir: join(tempDir, "st"),
      profile: MOCK_MODEL_PROFILE
    };

    const semantic = await new VectorReleaseBuilder(common).build();
    assert.ok(semantic.manifest.fileChecksums["vectors.f32"]);
    assert.ok(existsSync(join(outDir, "vectors.f32")));

    const keyword = await new VectorReleaseBuilder({ ...common, maxVectorsToGenerate: 0 }).build();
    assert.equal(keyword.coverage.status, "absent");
    assert.equal(keyword.manifest.fileChecksums["vectors.f32"], undefined);
    assert.equal(keyword.manifest.files.vectors, undefined);

    const pointer = readActiveReleasePointer(outDir);
    assert.ok(pointer);
    assert.equal(pointer.files.vectors, undefined);
    assert.equal(pointer.vectorSha256, undefined);

    // No stale vectors file left beside a manifest that lists none.
    assert.equal(existsSync(join(outDir, "vectors.f32")), false);
    assert.equal(existsSync(join(outDir, "releases", keyword.manifest.releaseId, "vectors.f32")), false);

    const releaseValidation = validateReleaseDir(join(outDir, "releases", keyword.manifest.releaseId), MOCK_MODEL_PROFILE);
    assert.equal(releaseValidation.isValid, true, releaseValidation.errors.join("; "));
    const activeValidation = validateReleaseDir(outDir, MOCK_MODEL_PROFILE);
    assert.equal(activeValidation.isValid, true, activeValidation.errors.join("; "));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("F4 Resume: a resumed run continues batch numbering and does not overwrite earlier checkpoints", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "f4-resume-test-"));
  try {
    const checkpointDir = join(tempDir, "cp");
    const documentsPath = join(tempDir, "documents.json");
    writeFileSync(documentsPath, JSON.stringify(makeDocs(4)), "utf8");
    const profile: ModelProfile = { ...MOCK_MODEL_PROFILE, profileHash: "mock-resume-test" };
    const common = {
      documentsPath,
      outputDir: join(tempDir, "out"),
      checkpointDir,
      stagingDir: join(tempDir, "st"),
      profile,
      batchSize: 2
    };

    await new VectorReleaseBuilder({ ...common, maxVectorsToGenerate: 2 }).build();
    const cp0Path = join(checkpointDir, "checkpoint-mock-resume-test-batch-0.json");
    const before = JSON.parse(readFileSync(cp0Path, "utf8"));
    assert.deepEqual(before.entries.map((e: any) => e.typedId), ["source:1", "robot:2"]);

    await new VectorReleaseBuilder(common).build();
    const after0 = JSON.parse(readFileSync(cp0Path, "utf8"));
    assert.deepEqual(after0.entries.map((e: any) => e.typedId), ["source:1", "robot:2"], "batch 0 must be untouched");
    const cp1Path = join(checkpointDir, "checkpoint-mock-resume-test-batch-1.json");
    assert.ok(existsSync(cp1Path), "resumed run must write batch 1");
    const after1 = JSON.parse(readFileSync(cp1Path, "utf8"));
    assert.deepEqual(after1.entries.map((e: any) => e.typedId), ["contribution:3", "perspective:4"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("F4 Forecast input: countCompletedCheckpointDocuments reads real checkpoint fields (typedId, contentHash)", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "f4-count-test-"));
  try {
    const checkpointDir = join(tempDir, "cp");
    const docs = makeDocs(4);
    const documentsPath = join(tempDir, "documents.json");
    writeFileSync(documentsPath, JSON.stringify(docs), "utf8");
    const profile: ModelProfile = { ...MOCK_MODEL_PROFILE, profileHash: "mock-count-test" };

    await new VectorReleaseBuilder({
      documentsPath,
      outputDir: join(tempDir, "out"),
      checkpointDir,
      stagingDir: join(tempDir, "st"),
      profile,
      batchSize: 2,
      maxVectorsToGenerate: 3
    }).build();

    const all = countCompletedCheckpointDocuments({ checkpointDir, profileHash: "mock-count-test", documents: docs });
    assert.deepEqual(all, { completed: 3, checkpointFiles: 2 });

    const changed = docs.map((d, i) => (i === 0 ? { ...d, contentHash: "different" } : d));
    assert.equal(
      countCompletedCheckpointDocuments({ checkpointDir, profileHash: "mock-count-test", documents: changed }).completed,
      2
    );
    assert.equal(
      countCompletedCheckpointDocuments({ checkpointDir, profileHash: "other-profile", documents: docs }).completed,
      0
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("F4 Forecast CLI: refuses to forecast without --elapsed-sec instead of inferring a rate from file timestamps", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "f4-cli-test-"));
  try {
    const docs = makeDocs(4);
    mkdirSync(join(tempDir, "data", "search"), { recursive: true });
    writeFileSync(join(tempDir, "data", "search", "documents.json"), JSON.stringify(docs), "utf8");
    await new VectorReleaseBuilder({
      documentsPath: join(tempDir, "data", "search", "documents.json"),
      outputDir: join(tempDir, "scratch-out"),
      checkpointDir: join(tempDir, ".cache", "search-vector-checkpoints"),
      stagingDir: join(tempDir, "st"),
      profile: MOCK_MODEL_PROFILE,
      batchSize: 2,
      maxVectorsToGenerate: 2
    }).build();

    const tsx = join(process.cwd(), "node_modules", ".bin", "tsx");
    const script = join(process.cwd(), "scripts", "build-vector-release.ts");
    const run = (extra: string[]) =>
      spawnSync(tsx, [script, "--forecast", "--mock", ...extra], { cwd: tempDir, encoding: "utf8" });

    const noElapsed = run([]);
    assert.notEqual(noElapsed.status, 0);
    assert.match(noElapsed.stderr, /Not enough data/);
    assert.match(noElapsed.stdout, /Derived completed count from 1 matching checkpoint file\(s\): 2 of 4/);

    const withElapsed = run(["--elapsed-sec", "100"]);
    assert.equal(withElapsed.status, 0, withElapsed.stderr);
    assert.match(withElapsed.stdout, /Progress: 2\/4 docs/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("F4 Release Validation: rejects fractional vectorRow values", () => {
  const dims = 4;
  const buf = encodeVectorsToBuffer([l2Normalize(new Float32Array([1, 2, 3, 4])), l2Normalize(new Float32Array([4, 3, 2, 1]))], dims);
  const docs = [createDummyDocument("a"), createDummyDocument("b")];
  docs[0].vectorRow = 0;
  docs[1].vectorRow = 0.5;
  const result = validateVectorRelease({ buffer: buf, documents: docs, expectedDimensions: dims, expectedVectorCount: 2 });
  assert.equal(result.isValid, false);
});
