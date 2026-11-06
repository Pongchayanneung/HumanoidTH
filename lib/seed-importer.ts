import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma, PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { canonicalizeUrl } from "./url";
import { assertSeedAllowed } from "./seed-guard";

export type SeedRecord = {
  category: string;
  title: string;
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
  url: string;
  source_platform: string | null;
  published_at: string | null;
  author: string | null;
  confidence: number | null;
  evidence_excerpt: string | null;
  notes: string | null;
};

function parsePublishedAt(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeSourceType(platform: string | null) {
  switch (platform) {
    case "gdelt":
      return "GDELT";
    case "official_company_website":
    case "company_blog":
    case "company_event_page":
    case "company_technical_blog":
    case "government_agency_website":
    case "government_portal":
    case "university_news":
    case "university_project_page":
    case "university_research_website":
    case "news":
      return "WEB";
    default:
      return "WEB";
  }
}

export function createSeedClient() {
  const connectionString = process.env.DATABASE_URL;
  assertSeedAllowed(connectionString);
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for seeding.");
  }

  return new PrismaClient({
    adapter: new PrismaPg(connectionString)
  });
}

export async function seedAtlasData(prisma: PrismaClient, datasetPath = resolve(process.cwd(), "thailand_humanoid_atlas_seed_records.json")) {
  const records = JSON.parse(readFileSync(datasetPath, "utf8")) as SeedRecord[];

  await prisma.user.upsert({
    where: { email: "creativelab.co.th@gmail.com" },
    update: { name: "CreativeLabTH Group", role: "ADMIN" },
    create: { email: "creativelab.co.th@gmail.com", name: "CreativeLabTH Group", role: "ADMIN" }
  });

  const dinsaw = await prisma.robotModel.upsert({
    where: { canonicalName: "Dinsaw Robot" },
    update: {},
    create: {
      canonicalName: "Dinsaw Robot",
      manufacturer: "CT Asia Robotics",
      developerOrg: "CT Asia Robotics",
      countryOfOrigin: "Thailand",
      robotType: "social_service_robot",
      embodimentLevel: "mobile_screen_based_robot",
      primaryUseCase: "eldercare and hospital assistance",
      thailandStatus: "developed_in_thailand",
      statusConfidence: 0.7,
      description: "Thai eldercare and service robot seed record requiring source verification."
    }
  });

  await prisma.robotModel.upsert({
    where: { canonicalName: "NAO" },
    update: {},
    create: {
      canonicalName: "NAO",
      manufacturer: "SoftBank Robotics",
      countryOfOrigin: "France",
      robotType: "humanoid_full_body",
      embodimentLevel: "full_body_humanoid",
      primaryUseCase: "education and HRI research",
      thailandStatus: "observed_in_thailand",
      statusConfidence: 0.45,
      description: "Imported humanoid platform often used in education and research; Thailand-specific usage requires record evidence."
    }
  });

  await prisma.contribution.upsert({
    where: { sourceUrl: "seed:contribution:thai-hri-research" },
    update: {},
    create: {
      title: "Thai HRI research seed",
      contributionType: "research_paper",
      contributorType: "research_group",
      organization: "Thai university lab",
      description: "Placeholder contribution for Thai human-robot interaction research.",
      sourceUrl: "seed:contribution:thai-hri-research",
      relatedRobotModelId: dinsaw.id,
      verificationStatus: "NEEDS_REVIEW"
    }
  });

  for (const record of records) {
    if (record.category === "source_record") {
      const url = canonicalizeUrl(record.url);
      await prisma.sourceRecord.upsert({
        where: { url },
        create: {
          sourceType: normalizeSourceType(record.source_platform),
          title: record.title,
          url,
          excerpt: record.evidence_excerpt ?? record.description ?? "",
          publishedAt: parsePublishedAt(record.published_at),
          author: record.author,
          platform: record.source_platform,
          rawMeta: {
            category: record.category,
            canonicalName: record.canonical_name,
            organization: record.organization,
            country: record.country,
            robotType: record.robot_type,
            embodimentLevel: record.embodiment_level,
            notes: record.notes,
            confidence: record.confidence
          } as Prisma.InputJsonValue,
          relevanceStatus: "ACCEPTED",
          relevanceReason: record.notes ?? "Imported from labeled seed dataset.",
          relevanceConfidence: record.confidence ?? 0.5
        },
        update: {
          title: record.title,
          excerpt: record.evidence_excerpt ?? record.description ?? "",
          publishedAt: parsePublishedAt(record.published_at),
          author: record.author,
          platform: record.source_platform,
          rawMeta: {
            category: record.category,
            canonicalName: record.canonical_name,
            organization: record.organization,
            country: record.country,
            robotType: record.robot_type,
            embodimentLevel: record.embodiment_level,
            notes: record.notes,
            confidence: record.confidence
          } as Prisma.InputJsonValue,
          relevanceStatus: "ACCEPTED",
          relevanceReason: record.notes ?? "Imported from labeled seed dataset.",
          relevanceConfidence: record.confidence ?? 0.5
        }
      });
      continue;
    }

    if (record.category === "robot_model") {
      const officialUrl = canonicalizeUrl(record.url);
      await prisma.robotModel.upsert({
        where: { canonicalName: record.canonical_name ?? record.title },
        create: {
          canonicalName: record.canonical_name ?? record.title,
          manufacturer: record.organization,
          developerOrg: record.organization,
          countryOfOrigin: record.country,
          robotType: record.robot_type ?? "unknown",
          embodimentLevel: record.embodiment_level,
          primaryUseCase: record.notes ?? record.description ?? null,
          thailandStatus: "observed_in_thailand",
          statusConfidence: record.confidence ?? 0.5,
          officialUrl,
          description: record.description ?? record.evidence_excerpt ?? null,
          sourceMeta: {
            category: record.category,
            title: record.title,
            sourcePlatform: record.source_platform
          } as Prisma.InputJsonValue,
          firstSeenYear: record.published_at ? new Date(record.published_at).getFullYear() : null
        },
        update: {
          manufacturer: record.organization,
          developerOrg: record.organization,
          countryOfOrigin: record.country,
          robotType: record.robot_type ?? "unknown",
          embodimentLevel: record.embodiment_level,
          primaryUseCase: record.notes ?? record.description ?? null,
          officialUrl,
          description: record.description ?? record.evidence_excerpt ?? null,
          sourceMeta: {
            category: record.category,
            title: record.title,
            sourcePlatform: record.source_platform
          } as Prisma.InputJsonValue,
          firstSeenYear: record.published_at ? new Date(record.published_at).getFullYear() : null
        }
      });
      continue;
    }

    if (record.category === "triplet_relation") {
      const url = canonicalizeUrl(record.url);
      const source = await prisma.sourceRecord.upsert({
        where: { url },
        create: {
          sourceType: normalizeSourceType(record.source_platform),
          title: record.title,
          url,
          excerpt: record.evidence_excerpt ?? record.description ?? "",
          publishedAt: parsePublishedAt(record.published_at),
          author: record.author,
          platform: record.source_platform,
          rawMeta: {
            category: record.category,
            canonicalName: record.canonical_name,
            notes: record.notes,
            confidence: record.confidence
          } as Prisma.InputJsonValue,
          relevanceStatus: "ACCEPTED",
          relevanceReason: record.notes ?? "Imported from labeled seed dataset.",
          relevanceConfidence: record.confidence ?? 0.5
        },
        update: {
          title: record.title,
          excerpt: record.evidence_excerpt ?? record.description ?? "",
          publishedAt: parsePublishedAt(record.published_at),
          author: record.author,
          platform: record.source_platform,
          rawMeta: {
            category: record.category,
            canonicalName: record.canonical_name,
            notes: record.notes,
            confidence: record.confidence
          } as Prisma.InputJsonValue,
          relevanceStatus: "ACCEPTED",
          relevanceReason: record.notes ?? "Imported from labeled seed dataset.",
          relevanceConfidence: record.confidence ?? 0.5
        }
      });

      if (record.subject && record.relation && record.object) {
        await prisma.triplet.upsert({
          where: {
            subject_relation_object_sourceId: {
              subject: record.subject,
              relation: record.relation,
              object: record.object,
              sourceId: source.id
            }
          },
          create: {
            subject: record.subject,
            relation: record.relation,
            object: record.object,
            confidence: record.confidence ?? 0.5,
            sourceId: source.id
          },
          update: {
            confidence: record.confidence ?? 0.5
          }
        });
      }
      continue;
    }

    if (record.category === "perspective_annotation") {
      const url = canonicalizeUrl(record.url);
      const source = await prisma.sourceRecord.upsert({
        where: { url },
        create: {
          sourceType: normalizeSourceType(record.source_platform),
          title: record.title,
          url,
          excerpt: record.evidence_excerpt ?? record.description ?? "",
          publishedAt: parsePublishedAt(record.published_at),
          author: record.author,
          platform: record.source_platform,
          rawMeta: {
            category: record.category,
            canonicalName: record.canonical_name,
            organization: record.organization,
            country: record.country,
            notes: record.notes,
            confidence: record.confidence
          } as Prisma.InputJsonValue,
          relevanceStatus: "ACCEPTED",
          relevanceReason: record.notes ?? "Imported from labeled seed dataset.",
          relevanceConfidence: record.confidence ?? 0.5
        },
        update: {
          title: record.title,
          excerpt: record.evidence_excerpt ?? record.description ?? "",
          publishedAt: parsePublishedAt(record.published_at),
          author: record.author,
          platform: record.source_platform,
          rawMeta: {
            category: record.category,
            canonicalName: record.canonical_name,
            organization: record.organization,
            country: record.country,
            notes: record.notes,
            confidence: record.confidence
          } as Prisma.InputJsonValue,
          relevanceStatus: "ACCEPTED",
          relevanceReason: record.notes ?? "Imported from labeled seed dataset.",
          relevanceConfidence: record.confidence ?? 0.5
        }
      });

      if (record.perspective_theme) {
        await prisma.perspectiveAnnotation.upsert({
          where: {
            sourceId_perspectiveTheme_targetEntity_evidenceExcerpt: {
              sourceId: source.id,
              perspectiveTheme: record.perspective_theme,
              targetEntity: record.subject ?? record.canonical_name ?? "humanoid/social robotics",
              evidenceExcerpt: record.evidence_excerpt ?? record.description ?? ""
            }
          },
          create: {
            sourceId: source.id,
            stance: record.stance ?? "unclear",
            sentiment: record.sentiment ?? "unclear",
            perspectiveTheme: record.perspective_theme,
            targetEntity: record.subject ?? record.canonical_name ?? "humanoid/social robotics",
            evidenceExcerpt: record.evidence_excerpt ?? record.description ?? "",
            confidence: record.confidence ?? 0.5,
            method: "seed_json"
          },
          update: {
            stance: record.stance ?? "unclear",
            sentiment: record.sentiment ?? "unclear",
            confidence: record.confidence ?? 0.5,
            method: "seed_json"
          }
        });
      }
      continue;
    }

    if (record.category === "contribution") {
      const sourceUrl = canonicalizeUrl(record.url);
      await prisma.contribution.upsert({
        where: { sourceUrl },
        create: {
          contributorName: record.author,
          contributorType: record.organization ? "organization" : "individual",
          organization: record.organization,
          contributionType: record.contribution_type ?? "other",
          title: record.title,
          description: record.description ?? record.evidence_excerpt ?? null,
          sourceUrl,
          license: "unknown",
          visibility: "public",
          verificationStatus: "APPROVED"
        },
        update: {
          contributorName: record.author,
          contributorType: record.organization ? "organization" : "individual",
          organization: record.organization,
          contributionType: record.contribution_type ?? "other",
          title: record.title,
          description: record.description ?? record.evidence_excerpt ?? null
        }
      });
      continue;
    }

    if (record.category === "source_pull_job") {
      await prisma.sourcePullJob.create({
        data: {
          adapter: "SEED",
          query: record.title,
          status: "SUCCEEDED",
          recordsFound: 0,
          recordsSaved: 0,
          errorMessage: null,
          startedAt: record.published_at ? parsePublishedAt(record.published_at) : new Date(),
          finishedAt: new Date()
        }
      });
      continue;
    }

    if (record.category === "submission_record") {
      const url = canonicalizeUrl(record.url);
      await prisma.submittedData.create({
        data: {
          submissionType: record.contribution_type ?? "source_url",
          title: record.title,
          url,
          notes: record.notes ?? record.description ?? null,
          submitterName: record.author,
          submitterContact: null,
          status: "APPROVED",
          payloadJson: {
            category: record.category,
            canonicalName: record.canonical_name,
            confidence: record.confidence
          } as Prisma.InputJsonValue
        }
      });
    }
  }
}
