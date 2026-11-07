import { createHash } from "node:crypto";
import type {
  SourceClaimRecord,
  PerspectiveAssertionItem,
  TripletAssertionItem,
  AssertionSnapshot,
  SourceSnapshotData,
  ReproducibleSourceSnapshot,
  SourceVersioningMeta,
  VersionHistoryEntry,
  UpdateSourceClaimInput,
  UpdateSourceClaimResult,
  ClaimVersioningRepository,
  ClaimRelevanceStatus
} from "./contracts";

/**
 * Deterministically serialize any object into canonical JSON with sorted keys.
 */
export function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries = keys.map((key) => {
    const val = (obj as Record<string, unknown>)[key];
    return `${JSON.stringify(key)}:${canonicalJson(val)}`;
  });
  return `{${entries.join(",")}}`;
}

/**
 * Compute SHA-256 digest of a string.
 */
export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Deterministic hash of source content fields.
 */
export function computeSourceContentHash(source: {
  title: string;
  url: string;
  excerpt: string;
  sourceType: string;
  relevanceStatus: string;
  relevanceReason?: string | null;
  relevanceConfidence?: number;
  author?: string | null;
  platform?: string | null;
  publishedAt?: Date | string | null;
}): string {
  const normalized = {
    author: source.author ?? null,
    excerpt: source.excerpt ?? "",
    platform: source.platform ?? null,
    publishedAt: source.publishedAt ? new Date(source.publishedAt).toISOString() : null,
    relevanceConfidence: Number((source.relevanceConfidence ?? 0).toFixed(4)),
    relevanceReason: source.relevanceReason ?? null,
    relevanceStatus: source.relevanceStatus,
    sourceType: source.sourceType,
    title: source.title ?? "",
    url: source.url ?? ""
  };
  return sha256Hex(canonicalJson(normalized));
}

/**
 * Deterministic hash of derived assertions (perspectives and triplets).
 */
export function computeAssertionsHash(
  perspectives: PerspectiveAssertionItem[],
  triplets: TripletAssertionItem[]
): string {
  // Canonical sort of perspectives
  const sortedPerspectives = [...perspectives]
    .map((p) => ({
      confidence: Number((p.confidence ?? 0).toFixed(4)),
      evidenceExcerpt: p.evidenceExcerpt ?? "",
      method: p.method ?? "",
      perspectiveTheme: p.perspectiveTheme ?? "",
      sentiment: p.sentiment ?? "",
      stance: p.stance ?? "",
      targetEntity: p.targetEntity ?? ""
    }))
    .sort((a, b) => {
      const keyA = `${a.perspectiveTheme}::${a.targetEntity}::${a.evidenceExcerpt}`;
      const keyB = `${b.perspectiveTheme}::${b.targetEntity}::${b.evidenceExcerpt}`;
      return keyA.localeCompare(keyB);
    });

  // Canonical sort of triplets
  const sortedTriplets = [...triplets]
    .map((t) => ({
      confidence: Number((t.confidence ?? 0).toFixed(4)),
      object: t.object ?? "",
      relation: t.relation ?? "",
      subject: t.subject ?? ""
    }))
    .sort((a, b) => {
      const keyA = `${a.subject}::${a.relation}::${a.object}`;
      const keyB = `${b.subject}::${b.relation}::${b.object}`;
      return keyA.localeCompare(keyB);
    });

  return sha256Hex(canonicalJson({ perspectives: sortedPerspectives, triplets: sortedTriplets }));
}

/**
 * Deterministic hash of snapshot combining source content hash, assertions hash, and lineage.
 */
export function computeSnapshotHash(
  contentHash: string,
  assertionsHash: string,
  version: number,
  parentSnapshotHash?: string
): string {
  return sha256Hex(
    canonicalJson({
      assertionsHash,
      contentHash,
      parentSnapshotHash: parentSnapshotHash ?? null,
      version
    })
  );
}

/**
 * Builds a reproducible source snapshot object.
 */
