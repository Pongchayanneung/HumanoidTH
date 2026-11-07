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

let cachedManifest: CheckedManifest | null = null;
let publicTypedIdSet: Set<string> | null = null;
let publicCanonicalUrlSet: Set<string> | null = null;
let excludedIdSet: Set<string> | null = null;

export function getManifestPath(): string {
  return resolve(process.cwd(), "data/checked-demonstration-manifest.v1.json");
}

/**
 * Loads the checked demonstration manifest from disk.
 * Uses caching to avoid repeated file reads.
 */
export function loadCheckedDemoManifest(customPath?: string): CheckedManifest {
  if (cachedManifest && !customPath) {
    return cachedManifest;
  }

  const manifestPath = customPath || getManifestPath();
  const raw = readFileSync(manifestPath, "utf-8");
  const manifest = JSON.parse(raw) as CheckedManifest;

  validateCheckedDemoManifest(manifest);

  if (!customPath) {
    cachedManifest = manifest;
    publicTypedIdSet = new Set(manifest.records.filter((r) => r.publicEligibility).map((r) => r.typedId));
    publicCanonicalUrlSet = new Set(manifest.records.filter((r) => r.publicEligibility).map((r) => r.canonicalUrl));
    excludedIdSet = new Set(manifest.excludedRecords.map((e) => e.identifier));
  }

  return manifest;
}

/**
 * Checks whether a given typed ID or canonical URL belongs to the checked public manifest.
 */
export function isPublicCheckedRecord(identifierOrUrl: string): boolean {
  if (!publicTypedIdSet || !publicCanonicalUrlSet) {
    loadCheckedDemoManifest();
  }

  return (
    (publicTypedIdSet?.has(identifierOrUrl) ?? false) ||
    (publicCanonicalUrlSet?.has(identifierOrUrl) ?? false)
  );
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
  if (!manifest.manifestVersion || typeof manifest.manifestVersion !== "string") {
    throw new Error("Manifest is missing manifestVersion.");
  }

  if (!manifest.datasetId || typeof manifest.datasetId !== "string") {
    throw new Error("Manifest is missing datasetId.");
  }

  if (!manifest.originalCorpus || !manifest.originalCorpus.sha256) {
    throw new Error("Manifest must link to and record the originalCorpus sha256.");
  }

  if (!Array.isArray(manifest.records) || manifest.records.length === 0) {
    throw new Error("Manifest must contain at least one checked demonstration record.");
  }

  if (!Array.isArray(manifest.excludedRecords)) {
    throw new Error("Manifest must contain excludedRecords array.");
  }

  const typedIdSet = new Set<string>();

  for (const record of manifest.records) {
    if (!record.typedId || typeof record.typedId !== "string") {
      throw new Error(`Record is missing valid typedId: ${JSON.stringify(record)}`);
    }

    if (typedIdSet.has(record.typedId)) {
      throw new Error(`Duplicate typedId found in manifest: ${record.typedId}`);
    }
    typedIdSet.add(record.typedId);

    if (!record.canonicalUrl || typeof record.canonicalUrl !== "string") {
      throw new Error(`Record ${record.typedId} is missing canonicalUrl.`);
    }

    if (!record.title || typeof record.title !== "string") {
      throw new Error(`Record ${record.typedId} is missing title.`);
    }

    if (!Array.isArray(record.checkedClaims) || record.checkedClaims.length === 0) {
      throw new Error(`Record ${record.typedId} must have at least one checkedClaim.`);
    }

    if (!record.reviewer || typeof record.reviewer !== "string") {
      throw new Error(`Record ${record.typedId} must identify the human reviewer.`);
    }

    if (!record.reviewedDate || typeof record.reviewedDate !== "string") {
      throw new Error(`Record ${record.typedId} must specify reviewedDate.`);
    }

    if (typeof record.uncertainty !== "number" || record.uncertainty < 0 || record.uncertainty > 1) {
      throw new Error(`Record ${record.typedId} uncertainty must be a float between 0 and 1.`);
    }

    if (typeof record.publicEligibility !== "boolean") {
      throw new Error(`Record ${record.typedId} must have boolean publicEligibility.`);
    }
  }

  // Ensure no excluded records sneak into the public records list
  const excludedIdentifiers = new Set(manifest.excludedRecords.map((e) => e.identifier));
  for (const record of manifest.records) {
    if (excludedIdentifiers.has(record.typedId) || excludedIdentifiers.has(record.canonicalUrl)) {
      throw new Error(
        `Manifest inconsistency: Record ${record.typedId} is both checked public and in excludedRecords.`
      );
    }
  }
}
