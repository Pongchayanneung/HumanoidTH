import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import type {
  SearchDocument,
  SearchRecordKind,
  LanguageTag,
  SearchExportManifest,
  SearchEvidence
} from "./types";
import {
  PERMITTED_ORIGINS,
  MAX_BODY_CODE_POINTS,
  KNOWN_PLACEHOLDERS,
  PUBLIC_FIELDS_BY_KIND,
  STRICTLY_EXCLUDED_FIELDS,
  isPermittedOrigin
} from "./policy";
import {
  cleanSearchText,
  detectLanguage,
  computeContentHash,
  computeDependencyHash,
  createSearchEvidence
} from "./text-utils";
import {
  isEligiblePublicRobot,
  isEligiblePublicContribution
} from "../public-projection";

export interface ExportOptions {
  prisma?: any;
  seedPath?: string;
  datasetId?: string;
  releaseId?: string;
}

export interface ExportResult {
  documents: SearchDocument[];
  manifest: SearchExportManifest;
  probe128: SearchDocument[];
}

/**
 * Builds a stratified 128-document probe sample for embedding benchmarks.
 * Ensures balanced representation across Thai, English, Mixed languages and all eligible kinds.
 */
export function createProbeSample(
  documents: SearchDocument[],
  targetCount: number = 128
): SearchDocument[] {
  if (documents.length <= targetCount) {
    return [...documents];
  }

  const selected = new Map<string, SearchDocument>();

  const addDoc = (doc: SearchDocument) => {
    if (selected.size < targetCount && !selected.has(doc.typedId)) {
      selected.set(doc.typedId, doc);
      return true;
    }
    return false;
  };

  // 1. Guaranteed Inclusion: All Thai documents
  const thaiDocs = documents.filter((d) => d.language === "th");
  for (const doc of thaiDocs) {
    addDoc(doc);
  }

  // 2. Guaranteed Inclusion: All core non-source, non-entity catalog records
  // (Robots, Contributions, Perspectives, Relationships, Inventory)
  const coreCatalogKinds: SearchRecordKind[] = [
    "robot",
    "contribution",
    "perspective",
    "relationship",
    "inventory"
  ];
  for (const kind of coreCatalogKinds) {
    const kindDocs = documents.filter((d) => d.kind === kind);
    for (const doc of kindDocs) {
      addDoc(doc);
    }
  }

  // 3. Representative selection of Mixed language documents (up to 25)
  const mixedDocs = documents.filter((d) => d.language === "mixed");
  for (let i = 0; i < mixedDocs.length && i < 25; i++) {
    addDoc(mixedDocs[i]);
  }

  // 4. Representative Sources across diverse origins proportional to corpus distribution
  // (Corpus is ~52% OpenAlex, ~39% GitHub, ~5% YouTube, ~3% Web, plus all Thai & Mixed sources)
  const sourceDocs = documents.filter((d) => d.kind === "source");
  const byOrigin = new Map<string, SearchDocument[]>();
  for (const doc of sourceDocs) {
    const list = byOrigin.get(doc.origin) || [];
    list.push(doc);
    byOrigin.set(doc.origin, list);
  }

  // Sort each origin list by retrievalText length descending to capture rich substantive text
  for (const list of byOrigin.values()) {
    list.sort((a, b) => b.retrievalText.length - a.retrievalText.length);
  }

  // Quotas for balanced corpus representation without single-origin skew
  const originQuotas: Record<string, number> = {
    openalex: 38,
    github: 32,
    web: 16,
    youtube: 10
  };

  for (const [origin, quota] of Object.entries(originQuotas)) {
    const list = byOrigin.get(origin) || [];
    for (let i = 0; i < list.length && i < quota && selected.size < targetCount; i++) {
      addDoc(list[i]);
    }
  }

  // 5. Fill any remaining slots with longest remaining documents across all kinds
  if (selected.size < targetCount) {
    const remaining = [...documents]
      .filter((d) => !selected.has(d.typedId))
      .sort((a, b) => b.retrievalText.length - a.retrievalText.length);
    for (const doc of remaining) {
      addDoc(doc);
      if (selected.size >= targetCount) break;
    }
  }

  // Return deterministically sorted list
  return Array.from(selected.values()).sort((a, b) =>
    a.typedId.localeCompare(b.typedId)
  );
}

/**
 * Exports eligible search documents from offline seed records.
 */
