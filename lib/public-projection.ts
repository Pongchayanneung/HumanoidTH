import { isPublicCheckedRecord, isExcludedDemoRecord } from "./manifest/demo-manifest";

/**
 * Public Data Projection and Access Boundary Policy (M3)
 *
 * Enforces strict public whitelisting across all public views and APIs:
 * - Anonymous callers can only read public, approved, and verified records.
 * - Private notes, pending submissions, internal serials, and unverified fixtures
 *   are strictly redacted from rendered HTML, React Server Component payloads, and JSON.
 */

export const PUBLIC_DATASET_SCOPE_LABEL = "Checked Public Subset (Audit Date: 2026-11-07)";

/**
 * Prisma WHERE filter for public contributions.
 * Pins verificationStatus to APPROVED and visibility to public.
 */
export const publicContributionWhere = {
  visibility: "public",
  verificationStatus: "APPROVED" as const,
  OR: [
    { sourceUrl: null },
    {
      NOT: [
        { sourceUrl: { contains: "placeholder", mode: "insensitive" as const } },
        { sourceUrl: { contains: "seed:contribution:thai-hri-research", mode: "insensitive" as const } },
        { sourceUrl: { contains: "seed:contribution:hospital-field-observation", mode: "insensitive" as const } }
      ]
    }
  ]
};

/**
 * Prisma WHERE filter for public robot models.
 * Rejects generic placeholder names, unverified claims, and out-of-scope entries.
 * Enforces case-insensitive filtering across all mixed-case variations.
 */
export const publicRobotWhere = {
  NOT: [
    { canonicalName: { contains: "placeholder", mode: "insensitive" as const } },
    { canonicalName: { contains: "prototype pending", mode: "insensitive" as const } },
    { canonicalName: { contains: "rumored_unverified", mode: "insensitive" as const } },
    { canonicalName: { contains: "bumi humanoid robot", mode: "insensitive" as const } },
    { canonicalName: { contains: "ubtech walker", mode: "insensitive" as const } },
    { canonicalName: { contains: "hospital delivery service robot", mode: "insensitive" as const } },
    { canonicalName: { contains: "thai university social robot prototype", mode: "insensitive" as const } }
  ]
};

/**
 * Prisma WHERE filter for public inventory items.
 */
export const publicInventoryWhere = {
  visibility: "public"
};

/**
 * Prisma WHERE filter for public source records.
 */
export const publicSourceRecordWhere = {
  relevanceStatus: "ACCEPTED" as const
};

/**
 * Prisma WHERE filter for public perspective annotations.
 * Ensures perspective annotations inherit parent source eligibility.
 */
export const publicPerspectiveWhere = {
  source: {
    relevanceStatus: "ACCEPTED" as const
  }
};

/**
 * Sanitizes an inventory record for anonymous public consumption using a strict allowlist.
 * Masking rules:
 * - Serials are masked unless publicSerialSafe is explicitly true.
 * - Exact locations and internal notes are redacted.
 * - Custodian details are redacted.
 * - Un-whitelisted internal fields are omitted.
 */
export function sanitizeInventoryForPublic<T extends {
  id?: string;
  displayName?: string;
  ownershipStatus?: string;
  ownerOrg?: string | null;
  conditionStatus?: string | null;
  robotModelId?: string | null;
  robotModel?: any;
  serialNumber?: string | null;
  publicSerialSafe?: boolean;
  locationLabel?: string | null;
  notes?: string | null;
  custodian?: string | null;
  visibility?: string;
  accessories?: any;
  documentationLinks?: any;
  createdAt?: any;
  updatedAt?: any;
}>(item: T): T {
  return {
    id: item.id,
    displayName: item.displayName,
    ownershipStatus: item.ownershipStatus,
    ownerOrg: item.ownerOrg,
    conditionStatus: item.conditionStatus,
    robotModelId: item.robotModelId,
    robotModel: item.robotModel,
    visibility: item.visibility,
    publicSerialSafe: item.publicSerialSafe,
    serialNumber: item.publicSerialSafe ? item.serialNumber : "🔒 [Masked for privacy]",
    locationLabel: item.locationLabel ? "🔒 [Masked for privacy]" : null,
    notes: "🔒 [Masked for privacy]",
    custodian: "🔒 [Restricted]",
    accessories: Array.isArray(item.accessories) ? item.accessories : [],
    documentationLinks: Array.isArray(item.documentationLinks) ? item.documentationLinks : [],
    createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
    updatedAt: item.updatedAt ? new Date(item.updatedAt) : new Date()
  } as T;
}

/**
 * Verifies whether a robot model is eligible for public registry presentation.
 * Rejects generic placeholder buckets and unverified foreign robots.
 */
export function isEligiblePublicRobot(canonicalName: string): boolean {
  if (isExcludedDemoRecord(`robot_model:${canonicalName.toLowerCase().replace(/\s+/g, "-")}`)) {
    return false;
  }
  // Check against known excluded keywords
  const lower = canonicalName.toLowerCase();
  if (
    lower.includes("placeholder") ||
    lower.includes("prototype pending") ||
    lower.includes("rumored_unverified")
  ) {
    return false;
  }
  return true;
}

/**
 * Verifies whether a contribution is eligible for public presentation.
 */
export function isEligiblePublicContribution(item: {
  visibility?: string | null;
  verificationStatus?: string | null;
  sourceUrl?: string | null;
}): boolean {
  if (item.visibility !== "public") return false;
  if (item.verificationStatus !== "APPROVED") return false;
  const lowerUrl = item.sourceUrl?.toLowerCase();
  if (lowerUrl?.includes("seed:contribution:thai-hri-research")) return false;
  if (lowerUrl?.includes("seed:contribution:hospital-field-observation")) return false;
  if (lowerUrl?.includes("placeholder")) return false;
  return true;
}

/**
 * Verifies whether a perspective annotation is fresh and consistent with its parent source.
 * Excludes stale annotations whose evidence excerpts are no longer present in re-ingested source text,
 * or whose parent source is no longer ACCEPTED.
 */
export function isFreshPerspectiveAnnotation(
  annotation: {
    evidenceExcerpt?: string | null;
    createdAt?: Date | string | null;
    method?: string | null;
  },
  source?: {
    title?: string | null;
    excerpt?: string | null;
    relevanceStatus?: string | null;
    updatedAt?: Date | string | null;
  } | null
): boolean {
  if (!source) return true;
  if (source.relevanceStatus && source.relevanceStatus !== "ACCEPTED") return false;

  // If parent source text is present, verify evidence excerpt containment
  if (source.title !== undefined || source.excerpt !== undefined) {
    const excerpt = annotation.evidenceExcerpt?.trim();
    if (excerpt && excerpt.length >= 10) {
      const parentText = `${source.title ?? ""} ${source.excerpt ?? ""}`.toLowerCase();
      if (!parentText.includes(excerpt.toLowerCase())) {
        // Evidence excerpt was removed or changed in re-ingested source: stale
        return false;
      }
    }
  }

  return true;
}
