import test from "node:test";
import assert from "node:assert/strict";
import type { NormalizedSource } from "../lib/ingest/types";
import {
  executeIngestionJob,
  isAuthorizedOperator,
  isPermittedAdapter,
  type IngestionJobRepository,
  type IngestionJobRecord,
  type IngestionCheckpoint
} from "../lib/ingest-workflow";

/**
 * In-memory test repository for testing recoverable ingestion jobs.
 */
class InMemoryIngestRepository implements IngestionJobRepository {
  public jobs = new Map<string, IngestionJobRecord>();
  public checkpoints = new Map<string, IngestionCheckpoint>();
  public existingUrls = new Set<string>();
  public savedBatches: NormalizedSource[][] = [];
  public shouldFailNextBatch = false;

  async createJob(data: { id?: string; adapter: any; query: string }): Promise<IngestionJobRecord> {
    const id = data.id ?? `job_${Math.random().toString(36).substring(2, 9)}`;
    const job: IngestionJobRecord = {
      adapter: data.adapter,
      createdAt: new Date(),
      errorMessage: null,
      finishedAt: null,
      id,
      query: data.query,
      recordsFound: 0,
      recordsSaved: 0,
      startedAt: new Date(),
      status: "QUEUED"
    };
    this.jobs.set(id, job);
    return { ...job };
  }

  async getJob(jobId: string): Promise<IngestionJobRecord | null> {
    const job = this.jobs.get(jobId);
    return job ? { ...job } : null;
  }

  async updateJobStatus(
    jobId: string,
    update: {
      status: any;
      recordsFound?: number;
      recordsSaved?: number;
      errorMessage?: string | null;
      finishedAt?: Date | null;
    }
  ): Promise<IngestionJobRecord> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    const updated: IngestionJobRecord = {
      ...job,
      ...update,
      recordsFound: update.recordsFound !== undefined ? update.recordsFound : job.recordsFound,
      recordsSaved: update.recordsSaved !== undefined ? update.recordsSaved : job.recordsSaved
    };
    this.jobs.set(jobId, updated);
    return { ...updated };
  }

  async saveCheckpoint(checkpoint: IngestionCheckpoint): Promise<void> {
    this.checkpoints.set(checkpoint.jobId, { ...checkpoint });
  }

  async getCheckpoint(jobId: string): Promise<IngestionCheckpoint | null> {
    const cp = this.checkpoints.get(jobId);
    return cp ? { ...cp } : null;
  }

  async saveBatch(records: NormalizedSource[], jobId: string) {
    if (this.shouldFailNextBatch) {
      this.shouldFailNextBatch = false;
      throw new Error("Simulated network partition during batch persistence");
    }

    this.savedBatches.push([...records]);
    let newCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const savedIds: string[] = [];

    for (const r of records) {
      if (!r.url) {
        skippedCount++;
        continue;
      }
      if (this.existingUrls.has(r.url)) {
        updatedCount++;
      } else {
        newCount++;
        this.existingUrls.add(r.url);
      }
      savedIds.push(`src_${Math.random().toString(36).substring(2, 9)}`);
    }

    return {
      acceptedCount: records.length,
      newCount,
      rejectedCount: 0,
      savedIds,
      skippedCount,
      uncertainCount: 0,
      updatedCount
    };
  }
}

function makeSampleSources(count: number): NormalizedSource[] {
  const sources: NormalizedSource[] = [];
  for (let i = 1; i <= count; i++) {
    sources.push({
      author: `Author ${i}`,
      excerpt: `Research paper on Thai medical humanoid robot system iteration ${i}.`,
      platform: "openalex",
      publishedAt: new Date("2026-01-15T00:00:00Z"),
      sourceType: "OPENALEX",
      title: `Chula Healthcare Robot Study #${i}`,
      url: `https://doi.org/10.1000/th-humanoid-${i}`
    });
  }
  return sources;
}

