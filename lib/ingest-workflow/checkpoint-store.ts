import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import type { IngestionCheckpoint } from "./contracts";

export class FileCheckpointStore {
  private baseDir: string;

  constructor(baseDir: string = resolve(process.cwd(), ".ingest-checkpoints")) {
    this.baseDir = baseDir;
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private getFilePath(jobId: string): string {
    const safeId = jobId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.baseDir, `checkpoint-${safeId}.json`);
  }

  async save(checkpoint: IngestionCheckpoint): Promise<void> {
    const file = this.getFilePath(checkpoint.jobId);
    writeFileSync(file, JSON.stringify(checkpoint, null, 2), "utf8");
  }

  async get(jobId: string): Promise<IngestionCheckpoint | null> {
    const file = this.getFilePath(jobId);
    if (!existsSync(file)) return null;
    const raw = readFileSync(file, "utf8");
    return JSON.parse(raw) as IngestionCheckpoint;
  }

  async clear(jobId: string): Promise<void> {
    rmSync(this.getFilePath(jobId), { force: true });
  }
}

