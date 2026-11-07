import type { NormalizedSource } from "@/lib/ingest/types";
import { prisma } from "@/lib/prisma";
import { Prisma } from "../../generated/prisma";
import { classifyRelevance, extractPerspective, classifyWithGemini } from "@/lib/classifiers";
import { canonicalizeUrl } from "@/lib/url";
import { enrichRawMetaWithNetworkGeo } from "@/lib/geo";
import {
  computeSourceContentHash,
  computeAssertionsHash,
  computeSnapshotHash
} from "@/lib/claim-versioning";

export async function saveSources(records: NormalizedSource[]) {
  let saved = 0;

  for (const record of records) {
    const url = canonicalizeUrl(record.url);
    const rawMeta = await enrichRawMetaWithNetworkGeo(url, record.rawMeta ?? {});
    let relevance: {
      relevanceStatus: "ACCEPTED" | "REJECTED" | "UNCERTAIN";
      relevanceReason: string;
      relevanceConfidence: number;
    };
    
    let annotation: {
      stance: string;
      sentiment: string;
      perspectiveTheme: string;
      targetEntity: string;
      evidenceExcerpt: string;
      confidence: number;
      method: string;
    } | null = null;

    let geminiResult: any = null;

    if (process.env.GEMINI_API_KEY) {
      try {
        geminiResult = await classifyWithGemini(record.title, record.excerpt ?? "");
        relevance = {
          relevanceStatus: geminiResult.isRelevant ? "ACCEPTED" : "REJECTED",
          relevanceReason: geminiResult.relevanceReason,
          relevanceConfidence: geminiResult.relevanceConfidence
        };
        if (geminiResult.isRelevant) {
          annotation = {
            stance: geminiResult.stance,
            sentiment: geminiResult.sentiment,
            perspectiveTheme: geminiResult.theme,
            targetEntity: geminiResult.targetEntity,
            evidenceExcerpt: geminiResult.evidenceExcerpt,
            confidence: geminiResult.confidence,
            method: "gemini-1.5-flash"
          };
        }
      } catch (error) {
        console.error("Gemini classification failed, falling back to rules:", error);
        relevance = classifyRelevance(record.title, record.excerpt);
        if (relevance.relevanceStatus === "ACCEPTED") {
          annotation = { ...extractPerspective(record.title, record.excerpt), method: "rules_fallback" };
        }
      }
    } else {
      relevance = classifyRelevance(record.title, record.excerpt);
      if (relevance.relevanceStatus === "ACCEPTED") {
        annotation = { ...extractPerspective(record.title, record.excerpt), method: "rules_with_evidence" };
      }
    }

    // Wrap source and derived claims in atomic transaction with identifiable versioning (T07, D06)
    await prisma.$transaction(async (tx) => {
      const existing = await tx.sourceRecord.findUnique({
        where: { url },
        select: { id: true, rawMeta: true }
      });
      const existingRawMeta = (existing?.rawMeta ?? {}) as Record<string, any>;
      const prevVersioning = existingRawMeta._versioning ?? {};
      const newVersion = (prevVersioning.version ?? 0) + 1;

      const sourceContentHash = computeSourceContentHash({
        title: record.title,
        url,
        excerpt: record.excerpt ?? "",
        sourceType: record.sourceType,
        relevanceStatus: relevance.relevanceStatus,
        relevanceReason: relevance.relevanceReason,
        relevanceConfidence: relevance.relevanceConfidence,
        author: record.author,
        platform: record.platform,
        publishedAt: record.publishedAt
      });

      const activePerspectives = relevance.relevanceStatus === "ACCEPTED" && annotation ? [annotation] : [];
      const activeTriplets = relevance.relevanceStatus === "ACCEPTED" && geminiResult?.triplets ? geminiResult.triplets : [];
      const assertionsHash = computeAssertionsHash(activePerspectives, activeTriplets);
      const snapshotHash = computeSnapshotHash(sourceContentHash, assertionsHash, newVersion, prevVersioning.snapshotHash);

      const versioningMeta = {
        version: newVersion,
        contentHash: sourceContentHash,
        assertionsHash,
        snapshotHash,
        status: relevance.relevanceStatus === "ACCEPTED" ? "ACTIVE" : "RETIRED",
        lastUpdatedBy: "ingest",
        revisionReason: `Ingest batch import (${record.sourceType})`,
        updatedAt: new Date().toISOString()
      };

      const finalRawMeta = {
        ...rawMeta,
        _versioning: versioningMeta
      };

      const source = await tx.sourceRecord.upsert({
        where: { url },
        create: {
          sourceType: record.sourceType,
          title: record.title,
          url,
          excerpt: record.excerpt ?? "",
          publishedAt: record.publishedAt,
          author: record.author,
          platform: record.platform,
          rawMeta: finalRawMeta as Prisma.InputJsonValue,
          ...relevance
        },
        update: {
          title: record.title,
          excerpt: record.excerpt ?? "",
          publishedAt: record.publishedAt,
          author: record.author,
          platform: record.platform,
          rawMeta: finalRawMeta as Prisma.InputJsonValue,
          ...relevance
        }
      });

      if (relevance.relevanceStatus === "ACCEPTED" && annotation) {
        await tx.perspectiveAnnotation.upsert({
          where: {
            sourceId_perspectiveTheme_targetEntity_evidenceExcerpt: {
              sourceId: source.id,
              perspectiveTheme: annotation.perspectiveTheme,
              targetEntity: annotation.targetEntity,
              evidenceExcerpt: annotation.evidenceExcerpt
            }
          },
          create: { sourceId: source.id, ...annotation },
          update: annotation
        });

        // Save extracted relationship triplets if available
        if (geminiResult?.triplets && geminiResult.triplets.length > 0) {
          for (const t of geminiResult.triplets) {
            await tx.triplet.upsert({
              where: {
                subject_relation_object_sourceId: {
                  subject: t.subject,
                  relation: t.relation,
                  object: t.object,
                  sourceId: source.id
                }
              },
              create: {
                subject: t.subject,
                relation: t.relation,
                object: t.object,
                confidence: t.confidence,
                sourceId: source.id
              },
              update: {
                confidence: t.confidence
              }
            });
          }
        }
      } else {
        // Finding D06 / T07: Retiring or rejecting a source atomically suppresses stale derived claims
        await tx.perspectiveAnnotation.deleteMany({
          where: { sourceId: source.id }
        });
        await tx.triplet.deleteMany({
          where: { sourceId: source.id }
        });
      }
    });

    saved += 1;
  }

  return saved;
}