test("R1: M2 Operator Authorization & Permitted Provider Policy", async () => {
  const repo = new InMemoryIngestRepository();
  const sources = makeSampleSources(3);

  // 1. Missing or non-operator actor is rejected fail-closed
  const unauthOutcome = await executeIngestionJob({
    actor: { email: "guest@external.com", role: "USER" },
    adapter: "OPENALEX",
    query: "humanoid robot",
    records: sources,
    repository: repo
  });
  assert.equal(unauthOutcome.ok, false);
  assert.equal(unauthOutcome.code, "UNAUTHORIZED");

  // 2. Unpermitted adapter is rejected
  const invalidAdapterOutcome = await executeIngestionJob({
    actor: { email: "operator@thaiatlas.org", kind: "operator" },
    adapter: "UNSUPPORTED_ADAPTER",
    query: "humanoid robot",
    records: sources,
    repository: repo
  });
  assert.equal(invalidAdapterOutcome.ok, false);
  assert.equal(invalidAdapterOutcome.code, "INVALID_PROVIDER");

  // 3. Permitted adapters helper check
  assert.equal(isPermittedAdapter("OPENALEX"), true);
  assert.equal(isPermittedAdapter("GITHUB"), true);
  assert.equal(isPermittedAdapter("GDELT"), true);
  assert.equal(isPermittedAdapter("YOUTUBE"), true);
  assert.equal(isPermittedAdapter("UNKNOWN_FEED"), false);
});

test("R1: Ingestion distinguishes new records, updates, and duplicates (Finding D13)", async () => {
  const repo = new InMemoryIngestRepository();
  const operator = { email: "lead_curator@thaiatlas.org", kind: "operator" };
  const initialSources = makeSampleSources(4);

  // Initial pull: all 4 records are new
  const firstRun = await executeIngestionJob({
    actor: operator,
    adapter: "OPENALEX",
    batchSize: 2,
    query: "humanoid Thailand",
    records: initialSources,
    repository: repo
  });

  assert.equal(firstRun.ok, true);
  if (!firstRun.ok) return;
  assert.equal(firstRun.result.status, "SUCCEEDED");
  assert.equal(firstRun.result.counts.recordsFound, 4);
  assert.equal(firstRun.result.counts.recordsNew, 4);
  assert.equal(firstRun.result.counts.recordsUpdated, 0);
  assert.equal(firstRun.result.counts.recordsSaved, 4);

  // Repeat pull with identical records + 2 new records
  const mixedSources = [...initialSources, ...makeSampleSources(2).map((s, idx) => ({ ...s, url: `https://doi.org/10.1000/th-humanoid-new-${idx}` }))];

  const secondRun = await executeIngestionJob({
    actor: operator,
    adapter: "OPENALEX",
    batchSize: 2,
    query: "humanoid Thailand",
    records: mixedSources,
    repository: repo
  });

  assert.equal(secondRun.ok, true);
  if (!secondRun.ok) return;
  assert.equal(secondRun.result.status, "SUCCEEDED");
  assert.equal(secondRun.result.counts.recordsFound, 6);
  assert.equal(secondRun.result.counts.recordsUpdated, 4); // 4 existing updated
  assert.equal(secondRun.result.counts.recordsNew, 2);     // 2 new added
  assert.equal(secondRun.result.counts.recordsSaved, 6);
});

test("R1: Interruption saves checkpoint and allows safe, non-duplicating resume (Finding T06)", async () => {
  const repo = new InMemoryIngestRepository();
  const operator = { email: "curator@thaiatlas.org", kind: "operator" };
  const sources = makeSampleSources(10); // 10 records, batchSize = 3 -> 4 batches (3, 3, 3, 1)

  const jobId = "job_recoverable_demo_01";

  // Simulate interruption during batch 2
  const interruptedRun = await executeIngestionJob({
    actor: operator,
    adapter: "OPENALEX",
    batchSize: 3,
    jobId,
    query: "hospital humanoid robot",
    records: sources,
    repository: repo,
    simulateInterruptionAtBatch: 2
  });

  assert.equal(interruptedRun.ok, false);
  if (interruptedRun.ok) return;
  assert.equal(interruptedRun.code, "EXECUTION_FAILED");
  assert.equal(interruptedRun.result?.status, "FAILED");
  // Batch 1 (3 records) was committed before batch 2 interruption
  assert.equal(interruptedRun.result?.counts.recordsProcessed, 3);
  assert.equal(interruptedRun.result?.counts.recordsNew, 3);

  // Checkpoint is persisted in repository
  const cp = await repo.getCheckpoint(jobId);
  assert.notEqual(cp, null);
  assert.equal(cp?.lastProcessedIndex, 3);
  assert.equal(cp?.completedUrls.length, 3);

  // Status in database is FAILED with exact progress, NOT indefinitely RUNNING
  const jobState = await repo.getJob(jobId);
  assert.equal(jobState?.status, "FAILED");
  assert.equal(jobState?.recordsSaved, 3);

  // Resume the job with the same jobId
  const resumedRun = await executeIngestionJob({
    actor: operator,
    adapter: "OPENALEX",
    batchSize: 3,
    jobId,
    query: "hospital humanoid robot",
    records: sources,
    repository: repo
  });

  assert.equal(resumedRun.ok, true);
  if (!resumedRun.ok) return;
  assert.equal(resumedRun.result.status, "SUCCEEDED");
  assert.equal(resumedRun.result.isResumed, true);
  assert.equal(resumedRun.result.counts.recordsFound, 10);
  assert.equal(resumedRun.result.counts.recordsProcessed, 10);
  assert.equal(resumedRun.result.counts.recordsNew, 10);
  assert.equal(resumedRun.result.counts.recordsSaved, 10);

  // Confirmed that batches 2, 3, 4 were executed and completed without repeating batch 1
  const finalJobState = await repo.getJob(jobId);
  assert.equal(finalJobState?.status, "SUCCEEDED");
  assert.equal(finalJobState?.recordsSaved, 10);
});

