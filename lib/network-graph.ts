import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { isEligiblePublicRobot, publicContributionWhere } from "@/lib/public-projection";

export type NetworkSourceMode = "file" | "database" | "hybrid" | "auto";
export type ResolvedNetworkSource = "database" | "file" | "hybrid" | "fallback_file";
export type DataOrigin = "database" | "import_file" | "merged";
export type EvidenceKind = "reviewed_assertion" | "inferred_relation";

export type AtlasRecord = {
  id: string;
  category: string | null;
  title: string | null;
  canonical_name: string | null;
  description: string | null;
  organization: string | null;
  country: string | null;
  robot_type: string | null;
  embodiment_level: string | null;
  contribution_type: string | null;
  stance: string | null;
  sentiment: string | null;
  perspective_theme: string | null;
  relation: string | null;
  subject: string | null;
  object: string | null;
  url: string | null;
  source_platform: string | null;
  published_at: string | null;
  author: string | null;
  confidence: number | null;
  evidence_excerpt: string | null;
  notes: string | null;
  data_origin: DataOrigin;
  verification_status?: string | null;
  is_reviewed?: boolean;
  evidence_kind?: EvidenceKind;
  source_record_ids?: string[];
  import_record_ids?: string[];
};

export type NetworkGraphSource = {
  name: "database" | "import_file";
  available(): Promise<boolean>;
  loadRecords(): Promise<AtlasRecord[]>;
};

export type NetworkNode = {
  id: string;
  label: string;
  type: string;
  cluster: string;
  description: string | null;
  organization: string | null;
  country: string | null;
  robot_type?: string | null;
  confidence: number;
  source_count: number;
  degree: number;
  is_private: boolean;
  is_low_confidence: boolean;
  is_reviewed?: boolean;
  review_status?: string | null;
  evidence_kind?: EvidenceKind;
  url: string | null;
  evidence_excerpt: string | null;
  record_id?: string | null;
  data_origin: DataOrigin;
  source_record_ids: string[];
  import_record_ids: string[];
};

export type NetworkEdge = {
  id: string;
  source: string;
  target: string;
  relation: string;
  label: string;
  description: string;
  confidence: number;
  weight: number;
  evidence_excerpt: string | null;
  url: string | null;
  source_platform: string | null;
  published_at: string | null;
  is_low_confidence: boolean;
  is_reviewed?: boolean;
  review_status?: string | null;
  evidence_kind?: EvidenceKind;
  data_origin: DataOrigin;
  source_record_ids: string[];
  import_record_ids: string[];
};

export type NetworkCluster = {
  id: string;
  label: string;
  node_count: number;
  edge_count: number;
};

export type NetworkGraphMeta = {
  source_mode: NetworkSourceMode;
  resolved_source: ResolvedNetworkSource;
  database_available: boolean;
  file_available: boolean;
  warnings: string[];
  node_count: number;
  edge_count: number;
  cluster_count: number;
  generated_at: string;
  truncated: boolean;
};

export type NetworkGraph = {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  clusters: NetworkCluster[];
  meta: NetworkGraphMeta;
};

type SourceLoadResult = {
  records: AtlasRecord[];
  resolvedSource: ResolvedNetworkSource;
  databaseAvailable: boolean;
  fileAvailable: boolean;
  warnings: string[];
};

export type NetworkGraphOptions = {
  sourceMode?: NetworkSourceMode;
  maxNodes?: number;
  maxEdges?: number;
  cluster?: string | null;
  nodeType?: string | null;
  relation?: string | null;
  minConfidence?: number | null;
  includeLowConfidence?: boolean;
  includePrivate?: boolean;
  records?: AtlasRecord[];
  onlyReviewed?: boolean;
};

let cachedGraph: { key: string; graph: NetworkGraph; cachedAt: number } | null = null;

const fallbackWarning = "Database unavailable or permission denied. Falling back to imported seed file.";
const importFileWarning = "Imported seed file is unavailable.";

const clusterLabels: Record<string, string> = {
  healthcare_and_elderly_care: "Healthcare & Elderly Care",
  hospital_service_robots: "Hospital service robots",
  education_robotics: "Education robotics",
  humanoid_robots: "Humanoid robots",
  public_safety_robots: "Public safety robots",
  research_and_academic_contributions: "Research & academic contributions",
  media_perspectives: "Media perspectives",
  owned_inventory: "Owned inventory",
  companies_and_institutions: "Companies & institutions",
  international_robots_shown_in_thailand: "International robots shown in Thailand",
  unknown: "Unknown / uncategorized"
};

function resolveSourceMode(value?: string | null): NetworkSourceMode {
  if (value === "file" || value === "database" || value === "hybrid" || value === "auto") return value;
  const env = process.env.NETWORK_GRAPH_SOURCE;
  if (env === "file" || env === "database" || env === "hybrid" || env === "auto") return env;
  return "auto";
}

export function getNetworkImportFilePath() {
  const configured = process.env.NETWORK_GRAPH_IMPORT_FILE_PATH;
  const defaultPath = resolve(process.cwd(), "data", "imports", "thailand_humanoid_atlas_seed_records.json");
  if (configured) return resolve(process.cwd(), configured);
  if (existsSync(defaultPath)) return defaultPath;
  return resolve(process.cwd(), "thailand_humanoid_atlas_seed_records.json");
}

export async function databaseAvailable() {
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.robotModel.findFirst({ select: { id: true } });
    return true;
  } catch {
    return false;
  }
}

function sanitizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/EACCES|permission|denied/i.test(message)) return "Database permission denied.";
  if (/P1001|connect|ECONN|ENOTFOUND|timeout/i.test(message)) return "Database connection unavailable.";
  if (/does not exist|missing|table/i.test(message)) return "Database schema or table unavailable.";
  return "Database unavailable.";
}

// 16 hex chars = 64 bits of the SHA-256 of the full normalized label. 8 chars (32 bits) was shown to
// collide for two distinct organization names sharing a 50-character slug prefix.
const ID_HASH_LENGTH = 16;

function slugify(value: string) {
  const cleanValue = (value || "").trim().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const hash = createHash("sha256").update(cleanValue.toLowerCase()).digest("hex").slice(0, ID_HASH_LENGTH);
  const slug = cleanValue
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return slug ? `${slug}_${hash}` : `unknown_${hash}`;
}

export function stableTypedId(type: string, label: string): string {
  const cleanLabel = (label || "").trim().normalize("NFC");
  if (!cleanLabel) return `${type}:unknown`;
  const normalized = cleanLabel.toLowerCase();
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, ID_HASH_LENGTH);
  const slug = normalized
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
  return slug ? `${type}:${slug}_${hash}` : `${type}:id_${hash}`;
}

export function nodeId(type: string, label: string): string {
  return stableTypedId(type, label);
}

function clampConfidence(value: unknown, fallback = 0.6) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function splitNames(value: string | null | undefined) {
  if (!value) return [];
  return value
    .split(/[,;|/&]+|\band\b/gi)
    .map((item) => item.trim())
    .filter((item) => item.length > 1)
    .slice(0, 8);
}

