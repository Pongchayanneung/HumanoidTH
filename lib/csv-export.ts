/**
 * Public-Policy-Safe CSV Export Module (S3)
 *
 * Implements strict table validation, explicit field allowlists,
 * bounded row limits, stable empty headers, and spreadsheet formula neutralization.
 * References: Baseline Audit T11, D12.
 */

import type { Prisma } from "@/generated/prisma";
import {
  publicRobotWhere,
  publicContributionWhere,
  publicInventoryWhere,
  publicSourceRecordWhere,
  publicPerspectiveWhere,
  isEligiblePublicRobot,
  isEligiblePublicContribution
} from "@/lib/public-projection";

export const ALLOWED_TABLES = [
  "sources",
  "robots",
  "contributions",
  "inventory",
  "owned_inventory",
  "perspective_annotations",
  "pull_jobs"
] as const;

export type AllowedTable = (typeof ALLOWED_TABLES)[number];

export const DEFAULT_EXPORT_LIMIT = 250;
export const MAX_EXPORT_ROWS = 2000;

/**
 * Normalizes table name (e.g. "owned_inventory" -> "inventory" or canonical identifier).
 * Returns null if not recognized or disabled (submissions export is disabled pending workflow confirmation).
 */
export function normalizeTableName(table: string | null | undefined): AllowedTable | null {
  if (!table) return null;
  const t = table.trim().toLowerCase();
  if (t === "inventory" || t === "owned_inventory") return "inventory";
  if (t === "robots" || t === "robot") return "robots";
  if (t === "contributions" || t === "contribution") return "contributions";
  if (t === "perspective_annotations" || t === "perspectives" || t === "perspective") {
    return "perspective_annotations";
  }
  if (t === "pull_jobs" || t === "pull_job" || t === "source_pull_jobs") return "pull_jobs";
  if (t === "sources" || t === "source") return "sources";
  return null;
}

/**
 * Checks if a table parameter is a recognized and allowed export table.
 */
export function isAllowedTable(table: string | null | undefined): boolean {
  return normalizeTableName(table) !== null;
}

/**
 * Explicit permitted public columns by table.
 * Private hardware identifiers, internal custodian names, unreviewed contact details,
 * and editorial notes are strictly excluded.
 */
export const TABLE_COLUMNS: Record<AllowedTable, string[]> = {
  sources: [
    "id",
    "sourceType",
    "title",
    "url",
    "excerpt",
    "author",
    "platform",
    "publishedAt",
    "relevanceStatus"
  ],
  robots: [
    "id",
    "canonicalName",
    "description",
    "manufacturer",
    "developerOrg",
    "countryOfOrigin",
    "robotType",
    "embodimentLevel",
    "officialUrl",
    "firstSeenYear",
    "thailandStatus"
  ],
  contributions: [
    "id",
    "title",
    "description",
    "contributorName",
    "organization",
    "contributionType",
    "license",
    "sourceUrl",
    "verificationStatus"
  ],
  inventory: [
    "id",
    "displayName",
    "ownershipStatus",
    "conditionStatus",
    "ownerOrg",
    "robotModelId"
  ],
  owned_inventory: [
    "id",
    "displayName",
    "ownershipStatus",
    "conditionStatus",
    "ownerOrg",
    "robotModelId"
  ],
  perspective_annotations: [
    "id",
    "sourceId",
    "perspectiveTheme",
    "targetEntity",
    "stance",
    "sentiment",
    "evidenceExcerpt",
    "method",
    "createdAt"
  ],
  pull_jobs: [
    "id",
    "adapter",
    "query",
    "status",
    "recordsFound",
    "recordsSaved",
    "startedAt",
    "finishedAt",
    "createdAt"
  ]
};

/**
 * Neutralizes characters that trigger spreadsheet formula execution:
 * =, +, -, @, \t, \r, |, %
 *
 * Prepends a single quote (') so spreadsheets interpret the cell as literal text.
 * Escapes quotes and wraps in double quotes if delimiters, newlines, or quotes are present.
 */
