/**
 * R1 Ingestion Job & Recoverable Checkpoint Contracts
 *
 * Implements acceptance criteria for Issue #25 (Findings T06 & D13):
 * 1. M2 Operator Authorization & explicit permitted-provider policy.
 * 2. Durable execution with resumable checkpoints and idempotent retries.
 * 3. Unified history distinguishing new, updated, partial, and failed outcomes.
 * 4. Transparent handling of optional provider tokens without false SKIPPED statuses.
 */

import type { SourceType, PullStatus } from "../../generated/prisma";
import type { NormalizedSource } from "@/lib/ingest/types";

export const PERMITTED_INGESTION_ADAPTERS: readonly SourceType[] = [
  "OPENALEX",
  "GITHUB",
  "GDELT",
  "YOUTUBE"
] as const;

export type PermittedAdapter = (typeof PERMITTED_INGESTION_ADAPTERS)[number];

export function isPermittedAdapter(adapter: string): adapter is PermittedAdapter {
  return PERMITTED_INGESTION_ADAPTERS.includes(adapter.toUpperCase() as PermittedAdapter);
}

export interface IngestionJobRecord {
  id: string;
  adapter: SourceType;
  query: string;
  status: PullStatus;
  recordsFound: number;
  recordsSaved: number;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

export interface IngestionCounts {
  recordsFound: number;
  recordsProcessed: number;
  recordsSaved: number;
  recordsNew: number;
  recordsUpdated: number;
  recordsSkipped: number;
  recordsFailed: number;
  acceptedCount: number;
  rejectedCount: number;
  uncertainCount: number;
}

export interface IngestionCheckpoint {
  jobId: string;
  adapter: SourceType;
  query: string;
  lastProcessedIndex: number;
  totalRecords: number;
  recordsHash: string;
  counts: IngestionCounts;
  completedUrls: string[];
  persistedRecordIds: string[];
  updatedAt: string;
}

export interface IngestionJobResult {
  jobId: string;
  adapter: SourceType;
  query: string;
  status: PullStatus;
  counts: IngestionCounts;
  persistedRecordIds: string[];
  warnings: string[];
  hasOptionalKeyWarning: boolean;
  isResumed: boolean;
  errorMessage?: string | null;
  checkpoint?: IngestionCheckpoint;
}

export type JobExecutionOutcome =
  | { ok: true; result: IngestionJobResult }
  | { ok: false; code: "UNAUTHORIZED"; message: string }
  | { ok: false; code: "INVALID_PROVIDER"; message: string }
  | { ok: false; code: "INVALID_INPUT"; message: string }
  | { ok: false; code: "JOB_NOT_FOUND"; message: string }
  | { ok: false; code: "EXECUTION_FAILED"; message: string; result?: IngestionJobResult };

export interface IngestionJobRepository {
  createJob(data: {
    id?: string;
    adapter: SourceType;
    query: string;
  }): Promise<IngestionJobRecord>;

  getJob(jobId: string): Promise<IngestionJobRecord | null>;

  updateJobStatus(
    jobId: string,
    update: {
      status: PullStatus;
      recordsFound?: number;
      recordsSaved?: number;
      errorMessage?: string | null;
      finishedAt?: Date | null;
    }
  ): Promise<IngestionJobRecord>;

  saveCheckpoint(checkpoint: IngestionCheckpoint): Promise<void>;

  getCheckpoint(jobId: string): Promise<IngestionCheckpoint | null>;

  saveBatch(
    records: NormalizedSource[],
    jobId: string
  ): Promise<{
    savedIds: string[];
    newCount: number;
    updatedCount: number;
    skippedCount: number;
    acceptedCount: number;
    rejectedCount: number;
    uncertainCount: number;
  }>;
}