function recordOriginIds(record: AtlasRecord) {
  return {
    source_record_ids: record.source_record_ids ?? (record.data_origin === "database" ? [record.id] : []),
    import_record_ids: record.import_record_ids ?? (record.data_origin === "import_file" ? [record.id] : [])
  };
}

function mergeOrigins(a: DataOrigin, b: DataOrigin): DataOrigin {
  return a === b ? a : "merged";
}

function classifyCluster(input: {
  type: string;
  label?: string | null;
  robotType?: string | null;
  useCase?: string | null;
  sourceType?: string | null;
  status?: string | null;
}) {
  const text = `${input.type} ${input.label ?? ""} ${input.robotType ?? ""} ${input.useCase ?? ""} ${input.sourceType ?? ""} ${input.status ?? ""}`.toLowerCase();
  if (input.type === "owned_inventory") return "owned_inventory";
  if (input.type === "perspective_annotation" || input.type === "perspective_theme" || text.includes("media")) return "media_perspectives";
  if (input.type === "organization" || input.type === "source_platform" || input.type === "author" || input.type === "country") return "companies_and_institutions";
  if (input.type === "contribution" || text.includes("paper") || text.includes("github") || text.includes("research") || text.includes("academic") || text.includes("university")) return "research_and_academic_contributions";
  if (text.includes("hospital") || text.includes("medical")) return "hospital_service_robots";
  if (text.includes("health") || text.includes("elder") || text.includes("care") || text.includes("nursing")) return "healthcare_and_elderly_care";
  if (text.includes("education") || text.includes("school") || text.includes("student") || text.includes("teacher")) return "education_robotics";
  if (text.includes("humanoid") || text.includes("social") || text.includes("service")) return "humanoid_robots";
  if (text.includes("safety") || text.includes("rescue") || text.includes("security") || text.includes("police")) return "public_safety_robots";
  if (text.includes("import") || text.includes("international") || text.includes("shown")) return "international_robots_shown_in_thailand";
  return "unknown";
}

export function normalizeFileRecord(record: Record<string, unknown>, index: number = 0): AtlasRecord {
  const category = clean(record.category);
  const rawStatus = clean(record.verification_status) ?? (clean(record.notes) === "APPROVED" ? "APPROVED" : null);
  const isReviewed = record.is_reviewed !== undefined
    ? Boolean(record.is_reviewed)
    : Boolean(rawStatus === "APPROVED");
  const verificationStatus = rawStatus ?? (isReviewed ? "APPROVED" : null);
  const evidenceKind = (clean(record.evidence_kind) as EvidenceKind | null) ?? (isReviewed ? "reviewed_assertion" : "inferred_relation");

  return {
    id: clean(record.id) ?? `import:${index}`,
    category,
    title: clean(record.title),
    canonical_name: clean(record.canonical_name),
    description: clean(record.description),
    organization: clean(record.organization),
    country: clean(record.country),
    robot_type: clean(record.robot_type),
    embodiment_level: clean(record.embodiment_level),
    contribution_type: clean(record.contribution_type),
    stance: clean(record.stance),
    sentiment: clean(record.sentiment),
    perspective_theme: clean(record.perspective_theme),
    relation: clean(record.relation),
    subject: clean(record.subject),
    object: clean(record.object),
    url: clean(record.url),
    source_platform: clean(record.source_platform),
    published_at: clean(record.published_at),
    author: clean(record.author),
    confidence: record.confidence === null || record.confidence === undefined ? null : clampConfidence(record.confidence),
    evidence_excerpt: clean(record.evidence_excerpt),
    notes: clean(record.notes),
    data_origin: "import_file",
    verification_status: verificationStatus,
    is_reviewed: isReviewed,
    evidence_kind: evidenceKind
  };
}

export async function loadGraphRecordsFromFile(): Promise<AtlasRecord[]> {
  const filePath = getNetworkImportFilePath();
  if (!existsSync(filePath)) {
    throw new Error(importFileWarning);
  }
  const raw = JSON.parse(readFileSync(filePath, "utf8"));
  if (!Array.isArray(raw)) {
    throw new Error("Imported graph file must contain a JSON array.");
  }
  // Public data projection (M3 / T03): Exclude internal submissions, jobs, and private inventory
  const publicRecords = raw.filter((r) => {
    if (r.category === "submission_record" || r.category === "source_pull_job") return false;
    if (r.category === "owned_inventory" && r.visibility !== "public") return false;
    if (r.category === "robot_model" && r.canonical_name && !isEligiblePublicRobot(String(r.canonical_name))) return false;
    return true;
  });
  return publicRecords.map((record, index) => normalizeFileRecord(record, index));
}

function sourceTypeToCategory(sourceType: string) {
  const normalized = sourceType.toLowerCase();
  if (normalized === "openalex") return "paper";
  if (normalized === "youtube") return "video";
  if (normalized === "gdelt" || normalized === "rss" || normalized === "web") return "media_source";
  return "source_record";
}