export function buildSourceSnapshot(
  source: SourceClaimRecord,
  perspectives: PerspectiveAssertionItem[],
  triplets: TripletAssertionItem[],
  actor?: string,
  reason?: string,
  parentVersion?: number,
  parentSnapshotHash?: string
): ReproducibleSourceSnapshot {
  const versioning = (source.rawMeta?._versioning ?? {}) as Partial<SourceVersioningMeta>;
  const version = versioning.version ?? 1;

  const contentHash = computeSourceContentHash(source);
  const assertionsHash = computeAssertionsHash(perspectives, triplets);
  const snapshotHash = computeSnapshotHash(contentHash, assertionsHash, version, parentSnapshotHash);

  const sourceData: SourceSnapshotData = {
    author: source.author,
    excerpt: source.excerpt,
    platform: source.platform,
    publishedAt: source.publishedAt ? new Date(source.publishedAt).toISOString() : null,
    relevanceConfidence: source.relevanceConfidence,
    relevanceReason: source.relevanceReason,
    relevanceStatus: source.relevanceStatus,
    sourceType: source.sourceType,
    title: source.title,
    url: source.url
  };

  const assertions: AssertionSnapshot = {
    perspectives: perspectives.map((p) => ({
      confidence: p.confidence,
      evidenceExcerpt: p.evidenceExcerpt,
      id: p.id,
      method: p.method,
      perspectiveTheme: p.perspectiveTheme,
      sentiment: p.sentiment,
      stance: p.stance,
      targetEntity: p.targetEntity
    })),
    triplets: triplets.map((t) => ({
      confidence: t.confidence,
      id: t.id,
      object: t.object,
      relation: t.relation,
      subject: t.subject
    }))
  };

  return {
    assertions,
    assertionsHash,
    contentHash,
    metadata: {
      actor: actor ?? versioning.lastUpdatedBy ?? "system",
      parentSnapshotHash,
      parentVersion,
      reason: reason ?? versioning.revisionReason ?? "Initial snapshot",
      timestamp: versioning.updatedAt ?? (source.updatedAt ? new Date(source.updatedAt).toISOString() : new Date().toISOString())
    },
    relevanceStatus: source.relevanceStatus,
    snapshotHash,
    snapshotId: `snapshot:${source.id}:v${version}`,
    source: sourceData,
    sourceId: source.id,
    version
  };
}

/**
 * Verify cryptographic integrity of a reproducible source snapshot.
 */
export function verifySnapshotIntegrity(snapshot: ReproducibleSourceSnapshot): {
  isValid: boolean;
  mismatches: string[];
} {
  const mismatches: string[] = [];

  const computedContentHash = computeSourceContentHash(snapshot.source);
  if (computedContentHash !== snapshot.contentHash) {
    mismatches.push(`Content hash mismatch: expected ${snapshot.contentHash}, computed ${computedContentHash}`);
  }

  const computedAssertionsHash = computeAssertionsHash(
    snapshot.assertions.perspectives,
    snapshot.assertions.triplets
  );
  if (computedAssertionsHash !== snapshot.assertionsHash) {
    mismatches.push(`Assertions hash mismatch: expected ${snapshot.assertionsHash}, computed ${computedAssertionsHash}`);
  }

  const computedSnapshotHash = computeSnapshotHash(
    snapshot.contentHash,
    snapshot.assertionsHash,
    snapshot.version,
    snapshot.metadata.parentSnapshotHash
  );
  if (computedSnapshotHash !== snapshot.snapshotHash) {
    mismatches.push(`Snapshot hash mismatch: expected ${snapshot.snapshotHash}, computed ${computedSnapshotHash}`);
  }

  return {
    isValid: mismatches.length === 0,
    mismatches
  };
}

/**
 * Check if the actor is authorized to update editorial source claims.
 */
export function isAuthorizedOperator(actor: unknown): boolean {
  if (!actor || typeof actor !== "object") return false;
  const a = actor as Record<string, unknown>;

  // Check OperatorPrincipal: { kind: "operator", email: string }
  if (a.kind === "operator" && typeof a.email === "string" && a.email.includes("@")) {
    return true;
  }

  // Check User role / email: { email: string, role?: string }
  if (typeof a.email === "string" && a.email.includes("@")) {
    if (a.role === "ADMIN" || a.role === "RESEARCHER" || a.role === undefined) {
      return true;
    }
  }

  return false;
}

/**
 * Atomic update of a source claim with OCC, stale assertion suppression, and version history.
 */
