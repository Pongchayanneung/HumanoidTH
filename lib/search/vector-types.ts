import type { SearchRecordKind, LanguageTag } from "./types";

/**
 * Model Profile pinning embedding runtime configuration for Atlas Search.
 * Must match between corpus embedding and query inference.
 */
export interface ModelProfile {
  modelId: string;
  revision: string;
  dimensions: number; // pinned at 1024
  precision: "float32";
  pooling: "last_token" | "mean" | "cls";
  normalized: boolean;
  queryInstructionTask: string;
  profileHash: string; // Deterministic hash of the configuration
}

/**
 * Default pinned model profile for Qwen-compatible embedding service.
 */
export const DEFAULT_MODEL_PROFILE: ModelProfile = {
  modelId: "Alibaba-NLP/gte-Qwen2-1.5B-instruct",
  revision: "main",
  dimensions: 1024,
  precision: "float32",
  pooling: "last_token",
  normalized: true,
  queryInstructionTask: "Given a Thai or English robotics information request, retrieve relevant public atlas records.",
  profileHash: "qwen2-gte-1024-f32-l2-v1"
};

/**
 * Coverage statistics for a semantic vector release.
 */
export interface SemanticCoverageKindStats {
  total: number;
  indexed: number;
  coveragePct: number;
}

export interface SemanticCoverage {
  status: "complete" | "partial" | "absent";
  totalDocuments: number;
  vectorCount: number;
  overallCoveragePct: number;
  byKind: Record<SearchRecordKind, SemanticCoverageKindStats>;
  byLanguage: Record<LanguageTag, { total: number; indexed: number }>;
}

/**
 * Validation result for a staged or active vector release.
 */
export interface VectorValidationCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface VectorValidationResult {
  isValid: boolean;
  dimensions: number;
  vectorCount: number;
  expectedBytes: number;
  actualBytes: number;
  checks: VectorValidationCheck[];
  errors: string[];
}

/**
 * Checkpoint format for resumable batch embeddings.
 */
export interface VectorBatchCheckpoint {
  checkpointVersion: string;
  modelProfileHash: string;
  batchIndex: number;
  batchSize: number;
  createdAt: string;
  entries: {
    typedId: string;
    contentHash: string;
    vectorRow: number;
    vector: number[]; // serialized floats
  }[];
}

/**
 * Release Manifest for Atlas Search (v2 enriched with semantic vectors).
 */
export interface VectorReleaseManifest {
  manifestVersion: string;
  datasetId: string;
  releaseId: string;
  generatedAt: string;
  modelProfile: ModelProfile | null;
  coverage: SemanticCoverage;
  recordKeysHash: string | null; // SHA-256 of sorted typedId list with vector rows
  recordsSha256: string;
  files: {
    documents: string;
    probeSample128: string;
    vectors?: string;
  };
  fileChecksums: Record<string, { sha256: string; bytes: number }>;
}

/**
 * Embedding Generator Interface (compatible with mock fixtures or remote TEI).
 */
export interface EmbeddingGenerator {
  generateBatches(
    texts: string[],
    options?: { batchSize?: number; onProgress?: (completed: number, total: number) => void }
  ): Promise<Float32Array[]>;
}

/**
 * Hour 3 completion forecast result with 50% contingency.
 */
export interface CompletionForecast {
  totalDocuments: number;
  completedDocuments: number;
  remainingDocuments: number;
  elapsedSeconds: number;
  docsPerSecond: number;
  estimatedRemainingSeconds: number;
  contingencySeconds: number; // 50% contingency buffer
  totalForecastRemainingSeconds: number;
  deadlineSeconds: number;
  meetsDeadline: boolean;
  formattedSummary: string;
}
