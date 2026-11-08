import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProbeSample } from "./exporter";
import type { SearchDocument, SearchExportManifest } from "./types";
import { VectorReleaseBuilder } from "./vector-builder";
import { readVectorAtRow, validateVectorRelease } from "./vector-io";
import { DEFAULT_MODEL_PROFILE, type VectorBatchCheckpoint, type VectorReleaseManifest } from "./vector-types";

/** Refuse to write a release that attaches vectors to fewer than this share of the served documents. */
export const DEFAULT_MIN_REKEY_COVERAGE = 0.95;
const MAX_REPORTED_UNMATCHED = 20;

export interface RekeyOptions {
  /** A validated vector release directory: manifest.json, documents.json, vectors.f32. */
  sourceDir: string;
  /** The documents the service actually serves (exportSearchCorpusFromDb of the deployed database). */
  documents: SearchDocument[];
  /** Export manifest of those documents; its counts and policy are carried into the new release. */
  baseManifest: SearchExportManifest;
  /** Receives releases/<releaseId>/ and active-release.json. */
  outputDir: string;
  releaseId: string;
  minCoverage?: number;
}

export interface RekeyResult {
  written: boolean;
  total: number;
  matched: number;
  coverage: number;
  byKind: Record<string, { total: number; matched: number }>;
  /** Ids only, never content; at most 20. */
  unmatchedIds: string[];
  reason?: string;
}

// A stored vector is a pure function of the document's retrievalText (the builder embeds
// `retrievalText || title` with no instruction prefix), so two records with the same kind and
// text can share a vector. contentHash cannot be used to match: it covers the typedId, which is
// exactly what differs between a seed-file corpus and a database.
const textKey = (doc: SearchDocument) => `${doc.kind}|${doc.retrievalText || doc.title}`;

/**
 * Re-keys the vectors of an existing release onto the typed ids of another corpus. Reads the source
 * release (and validates it completely), writes nothing unless coverage reaches `minCoverage`, and
 * packages the result with the real builder so checksums, record keys and the manifest are produced
 * by the same code as an ordinary release. No embedding service is called.
 */
