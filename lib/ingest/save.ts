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
import {
  MACHINE_ANNOTATION_METHODS,
  buildSourceSnapshot,
  type SourceClaimRecord,
  type VersionHistoryEntry
} from "@/lib/claim-versioning";

// Actors that write versions without a human reviewer.
const SYSTEM_ACTORS = ["ingest", "system", "seed"];

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
    const written = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${url}))`;
      await tx.$queryRaw`SELECT id FROM "SourceRecord" WHERE url = ${url} FOR UPDATE`;
      const previous = await tx.sourceRecord.findUnique({ where: { url }, include: { annotations: true, triplets: true } });
      const previousVersioning = (previous?.rawMeta as any)?._versioning ?? {};

      // A record last revised by a human reviewer is never silently overwritten by a crawler run.
      // Editorial updates go through updateSourceClaim with expectedVersion checks.
      const lastEditor = previousVersioning.lastUpdatedBy;
      if (previous && typeof lastEditor === "string" && !SYSTEM_ACTORS.includes(lastEditor)) {
        console.warn(`Skipping re-ingestion of ${url}: version ${previousVersioning.version ?? 1} was revised by ${lastEditor}.`);
        return false;
      }
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

      // Curated seed sources and records must never have their curated annotations or triplets deleted
      const isCuratedSource =
        source.sourceType === "SEED" ||
        Boolean((source.rawMeta as any)?.category === "triplet_relation") ||
        Boolean((source.rawMeta as any)?.source_id) ||
        Boolean((previous?.rawMeta as any)?.category === "triplet_relation") ||
        Boolean((previous?.rawMeta as any)?.source_id);

      // Clean up stale machine-generated annotations only; NEVER delete human_review or seed_json records
      await tx.perspectiveAnnotation.deleteMany({
        where: {
          sourceId: source.id,
          method: { in: MACHINE_ANNOTATION_METHODS }
        }
      });

      // Never wipe out curated seed triplets; refresh dynamic-source triplets.
      if (!isCuratedSource) {
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

      const current = await tx.sourceRecord.findUniqueOrThrow({
        where: { id: source.id }, include: { annotations: true, triplets: true }
      });
      const history: VersionHistoryEntry[] = [...(previousVersioning.history ?? [])];
      let parentSnapshotHash: string | undefined = previousVersioning.snapshotHash;
      if (previous) {
        const oldVersion = previousVersioning.version ?? 1;
        const parent = history.find((entry) => entry.version === oldVersion - 1);
        const oldSnapshot = buildSourceSnapshot(previous as SourceClaimRecord, previous.annotations, previous.triplets,
          undefined, undefined, parent?.version, parent?.snapshotHash);
        parentSnapshotHash ??= oldSnapshot.snapshotHash;
        const index = history.findIndex((entry) => entry.version === oldVersion);
        if (index >= 0) {
          if (!history[index].snapshot) history[index] = { ...history[index], snapshot: oldSnapshot };
        } else {
          history.push({ version: oldVersion, snapshot: oldSnapshot, contentHash: oldSnapshot.contentHash,
            assertionsHash: oldSnapshot.assertionsHash, snapshotHash: oldSnapshot.snapshotHash,
            relevanceStatus: oldSnapshot.relevanceStatus, actor: oldSnapshot.metadata.actor,
            reason: oldSnapshot.metadata.reason, updatedAt: oldSnapshot.metadata.timestamp });
        }
      }
      const version = previous ? (previousVersioning.version ?? 1) + 1 : 1;
      const timestamp = new Date().toISOString();
      const snapshot = buildSourceSnapshot(
        { ...current, rawMeta: { _versioning: { version, updatedAt: timestamp } } } as SourceClaimRecord,
        current.annotations, current.triplets, "ingest", `Ingest batch import (${record.sourceType})`,
        previous ? version - 1 : undefined, parentSnapshotHash
      );
      history.push({ version, snapshot, contentHash: snapshot.contentHash, assertionsHash: snapshot.assertionsHash,
        snapshotHash: snapshot.snapshotHash, relevanceStatus: snapshot.relevanceStatus, actor: "ingest",
        reason: snapshot.metadata.reason, updatedAt: timestamp });
      await tx.sourceRecord.update({ where: { id: source.id }, data: { rawMeta: JSON.parse(JSON.stringify({
        ...rawMeta, _versioning: { version, history, contentHash: snapshot.contentHash,
          assertionsHash: snapshot.assertionsHash, snapshotHash: snapshot.snapshotHash,
          status: relevance.relevanceStatus === "ACCEPTED" ? "ACTIVE" : "RETIRED",
          lastUpdatedBy: "ingest", revisionReason: snapshot.metadata.reason, updatedAt: timestamp }
      })) } });
      return true;
    });

    if (written !== false) saved += 1;
  }

  return saved;
}
