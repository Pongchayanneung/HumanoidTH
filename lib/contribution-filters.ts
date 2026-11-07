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

// Free-text filters are bounded so a crafted URL cannot push unbounded or unstorable text
// (control characters, NUL, lone surrogates) into a database LIKE query.
export const MAX_FILTER_LENGTH = 200;

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

// Truncates on code point boundaries and drops control characters and lone surrogates, so a
// hostile value cannot split a surrogate pair or carry a NUL into a notice.
export function truncateParam(val: string, maxLen = 40): string {
  const points = Array.from(val.replace(/[\p{Cc}\p{Cs}]/gu, ""));
  if (points.length <= maxLen) return points.join("");
  return `${points.slice(0, maxLen).join("")}...`;
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
 * Normalizes a free-text query parameter and reports whether it is within bounds.
 * `invalid` is true for values longer than MAX_FILTER_LENGTH or containing control characters.
 */
export function readBoundedTextParam(param: string | string[] | undefined): { value?: string; invalid: boolean } {
  const raw = Array.isArray(param) ? param[0] : param;
  if (raw === undefined) return { invalid: false };
  if (/[\p{Cc}\p{Cs}]/u.test(raw)) return { invalid: true };
  const value = raw.trim();
  if (!value) return { invalid: false };
  if (Array.from(value).length > MAX_FILTER_LENGTH) return { invalid: true };
  return { value, invalid: false };
}

/**
 * Validates scalar input parameters against allowlists.
 */
export function validateContributionFilters(
  input: ContributionFilterInput,
  lang: "en" | "th" = "en"
): ValidatedContributionFilters {
  const type = normalizeScalarParam(input.type);
  const org = normalizeScalarParam(input.org);
  const robot = normalizeScalarParam(input.robot);
  const status = normalizeScalarParam(input.status);
  const q = normalizeScalarParam(input.q);

  let filterError: string | null = null;
  let statusNotice: string | null = null;

  if (type && !CONTRIBUTION_TYPES.includes(type)) {
    if (lang === "th") {
      filterError = `ไม่พบประเภทผลงาน "${truncateParam(type, 40)}" ค่าที่ถูกต้องคือ: ${CONTRIBUTION_TYPES.join(", ")}`;
    } else {
      filterError = `Unknown contribution type "${truncateParam(type, 40)}". Valid values are: ${CONTRIBUTION_TYPES.join(", ")}.`;
    }
  } else if (status) {
    if (!VALID_STATUSES.includes(status)) {
      if (lang === "th") {
        filterError = `ไม่พบสถานะการตรวจสอบ "${truncateParam(status, 40)}" ค่าที่ถูกต้องคือ: ${VALID_STATUSES.join(", ")}`;
      } else {
        filterError = `Unknown verification status "${truncateParam(status, 40)}". Valid values are: ${VALID_STATUSES.join(", ")}.`;
      }
    } else if (status !== "APPROVED") {
      if (lang === "th") {
        statusNotice = `ระบบปิดการกรองตามสถานะสำหรับผู้ใช้ทั่วไป ข้อมูลทั้งหมดที่แสดงเป็นรายการที่ได้รับการตรวจสอบแล้ว (ละเว้นสถานะที่ระบุ "${truncateParam(status, 40)}")`;
      } else {
        statusNotice = `Status filtering is disabled for public visitors. All displayed contributions are verified public records (ignoring requested status "${truncateParam(status, 40)}").`;
      }
    }
  }

  const freeText = [input.q, input.org, input.robot].map(readBoundedTextParam);
  if (!filterError && freeText.some((field) => field.invalid)) {
    filterError = lang === "th"
      ? `ค่าตัวกรองไม่ถูกต้อง ใช้ได้ไม่เกิน ${MAX_FILTER_LENGTH} ตัวอักษรและไม่มีอักขระควบคุม`
      : `Invalid filter value. Filters accept at most ${MAX_FILTER_LENGTH} characters and no control characters.`;
  }

  return {
    type,
    // Rejected free text is never echoed back into the page.
    org: freeText[1].value,
    robot: freeText[2].value,
    status,
    q: freeText[0].value,
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