export async function rekeyRelease(options: RekeyOptions): Promise<RekeyResult> {
  const { sourceDir, documents, baseManifest, outputDir, releaseId } = options;
  const minCoverage = options.minCoverage ?? DEFAULT_MIN_REKEY_COVERAGE;
  const sourceManifest = JSON.parse(readFileSync(join(sourceDir, "manifest.json"), "utf8")) as VectorReleaseManifest;
  const sourceDocs = JSON.parse(readFileSync(join(sourceDir, "documents.json"), "utf8")) as SearchDocument[];
  const sourceVectors = readFileSync(join(sourceDir, "vectors.f32"));
  const profile = sourceManifest.modelProfile;
  if (!profile || profile.profileHash !== DEFAULT_MODEL_PROFILE.profileHash) {
    throw new Error(`Source release is not bound to the pinned model profile ${DEFAULT_MODEL_PROFILE.profileHash}`);
  }
  const sourceCheck = validateVectorRelease({ buffer: sourceVectors, documents: sourceDocs, expectedDimensions: profile.dimensions, profile, manifest: sourceManifest, manifestDir: sourceDir });
  if (!sourceCheck.isValid) throw new Error(`Source release is invalid: ${sourceCheck.errors.slice(0, 3).join("; ")}`);

  const rowByText = new Map<string, number>();
  for (const doc of sourceDocs) if (doc.vectorRow !== null && !rowByText.has(textKey(doc))) rowByText.set(textKey(doc), doc.vectorRow);

  const matched: SearchDocument[] = [];
  const unmatched: SearchDocument[] = [];
  const byKind: RekeyResult["byKind"] = {};
  for (const doc of documents) {
    const hit = rowByText.has(textKey(doc));
    (hit ? matched : unmatched).push(doc);
    const kind = (byKind[doc.kind] ??= { total: 0, matched: 0 });
    kind.total++;
    if (hit) kind.matched++;
  }
  const coverage = documents.length === 0 ? 0 : matched.length / documents.length;
  const result: RekeyResult = {
    written: false, total: documents.length, matched: matched.length, coverage, byKind,
    unmatchedIds: unmatched.map((doc) => doc.typedId).sort().slice(0, MAX_REPORTED_UNMATCHED),
  };
  if (matched.length === 0 || coverage < minCoverage) {
    return { ...result, reason: `coverage ${(coverage * 100).toFixed(2)}% is below the minimum ${(minCoverage * 100).toFixed(0)}%; nothing written` };
  }

  if (existsSync(join(outputDir, "releases", releaseId))) {
    throw new Error(`Release ${releaseId} already exists in the output directory; choose another --release-id (a published release is never overwritten)`);
  }
  const work = mkdtempSync(join(tmpdir(), "rekey-release-"));
  try {
    // Matched documents first: the builder gives vectors to the first `maxVectorsToGenerate` rows only.
    const ordered = [...matched, ...unmatched].map((doc) => ({ ...doc, vectorRow: null }));
    const documentsPath = join(work, "documents.json");
    writeFileSync(documentsPath, JSON.stringify(ordered));
    const checkpoint: VectorBatchCheckpoint = {
      checkpointVersion: "1.0", modelProfileHash: profile.profileHash, batchIndex: 0, batchSize: matched.length, createdAt: new Date().toISOString(),
      entries: matched.map((doc, row) => ({
        typedId: doc.typedId, contentHash: doc.contentHash, vectorRow: row,
        vector: Array.from(readVectorAtRow(sourceVectors, rowByText.get(textKey(doc))!, profile.dimensions)),
      })),
    };
    mkdirSync(join(work, "ckpt"));
    writeFileSync(join(work, "ckpt", `checkpoint-${profile.profileHash}-batch-0.json`), JSON.stringify(checkpoint));
    // The builder reads the base manifest and the probe sample from its output directory.
    const stageOut = join(work, "out");
    mkdirSync(stageOut);
    const probeJson = JSON.stringify(createProbeSample(ordered), null, 2);
    writeFileSync(join(stageOut, "probe-128.json"), probeJson);
    writeFileSync(join(stageOut, "manifest.json"), JSON.stringify(baseManifest, null, 2));
    const builder = new VectorReleaseBuilder({
      documentsPath, outputDir: stageOut, checkpointDir: join(work, "ckpt"), stagingDir: join(work, "stage"),
      profile, releaseId, datasetId: baseManifest.datasetId, maxVectorsToGenerate: matched.length,
      embeddingGenerator: { generateBatches: async () => { throw new Error("rekey never calls an embedding service"); } },
    });
    const built = await builder.build();
    if (!built.validation.isValid) throw new Error(`Re-keyed release failed validation: ${built.validation.errors.slice(0, 3).join("; ")}`);

    // Publish without ever touching a live release: copy to a temporary name, re-validate the copy,
    // rename the directory into place, then replace the pointer last and atomically.
    const releaseDir = join(outputDir, "releases", releaseId);
    const tempDir = join(outputDir, "releases", `.${releaseId}.tmp-${process.pid}`);
    mkdirSync(join(outputDir, "releases"), { recursive: true });
    rmSync(tempDir, { recursive: true, force: true });
    cpSync(join(stageOut, "releases", releaseId), tempDir, { recursive: true });
    const copied = validateVectorRelease({
      buffer: readFileSync(join(tempDir, "vectors.f32")), documents: JSON.parse(readFileSync(join(tempDir, "documents.json"), "utf8")) as SearchDocument[],
      expectedDimensions: profile.dimensions, profile, manifest: JSON.parse(readFileSync(join(tempDir, "manifest.json"), "utf8")) as VectorReleaseManifest, manifestDir: tempDir,
    });
    for (const file of ["documents.json", "manifest.json", "vectors.f32", "probe-128.json"]) if (!existsSync(join(tempDir, file))) copied.errors.push(`missing ${file}`);
    if (!copied.isValid || copied.errors.length > 0) { rmSync(tempDir, { recursive: true, force: true }); throw new Error(`Copied release failed validation: ${copied.errors.slice(0, 3).join("; ")}`); }
    renameSync(tempDir, releaseDir);
    const pointerTemp = join(outputDir, `active-release.json.tmp.${process.pid}`);
    copyFileSync(join(stageOut, "active-release.json"), pointerTemp);
    renameSync(pointerTemp, join(outputDir, "active-release.json"));
    return { ...result, written: true };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
