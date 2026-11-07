import type { PrismaClient } from "../../generated/prisma";
import type {
  PublishedContributionRecord,
  SubmittedDataRecord,
  SubmissionWorkflowRepository
} from "./contracts";

export function createPostgresSubmissionWorkflowRepository(
  prisma: Pick<PrismaClient, "submittedData" | "contribution" | "$transaction">
): SubmissionWorkflowRepository {
  return {
    async createSubmittedData(data) {
      const row = await prisma.submittedData.create({
        data: {
          submissionType: data.submissionType,
          title: data.title,
          url: data.url,
          notes: data.notes,
          submitterName: data.submitterName,
          submitterContact: data.submitterContact,
          status: data.status,
          payloadJson: data.payloadJson as any
        }
      });
      return {
        ...row,
        payloadJson: (row.payloadJson && typeof row.payloadJson === "object" ? row.payloadJson : {}) as Record<string, unknown>
      };
    },

    async findSubmittedDataById(id) {
      const row = await prisma.submittedData.findUnique({
        where: { id }
      });
      if (!row) return null;
      return {
        ...row,
        payloadJson: (row.payloadJson && typeof row.payloadJson === "object" ? row.payloadJson : {}) as Record<string, unknown>
      };
    },

    async findContributionById(id) {
      return await prisma.contribution.findUnique({
        where: { id }
      });
    },

    async findContributionBySourceUrl(sourceUrl) {
      return await prisma.contribution.findUnique({
        where: { sourceUrl }
      });
    },

    async executeReviewTransaction<T>(
      operation: (txRepo: SubmissionWorkflowRepository) => Promise<T>
    ): Promise<T> {
      if (typeof (prisma as any).$transaction === "function") {
        return await (prisma as any).$transaction(async (tx: any) => {
          const txRepo = createPostgresSubmissionWorkflowRepository(tx);
          return await operation(txRepo);
        });
      }
      return await operation(this);
    },

    async createContribution(data) {
      return await prisma.contribution.create({
        data: {
          title: data.title,
          description: data.description,
          contributorName: data.contributorName,
          organization: data.organization,
          contributionType: data.contributionType,
          sourceUrl: data.sourceUrl,
          license: data.license,
          visibility: data.visibility,
          verificationStatus: data.verificationStatus,
          relatedRobotModelId: data.relatedRobotModelId
        }
      });
    },

    async updateContribution(id, data) {
      return await prisma.contribution.update({
        where: { id },
        data
      });
    },

    async updateSubmittedData(id, data) {
      const row = await prisma.submittedData.update({
        where: { id },
        data: {
          status: data.status,
          reviewNotes: data.reviewNotes,
          payloadJson: data.payloadJson as any
        }
      });
      return {
        ...row,
        payloadJson: (row.payloadJson && typeof row.payloadJson === "object" ? row.payloadJson : {}) as Record<string, unknown>
      };
    }
  };
}