export async function loadGraphRecordsFromPrismaWithWarnings(): Promise<{ records: AtlasRecord[]; warnings: string[] }> {
  const { prisma } = await import("@/lib/prisma");
  const records: AtlasRecord[] = [];
  const warnings: string[] = [];
  // Public data projection (M3 / T03): Exclude private records and unapproved submissions
  const [robots, inventory, contributions, sources, perspectives, triplets] = await Promise.all([
    prisma.robotModel
      .findMany({ take: 700, orderBy: { updatedAt: "desc" } })
      .then((rows) => rows.filter((row) => isEligiblePublicRobot(row.canonicalName))),
    prisma.ownedInventory.findMany({
      where: { visibility: "public" },
      take: 500,
      include: { robotModel: true },
      orderBy: { updatedAt: "desc" }
    }),
    prisma.contribution.findMany({
      where: publicContributionWhere,
      take: 700,
      include: { relatedRobotModel: true },
      orderBy: { updatedAt: "desc" }
    }),
    prisma.sourceRecord.findMany({
      where: { relevanceStatus: "ACCEPTED" },
      take: 1200,
      orderBy: [{ relevanceConfidence: "desc" }, { updatedAt: "desc" }]
    }),
    prisma.perspectiveAnnotation.findMany({
      where: { source: { relevanceStatus: "ACCEPTED" } },
      take: 800,
      include: { source: true },
      orderBy: { createdAt: "desc" }
    }),
    prisma.triplet.findMany({
      where: { source: { relevanceStatus: "ACCEPTED" } },
      take: 1400,
      include: { source: true },
      orderBy: { confidence: "desc" }
    })
  ]);

  if (robots.length >= 700) warnings.push("Robot models query reached loader cap (700); earlier records omitted.");
  if (inventory.length >= 500) warnings.push("Inventory query reached loader cap (500); earlier records omitted.");
  if (contributions.length >= 700) warnings.push("Contributions query reached loader cap (700); earlier records omitted.");
  if (sources.length >= 1200) warnings.push("Source records query reached loader cap (1200); earlier records omitted.");
  if (perspectives.length >= 800) warnings.push("Perspectives query reached loader cap (800); earlier records omitted.");
  if (triplets.length >= 1400) warnings.push("Triplets query reached loader cap (1400); earlier records omitted.");

  for (const item of robots) {
    const isReviewed = Boolean(item.lastVerifiedAt);
    records.push({
      id: item.id,
      category: "robot_model",
      title: item.canonicalName,
      canonical_name: item.canonicalName,
      description: item.description,
      organization: item.developerOrg ?? item.manufacturer,
      country: item.countryOfOrigin,
      robot_type: item.robotType,
      embodiment_level: item.embodimentLevel,
      contribution_type: item.primaryUseCase,
      stance: null,
      sentiment: null,
      perspective_theme: null,
      relation: null,
      subject: null,
      object: null,
      url: item.officialUrl,
      source_platform: "robot_model_record",
      published_at: item.lastVerifiedAt?.toISOString() ?? null,
      author: null,
      confidence: item.statusConfidence,
      evidence_excerpt: item.description,
      notes: isReviewed ? "APPROVED" : null,
      data_origin: "database",
      verification_status: isReviewed ? "APPROVED" : null,
      is_reviewed: isReviewed,
      evidence_kind: isReviewed ? "reviewed_assertion" : "inferred_relation"
    });
  }

  for (const item of inventory) {
    if (item.visibility !== "public") continue;
    const isReviewed = item.notes === "APPROVED";
    records.push({
      id: item.id,
      category: "owned_inventory",
      title: item.displayName,
      canonical_name: item.displayName,
      description: "Public inventory unit",
      organization: item.ownerOrg,
      country: null,
      robot_type: item.robotModel?.robotType ?? null,
      embodiment_level: null,
      contribution_type: item.ownershipStatus,
      stance: null,
      sentiment: null,
      perspective_theme: null,
      relation: item.robotModel ? "instance_of" : null,
      subject: item.displayName,
      object: item.robotModel?.canonicalName ?? null,
      url: null,
      source_platform: "owned_inventory",
      published_at: item.acquisitionDate?.toISOString() ?? null,
      author: null,
      confidence: 0.82,
      evidence_excerpt: null,
      notes: item.notes,
      data_origin: "database",
      verification_status: isReviewed ? "APPROVED" : null,
      is_reviewed: isReviewed,
      evidence_kind: isReviewed ? "reviewed_assertion" : "inferred_relation"
    });
  }

  for (const item of contributions) {
    const isApproved = item.verificationStatus === "APPROVED";
    records.push({
      id: item.id,
      category: "contribution",
      title: item.title,
      canonical_name: item.title,
      description: item.description,
      organization: item.organization,
      country: null,
      robot_type: item.relatedRobotModel?.robotType ?? null,
      embodiment_level: null,
      contribution_type: item.contributionType,
      stance: null,
      sentiment: null,
      perspective_theme: null,
      relation: item.relatedRobotModel ? "relates_to" : null,
      subject: item.title,
      object: item.relatedRobotModel?.canonicalName ?? null,
      url: item.sourceUrl,
      source_platform: "contribution_record",
      published_at: item.createdAt.toISOString(),
      author: item.contributorName,
      confidence: isApproved ? 0.92 : 0.68,
      evidence_excerpt: item.description,
      notes: item.verificationStatus,
      data_origin: "database",
      verification_status: item.verificationStatus,
      is_reviewed: isApproved,
      evidence_kind: isApproved ? "reviewed_assertion" : "inferred_relation"
    });
  }

  for (const item of sources) {
    records.push({
      id: item.id,
      category: sourceTypeToCategory(item.sourceType),
      title: item.title,
      canonical_name: item.title,
      description: item.excerpt,
      organization: null,
      country: null,
      robot_type: null,
      embodiment_level: null,
      contribution_type: null,
      stance: null,
      sentiment: null,
      perspective_theme: null,
      relation: null,
      subject: null,
      object: null,
      url: item.url,
      source_platform: item.platform ?? item.sourceType,
      published_at: item.publishedAt?.toISOString() ?? null,
      author: item.author,
      confidence: item.relevanceConfidence,
      evidence_excerpt: item.excerpt,
      notes: item.relevanceStatus,
      data_origin: "database"
    });
  }

  for (const item of perspectives) {
    records.push({
      id: item.id,
      category: "perspective_annotation",
      title: `${item.perspectiveTheme}: ${item.targetEntity}`,
      canonical_name: `${item.perspectiveTheme}: ${item.targetEntity}`,
      description: item.evidenceExcerpt,
      organization: null,
      country: null,
      robot_type: null,
      embodiment_level: null,
      contribution_type: null,
      stance: item.stance,
      sentiment: item.sentiment,
      perspective_theme: item.perspectiveTheme,
      relation: "discusses",
      subject: `${item.perspectiveTheme}: ${item.targetEntity}`,
      object: item.targetEntity,
      url: item.source?.url ?? null,
      source_platform: item.source?.platform ?? null,
      published_at: item.source?.publishedAt?.toISOString() ?? null,
      author: null,
      confidence: item.confidence,
      evidence_excerpt: item.evidenceExcerpt,
      notes: item.method,
      data_origin: "database"
    });
  }



  for (const item of triplets) {
    records.push({
      id: item.id,
      category: "triplet_relation",
      title: `${item.subject} ${item.relation} ${item.object}`,
      canonical_name: `${item.subject} -> ${item.relation} -> ${item.object}`,
      description: `${item.subject} ${item.relation} ${item.object}.`,
      organization: null,
      country: null,
      robot_type: null,
      embodiment_level: null,
      contribution_type: null,
      stance: null,
      sentiment: null,
      perspective_theme: null,
      relation: item.relation,
      subject: item.subject,
      object: item.object,
      url: item.source?.url ?? null,
      source_platform: item.source?.platform ?? null,
      published_at: item.source?.publishedAt?.toISOString() ?? null,
      author: null,
      confidence: item.confidence,
      evidence_excerpt: item.source?.excerpt ?? null,
      notes: null,
      data_origin: "database"
    });
  }

  return { records, warnings };
}

export async function loadGraphRecordsFromPrisma(): Promise<AtlasRecord[]> {
  const result = await loadGraphRecordsFromPrismaWithWarnings();
  return result.records;
}

export const fileNetworkGraphSource: NetworkGraphSource = {
  name: "import_file",
  async available() {
    return existsSync(getNetworkImportFilePath());
  },
  loadRecords: loadGraphRecordsFromFile
};

export const databaseNetworkGraphSource: NetworkGraphSource = {
  name: "database",
  available: databaseAvailable,
  loadRecords: loadGraphRecordsFromPrisma
};

export function dedupeKey(record: AtlasRecord) {
  const category = record.category ?? "unknown";
  if (category === "triplet_relation") {
    return `triplet:${slugify(record.subject ?? "")}:${slugify(record.relation ?? "")}:${slugify(record.object ?? "")}:${slugify(record.url ?? "")}`;
  }
  if (category === "robot_model" && record.canonical_name) return `robot:${slugify(record.canonical_name)}`;
  if (record.canonical_name && record.url) return `${category}:canonical:${slugify(record.canonical_name)}:${slugify(record.url)}`;
  if (record.title && record.url) return `${category}:title:${slugify(record.title)}:${slugify(record.url)}`;
  return `${category}:${slugify(record.canonical_name ?? record.title ?? record.id)}`;
}

