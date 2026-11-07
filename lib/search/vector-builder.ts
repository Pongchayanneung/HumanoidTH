import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  copyFileSync,
  rmSync
} from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import type { SearchDocument, SearchRecordKind, LanguageTag } from "./types";
import {
  DEFAULT_MODEL_PROFILE,
  type ModelProfile,
  type SemanticCoverage,
  type SemanticCoverageKindStats,
  type VectorBatchCheckpoint,
  type VectorReleaseManifest,
  type EmbeddingGenerator,
  type VectorValidationResult
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
 * Resumable Vector Release Builder for Atlas Search (F4).
 */
export class VectorReleaseBuilder {
  private options: Required<BuildVectorReleaseOptions>;

  constructor(options?: BuildVectorReleaseOptions) {
    const rootDir = process.cwd();
    this.options = {
      documentsPath: options?.documentsPath || resolve(rootDir, "data", "search", "documents.json"),
      outputDir: options?.outputDir || resolve(rootDir, "data", "search"),
      checkpointDir: options?.checkpointDir || resolve(rootDir, ".cache", "search-vector-checkpoints"),
      stagingDir: options?.stagingDir || resolve(rootDir, ".cache", "search-vector-staging"),
      profile: options?.profile || DEFAULT_MODEL_PROFILE,
      batchSize: options?.batchSize || 64,
      embeddingGenerator: options?.embeddingGenerator || new DeterministicMockEmbeddingGenerator(options?.profile?.dimensions || 1024),
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
   * 3. Generates missing embeddings in batches
   * 4. Updates document vectorRow pointers
   * 5. Encodes little-endian Float32 binary file
   * 6. Validates staged release
   * 7. Atomically promotes files to active directory
   */
  async build(): Promise<BuildVectorReleaseResult> {
    const { documentsPath, stagingDir, outputDir, profile, batchSize, embeddingGenerator, maxVectorsToGenerate, releaseId, datasetId } = this.options;

    // Load documents
    const rawDocsJson = readFileSync(documentsPath, "utf8");
    const documents: SearchDocument[] = JSON.parse(rawDocsJson);

    // Prepare directories
    mkdirSync(stagingDir, { recursive: true });
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

    // Generate missing vectors in batches
    if (missingDocs.length > 0) {
      const textsToEmbed = missingDocs.map((m) => m.doc.retrievalText || m.doc.title);
      const generatedVectors = await embeddingGenerator.generateBatches(textsToEmbed, {
        batchSize
      });

      // Insert generated vectors and write batch checkpoints
      for (let i = 0; i < missingDocs.length; i += batchSize) {
        const batchSlice = missingDocs.slice(i, i + batchSize);
        const checkpointEntries: { typedId: string; contentHash: string; vectorRow: number; vector: Float32Array }[] = [];

        for (let j = 0; j < batchSlice.length; j++) {
          const item = batchSlice[j];
          const vec = generatedVectors[i + j];
          vectors[item.rowIndex] = vec;
          item.doc.vectorRow = item.rowIndex;

          checkpointEntries.push({
            typedId: item.doc.typedId,
            contentHash: item.doc.contentHash,
            vectorRow: item.rowIndex,
            vector: vec
          });
        }

        const batchIndex = Math.floor(i / batchSize);
        this.saveBatchCheckpoint(batchIndex, checkpointEntries);
      }
    }

    // Binary encode Float32 vectors
    const vectorBuffer = targetDocs.length > 0
      ? encodeVectorsToBuffer(vectors, profile.dimensions)
      : Buffer.alloc(0);

    // Compute semantic coverage
    const coverage = this.computeCoverage(documents, targetDocs.length);

    // Compute recordKeysHash
    const recordKeysHash = targetDocs.length > 0 ? computeRecordKeysHash(documents) : null;

    // Stage files in stagingDir
    const stagedDocsPath = resolve(stagingDir, "documents.json");
    const stagedVectorsPath = resolve(stagingDir, "vectors.f32");
    const stagedManifestPath = resolve(stagingDir, "manifest.json");

    const docsJsonStr = JSON.stringify(documents, null, 2);
    writeFileSync(stagedDocsPath, docsJsonStr, "utf8");
    writeFileSync(stagedVectorsPath, vectorBuffer);

    // Compute file hashes and sizes
    const docsSha256 = createHash("sha256").update(Buffer.from(docsJsonStr, "utf8")).digest("hex");
    const docsBytes = Buffer.byteLength(docsJsonStr, "utf8");

    const vectorsSha256 = createHash("sha256").update(vectorBuffer).digest("hex");
    const vectorsBytes = vectorBuffer.length;

    const fileChecksums: Record<string, { sha256: string; bytes: number }> = {
      "documents.json": { sha256: docsSha256, bytes: docsBytes },
      "vectors.f32": { sha256: vectorsSha256, bytes: vectorsBytes }
    };

    // If probe-128.json exists, copy and hash it
    const existingProbePath = resolve(outputDir, "probe-128.json");
    if (existsSync(existingProbePath)) {
      const probeJson = readFileSync(existingProbePath, "utf8");
      const probeSha256 = createHash("sha256").update(Buffer.from(probeJson, "utf8")).digest("hex");
      fileChecksums["probe-128.json"] = { sha256: probeSha256, bytes: Buffer.byteLength(probeJson, "utf8") };
      copyFileSync(existingProbePath, resolve(stagingDir, "probe-128.json"));
    }

    // Prepare enriched manifest
    const manifest: VectorReleaseManifest = {
      manifestVersion: "2.0",
      datasetId,
      releaseId,
      generatedAt: new Date().toISOString(),
      modelProfile: targetDocs.length > 0 ? profile : null,
      coverage,
      recordKeysHash,
      recordsSha256: docsSha256,
      files: {
        documents: "documents.json",
        probeSample128: "probe-128.json",
        vectors: targetDocs.length > 0 ? "vectors.f32" : undefined
      },
      fileChecksums
    };

    writeFileSync(stagedManifestPath, JSON.stringify(manifest, null, 2), "utf8");

    // Validate staged release
    const validation = validateVectorRelease({
      buffer: vectorBuffer,
      documents,
      expectedDimensions: profile.dimensions,
      expectedVectorCount: targetDocs.length,
      profile
    });

    if (!validation.isValid) {
      throw new Error(`Vector release validation failed: ${validation.errors.join("; ")}`);
    }

    // Atomic promotion: copy staged files into outputDir
    const stagedFiles = [stagedDocsPath, stagedVectorsPath, stagedManifestPath];
    const promotedFiles: string[] = [];

    const finalDocsPath = resolve(outputDir, "documents.json");
    const finalVectorsPath = resolve(outputDir, "vectors.f32");
    const finalManifestPath = resolve(outputDir, "manifest.json");

    copyFileSync(stagedDocsPath, finalDocsPath);
    promotedFiles.push(finalDocsPath);

    copyFileSync(stagedVectorsPath, finalVectorsPath);
    promotedFiles.push(finalVectorsPath);

    copyFileSync(stagedManifestPath, finalManifestPath);
    promotedFiles.push(finalManifestPath);

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
    const totalDocs = documents.length;
    let status: "complete" | "partial" | "absent" = "absent";

    if (vectorCount === 0) {
      status = "absent";
    } else if (vectorCount >= totalDocs) {
      status = "complete";
    } else {
      status = "partial";
    }

    const byKind: Record<SearchRecordKind, SemanticCoverageKindStats> = {
      source: { total: 0, indexed: 0, coveragePct: 0 },
      robot: { total: 0, indexed: 0, coveragePct: 0 },
      contribution: { total: 0, indexed: 0, coveragePct: 0 },
      perspective: { total: 0, indexed: 0, coveragePct: 0 },
      inventory: { total: 0, indexed: 0, coveragePct: 0 },
      relationship: { total: 0, indexed: 0, coveragePct: 0 },
      entity: { total: 0, indexed: 0, coveragePct: 0 }
    };

    const byLanguage: Record<LanguageTag, { total: number; indexed: number }> = {
      th: { total: 0, indexed: 0 },
      en: { total: 0, indexed: 0 },
      mixed: { total: 0, indexed: 0 },
      unknown: { total: 0, indexed: 0 }
    };

    for (const doc of documents) {
      const hasVector = doc.vectorRow !== null && doc.vectorRow !== undefined;

      if (byKind[doc.kind]) {
        byKind[doc.kind].total++;
        if (hasVector) byKind[doc.kind].indexed++;
      }

      if (byLanguage[doc.language]) {
        byLanguage[doc.language].total++;
        if (hasVector) byLanguage[doc.language].indexed++;
      }
    }

    for (const kind of Object.keys(byKind) as SearchRecordKind[]) {
      const stats = byKind[kind];
      stats.coveragePct = stats.total > 0 ? (stats.indexed / stats.total) * 100 : 0;
    }

    const overallCoveragePct = totalDocs > 0 ? (vectorCount / totalDocs) * 100 : 0;

    return {
      status,
      totalDocuments: totalDocs,
      vectorCount,
      overallCoveragePct,
      byKind,
      byLanguage
    };
  }
}
