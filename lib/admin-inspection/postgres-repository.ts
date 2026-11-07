import type { PrismaClient } from "../../generated/prisma";
import type { CmsCollection, InspectionRecord, InspectionRepository } from "./contracts";

const identitySelect = { id: true, createdAt: true, updatedAt: true } as const;

function identity(
  collection: CmsCollection,
  row: { id: string; createdAt: Date; updatedAt: Date }
): Pick<InspectionRecord, "collection" | "id" | "createdAt" | "updatedAt"> {
  return {
    collection,
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export function createPostgresInspectionRepository(
  prisma: Pick<PrismaClient, "sourceRecord" | "robotModel" | "contribution" | "submittedData">
): InspectionRepository {
  return {
    async findExact(collection, id) {
      switch (collection) {
        case "source-records": {
          const row = await prisma.sourceRecord.findUnique({
            where: { id },
            select: { ...identitySelect, title: true, excerpt: true, relevanceStatus: true, url: true }
          });
          return row && {
            ...identity(collection, row),
            displayName: row.title,
            summary: row.excerpt,
            status: row.relevanceStatus,
            url: row.url
          };
        }
        case "robot-models": {
          const row = await prisma.robotModel.findUnique({
            where: { id },
            select: { ...identitySelect, canonicalName: true, description: true, officialUrl: true }
          });
          return row && {
            ...identity(collection, row),
            displayName: row.canonicalName,
            summary: row.description,
            status: null,
            url: row.officialUrl
          };
        }
        case "contributions": {
          const row = await prisma.contribution.findUnique({
            where: { id },
            select: { ...identitySelect, title: true, description: true, verificationStatus: true, sourceUrl: true }
          });
          return row && {
            ...identity(collection, row),
            displayName: row.title,
            summary: row.description,
            status: row.verificationStatus,
            url: row.sourceUrl
          };
        }
        case "submitted-data": {
          const row = await prisma.submittedData.findUnique({
            where: { id },
            select: { ...identitySelect, title: true, submissionType: true, status: true, url: true }
          });
          return row && {
            ...identity(collection, row),
            displayName: row.title,
            summary: row.submissionType,
            status: row.status,
            url: row.url
          };
        }
      }
    }
  };
}