export function escapeCsvValue(val: unknown): string {
  if (val === null || val === undefined) {
    return "";
  }

  let str: string;
  if (val instanceof Date) {
    str = val.toISOString();
  } else if (typeof val === "object") {
    str = JSON.stringify(val);
  } else {
    str = String(val);
  }

  // Remove null bytes
  str = str.replace(/\0/g, "");

  // If the string begins with risky formula trigger characters, prefix with single quote
  // Risky characters: =, +, -, @, tab (\t), carriage return (\r), pipe (|), percent (%)
  if (/^[=+\-@\t\r|%]/.test(str)) {
    str = `'${str}`;
  }

  // Escape standard CSV delimiters and quotes
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r") ||
    str.startsWith("'")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Generates valid CSV text with headers and sanitized rows.
 * If rows is empty, returns headers only (stable empty table schema).
 */
export function generateCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const headerLine = headers.join(",");
  if (rows.length === 0) {
    return `${headerLine}\r\n`;
  }

  const lines = [headerLine];
  for (const row of rows) {
    const rowValues = headers.map((header) => escapeCsvValue(row[header]));
    lines.push(rowValues.join(","));
  }

  return lines.join("\r\n") + "\r\n";
}

/**
 * Safely bounds limit parameter to 1 <= limit <= MAX_EXPORT_ROWS.
 * Defaults safely to DEFAULT_EXPORT_LIMIT (250) if invalid, negative, 0, or NaN.
 */
export function getBoundedLimit(limit?: number): number {
  const safeLimit =
    typeof limit === "number" && !Number.isNaN(limit) && limit > 0
      ? Math.floor(limit)
      : DEFAULT_EXPORT_LIMIT;
  return Math.min(Math.max(1, safeLimit), MAX_EXPORT_ROWS);
}

/**
 * Reusable search predicates aligned across raw database browser and CSV exports.
 */
export function getRobotsSearchWhere(searchTerm: string): Prisma.RobotModelWhereInput {
  const term = searchTerm.trim();
  if (!term) return {};
  return {
    OR: [
      { canonicalName: { contains: term, mode: "insensitive" } },
      { description: { contains: term, mode: "insensitive" } }
    ]
  };
}

export function getContributionsSearchWhere(searchTerm: string): Prisma.ContributionWhereInput {
  const term = searchTerm.trim();
  if (!term) return {};
  return {
    OR: [
      { title: { contains: term, mode: "insensitive" } },
      { description: { contains: term, mode: "insensitive" } }
    ]
  };
}

export function getInventorySearchWhere(searchTerm: string): Prisma.OwnedInventoryWhereInput {
  const term = searchTerm.trim();
  if (!term) return {};
  return {
    OR: [
      { displayName: { contains: term, mode: "insensitive" } },
      { ownerOrg: { contains: term, mode: "insensitive" } }
    ]
  };
}

export function getSubmissionsSearchWhere(searchTerm: string): Prisma.SubmittedDataWhereInput {
  const term = searchTerm.trim();
  if (!term) return {};
  return {
    OR: [
      { title: { contains: term, mode: "insensitive" } }
    ]
  };
}

export function getPerspectivesSearchWhere(searchTerm: string): Prisma.PerspectiveAnnotationWhereInput {
  const term = searchTerm.trim();
  if (!term) return {};
  return {
    OR: [
      { perspectiveTheme: { contains: term, mode: "insensitive" } },
      { targetEntity: { contains: term, mode: "insensitive" } }
    ]
  };
}

export function getPullJobsSearchWhere(searchTerm: string): Prisma.SourcePullJobWhereInput {
  const term = searchTerm.trim();
  if (!term) return {};
  return {
    OR: [
      { query: { contains: term, mode: "insensitive" } }
    ]
  };
}

export function getSourcesSearchWhere(searchTerm: string): Prisma.SourceRecordWhereInput {
  const term = searchTerm.trim();
  if (!term) return {};
  return {
    OR: [
      { title: { contains: term, mode: "insensitive" } },
      { excerpt: { contains: term, mode: "insensitive" } }
    ]
  };
}

