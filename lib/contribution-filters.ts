import { publicContributionWhere } from "./public-projection";

export const CONTRIBUTION_TYPES = [
  "research_paper",
  "software_repository",
  "hardware_design",
  "dataset",
  "educational_material",
  "event_demo_record"
];

export const VALID_STATUSES = [
  "APPROVED",
  "NEEDS_REVIEW",
  "REJECTED",
  "QUEUED",
  "ANALYZED",
  "FAILED"
];

export interface ContributionFilterInput {
  type?: string | string[];
  org?: string | string[];
  robot?: string | string[];
  status?: string | string[];
  q?: string | string[];
}

export interface ValidatedContributionFilters {
  type?: string;
  org?: string;
  robot?: string;
  status?: string;
  q?: string;
  filterError: string | null;
  statusNotice: string | null;
}

export function truncateParam(val: string, maxLen = 40): string {
  if (val.length <= maxLen) return val;
  return `${val.slice(0, maxLen)}...`;
}

/**
 * Normalizes repeated or array query parameters into a single scalar string.
 */
export function normalizeScalarParam(param: string | string[] | undefined): string | undefined {
  if (!param) return undefined;
  if (Array.isArray(param)) {
    return param[0]?.trim() || undefined;
  }
  return param.trim() || undefined;
}

/**
 * Validates scalar input parameters against allowlists.
 */
export function validateContributionFilters(input: ContributionFilterInput): ValidatedContributionFilters {
  const type = normalizeScalarParam(input.type);
  const org = normalizeScalarParam(input.org);
  const robot = normalizeScalarParam(input.robot);
  const status = normalizeScalarParam(input.status);
  const q = normalizeScalarParam(input.q);

  let filterError: string | null = null;
  let statusNotice: string | null = null;

  if (type && !CONTRIBUTION_TYPES.includes(type)) {
    filterError = `Unknown contribution type "${truncateParam(type, 40)}". Valid values are: ${CONTRIBUTION_TYPES.join(", ")}.`;
  } else if (status) {
    if (!VALID_STATUSES.includes(status)) {
      filterError = `Unknown verification status "${truncateParam(status, 40)}". Valid values are: ${VALID_STATUSES.join(", ")}.`;
    } else if (status !== "APPROVED") {
      statusNotice = `Status filtering is disabled for public visitors. All displayed contributions are verified public records (ignoring requested status "${truncateParam(status, 40)}").`;
    }
  }

  return {
    type,
    org,
    robot,
    status,
    q,
    filterError,
    statusNotice
  };
}

/**
 * Builds a secure Prisma WHERE clause enforcing M3/M5 public projection.
 * VerificationStatus remains strictly constrained to APPROVED for public callers.
 */
export function buildContributionWhere(filters: ValidatedContributionFilters): any {
  const where: any = {
    ...publicContributionWhere
  };

  if (filters.filterError) {
    return where;
  }

  if (filters.type) {
    where.contributionType = filters.type;
  }
  if (filters.org) {
    where.organization = filters.org;
  }
  if (filters.robot) {
    where.relatedRobotModelId = filters.robot;
  }
  if (filters.q) {
    where.AND = [
      {
        OR: [
          { title: { contains: filters.q, mode: "insensitive" } },
          { contributorName: { contains: filters.q, mode: "insensitive" } },
          { description: { contains: filters.q, mode: "insensitive" } }
        ]
      }
    ];
  }

  return where;
}