export function exportSearchCorpusFromSeed(
  datasetPath: string = resolve(process.cwd(), "thailand_humanoid_atlas_seed_records.json"),
  datasetId: string = "thailand-humanoid-atlas-seed",
  releaseId: string = "search-v1-keyword"
): ExportResult {
  const fileContent = readFileSync(datasetPath, "utf8");
  const rawRecords = JSON.parse(fileContent) as any[];

  const documents: SearchDocument[] = [];
  let excludedCount = 0;

  const countsByKind: Record<SearchRecordKind, number> = {
    source: 0,
    robot: 0,
    contribution: 0,
    perspective: 0,
    inventory: 0,
    relationship: 0,
    entity: 0
  };

  const countsByLanguage: Record<LanguageTag, number> = {
    th: 0,
    en: 0,
    mixed: 0,
    unknown: 0
  };

  // Map to resolve parent source URLs to stable source typed IDs
  const urlToSourceTypedId = new Map<string, string>();

  for (let idx = 0; idx < rawRecords.length; idx++) {
    const r = rawRecords[idx];
    const category = r.category;

    if (category === "source_pull_job" || category === "submission_record") {
      excludedCount++;
      continue;
    }

    if (category === "source_record") {
      const platform = (r.source_platform || "web").toLowerCase();
      const origin = isPermittedOrigin(platform) ? platform : "web";
      const title = (r.title || "").trim();
      const rawExcerpt = r.evidence_excerpt || r.description || "";
      const { cleanedText, isPlaceholderOmitted, isTruncated } = cleanSearchText(rawExcerpt);

      const isTitleOnly = isPlaceholderOmitted || cleanedText.length === 0;
      const body = cleanedText;
      const fullTextForLang = `${title} ${body}`;
      const language = detectLanguage(fullTextForLang);
      const url = r.url ? r.url.trim() : null;
      const typedId = `source:seed-${idx}`;
      const groupId = url || typedId;

      if (url) {
        urlToSourceTypedId.set(url, typedId);
      }

      const metadata: Record<string, unknown> = {
        author: r.author || undefined,
        platform: r.source_platform || undefined,
        publishedAt: r.published_at || undefined,
        canonicalName: r.canonical_name || undefined
      };

      const contentHash = computeContentHash({
        typedId,
        title,
        body,
        url,
        metadata
      });

      const dependencyHash = computeDependencyHash(null);

      const evidence: SearchEvidence[] = [
        createSearchEvidence({
          fieldName: isTitleOnly ? "title" : "evidence_excerpt",
          originalText: isTitleOnly ? title : rawExcerpt,
          label: isTitleOnly ? "Title Only" : "Source Excerpt",
          isTitleOnly,
          isTruncated
        })
      ];

      const retrievalText = [title, r.author, r.source_platform, body]
        .filter(Boolean)
        .join(" ")
        .trim();

      const doc: SearchDocument = {
        typedId,
        kind: "source",
        title,
        body,
        retrievalText,
        url,
        groupId,
        origin,
        language,
        isTitleOnly,
        isPartial: isTruncated,
        parentTypedId: null,
        contentHash,
        dependencyHash,
        vectorRow: null,
        evidence,
        metadata
      };

      documents.push(doc);
      countsByKind.source++;
      countsByLanguage[language]++;
      continue;
    }

    if (category === "robot_model") {
      const canonicalName = (r.canonical_name || r.title || "").trim();
      const country = (r.country || "").trim();
      if (!isEligiblePublicRobot(canonicalName) || (country && country.toLowerCase() !== "thailand")) {
        excludedCount++;
        continue;
      }

      const rawDesc = r.description || r.evidence_excerpt || "";
      const { cleanedText, isPlaceholderOmitted, isTruncated } = cleanSearchText(rawDesc);
      const isTitleOnly = isPlaceholderOmitted || cleanedText.length === 0;
      const body = cleanedText;
      const fullTextForLang = `${canonicalName} ${body}`;
      const language = detectLanguage(fullTextForLang);
      const url = r.url ? r.url.trim() : null;
      const typedId = `robot:seed-${idx}`;
      const groupId = url || typedId;

      const metadata: Record<string, unknown> = {
        manufacturer: r.organization || undefined,
        countryOfOrigin: r.country || undefined,
        robotType: r.robot_type || undefined,
        embodimentLevel: r.embodiment_level || undefined,
        firstSeenYear: r.published_at ? new Date(r.published_at).getFullYear() : undefined
      };

      const contentHash = computeContentHash({
        typedId,
        title: canonicalName,
        body,
        url,
        metadata
      });

      const dependencyHash = computeDependencyHash(null);

      const evidence: SearchEvidence[] = [
        createSearchEvidence({
          fieldName: isTitleOnly ? "canonical_name" : "description",
          originalText: isTitleOnly ? canonicalName : rawDesc,
          label: isTitleOnly ? "Robot Catalog Name" : "Robot Description",
          isTitleOnly,
          isTruncated
        })
      ];

      const retrievalText = [
        canonicalName,
        r.organization,
        r.country,
        r.robot_type,
        r.embodiment_level,
        body
      ]
        .filter(Boolean)
        .join(" ")
        .trim();

      const doc: SearchDocument = {
        typedId,
        kind: "robot",
        title: canonicalName,
        body,
        retrievalText,
        url,
        groupId,
        origin: "public_catalog",
        language,
        isTitleOnly,
        isPartial: isTruncated,
        parentTypedId: null,
        contentHash,
        dependencyHash,
        vectorRow: null,
        evidence,
        metadata
      };

      documents.push(doc);
      countsByKind.robot++;
      countsByLanguage[language]++;
      continue;
    }

    if (category === "contribution") {
      const contributionData = {
        visibility: "public",
        verificationStatus: "APPROVED",
        sourceUrl: r.url
      };

      if (!isEligiblePublicContribution(contributionData)) {
        excludedCount++;
        continue;
      }

      const title = (r.title || "").trim();
      const rawDesc = r.description || r.evidence_excerpt || "";
      const { cleanedText, isPlaceholderOmitted, isTruncated } = cleanSearchText(rawDesc);
      const isTitleOnly = isPlaceholderOmitted || cleanedText.length === 0;
      const body = cleanedText;
      const fullTextForLang = `${title} ${body}`;
      const language = detectLanguage(fullTextForLang);
      const url = r.url ? r.url.trim() : null;
      const typedId = `contribution:seed-${idx}`;
      const groupId = url || typedId;

      const metadata: Record<string, unknown> = {
        contributorName: r.author || undefined,
        organization: r.organization || undefined,
        contributionType: r.contribution_type || undefined,
        license: "unknown"
      };

      const contentHash = computeContentHash({
        typedId,
        title,
        body,
        url,
        metadata
      });

      const dependencyHash = computeDependencyHash(null);

      const evidence: SearchEvidence[] = [
        createSearchEvidence({
          fieldName: isTitleOnly ? "title" : "description",
          originalText: isTitleOnly ? title : rawDesc,
          label: isTitleOnly ? "Contribution Title" : "Contribution Description",
          isTitleOnly,
          isTruncated
        })
      ];

      const retrievalText = [title, r.author, r.organization, r.contribution_type, body]
        .filter(Boolean)
        .join(" ")
        .trim();

      const doc: SearchDocument = {
        typedId,
        kind: "contribution",
        title,
        body,
        retrievalText,
        url,
        groupId,
        origin: "approved_community",
        language,
        isTitleOnly,
        isPartial: isTruncated,
        parentTypedId: null,
        contentHash,
        dependencyHash,
        vectorRow: null,
        evidence,
        metadata
      };

      documents.push(doc);
      countsByKind.contribution++;
      countsByLanguage[language]++;
      continue;
    }

    if (category === "perspective_annotation") {
      const theme = r.perspective_theme || "unclear";
      const target = r.subject || r.canonical_name || "humanoid/social robotics";
      const title = `${theme}: ${target}`;
      const rawExcerpt = r.evidence_excerpt || r.description || "";
      const { cleanedText, isPlaceholderOmitted, isTruncated } = cleanSearchText(rawExcerpt);
      const isTitleOnly = isPlaceholderOmitted || cleanedText.length === 0;
      const body = cleanedText;
      const fullTextForLang = `${title} ${body}`;
      const language = detectLanguage(fullTextForLang);
      const url = r.url ? r.url.trim() : null;
      const typedId = `perspective:seed-${idx}`;
      const parentTypedId = (url && urlToSourceTypedId.get(url)) || null;
      const groupId = url || typedId;

      const metadata: Record<string, unknown> = {
        stance: r.stance || "unclear",
        sentiment: r.sentiment || "unclear",
        perspectiveTheme: theme,
        targetEntity: target,
        parentTitle: r.title || undefined,
        method: "seed_annotation"
      };

      const contentHash = computeContentHash({
        typedId,
        title,
        body,
        url,
        metadata
      });

      const dependencyHash = computeDependencyHash(parentTypedId, parentTypedId ? "ACCEPTED" : "");

      const evidence: SearchEvidence[] = [
        createSearchEvidence({
          fieldName: isTitleOnly ? "perspective_theme" : "evidence_excerpt",
          originalText: isTitleOnly ? title : rawExcerpt,
          label: isTitleOnly ? "Perspective Theme" : "Perspective Evidence",
          isTitleOnly,
          isTruncated
        })
      ];

      const retrievalText = [
        title,
        r.stance,
        r.sentiment,
        theme,
        target,
        r.title,
        body
      ]
        .filter(Boolean)
        .join(" ")
        .trim();

      const doc: SearchDocument = {
        typedId,
        kind: "perspective",
        title,
        body,
        retrievalText,
        url,
        groupId,
        origin: "seed",
        language,
        isTitleOnly,
        isPartial: isTruncated,
        parentTypedId,
        contentHash,
        dependencyHash,
        vectorRow: null,
        evidence,
        metadata
      };

      documents.push(doc);
      countsByKind.perspective++;
      countsByLanguage[language]++;
      continue;
    }

    if (category === "triplet_relation") {
      const subject = (r.subject || "").trim();
      const relation = (r.relation || "").trim();
      const object = (r.object || "").trim();

      if (!subject || !relation || !object) {
        excludedCount++;
        continue;
      }

      const title = `${subject} ${relation} ${object}`;
      const body = `${subject} - ${relation} -> ${object}`;
      const fullTextForLang = `${title} ${body}`;
      const language = detectLanguage(fullTextForLang);
      const url = r.url ? r.url.trim() : null;
      const typedId = `relationship:seed-${idx}`;
      const parentTypedId = (url && urlToSourceTypedId.get(url)) || null;
      const groupId = url || typedId;

      const metadata: Record<string, unknown> = {
        subject,
        relation,
        object,
        confidence: r.confidence ?? 0.5,
        sourceTitle: r.title || undefined
      };

      const contentHash = computeContentHash({
        typedId,
        title,
        body,
        url,
        metadata
      });

      const dependencyHash = computeDependencyHash(parentTypedId, parentTypedId ? "ACCEPTED" : "");

      const evidence: SearchEvidence[] = [
        createSearchEvidence({
          fieldName: "relation",
          originalText: title,
          label: "Structured Relation",
          isTitleOnly: false,
          isTruncated: false
        })
      ];

      const retrievalText = [title, r.title, body].filter(Boolean).join(" ").trim();

      const doc: SearchDocument = {
        typedId,
        kind: "relationship",
        title,
        body,
        retrievalText,
        url,
        groupId,
        origin: "seed",
        language,
        isTitleOnly: false,
        isPartial: false,
        parentTypedId,
        contentHash,
        dependencyHash,
        vectorRow: null,
        evidence,
        metadata
      };

      documents.push(doc);
      countsByKind.relationship++;
      countsByLanguage[language]++;
      continue;
    }

    excludedCount++;
  }

  // Identify empty kinds (inventory and unverified entities are excluded from this release)
  const emptyKinds: SearchRecordKind[] = (
    Object.keys(countsByKind) as SearchRecordKind[]
  ).filter((kind) => countsByKind[kind] === 0);

  // Compute SHA-256 of all exported documents
  const documentsJson = JSON.stringify(documents);
  const recordsSha256 = createHash("sha256").update(documentsJson).digest("hex");

  const manifest: SearchExportManifest = {
    manifestVersion: "1.0",
    datasetId,
    releaseId,
    generatedAt: new Date().toISOString(),
    counts: {
      totalEligible: documents.length,
      byKind: countsByKind,
      byLanguage: countsByLanguage,
      excluded: excludedCount,
      emptyKinds
    },
    policy: {
      permittedOrigins: PERMITTED_ORIGINS,
      maxBodyCodePoints: MAX_BODY_CODE_POINTS,
      omittedPlaceholders: KNOWN_PLACEHOLDERS,
      publicFieldsByKind: PUBLIC_FIELDS_BY_KIND,
      excludedFields: STRICTLY_EXCLUDED_FIELDS
    },
    files: {
      documents: "documents.json",
      probeSample128: "probe-128.json"
    },
    recordsSha256
  };

  const probe128 = createProbeSample(documents, 128);

  return { documents, manifest, probe128 };
}