test("R1: Batch execution failure marks job FAILED and preserves partial progress", async () => {
  const repo = new InMemoryIngestRepository();
  const operator = { email: "operator@thaiatlas.org", kind: "operator" };
  const sources = makeSampleSources(6); // 2 batches of 3
  const jobId = "job_fault_test_01";

  // Tell repo to fail on batch 2
  let batchCount = 0;
  const originalSave = repo.saveBatch.bind(repo);
  repo.saveBatch = async (records, id) => {
    batchCount++;
    if (batchCount === 2) {
      throw new Error("Simulated transient connection timeout");
    }
    return originalSave(records, id);
  };

  const failedRun = await executeIngestionJob({
    actor: operator,
    adapter: "OPENALEX",
    batchSize: 3,
    jobId,
    query: "humanoid Thai survey",
    records: sources,
    repository: repo
  });

  assert.equal(failedRun.ok, false);
  if (failedRun.ok) return;
  assert.equal(failedRun.code, "EXECUTION_FAILED");
  assert.equal(failedRun.result?.status, "FAILED");
  assert.match(failedRun.result?.errorMessage ?? "", /Simulated transient connection timeout/);

  // Batch 1 (3 records) progress is safely preserved
  assert.equal(failedRun.result?.counts.recordsNew, 3);
  assert.equal(failedRun.result?.counts.recordsFailed, 3);
});

test("R1: Optional provider credentials produce warning, not false SKIPPED_MISSING_KEY (Finding D13)", async () => {
  const repo = new InMemoryIngestRepository();
  const operator = { email: "curator@thaiatlas.org", kind: "operator" };
  const githubSources = makeSampleSources(3).map((s) => ({ ...s, sourceType: "GITHUB" as const, platform: "github" }));

  // GitHub pull without token: has missingKeys: ["GITHUB_TOKEN optional"]
  const githubOutcome = await executeIngestionJob({
    actor: operator,
    adapter: "GITHUB",
    missingKeys: ["GITHUB_TOKEN optional"],
    query: "thailand-robotics",
    records: githubSources,
    repository: repo
  });

  assert.equal(githubOutcome.ok, true);
  if (!githubOutcome.ok) return;
  // MUST NOT be SKIPPED_MISSING_KEY when records were fetched
  assert.equal(githubOutcome.result.status, "SUCCEEDED");
  assert.equal(githubOutcome.result.hasOptionalKeyWarning, true);
  assert.equal(githubOutcome.result.counts.recordsSaved, 3);
  assert.match(githubOutcome.result.warnings[0], /Optional provider credentials omitted/);

  // True mandatory missing key (e.g. YouTube API key absent with 0 records)
  const youtubeOutcome = await executeIngestionJob({
    actor: operator,
    adapter: "YOUTUBE",
    missingKeys: ["YOUTUBE_API_KEY"],
    query: "humanoid demonstration",
    records: [],
    repository: repo
  });

  assert.equal(youtubeOutcome.ok, true);
  if (!youtubeOutcome.ok) return;
  assert.equal(youtubeOutcome.result.status, "SKIPPED_MISSING_KEY");
  assert.equal(youtubeOutcome.result.counts.recordsSaved, 0);
});

