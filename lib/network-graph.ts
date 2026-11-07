import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type NetworkSourceMode = "file" | "database" | "hybrid" | "auto";
export type ResolvedNetworkSource = "database" | "file" | "hybrid" | "fallback_file";
export type DataOrigin = "database" | "import_file" | "merged";

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
  review_status?: string | null;
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
};

let cachedGraph: { key: string; graph: NetworkGraph; cachedAt: number } | null = null;

const databaseUnavailableWarning = "Database unavailable or permission denied.";
const fallbackWarning = `${databaseUnavailableWarning} Falling back to imported seed file.`;
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

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "unknown";
}

function nodeId(type: string, label: string) {
  return `${type}:${slugify(label)}`;
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

function normalizeFileRecord(record: Record<string, unknown>, index: number): AtlasRecord {
  return {
    id: clean(record.id) ?? `import:${index}`,
    category: clean(record.category),
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
    data_origin: "import_file"
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
  return raw.map((record, index) => normalizeFileRecord(record, index));
}

function sourceTypeToCategory(sourceType: string) {
  const normalized = sourceType.toLowerCase();
  if (normalized === "openalex") return "paper";
  if (normalized === "youtube") return "video";
  if (normalized === "gdelt" || normalized === "rss" || normalized === "web") return "media_source";
  return "source_record";
}

export async function loadGraphRecordsFromPrisma(): Promise<AtlasRecord[]> {
  const { prisma } = await import("@/lib/prisma");
  const records: AtlasRecord[] = [];
  const [robots, inventory, contributions, sources, perspectives, submissions, triplets] = await Promise.all([
    prisma.robotModel.findMany({ take: 700, orderBy: { updatedAt: "desc" } }),
    prisma.ownedInventory.findMany({ take: 500, include: { robotModel: true }, orderBy: { updatedAt: "desc" } }),
    prisma.contribution.findMany({ take: 700, include: { relatedRobotModel: true }, orderBy: { updatedAt: "desc" } }),
    prisma.sourceRecord.findMany({ take: 1200, orderBy: [{ relevanceConfidence: "desc" }, { updatedAt: "desc" }] }),
    prisma.perspectiveAnnotation.findMany({ take: 800, include: { source: true }, orderBy: { createdAt: "desc" } }),
    prisma.submittedData.findMany({ take: 500, orderBy: { updatedAt: "desc" } }),
    prisma.triplet.findMany({ take: 1400, include: { source: true }, orderBy: { confidence: "desc" } })
  ]);

  for (const item of robots) {
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
      notes: null,
      data_origin: "database"
    });
  }

  for (const item of inventory) {
    const isPrivate = item.visibility !== "public";
    records.push({
      id: item.id,
      category: "owned_inventory",
      title: item.displayName,
      canonical_name: item.displayName,
      description: isPrivate ? "Private inventory record. Sensitive details are hidden." : item.notes,
      organization: isPrivate ? "internal_team" : item.ownerOrg,
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
      evidence_excerpt: isPrivate ? null : item.notes,
      notes: isPrivate ? "private" : item.notes,
      data_origin: "database"
    });
  }

  for (const item of contributions) {
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
      confidence: item.verificationStatus === "APPROVED" ? 0.92 : 0.68,
      evidence_excerpt: item.description,
      notes: item.verificationStatus,
      data_origin: "database"
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

  for (const item of submissions) {
    records.push({
      id: item.id,
      category: "submission_record",
      title: item.title,
      canonical_name: item.title,
      description: item.notes,
      organization: null,
      country: null,
      robot_type: null,
      embodiment_level: null,
      contribution_type: item.submissionType,
      stance: null,
      sentiment: null,
      perspective_theme: null,
      relation: null,
      subject: null,
      object: null,
      url: item.status === "APPROVED" ? item.url : null,
      source_platform: "submission",
      published_at: item.createdAt.toISOString(),
      author: null,
      confidence: item.status === "APPROVED" ? 0.8 : 0.55,
      evidence_excerpt: item.reviewNotes ?? item.notes,
      notes: item.status,
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

  return records;
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

function dedupeKey(record: AtlasRecord) {
  const category = record.category ?? "unknown";
  if (category === "triplet_relation") {
    return `triplet:${slugify(record.subject ?? "")}:${slugify(record.relation ?? "")}:${slugify(record.object ?? "")}:${slugify(record.url ?? "")}`;
  }
  if (category === "robot_model" && record.canonical_name) return `robot:${slugify(record.canonical_name)}`;
  if (record.canonical_name && record.url) return `${category}:canonical:${slugify(record.canonical_name)}:${slugify(record.url)}`;
  if (record.title && record.url) return `${category}:title:${slugify(record.title)}:${slugify(record.url)}`;
  return `${category}:${slugify(record.canonical_name ?? record.title ?? record.id)}`;
}

function mergeRecords(databaseRecords: AtlasRecord[], fileRecords: AtlasRecord[]) {
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
    dbRecords = await loadGraphRecordsFromPrisma();
    databaseOk = true;
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
    return { records: await loadGraphRecordsFromPrisma(), resolvedSource: "database", databaseAvailable: true, fileAvailable, warnings: [] };
  } catch {
    if (!fileAvailable) {
      return { records: [], resolvedSource: "fallback_file", databaseAvailable: false, fileAvailable, warnings: [databaseUnavailableWarning, importFileWarning] };
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
      return { records: await loadGraphRecordsFromPrisma(), resolvedSource: "database", databaseAvailable: true, fileAvailable, warnings: [] };
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

function mergeNode(nodes: Map<string, NetworkNode>, node: Omit<NetworkNode, "degree">) {
  const existing = nodes.get(node.id);
  if (!existing) {
    nodes.set(node.id, { ...node, degree: 0 });
    return node.id;
  }
  existing.confidence = Math.max(existing.confidence, node.confidence);
  existing.source_count = Math.max(existing.source_count, node.source_count);
  existing.is_low_confidence = existing.is_low_confidence && node.is_low_confidence;
  existing.data_origin = mergeOrigins(existing.data_origin, node.data_origin);
  existing.description ||= node.description;
  existing.organization ||= node.organization;
  existing.country ||= node.country;
  existing.url ||= node.url;
  existing.evidence_excerpt ||= node.evidence_excerpt;
  existing.record_id ||= node.record_id;
  existing.source_record_ids = [...new Set([...existing.source_record_ids, ...node.source_record_ids])];
  existing.import_record_ids = [...new Set([...existing.import_record_ids, ...node.import_record_ids])];
  return existing.id;
}

function edgeId(source: string, relation: string, target: string, url?: string | null) {
  const sourceHint = url ? `_${slugify(url).slice(0, 28)}` : "";
  return `edge:${slugify(source)}-${slugify(relation)}-${slugify(target)}${sourceHint}`;
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
  existing.data_origin = mergeOrigins(existing.data_origin, edge.data_origin);
  existing.evidence_excerpt ||= edge.evidence_excerpt;
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
    if (options.includePrivate === false && node.is_private) return false;
    if (node.confidence < minConfidence) return false;
    nodeSet.add(node.id);
    return true;
  });
  const filteredEdges = edges.filter((edge) => {
    if (!nodeSet.has(edge.source) || !nodeSet.has(edge.target)) return false;
    if (options.relation && edge.relation !== options.relation) return false;
    if (options.includeLowConfidence === false && edge.is_low_confidence) return false;
    if (edge.confidence < minConfidence) return false;
    return true;
  });
  return { nodes: filteredNodes, edges: filteredEdges };
}

export async function buildNetworkGraph(options: NetworkGraphOptions = {}): Promise<NetworkGraph> {
  const sourceMode = resolveSourceMode(options.sourceMode);
  const maxNodes = options.maxNodes ?? 300;
  const maxEdges = options.maxEdges ?? 800;
  const cacheKey = JSON.stringify({ sourceMode, maxNodes, maxEdges, filters: options });
  if (cachedGraph?.key === cacheKey && Date.now() - cachedGraph.cachedAt < 60_000) return cachedGraph.graph;

  const source = await loadGraphRecords(sourceMode);
  const nodes = new Map<string, NetworkNode>();
  const edges = new Map<string, NetworkEdge>();
  const recordNodeByName = new Map<string, string>();
  const robotNodeByName = new Map<string, string>();

  for (const record of source.records) {
    if (record.category === "triplet_relation") continue;
    const id = addRecordNode(nodes, record);
    const label = record.canonical_name || record.title;
    if (label) recordNodeByName.set(label.toLowerCase(), id);
    if (record.title) recordNodeByName.set(record.title.toLowerCase(), id);
    if (record.category === "robot_model" && label) robotNodeByName.set(label.toLowerCase(), id);
  }

  for (const record of source.records) {
    if (record.category === "triplet_relation") continue;
    const currentId = recordNodeByName.get((record.canonical_name || record.title || "").toLowerCase());
    if (!currentId) continue;
    const ids = recordOriginIds(record);

    if (record.organization) {
      for (const org of splitNames(record.organization)) {
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
        url: null,
        evidence_excerpt: record.evidence_excerpt,
        record_id: null,
        data_origin: record.data_origin,
        ...ids
      });
      addEdge(edges, {
        source: currentId,
        target: countryId,
        relation: "located_in",
        description: `${record.canonical_name || record.title} is associated with ${record.country}.`,
        confidence: 0.76,
        weight: 1,
        evidence_excerpt: record.evidence_excerpt,
        url: record.url,
        source_platform: record.source_platform,
        published_at: record.published_at,
        data_origin: record.data_origin,
        ...ids
      });
    }

    for (const author of splitNames(record.author)) {
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
        evidence_excerpt: record.evidence_excerpt,
        url: record.url,
        source_platform: record.source_platform,
        published_at: record.published_at,
        data_origin: record.data_origin,
        ...ids
      });
    }

    if (record.category === "owned_inventory" && record.object) {
      const robotId = robotNodeByName.get(record.object.toLowerCase()) ?? recordNodeByName.get(record.object.toLowerCase());
      if (robotId) {
        addEdge(edges, {
          source: currentId,
          target: robotId,
          relation: "instance_of",
          description: `${record.title} is an instance of ${record.object}.`,
          confidence: 0.92,
          weight: 1,
          evidence_excerpt: record.evidence_excerpt,
          url: record.url,
          source_platform: record.source_platform,
          published_at: record.published_at,
          data_origin: record.data_origin,
          ...ids
        });
      }
      const teamId = mergeNode(nodes, {
        id: nodeId("organization", "internal_team"),
        label: "Internal team",
        type: "organization",
        cluster: "owned_inventory",
        description: "Private project inventory owner marker.",
        organization: "internal_team",
        country: null,
        confidence: 0.7,
        source_count: 0,
        is_private: true,
        is_low_confidence: false,
        url: null,
        evidence_excerpt: null,
        record_id: null,
        data_origin: record.data_origin,
        ...ids
      });
      addEdge(edges, {
        source: currentId,
        target: teamId,
        relation: "owned_by",
        description: `${record.title} is owned by the internal team.`,
        confidence: 0.75,
        weight: 1,
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
  const truncated = filtered.nodes.length > maxNodes || filtered.edges.length > maxEdges;
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