export function mergeRecords(databaseRecords: AtlasRecord[], fileRecords: AtlasRecord[]) {
  const merged = new Map<string, AtlasRecord & { sourceIds?: string[]; importIds?: string[] }>();
  for (const record of [...databaseRecords, ...fileRecords]) {
    const key = dedupeKey(record);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...record,
        sourceIds: record.data_origin === "database" ? [record.id] : [],
        importIds: record.data_origin === "import_file" ? [record.id] : []
      });
      continue;
    }
    const prefer = existing.data_origin === "database" ? existing : record.data_origin === "database" ? record : existing;
    const fill = prefer === existing ? record : existing;
    merged.set(key, {
      ...prefer,
      title: prefer.title || fill.title,
      canonical_name: prefer.canonical_name || fill.canonical_name,
      description: prefer.description || fill.description,
      organization: prefer.organization || fill.organization,
      country: prefer.country || fill.country,
      robot_type: prefer.robot_type || fill.robot_type,
      embodiment_level: prefer.embodiment_level || fill.embodiment_level,
      contribution_type: prefer.contribution_type || fill.contribution_type,
      stance: prefer.stance || fill.stance,
      sentiment: prefer.sentiment || fill.sentiment,
      perspective_theme: prefer.perspective_theme || fill.perspective_theme,
      relation: prefer.relation || fill.relation,
      subject: prefer.subject || fill.subject,
      object: prefer.object || fill.object,
      url: prefer.url || fill.url,
      source_platform: prefer.source_platform || fill.source_platform,
      published_at: prefer.published_at || fill.published_at,
      author: prefer.author || fill.author,
      confidence: prefer.confidence ?? fill.confidence,
      evidence_excerpt: prefer.evidence_excerpt || fill.evidence_excerpt,
      notes: prefer.notes || fill.notes,
      data_origin: "merged",
      sourceIds: [...new Set([...(existing.sourceIds ?? []), ...(record.data_origin === "database" ? [record.id] : [])])],
      importIds: [...new Set([...(existing.importIds ?? []), ...(record.data_origin === "import_file" ? [record.id] : [])])]
    } as AtlasRecord & { sourceIds: string[]; importIds: string[] });
  }
  return [...merged.values()].map((record) => ({
    ...record,
    data_origin: record.sourceIds?.length && record.importIds?.length ? "merged" : record.data_origin,
    source_record_ids: record.sourceIds ?? record.source_record_ids ?? [],
    import_record_ids: record.importIds ?? record.import_record_ids ?? []
  })) as AtlasRecord[];
}

export async function loadGraphRecordsHybrid(): Promise<SourceLoadResult> {
  const fileAvailable = existsSync(getNetworkImportFilePath());
  const warnings: string[] = [];
  let dbRecords: AtlasRecord[] = [];
  let databaseOk = false;
  try {
    const dbResult = await loadGraphRecordsFromPrismaWithWarnings();
    dbRecords = dbResult.records;
    databaseOk = true;
    if (dbResult.warnings.length) {
      warnings.push(...dbResult.warnings);
    }
  } catch (error) {
    warnings.push(sanitizeError(error));
  }
  let fileRecords: AtlasRecord[] = [];
  if (fileAvailable) {
    try {
      fileRecords = await loadGraphRecordsFromFile();
    } catch {
      warnings.push(importFileWarning);
    }
  } else {
    warnings.push(importFileWarning);
  }
  if (!databaseOk && !fileRecords.length) throw new Error(warnings[0] ?? "No network graph source is available.");
  return {
    records: mergeRecords(dbRecords, fileRecords),
    resolvedSource: databaseOk && fileRecords.length ? "hybrid" : databaseOk ? "database" : "fallback_file",
    databaseAvailable: databaseOk,
    fileAvailable,
    warnings
  };
}

export async function loadGraphRecordsAuto(): Promise<SourceLoadResult> {
  const fileAvailable = existsSync(getNetworkImportFilePath());
  try {
    const dbResult = await loadGraphRecordsFromPrismaWithWarnings();
    return { records: dbResult.records, resolvedSource: "database", databaseAvailable: true, fileAvailable, warnings: dbResult.warnings };
  } catch {
    if (!fileAvailable) {
      return { records: [], resolvedSource: "fallback_file", databaseAvailable: false, fileAvailable, warnings: [fallbackWarning, importFileWarning] };
    }
    return {
      records: await loadGraphRecordsFromFile(),
      resolvedSource: "fallback_file",
      databaseAvailable: false,
      fileAvailable,
      warnings: [fallbackWarning]
    };
  }
}

export async function loadGraphRecords(mode: NetworkSourceMode): Promise<SourceLoadResult> {
  const fileAvailable = existsSync(getNetworkImportFilePath());
  if (mode === "file") {
    return { records: await loadGraphRecordsFromFile(), resolvedSource: "file", databaseAvailable: false, fileAvailable, warnings: [] };
  }

  if (mode === "database") {
    try {
      const dbResult = await loadGraphRecordsFromPrismaWithWarnings();
      return { records: dbResult.records, resolvedSource: "database", databaseAvailable: true, fileAvailable, warnings: dbResult.warnings };
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  }

  if (mode === "hybrid") {
    return loadGraphRecordsHybrid();
  }

  return loadGraphRecordsAuto();
}

function graphNodeType(record: AtlasRecord) {
  const category = record.category ?? "source_record";
  if (category === "source_record" && record.source_platform?.toLowerCase().includes("youtube")) return "video";
  if (category === "source_record" && record.source_platform?.toLowerCase().includes("openalex")) return "paper";
  return category;
}

type ReviewEvidence = {
  is_reviewed?: boolean;
  review_status?: string | null;
  evidence_kind?: string | null;
  evidence_excerpt?: string | null;
};

/**
 * Merge review status, evidence kind and excerpt as one unit. Reviewed evidence supersedes inferred
 * evidence in either arrival order, and an unreviewed record never supplies the excerpt of a reviewed one.
 */
export function mergeReviewEvidence(existing: ReviewEvidence, incoming: ReviewEvidence) {
  const wasReviewed = Boolean(existing.is_reviewed);
  const incomingReviewed = Boolean(incoming.is_reviewed);
  existing.is_reviewed = wasReviewed || incomingReviewed;
  if (incomingReviewed && !wasReviewed) {
    existing.review_status = incoming.review_status ?? existing.review_status;
    existing.evidence_kind = incoming.evidence_kind ?? existing.evidence_kind;
    existing.evidence_excerpt = incoming.evidence_excerpt ?? null;
  } else if (!wasReviewed || incomingReviewed) {
    existing.review_status ||= incoming.review_status;
    existing.evidence_kind ||= incoming.evidence_kind;
    existing.evidence_excerpt ||= incoming.evidence_excerpt;
  }
}

function mergeNode(nodes: Map<string, NetworkNode>, node: Omit<NetworkNode, "degree">) {
  const existing = nodes.get(node.id);
  if (!existing) {
    nodes.set(node.id, { ...node, degree: 0 });
    return node.id;
  }
  existing.confidence = Math.max(existing.confidence, node.confidence);
  existing.source_count = Math.max(existing.source_count, node.source_count);
  existing.is_low_confidence = existing.is_low_confidence && node.is_low_confidence;
  mergeReviewEvidence(existing, node);
  existing.data_origin = mergeOrigins(existing.data_origin, node.data_origin);
  existing.description ||= node.description;
  existing.organization ||= node.organization;
  existing.country ||= node.country;
  existing.url ||= node.url;
  existing.record_id ||= node.record_id;
  existing.source_record_ids = [...new Set([...existing.source_record_ids, ...node.source_record_ids])];
  existing.import_record_ids = [...new Set([...existing.import_record_ids, ...node.import_record_ids])];
  return existing.id;
}

function edgeId(source: string, relation: string, target: string, url?: string | null) {
  const key = `${source}:${relation}:${target}:${url || ""}`;
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 10);
  return `edge:${relation}_${hash}`;
}

