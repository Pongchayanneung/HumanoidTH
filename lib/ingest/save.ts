import type { NormalizedSource } from "@/lib/ingest/types";
import { prisma } from "@/lib/prisma";
import { Prisma } from "../../generated/prisma";
import {
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

        // Apply contradictory signal gate and calibrated relevance checks to Gemini path
        const calibratedCheck = classifyCalibratedRelevance(record.title, record.excerpt ?? "");
        const isContradictoryOrUncertain = calibratedCheck.relevanceStatus === "UNCERTAIN";
        const isCalibratedRejected = calibratedCheck.relevanceStatus === "REJECTED";

        if (!isSufficient) {
          relevance = {
            relevanceStatus: "UNCERTAIN",
            relevanceReason: `Machine suggestion requires human review: insufficient evidence (${sufficiency}).`,
            relevanceConfidence: Math.min(geminiResult.relevanceConfidence ?? 0.5, 0.45)
          };
        } else if (isContradictoryOrUncertain) {
          relevance = {
            relevanceStatus: "UNCERTAIN",
            relevanceReason: `Machine suggestion requires human review: contradictory signals or uncertain evidence (${calibratedCheck.relevanceReason}).`,
            relevanceConfidence: Math.min(geminiResult.relevanceConfidence ?? 0.65, 0.65)
          };
        } else if (geminiResult.isRelevant && isCalibratedRejected) {
          relevance = {
            relevanceStatus: "UNCERTAIN",
            relevanceReason: `Machine suggestion requires human review: conflict between model and calibrated rule (${calibratedCheck.relevanceReason}).`,
            relevanceConfidence: 0.50
          };
        } else if (!isHighConfidence) {
          // Gate both predicted classes (relevant or non-relevant) below 0.80 confidence
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

        // Only save perspective annotation if relevance is ACCEPTED and annotation confidence meets >= 0.80 threshold
        if (relevance.relevanceStatus === "ACCEPTED" && (geminiResult.confidence ?? 0) >= 0.80) {
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
          if (pers.confidence >= 0.80 && !pers.requiresHumanReview) {
            annotation = {
              stance: pers.stance,
              sentiment: pers.sentiment,
              perspectiveTheme: pers.perspectiveTheme,
              targetEntity: pers.targetEntity,
              evidenceExcerpt: pers.evidenceExcerpt,
              confidence: pers.confidence,
              method: "rules_fallback"
            };
          }
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
        if (pers.confidence >= 0.80 && !pers.requiresHumanReview) {
          annotation = {
            stance: pers.stance,
            sentiment: pers.sentiment,
            perspectiveTheme: pers.perspectiveTheme,
            targetEntity: pers.targetEntity,
            evidenceExcerpt: pers.evidenceExcerpt,
            confidence: pers.confidence,
            method: "rules_with_evidence"
          };
        }
      }
    }

    // Atomic write of source, verified perspective annotation, and relationship triplets
    await prisma.$transaction(async (tx) => {
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

      // Machine-generated annotation methods eligible for cleanup/refresh
      const MACHINE_ANNOTATION_METHODS = ["gemini-1.5-flash", "rules_fallback", "rules_with_evidence"];

      // Curated seed sources and records must never have their curated annotations or triplets deleted
      const isCuratedSource =
        source.sourceType === "SEED" ||
        Boolean((source.rawMeta as any)?.category === "triplet_relation") ||
        Boolean((source.rawMeta as any)?.source_id);

      // Clean up stale machine-generated annotations only; NEVER delete human_review or seed_json records
      await tx.perspectiveAnnotation.deleteMany({
        where: {
          sourceId: source.id,
          method: { in: MACHINE_ANNOTATION_METHODS }
        }
      });

      // Never wipe out curated seed triplets. Only refresh machine triplets on dynamic sources when replacement triplets exist
      if (!isCuratedSource && geminiResult?.triplets && geminiResult.triplets.length > 0) {
        await tx.triplet.deleteMany({
          where: {
            sourceId: source.id
          }
        });
      }

      if (relevance.relevanceStatus === "ACCEPTED" && annotation) {
        // Project schema fields strictly; omit non-schema fields like requiresHumanReview
        const annotationPayload = {
          stance: annotation.stance,
          sentiment: annotation.sentiment,
          perspectiveTheme: annotation.perspectiveTheme,
          targetEntity: annotation.targetEntity,
          evidenceExcerpt: annotation.evidenceExcerpt,
          confidence: annotation.confidence,
          method: annotation.method
        };

        await tx.perspectiveAnnotation.upsert({
          where: {
            sourceId_perspectiveTheme_targetEntity_evidenceExcerpt: {
              sourceId: source.id,
              perspectiveTheme: annotationPayload.perspectiveTheme,
              targetEntity: annotationPayload.targetEntity,
              evidenceExcerpt: annotationPayload.evidenceExcerpt
            }
          },
          create: { sourceId: source.id, ...annotationPayload },
          update: annotationPayload
        });

        // Save extracted relationship triplets if available and meeting strict runtime >= 0.80 threshold
        if (geminiResult?.triplets && geminiResult.triplets.length > 0) {
          for (const t of geminiResult.triplets) {
            // Strictly check confidence: must be a valid number >= 0.80 and <= 1.0 (no default 0.85 fallback)
            const tripletConfidence =
              typeof t?.confidence === "number" && !Number.isNaN(t.confidence)
                ? t.confidence
                : null;

            if (tripletConfidence !== null && tripletConfidence >= 0.80 && tripletConfidence <= 1.0) {
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
                  confidence: tripletConfidence,
                  sourceId: source.id
                },
                update: {
                  confidence: tripletConfidence
                }
              });
            }
          }
        }
      }
    });

    saved += 1;
  }

  return saved;
}