export function getSearchWhere(table: "robots", term: string): Prisma.RobotModelWhereInput;
export function getSearchWhere(table: "contributions", term: string): Prisma.ContributionWhereInput;
export function getSearchWhere(table: "inventory" | "owned_inventory", term: string): Prisma.OwnedInventoryWhereInput;
export function getSearchWhere(table: "submissions", term: string): Prisma.SubmittedDataWhereInput;
export function getSearchWhere(table: "perspective_annotations", term: string): Prisma.PerspectiveAnnotationWhereInput;
export function getSearchWhere(table: "pull_jobs", term: string): Prisma.SourcePullJobWhereInput;
export function getSearchWhere(table: "sources", term: string): Prisma.SourceRecordWhereInput;
export function getSearchWhere(table: AllowedTable | "submissions", term: string): any;
export function getSearchWhere(table: AllowedTable | "submissions", term: string): any {
  switch (table) {
    case "robots":
      return getRobotsSearchWhere(term);
    case "contributions":
      return getContributionsSearchWhere(term);
    case "inventory":
    case "owned_inventory":
      return getInventorySearchWhere(term);
    case "submissions":
      return getSubmissionsSearchWhere(term);
    case "perspective_annotations":
      return getPerspectivesSearchWhere(term);
    case "pull_jobs":
      return getPullJobsSearchWhere(term);
    case "sources":
    default:
      return getSourcesSearchWhere(term);
  }
}

export function buildExportRobotsQuery(q?: string | null, limit: number = DEFAULT_EXPORT_LIMIT): Prisma.RobotModelFindManyArgs {
  const boundedLimit = getBoundedLimit(limit);
  const searchTerm = q?.trim() || "";
  const searchWhere = getRobotsSearchWhere(searchTerm);

  return {
    select: {
      id: true,
      canonicalName: true,
      description: true,
      manufacturer: true,
      developerOrg: true,
      countryOfOrigin: true,
      robotType: true,
      embodimentLevel: true,
      officialUrl: true,
      firstSeenYear: true,
      thailandStatus: true
    },
    where: {
      thailandStatus: { in: ["observed_in_thailand", "developed_in_thailand", "deployed_in_thailand"] },
      ...publicRobotWhere,
      ...(searchTerm ? searchWhere : {})
    },
    orderBy: { createdAt: "desc" as const },
    take: boundedLimit
  };
}

export function buildExportContributionsQuery(q?: string | null, limit: number = DEFAULT_EXPORT_LIMIT): Prisma.ContributionFindManyArgs {
  const boundedLimit = getBoundedLimit(limit);
  const searchTerm = q?.trim() || "";
  const searchWhere = getContributionsSearchWhere(searchTerm);

  return {
    select: {
      id: true,
      title: true,
      description: true,
      contributorName: true,
      organization: true,
      contributionType: true,
      license: true,
      sourceUrl: true,
      verificationStatus: true,
      visibility: true,
      createdAt: true
    },
    where: {
      ...publicContributionWhere,
      ...(searchTerm
        ? {
            AND: [
              searchWhere
            ]
          }
        : {})
    },
    orderBy: { createdAt: "desc" as const },
    take: boundedLimit
  };
}

export function buildExportInventoryQuery(q?: string | null, limit: number = DEFAULT_EXPORT_LIMIT): Prisma.OwnedInventoryFindManyArgs {
  const boundedLimit = getBoundedLimit(limit);
  const searchTerm = q?.trim() || "";
  const searchWhere = getInventorySearchWhere(searchTerm);

  return {
    select: {
      id: true,
      displayName: true,
      ownershipStatus: true,
      conditionStatus: true,
      ownerOrg: true,
      robotModelId: true
    },
    where: {
      ...publicInventoryWhere,
      ...(searchTerm ? searchWhere : {})
    },
    orderBy: { createdAt: "desc" as const },
    take: boundedLimit
  };
}

/**
 * @deprecated Submissions export is disabled pending review workflow policy confirmation.
 */
export function buildExportSubmissionsQuery(q?: string | null, limit: number = DEFAULT_EXPORT_LIMIT): Prisma.SubmittedDataFindManyArgs {
  const boundedLimit = getBoundedLimit(limit);
  const searchTerm = q?.trim() || "";
  const searchWhere = getSubmissionsSearchWhere(searchTerm);

  return {
    select: {
      id: true,
      title: true,
      submissionType: true,
      status: true,
      url: true,
      createdAt: true
    },
    where: {
      status: "APPROVED" as const,
      ...(searchTerm ? searchWhere : {})
    },
    orderBy: { createdAt: "desc" as const },
    take: boundedLimit
  };
}

export function buildExportPerspectiveAnnotationsQuery(q?: string | null, limit: number = DEFAULT_EXPORT_LIMIT): Prisma.PerspectiveAnnotationFindManyArgs {
  const boundedLimit = getBoundedLimit(limit);
  const searchTerm = q?.trim() || "";
  const searchWhere = getPerspectivesSearchWhere(searchTerm);

  return {
    select: {
      id: true,
      sourceId: true,
      perspectiveTheme: true,
      targetEntity: true,
      stance: true,
      sentiment: true,
      evidenceExcerpt: true,
      method: true,
      createdAt: true
    },
    where: {
      ...publicPerspectiveWhere,
      ...(searchTerm ? searchWhere : {})
    },
    orderBy: { createdAt: "desc" as const },
    take: boundedLimit
  };
}