function mergeEdge(edges: Map<string, NetworkEdge>, edge: NetworkEdge) {
  const existing = edges.get(edge.id);
  if (!existing) {
    edges.set(edge.id, edge);
    return;
  }
  existing.weight += edge.weight || 1;
  existing.confidence = Math.max(existing.confidence, edge.confidence);
  existing.is_low_confidence = existing.is_low_confidence && edge.is_low_confidence;
  mergeReviewEvidence(existing, edge);
  existing.data_origin = mergeOrigins(existing.data_origin, edge.data_origin);
  existing.url ||= edge.url;
  existing.source_platform ||= edge.source_platform;
  existing.published_at ||= edge.published_at;
  existing.source_record_ids = [...new Set([...existing.source_record_ids, ...edge.source_record_ids])];
  existing.import_record_ids = [...new Set([...existing.import_record_ids, ...edge.import_record_ids])];
}

function addEdge(edges: Map<string, NetworkEdge>, edge: Omit<NetworkEdge, "id" | "label" | "is_low_confidence"> & { id?: string; label?: string }) {
  const id = edge.id ?? edgeId(edge.source, edge.relation, edge.target, edge.url);
  const confidence = clampConfidence(edge.confidence);
  mergeEdge(edges, {
    ...edge,
    id,
    label: edge.label ?? edge.relation,
    confidence,
    is_low_confidence: confidence < 0.7
  });
}

function addRecordNode(nodes: Map<string, NetworkNode>, record: AtlasRecord) {
  const type = graphNodeType(record);
  const label = record.canonical_name || record.title || record.subject || record.id;
  const originIds = recordOriginIds(record);
  const isReviewed = record.is_reviewed !== undefined
    ? Boolean(record.is_reviewed)
    : Boolean(record.verification_status === "APPROVED" || record.notes === "APPROVED");
  const reviewStatus = record.verification_status ?? (record.notes === "APPROVED" ? "APPROVED" : isReviewed ? "APPROVED" : null);
  const evidenceKind = record.evidence_kind ?? (isReviewed ? "reviewed_assertion" : "inferred_relation");
  return mergeNode(nodes, {
    id: nodeId(type, label),
    label,
    type,
    cluster: classifyCluster({
      type,
      label,
      robotType: record.robot_type,
      useCase: record.contribution_type,
      sourceType: record.source_platform,
      status: record.notes
    }),
    description: record.description ?? record.notes,
    organization: record.organization,
    country: record.country,
    robot_type: record.robot_type,
    confidence: clampConfidence(record.confidence, 0.65),
    source_count: record.url ? 1 : 0,
    is_private: record.category === "owned_inventory" && record.notes === "private",
    is_low_confidence: clampConfidence(record.confidence, 0.65) < 0.7,
    is_reviewed: isReviewed,
    review_status: reviewStatus,
    evidence_kind: evidenceKind,
    url: record.url,
    evidence_excerpt: record.evidence_excerpt,
    record_id: record.id,
    data_origin: record.data_origin,
    ...originIds
  });
}

function applyDegrees(nodes: Map<string, NetworkNode>, edges: Map<string, NetworkEdge>) {
  for (const node of nodes.values()) node.degree = 0;
  for (const edge of edges.values()) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (source) source.degree += 1;
    if (target) target.degree += 1;
  }
}

function buildClusters(nodes: NetworkNode[], edges: NetworkEdge[]) {
  const clusters = new Map<string, NetworkCluster>();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    const cluster = clusters.get(node.cluster) ?? {
      id: node.cluster,
      label: clusterLabels[node.cluster] ?? node.cluster.replace(/_/g, " "),
      node_count: 0,
      edge_count: 0
    };
    cluster.node_count += 1;
    clusters.set(node.cluster, cluster);
  }
  for (const edge of edges) {
    const cluster = clusters.get(nodeById.get(edge.source)?.cluster ?? "");
    if (cluster) cluster.edge_count += 1;
  }
  return [...clusters.values()].sort((a, b) => b.node_count - a.node_count);
}

function limitGraph(nodes: NetworkNode[], edges: NetworkEdge[], maxNodes: number, maxEdges: number) {
  const selected = new Set(
    [...nodes]
      .sort((a, b) => (b.degree + b.source_count + b.confidence) - (a.degree + a.source_count + a.confidence))
      .slice(0, maxNodes)
      .map((node) => node.id)
  );
  const limitedEdges = edges
    .filter((edge) => selected.has(edge.source) && selected.has(edge.target))
    .sort((a, b) => (b.weight + b.confidence) - (a.weight + a.confidence))
    .slice(0, maxEdges);
  const used = new Set<string>();
  for (const edge of limitedEdges) {
    used.add(edge.source);
    used.add(edge.target);
  }
  return { nodes: nodes.filter((node) => selected.has(node.id) && (used.has(node.id) || limitedEdges.length === 0)), edges: limitedEdges };
}

function graphResult(
  nodes: NetworkNode[],
  edges: NetworkEdge[],
  meta: Omit<NetworkGraphMeta, "node_count" | "edge_count" | "cluster_count" | "generated_at">
): NetworkGraph {
  const clusters = buildClusters(nodes, edges);
  return {
    nodes,
    edges,
    clusters,
    meta: {
      ...meta,
      node_count: nodes.length,
      edge_count: edges.length,
      cluster_count: clusters.length,
      generated_at: new Date().toISOString()
    }
  };
}

function filterBuiltGraph(nodes: NetworkNode[], edges: NetworkEdge[], options: NetworkGraphOptions) {
  const minConfidence = options.minConfidence ?? 0;
  const nodeSet = new Set<string>();
  const filteredNodes = nodes.filter((node) => {
    if (options.cluster && node.cluster !== options.cluster) return false;
    if (options.nodeType && node.type !== options.nodeType) return false;
    if (options.includeLowConfidence === false && node.is_low_confidence) return false;
    if (options.onlyReviewed && !node.is_reviewed && node.review_status !== "APPROVED") return false;
    if (!options.includePrivate && node.is_private) return false;
    if (node.confidence < minConfidence) return false;
    nodeSet.add(node.id);
    return true;
  });
  const filteredEdges = edges.filter((edge) => {
    if (!nodeSet.has(edge.source) || !nodeSet.has(edge.target)) return false;
    if (options.relation && edge.relation !== options.relation) return false;
    if (options.includeLowConfidence === false && edge.is_low_confidence) return false;
    if (options.onlyReviewed && !edge.is_reviewed && edge.review_status !== "APPROVED") return false;
    if (edge.confidence < minConfidence) return false;
    return true;
  });
  return { nodes: filteredNodes, edges: filteredEdges };
}

