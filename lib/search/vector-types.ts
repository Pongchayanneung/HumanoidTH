import type { SearchRecordKind, LanguageTag, SearchExportManifest } from "./types";

/**
 * Model Profile pinning embedding runtime configuration for Atlas Search.
 * Must match between corpus embedding and query inference.
 */
export interface ModelProfile {
  modelId: string;
  revision: string; // Pinned git commit SHA or tag (never mutable "main")
  dimensions: number; // pinned at 1024
  precision: "float32";
  pooling: "last_token" | "mean" | "cls";
  normalized: boolean;
  queryInstructionTask: string;
  profileHash: string; // Deterministic hash of configuration + provider
  provider: "tei" | "mock" | "remote";
}

/**
 * Pinned model profile for deterministic mock generator (tests / benchmark fixtures).
 */
export const MOCK_MODEL_PROFILE: ModelProfile = {
  modelId: "mock/deterministic-hash-128",
  revision: "mock-v1",
  dimensions: 1024,
  precision: "float32",
  pooling: "last_token",
  normalized: true,
  queryInstructionTask: "Mock embedding generator for local tests and benchmark fixtures.",
  profileHash: "mock-deterministic-hash-1024-v1",
  provider: "mock"
};

/**
 * Pinned model profile for production Qwen-compatible embedding service.
 * Pinned to explicit commit revision e085e72a818c399b19e0813958fbc8d8e58dfd27.
 */
export const DEFAULT_MODEL_PROFILE: ModelProfile = {
  modelId: "Alibaba-NLP/gte-Qwen2-1.5B-instruct",
  revision: "e085e72a818c399b19e0813958fbc8d8e58dfd27",
  dimensions: 1024,
  precision: "float32",
  pooling: "last_token",
  normalized: true,
  queryInstructionTask: "Given a Thai or English robotics information request, retrieve relevant public atlas records.",
  profileHash: "qwen2-gte-1024-f32-l2-e085e72-v1",
  provider: "tei"
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
 * Extends SearchExportManifest to preserve F3 counts, policy, and export metadata.
 */
export interface VectorReleaseManifest extends Partial<SearchExportManifest> {
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
    [key: string]: string | undefined;
  };
  fileChecksums: Record<string, { sha256: string; bytes: number }>;
}

/**
 * Active Release pointer tracking atomic switch boundary.
 */
export interface ActiveVectorReleasePointer {
  releaseId: string;
  datasetId: string;
  activeAt: string;
  manifestSha256: string;
  recordsSha256: string;
  vectorSha256?: string;
  modelProfileHash?: string | null;
  files: {
    manifest: string;
    documents: string;
    vectors?: string;
  };
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
