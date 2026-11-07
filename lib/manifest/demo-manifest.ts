import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type CheckedRecordKind =
  | "robot_model"
  | "source_record"
  | "contribution"
  | "perspective_annotation"
  | "triplet";

export type ExclusionCategory =
  | "placeholder"
  | "unverified_claim"
  | "duplicate"
  | "pending_review"
  | "insufficient_evidence";

export interface CheckedRecord {
  typedId: string;
  canonicalUrl: string;
  recordType: CheckedRecordKind;
  title: string;
  checkedClaims: string[];
  reviewer: string;
  reviewedDate: string;
  uncertainty: number;
  publicEligibility: boolean;
  sourceType: string;
  origin: string;
  evidence: string;
}

export interface ExcludedRecord {
  identifier: string;
  exclusionCategory: ExclusionCategory;
  reason: string;
}

export interface CheckedManifest {
  manifestVersion: string;
  datasetId: string;
  title: string;
  generatedAt: string;
  reviewer: string;
  originalCorpus: {
    filename: string;
    sha256: string;
    totalRecordsInCorpus: number;
    preserved: boolean;
  };
  policyNotice: string;
  counts: {
    checkedPublicRecords: number;
    robotModels: number;
    contributions: number;
    sourceRecords: number;
    tripletRelations: number;
    perspectiveAnnotations: number;
    excludedDocumentedRecords: number;
  };
  records: CheckedRecord[];
  excludedRecords: ExcludedRecord[];
}

export const CANONICAL_CORPUS_LF_SHA256 =
  "29c634dc20af30bca15726d4e253c0688ec86bd6cb6246965a136d2e78597879";

let cachedManifest: CheckedManifest | null = null;
let publicTypedIdSet: Set<string> | null = null;
let publicCanonicalUrlSet: Set<string> | null = null;
let excludedIdSet: Set<string> | null = null;

export function getManifestPath(): string {
  return resolve(process.cwd(), "data/checked-demonstration-manifest.v1.json");
}

/**
 * Loads the checked demonstration manifest from disk.
 * Returns a deep clone so caller mutations do not corrupt the internal cache.
 */
export function loadCheckedDemoManifest(customPath?: string): CheckedManifest {
  if (cachedManifest && !customPath) {
    return structuredClone(cachedManifest);
  }

  const manifestPath = customPath || getManifestPath();
  const raw = readFileSync(manifestPath, "utf-8");
  const manifest = JSON.parse(raw) as CheckedManifest;

  validateCheckedDemoManifest(manifest);

  if (!customPath) {
    cachedManifest = manifest;
    publicTypedIdSet = new Set(
      manifest.records.filter((r) => r.publicEligibility).map((r) => r.typedId)
    );
    publicCanonicalUrlSet = new Set(
      manifest.records.filter((r) => r.publicEligibility).map((r) => r.canonicalUrl)
    );
    excludedIdSet = new Set(manifest.excludedRecords.map((e) => e.identifier));
  }

  return structuredClone(manifest);
}

/**
 * Checks whether a given exact typedId (e.g. 'robot_model:dinsaw-robot')
 * is an approved public member in the checked manifest.
 *
 * NOTE: Gating is strictly by typed identity. URL lookups do NOT grant membership.
 */
export function isPublicCheckedRecord(typedId: string): boolean {
  if (!publicTypedIdSet) {
    loadCheckedDemoManifest();
  }

  return publicTypedIdSet?.has(typedId) ?? false;
}

/**
 * Checks whether a URL is cited by any public record in the checked manifest.
 * Used for provenance lookups, NOT for identity or access-control gating.
 */
export function isPublicCheckedUrl(url: string): boolean {
  if (!publicCanonicalUrlSet) {
    loadCheckedDemoManifest();
  }

  return publicCanonicalUrlSet?.has(url) ?? false;
}

/**
 * Checks whether an identifier is an explicitly excluded record (e.g. placeholder, unverified claim).
 */
export function isExcludedDemoRecord(identifier: string): boolean {
  if (!excludedIdSet) {
    loadCheckedDemoManifest();
  }

  return excludedIdSet?.has(identifier) ?? false;
}

/**
 * Returns all checked public records matching an optional recordType filter.
 */
export function getPublicCheckedRecords(recordType?: CheckedRecordKind): CheckedRecord[] {
  const manifest = loadCheckedDemoManifest();
  const eligible = manifest.records.filter((r) => r.publicEligibility);
  if (!recordType) {
    return eligible;
  }
  return eligible.filter((r) => r.recordType === recordType);
}

/**
 * Validates the internal consistency and schema compliance of the manifest.
 * Throws an Error if validation fails.
 */
