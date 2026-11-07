/**
 * R2 Source Claim Versioning & Conflict Detection Contracts
 *
 * Implements acceptance criteria for Issue #26 (Findings T07 & D06):
 * 1. Identifiable source/assertion versions and reproducible snapshots.
 * 2. Stale derived claim retirement on correction or rejection.
 * 3. Optimistic Concurrency Control (OCC) to detect concurrent edit conflicts.
 * 4. Transactional atomicity, retry safety, and shared operator access policy.
 */

export type ClaimRelevanceStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "UNCERTAIN";

export interface SourceClaimRecord {
  id: string;
  sourceType: string;
  title: string;
  url: string;
  excerpt: string;
  publishedAt: Date | null;
  author: string | null;
  platform: string | null;
  rawMeta: Record<string, unknown>;
  relevanceStatus: ClaimRelevanceStatus;
  relevanceReason: string | null;
  relevanceConfidence: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PerspectiveAssertionItem {
  id?: string;
  perspectiveTheme: string;
  stance: string;
  sentiment: string;
  targetEntity: string;
  evidenceExcerpt: string;
  confidence: number;
  method: string;
}

export interface TripletAssertionItem {
  id?: string;
  subject: string;
  relation: string;
  object: string;
  confidence: number;
}

export interface AssertionSnapshot {
  perspectives: PerspectiveAssertionItem[];
  triplets: TripletAssertionItem[];
}

export interface SourceSnapshotData {
  title: string;
  url: string;
  excerpt: string;
  sourceType: string;
  relevanceStatus: ClaimRelevanceStatus;
  relevanceReason: string | null;
  relevanceConfidence: number;
  author: string | null;
  platform: string | null;
  publishedAt: string | null;
}

export interface SnapshotMetadata {
  actor: string;
  reason: string;
  timestamp: string;
  parentVersion?: number;
  parentSnapshotHash?: string;
}

export interface ReproducibleSourceSnapshot {
  snapshotId: string;
  sourceId: string;
  version: number;
  contentHash: string;
  assertionsHash: string;
  snapshotHash: string;
  relevanceStatus: ClaimRelevanceStatus;
  source: SourceSnapshotData;
  assertions: AssertionSnapshot;
  metadata: SnapshotMetadata;
}

export interface VersionHistoryEntry {
  version: number;
  contentHash: string;
  assertionsHash: string;
  snapshotHash: string;
  relevanceStatus: ClaimRelevanceStatus;
  actor: string;
  reason: string;
  updatedAt: string;
}

export interface SourceVersioningMeta {
  version: number;
  contentHash: string;
  assertionsHash: string;
  snapshotHash: string;
  status: "ACTIVE" | "SUPERSEDED" | "RETIRED";
  lastUpdatedBy: string;
  revisionReason: string;
  updatedAt: string;
  history?: VersionHistoryEntry[];
}

export interface UpdateSourceClaimInput {
  sourceId: string;
  expectedVersion: number;
  expectedContentHash?: string;
  actor: { email: string; role?: string } | { kind: "operator"; email: string };
  reason: string;
  patch: {
    title?: string;
    excerpt?: string;
    relevanceStatus?: ClaimRelevanceStatus;
    relevanceReason?: string | null;
    relevanceConfidence?: number;
    author?: string | null;
    platform?: string | null;
  };
  perspectives?: PerspectiveAssertionItem[];
  triplets?: TripletAssertionItem[];
}

export type UpdateSourceClaimResult =
  | {
      ok: true;
      sourceId: string;
      version: number;
      snapshotHash: string;
      snapshot: ReproducibleSourceSnapshot;
      suppressedAssertionsCount: number;
      activePerspectivesCount: number;
      activeTripletsCount: number;
    }
  | {
      ok: false;
      code: "STALE_VERSION_CONFLICT";
      message: string;
      currentVersion: number;
      expectedVersion: number;
      currentContentHash: string;
      expectedContentHash?: string;
      currentSnapshot: ReproducibleSourceSnapshot;
    }
  | {
      ok: false;
      code: "UNAUTHORIZED";
      message: string;
    }
  | {
      ok: false;
      code: "NOT_FOUND";
      message: string;
    }
  | {
      ok: false;
      code: "INVALID_INPUT";
      message: string;
    };

export interface SourceClaimUpdatePatch {
  title?: string;
  excerpt?: string;
  relevanceStatus?: ClaimRelevanceStatus;
  relevanceReason?: string | null;
  relevanceConfidence?: number;
  author?: string | null;
  platform?: string | null;
}

export interface ClaimVersioningRepository {
  findSourceWithClaims(sourceId: string): Promise<{
    source: SourceClaimRecord | null;
    perspectives: PerspectiveAssertionItem[];
    triplets: TripletAssertionItem[];
  }>;

  executeAtomicUpdate(
    sourceId: string,
    updateFn: (current: {
      source: SourceClaimRecord;
      perspectives: PerspectiveAssertionItem[];
      triplets: TripletAssertionItem[];
    }) => Promise<{
      updatedSource: SourceClaimUpdatePatch & { rawMeta: Record<string, unknown> };
      perspectivesToKeep?: PerspectiveAssertionItem[];
      tripletsToKeep?: TripletAssertionItem[];
      retireAllDerivedClaims?: boolean;
    }>
  ): Promise<{
    source: SourceClaimRecord;
    perspectives: PerspectiveAssertionItem[];
    triplets: TripletAssertionItem[];
    suppressedCount: number;
  }>;
}
