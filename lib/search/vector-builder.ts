import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  copyFileSync,
  rmSync,
  renameSync
} from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { embeddingHeaders, resolveEmbeddingApiKey } from "./embedding-env";
import type { SearchDocument, SearchExportManifest, SearchRecordKind, LanguageTag } from "./types";
import {
  DEFAULT_MODEL_PROFILE,
  MOCK_MODEL_PROFILE,
  type ModelProfile,
  type SemanticCoverage,
  type SemanticCoverageKindStats,
  type VectorBatchCheckpoint,
  type VectorReleaseManifest,
  type EmbeddingGenerator,
  type VectorValidationResult,
  type ActiveVectorReleasePointer
} from "./vector-types";
import {
  encodeVectorsToBuffer,
  l2Normalize,
  computeRecordKeysHash,
  validateVectorRelease
} from "./vector-io";

export interface BuildVectorReleaseOptions {
  documentsPath?: string;
  outputDir?: string;
  checkpointDir?: string;
  stagingDir?: string;
  profile?: ModelProfile;
  batchSize?: number;
  embeddingGenerator?: EmbeddingGenerator;
  maxVectorsToGenerate?: number; // Optional cap for testing partial releases
  releaseId?: string;
  datasetId?: string;
}

export interface BuildVectorReleaseResult {
  manifest: VectorReleaseManifest;
  validation: VectorValidationResult;
  coverage: SemanticCoverage;
  stagedFiles: string[];
  promotedFiles: string[];
}

/**
 * Deterministic Mock Embedding Generator for testing without live GPU.
 * Produces normalized 1024-dimension Float32 vectors seeded from string content.
 */
export class DeterministicMockEmbeddingGenerator implements EmbeddingGenerator {
  private dimensions: number;

  constructor(dimensions: number = 1024) {
    this.dimensions = dimensions;
  }

  async generateBatches(
    texts: string[],
    options?: { batchSize?: number; onProgress?: (completed: number, total: number) => void }
  ): Promise<Float32Array[]> {
    const results: Float32Array[] = [];
    const batchSize = options?.batchSize || 32;

    for (let i = 0; i < texts.length; i += batchSize) {
      const chunk = texts.slice(i, i + batchSize);
      for (const text of chunk) {
        const vec = new Float32Array(this.dimensions);
        // Seed pseudo-random floats using text SHA-256
        const hash = createHash("sha256").update(text || "empty").digest();
        for (let d = 0; d < this.dimensions; d++) {
          const byteVal = hash[d % hash.length];
          // Scale to [-1, 1], ensure non-zero
          const floatVal = ((byteVal / 127.5) - 1.0) + (d % 7) * 0.05 + 0.01;
          vec[d] = floatVal;
        }
        results.push(l2Normalize(vec));
      }
      if (options?.onProgress) {
        options.onProgress(Math.min(i + batchSize, texts.length), texts.length);
      }
    }

    return results;
  }
}

/**
 * Production TEI / Remote Embedding Generator for live model serving.
 */
export class TeiEmbeddingGenerator implements EmbeddingGenerator {
  private endpoint: string;
  private dimensions: number;

  /**
   * Speaks the direct TEI wire format. The bearer key comes from embeddingHeaders()
   * (EMBEDDING_SERVICE_API_KEY, legacy alias EMBEDDING_SERVICE_KEY) and is never logged.
   */
  constructor(endpoint: string, dimensions: number = 1024) {
    this.endpoint = endpoint.replace(/\/+$/, "");
    this.dimensions = dimensions;
  }

