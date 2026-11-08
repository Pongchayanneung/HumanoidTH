import { prisma } from "@/lib/prisma";
import type { SourceType, PullStatus } from "../../generated/prisma";
import type { NormalizedSource } from "@/lib/ingest/types";
import { canonicalizeUrl } from "@/lib/url";
import { saveSources } from "@/lib/ingest/save";
import { FileCheckpointStore } from "./checkpoint-store";
import {
  PartialBatchError,
  type BatchSaveResult,
  type IngestionJobRepository,
  IngestionJobRecord,
  IngestionCheckpoint
} from "./contracts";

export class PostgresIngestionJobRepository implements IngestionJobRepository {
  private client: typeof prisma;
  private checkpointStore: FileCheckpointStore;
  private saveRecords: (records: NormalizedSource[]) => Promise<unknown>;

  constructor(
    client: typeof prisma = prisma,
    checkpointStore?: FileCheckpointStore,
    saveRecords: (records: NormalizedSource[]) => Promise<unknown> = saveSources
  ) {
    this.client = client;
    this.checkpointStore = checkpointStore ?? new FileCheckpointStore();
    this.saveRecords = saveRecords;
  }

  async createJob(data: {
    id?: string;
    adapter: SourceType;
    query: string;
  }): Promise<IngestionJobRecord> {
    const created = await this.client.sourcePullJob.create({
      data: {
        adapter: data.adapter,
        id: data.id,
        query: data.query,
        startedAt: new Date(),
        status: "QUEUED"
      }
    });

    return {
      adapter: created.adapter,
      createdAt: created.createdAt,
      errorMessage: created.errorMessage,
      finishedAt: created.finishedAt,
      id: created.id,
      query: created.query,
      recordsFound: created.recordsFound,
      recordsSaved: created.recordsSaved,
      startedAt: created.startedAt,
      status: created.status
    };
  }

  async getJob(jobId: string): Promise<IngestionJobRecord | null> {
    const job = await this.client.sourcePullJob.findUnique({
      where: { id: jobId }
    });
    if (!job) return null;

    return {
      adapter: job.adapter,
      createdAt: job.createdAt,
      errorMessage: job.errorMessage,
      finishedAt: job.finishedAt,
      id: job.id,
      query: job.query,
      recordsFound: job.recordsFound,
      recordsSaved: job.recordsSaved,
      startedAt: job.startedAt,
      status: job.status
    };
  }

  async updateJobStatus(
    jobId: string,
    update: {
      status: PullStatus;
      recordsFound?: number;
      recordsSaved?: number;
      errorMessage?: string | null;
      finishedAt?: Date | null;
    }
  ): Promise<IngestionJobRecord> {
    const updated = await this.client.sourcePullJob.update({
      data: {
        errorMessage: update.errorMessage,
        finishedAt: update.finishedAt,
        recordsFound: update.recordsFound,
        recordsSaved: update.recordsSaved,
        status: update.status
      },
      where: { id: jobId }
    });

    return {
      adapter: updated.adapter,
      createdAt: updated.createdAt,
      errorMessage: updated.errorMessage,
      finishedAt: updated.finishedAt,
      id: updated.id,
      query: updated.query,
      recordsFound: updated.recordsFound,
      recordsSaved: updated.recordsSaved,
      startedAt: updated.startedAt,
      status: updated.status
    };
  }

  async saveCheckpoint(checkpoint: IngestionCheckpoint): Promise<void> {
    await this.checkpointStore.save(checkpoint);
  }

  async getCheckpoint(jobId: string): Promise<IngestionCheckpoint | null> {
    return await this.checkpointStore.get(jobId);
  }

  async saveBatch(records: NormalizedSource[], _jobId: string): Promise<BatchSaveResult> {
    let newCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const committedUrls: string[] = [];
    const seenInBatch = new Set<string>();

    // Pre-check existing records to distinguish new from updated (Finding D13)
    const urls = records.map((r) => canonicalizeUrl(r.url)).filter(Boolean);
    const existing = await this.client.sourceRecord.findMany({
      select: { id: true, url: true },
      where: { url: { in: urls } }
    });
    const existingUrlSet = new Set(existing.map((e) => e.url));

    const summarize = async (): Promise<BatchSaveResult> => {
      const saved = committedUrls.length
        ? await this.client.sourceRecord.findMany({
            select: { id: true, relevanceStatus: true },
            where: { url: { in: committedUrls } }
          })
        : [];
      return {
        acceptedCount: saved.filter((r) => r.relevanceStatus === "ACCEPTED").length,
        newCount,
        rejectedCount: saved.filter((r) => r.relevanceStatus === "REJECTED").length,
        savedIds: saved.map((r) => r.id),
        skippedCount,
        uncertainCount: saved.filter(
          (r) => r.relevanceStatus !== "ACCEPTED" && r.relevanceStatus !== "REJECTED"
        ).length,
        updatedCount
      };
    };

    // saveSources commits each record in its own transaction, so persist one record
    // at a time and report exactly how many were committed if a later one fails.
    for (let index = 0; index < records.length; index++) {
      const url = canonicalizeUrl(records[index].url);
      if (!url || seenInBatch.has(url)) {
        skippedCount++;
        continue;
      }

      try {
        await this.saveRecords([records[index]]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const partial = await summarize().catch(() => ({
          acceptedCount: 0, newCount, rejectedCount: 0, savedIds: [], skippedCount, uncertainCount: 0, updatedCount
        }));
        throw new PartialBatchError(message, index, partial);
      }

      seenInBatch.add(url);
      committedUrls.push(url);
      if (existingUrlSet.has(url)) {
        updatedCount++;
      } else {
        newCount++;
      }
    }

    return await summarize();
  }
}
