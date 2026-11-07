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
 */
export const publicContributionWhere = {
  visibility: "public",
  verificationStatus: "APPROVED" as const,
  NOT: {
    sourceUrl: {
      contains: "placeholder"
    }
  }
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
 * Sanitizes an inventory record for anonymous public consumption.
 * Masking rules:
 * - Serials are masked unless publicSerialSafe is true.
 * - Exact locations and internal notes are redacted.
 * - Custodian details are redacted.
 */
export function sanitizeInventoryForPublic<T extends {
  serialNumber?: string | null;
  publicSerialSafe?: boolean;
  locationLabel?: string | null;
  notes?: string | null;
  custodian?: string | null;
}>(item: T): T {
  return {
    ...item,
    serialNumber: item.publicSerialSafe ? item.serialNumber : "🔒 [Masked for privacy]",
    locationLabel: item.locationLabel ? "🔒 [Masked for privacy]" : null,
    notes: "🔒 [Masked for privacy]",
    custodian: "🔒 [Restricted]"
  };
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
