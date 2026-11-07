import assert from "node:assert/strict";
import { test } from "node:test";
import { createSubmissionWorkflowService } from "../lib/submission-workflow/service";
import type {
  PublishedContributionRecord,
  SubmittedDataRecord,
  SubmissionWorkflowRepository
} from "../lib/submission-workflow/contracts";
import type { SessionResult } from "../lib/operator-auth/contracts";
import { isEligiblePublicContribution } from "../lib/public-projection";

function createInMemoryRepository(): SubmissionWorkflowRepository & {
  submittedRows: Map<string, SubmittedDataRecord>;
  contributionRows: Map<string, PublishedContributionRecord>;
  simulateFailure: boolean;
} {
  const submittedRows = new Map<string, SubmittedDataRecord>();
  const contributionRows = new Map<string, PublishedContributionRecord>();
  let idCounter = 1;

  const repo: SubmissionWorkflowRepository & {
    submittedRows: Map<string, SubmittedDataRecord>;
    contributionRows: Map<string, PublishedContributionRecord>;
    simulateFailure: boolean;
  } = {
    submittedRows,
    contributionRows,
    simulateFailure: false,

    async createSubmittedData(data) {
      const id = `sub_${idCounter++}`;
      const record: SubmittedDataRecord = {
        id,
        submissionType: data.submissionType,
        title: data.title,
        url: data.url,
        notes: data.notes,
        submitterName: data.submitterName,
        submitterContact: data.submitterContact,
        status: data.status,
        reviewNotes: null,
        submittedById: null,
        payloadJson: data.payloadJson,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      submittedRows.set(id, record);
      return record;
    },

    async findSubmittedDataById(id) {
      return submittedRows.get(id) || null;
    },

    async findContributionById(id) {
      return contributionRows.get(id) || null;
    },

    async findContributionBySourceUrl(sourceUrl) {
      for (const row of contributionRows.values()) {
        if (row.sourceUrl === sourceUrl) return row;
      }
      return null;
    },

    async executeReviewTransaction<T>(operation: (txRepo: SubmissionWorkflowRepository) => Promise<T>): Promise<T> {
      // Snapshot state for atomic rollback simulation
      const submittedSnapshot = new Map(
        Array.from(submittedRows.entries()).map(([k, v]) => [k, { ...v, payloadJson: { ...v.payloadJson } }])
      );
      const contributionSnapshot = new Map(
        Array.from(contributionRows.entries()).map(([k, v]) => [k, { ...v }])
      );

      try {
        if (repo.simulateFailure) {
          throw new Error("Simulated database failure during transaction");
        }
        return await operation(repo);
      } catch (err) {
        // Rollback state on error
        submittedRows.clear();
        for (const [k, v] of submittedSnapshot) submittedRows.set(k, v);
        contributionRows.clear();
        for (const [k, v] of contributionSnapshot) contributionRows.set(k, v);
        throw err;
      }
    },

    async createContribution(data) {
      if (repo.simulateFailure) {
        throw new Error("Simulated database failure during createContribution");
      }
      const id = `contrib_${idCounter++}`;
      const record: PublishedContributionRecord = {
        id,
        title: data.title,
        description: data.description,
        contributorName: data.contributorName,
        contributorType: null,
        organization: data.organization,
        contributionType: data.contributionType,
        sourceUrl: data.sourceUrl,
        license: data.license,
        visibility: data.visibility,
        verificationStatus: data.verificationStatus,
        relatedRobotModelId: data.relatedRobotModelId,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      contributionRows.set(id, record);
      return record;
    },

    async updateContribution(id, data) {
      const existing = contributionRows.get(id);
      if (!existing) throw new Error(`Contribution ${id} not found`);
      const updated: PublishedContributionRecord = {
        ...existing,
        ...data,
        updatedAt: new Date()
      };
      contributionRows.set(id, updated);
      return updated;
    },

    async updateSubmittedData(id, data) {
      const existing = submittedRows.get(id);
      if (!existing) throw new Error(`SubmittedData ${id} not found`);
      const updated: SubmittedDataRecord = {
        ...existing,
        status: data.status,
        reviewNotes: data.reviewNotes,
        payloadJson: data.payloadJson,
        updatedAt: new Date()
      };
      submittedRows.set(id, updated);
      return updated;
    }
  };

  return repo;
}

const mockOperator: SessionResult = {
  ok: true,
  principal: { kind: "operator", email: "operator@example.invalid" }
};

const mockUnauthenticated: SessionResult = {
  ok: false,
  code: "UNAUTHENTICATED"
};

test("createSubmission: successfully queues a valid contribution submission", async () => {
  const repo = createInMemoryRepository();
  const service = createSubmissionWorkflowService({
    authorize: async () => mockOperator,
    repository: async () => repo
  });

  const result = await service.createSubmission({
    submissionType: "contribution",
    title: "Field Deployment of Dinsaw in Hospital Ward",
    url: "https://example.com/reports/dinsaw-ward-study",
    notes: "Detailed observational study on patient interaction and acceptance.",
    submitterName: "Dr. Somchai",
    submitterContact: "somchai@hospital.example.th",
    payload: {
      organization: "BMA General Hospital",
      contributionType: "field_report"
    }
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.status, "QUEUED");
  assert.ok(result.submissionId.startsWith("sub_"));

  const stored = repo.submittedRows.get(result.submissionId);
  assert.ok(stored);
  assert.equal(stored.submissionType, "contribution");
  assert.equal(stored.title, "Field Deployment of Dinsaw in Hospital Ward");
  assert.equal(stored.status, "QUEUED");
  assert.equal(stored.payloadJson.organization, "BMA General Hospital");
});

test("createSubmission: restricts unsupported submission types (inventory, robot_model)", async () => {
  const repo = createInMemoryRepository();
  const service = createSubmissionWorkflowService({
    authorize: async () => mockOperator,
    repository: async () => repo
  });

  const res1 = await service.createSubmission({
    submissionType: "inventory",
    title: "New Inventory Unit"
  });
  assert.equal(res1.ok, false);
  if (res1.ok) return;
  assert.equal(res1.code, "WORKFLOW_UNAVAILABLE");

  const res2 = await service.createSubmission({
    submissionType: "robot_model",
    title: "New Robot Specification"
  });
  assert.equal(res2.ok, false);
  if (res2.ok) return;
  assert.equal(res2.code, "WORKFLOW_UNAVAILABLE");
});

test("createSubmission: validates title and URL boundaries", async () => {
  const repo = createInMemoryRepository();
  const service = createSubmissionWorkflowService({
    authorize: async () => mockOperator,
    repository: async () => repo
  });

  // Empty title
  const emptyRes = await service.createSubmission({
    submissionType: "contribution",
    title: "   "
  });
  assert.equal(emptyRes.ok, false);
  if (emptyRes.ok) return;
  assert.equal(emptyRes.code, "INVALID_INPUT");

  // Invalid URL protocol
  const badUrlRes = await service.createSubmission({
    submissionType: "contribution",
    title: "Valid Title",
    url: "ftp://example.com/file"
  });
  assert.equal(badUrlRes.ok, false);
  if (badUrlRes.ok) return;
  assert.equal(badUrlRes.code, "INVALID_INPUT");
});

test("reviewSubmission: rejects unauthenticated or forged operator sessions fail-closed", async () => {
  const repo = createInMemoryRepository();
  const service = createSubmissionWorkflowService({
    authorize: async () => mockUnauthenticated,
    repository: async () => repo
  });

  const result = await service.reviewSubmission({
    submissionId: "sub_1",
    decision: "APPROVED"
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "UNAUTHENTICATED");
});

test("reviewSubmission: atomically approves and publishes new contribution with reviewer linkage", async () => {
  const repo = createInMemoryRepository();
  const service = createSubmissionWorkflowService({
    authorize: async () => mockOperator,
    repository: async () => repo
  });

  const createRes = await service.createSubmission({
    submissionType: "contribution",
    title: "Human-Robot Interaction in Thai Elder Care",
    url: "https://example.org/papers/thai-elder-care",
    notes: "Peer-reviewed analysis of communicative gestures.",
    submitterName: "K. Prasert",
    payload: {
      organization: "Chulalongkorn Robotics",
      contributionType: "research",
      visibility: "public"
    }
  });
  assert.equal(createRes.ok, true);
  if (!createRes.ok) return;

  const reviewRes = await service.reviewSubmission({
    submissionId: createRes.submissionId,
    decision: "APPROVED",
    reviewNotes: "Verified peer-reviewed publication from recognized university lab."
  });

  assert.equal(reviewRes.ok, true);
  if (!reviewRes.ok) return;
  assert.equal(reviewRes.status, "APPROVED");
  assert.equal(reviewRes.duplicate, false);
  assert.equal(reviewRes.action, "published");
  assert.ok(reviewRes.publishedRecordId);

  // Check published Contribution record
  const published = repo.contributionRows.get(reviewRes.publishedRecordId!);
  assert.ok(published);
  assert.equal(published.title, "Human-Robot Interaction in Thai Elder Care");
  assert.equal(published.organization, "Chulalongkorn Robotics");
  assert.equal(published.visibility, "public");
  assert.equal(published.verificationStatus, "APPROVED");

  // Check public data projection eligibility
  assert.equal(isEligiblePublicContribution(published), true);

  // Check reviewer and target linkage in SubmittedData
  const updatedSub = repo.submittedRows.get(createRes.submissionId);
  assert.ok(updatedSub);
  assert.equal(updatedSub.status, "APPROVED");
  assert.equal(updatedSub.reviewNotes, "Verified peer-reviewed publication from recognized university lab.");
  assert.equal(updatedSub.payloadJson.publishedRecordId, published.id);
  assert.equal(updatedSub.payloadJson.reviewerEmail, "operator@example.invalid");
  assert.ok(updatedSub.payloadJson.reviewedAt);
});

test("reviewSubmission: atomically corrects an existing target contribution in place", async () => {
  const repo = createInMemoryRepository();
  const service = createSubmissionWorkflowService({
    authorize: async () => mockOperator,
    repository: async () => repo
  });

  // Pre-seed an existing public contribution that needs correction
  const initial = await repo.createContribution({
    title: "Old Misspelled Title",
    description: "Old description",
    contributorName: "Original Contributor",
    organization: "Old Lab",
    contributionType: "research",
    sourceUrl: "https://example.com/initial-paper",
    license: "CC-BY",
    visibility: "public",
    verificationStatus: "APPROVED",
    relatedRobotModelId: null
  });

  // Submit a correction targeting initial.id
  const subRes = await service.createSubmission({
    submissionType: "contribution",
    title: "Corrected Title: Autonomous Navigation in Orchards",
    url: "https://example.com/initial-paper",
    notes: "Updated abstract and corrected institution affiliation.",
    submitterName: "Original Contributor",
    payload: {
      targetRecordId: initial.id,
      targetRecordType: "contribution",
      organization: "KMUTT FIBO",
      contributionType: "research"
    }
  });
  assert.equal(subRes.ok, true);
  if (!subRes.ok) return;

  const reviewRes = await service.reviewSubmission({
    submissionId: subRes.submissionId,
    decision: "APPROVED",
    reviewNotes: "Correction approved after verification."
  });

  assert.equal(reviewRes.ok, true);
  if (!reviewRes.ok) return;
  assert.equal(reviewRes.status, "APPROVED");
  assert.equal(reviewRes.action, "corrected");
  assert.equal(reviewRes.publishedRecordId, initial.id);

  // Verify that the existing record was updated in place, NOT duplicated
  assert.equal(repo.contributionRows.size, 1);
  const updated = repo.contributionRows.get(initial.id);
  assert.ok(updated);
  assert.equal(updated.title, "Corrected Title: Autonomous Navigation in Orchards");
  assert.equal(updated.organization, "KMUTT FIBO");
  assert.equal(updated.verificationStatus, "APPROVED");
});

test("reviewSubmission: rejection updates submission status without creating or modifying public records", async () => {
  const repo = createInMemoryRepository();
  const service = createSubmissionWorkflowService({
    authorize: async () => mockOperator,
    repository: async () => repo
  });

  const subRes = await service.createSubmission({
    submissionType: "contribution",
    title: "Unverifiable Claim",
    url: "https://example.org/unverified",
    notes: "Speculative content."
  });
  assert.equal(subRes.ok, true);
  if (!subRes.ok) return;

  const reviewRes = await service.reviewSubmission({
    submissionId: subRes.submissionId,
    decision: "REJECTED",
    reviewNotes: "Lacks corroborating evidence or publication source."
  });

  assert.equal(reviewRes.ok, true);
  if (!reviewRes.ok) return;
  assert.equal(reviewRes.status, "REJECTED");
  assert.equal(reviewRes.action, "rejected");

  // Zero contributions created
  assert.equal(repo.contributionRows.size, 0);

  // SubmittedData reflects rejection
  const sub = repo.submittedRows.get(subRes.submissionId);
  assert.ok(sub);
  assert.equal(sub.status, "REJECTED");
  assert.equal(sub.reviewNotes, "Lacks corroborating evidence or publication source.");
  assert.equal(sub.payloadJson.reviewerEmail, "operator@example.invalid");
});

test("reviewSubmission: retry does not duplicate publication (idempotency)", async () => {
  const repo = createInMemoryRepository();
  const service = createSubmissionWorkflowService({
    authorize: async () => mockOperator,
    repository: async () => repo
  });

  const subRes = await service.createSubmission({
    submissionType: "contribution",
    title: "Unique Dataset on Thai Conversational Audio",
    url: "https://example.com/audio-dataset",
    notes: "Speech dataset for humanoid receptionists."
  });
  assert.equal(subRes.ok, true);
  if (!subRes.ok) return;

  // First review: approves and publishes
  const first = await service.reviewSubmission({
    submissionId: subRes.submissionId,
    decision: "APPROVED",
    reviewNotes: "First approval."
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.duplicate, false);
  assert.equal(repo.contributionRows.size, 1);

  // Second review (retry): should be idempotent noop
  const retry = await service.reviewSubmission({
    submissionId: subRes.submissionId,
    decision: "APPROVED",
    reviewNotes: "Duplicate approval retry."
  });
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.duplicate, true);
  assert.equal(retry.action, "idempotent_noop");
  assert.equal(retry.publishedRecordId, first.publishedRecordId);

  // Zero duplicate contributions created
  assert.equal(repo.contributionRows.size, 1);
});

test("reviewSubmission: failure during publication transaction rolls back all state (no partial published state)", async () => {
  const repo = createInMemoryRepository();
  const service = createSubmissionWorkflowService({
    authorize: async () => mockOperator,
    repository: async () => repo
  });

  const subRes = await service.createSubmission({
    submissionType: "contribution",
    title: "Atomic Rollback Test",
    url: "https://example.com/fail-test"
  });
  assert.equal(subRes.ok, true);
  if (!subRes.ok) return;

  // Trigger simulated database crash inside transaction
  repo.simulateFailure = true;

  const reviewRes = await service.reviewSubmission({
    submissionId: subRes.submissionId,
    decision: "APPROVED"
  });

  assert.equal(reviewRes.ok, false);
  if (reviewRes.ok) return;
  assert.equal(reviewRes.code, "UNAVAILABLE");

  // Verify that SubmittedData was NOT left in APPROVED state
  const sub = repo.submittedRows.get(subRes.submissionId);
  assert.ok(sub);
  assert.equal(sub.status, "QUEUED");
  assert.equal(sub.payloadJson.publishedRecordId, undefined);

  // Verify that no orphaned contribution was created
  assert.equal(repo.contributionRows.size, 0);
});

test("reviewSubmission: rejects reviewing unsupported submission types with WORKFLOW_UNAVAILABLE", async () => {
  const repo = createInMemoryRepository();
  const service = createSubmissionWorkflowService({
    authorize: async () => mockOperator,
    repository: async () => repo
  });

  // Manually insert an unsupported record (e.g. legacy inventory submission)
  const legacySub: SubmittedDataRecord = {
    id: "sub_legacy",
    submissionType: "inventory",
    title: "Legacy Inventory Submission",
    url: null,
    notes: null,
    submitterName: null,
    submitterContact: null,
    status: "QUEUED",
    reviewNotes: null,
    submittedById: null,
    payloadJson: {},
    createdAt: new Date(),
    updatedAt: new Date()
  };
  repo.submittedRows.set(legacySub.id, legacySub);

  const reviewRes = await service.reviewSubmission({
    submissionId: legacySub.id,
    decision: "APPROVED"
  });

  assert.equal(reviewRes.ok, false);
  if (reviewRes.ok) return;
  assert.equal(reviewRes.code, "WORKFLOW_UNAVAILABLE");
});
