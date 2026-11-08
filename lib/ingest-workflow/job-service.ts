import type { SourceType } from "../../generated/prisma";
import type { NormalizedSource } from "@/lib/ingest/types";
import {
  type IngestionJobRepository,
  type IngestionCounts,
  type IngestionCheckpoint,
  type IngestionJobResult,
  type JobExecutionOutcome,
  PartialBatchError,
  isPermittedAdapter
} from "./contracts";

import { createHash } from "node:crypto";
import { runtimeOperatorAuth } from "../operator-auth/runtime";
import type { SessionResult } from "../operator-auth/contracts";

export interface IngestionExecutionOptions {
  jobId?: string;
  adapter: string;
  query: string;
  records: NormalizedSource[];
  missingKeys?: string[];
  batchSize?: number;
  actor: unknown;
  repository: IngestionJobRepository;
  simulateInterruptionAtBatch?: number;
}

/**
 * Executes or resumes an ingestion job.
 */
export function createIngestionJobExecutor(authorize: (token?: string) => Promise<SessionResult>) {
return async function executeIngestionJob(
  options: IngestionExecutionOptions
): Promise<JobExecutionOutcome> {
  const {
    adapter,
    query,
    records,
    missingKeys = [],
    batchSize = 5,
    actor,
    repository,
    simulateInterruptionAtBatch
  } = options;

  // 1. M2 Authorization Gate: Fail closed
  if (typeof actor !== "string" || !(await authorize(actor)).ok) {
    return {
      code: "UNAUTHORIZED",
      message: "Ingestion jobs require authenticated operator credentials.",
      ok: false
    };
  }

  // 2. Provider Policy: Check allowlist
  if (!isPermittedAdapter(adapter)) {
    return {
      code: "INVALID_PROVIDER",
      message: `Adapter ${adapter} is not permitted under the ingestion policy.`,
      ok: false
    };
  }

  const typedAdapter = adapter.toUpperCase() as SourceType;
  const effectiveBatchSize = Math.max(1, batchSize);

  const recordsHash = createHash("sha256").update(JSON.stringify(records)).digest("hex");

  // 3. Resolve existing checkpoint if resuming
  let jobId = options.jobId;
  let checkpoint: IngestionCheckpoint | null = null;
  let isResumed = false;

  if (jobId) {
    checkpoint = await repository.getCheckpoint(jobId);
    if (checkpoint) {
      if (checkpoint.adapter !== typedAdapter || checkpoint.query !== query ||
          checkpoint.totalRecords !== records.length || checkpoint.recordsHash !== recordsHash ||
          !Number.isInteger(checkpoint.lastProcessedIndex) || checkpoint.lastProcessedIndex < 0 || checkpoint.lastProcessedIndex > records.length) {
        return { ok: false, code: "INVALID_INPUT", message: "Job input does not match its checkpoint." };
      }
      isResumed = true;
    } else if (await repository.getJob(jobId)) {
      return { ok: false, code: "INVALID_INPUT", message: "Existing job has no checkpoint." };
    }
  }

  // 4. Initialize Job record if fresh
  if (!checkpoint) {
    const job = await repository.createJob({
      adapter: typedAdapter,
      id: jobId,
      query
    });
    jobId = job.id;
  }

  const finalJobId = jobId!;

  // 5. Handle missing keys without false positives (Finding D13)
  // If an optional token (like GITHUB_TOKEN) is absent, but records were fetched, it is NOT skipped!
  const hasOptionalKeyWarning = missingKeys.some((k) => k.toLowerCase().includes("optional"));
  const hasMandatoryMissingKey = missingKeys.some((k) => !k.toLowerCase().includes("optional"));
  const warnings: string[] = [];

  if (hasOptionalKeyWarning) {
    warnings.push("Optional provider credentials omitted; rate limits may apply.");
  }

  if (hasMandatoryMissingKey && records.length === 0) {
    await repository.updateJobStatus(finalJobId, {
      errorMessage: `Skipped: missing required credentials (${missingKeys.join(", ")})`,
      finishedAt: new Date(),
      recordsFound: 0,
      recordsSaved: 0,
      status: "SKIPPED_MISSING_KEY"
    });

    const emptyCounts: IngestionCounts = {
      acceptedCount: 0,
      recordsFailed: 0,
      recordsFound: 0,
      recordsNew: 0,
      recordsProcessed: 0,
      recordsSaved: 0,
      recordsSkipped: 0,
      recordsUpdated: 0,
      rejectedCount: 0,
      uncertainCount: 0
    };

    return {
      ok: true,
      result: {
        adapter: typedAdapter,
        counts: emptyCounts,
        errorMessage: `Skipped: missing required credentials (${missingKeys.join(", ")})`,
        hasOptionalKeyWarning,
        isResumed: false,
        jobId: finalJobId,
        persistedRecordIds: [],
        query,
        status: "SKIPPED_MISSING_KEY",
        warnings
      }
    };
  }

  // 6. Resume from checkpoint or start from index 0
  let startIndex = 0;
  let counts: IngestionCounts = {
    acceptedCount: 0,
    recordsFailed: 0,
    recordsFound: records.length,
    recordsNew: 0,
    recordsProcessed: 0,
    recordsSaved: 0,
    recordsSkipped: 0,
    recordsUpdated: 0,
    rejectedCount: 0,
    uncertainCount: 0
  };
  let persistedRecordIds: string[] = [];
  let completedUrls: string[] = [];

  if (checkpoint) {
    startIndex = checkpoint.lastProcessedIndex;
    counts = { ...checkpoint.counts, recordsFound: records.length, recordsFailed: 0 };
    persistedRecordIds = [...checkpoint.persistedRecordIds];
    completedUrls = [...checkpoint.completedUrls];
  } else {
    await repository.updateJobStatus(finalJobId, {
      recordsFound: records.length,
      status: "RUNNING"
    });
  }

  // 7. Bounded batch execution with durable checkpoints
  let batchIndex = Math.floor(startIndex / effectiveBatchSize);

  for (let i = startIndex; i < records.length; i += effectiveBatchSize) {
    batchIndex++;

    // Simulated interruption at specific batch boundary (for testing recovery)
    if (simulateInterruptionAtBatch !== undefined && batchIndex === simulateInterruptionAtBatch) {
      const interruptCheckpoint: IngestionCheckpoint = {
        adapter: typedAdapter,
        completedUrls,
        counts,
        jobId: finalJobId,
        lastProcessedIndex: i,
        persistedRecordIds,
        query,
        recordsHash,
        totalRecords: records.length,
        updatedAt: new Date().toISOString()
      };

      await repository.saveCheckpoint(interruptCheckpoint);
      await repository.updateJobStatus(finalJobId, {
        errorMessage: `Interrupted at batch ${batchIndex} (${i} of ${records.length} processed)`,
        recordsFound: records.length,
        recordsSaved: counts.recordsNew + counts.recordsUpdated,
        status: "FAILED"
      });

      return {
        code: "EXECUTION_FAILED",
        message: `Job interrupted at batch ${batchIndex}. Progress saved at checkpoint.`,
        ok: false,
        result: {
          adapter: typedAdapter,
          checkpoint: interruptCheckpoint,
          counts,
          errorMessage: `Interrupted at batch ${batchIndex}`,
          hasOptionalKeyWarning,
          isResumed,
          jobId: finalJobId,
          persistedRecordIds,
          query,
          status: "FAILED",
          warnings
        }
      };
    }

    const batch = records.slice(i, i + effectiveBatchSize);

    try {
      const batchResult = await repository.saveBatch(batch, finalJobId);

      counts.recordsNew += batchResult.newCount;
      counts.recordsUpdated += batchResult.updatedCount;
      counts.recordsSkipped += batchResult.skippedCount;
      counts.acceptedCount += batchResult.acceptedCount;
      counts.rejectedCount += batchResult.rejectedCount;
      counts.uncertainCount += batchResult.uncertainCount;
      counts.recordsProcessed += batch.length;
      counts.recordsSaved = counts.recordsNew + counts.recordsUpdated;

      persistedRecordIds.push(...batchResult.savedIds);
      for (const rec of batch) {
        completedUrls.push(rec.url);
      }

      // Persist durable checkpoint after each committed batch
      const currentCheckpoint: IngestionCheckpoint = {
        adapter: typedAdapter,
        completedUrls,
        counts,
        jobId: finalJobId,
        lastProcessedIndex: i + batch.length,
        persistedRecordIds,
        query,
        recordsHash,
        totalRecords: records.length,
        updatedAt: new Date().toISOString()
      };

      await repository.saveCheckpoint(currentCheckpoint);
      await repository.updateJobStatus(finalJobId, {
        recordsFound: records.length,
        recordsSaved: counts.recordsSaved,
        status: "RUNNING"
      });
    } catch (err) {
      // Ingestion batch failed (e.g. database abort or rate limit)
      const errorMsg = err instanceof Error ? err.message : String(err);
      // Records committed before the failure stay counted; resume at the exact record boundary.
      const committed = err instanceof PartialBatchError ? err.committed : 0;
      if (err instanceof PartialBatchError) {
        counts.recordsNew += err.partial.newCount;
        counts.recordsUpdated += err.partial.updatedCount;
        counts.recordsSkipped += err.partial.skippedCount;
        counts.acceptedCount += err.partial.acceptedCount;
        counts.rejectedCount += err.partial.rejectedCount;
        counts.uncertainCount += err.partial.uncertainCount;
        counts.recordsProcessed += committed;
        counts.recordsSaved = counts.recordsNew + counts.recordsUpdated;
        persistedRecordIds.push(...err.partial.savedIds);
        for (const rec of batch.slice(0, committed)) {
          completedUrls.push(rec.url);
        }
      }
      counts.recordsFailed += batch.length - committed;

      const failedCheckpoint: IngestionCheckpoint = {
        adapter: typedAdapter,
        completedUrls,
        counts,
        jobId: finalJobId,
        lastProcessedIndex: i + committed,
        persistedRecordIds,
        query,
        recordsHash,
        totalRecords: records.length,
        updatedAt: new Date().toISOString()
      };

      await repository.saveCheckpoint(failedCheckpoint);
      await repository.updateJobStatus(finalJobId, {
        errorMessage: `Failed at batch ${batchIndex}: ${errorMsg}`,
        finishedAt: new Date(),
        recordsFound: records.length,
        recordsSaved: counts.recordsSaved,
        status: "FAILED"
      });

      return {
        code: "EXECUTION_FAILED",
        message: `Ingestion failed at batch ${batchIndex}: ${errorMsg}`,
        ok: false,
        result: {
          adapter: typedAdapter,
          checkpoint: failedCheckpoint,
          counts,
          errorMessage: errorMsg,
          hasOptionalKeyWarning,
          isResumed,
          jobId: finalJobId,
          persistedRecordIds,
          query,
          status: "FAILED",
          warnings
        }
      };
    }
  }

  // 8. Successful completion
  await repository.updateJobStatus(finalJobId, {
    errorMessage: null,
    finishedAt: new Date(),
    recordsFound: records.length,
    recordsSaved: counts.recordsSaved,
    status: "SUCCEEDED"
  });

  const finalResult: IngestionJobResult = {
    adapter: typedAdapter,
    counts,
    hasOptionalKeyWarning,
    isResumed,
    jobId: finalJobId,
    persistedRecordIds,
    query,
    status: "SUCCEEDED",
    warnings
  };

  return {
    ok: true,
    result: finalResult
  };
}
}

export const executeIngestionJob = createIngestionJobExecutor(runtimeOperatorAuth.readOperatorSession);
