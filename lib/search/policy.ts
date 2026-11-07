import type { SearchRecordKind } from "./types";

/**
 * Public Release and Admission Policy for Atlas Search (F3)
 *
 * Defines admission rules, permitted origins, public fields, parent eligibility,
 * and exclusion criteria across all 7 searchable public kinds.
 */

export const MAX_BODY_CODE_POINTS = 2000;

export const KNOWN_PLACEHOLDERS = [
  "OpenAlex abstract metadata available.",
  "Placeholder contribution for Thai human-robot interaction research.",
  "Placeholder for reviewed field observation notes about hospital robot deployment.",
  "Imported from labeled seed dataset.",
  "Curated seed; verify against public CT Asia and media sources.",
  "Curated seed; do not treat as exhaustive.",
  "Imported platform seed; link to Thai deployment sources when verified.",
  "Imported platform seed; needs Thai source evidence."
];

export const PERMITTED_ORIGINS = [
  "openalex",
  "github",
  "youtube",
  "gdelt",
  "rss",
  "web",
  "manual_social",
  "seed",
  "approved_community",
  "public_catalog"
];

export const EXCLUDED_ORIGINS = [
  "submission",
  "unreviewed",
  "internal",
  "private"
];

export const PUBLIC_FIELDS_BY_KIND: Record<SearchRecordKind, string[]> = {
  source: ["id", "title", "excerpt", "author", "platform", "url", "publishedAt"],
  robot: [
    "id",
    "canonicalName",
    "description",
    "manufacturer",
    "developerOrg",
    "countryOfOrigin",
    "robotType",
    "embodimentLevel",
    "officialUrl",
    "firstSeenYear"
  ],
  contribution: [
    "id",
    "title",
    "description",
    "contributorName",
    "organization",
    "contributionType",
    "license",
    "sourceUrl"
  ],
  perspective: [
    "id",
    "perspectiveTheme",
    "targetEntity",
    "stance",
    "sentiment",
    "evidenceExcerpt",
    "method",
    "sourceTitle",
    "sourceUrl"
  ],
  inventory: [
    "id",
    "displayName",
    "ownershipStatus",
    "conditionStatus",
    "ownerOrg",
    "robotModelName"
  ],
  relationship: [
    "id",
    "subject",
    "relation",
    "object",
    "confidence",
    "sourceTitle",
    "sourceUrl"
  ],
  entity: [
    "id",
    "name",
    "entityType",
    "canonicalKey"
  ]
};

export const STRICTLY_EXCLUDED_FIELDS = [
  "users",
  "private_inventory",
  "custodian",
  "locationLabel",
  "serialNumber",
  "rawMeta",
  "sourceMeta",
  "relevanceReason",
  "reviewNotes",
  "submitterContact",
  "submitterName",
  "notes",
  "primaryUseCase",
  "jobs",
  "pipeline_records",
  "caches"
];

/**
 * Checks if an origin is permitted by the search admission policy.
 */
export function isPermittedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  const normalized = origin.trim().toLowerCase();
  if (EXCLUDED_ORIGINS.includes(normalized)) return false;
  return PERMITTED_ORIGINS.includes(normalized);
}

/**
 * Checks if a record kind has an active admission policy.
 * If admission policy is missing, the kind must be excluded and reported.
 */
export function hasAdmissionPolicy(kind: SearchRecordKind): boolean {
  return Boolean(PUBLIC_FIELDS_BY_KIND[kind]);
}