export async function updateSourceClaim(
  input: UpdateSourceClaimInput,
  repository: ClaimVersioningRepository
): Promise<UpdateSourceClaimResult> {
  // 1. Operator Auth Gate: Fail closed
  if (!isAuthorizedOperator(input.actor)) {
    return {
      code: "UNAUTHORIZED",
      message: "Editorial source updates require authenticated operator credentials.",
      ok: false
    };
  }

  // 2. Input validation
  if (!input.sourceId || typeof input.expectedVersion !== "number" || input.expectedVersion < 0) {
    return {
      code: "INVALID_INPUT",
      message: "sourceId and a non-negative expectedVersion integer are required.",
      ok: false
    };
  }

  // 3. Find current record and active assertions
  const current = await repository.findSourceWithClaims(input.sourceId);
  if (!current.source) {
    return {
      code: "NOT_FOUND",
      message: `Source record ${input.sourceId} does not exist.`,
      ok: false
    };
  }

  const currentRawMeta = (current.source.rawMeta ?? {}) as Record<string, unknown>;
  const currentVersioning = (currentRawMeta._versioning ?? {}) as Partial<SourceVersioningMeta>;
  const currentVersion = currentVersioning.version ?? 1;
  const currentContentHash = computeSourceContentHash(current.source);

  // 4. Optimistic Concurrency Control (OCC) Check
  if (currentVersion !== input.expectedVersion) {
    const currentSnapshot = buildSourceSnapshot(
      current.source,
      current.perspectives,
      current.triplets
    );
    return {
      code: "STALE_VERSION_CONFLICT",
      currentContentHash,
      currentSnapshot,
      currentVersion,
      expectedVersion: input.expectedVersion,
      message: `Conflict detected: record is at version ${currentVersion}, but edit targeted version ${input.expectedVersion}. Another reviewer updated this record.`,
      ok: false
    };
  }

  if (input.expectedContentHash && currentContentHash !== input.expectedContentHash) {
    const currentSnapshot = buildSourceSnapshot(
      current.source,
      current.perspectives,
      current.triplets
    );
    return {
      code: "STALE_VERSION_CONFLICT",
      currentContentHash,
      currentSnapshot,
      currentVersion,
      expectedContentHash: input.expectedContentHash,
      expectedVersion: input.expectedVersion,
      message: `Conflict detected: record content hash (${currentContentHash}) does not match expected hash (${input.expectedContentHash}).`,
      ok: false
    };
  }

  // 5. Compute new state and version
  const newVersion = currentVersion + 1;
  const targetStatus: ClaimRelevanceStatus =
    input.patch.relevanceStatus ?? current.source.relevanceStatus;

  const actorEmail = "email" in input.actor ? input.actor.email : "operator";
  const nowIso = new Date().toISOString();

  let perspectivesToKeep: PerspectiveAssertionItem[] = [];
  let tripletsToKeep: TripletAssertionItem[] = [];
  let retireAllDerivedClaims = false;

  if (targetStatus !== "ACCEPTED") {
    // Suppression on retirement/rejection: Derived claims are obsolete and must be retired!
    retireAllDerivedClaims = true;
    perspectivesToKeep = [];
    tripletsToKeep = [];
  } else {
    // If source is ACCEPTED, update assertions:
    // If explicit assertions provided in input, use them (superseding older assertions)
    // Otherwise retain current assertions
    perspectivesToKeep = input.perspectives !== undefined ? input.perspectives : current.perspectives;
    tripletsToKeep = input.triplets !== undefined ? input.triplets : current.triplets;
  }

  const updatedSourceFields = {
    ...current.source,
    ...input.patch,
    relevanceStatus: targetStatus
  };

  const newContentHash = computeSourceContentHash(updatedSourceFields);
  const newAssertionsHash = computeAssertionsHash(perspectivesToKeep, tripletsToKeep);
  const newSnapshotHash = computeSnapshotHash(
    newContentHash,
    newAssertionsHash,
    newVersion,
    currentVersioning.snapshotHash
  );

  const existingHistory = currentVersioning.history ?? [
    {
      actor: currentVersioning.lastUpdatedBy ?? "system",
      assertionsHash: currentVersioning.assertionsHash ?? computeAssertionsHash(current.perspectives, current.triplets),
      contentHash: currentContentHash,
      reason: currentVersioning.revisionReason ?? "Initial baseline revision",
      relevanceStatus: current.source.relevanceStatus,
      snapshotHash: currentVersioning.snapshotHash ?? computeSnapshotHash(currentContentHash, computeAssertionsHash(current.perspectives, current.triplets), currentVersion),
      updatedAt: currentVersioning.updatedAt ?? (current.source.updatedAt ? new Date(current.source.updatedAt).toISOString() : nowIso),
      version: currentVersion
    }
  ];

  const newHistoryEntry: VersionHistoryEntry = {
    actor: actorEmail,
    assertionsHash: newAssertionsHash,
    contentHash: newContentHash,
    reason: input.reason,
    relevanceStatus: targetStatus,
    snapshotHash: newSnapshotHash,
    updatedAt: nowIso,
    version: newVersion
  };

  const newVersioning: SourceVersioningMeta = {
    assertionsHash: newAssertionsHash,
    contentHash: newContentHash,
    history: [...existingHistory, newHistoryEntry],
    lastUpdatedBy: actorEmail,
    revisionReason: input.reason,
    snapshotHash: newSnapshotHash,
    status: targetStatus === "ACCEPTED" ? "ACTIVE" : "RETIRED",
    updatedAt: nowIso,
    version: newVersion
  };

  // 6. Execute atomic update
  const atomicResult = await repository.executeAtomicUpdate(input.sourceId, async () => {
    return {
      perspectivesToKeep,
      retireAllDerivedClaims,
      tripletsToKeep,
      updatedSource: {
        ...input.patch,
        rawMeta: {
          ...currentRawMeta,
          _versioning: newVersioning
        },
        relevanceStatus: targetStatus
      }
    };
  });

  // 7. Construct and verify final snapshot
  const snapshot = buildSourceSnapshot(
    atomicResult.source,
    atomicResult.perspectives,
    atomicResult.triplets,
    actorEmail,
    input.reason,
    currentVersion,
    currentVersioning.snapshotHash
  );

  return {
    activePerspectivesCount: atomicResult.perspectives.length,
    activeTripletsCount: atomicResult.triplets.length,
    ok: true,
    snapshot,
    snapshotHash: newSnapshotHash,
    sourceId: input.sourceId,
    suppressedAssertionsCount: atomicResult.suppressedCount,
    version: newVersion
  };
}
