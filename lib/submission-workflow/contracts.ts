import type { ReviewStatus } from "../../generated/prisma";
import type { SessionResult } from "../operator-auth/contracts";

export type SupportedSubmissionType = "contribution";
export type UnsupportedSubmissionType = "robot_model" | "source_record" | "inventory";
export type SubmissionType = SupportedSubmissionType | UnsupportedSubmissionType | string;

export interface ContributionPayload {
  contributionType?: string;
  organization?: string | null;
  description?: string | null;
  license?: string | null;
  visibility?: "public" | "private";
  targetRecordId?: string | null;
  targetRecordType?: "contribution";
  relatedRobotModelId?: string | null;
  [key: string]: unknown;
}

export interface SubmittedDataRecord {
  id: string;
  submissionType: string;
  title: string;
  url: string | null;
  payloadJson: Record<string, unknown>;
  notes: string | null;
  submitterName: string | null;
  submitterContact: string | null;
  status: ReviewStatus;
  reviewNotes: string | null;
  submittedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublishedContributionRecord {
  id: string;
  title: string;
  description: string | null;
  contributorName: string | null;
  contributorType: string | null;
  organization: string | null;
  contributionType: string;
  sourceUrl: string | null;
  license: string | null;
  visibility: string;
  verificationStatus: ReviewStatus;
  relatedRobotModelId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSubmissionInput {
  submissionType: string;
  title: string;
  url?: string | null;
  notes?: string | null;
  submitterName?: string | null;
  submitterContact?: string | null;
  payload?: ContributionPayload;
}

export type CreateSubmissionResult =
  | { ok: true; submissionId: string; status: "QUEUED" }
  | { ok: false; code: "INVALID_INPUT" | "WORKFLOW_UNAVAILABLE"; message: string };

export interface ReviewSubmissionInput {
  submissionId: string;
  decision: "APPROVED" | "REJECTED";
  reviewNotes?: string | null;
  idempotencyKey?: string | null;
}

export type ReviewSubmissionResult =
  | {
      ok: true;
      submissionId: string;
      status: "APPROVED" | "REJECTED";
      publishedRecordId?: string;
      duplicate: boolean;
      action: "published" | "corrected" | "rejected" | "idempotent_noop";
    }
  | {
      ok: false;
      code: "UNAUTHENTICATED" | "NOT_FOUND" | "WORKFLOW_UNAVAILABLE" | "INVALID_INPUT" | "UNAVAILABLE";
      message: string;
    };

export interface SubmissionWorkflowRepository {
  createSubmittedData(data: {
    submissionType: string;
    title: string;
    url: string | null;
    notes: string | null;
    submitterName: string | null;
    submitterContact: string | null;
    status: ReviewStatus;
    payloadJson: Record<string, unknown>;
  }): Promise<SubmittedDataRecord>;

  findSubmittedDataById(id: string): Promise<SubmittedDataRecord | null>;

  findContributionById(id: string): Promise<PublishedContributionRecord | null>;

  findContributionBySourceUrl(sourceUrl: string): Promise<PublishedContributionRecord | null>;

  executeReviewTransaction<T>(
    operation: (txRepo: SubmissionWorkflowRepository) => Promise<T>
  ): Promise<T>;

  createContribution(data: {
    title: string;
    description: string | null;
    contributorName: string | null;
    organization: string | null;
    contributionType: string;
    sourceUrl: string | null;
    license: string | null;
    visibility: string;
    verificationStatus: ReviewStatus;
    relatedRobotModelId: string | null;
  }): Promise<PublishedContributionRecord>;

  updateContribution(
    id: string,
    data: Partial<{
      title: string;
      description: string | null;
      contributorName: string | null;
      organization: string | null;
      contributionType: string;
      sourceUrl: string | null;
      license: string | null;
      visibility: string;
      verificationStatus: ReviewStatus;
      relatedRobotModelId: string | null;
    }>
  ): Promise<PublishedContributionRecord>;

  updateSubmittedData(
    id: string,
    data: {
      status: ReviewStatus;
      reviewNotes: string | null;
      payloadJson: Record<string, unknown>;
    }
  ): Promise<SubmittedDataRecord>;
}