export function validateCheckedDemoManifest(manifest: CheckedManifest): void {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Manifest must be a non-null object.");
  }

  if (!manifest.manifestVersion || typeof manifest.manifestVersion !== "string") {
    throw new Error("Manifest is missing manifestVersion.");
  }

  if (!manifest.datasetId || typeof manifest.datasetId !== "string") {
    throw new Error("Manifest is missing datasetId.");
  }

  if (!manifest.originalCorpus || typeof manifest.originalCorpus !== "object") {
    throw new Error("Manifest must contain originalCorpus object.");
  }

  if (manifest.originalCorpus.preserved !== true) {
    throw new Error("Manifest must certify originalCorpus.preserved is true.");
  }

  if (manifest.originalCorpus.sha256 !== CANONICAL_CORPUS_LF_SHA256) {
    throw new Error(
      `Manifest originalCorpus.sha256 mismatch. Expected ${CANONICAL_CORPUS_LF_SHA256}, got ${manifest.originalCorpus.sha256}`
    );
  }

  if (!Array.isArray(manifest.records) || manifest.records.length === 0) {
    throw new Error("Manifest must contain at least one checked demonstration record.");
  }

  if (!Array.isArray(manifest.excludedRecords)) {
    throw new Error("Manifest must contain excludedRecords array.");
  }

  const allowedRecordTypes: CheckedRecordKind[] = [
    "robot_model",
    "source_record",
    "contribution",
    "perspective_annotation",
    "triplet"
  ];

  const allowedExclusionCategories: ExclusionCategory[] = [
    "placeholder",
    "unverified_claim",
    "duplicate",
    "pending_review",
    "insufficient_evidence"
  ];

  const typedIdSet = new Set<string>();

  for (const record of manifest.records) {
    if (!record.typedId || typeof record.typedId !== "string") {
      throw new Error(`Record is missing valid typedId: ${JSON.stringify(record)}`);
    }

    if (!/^[a-z_]+:[a-z0-9_-]+$/.test(record.typedId)) {
      throw new Error(`Record typedId has invalid format: '${record.typedId}'. Expected 'kind:slug'.`);
    }

    if (!allowedRecordTypes.includes(record.recordType)) {
      throw new Error(`Record ${record.typedId} has unknown recordType '${record.recordType}'.`);
    }

    const expectedPrefix =
      record.recordType === "perspective_annotation"
        ? "perspective:"
        : `${record.recordType}:`;

    if (!record.typedId.startsWith(expectedPrefix)) {
      throw new Error(
        `Record typedId '${record.typedId}' prefix does not match expected prefix '${expectedPrefix}' for recordType '${record.recordType}'.`
      );
    }

    if (typedIdSet.has(record.typedId)) {
      throw new Error(`Duplicate typedId found in manifest: ${record.typedId}`);
    }
    typedIdSet.add(record.typedId);

    if (!record.canonicalUrl || typeof record.canonicalUrl !== "string") {
      throw new Error(`Record ${record.typedId} is missing canonicalUrl.`);
    }

    try {
      const parsedUrl = new URL(record.canonicalUrl);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        throw new Error(`URL protocol must be http or https, got '${parsedUrl.protocol}'.`);
      }
    } catch {
      throw new Error(`Record ${record.typedId} has invalid canonicalUrl: '${record.canonicalUrl}'.`);
    }

    if (!record.title || typeof record.title !== "string" || record.title.trim() === "") {
      throw new Error(`Record ${record.typedId} is missing valid title.`);
    }

    if (!Array.isArray(record.checkedClaims) || record.checkedClaims.length === 0) {
      throw new Error(`Record ${record.typedId} must have at least one checkedClaim.`);
    }

    for (const claim of record.checkedClaims) {
      if (typeof claim !== "string" || claim.trim() === "") {
        throw new Error(`Record ${record.typedId} contains an invalid non-string claim.`);
      }
    }

    if (!record.reviewer || typeof record.reviewer !== "string") {
      throw new Error(`Record ${record.typedId} must identify the human reviewer.`);
    }

    if (!record.reviewedDate || !/^\d{4}-\d{2}-\d{2}$/.test(record.reviewedDate)) {
      throw new Error(`Record ${record.typedId} has invalid reviewedDate (expected YYYY-MM-DD).`);
    }

    if (
      typeof record.uncertainty !== "number" ||
      Number.isNaN(record.uncertainty) ||
      record.uncertainty < 0 ||
      record.uncertainty > 1
    ) {
      throw new Error(`Record ${record.typedId} uncertainty must be a float between 0 and 1.`);
    }

    if (typeof record.publicEligibility !== "boolean") {
      throw new Error(`Record ${record.typedId} must have boolean publicEligibility.`);
    }

    if (!record.evidence || typeof record.evidence !== "string" || record.evidence.trim() === "") {
      throw new Error(`Record ${record.typedId} must provide non-empty evidence string.`);
    }
  }

  // Validate excluded records schema
  for (const excluded of manifest.excludedRecords) {
    if (!excluded.identifier || typeof excluded.identifier !== "string") {
      throw new Error("Excluded record is missing identifier.");
    }
    if (!allowedExclusionCategories.includes(excluded.exclusionCategory)) {
      throw new Error(
        `Excluded record ${excluded.identifier} has invalid exclusionCategory '${excluded.exclusionCategory}'.`
      );
    }
    if (!excluded.reason || typeof excluded.reason !== "string" || excluded.reason.trim() === "") {
      throw new Error(`Excluded record ${excluded.identifier} is missing a non-empty reason.`);
    }
  }

  // Ensure no excluded records sneak into the public records list
  const excludedIdentifiers = new Set(manifest.excludedRecords.map((e) => e.identifier));
  for (const record of manifest.records) {
    if (excludedIdentifiers.has(record.typedId)) {
      throw new Error(
        `Manifest inconsistency: Record ${record.typedId} is both checked public and in excludedRecords.`
      );
    }
  }

  // Validate manifest counts match actual record arrays
  if (manifest.counts) {
    if (manifest.counts.checkedPublicRecords !== manifest.records.length) {
      throw new Error(
        `Counts mismatch: checkedPublicRecords is ${manifest.counts.checkedPublicRecords} but records.length is ${manifest.records.length}.`
      );
    }
    if (manifest.counts.excludedDocumentedRecords !== manifest.excludedRecords.length) {
      throw new Error(
        `Counts mismatch: excludedDocumentedRecords is ${manifest.counts.excludedDocumentedRecords} but excludedRecords.length is ${manifest.excludedRecords.length}.`
      );
    }
  }
}
