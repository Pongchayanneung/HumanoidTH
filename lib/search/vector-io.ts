import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SearchDocument } from "./types";
import type {
  ModelProfile,
  VectorValidationCheck,
  VectorValidationResult,
  CompletionForecast,
  VectorReleaseManifest,
  ActiveVectorReleasePointer
} from "./vector-types";

export const BYTES_PER_FLOAT32 = 4;

/**
 * Normalizes a Float32Array to unit length using Euclidean (L2) norm.
 * Throws if the vector has zero magnitude or non-finite numbers.
 */
export function l2Normalize(vec: Float32Array): Float32Array {
  let sumSquares = 0;
  for (let i = 0; i < vec.length; i++) {
    const val = vec[i];
    if (!Number.isFinite(val)) {
      throw new Error(`Vector contains non-finite element at index ${i}: ${val}`);
    }
    sumSquares += val * val;
  }

  const norm = Math.sqrt(sumSquares);
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
 * Encodes an array of normalized Float32 vectors into a contiguous little-endian binary buffer.
 */
export function encodeVectorsToBuffer(vectors: Float32Array[], dimensions: number): Buffer {
  const totalBytes = vectors.length * dimensions * BYTES_PER_FLOAT32;
  const buffer = Buffer.alloc(totalBytes);

  for (let r = 0; r < vectors.length; r++) {
    const vec = vectors[r];
    if (vec.length !== dimensions) {
      throw new Error(
        `Vector at row ${r} has invalid dimension ${vec.length} (expected ${dimensions})`
      );
    }
    const byteOffset = r * dimensions * BYTES_PER_FLOAT32;
    for (let d = 0; d < dimensions; d++) {
      buffer.writeFloatLE(vec[d], byteOffset + d * BYTES_PER_FLOAT32);
    }
  }

  return buffer;
}

/**
 * Reads a single vector at a given row index from a binary Float32 buffer.
 */
export function readVectorAtRow(buffer: Buffer, rowIndex: number, dimensions: number): Float32Array {
  const rowBytes = dimensions * BYTES_PER_FLOAT32;
  const byteOffset = rowIndex * rowBytes;

  if (byteOffset + rowBytes > buffer.length || rowIndex < 0) {
    throw new RangeError(
      `Row ${rowIndex} out of bounds for buffer of size ${buffer.length} (${rowBytes} bytes/row)`
    );
  }

  const vec = new Float32Array(dimensions);
  for (let d = 0; d < dimensions; d++) {
    vec[d] = buffer.readFloatLE(byteOffset + d * BYTES_PER_FLOAT32);
  }
  return vec;
}

/**
 * Computes cosine similarity between two unit-normalized Float32 vectors.
 * Because vectors are L2-normalized, cosine similarity equals their dot product.
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
 * Computes SHA-256 hash over ordered typedId entries mapped in vector rows.
 * Validates that the sequence of vector rows corresponds exactly to the documents.
 */
export function computeRecordKeysHash(documents: SearchDocument[]): string {
  const mapped = documents
    .filter((d) => d.vectorRow !== null && d.vectorRow !== undefined)
    .sort((a, b) => a.vectorRow! - b.vectorRow!);

  const hasher = createHash("sha256");
  for (const doc of mapped) {
    hasher.update(`${doc.vectorRow}:${doc.typedId}:${doc.contentHash}\n`);
  }
  return hasher.digest("hex");
}

/**
 * Validates a staged or active vector release binary against document indices and manifest.
 * Strictly checks EVERY row in the buffer for finite numbers, non-zero norms, and L2 normalization.
 * If manifest and manifestDir are provided, verifies complete on-disk file checksums.
 */
export function validateVectorRelease(params: {
  buffer: Buffer;
  documents: SearchDocument[];
  expectedDimensions: number;
  expectedVectorCount?: number;
  profile?: ModelProfile | null;
  manifest?: VectorReleaseManifest;
  manifestDir?: string;
}): VectorValidationResult {
  const { buffer, documents, expectedDimensions, expectedVectorCount, manifest, manifestDir } = params;
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

  // 2. Vector content finite and L2-normalized checks across EVERY row (no sampling)
  let allFinite = true;
  let allNonZero = true;
  let allNormalized = true;

  for (let row = 0; row < actualVectorCount; row++) {
    try {
      const vec = readVectorAtRow(buffer, row, expectedDimensions);
      let sumSq = 0;
      for (let d = 0; d < vec.length; d++) {
        const val = vec[d];
        if (!Number.isFinite(val)) {
          allFinite = false;
          errors.push(`Row ${row} dim ${d} contains non-finite value (${val})`);
          break;
        }
        sumSq += val * val;
      }
      if (!allFinite) break;

      if (sumSq < 1e-12) {
        allNonZero = false;
        errors.push(`Row ${row} has zero magnitude`);
        break;
      }

      const norm = Math.sqrt(sumSq);
      if (Math.abs(norm - 1.0) > 0.05) {
        allNormalized = false;
        errors.push(`Row ${row} fails L2 normalization (norm: ${norm.toFixed(4)})`);
        break;
      }
    } catch (err: any) {
      allFinite = false;
      errors.push(`Row ${row} read error: ${err.message}`);
      break;
    }
  }

  checks.push({
    name: "finite_values",
    passed: allFinite,
    detail: allFinite
      ? `All ${actualVectorCount} vector rows contain strictly finite IEEE-754 floats`
      : "Found non-finite values (NaN or Infinity)"
  });

  checks.push({
    name: "nonzero_norms",
    passed: allNonZero,
    detail: allNonZero
      ? `All ${actualVectorCount} vector rows have non-zero norms`
      : "Found zero-magnitude vector"
  });

  checks.push({
    name: "l2_normalization",
    passed: allNormalized,
    detail: allNormalized
      ? `All ${actualVectorCount} vector rows are L2 normalized (||v|| ~ 1.0)`
      : "Vector rows fail L2 normalization check"
  });

  // 3. Document vectorRow mapping check
  const vectorDocs = documents.filter((d) => d.vectorRow !== null && d.vectorRow !== undefined);
  let sequentialRows = true;
  const seenRows = new Set<number>();

  for (const doc of vectorDocs) {
    const row = doc.vectorRow!;
    if (!Number.isInteger(row) || seenRows.has(row) || row < 0 || row >= actualVectorCount) {
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

  // 4. On-disk manifest and file checksum verification (if manifest & directory provided)
  if (manifest && manifestDir) {
    let filesValid = true;
    for (const [filename, expected] of Object.entries(manifest.fileChecksums || {})) {
      const filePath = join(manifestDir, filename);
      if (!existsSync(filePath)) {
        filesValid = false;
        errors.push(`Manifest file missing on disk: ${filename}`);
        continue;
      }
      const bytes = readFileSync(filePath);
      if (bytes.length !== expected.bytes) {
        filesValid = false;
        errors.push(`File ${filename} byte mismatch: expected ${expected.bytes}, found ${bytes.length}`);
      }
      const actualSha256 = createHash("sha256").update(bytes).digest("hex");
      if (actualSha256 !== expected.sha256) {
        filesValid = false;
        errors.push(`File ${filename} SHA-256 mismatch: expected ${expected.sha256}, found ${actualSha256}`);
      }
    }
    checks.push({
      name: "manifest_file_checksums",
      passed: filesValid,
      detail: filesValid
        ? "All staged manifest files and SHA-256 checksums verified on disk"
        : "Manifest checksum verification failed"
    });
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
 * Reads the active release pointer from searchDir, returning null if absent or invalid.
 */
export function readActiveReleasePointer(searchDir: string): ActiveVectorReleasePointer | null {
  const pointerPath = join(searchDir, "active-release.json");
  if (!existsSync(pointerPath)) return null;
  try {
    return JSON.parse(readFileSync(pointerPath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Counts distinct documents that already have a reusable vector checkpoint:
 * checkpoint matches the model profile hash and an entry's typedId and
 * contentHash equal the current document's. Unreadable files are skipped.
 */
export function countCompletedCheckpointDocuments(params: {
  checkpointDir: string;
  profileHash: string;
  documents: Pick<SearchDocument, "typedId" | "contentHash">[];
}): { completed: number; checkpointFiles: number } {
  const { checkpointDir, profileHash, documents } = params;
  if (!existsSync(checkpointDir)) return { completed: 0, checkpointFiles: 0 };

  const currentHashes = new Map<string, string>();
  for (const d of documents) currentHashes.set(d.typedId, d.contentHash);

  const done = new Set<string>();
  let checkpointFiles = 0;
  for (const file of readdirSync(checkpointDir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const content = JSON.parse(readFileSync(join(checkpointDir, file), "utf8"));
      if (content.modelProfileHash !== profileHash || !Array.isArray(content.entries)) continue;
      checkpointFiles++;
      for (const entry of content.entries) {
        if (currentHashes.get(entry.typedId) === entry.contentHash) done.add(entry.typedId);
      }
    } catch {
      // ignore unreadable checkpoint
    }
  }
  return { completed: done.size, checkpointFiles };
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

  if (
    completedDocuments <= 0 ||
    elapsedSeconds <= 0 ||
    !Number.isFinite(completedDocuments) ||
    !Number.isFinite(elapsedSeconds)
  ) {
    throw new Error(
      `Cannot calculate completion forecast: valid measured progress is required. Received completedDocuments=${completedDocuments}, elapsedSeconds=${elapsedSeconds}.`
    );
  }

  const remainingDocuments = Math.max(0, totalDocuments - completedDocuments);
  const docsPerSecond = completedDocuments / elapsedSeconds;

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
