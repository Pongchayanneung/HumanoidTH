import { createHash } from "node:crypto";
import type {
  ModelProfile,
  VectorValidationResult,
  VectorValidationCheck,
  CompletionForecast
} from "./vector-types";
import type { SearchDocument } from "./types";

export const BYTES_PER_FLOAT32 = 4;

/**
 * Normalizes a vector using L2 norm: v' = v / ||v||_2.
 * Returns the normalized Float32Array.
 * Throws an error if the vector is all zeros or non-finite.
 */
export function l2Normalize(vec: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    const val = vec[i];
    if (!Number.isFinite(val)) {
      throw new Error(`Vector contains non-finite value at index ${i}: ${val}`);
    }
    sumSq += val * val;
  }

  const norm = Math.sqrt(sumSq);
  if (norm < 1e-12) {
    throw new Error("Cannot normalize zero-magnitude vector");
  }

  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    out[i] = vec[i] / norm;
  }
  return out;
}

/**
 * Encodes an array of Float32Array vectors into a contiguous little-endian binary Buffer.
 */
export function encodeVectorsToBuffer(vectors: Float32Array[], dimensions: number = 1024): Buffer {
  const totalFloats = vectors.length * dimensions;
  const buffer = Buffer.alloc(totalFloats * BYTES_PER_FLOAT32);

  for (let r = 0; r < vectors.length; r++) {
    const vec = vectors[r];
    if (vec.length !== dimensions) {
      throw new Error(`Vector at row ${r} has length ${vec.length}, expected ${dimensions}`);
    }
    const offset = r * dimensions * BYTES_PER_FLOAT32;
    for (let d = 0; d < dimensions; d++) {
      buffer.writeFloatLE(vec[d], offset + d * BYTES_PER_FLOAT32);
    }
  }

  return buffer;
}

/**
 * Reads a single vector from a binary Float32 buffer at the specified 0-indexed row.
 */
export function readVectorAtRow(
  buffer: Buffer,
  row: number,
  dimensions: number = 1024
): Float32Array {
  const rowBytes = dimensions * BYTES_PER_FLOAT32;
  const offset = row * rowBytes;

  if (offset + rowBytes > buffer.length) {
    throw new RangeError(
      `Row offset ${offset} + ${rowBytes} exceeds buffer length ${buffer.length}`
    );
  }

  const vec = new Float32Array(dimensions);
  for (let d = 0; d < dimensions; d++) {
    vec[d] = buffer.readFloatLE(offset + d * BYTES_PER_FLOAT32);
  }
  return vec;
}

/**
 * Computes cosine similarity between two normalized Float32Array vectors: dot(a, b).
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * Computes deterministic SHA-256 hash of ordered document typed IDs that have vector rows.
 */
export function computeRecordKeysHash(documents: SearchDocument[]): string {
  const vectorDocs = documents
    .filter((d) => d.vectorRow !== null && d.vectorRow !== undefined)
    .sort((a, b) => (a.vectorRow ?? 0) - (b.vectorRow ?? 0));

  const joined = vectorDocs.map((d) => `${d.vectorRow}:${d.typedId}:${d.contentHash}`).join("\n");
  return createHash("sha256").update(joined).digest("hex");
}

/**
 * Validates a staged or published vector release against all acceptance constraints.
 */
