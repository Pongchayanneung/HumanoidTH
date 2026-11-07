import type { SessionResult } from "../operator-auth/contracts";
import type {
  ContributionPayload,
  CreateSubmissionInput,
  CreateSubmissionResult,
  ReviewSubmissionInput,
  ReviewSubmissionResult,
  SubmissionWorkflowRepository
} from "./contracts";

function isValidUrl(val: string | null | undefined): boolean {
  if (!val) return true;
  try {
    const parsed = new URL(val);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function createSubmissionWorkflowService({
  authorize,
  repository
}: {
  authorize: (customCookies?: unknown) => Promise<SessionResult>;
  repository: () => Promise<SubmissionWorkflowRepository>;
}) {
  return {
    async createSubmission(input: CreateSubmissionInput): Promise<CreateSubmissionResult> {
      try {
        if (!input || typeof input !== "object") {
          return { ok: false, code: "INVALID_INPUT", message: "Submission input must be an object." };
        }

        const type = String(input.submissionType || "").trim().toLowerCase();
        if (type !== "contribution") {
          return {
            ok: false,
            code: "WORKFLOW_UNAVAILABLE",
            message: "Only contribution submissions are currently supported. Other submission types remain restricted."
          };
        }

        const title = typeof input.title === "string" ? input.title.trim() : "";
        if (!title || title.length > 300) {
          return {
            ok: false,
            code: "INVALID_INPUT",
            message: "Title is required and must not exceed 300 characters."
          };
        }

        const url = typeof input.url === "string" && input.url.trim() ? input.url.trim() : null;
        if (url && !isValidUrl(url)) {
          return {
            ok: false,
            code: "INVALID_INPUT",
            message: "Source URL must be a valid HTTP or HTTPS address."
          };
        }

        const notes = typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : null;
        if (notes && notes.length > 4096) {
          return {
            ok: false,
            code: "INVALID_INPUT",
            message: "Notes must not exceed 4,096 characters."
          };
        }

        const submitterName =
          typeof input.submitterName === "string" && input.submitterName.trim()
            ? input.submitterName.trim().slice(0, 150)
            : null;
        const submitterContact =
          typeof input.submitterContact === "string" && input.submitterContact.trim()
            ? input.submitterContact.trim().slice(0, 200)
            : null;

        const payload: ContributionPayload = (input.payload && typeof input.payload === "object"
          ? { ...input.payload }
          : {}) as ContributionPayload;

        const repo = await repository();
        const record = await repo.createSubmittedData({
          submissionType: "contribution",
          title,
          url,
          notes,
          submitterName,
          submitterContact,
          status: "QUEUED",
          payloadJson: {
            ...payload,
            submissionType: "contribution",
            submittedAt: new Date().toISOString()
          }
        });

        return {
          ok: true,
          submissionId: record.id,
          status: "QUEUED"
        };
      } catch {
        return {
          ok: false,
          code: "INVALID_INPUT",
          message: "Failed to create submission record."
        };
      }
    },

    async reviewSubmission(
      input: ReviewSubmissionInput,
      customCookies?: unknown
    ): Promise<ReviewSubmissionResult> {
      try {
        const session = await authorize(customCookies);
        if (!session.ok) {
          return {
            ok: false,
            code: session.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "UNAVAILABLE",
            message: "Operator authentication required."
          };
        }

        if (!input || typeof input !== "object") {
          return { ok: false, code: "INVALID_INPUT", message: "Review input must be an object." };
        }

        const submissionId = typeof input.submissionId === "string" ? input.submissionId.trim() : "";
        if (!submissionId || submissionId.length > 256) {
          return { ok: false, code: "INVALID_INPUT", message: "Valid submission ID required." };
        }

        if (input.decision !== "APPROVED" && input.decision !== "REJECTED") {
          return { ok: false, code: "INVALID_INPUT", message: "Decision must be APPROVED or REJECTED." };
        }

        const repo = await repository();

        return await repo.executeReviewTransaction(async (txRepo) => {
          const submission = await txRepo.findSubmittedDataById(submissionId);
          if (!submission) {
            return { ok: false, code: "NOT_FOUND", message: "Submission not found." };
          }

          if (submission.submissionType !== "contribution") {
            return {
              ok: false,
              code: "WORKFLOW_UNAVAILABLE",
              message: "Only contribution submissions can be published or corrected."
            };
          }

          const payload = (submission.payloadJson && typeof submission.payloadJson === "object"
            ? { ...submission.payloadJson }
            : {}) as ContributionPayload;

          // Idempotency check: if already approved and published record exists, return without duplication
          if (submission.status === "APPROVED" && typeof payload.publishedRecordId === "string") {
            const published = await txRepo.findContributionById(payload.publishedRecordId);
            if (published) {
              return {
                ok: true,
                submissionId: submission.id,
                status: "APPROVED",
                publishedRecordId: published.id,
                duplicate: true,
                action: "idempotent_noop"
              };
            }
          }

          // Idempotency check: if already rejected and review is rejected again
          if (submission.status === "REJECTED" && input.decision === "REJECTED") {
            return {
              ok: true,
              submissionId: submission.id,
              status: "REJECTED",
              duplicate: true,
              action: "idempotent_noop"
            };
          }

          const reviewNotes =
            typeof input.reviewNotes === "string" && input.reviewNotes.trim()
              ? input.reviewNotes.trim()
              : submission.reviewNotes;

          if (input.decision === "APPROVED") {
            let publishedRecordId: string;
            let action: "published" | "corrected" = "published";

            // If targetRecordId is present, this is a correction of an existing public contribution
            if (typeof payload.targetRecordId === "string" && payload.targetRecordId.trim()) {
              const targetId = payload.targetRecordId.trim();
              const existingTarget = await txRepo.findContributionById(targetId);
              if (!existingTarget) {
                return {
                  ok: false,
                  code: "INVALID_INPUT",
                  message: `Target contribution '${targetId}' to correct was not found.`
                };
              }

              const updated = await txRepo.updateContribution(targetId, {
                title: submission.title || existingTarget.title,
                description:
                  (typeof payload.description === "string" ? payload.description : null) ??
                  submission.notes ??
                  existingTarget.description,
                organization:
                  (typeof payload.organization === "string" ? payload.organization : null) ??
                  existingTarget.organization,
                contributionType:
                  (typeof payload.contributionType === "string" ? payload.contributionType : null) ??
                  existingTarget.contributionType,
                sourceUrl: submission.url ?? existingTarget.sourceUrl,
                license:
                  (typeof payload.license === "string" ? payload.license : null) ?? existingTarget.license,
                visibility:
                  (typeof payload.visibility === "string" ? payload.visibility : null) ?? "public",
                verificationStatus: "APPROVED",
                relatedRobotModelId:
                  (typeof payload.relatedRobotModelId === "string" ? payload.relatedRobotModelId : null) ??
                  existingTarget.relatedRobotModelId
              });
              publishedRecordId = updated.id;
              action = "corrected";
            } else {
              // New publication workflow
              // Check if contribution already exists with same sourceUrl (if unique url provided)
              let existingWithUrl = submission.url
                ? await txRepo.findContributionBySourceUrl(submission.url)
                : null;

              if (existingWithUrl) {
                const updated = await txRepo.updateContribution(existingWithUrl.id, {
                  title: submission.title || existingWithUrl.title,
                  description:
                    (typeof payload.description === "string" ? payload.description : null) ??
                    submission.notes ??
                    existingWithUrl.description,
                  organization:
                    (typeof payload.organization === "string" ? payload.organization : null) ??
                    existingWithUrl.organization,
                  contributionType:
                    (typeof payload.contributionType === "string" ? payload.contributionType : null) ??
                    existingWithUrl.contributionType,
                  verificationStatus: "APPROVED",
                  visibility:
                    (typeof payload.visibility === "string" ? payload.visibility : null) ?? "public"
                });
                publishedRecordId = updated.id;
              } else {
                const created = await txRepo.createContribution({
                  title: submission.title,
                  description:
                    (typeof payload.description === "string" ? payload.description : null) ??
                    submission.notes,
                  contributorName: submission.submitterName,
                  organization:
                    typeof payload.organization === "string" ? payload.organization : null,
                  contributionType:
                    typeof payload.contributionType === "string"
                      ? payload.contributionType
                      : "community_submission",
                  sourceUrl: submission.url || null,
                  license: typeof payload.license === "string" ? payload.license : null,
                  visibility:
                    typeof payload.visibility === "string" ? payload.visibility : "public",
                  verificationStatus: "APPROVED",
                  relatedRobotModelId:
                    typeof payload.relatedRobotModelId === "string"
                      ? payload.relatedRobotModelId
                      : null
                });
                publishedRecordId = created.id;
              }
            }

            // Atomically link reviewer and published target in SubmittedData
            await txRepo.updateSubmittedData(submission.id, {
              status: "APPROVED",
              reviewNotes,
              payloadJson: {
                ...payload,
                publishedRecordId,
                reviewerEmail: session.principal.email,
                reviewedAt: new Date().toISOString(),
                ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {})
              }
            });

            return {
              ok: true,
              submissionId: submission.id,
              status: "APPROVED",
              publishedRecordId,
              duplicate: false,
              action
            };
          } else {
            // Decision: REJECTED
            // Atomically record reviewer decision on SubmittedData; NO contribution is published or updated
            await txRepo.updateSubmittedData(submission.id, {
              status: "REJECTED",
              reviewNotes,
              payloadJson: {
                ...payload,
                reviewerEmail: session.principal.email,
                reviewedAt: new Date().toISOString(),
                ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {})
              }
            });

            return {
              ok: true,
              submissionId: submission.id,
              status: "REJECTED",
              duplicate: false,
              action: "rejected"
            };
          }
        });
      } catch {
        return {
          ok: false,
          code: "UNAVAILABLE",
          message: "Submission review transaction failed and was rolled back."
        };
      }
    }
  };
}