  async generateBatches(
    texts: string[],
    options?: { batchSize?: number; onProgress?: (completed: number, total: number) => void }
  ): Promise<Float32Array[]> {
    const results: Float32Array[] = [];
    const batchSize = options?.batchSize || 32;

    for (let i = 0; i < texts.length; i += batchSize) {
      const chunk = texts.slice(i, i + batchSize);
      const res = await fetch(`${this.endpoint}/embed`, {
        method: "POST",
        headers: embeddingHeaders(resolveEmbeddingApiKey()),
        body: JSON.stringify({ inputs: chunk, normalize: true, truncate: true })
      });
      if (!res.ok) {
        throw new Error(`Embedding service returned HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const data = (await res.json()) as number[][];
      if (!Array.isArray(data) || data.length !== chunk.length) {
        throw new Error(`Embedding service returned ${Array.isArray(data) ? data.length : "no"} vectors for ${chunk.length} inputs`);
      }
      for (const row of data) {
        if (!Array.isArray(row) || row.length !== this.dimensions) {
          // Never truncate or pad: a size mismatch means the model does not match the pinned profile.
          throw new Error(`Embedding service returned a vector of length ${Array.isArray(row) ? row.length : "n/a"}, expected ${this.dimensions}`);
        }
        const f32 = new Float32Array(row);
        results.push(l2Normalize(f32));
      }
      if (options?.onProgress) {
        options.onProgress(Math.min(i + batchSize, texts.length), texts.length);
      }
    }
    return results;
  }
}

/**
 * Resumable Vector Release Builder for Atlas Search (F4).
 */
export class VectorReleaseBuilder {
  private options: Required<BuildVectorReleaseOptions>;

  constructor(options?: BuildVectorReleaseOptions) {
    const rootDir = process.cwd();
    let profile: ModelProfile;
    if (options?.profile) {
      profile = options.profile;
    } else if (options?.embeddingGenerator instanceof DeterministicMockEmbeddingGenerator) {
      profile = MOCK_MODEL_PROFILE;
    } else {
      profile = MOCK_MODEL_PROFILE;
    }

    let embeddingGenerator = options?.embeddingGenerator;
    if (!embeddingGenerator) {
      if (profile.provider === "mock") {
        embeddingGenerator = new DeterministicMockEmbeddingGenerator(profile.dimensions);
      } else {
        // Production profile requested without explicit generator: check environment
        const teiUrl = process.env.EMBEDDING_SERVICE_URL || process.env.TEI_ENDPOINT;
        if (teiUrl) {
          embeddingGenerator = new TeiEmbeddingGenerator(teiUrl, profile.dimensions);
        } else if (options?.maxVectorsToGenerate === 0) {
          // Keyword-only release requires 0 vectors
          embeddingGenerator = new DeterministicMockEmbeddingGenerator(profile.dimensions);
        } else {
          throw new Error(
            `Cannot build semantic release: Production model profile "${profile.modelId}" requires a real embedding service. Configure EMBEDDING_SERVICE_URL (or TEI_ENDPOINT) or provide an EmbeddingGenerator instance.`
          );
        }
      }
    } else if (
      embeddingGenerator instanceof DeterministicMockEmbeddingGenerator &&
      profile.provider !== "mock"
    ) {
      throw new Error(
        `Cannot build semantic release: DeterministicMockEmbeddingGenerator cannot be labelled as production model profile "${profile.modelId}". Pass MOCK_MODEL_PROFILE or provide a real embedding generator.`
      );
    }

    this.options = {
      documentsPath: options?.documentsPath || resolve(rootDir, "data", "search", "documents.json"),
      outputDir: options?.outputDir || resolve(rootDir, "data", "search"),
      checkpointDir: options?.checkpointDir || resolve(rootDir, ".cache", "search-vector-checkpoints"),
      stagingDir: options?.stagingDir || resolve(rootDir, ".cache", "search-vector-staging"),
      profile,
      batchSize: options?.batchSize || 64,
      embeddingGenerator,
      maxVectorsToGenerate: options?.maxVectorsToGenerate ?? Infinity,
      releaseId: options?.releaseId || "search-v1-hybrid",
      datasetId: options?.datasetId || "thailand-humanoid-atlas"
    };
  }

  /**
   * Loads existing valid checkpoints matching the active model profile.
   */
  loadMatchingCheckpoints(profileHash: string): Map<string, { vector: Float32Array; vectorRow: number }> {
    const map = new Map<string, { vector: Float32Array; vectorRow: number }>();
    if (!existsSync(this.options.checkpointDir)) {
      return map;
    }

    const files = readdirSync(this.options.checkpointDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const fullPath = join(this.options.checkpointDir, file);
        const data: VectorBatchCheckpoint = JSON.parse(readFileSync(fullPath, "utf8"));

        // Only reuse checkpoints whose model profile hash exactly matches
        if (data.modelProfileHash !== profileHash) {
          continue;
        }

        for (const entry of data.entries) {
          const vec = new Float32Array(entry.vector);
          map.set(`${entry.typedId}:${entry.contentHash}`, {
            vector: vec,
            vectorRow: entry.vectorRow
          });
        }
      } catch (err) {
        console.warn(`Failed reading checkpoint ${file}:`, err);
      }
    }

    return map;
  }

  /**
   * Returns the next unused batch index for this profile (highest existing + 1, or 0).
   */
  nextBatchIndex(profileHash: string): number {
    if (!existsSync(this.options.checkpointDir)) return 0;
    const prefix = `checkpoint-${profileHash}-batch-`;
    const suffix = ".json";
    let highest = -1;
    for (const file of readdirSync(this.options.checkpointDir)) {
      if (!file.startsWith(prefix) || !file.endsWith(suffix)) continue;
      const middle = file.slice(prefix.length, file.length - suffix.length);
      if (!/^\d+$/.test(middle)) continue;
      highest = Math.max(highest, parseInt(middle, 10));
    }
    return highest + 1;
  }

  /**
   * Saves a completed batch checkpoint to disk.
   */
  saveBatchCheckpoint(
    batchIndex: number,
    entries: { typedId: string; contentHash: string; vectorRow: number; vector: Float32Array }[]
  ): void {
    mkdirSync(this.options.checkpointDir, { recursive: true });
    const checkpoint: VectorBatchCheckpoint = {
      checkpointVersion: "1.0",
      modelProfileHash: this.options.profile.profileHash,
      batchIndex,
      batchSize: entries.length,
      createdAt: new Date().toISOString(),
      entries: entries.map((e) => ({
        typedId: e.typedId,
        contentHash: e.contentHash,
        vectorRow: e.vectorRow,
        vector: Array.from(e.vector)
      }))
    };

    const filename = `checkpoint-${this.options.profile.profileHash}-batch-${batchIndex}.json`;
    const filePath = join(this.options.checkpointDir, filename);
    writeFileSync(filePath, JSON.stringify(checkpoint), "utf8");
  }

  /**
   * Builds the vector release:
   * 1. Loads documents
   * 2. Checks resumable checkpoints
   * 3. Generates missing embeddings in batches with per-batch checkpointing
   * 4. Updates document vectorRow pointers
   * 5. Encodes little-endian Float32 binary file
   * 6. Validates staged release in a versioned staging directory
   * 7. Atomically promotes files to active directory and switches active-release pointer
   */
  async build(): Promise<BuildVectorReleaseResult> {
    const {
      documentsPath,
      stagingDir,
      outputDir,
      profile,
      batchSize,
      embeddingGenerator,
      maxVectorsToGenerate,
      releaseId,
      datasetId
    } = this.options;

    // Load documents
    const rawDocsJson = readFileSync(documentsPath, "utf8");
    const documents: SearchDocument[] = JSON.parse(rawDocsJson);

    // Prepare versioned staging directory
    const releaseStageDir = resolve(stagingDir, `stage-${releaseId}-${Date.now()}`);
    mkdirSync(releaseStageDir, { recursive: true });
    mkdirSync(outputDir, { recursive: true });

    // Load matching checkpoints
    const existingCheckpoints = this.loadMatchingCheckpoints(profile.profileHash);

    // Filter documents to vectorize up to maxVectorsToGenerate
    const targetDocs = documents.slice(0, maxVectorsToGenerate);
    const vectors: Float32Array[] = [];
    const missingDocs: { doc: SearchDocument; rowIndex: number }[] = [];

    // First pass: assign existing checkpoints
    for (let r = 0; r < targetDocs.length; r++) {
      const doc = targetDocs[r];
      const key = `${doc.typedId}:${doc.contentHash}`;
      const cached = existingCheckpoints.get(key);

      if (cached && cached.vector.length === profile.dimensions) {
        vectors.push(cached.vector);
        doc.vectorRow = r;
      } else {
        missingDocs.push({ doc, rowIndex: r });
        // Placeholder slot
        vectors.push(new Float32Array(profile.dimensions));
      }
    }

    // Set remaining docs outside targetDocs to null vectorRow
    for (let r = targetDocs.length; r < documents.length; r++) {
      documents[r].vectorRow = null;
    }

    // Generate missing vectors in batches and checkpoint each batch immediately.
    // Numbering continues after the highest existing checkpoint so a resumed run
    // never overwrites earlier checkpoint files.
    if (missingDocs.length > 0) {
      const firstBatchIndex = this.nextBatchIndex(profile.profileHash);
      for (let i = 0; i < missingDocs.length; i += batchSize) {
        const batchSlice = missingDocs.slice(i, i + batchSize);
        const batchTexts = batchSlice.map((m) => m.doc.retrievalText || m.doc.title);
        const batchVectors = await embeddingGenerator.generateBatches(batchTexts, {
          batchSize
        });

        const checkpointEntries: {
          typedId: string;
          contentHash: string;
          vectorRow: number;
          vector: Float32Array;
        }[] = [];

        for (let j = 0; j < batchSlice.length; j++) {
          const item = batchSlice[j];
          const vec = batchVectors[j];
          vectors[item.rowIndex] = vec;
          item.doc.vectorRow = item.rowIndex;

          checkpointEntries.push({
            typedId: item.doc.typedId,
            contentHash: item.doc.contentHash,
            vectorRow: item.rowIndex,
            vector: vec
          });
        }

        const batchIndex = firstBatchIndex + Math.floor(i / batchSize);
        this.saveBatchCheckpoint(batchIndex, checkpointEntries);
      }
    }

    // Binary encode Float32 vectors
    const vectorBuffer =
      targetDocs.length > 0
        ? encodeVectorsToBuffer(vectors, profile.dimensions)
        : Buffer.alloc(0);

    // Compute semantic coverage
    const coverage = this.computeCoverage(documents, targetDocs.length);

    // Compute recordKeysHash
    const recordKeysHash = targetDocs.length > 0 ? computeRecordKeysHash(documents) : null;

    // Load existing base manifest to preserve F3 counts, policy, and metadata
    const existingManifestPath = resolve(outputDir, "manifest.json");
    let baseManifest: Partial<SearchExportManifest> = {};
    if (existsSync(existingManifestPath)) {
      try {
        baseManifest = JSON.parse(readFileSync(existingManifestPath, "utf8"));
      } catch (err) {
        console.warn(`Failed reading existing base manifest from ${existingManifestPath}:`, err);
      }
    }

    // Stage files in versioned releaseStageDir
    const stagedDocsPath = resolve(releaseStageDir, "documents.json");
    const stagedVectorsPath = resolve(releaseStageDir, "vectors.f32");
    const stagedManifestPath = resolve(releaseStageDir, "manifest.json");

    const docsJsonStr = JSON.stringify(documents, null, 2);
    writeFileSync(stagedDocsPath, docsJsonStr, "utf8");
    if (targetDocs.length > 0) {
      writeFileSync(stagedVectorsPath, vectorBuffer);
    }

    // Compute file hashes and sizes
    const docsSha256 = createHash("sha256").update(Buffer.from(docsJsonStr, "utf8")).digest("hex");
    const docsBytes = Buffer.byteLength(docsJsonStr, "utf8");

    const fileChecksums: Record<string, { sha256: string; bytes: number }> = {
      ...(baseManifest.fileChecksums || {}),
      "documents.json": { sha256: docsSha256, bytes: docsBytes }
    };
    // Entries inherited from the previous manifest describe files that are only
    // re-staged below when they exist for this build. Drop them otherwise so a
    // keyword-only build after a semantic release does not list a vectors file
    // it never staged.
    delete fileChecksums["vectors.f32"];
    delete fileChecksums["probe-128.json"];

    let vectorsSha256: string | undefined;
    if (targetDocs.length > 0) {
      vectorsSha256 = createHash("sha256").update(vectorBuffer).digest("hex");
      fileChecksums["vectors.f32"] = { sha256: vectorsSha256, bytes: vectorBuffer.length };
    }

    // If probe-128.json exists in outputDir, copy and hash it
    const existingProbePath = resolve(outputDir, "probe-128.json");
    const hasProbe = existsSync(existingProbePath);
    if (hasProbe) {
      const probeJson = readFileSync(existingProbePath, "utf8");
      const probeSha256 = createHash("sha256").update(Buffer.from(probeJson, "utf8")).digest("hex");
      fileChecksums["probe-128.json"] = {
        sha256: probeSha256,
        bytes: Buffer.byteLength(probeJson, "utf8")
      };
      copyFileSync(existingProbePath, resolve(releaseStageDir, "probe-128.json"));
    }

    // Prepare enriched manifest preserving F3 counts & policy
    const manifest: VectorReleaseManifest = {
      ...baseManifest,
      manifestVersion: "2.0",
      datasetId: baseManifest.datasetId || datasetId,
      releaseId,
      generatedAt: new Date().toISOString(),
      counts: baseManifest.counts,
      policy: baseManifest.policy,
      modelProfile: targetDocs.length > 0 ? profile : null,
      coverage,
      recordKeysHash,
      recordsSha256: docsSha256,
      files: {
        ...(baseManifest.files || {}),
        documents: "documents.json",
        probeSample128: "probe-128.json",
        vectors: targetDocs.length > 0 ? "vectors.f32" : undefined
      },
      fileChecksums
    };

    const manifestJsonStr = JSON.stringify(manifest, null, 2);
    writeFileSync(stagedManifestPath, manifestJsonStr, "utf8");
    const manifestSha256 = createHash("sha256").update(Buffer.from(manifestJsonStr, "utf8")).digest("hex");

    // Validate staged release: check every row and all staged file checksums
    const validation = validateVectorRelease({
      buffer: vectorBuffer,
      documents,
      expectedDimensions: profile.dimensions,
      expectedVectorCount: targetDocs.length,
      profile,
      manifest,
      manifestDir: releaseStageDir
    });

    if (!validation.isValid) {
      // Clean up staged files on failure
      rmSync(releaseStageDir, { recursive: true, force: true });
      throw new Error(`Vector release validation failed: ${validation.errors.join("; ")}`);
    }

    // Versioned immutable release directory
    const versionedReleaseDir = resolve(outputDir, "releases", releaseId);
    mkdirSync(versionedReleaseDir, { recursive: true });

    const stagedFiles = [stagedDocsPath, stagedManifestPath];
    if (targetDocs.length > 0) stagedFiles.push(stagedVectorsPath);
    const promotedFiles: string[] = [];

    // Copy to versioned immutable release directory
    const versionedDocsPath = resolve(versionedReleaseDir, "documents.json");
    const versionedManifestPath = resolve(versionedReleaseDir, "manifest.json");
    const versionedVectorsPath = resolve(versionedReleaseDir, "vectors.f32");

    copyFileSync(stagedDocsPath, versionedDocsPath);
    promotedFiles.push(versionedDocsPath);

    copyFileSync(stagedManifestPath, versionedManifestPath);
    promotedFiles.push(versionedManifestPath);

    if (targetDocs.length > 0) {
      copyFileSync(stagedVectorsPath, versionedVectorsPath);
      promotedFiles.push(versionedVectorsPath);
    } else {
      // Keyword-only: a vectors file left by an earlier build of the same releaseId is stale.
      rmSync(versionedVectorsPath, { force: true });
    }

    if (hasProbe) {
      const versionedProbePath = resolve(versionedReleaseDir, "probe-128.json");
      copyFileSync(resolve(releaseStageDir, "probe-128.json"), versionedProbePath);
      promotedFiles.push(versionedProbePath);
    }

    // Validate the release directory itself against its own manifest checksums
    // BEFORE the active pointer is written, so a broken release is never activated.
    const releaseValidation = validateVectorRelease({
      buffer: targetDocs.length > 0 ? readFileSync(versionedVectorsPath) : Buffer.alloc(0),
      documents: JSON.parse(readFileSync(versionedDocsPath, "utf8")) as SearchDocument[],
      expectedDimensions: profile.dimensions,
      expectedVectorCount: targetDocs.length,
      profile,
      manifest: JSON.parse(readFileSync(versionedManifestPath, "utf8")) as VectorReleaseManifest,
      manifestDir: versionedReleaseDir
    });
    if (!releaseValidation.isValid) {
      rmSync(releaseStageDir, { recursive: true, force: true });
      throw new Error(
        `Vector release directory validation failed (active pointer not written): ${releaseValidation.errors.join("; ")}`
      );
    }

    // Switch active-release pointer atomically, pointing to immutable release directory
    const relManifest = join("releases", releaseId, "manifest.json").replace(/\\/g, "/");
    const relDocs = join("releases", releaseId, "documents.json").replace(/\\/g, "/");
    const relVectors = targetDocs.length > 0
      ? join("releases", releaseId, "vectors.f32").replace(/\\/g, "/")
      : undefined;

    const activePointer: ActiveVectorReleasePointer = {
      releaseId,
      datasetId: manifest.datasetId,
      activeAt: manifest.generatedAt,
      manifestSha256,
      recordsSha256: docsSha256,
      vectorSha256: vectorsSha256,
      modelProfileHash: targetDocs.length > 0 ? profile.profileHash : null,
      releaseDir: join("releases", releaseId).replace(/\\/g, "/"),
      files: {
        manifest: relManifest,
        documents: relDocs,
        vectors: relVectors
      }
    };

    // Atomically write active-release pointer via temporary file + renameSync
    const activePointerPath = resolve(outputDir, "active-release.json");
    const tempPointerPath = resolve(outputDir, `active-release.json.tmp.${Date.now()}.${process.pid}`);
    writeFileSync(tempPointerPath, JSON.stringify(activePointer, null, 2), "utf8");
    renameSync(tempPointerPath, activePointerPath);
    promotedFiles.push(activePointerPath);

    // Atomically promote to top-level outputDir (for backward-compatible path access)
    const writeAtomic = (srcPath: string, dstPath: string) => {
      const tmpDst = `${dstPath}.tmp.${Date.now()}.${process.pid}`;
      copyFileSync(srcPath, tmpDst);
      renameSync(tmpDst, dstPath);
      promotedFiles.push(dstPath);
    };

    const finalDocsPath = resolve(outputDir, "documents.json");
    const finalVectorsPath = resolve(outputDir, "vectors.f32");
    const finalManifestPath = resolve(outputDir, "manifest.json");

    writeAtomic(stagedDocsPath, finalDocsPath);
    if (targetDocs.length > 0) {
      writeAtomic(stagedVectorsPath, finalVectorsPath);
    } else {
      // A keyword-only manifest lists no vectors; do not leave a stale file beside it.
      rmSync(finalVectorsPath, { force: true });
    }
    writeAtomic(stagedManifestPath, finalManifestPath);

    // Clean up temporary staging directory
    rmSync(releaseStageDir, { recursive: true, force: true });

    return {
      manifest,
      validation,
      coverage,
      stagedFiles,
      promotedFiles
    };
  }

  /**
   * Computes semantic coverage statistics across all 7 kinds and languages.
   */
  private computeCoverage(documents: SearchDocument[], vectorCount: number): SemanticCoverage {
    const kinds: SearchRecordKind[] = [
      "source",
      "robot",
      "contribution",
      "perspective",
      "relationship",
      "inventory",
      "entity"
    ];

    const languages: LanguageTag[] = ["th", "en", "mixed", "unknown"];

    const byKind: Record<SearchRecordKind, SemanticCoverageKindStats> = {} as any;
    for (const kind of kinds) {
      byKind[kind] = { total: 0, indexed: 0, coveragePct: 0 };
    }

    const byLanguage: Record<LanguageTag, { total: number; indexed: number }> = {} as any;
    for (const lang of languages) {
      byLanguage[lang] = { total: 0, indexed: 0 };
    }

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      const kind = doc.kind;
      const lang = doc.language || "en";

      if (byKind[kind]) {
        byKind[kind].total++;
        if (i < vectorCount && doc.vectorRow !== null) {
          byKind[kind].indexed++;
        }
      }

      if (byLanguage[lang]) {
        byLanguage[lang].total++;
        if (i < vectorCount && doc.vectorRow !== null) {
          byLanguage[lang].indexed++;
        }
      }
    }

    for (const kind of kinds) {
      const stat = byKind[kind];
      stat.coveragePct = stat.total > 0 ? (stat.indexed / stat.total) * 100 : 100;
    }

    const overallPct = documents.length > 0 ? (vectorCount / documents.length) * 100 : 0;
    const status =
      vectorCount === 0
        ? "absent"
        : vectorCount >= documents.length
        ? "complete"
        : "partial";

    return {
      status,
      totalDocuments: documents.length,
      vectorCount,
      overallCoveragePct: overallPct,
      byKind,
      byLanguage
    };
  }
}