export function filterGraph(
  graph: NetworkGraph,
  filters: Record<string, string> = {},
  toggles: {
    showLowConfidence?: boolean;
    onlyReviewed?: boolean;
    showOwned?: boolean;
    showMedia?: boolean;
    showAcademic?: boolean;
  } = {}
): NetworkGraph {
  const allOption = "all";
  const year = filters.year && filters.year !== allOption ? Number(filters.year) : null;
  const confidenceMin = Number(filters.confidenceMin || 0);
  const showLowConfidence = toggles.showLowConfidence ?? true;
  const showOwned = toggles.showOwned ?? true;
  const showMedia = toggles.showMedia ?? true;
  const showAcademic = toggles.showAcademic ?? true;
  const onlyReviewed = toggles.onlyReviewed ?? false;

  const allowedNodes = new Set<string>();
  const nodes = graph.nodes.filter((node) => {
    if (!showLowConfidence && node.is_low_confidence) return false;
    if (!showOwned && node.type === "owned_inventory") return false;
    if (!showMedia && (node.type === "perspective_annotation" || node.type === "perspective_theme" || node.cluster === "media_perspectives")) return false;
    if (!showAcademic && node.cluster === "research_and_academic_contributions") return false;
    if (onlyReviewed && !node.is_reviewed && node.review_status !== "APPROVED") return false;
    if (node.confidence < confidenceMin) return false;
    if (filters.nodeType && filters.nodeType !== allOption && node.type !== filters.nodeType) return false;
    if (filters.cluster && filters.cluster !== allOption && node.cluster !== filters.cluster) return false;
    if (filters.robotType && filters.robotType !== allOption && node.robot_type !== filters.robotType) return false;
    if (filters.organization && filters.organization !== allOption && node.organization !== filters.organization) return false;
    if (filters.country && filters.country !== allOption && node.country !== filters.country) return false;
    if (filters.visibility === "public" && node.is_private) return false;
    if (filters.visibility === "private" && !node.is_private) return false;
    allowedNodes.add(node.id);
    return true;
  });

  const edges = graph.edges.filter((edge) => {
    if (!allowedNodes.has(edge.source) || !allowedNodes.has(edge.target)) return false;
    if (!showLowConfidence && edge.is_low_confidence) return false;
    if (onlyReviewed && !edge.is_reviewed && edge.review_status !== "APPROVED") return false;
    if (edge.confidence < confidenceMin) return false;
    if (filters.relation && filters.relation !== allOption && edge.relation !== filters.relation) return false;
    if (filters.sourcePlatform && filters.sourcePlatform !== allOption && edge.source_platform !== filters.sourcePlatform) return false;
    if (year && edge.published_at && new Date(edge.published_at).getFullYear() !== year) return false;
    return true;
  });

  const connected = new Set<string>();
  edges.forEach((edge) => {
    connected.add(edge.source);
    connected.add(edge.target);
  });

  return {
    ...graph,
    nodes: nodes.filter((node) => connected.has(node.id) || edges.length === 0),
    edges,
    meta: { ...graph.meta, node_count: nodes.length, edge_count: edges.length }
  };
}