export function validateVectorRelease(params: {
  buffer: Buffer;
  documents: SearchDocument[];
  expectedDimensions: number;
  expectedVectorCount?: number;
  profile?: ModelProfile | null;
}): VectorValidationResult {
  const { buffer, documents, expectedDimensions, expectedVectorCount } = params;
  const checks: VectorValidationCheck[] = [];
  const errors: string[] = [];

  const rowBytes = expectedDimensions * BYTES_PER_FLOAT32;
  const actualVectorCount = buffer.length === 0 ? 0 : buffer.length / rowBytes;
  const isIntegerCount = Number.isInteger(actualVectorCount);
  const expectedBytes = (expectedVectorCount ?? actualVectorCount) * rowBytes;

  // 1. File size alignment check
  const sizeCheck = isIntegerCount && buffer.length === expectedBytes;
  checks.push({
    name: "file_size_alignment",
    passed: sizeCheck,
    detail: `Buffer size is ${buffer.length} bytes for ${actualVectorCount} vectors of ${expectedDimensions} dims`
  });
  if (!sizeCheck) {
    errors.push(
      `Buffer length ${buffer.length} is not aligned to ${rowBytes} bytes/row (expected ${expectedBytes})`
    );
  }

  // 2. Vector content finite and L2-normalized checks
  let allFinite = true;
  let allNonZero = true;
  let allNormalized = true;
  let sampleCount = Math.min(actualVectorCount, 250); // Sample up to 250 vectors for fast check
  const sampleIndices = new Set<number>();
  for (let i = 0; i < sampleCount; i++) {
    sampleIndices.add(Math.floor((i / sampleCount) * actualVectorCount));
  }

  for (const row of sampleIndices) {
    if (row >= actualVectorCount) continue;
    try {
      const vec = readVectorAtRow(buffer, row, expectedDimensions);
      let sumSq = 0;
      for (let d = 0; d < vec.length; d++) {
        const val = vec[d];
        if (!Number.isFinite(val)) {
          allFinite = false;
          break;
        }
        sumSq += val * val;
      }
      if (sumSq < 1e-12) {
        allNonZero = false;
      }
      const norm = Math.sqrt(sumSq);
      if (Math.abs(norm - 1.0) > 0.05) {
        allNormalized = false;
      }
    } catch {
      allFinite = false;
    }
  }

  checks.push({
    name: "finite_values",
    passed: allFinite,
    detail: allFinite ? "All checked vector elements are finite IEEE-754 floats" : "Found NaN or Infinity"
  });
  if (!allFinite) errors.push("Vector elements contain non-finite numbers (NaN or Infinity)");

  checks.push({
    name: "nonzero_norms",
    passed: allNonZero,
    detail: allNonZero ? "All checked vectors have non-zero norms" : "Found zero-magnitude vector"
  });
  if (!allNonZero) errors.push("Found zero-magnitude vector");

  checks.push({
    name: "l2_normalization",
    passed: allNormalized,
    detail: allNormalized ? "Vectors are L2 normalized (||v|| ~ 1.0)" : "Vectors are not L2 normalized"
  });
  if (!allNormalized) errors.push("Vectors fail L2 normalization check");

  // 3. Document vectorRow mapping check
  const vectorDocs = documents.filter((d) => d.vectorRow !== null && d.vectorRow !== undefined);
  let sequentialRows = true;
  const seenRows = new Set<number>();

  for (const doc of vectorDocs) {
    const row = doc.vectorRow!;
    if (seenRows.has(row) || row < 0 || row >= actualVectorCount) {
      sequentialRows = false;
      break;
    }
    seenRows.add(row);
  }

  checks.push({
    name: "ordered_typed_key_mapping",
    passed: sequentialRows && (vectorDocs.length === actualVectorCount),
    detail: `Found ${vectorDocs.length} mapped documents for ${actualVectorCount} binary vector rows`
  });
  if (!sequentialRows || vectorDocs.length !== actualVectorCount) {
    errors.push(
      `Document vectorRow mapping mismatch: ${vectorDocs.length} mapped docs vs ${actualVectorCount} binary rows`
    );
  }

  return {
    isValid: errors.length === 0,
    dimensions: expectedDimensions,
    vectorCount: actualVectorCount,
    expectedBytes,
    actualBytes: buffer.length,
    checks,
    errors
  };
}

/**
 * Computes Hour 3 remaining work forecast with 50% contingency.
 * Acceptance criteria: At hour 3 use measured remaining work plus 50% contingency
 * to forecast completion before hour 4½.
 */
export function calculateCompletionForecast(params: {
  totalDocuments: number;
  completedDocuments: number;
  elapsedSeconds: number;
  deadlineSeconds?: number; // default: 16,200 seconds (4.5 hours)
}): CompletionForecast {
  const {
    totalDocuments,
    completedDocuments,
    elapsedSeconds,
    deadlineSeconds = 4.5 * 3600 // 4.5 hours from feature start
  } = params;

  const remainingDocuments = Math.max(0, totalDocuments - completedDocuments);
  const docsPerSecond = elapsedSeconds > 0 && completedDocuments > 0
    ? completedDocuments / elapsedSeconds
    : 1.0;

  const estimatedRemainingSeconds = docsPerSecond > 0 ? remainingDocuments / docsPerSecond : 0;
  const contingencySeconds = estimatedRemainingSeconds * 0.5; // 50% contingency
  const totalForecastRemainingSeconds = estimatedRemainingSeconds + contingencySeconds;

  const totalForecastElapsedSeconds = elapsedSeconds + totalForecastRemainingSeconds;
  const meetsDeadline = totalForecastElapsedSeconds <= deadlineSeconds;

  const formattedSummary = [
    `Progress: ${completedDocuments}/${totalDocuments} docs (${((completedDocuments / totalDocuments) * 100).toFixed(1)}%)`,
    `Measured Throughput: ${docsPerSecond.toFixed(2)} docs/sec`,
    `Raw Estimate: ${(estimatedRemainingSeconds / 60).toFixed(1)} min`,
    `50% Contingency Buffer: ${(contingencySeconds / 60).toFixed(1)} min`,
    `Total Forecast Remaining: ${(totalForecastRemainingSeconds / 60).toFixed(1)} min`,
    `Forecast Finish: ${(totalForecastElapsedSeconds / 3600).toFixed(2)} hrs (Deadline: ${(deadlineSeconds / 3600).toFixed(1)} hrs)`,
    `Verdict: ${meetsDeadline ? "ON TRACK (Meets Hour 4½ Gate)" : "LATE (Fallback to Partial Semantic Release Required)"}`
  ].join(" | ");

  return {
    totalDocuments,
    completedDocuments,
    remainingDocuments,
    elapsedSeconds,
    docsPerSecond,
    estimatedRemainingSeconds,
    contingencySeconds,
    totalForecastRemainingSeconds,
    deadlineSeconds,
    meetsDeadline,
    formattedSummary
  };
}
