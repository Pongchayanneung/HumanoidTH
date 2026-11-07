import { prisma } from "@/lib/prisma";
import type { SourceType, PullStatus } from "../../generated/prisma";
import type { NormalizedSource } from "@/lib/ingest/types";
import { canonicalizeUrl } from "@/lib/url";
import { saveSources } from "@/lib/ingest/save";
import { FileCheckpointStore } from "./checkpoint-store";
import type {
  IngestionJobRepository,
  IngestionJobRecord,
  IngestionCheckpoint
} from "./contracts";

export class PostgresIngestionJobRepository implements IngestionJobRepository {
  private client: typeof prisma;
  private checkpointStore: FileCheckpointStore;

  constructor(client: typeof prisma = prisma, checkpointStore?: FileCheckpointStore) {
    this.client = client;
    this.checkpointStore = checkpointStore ?? new FileCheckpointStore();
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

  async saveBatch(
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
  }> {
    let newCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let acceptedCount = 0;
    let rejectedCount = 0;
    let uncertainCount = 0;
    const savedIds: string[] = [];

    // Pre-check existing records to distinguish new from updated (Finding D13)
    const urls = records.map((r) => canonicalizeUrl(r.url)).filter(Boolean);
    const existing = await this.client.sourceRecord.findMany({
      select: { id: true, url: true },
      where: { url: { in: urls } }
    });
    const existingUrlSet = new Set(existing.map((e) => e.url));

    for (const record of records) {
      const url = canonicalizeUrl(record.url);
      if (!url) {
        skippedCount++;
        continue;
      }

      if (existingUrlSet.has(url)) {
        updatedCount++;
      } else {
        newCount++;
        existingUrlSet.add(url);
      }
    }

    // Call aligned saveSources inside atomic transaction
    await saveSources(records);

    // Fetch the persisted records to collect IDs and relevance breakdown
    const savedRecords = await this.client.sourceRecord.findMany({
      select: { id: true, relevanceStatus: true },
      where: { url: { in: urls } }
    });

    for (const r of savedRecords) {
      savedIds.push(r.id);
      if (r.relevanceStatus === "ACCEPTED") acceptedCount++;
      else if (r.relevanceStatus === "REJECTED") rejectedCount++;
      else uncertainCount++;
    }

    return {
      acceptedCount,
      newCount,
      rejectedCount,
      savedIds,
      skippedCount,
      uncertainCount,
      updatedCount
    };
  }
}