export async function buildNetworkGraph(options: NetworkGraphOptions = {}): Promise<NetworkGraph> {
  const sourceMode = resolveSourceMode(options.sourceMode);
  const maxNodes = options.maxNodes ?? 300;
  const maxEdges = options.maxEdges ?? 800;
  const cacheKey = JSON.stringify({ sourceMode, maxNodes, maxEdges, filters: options });
  if (cachedGraph?.key === cacheKey && Date.now() - cachedGraph.cachedAt < 60_000) return cachedGraph.graph;

  const source: SourceLoadResult = options.records
    ? { resolvedSource: "file", records: options.records, databaseAvailable: false, fileAvailable: true, warnings: [] }
    : await loadGraphRecords(sourceMode);
  // Nothing to read from is a server fault, not an empty graph. Throwing keeps it out of the cache
  // and lets the API answer 503 instead of a 200 or a 404 that looks like a real empty result.
  if (!source.databaseAvailable && !source.fileAvailable) throw new Error("No network graph source is available.");
  const nodes = new Map<string, NetworkNode>();
  const edges = new Map<string, NetworkEdge>();
  const recordNodeByName = new Map<string, string>();
  const robotNodeByName = new Map<string, string>();
  const nodeIdByRecord = new Map<AtlasRecord, string>();

  for (const record of source.records) {
    if (record.category === "triplet_relation") continue;
    const id = addRecordNode(nodes, record);
    nodeIdByRecord.set(record, id);
    const label = record.canonical_name || record.title;
    if (label) recordNodeByName.set(label.toLowerCase(), id);
    if (record.title) recordNodeByName.set(record.title.toLowerCase(), id);
    if (record.category === "robot_model" && label) robotNodeByName.set(label.toLowerCase(), id);
  }

  for (const record of source.records) {
    if (record.category === "triplet_relation") continue;
    // Per-record lookup: a name shared across record types must not move edges to another type's node.
    const currentId = nodeIdByRecord.get(record);
    if (!currentId) continue;
    const ids = recordOriginIds(record);

    if (record.organization) {
      for (const org of splitNames(record.organization)) {
        const isRecordReviewed = record.is_reviewed !== undefined
          ? Boolean(record.is_reviewed)
          : Boolean(record.verification_status === "APPROVED" || record.notes === "APPROVED");
        const orgReviewStatus = record.verification_status ?? (record.notes === "APPROVED" ? "APPROVED" : isRecordReviewed ? "APPROVED" : null);
        const orgEvidenceKind = isRecordReviewed ? "reviewed_assertion" : "inferred_relation";

        const orgId = mergeNode(nodes, {
          id: nodeId("organization", org),
          label: org,
          type: "organization",
          cluster: "companies_and_institutions",
          description: "Organization connected to atlas records.",
          organization: org,
          country: record.country,
          confidence: 0.78,
          source_count: 1,
          is_private: false,
          is_low_confidence: false,
          is_reviewed: isRecordReviewed,
          review_status: orgReviewStatus,
          evidence_kind: orgEvidenceKind,
          url: record.url,
          evidence_excerpt: record.evidence_excerpt,
          record_id: null,
          data_origin: record.data_origin,
          ...ids
        });
        addEdge(edges, {
          source: currentId,
          target: orgId,
          relation: record.category === "robot_model" ? "developed_by" : record.category === "contribution" ? "created_by" : "published_by",
          description: `${record.canonical_name || record.title} is connected to ${org}.`,
          confidence: record.category === "robot_model" ? 0.88 : 0.74,
          weight: 1,
          is_reviewed: isRecordReviewed,
          review_status: orgReviewStatus,
          evidence_kind: orgEvidenceKind,
          evidence_excerpt: record.evidence_excerpt,
          url: record.url,
          source_platform: record.source_platform,
          published_at: record.published_at,
          data_origin: record.data_origin,
          ...ids
        });
      }
    }

    if (record.source_platform) {
      const platformId = mergeNode(nodes, {
        id: nodeId("source_platform", record.source_platform),
        label: record.source_platform,
        type: "source_platform",
        cluster: "companies_and_institutions",
        description: "Source platform.",
        organization: record.source_platform,
        country: null,
        confidence: 0.82,
        source_count: 1,
        is_private: false,
        is_low_confidence: false,
        url: record.url,
        evidence_excerpt: record.evidence_excerpt,
        record_id: null,
        data_origin: record.data_origin,
        ...ids
      });
      addEdge(edges, {
        source: currentId,
        target: platformId,
        relation: "published_by",
        description: `${record.canonical_name || record.title} was published by ${record.source_platform}.`,
        confidence: 0.82,
        weight: 1,
        evidence_excerpt: record.evidence_excerpt,
        url: record.url,
        source_platform: record.source_platform,
        published_at: record.published_at,
        data_origin: record.data_origin,
        ...ids
      });
    }

    if (record.country) {
      const isOriginCountry = record.category === "robot_model";
      const relation = isOriginCountry ? "origin_country" : "located_in";
      const description = isOriginCountry
        ? `${record.canonical_name || record.title} originates from ${record.country}.`
        : `${record.canonical_name || record.title} is associated with ${record.country}.`;
      const isRecordReviewed = record.is_reviewed !== undefined
        ? Boolean(record.is_reviewed)
        : Boolean(record.verification_status === "APPROVED" || record.notes === "APPROVED");
      const isReviewed = isOriginCountry && isRecordReviewed;

      const countryId = mergeNode(nodes, {
        id: nodeId("country", record.country),
        label: record.country,
        type: "country",
        cluster: "companies_and_institutions",
        description: "Country associated with atlas entities.",
        organization: null,
        country: record.country,
        confidence: 0.78,
        source_count: 1,
        is_private: false,
        is_low_confidence: false,
        is_reviewed: isReviewed,
        review_status: isReviewed ? "APPROVED" : null,
        evidence_kind: isReviewed ? "reviewed_assertion" : "inferred_relation",
        url: null,
        evidence_excerpt: record.evidence_excerpt,
        record_id: null,
        data_origin: record.data_origin,
        ...ids
      });
      addEdge(edges, {
        source: currentId,
        target: countryId,
        relation,
        description,
        confidence: 0.76,
        weight: 1,
        is_reviewed: isReviewed,
        review_status: isReviewed ? "APPROVED" : null,
        evidence_kind: isReviewed ? "reviewed_assertion" : "inferred_relation",
        evidence_excerpt: record.evidence_excerpt,
        url: record.url,
        source_platform: record.source_platform,
        published_at: record.published_at,
        data_origin: record.data_origin,
        ...ids
      });
    }

    for (const author of splitNames(record.author)) {
      const isRecordReviewed = record.is_reviewed !== undefined
        ? Boolean(record.is_reviewed)
        : Boolean(record.verification_status === "APPROVED" || record.notes === "APPROVED");
      const authorReviewStatus = record.verification_status ?? (record.notes === "APPROVED" ? "APPROVED" : isRecordReviewed ? "APPROVED" : null);
      const authorEvidenceKind = isRecordReviewed ? "reviewed_assertion" : "inferred_relation";

      const authorId = mergeNode(nodes, {
        id: nodeId("author", author),
        label: author,
        type: "author",
        cluster: "research_and_academic_contributions",
        description: "Author from atlas records.",
        organization: null,
        country: null,
        confidence: 0.72,
        source_count: 1,
        is_private: false,
        is_low_confidence: false,
        is_reviewed: isRecordReviewed,
        review_status: authorReviewStatus,
        evidence_kind: authorEvidenceKind,
        url: record.url,
        evidence_excerpt: record.evidence_excerpt,
        record_id: null,
        data_origin: record.data_origin,
        ...ids
      });
      addEdge(edges, {
        source: currentId,
        target: authorId,
        relation: "authored_by",
        description: `${record.title} was authored by ${author}.`,
        confidence: 0.78,
        weight: 1,
        is_reviewed: isRecordReviewed,
        review_status: authorReviewStatus,
        evidence_kind: authorEvidenceKind,
        evidence_excerpt: record.evidence_excerpt,
        url: record.url,
        source_platform: record.source_platform,
        published_at: record.published_at,
        data_origin: record.data_origin,
        ...ids
      });
    }

    if (record.category === "owned_inventory") {
      const isRecordReviewed = record.is_reviewed !== undefined
        ? Boolean(record.is_reviewed)
        : Boolean(record.verification_status === "APPROVED" || record.notes === "APPROVED");
      const inventoryReviewStatus = record.verification_status ?? (record.notes === "APPROVED" ? "APPROVED" : isRecordReviewed ? "APPROVED" : null);
      const inventoryEvidenceKind = record.evidence_kind ?? (isRecordReviewed ? "reviewed_assertion" : "inferred_relation");

      if (record.object) {
        const robotId = robotNodeByName.get(record.object.toLowerCase()) ?? recordNodeByName.get(record.object.toLowerCase());
        if (robotId) {
          addEdge(edges, {
            source: currentId,
            target: robotId,
            relation: "instance_of",
            description: `${record.title} is an instance of ${record.object}.`,
            confidence: 0.92,
            weight: 1,
            is_reviewed: isRecordReviewed,
            review_status: inventoryReviewStatus,
            evidence_kind: inventoryEvidenceKind,
            evidence_excerpt: record.evidence_excerpt,
            url: record.url,
            source_platform: record.source_platform,
            published_at: record.published_at,
            data_origin: record.data_origin,
            ...ids
          });
        }
      }
      const ownerLabel = record.organization || "Internal team";
      const rawStatus = (record.contribution_type || "owned").toLowerCase();
      const isOwned = rawStatus === "owned" || rawStatus === "purchased";
      const isBorrowed = rawStatus === "borrowed" || rawStatus === "loaned";
      const isLeased = rawStatus === "leased";

      const relation = isOwned ? "owned_by" : isBorrowed ? "borrowed_from" : isLeased ? "leased_from" : "held_by";
      const relationDesc = isOwned
        ? `${record.title} is owned by ${ownerLabel}.`
        : isBorrowed
        ? `${record.title} is borrowed from ${ownerLabel}.`
        : isLeased
        ? `${record.title} is leased from ${ownerLabel}.`
        : `${record.title} is held by ${ownerLabel}.`;

      const teamId = mergeNode(nodes, {
        id: nodeId("organization", ownerLabel),
        label: ownerLabel,
        type: "organization",
        cluster: "owned_inventory",
        description: `${ownerLabel} inventory holder.`,
        organization: record.organization,
        country: null,
        confidence: 0.85,
        source_count: 0,
        is_private: record.category === "owned_inventory" && record.notes === "private",
        is_low_confidence: false,
        is_reviewed: isRecordReviewed,
        review_status: inventoryReviewStatus,
        evidence_kind: inventoryEvidenceKind,
        url: null,
        evidence_excerpt: null,
        record_id: null,
        data_origin: record.data_origin,
        ...ids
      });
      addEdge(edges, {
        source: currentId,
        target: teamId,
        relation,
        description: relationDesc,
        confidence: 0.85,
        weight: 1,
        is_reviewed: isRecordReviewed,
        review_status: inventoryReviewStatus,
        evidence_kind: inventoryEvidenceKind,
        evidence_excerpt: null,
        url: null,
        source_platform: "owned_inventory",
        published_at: null,
        data_origin: record.data_origin,
        ...ids
      });
    }

    if (record.category === "perspective_annotation") {
      const theme = record.perspective_theme || "unclear";
      const themeId = mergeNode(nodes, {
        id: nodeId("perspective_theme", theme),
        label: theme,
        type: "perspective_theme",
        cluster: "media_perspectives",
        description: "Perspective theme.",
        organization: null,
        country: null,
        confidence: 0.82,
        source_count: 1,
        is_private: false,
        is_low_confidence: false,
        is_reviewed: false,
        review_status: "inferred",
        evidence_kind: "inferred_relation",
        url: null,
        evidence_excerpt: record.evidence_excerpt,
        record_id: null,
        data_origin: record.data_origin,
        ...ids
      });
      addEdge(edges, {
        source: currentId,
        target: themeId,
        relation: "has_theme",
        description: `${record.title} has theme ${theme}.`,
        confidence: clampConfidence(record.confidence, 0.7),
        weight: 1,
        is_reviewed: false,
        review_status: "inferred",
        evidence_kind: "inferred_relation",
        evidence_excerpt: record.evidence_excerpt,
        url: record.url,
        source_platform: record.source_platform,
        published_at: record.published_at,
        data_origin: record.data_origin,
        ...ids
      });
    }

    const haystack = `${record.title ?? ""} ${record.description ?? ""} ${record.evidence_excerpt ?? ""}`.toLowerCase();
    for (const [name, robotId] of [...robotNodeByName].slice(0, 220)) {
      if (name.length > 3 && haystack.includes(name) && currentId !== robotId) {
        addEdge(edges, {
          source: currentId,
          target: robotId,
          relation: "mentions",
          description: `${record.title} mentions ${nodes.get(robotId)?.label ?? name}.`,
          confidence: 0.66,
          weight: 1,
          is_reviewed: false,
          review_status: "inferred",
          evidence_kind: "inferred_relation",
          evidence_excerpt: record.evidence_excerpt ?? record.description,
          url: record.url,
          source_platform: record.source_platform,
          published_at: record.published_at,
          data_origin: record.data_origin,
          ...ids
        });
      }
    }
  }

  for (const record of source.records.filter((item) => item.category === "triplet_relation")) {
    const subject = record.subject;
    const object = record.object;
    const relation = record.relation;
    if (!subject || !object || !relation) continue;
    const ids = recordOriginIds(record);
    const sourceId = recordNodeByName.get(subject.toLowerCase()) ?? mergeNode(nodes, {
      id: nodeId("entity", subject),
      label: subject,
      type: "entity",
      cluster: classifyCluster({ type: "entity", label: subject, robotType: record.robot_type }),
      description: "Entity from relationship record.",
      organization: null,
      country: record.country,
      confidence: clampConfidence(record.confidence, 0.7),
      source_count: record.url ? 1 : 0,
      is_private: false,
      is_low_confidence: clampConfidence(record.confidence, 0.7) < 0.7,
      is_reviewed: false,
      review_status: "inferred",
      evidence_kind: "inferred_relation",
      url: record.url,
      evidence_excerpt: record.evidence_excerpt,
      record_id: null,
      data_origin: record.data_origin,
      ...ids
    });
    const targetId = recordNodeByName.get(object.toLowerCase()) ?? mergeNode(nodes, {
      id: nodeId("entity", object),
      label: object,
      type: "entity",
      cluster: classifyCluster({ type: "entity", label: object }),
      description: "Entity from relationship record.",
      organization: null,
      country: record.country,
      confidence: clampConfidence(record.confidence, 0.7),
      source_count: record.url ? 1 : 0,
      is_private: false,
      is_low_confidence: clampConfidence(record.confidence, 0.7) < 0.7,
      is_reviewed: false,
      review_status: "inferred",
      evidence_kind: "inferred_relation",
      url: record.url,
      evidence_excerpt: record.evidence_excerpt,
      record_id: null,
      data_origin: record.data_origin,
      ...ids
    });
    addEdge(edges, {
      source: sourceId,
      target: targetId,
      relation,
      description: record.description ?? `${subject} ${relation} ${object}.`,
      confidence: clampConfidence(record.confidence, 0.7),
      weight: 2,
      is_reviewed: false,
      review_status: "inferred",
      evidence_kind: "inferred_relation",
      evidence_excerpt: record.evidence_excerpt,
      url: record.url,
      source_platform: record.source_platform,
      published_at: record.published_at,
      data_origin: record.data_origin,
      ...ids
    });
  }

  applyDegrees(nodes, edges);
  const allNodes = [...nodes.values()];
  const allEdges = [...edges.values()].filter((edge) => nodes.has(edge.source) && nodes.has(edge.target));
  const filtered = filterBuiltGraph(allNodes, allEdges, options);
  const truncated = filtered.nodes.length > maxNodes || filtered.edges.length > maxEdges || source.warnings.length > 0;
  const limited = limitGraph(filtered.nodes, filtered.edges, maxNodes, maxEdges);
  applyDegrees(new Map(limited.nodes.map((node) => [node.id, node])), new Map(limited.edges.map((edge) => [edge.id, edge])));

  const result = graphResult(limited.nodes, limited.edges, {
    source_mode: sourceMode,
    resolved_source: source.resolvedSource,
    database_available: source.databaseAvailable,
    file_available: source.fileAvailable,
    warnings: source.warnings,
    truncated
  });
  cachedGraph = { key: cacheKey, graph: result, cachedAt: Date.now() };
  return result;
}

export async function getNetworkNode(nodeIdValue: string, options: NetworkGraphOptions = {}) {
  const graph = await buildNetworkGraph({ ...options, maxNodes: 1000, maxEdges: 2500 });
  const node = graph.nodes.find((item) => item.id === nodeIdValue);
  if (!node) return null;
  return {
    node,
    meta: graph.meta,
    incoming: graph.edges.filter((edge) => edge.target === node.id),
    outgoing: graph.edges.filter((edge) => edge.source === node.id),
    connected_nodes: graph.nodes.filter((candidate) =>
      graph.edges.some((edge) =>
        (edge.source === node.id && edge.target === candidate.id) ||
        (edge.target === node.id && edge.source === candidate.id)
      )
    )
  };
}

export async function getNetworkEdge(edgeIdValue: string, options: NetworkGraphOptions = {}) {
  const graph = await buildNetworkGraph({ ...options, maxNodes: 1000, maxEdges: 2500 });
  const edge = graph.edges.find((item) => item.id === edgeIdValue);
  if (!edge) return null;
  return {
    edge,
    meta: graph.meta,
    subject: graph.nodes.find((node) => node.id === edge.source) ?? null,
    object: graph.nodes.find((node) => node.id === edge.target) ?? null
  };
}
