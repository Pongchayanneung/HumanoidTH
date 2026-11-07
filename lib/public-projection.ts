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
        { sourceUrl: { contains: "placeholder" } },
        { sourceUrl: { contains: "seed:contribution:thai-hri-research" } },
        { sourceUrl: { contains: "seed:contribution:hospital-field-observation" } }
      ]
    }
  ]
};

/**
 * Prisma WHERE filter for public robot models.
 * Rejects generic placeholder names, unverified claims, and out-of-scope entries.
 */
export const publicRobotWhere = {
  NOT: [
    { canonicalName: { contains: "placeholder" } },
    { canonicalName: { contains: "Placeholder" } },
    { canonicalName: { contains: "PLACEHOLDER" } },
    { canonicalName: { contains: "prototype pending" } },
    { canonicalName: { contains: "Prototype Pending" } },
    { canonicalName: { contains: "PROTOTYPE PENDING" } },
    { canonicalName: { contains: "rumored_unverified" } },
    { canonicalName: { contains: "Rumored_Unverified" } },
    { canonicalName: { contains: "RUMORED_UNVERIFIED" } },
    {
      canonicalName: {
        in: [
          "Bumi Humanoid Robot",
          "bumi humanoid robot",
          "UBTECH Walker",
          "ubtech walker",
          "Hospital Delivery Service Robot",
          "hospital delivery service robot",
          "Thai University Social Robot Prototype",
          "thai university social robot prototype"
        ]
      }
    }
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
  if (item.sourceUrl?.includes("seed:contribution:thai-hri-research")) return false;
  if (item.sourceUrl?.includes("placeholder")) return false;
  return true;
}
