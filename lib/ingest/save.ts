import type { NormalizedSource } from "@/lib/ingest/types";
import { prisma } from "@/lib/prisma";
import { Prisma } from "../../generated/prisma";
import {
  classifyRelevance,
  extractPerspective,
  classifyWithGemini,
  classifyCalibratedRelevance,
  extractCalibratedPerspective,
  evaluateEvidenceSufficiency
} from "@/lib/classifiers";
import { canonicalizeUrl } from "@/lib/url";
import { enrichRawMetaWithNetworkGeo } from "@/lib/geo";

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
        const sufficiency = evaluateEvidenceSufficiency(record.title, record.excerpt ?? "");
        const isSufficient = sufficiency === "sufficient";
        const isHighConfidence = (geminiResult.relevanceConfidence ?? 0) >= 0.80;

        if (!isSufficient) {
          relevance = {
            relevanceStatus: "UNCERTAIN",
            relevanceReason: `Machine suggestion requires human review: insufficient evidence (${sufficiency}).`,
            relevanceConfidence: Math.min(geminiResult.relevanceConfidence ?? 0.5, 0.45)
          };
        } else if (!isHighConfidence && geminiResult.isRelevant) {
          relevance = {
            relevanceStatus: "UNCERTAIN",
            relevanceReason: `Machine suggestion requires human review: low confidence (${geminiResult.relevanceConfidence}).`,
            relevanceConfidence: geminiResult.relevanceConfidence
          };
        } else {
          relevance = {
            relevanceStatus: geminiResult.isRelevant ? "ACCEPTED" : "REJECTED",
            relevanceReason: geminiResult.relevanceReason,
            relevanceConfidence: geminiResult.relevanceConfidence
          };
        }

        if (relevance.relevanceStatus === "ACCEPTED") {
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
        console.error("Gemini classification failed, falling back to calibrated rules:", error);
        const calibrated = classifyCalibratedRelevance(record.title, record.excerpt ?? "");
        relevance = {
          relevanceStatus: calibrated.relevanceStatus,
          relevanceReason: `[fallback:rules] ${calibrated.relevanceReason}`,
          relevanceConfidence: calibrated.calibratedConfidence
        };
        if (calibrated.autoPublishEligible) {
          const pers = extractCalibratedPerspective(record.title, record.excerpt ?? "");
          annotation = { ...pers, method: "rules_fallback" };
        }
      }
    } else {
      const calibrated = classifyCalibratedRelevance(record.title, record.excerpt ?? "");
      relevance = {
        relevanceStatus: calibrated.relevanceStatus,
        relevanceReason: calibrated.relevanceReason,
        relevanceConfidence: calibrated.calibratedConfidence
      };
      if (calibrated.autoPublishEligible) {
        const pers = extractCalibratedPerspective(record.title, record.excerpt ?? "");
        annotation = { ...pers, method: "rules_with_evidence" };
      }
    }

    const source = await prisma.sourceRecord.upsert({
      where: { url },
      create: {
        sourceType: record.sourceType,
        title: record.title,
        url,
        excerpt: record.excerpt ?? "",
        publishedAt: record.publishedAt,
        author: record.author,
        platform: record.platform,
        rawMeta: rawMeta as Prisma.InputJsonValue,
        ...relevance
      },
      update: {
        title: record.title,
        excerpt: record.excerpt ?? "",
        publishedAt: record.publishedAt,
        author: record.author,
        platform: record.platform,
        rawMeta: rawMeta as Prisma.InputJsonValue,
        ...relevance
      }
    });

    if (relevance.relevanceStatus === "ACCEPTED" && annotation) {
      await prisma.perspectiveAnnotation.upsert({
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
          await prisma.triplet.upsert({
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
    }

    saved += 1;
  }

  return saved;
}