/**
 * Direct paginated Prisma reader for live database export.
 */
export async function exportSearchCorpusFromDb(
  prisma: any,
  datasetId: string = "thailand-humanoid-atlas-db",
  releaseId: string = "search-v1-keyword"
): Promise<ExportResult> {
  const documents: SearchDocument[] = [];
  let excludedCount = 0;

  const countsByKind: Record<SearchRecordKind, number> = {
    source: 0,
    robot: 0,
    contribution: 0,
    perspective: 0,
    inventory: 0,
    relationship: 0,
    entity: 0
  };

  const countsByLanguage: Record<LanguageTag, number> = {
    th: 0,
    en: 0,
    mixed: 0,
    unknown: 0
  };

  // 1. Paginated Sources
  let lastSourceId: string | undefined = undefined;
  const pageSize = 500;
  while (true) {
    const page: any[] = await prisma.sourceRecord.findMany({
      where: { relevanceStatus: "ACCEPTED" },
      take: pageSize,
      skip: lastSourceId ? 1 : 0,
      cursor: lastSourceId ? { id: lastSourceId } : undefined,
      orderBy: { id: "asc" }
    });

    if (page.length === 0) break;
    lastSourceId = page[page.length - 1].id;

    for (const record of page) {
      const platform = (record.platform || "web").toLowerCase();
      const origin = isPermittedOrigin(platform) ? platform : "web";
      const title = (record.title || "").trim();
      const { cleanedText, isPlaceholderOmitted, isTruncated } = cleanSearchText(record.excerpt);
      const isTitleOnly = isPlaceholderOmitted || cleanedText.length === 0;
      const body = cleanedText;
      const fullText = `${title} ${body}`;
      const language = detectLanguage(fullText);
      const url = record.url ? record.url.trim() : null;
      const typedId = `source:${record.id}`;
      const groupId = url || typedId;

      const metadata: Record<string, unknown> = {
        author: record.author || undefined,
        platform: record.platform || undefined,
        publishedAt: record.publishedAt ? record.publishedAt.toISOString() : undefined
      };

      const contentHash = computeContentHash({
        typedId,
        title,
        body,
        url,
        metadata
      });

      const dependencyHash = computeDependencyHash(null);

      const evidence: SearchEvidence[] = [
        createSearchEvidence({
          fieldName: isTitleOnly ? "title" : "excerpt",
          originalText: isTitleOnly ? title : record.excerpt,
          label: isTitleOnly ? "Source Title" : "Substantive Excerpt",
          isTitleOnly,
          isTruncated
        })
      ];

      const retrievalText = [title, record.author, record.platform, body]
        .filter(Boolean)
        .join(" ")
        .trim();

      const doc: SearchDocument = {
        typedId,
        kind: "source",
        title,
        body,
        retrievalText,
        url,
        groupId,
        origin,
        language,
        isTitleOnly,
        isPartial: isTruncated,
        parentTypedId: null,
        contentHash,
        dependencyHash,
        vectorRow: null,
        evidence,
        metadata
      };

      documents.push(doc);
      countsByKind.source++;
      countsByLanguage[language]++;
    }
  }

  // 2. Robots
  const robots = await prisma.robotModel.findMany({
    orderBy: { id: "asc" }
  });

  for (const robot of robots) {
    if (!isEligiblePublicRobot(robot.canonicalName)) {
      excludedCount++;
      continue;
    }

    const { cleanedText, isPlaceholderOmitted, isTruncated } = cleanSearchText(robot.description);
    const isTitleOnly = isPlaceholderOmitted || cleanedText.length === 0;
    const body = cleanedText;
    const fullText = `${robot.canonicalName} ${body}`;
    const language = detectLanguage(fullText);
    const url = robot.officialUrl ? robot.officialUrl.trim() : null;
    const typedId = `robot:${robot.id}`;
    const groupId = url || typedId;

    const metadata: Record<string, unknown> = {
      manufacturer: robot.manufacturer || undefined,
      developerOrg: robot.developerOrg || undefined,
      countryOfOrigin: robot.countryOfOrigin || undefined,
      robotType: robot.robotType || undefined,
      embodimentLevel: robot.embodimentLevel || undefined,
      firstSeenYear: robot.firstSeenYear || undefined
    };

    const contentHash = computeContentHash({
      typedId,
      title: robot.canonicalName,
      body,
      url,
      metadata
    });

    const dependencyHash = computeDependencyHash(null);

    const evidence: SearchEvidence[] = [
      createSearchEvidence({
        fieldName: isTitleOnly ? "canonicalName" : "description",
        originalText: isTitleOnly ? robot.canonicalName : robot.description,
        label: isTitleOnly ? "Robot Catalog Name" : "Robot Description",
        isTitleOnly,
        isTruncated
      })
    ];

    const retrievalText = [
      robot.canonicalName,
      robot.manufacturer,
      robot.developerOrg,
      robot.countryOfOrigin,
      robot.robotType,
      body
    ]
      .filter(Boolean)
      .join(" ")
      .trim();

    const doc: SearchDocument = {
      typedId,
      kind: "robot",
      title: robot.canonicalName,
      body,
      retrievalText,
      url,
      groupId,
      origin: "public_catalog",
      language,
      isTitleOnly,
      isPartial: isTruncated,
      parentTypedId: null,
      contentHash,
      dependencyHash,
      vectorRow: null,
      evidence,
      metadata
    };

    documents.push(doc);
    countsByKind.robot++;
    countsByLanguage[language]++;
  }

  // 3. Contributions
  const contributions = await prisma.contribution.findMany({
    where: {
      visibility: "public",
      verificationStatus: "APPROVED"
    },
    include: { relatedRobotModel: true },
    orderBy: { id: "asc" }
  });

  for (const contrib of contributions) {
    if (!isEligiblePublicContribution(contrib)) {
      excludedCount++;
      continue;
    }
    if (contrib.relatedRobotModel && !isEligiblePublicRobot(contrib.relatedRobotModel.canonicalName)) {
      excludedCount++;
      continue;
    }

    const title = (contrib.title || "").trim();
    const { cleanedText, isPlaceholderOmitted, isTruncated } = cleanSearchText(contrib.description);
    const isTitleOnly = isPlaceholderOmitted || cleanedText.length === 0;
    const body = cleanedText;
    const fullText = `${title} ${body}`;
    const language = detectLanguage(fullText);
    const url = contrib.sourceUrl ? contrib.sourceUrl.trim() : null;
    const typedId = `contribution:${contrib.id}`;
    const groupId = url || typedId;

    const metadata: Record<string, unknown> = {
      contributorName: contrib.contributorName || undefined,
      organization: contrib.organization || undefined,
      contributionType: contrib.contributionType || undefined,
      license: contrib.license || undefined
    };

    const contentHash = computeContentHash({
      typedId,
      title,
      body,
      url,
      metadata
    });

    const dependencyHash = computeDependencyHash(
      contrib.relatedRobotModelId ? `robot:${contrib.relatedRobotModelId}` : null
    );

    const evidence: SearchEvidence[] = [
      createSearchEvidence({
        fieldName: isTitleOnly ? "title" : "description",
        originalText: isTitleOnly ? contrib.title : contrib.description,
        label: isTitleOnly ? "Contribution Title" : "Contribution Description",
        isTitleOnly,
        isTruncated
      })
    ];

    const retrievalText = [
      contrib.title,
      contrib.contributorName,
      contrib.organization,
      contrib.contributionType,
      body
    ]
      .filter(Boolean)
      .join(" ")
      .trim();

    const doc: SearchDocument = {
      typedId,
      kind: "contribution",
      title,
      body,
      retrievalText,
      url,
      groupId,
      origin: "approved_community",
      language,
      isTitleOnly,
      isPartial: isTruncated,
      parentTypedId: contrib.relatedRobotModelId ? `robot:${contrib.relatedRobotModelId}` : null,
      contentHash,
      dependencyHash,
      vectorRow: null,
      evidence,
      metadata
    };

    documents.push(doc);
    countsByKind.contribution++;
    countsByLanguage[language]++;
  }

  // 4. Perspectives
  const perspectives = await prisma.perspectiveAnnotation.findMany({
    where: {
      source: { relevanceStatus: "ACCEPTED" }
    },
    include: { source: true },
    orderBy: { id: "asc" }
  });

  for (const pers of perspectives) {
    if (!pers.source || pers.source.relevanceStatus !== "ACCEPTED") {
      excludedCount++;
      continue;
    }

    const title = `${pers.perspectiveTheme}: ${pers.targetEntity}`;
    const { cleanedText, isPlaceholderOmitted, isTruncated } = cleanSearchText(pers.evidenceExcerpt);
    const isTitleOnly = isPlaceholderOmitted || cleanedText.length === 0;
    const body = cleanedText;
    const fullText = `${title} ${body}`;
    const language = detectLanguage(fullText);
    const url = pers.source.url ? pers.source.url.trim() : null;
    const typedId = `perspective:${pers.id}`;
    const parentTypedId = `source:${pers.sourceId}`;
    const groupId = url || typedId;

    const metadata: Record<string, unknown> = {
      stance: pers.stance,
      sentiment: pers.sentiment,
      method: pers.method,
      perspectiveTheme: pers.perspectiveTheme,
      targetEntity: pers.targetEntity,
      parentTitle: pers.source.title
    };

    const contentHash = computeContentHash({
      typedId,
      title,
      body,
      url,
      metadata
    });

    const dependencyHash = computeDependencyHash(parentTypedId, pers.source.relevanceStatus);

    const evidence: SearchEvidence[] = [
      createSearchEvidence({
        fieldName: isTitleOnly ? "perspectiveTheme" : "evidenceExcerpt",
        originalText: isTitleOnly ? title : pers.evidenceExcerpt,
        label: isTitleOnly ? "Perspective Theme" : "Perspective Evidence",
        isTitleOnly,
        isTruncated
      })
    ];

    const retrievalText = [
      title,
      pers.stance,
      pers.sentiment,
      pers.perspectiveTheme,
      pers.targetEntity,
      pers.source.title,
      body
    ]
      .filter(Boolean)
      .join(" ")
      .trim();

    const doc: SearchDocument = {
      typedId,
      kind: "perspective",
      title,
      body,
      retrievalText,
      url,
      groupId,
      origin: "seed",
      language,
      isTitleOnly,
      isPartial: isTruncated,
      parentTypedId,
      contentHash,
      dependencyHash,
      vectorRow: null,
      evidence,
      metadata
    };

    documents.push(doc);
    countsByKind.perspective++;
    countsByLanguage[language]++;
  }

  // 5. Inventory (Explicitly Public only)
  const inventoryItems = await prisma.ownedInventory.findMany({
    where: { visibility: "public" },
    include: { robotModel: true },
    orderBy: { id: "asc" }
  });

  for (const item of inventoryItems) {
    if (item.robotModel && !isEligiblePublicRobot(item.robotModel.canonicalName)) {
      excludedCount++;
      continue;
    }

    const title = item.displayName;
    const body = `${item.ownershipStatus} ${item.conditionStatus ?? ""}`.trim();
    const fullText = `${title} ${body}`;
    const language = detectLanguage(fullText);
    const typedId = `inventory:${item.id}`;
    const parentTypedId = item.robotModelId ? `robot:${item.robotModelId}` : null;
    const groupId = typedId;

    const metadata: Record<string, unknown> = {
      ownershipStatus: item.ownershipStatus,
      conditionStatus: item.conditionStatus || undefined,
      ownerOrg: item.ownerOrg || undefined,
      robotModelName: item.robotModel?.canonicalName || undefined
    };

    const contentHash = computeContentHash({
      typedId,
      title,
      body,
      url: null,
      metadata
    });

    const dependencyHash = computeDependencyHash(parentTypedId);

    const evidence: SearchEvidence[] = [
      createSearchEvidence({
        fieldName: "displayName",
        originalText: title,
        label: "Public Inventory Item",
        isTitleOnly: false,
        isTruncated: false
      })
    ];

    const doc: SearchDocument = {
      typedId,
      kind: "inventory",
      title,
      body,
      retrievalText: `${title} ${body}`,
      url: null,
      groupId,
      origin: "public_catalog",
      language,
      isTitleOnly: false,
      isPartial: false,
      parentTypedId,
      contentHash,
      dependencyHash,
      vectorRow: null,
      evidence,
      metadata
    };

    documents.push(doc);
    countsByKind.inventory++;
    countsByLanguage[language]++;
  }

  // 6. Relationships (Triplets)
  const triplets = await prisma.triplet.findMany({
    where: {
      OR: [
        { source: { relevanceStatus: "ACCEPTED" } },
        { sourceId: null }
      ]
    },
    include: { source: true },
    orderBy: { id: "asc" }
  });

  for (const trip of triplets) {
    const title = `${trip.subject} ${trip.relation} ${trip.object}`;
    const body = `${trip.subject} - ${trip.relation} -> ${trip.object}`;
    const fullText = `${title} ${body}`;
    const language = detectLanguage(fullText);
    const url = trip.source?.url ? trip.source.url.trim() : null;
    const typedId = `relationship:${trip.id}`;
    const parentTypedId = trip.sourceId ? `source:${trip.sourceId}` : null;
    const groupId = url || typedId;

    const metadata: Record<string, unknown> = {
      subject: trip.subject,
      relation: trip.relation,
      object: trip.object,
      confidence: trip.confidence,
      sourceTitle: trip.source?.title || undefined
    };

    const contentHash = computeContentHash({
      typedId,
      title,
      body,
      url,
      metadata
    });

    const dependencyHash = computeDependencyHash(
      parentTypedId,
      trip.source?.relevanceStatus ?? ""
    );

    const evidence: SearchEvidence[] = [
      createSearchEvidence({
        fieldName: "relation",
        originalText: title,
        label: "Structured Relation",
        isTitleOnly: false,
        isTruncated: false
      })
    ];

    const retrievalText = [title, trip.source?.title, body].filter(Boolean).join(" ").trim();

    const doc: SearchDocument = {
      typedId,
      kind: "relationship",
      title,
      body,
      retrievalText,
      url,
      groupId,
      origin: "seed",
      language,
      isTitleOnly: false,
      isPartial: false,
      parentTypedId,
      contentHash,
      dependencyHash,
      vectorRow: null,
      evidence,
      metadata
    };

    documents.push(doc);
    countsByKind.relationship++;
    countsByLanguage[language]++;
  }

  // 7. Entities
  const entities = await prisma.entity.findMany({
    orderBy: { id: "asc" }
  });

  for (const ent of entities) {
    const title = ent.name;
    const body = ent.entityType;
    const fullText = `${title} ${body}`;
    const language = detectLanguage(fullText);
    const typedId = `entity:${ent.id}`;
    const groupId = typedId;

    const metadata: Record<string, unknown> = {
      entityType: ent.entityType,
      canonicalKey: ent.canonicalKey
    };

    const contentHash = computeContentHash({
      typedId,
      title,
      body,
      url: null,
      metadata
    });

    const dependencyHash = computeDependencyHash(null);

    const evidence: SearchEvidence[] = [
      createSearchEvidence({
        fieldName: "name",
        originalText: title,
        label: "Verified Entity Name",
        isTitleOnly: true,
        isTruncated: false
      })
    ];

    const doc: SearchDocument = {
      typedId,
      kind: "entity",
      title,
      body,
      retrievalText: `${title} ${body}`,
      url: null,
      groupId,
      origin: "seed",
      language,
      isTitleOnly: true,
      isPartial: false,
      parentTypedId: null,
      contentHash,
      dependencyHash,
      vectorRow: null,
      evidence,
      metadata
    };

    documents.push(doc);
    countsByKind.entity++;
    countsByLanguage[language]++;
  }

  const emptyKinds: SearchRecordKind[] = (
    Object.keys(countsByKind) as SearchRecordKind[]
  ).filter((kind) => countsByKind[kind] === 0);

  const documentsJson = JSON.stringify(documents);
  const recordsSha256 = createHash("sha256").update(documentsJson).digest("hex");

  const manifest: SearchExportManifest = {
    manifestVersion: "1.0",
    datasetId,
    releaseId,
    generatedAt: new Date().toISOString(),
    counts: {
      totalEligible: documents.length,
      byKind: countsByKind,
      byLanguage: countsByLanguage,
      excluded: excludedCount,
      emptyKinds
    },
    policy: {
      permittedOrigins: PERMITTED_ORIGINS,
      maxBodyCodePoints: MAX_BODY_CODE_POINTS,
      omittedPlaceholders: KNOWN_PLACEHOLDERS,
      publicFieldsByKind: PUBLIC_FIELDS_BY_KIND,
      excludedFields: STRICTLY_EXCLUDED_FIELDS
    },
    files: {
      documents: "documents.json",
      probeSample128: "probe-128.json"
    },
    recordsSha256
  };

  const probe128 = createProbeSample(documents, 128);

  return { documents, manifest, probe128 };
}

/**
 * Universal exporter: Uses DB if connected, otherwise falls back to seed corpus.
 */
export async function exportSearchCorpus(
  options?: ExportOptions
): Promise<ExportResult> {
  if (options?.prisma) {
    try {
      return await exportSearchCorpusFromDb(
        options.prisma,
        options.datasetId,
        options.releaseId
      );
    } catch (err) {
      console.warn("Prisma database export unavailable, falling back to seed corpus:", err);
      // Fallback to seed export when database is unavailable
    }
  }

  return exportSearchCorpusFromSeed(
    options?.seedPath,
    options?.datasetId,
    options?.releaseId
  );
}