export function buildExportPullJobsQuery(q?: string | null, limit: number = DEFAULT_EXPORT_LIMIT): Prisma.SourcePullJobFindManyArgs {
  const boundedLimit = getBoundedLimit(limit);
  const searchTerm = q?.trim() || "";
  const searchWhere = getPullJobsSearchWhere(searchTerm);

  return {
    select: {
      id: true,
      adapter: true,
      query: true,
      status: true,
      recordsFound: true,
      recordsSaved: true,
      startedAt: true,
      finishedAt: true,
      createdAt: true
    },
    where: searchTerm ? searchWhere : {},
    orderBy: { createdAt: "desc" as const },
    take: boundedLimit
  };
}

export function buildExportSourcesQuery(q?: string | null, limit: number = DEFAULT_EXPORT_LIMIT): Prisma.SourceRecordFindManyArgs {
  const boundedLimit = getBoundedLimit(limit);
  const searchTerm = q?.trim() || "";
  const searchWhere = getSourcesSearchWhere(searchTerm);

  return {
    select: {
      id: true,
      sourceType: true,
      title: true,
      url: true,
      excerpt: true,
      author: true,
      platform: true,
      publishedAt: true,
      relevanceStatus: true
    },
    where: {
      ...publicSourceRecordWhere,
      ...(searchTerm ? searchWhere : {})
    },
    orderBy: { createdAt: "desc" as const },
    take: boundedLimit
  };
}

/**
 * Generic query dispatcher for uniform query construction.
 */
export function buildExportPrismaQuery(table: AllowedTable, q?: string | null, limit: number = DEFAULT_EXPORT_LIMIT) {
  switch (table) {
    case "robots":
      return buildExportRobotsQuery(q, limit);
    case "contributions":
      return buildExportContributionsQuery(q, limit);
    case "inventory":
    case "owned_inventory":
      return buildExportInventoryQuery(q, limit);
    case "perspective_annotations":
      return buildExportPerspectiveAnnotationsQuery(q, limit);
    case "pull_jobs":
      return buildExportPullJobsQuery(q, limit);
    case "sources":
    default:
      return buildExportSourcesQuery(q, limit);
  }
}

/**
 * Shared data retrieval function used by both the raw database browser (/database)
 * and the CSV export endpoint (/api/export) to guarantee 100% membership, filter,
 * ordering, and bounded limit parity without private data exposure (Issue #23).
 */
export async function fetchExportableRecords(
  table: AllowedTable,
  q?: string | null,
  limit: number = DEFAULT_EXPORT_LIMIT
): Promise<Record<string, unknown>[]> {
  const boundedLimit = getBoundedLimit(limit);
  const { prisma } = await import("@/lib/prisma");

  switch (table) {
    case "robots": {
      const robots = await prisma.robotModel.findMany(buildExportRobotsQuery(q, boundedLimit));
      return (robots.filter((r) => isEligiblePublicRobot(String(r.canonicalName))) as unknown) as Record<string, unknown>[];
    }
    case "contributions": {
      const contributions = await prisma.contribution.findMany(buildExportContributionsQuery(q, boundedLimit));
      return (contributions.filter((c) => isEligiblePublicContribution(c as any)) as unknown) as Record<string, unknown>[];
    }
    case "inventory":
    case "owned_inventory": {
      return (await prisma.ownedInventory.findMany(buildExportInventoryQuery(q, boundedLimit))) as unknown as Record<string, unknown>[];
    }
    case "perspective_annotations": {
      return (await prisma.perspectiveAnnotation.findMany(buildExportPerspectiveAnnotationsQuery(q, boundedLimit))) as unknown as Record<string, unknown>[];
    }
    case "pull_jobs": {
      return (await prisma.sourcePullJob.findMany(buildExportPullJobsQuery(q, boundedLimit))) as unknown as Record<string, unknown>[];
    }
    case "sources":
    default: {
      return (await prisma.sourceRecord.findMany(buildExportSourcesQuery(q, boundedLimit))) as unknown as Record<string, unknown>[];
    }
  }
}
