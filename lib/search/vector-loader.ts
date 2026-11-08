import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { SearchFixtureIndex, SearchPostOptions, SearchSemanticVectors } from "./api";
import type { SearchDocument } from "./types";
import { readActiveReleasePointer, validateVectorRelease, BYTES_PER_FLOAT32 } from "./vector-io";
import type { VectorReleaseManifest } from "./vector-types";

/**
 * Production vector loader for Atlas Search. Server-only (reads files from disk).
 *
 * It reads the release named by `<searchDir>/active-release.json`, validates the whole release
 * once (every row finite, non-zero and normalized, and every checksum in the manifest) and keeps
 * the parsed vectors in memory. On every call it then attaches release rows to the live
 * documents by `typedId` AND `contentHash` (setting `vectorRow`), because the database exporter
 * leaves `vectorRow` null. A live document that changed since the release was built gets null and
 * is simply not semantically searchable until vectors are rebuilt.
 *
 * Contract (see docs/atlas-search-api-f6.md): an absent release returns null (keyword mode); a
 * present but invalid release throws. Wrap with `withKeywordFallback` where a bad file must not
 * take search down.
 */
export interface ReleaseVectorLoaderOptions {
  /** Directory holding active-release.json, normally <repo>/data/search. */
  searchDir: string;
}

interface LoadedRelease {
  key: string;
  releaseId: string;
  vectors: SearchSemanticVectors;
  byTypedId: Map<string, { row: number; contentHash: string }>;
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function insideDirectory(parent: string, child: string): boolean {
  const p = resolve(parent) + sep;
  return resolve(child).startsWith(p);
}

function readRelease(searchDir: string): LoadedRelease | null {
  const pointer = readActiveReleasePointer(searchDir);
  if (!pointer || !pointer.files?.vectors || !pointer.files.manifest || !pointer.files.documents) return null;

  const abs = (relative: string) => (isAbsolute(relative) ? relative : join(searchDir, relative));
  const manifestPath = abs(pointer.files.manifest);
  const documentsPath = abs(pointer.files.documents);
  const vectorsPath = abs(pointer.files.vectors);
  // The pointer is a local file we wrote, but never follow it out of the search directory.
  for (const path of [manifestPath, documentsPath, vectorsPath]) {
    if (!insideDirectory(searchDir, path)) throw new Error("Active release pointer references a file outside the search directory");
    if (!existsSync(path)) throw new Error(`Active release file is missing: ${path.slice(resolve(searchDir).length + 1)}`);
  }

  const manifestBytes = readFileSync(manifestPath);
  if (pointer.manifestSha256 && sha256(manifestBytes) !== pointer.manifestSha256) throw new Error("Release manifest checksum does not match the active release pointer");
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as VectorReleaseManifest;
  const profile = manifest.modelProfile;
  if (!profile) return null; // keyword-only release

  const key = `${pointer.releaseId}:${pointer.manifestSha256}:${pointer.vectorSha256 ?? ""}`;
  const documents = JSON.parse(readFileSync(documentsPath, "utf8")) as SearchDocument[];
  const buffer = readFileSync(vectorsPath);
  const validation = validateVectorRelease({
    buffer,
    documents,
    expectedDimensions: profile.dimensions,
    profile,
    manifest,
    manifestDir: dirname(manifestPath),
  });
  if (!validation.isValid) throw new Error(`Active vector release is invalid: ${validation.errors.slice(0, 3).join("; ")}`);

  // Copy into an aligned ArrayBuffer so Float32Array views are valid on any platform.
  const aligned = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length);
  const rowBytes = profile.dimensions * BYTES_PER_FLOAT32;
  const count = buffer.length / rowBytes;
  const rows = new Map<number, Float32Array>();
  for (let row = 0; row < count; row++) rows.set(row, new Float32Array(aligned, row * rowBytes, profile.dimensions));

  const byTypedId = new Map<string, { row: number; contentHash: string }>();
  for (const doc of documents) {
    if (doc.vectorRow !== null && doc.vectorRow !== undefined) byTypedId.set(doc.typedId, { row: doc.vectorRow, contentHash: doc.contentHash });
  }
  return { key, releaseId: pointer.releaseId, vectors: { profile, rows }, byTypedId };
}

export function createReleaseVectorLoader(options: ReleaseVectorLoaderOptions): NonNullable<SearchPostOptions["loadVectors"]> {
  let loaded: LoadedRelease | null = null;
  let loadedPointerKey: string | null = null;
  let failure: Error | null = null;
  return async (index: SearchFixtureIndex): Promise<SearchSemanticVectors | null> => {
    const pointer = readActiveReleasePointer(options.searchDir);
    const pointerKey = pointer ? `${pointer.releaseId}:${pointer.manifestSha256}:${pointer.vectorSha256 ?? ""}` : null;
    if (pointerKey !== loadedPointerKey) {
      // Remember a failure for this pointer so a bad release is not re-read and re-validated on every request.
      loadedPointerKey = pointerKey;
      loaded = null;
      failure = null;
      try { loaded = readRelease(options.searchDir); } catch (error) { failure = error instanceof Error ? error : new Error("invalid vector release"); }
    }
    if (failure) throw failure;
    if (!loaded) return null;
    for (const doc of index.documents) {
      const entry = loaded.byTypedId.get(doc.typedId);
      doc.vectorRow = entry && entry.contentHash === doc.contentHash ? entry.row : null;
    }
    return loaded.vectors;
  };
}

/**
 * Turns a loader failure into keyword mode instead of an HTTP 503 for every search. The reason is
 * logged as a short message (no paths beyond the file name, no document text).
 */
export function withKeywordFallback(
  loader: NonNullable<SearchPostOptions["loadVectors"]>,
  log: (message: string) => void = (message) => console.warn(message),
): NonNullable<SearchPostOptions["loadVectors"]> {
  return async (index, signal) => {
    try {
      return await loader(index, signal);
    } catch (error) {
      log(`[atlas-search] vector release unavailable, serving keyword results: ${error instanceof Error ? error.message : "unknown error"}`);
      return null;
    }
  };
}
