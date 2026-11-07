/**
 * Public-Policy-Safe CSV Export Module (S3)
 *
 * Implements strict table validation, explicit field allowlists,
 * bounded row limits, stable empty headers, and spreadsheet formula neutralization.
 * References: Baseline Audit T11, D12.
 */

export const ALLOWED_TABLES = [
  "sources",
  "robots",
  "contributions",
  "inventory",
  "owned_inventory",
  "submissions",
  "perspective_annotations",
  "pull_jobs"
] as const;

export type AllowedTable = (typeof ALLOWED_TABLES)[number];

export const MAX_EXPORT_ROWS = 2000;

/**
 * Normalizes table name (e.g. "owned_inventory" -> "inventory" or canonical identifier).
 * Returns null if not recognized.
 */
export function normalizeTableName(table: string | null | undefined): AllowedTable | null {
  if (!table) return null;
  const t = table.trim().toLowerCase();
  if (t === "inventory" || t === "owned_inventory") return "inventory";
  if (t === "robots" || t === "robot") return "robots";
  if (t === "contributions" || t === "contribution") return "contributions";
  if (t === "submissions" || t === "submission") return "submissions";
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
  submissions: [
    "id",
    "title",
    "submissionType",
    "status",
    "url",
    "createdAt"
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
 * Builds Prisma query parameters with bounded take and public policy predicates.
 */
export function buildExportPrismaQuery(table: AllowedTable, q?: string | null, limit: number = MAX_EXPORT_ROWS) {
  const boundedLimit = Math.min(Math.max(1, limit), MAX_EXPORT_ROWS);
  const searchTerm = q?.trim() || "";

  switch (table) {
    case "robots": {
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
          ...(searchTerm
            ? {
                OR: [
                  { canonicalName: { contains: searchTerm, mode: "insensitive" as const } },
                  { description: { contains: searchTerm, mode: "insensitive" as const } }
                ]
              }
            : {})
        },
        orderBy: { canonicalName: "asc" as const },
        take: boundedLimit
      };
    }

    case "contributions": {
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
          verificationStatus: true
        },
        where: {
          visibility: "public",
          verificationStatus: "APPROVED" as const,
          ...(searchTerm
            ? {
                OR: [
                  { title: { contains: searchTerm, mode: "insensitive" as const } },
                  { description: { contains: searchTerm, mode: "insensitive" as const } }
                ]
              }
            : {})
        },
        orderBy: { createdAt: "desc" as const },
        take: boundedLimit
      };
    }

    case "inventory":
    case "owned_inventory": {
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
          visibility: "public",
          ...(searchTerm
            ? {
                OR: [
                  { displayName: { contains: searchTerm, mode: "insensitive" as const } },
                  { ownerOrg: { contains: searchTerm, mode: "insensitive" as const } }
                ]
              }
            : {})
        },
        orderBy: { displayName: "asc" as const },
        take: boundedLimit
      };
    }

    case "submissions": {
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
          ...(searchTerm
            ? {
                OR: [
                  { title: { contains: searchTerm, mode: "insensitive" as const } }
                ]
              }
            : {})
        },
        orderBy: { createdAt: "desc" as const },
        take: boundedLimit
      };
    }

    case "perspective_annotations": {
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
          source: { relevanceStatus: "ACCEPTED" as const },
          ...(searchTerm
            ? {
                OR: [
                  { perspectiveTheme: { contains: searchTerm, mode: "insensitive" as const } },
                  { targetEntity: { contains: searchTerm, mode: "insensitive" as const } }
                ]
              }
            : {})
        },
        orderBy: { createdAt: "desc" as const },
        take: boundedLimit
      };
    }

    case "pull_jobs": {
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
        where: searchTerm
          ? {
              OR: [
                { query: { contains: searchTerm, mode: "insensitive" as const } }
              ]
            }
          : {},
        orderBy: { createdAt: "desc" as const },
        take: boundedLimit
      };
    }

    case "sources":
    default: {
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
          relevanceStatus: "ACCEPTED" as const,
          ...(searchTerm
            ? {
                OR: [
                  { title: { contains: searchTerm, mode: "insensitive" as const } },
                  { excerpt: { contains: searchTerm, mode: "insensitive" as const } }
                ]
              }
            : {})
        },
        orderBy: { createdAt: "desc" as const },
        take: boundedLimit
      };
    }
  }
}
