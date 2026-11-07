import { isEligiblePublicRobot, isEligiblePublicContribution } from "../public-projection";
import { cleanSearchText, computeContentHash, computeDependencyHash } from "./text-utils";
import type { SearchDocument, RevalidationResult } from "./types";

/**
 * Revalidates a single SearchDocument against current database state.
 *
 * Suppresses deleted, hidden, changed records and invalid parents before display.
 */
export async function revalidateSearchDocument(
  doc: SearchDocument,
  prisma: any
): Promise<RevalidationResult> {
  if (!prisma) {
    // If no prisma client is provided, assume unverified or offline
    return { isValid: true, reason: null, currentDoc: doc };
  }

  const [kind, id] = doc.typedId.split(":");
  if (!kind || !id) {
    return { isValid: false, reason: "DELETED", currentDoc: null };
  }

  try {
    switch (doc.kind) {
      case "source": {
        const record = await prisma.sourceRecord.findUnique({
          where: { id }
        });
        if (!record) {
          return { isValid: false, reason: "DELETED", currentDoc: null };
        }
        if (record.relevanceStatus !== "ACCEPTED") {
          return { isValid: false, reason: "STATUS_INELIGIBLE", currentDoc: null };
        }

        const { cleanedText } = cleanSearchText(record.excerpt);
        const currentHash = computeContentHash({
          typedId: doc.typedId,
          title: record.title,
          body: cleanedText,
          url: record.url,
          metadata: {
            author: record.author ?? undefined,
            platform: record.platform ?? undefined,
            publishedAt: record.publishedAt ? record.publishedAt.toISOString() : undefined
          }
        });

        if (currentHash !== doc.contentHash) {
          return {
            isValid: false,
            reason: "CONTENT_CHANGED",
            currentContentHash: currentHash,
            expectedContentHash: doc.contentHash,
            currentDoc: null
          };
        }

        return { isValid: true, reason: null, currentDoc: doc };
      }

      case "robot": {
        const robot = await prisma.robotModel.findUnique({
          where: { id }
        });
        if (!robot) {
          return { isValid: false, reason: "DELETED", currentDoc: null };
        }
        if (!isEligiblePublicRobot(robot.canonicalName)) {
          return { isValid: false, reason: "ROBOT_INELIGIBLE", currentDoc: null };
        }

        const { cleanedText } = cleanSearchText(robot.description);
        const currentHash = computeContentHash({
          typedId: doc.typedId,
          title: robot.canonicalName,
          body: cleanedText,
          url: robot.officialUrl,
          metadata: {
            manufacturer: robot.manufacturer ?? undefined,
            developerOrg: robot.developerOrg ?? undefined,
            countryOfOrigin: robot.countryOfOrigin ?? undefined,
            robotType: robot.robotType ?? undefined,
            embodimentLevel: robot.embodimentLevel ?? undefined,
            firstSeenYear: robot.firstSeenYear ?? undefined
          }
        });

        if (currentHash !== doc.contentHash) {
          return {
            isValid: false,
            reason: "CONTENT_CHANGED",
            currentContentHash: currentHash,
            expectedContentHash: doc.contentHash,
            currentDoc: null
          };
        }

        return { isValid: true, reason: null, currentDoc: doc };
      }

      case "contribution": {
        const item = await prisma.contribution.findUnique({
          where: { id },
          include: { relatedRobotModel: true }
        });
        if (!item) {
          return { isValid: false, reason: "DELETED", currentDoc: null };
        }
        if (!isEligiblePublicContribution(item)) {
          return { isValid: false, reason: "CONTRIBUTION_INELIGIBLE", currentDoc: null };
        }
        if (item.relatedRobotModel && !isEligiblePublicRobot(item.relatedRobotModel.canonicalName)) {
          return { isValid: false, reason: "PARENT_INELIGIBLE", currentDoc: null };
        }

        const { cleanedText } = cleanSearchText(item.description);
        const currentHash = computeContentHash({
          typedId: doc.typedId,
          title: item.title,
          body: cleanedText,
          url: item.sourceUrl,
          metadata: {
            contributorName: item.contributorName ?? undefined,
            organization: item.organization ?? undefined,
            contributionType: item.contributionType ?? undefined,
            license: item.license ?? undefined
          }
        });

        if (currentHash !== doc.contentHash) {
          return {
            isValid: false,
            reason: "CONTENT_CHANGED",
            currentContentHash: currentHash,
            expectedContentHash: doc.contentHash,
            currentDoc: null
          };
        }

        return { isValid: true, reason: null, currentDoc: doc };
      }

      case "perspective": {
        const item = await prisma.perspectiveAnnotation.findUnique({
          where: { id },
          include: { source: true }
        });
        if (!item) {
          return { isValid: false, reason: "DELETED", currentDoc: null };
        }
        if (!item.source || item.source.relevanceStatus !== "ACCEPTED") {
          return { isValid: false, reason: "PARENT_INELIGIBLE", currentDoc: null };
        }

        const depHash = computeDependencyHash(
          `source:${item.source.id}`,
          item.source.relevanceStatus
        );
        if (depHash !== doc.dependencyHash) {
          return { isValid: false, reason: "DEPENDENCY_CHANGED", currentDoc: null };
        }

        const { cleanedText } = cleanSearchText(item.evidenceExcerpt);
        const currentHash = computeContentHash({
          typedId: doc.typedId,
          title: `${item.perspectiveTheme}: ${item.targetEntity}`,
          body: cleanedText,
          url: item.source.url,
          metadata: {
            stance: item.stance,
            sentiment: item.sentiment,
            method: item.method,
            perspectiveTheme: item.perspectiveTheme,
            targetEntity: item.targetEntity,
            parentTitle: item.source.title
          }
        });

        if (currentHash !== doc.contentHash) {
          return {
            isValid: false,
            reason: "CONTENT_CHANGED",
            currentContentHash: currentHash,
            expectedContentHash: doc.contentHash,
            currentDoc: null
          };
        }

        return { isValid: true, reason: null, currentDoc: doc };
      }

      case "inventory": {
        const item = await prisma.ownedInventory.findUnique({
          where: { id },
          include: { robotModel: true }
        });
        if (!item) {
          return { isValid: false, reason: "DELETED", currentDoc: null };
        }
        if (item.visibility !== "public") {
          return { isValid: false, reason: "INVENTORY_HIDDEN", currentDoc: null };
        }
        if (item.robotModel && !isEligiblePublicRobot(item.robotModel.canonicalName)) {
          return { isValid: false, reason: "PARENT_INELIGIBLE", currentDoc: null };
        }

        const currentHash = computeContentHash({
          typedId: doc.typedId,
          title: item.displayName,
          body: `${item.ownershipStatus} ${item.conditionStatus ?? ""}`.trim(),
          url: null,
          metadata: {
            ownershipStatus: item.ownershipStatus,
            conditionStatus: item.conditionStatus ?? undefined,
            ownerOrg: item.ownerOrg ?? undefined,
            robotModelName: item.robotModel?.canonicalName ?? undefined
          }
        });

        if (currentHash !== doc.contentHash) {
          return {
            isValid: false,
            reason: "CONTENT_CHANGED",
            currentContentHash: currentHash,
            expectedContentHash: doc.contentHash,
            currentDoc: null
          };
        }

        return { isValid: true, reason: null, currentDoc: doc };
      }

      case "relationship": {
        const item = await prisma.triplet.findUnique({
          where: { id },
          include: { source: true }
        });
        if (!item) {
          return { isValid: false, reason: "DELETED", currentDoc: null };
        }
        if (item.source && item.source.relevanceStatus !== "ACCEPTED") {
          return { isValid: false, reason: "PARENT_INELIGIBLE", currentDoc: null };
        }

        const currentHash = computeContentHash({
          typedId: doc.typedId,
          title: `${item.subject} ${item.relation} ${item.object}`,
          body: `${item.subject} - ${item.relation} -> ${item.object}`,
          url: item.source?.url ?? null,
          metadata: {
            subject: item.subject,
            relation: item.relation,
            object: item.object,
            confidence: item.confidence,
            sourceTitle: item.source?.title ?? undefined
          }
        });

        if (currentHash !== doc.contentHash) {
          return {
            isValid: false,
            reason: "CONTENT_CHANGED",
            currentContentHash: currentHash,
            expectedContentHash: doc.contentHash,
            currentDoc: null
          };
        }

        return { isValid: true, reason: null, currentDoc: doc };
      }

      case "entity": {
        const item = await prisma.entity.findUnique({
          where: { id }
        });
        if (!item) {
          return { isValid: false, reason: "DELETED", currentDoc: null };
        }

        const currentHash = computeContentHash({
          typedId: doc.typedId,
          title: item.name,
          body: item.entityType,
          url: null,
          metadata: {
            entityType: item.entityType,
            canonicalKey: item.canonicalKey
          }
        });

        if (currentHash !== doc.contentHash) {
          return {
            isValid: false,
            reason: "CONTENT_CHANGED",
            currentContentHash: currentHash,
            expectedContentHash: doc.contentHash,
            currentDoc: null
          };
        }

        return { isValid: true, reason: null, currentDoc: doc };
      }

      default:
        return { isValid: false, reason: "STATUS_INELIGIBLE", currentDoc: null };
    }
  } catch {
    // If query fails, suppress to avoid leaking stale/unverified data
    return { isValid: false, reason: "DELETED", currentDoc: null };
  }
}

/**
 * Batch revalidates multiple SearchDocument candidates.
 * Returns surviving valid documents and list of suppressed documents with reasons.
 */
export async function revalidateSearchDocuments(
  docs: SearchDocument[],
  prisma: any
): Promise<{
  validDocs: SearchDocument[];
  suppressedDocs: Array<{ doc: SearchDocument; reason: string }>;
}> {
  const validDocs: SearchDocument[] = [];
  const suppressedDocs: Array<{ doc: SearchDocument; reason: string }> = [];

  for (const doc of docs) {
    const res = await revalidateSearchDocument(doc, prisma);
    if (res.isValid && res.currentDoc) {
      validDocs.push(res.currentDoc);
    } else {
      suppressedDocs.push({ doc, reason: res.reason ?? "UNKNOWN" });
    }
  }

  return { validDocs, suppressedDocs };
}
