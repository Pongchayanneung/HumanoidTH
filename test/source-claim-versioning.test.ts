import test from "node:test";
import assert from "node:assert/strict";
import {
  computeSourceContentHash,
  computeAssertionsHash,
  computeSnapshotHash,
  buildSourceSnapshot,
  verifySnapshotIntegrity,
  updateSourceClaim,
  isAuthorizedOperator,
  type ClaimVersioningRepository,
  type SourceClaimRecord,
  type PerspectiveAssertionItem,
  type TripletAssertionItem,
  type UpdateSourceClaimInput
} from "../lib/claim-versioning";
import { revalidateSearchDocument } from "../lib/search/revalidation";
import { computeContentHash, computeDependencyHash } from "../lib/search/text-utils";
import type { SearchDocument } from "../lib/search/types";

/**
 * In-memory test repository simulating atomic database transactions and failures.
 */
class InMemoryClaimRepository implements ClaimVersioningRepository {
  public sources = new Map<string, SourceClaimRecord>();
  public perspectives = new Map<string, PerspectiveAssertionItem & { sourceId: string }>();
  public triplets = new Map<string, TripletAssertionItem & { sourceId: string }>();
  public shouldFailNextTransaction = false;

  constructor(
    initialSource?: SourceClaimRecord,
    initialPerspectives: PerspectiveAssertionItem[] = [],
    initialTriplets: TripletAssertionItem[] = []
  ) {
    if (initialSource) {
      this.sources.set(initialSource.id, { ...initialSource });
      for (const p of initialPerspectives) {
        const id = p.id ?? `pers_${Math.random().toString(36).substring(2, 9)}`;
        this.perspectives.set(id, { ...p, id, sourceId: initialSource.id });
      }
      for (const t of initialTriplets) {
        const id = t.id ?? `trip_${Math.random().toString(36).substring(2, 9)}`;
        this.triplets.set(id, { ...t, id, sourceId: initialSource.id });
      }
    }
  }

  async findSourceWithClaims(sourceId: string) {
    const source = this.sources.get(sourceId) ?? null;
    const perspectives: PerspectiveAssertionItem[] = [];
    for (const p of this.perspectives.values()) {
      if (p.sourceId === sourceId) perspectives.push({ ...p });
    }
    const triplets: TripletAssertionItem[] = [];
    for (const t of this.triplets.values()) {
      if (t.sourceId === sourceId) triplets.push({ ...t });
    }
    return {
      perspectives,
      source: source ? { ...source } : null,
      triplets
    };
  }

  async executeAtomicUpdate(
    sourceId: string,
    updateFn: (current: {
      source: SourceClaimRecord;
      perspectives: PerspectiveAssertionItem[];
      triplets: TripletAssertionItem[];
    }) => Promise<{
      updatedSource: Partial<SourceClaimRecord> & { rawMeta: Record<string, unknown> };
      perspectivesToKeep?: PerspectiveAssertionItem[];
      tripletsToKeep?: TripletAssertionItem[];
      retireAllDerivedClaims?: boolean;
    }>
  ) {
    if (this.shouldFailNextTransaction) {
      this.shouldFailNextTransaction = false;
      throw new Error("Simulated database constraint violation or network partition");
    }

    const current = await this.findSourceWithClaims(sourceId);
    if (!current.source) {
      throw new Error(`Source ${sourceId} not found`);
    }

    const currentSource = current.source;

    // Save rollback snapshot
    const backupSource = { ...currentSource };
    const backupPerspectives = new Map(this.perspectives);
    const backupTriplets = new Map(this.triplets);

    try {
      const instruction = await updateFn({
        perspectives: current.perspectives,
        source: currentSource,
        triplets: current.triplets
      });

      let suppressedCount = 0;

      if (instruction.retireAllDerivedClaims) {
        let deletedP = 0;
        for (const [id, p] of this.perspectives.entries()) {
          if (p.sourceId === sourceId) {
            this.perspectives.delete(id);
            deletedP++;
          }
        }
        let deletedT = 0;
        for (const [id, t] of this.triplets.entries()) {
          if (t.sourceId === sourceId) {
            this.triplets.delete(id);
            deletedT++;
          }
        }
        suppressedCount = deletedP + deletedT;
      } else {
        const oldPCount = current.perspectives.length;
        const oldTCount = current.triplets.length;

        // Purge old perspectives for this source
        for (const [id, p] of this.perspectives.entries()) {
          if (p.sourceId === sourceId) this.perspectives.delete(id);
        }
        // Insert kept perspectives
        if (instruction.perspectivesToKeep) {
          for (const p of instruction.perspectivesToKeep) {
            const id = p.id ?? `pers_${Math.random().toString(36).substring(2, 9)}`;
            this.perspectives.set(id, { ...p, id, sourceId });
          }
        }

        // Purge old triplets for this source
        for (const [id, t] of this.triplets.entries()) {
          if (t.sourceId === sourceId) this.triplets.delete(id);
        }
        // Insert kept triplets
        if (instruction.tripletsToKeep) {
          for (const t of instruction.tripletsToKeep) {
            const id = t.id ?? `trip_${Math.random().toString(36).substring(2, 9)}`;
            this.triplets.set(id, { ...t, id, sourceId });
          }
        }

        const keptP = instruction.perspectivesToKeep?.length ?? 0;
        const keptT = instruction.tripletsToKeep?.length ?? 0;
        suppressedCount = Math.max(0, oldPCount - keptP) + Math.max(0, oldTCount - keptT);
      }

      // Update source
      const updated: SourceClaimRecord = {
        ...current.source,
        ...instruction.updatedSource,
        updatedAt: new Date()
      };
      this.sources.set(sourceId, updated);

      const finalClaims = await this.findSourceWithClaims(sourceId);
      return {
        perspectives: finalClaims.perspectives,
        source: updated,
        suppressedCount,
        triplets: finalClaims.triplets
      };
    } catch (err) {
      // Rollback
      this.sources.set(sourceId, backupSource);
      this.perspectives = backupPerspectives;
      this.triplets = backupTriplets;
      throw err;
    }
  }
}

function makeInitialSource(overrides: Partial<SourceClaimRecord> = {}): SourceClaimRecord {
  return {
    author: "Dr. Somchai Robotics",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    excerpt: "Chulalongkorn University developed a medical humanoid robot for hospital patient assistance.",
    id: "src_cu_med_01",
    platform: "News Portal",
    publishedAt: new Date("2026-01-01T00:00:00Z"),
    rawMeta: {
      _versioning: {
        assertionsHash: "init_assertions_hash",
        contentHash: "init_content_hash",
        lastUpdatedBy: "seed",
        revisionReason: "Seed baseline",
        snapshotHash: "init_snapshot_hash",
        status: "ACTIVE",
        updatedAt: "2026-01-01T00:00:00Z",
        version: 1
      }
    },
    relevanceConfidence: 0.95,
    relevanceReason: "Direct coverage of Thai hospital humanoid deployment",
    relevanceStatus: "ACCEPTED",
    sourceType: "SEED",
    title: "Chula Unveils Healthcare Assistant Humanoid",
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    url: "https://chula.ac.th/news/medical-robot-2026",
    ...overrides
  };
}

const samplePerspectives: PerspectiveAssertionItem[] = [
  {
    confidence: 0.88,
    evidenceExcerpt: "Hospital staff reported positive trust in humanoid robot handling medication rounds.",
    id: "pers_01",
    method: "rules_with_evidence",
    perspectiveTheme: "healthcare_trust",
    sentiment: "positive",
    stance: "supportive",
    targetEntity: "Chula Healthcare Robot"
  }
];

const sampleTriplets: TripletAssertionItem[] = [
  {
    confidence: 0.9,
    id: "trip_01",
    object: "Chula Healthcare Robot",
    relation: "developed",
    subject: "Chulalongkorn University"
  }
];

test("R2: Reproducible snapshots maintain deterministic hashes and cryptographic integrity", () => {
  const source = makeInitialSource();
  const snapshot = buildSourceSnapshot(source, samplePerspectives, sampleTriplets, "reviewer@thaiallas.org", "Initial audit review");

  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.snapshotId, "snapshot:src_cu_med_01:v1");
  assert.equal(snapshot.relevanceStatus, "ACCEPTED");

  // Verify integrity passes
  const verification = verifySnapshotIntegrity(snapshot);
  assert.equal(verification.isValid, true);
  assert.equal(verification.mismatches.length, 0);

  // Tampering with content detects mismatch
  const tampered = {
    ...snapshot,
    source: { ...snapshot.source, title: "Tampered Malicious Title" }
  };
  const tamperedCheck = verifySnapshotIntegrity(tampered);
  assert.equal(tamperedCheck.isValid, false);
  assert.match(tamperedCheck.mismatches[0], /Content hash mismatch/);
});

test("R2: Concurrent edits detect conflicts (OCC) instead of silently overwriting", async () => {
  const source = makeInitialSource();
  const repo = new InMemoryClaimRepository(source, samplePerspectives, sampleTriplets);

  const reviewerA: UpdateSourceClaimInput = {
    actor: { email: "reviewerA@thaiatlas.org", kind: "operator" },
    expectedVersion: 1,
    patch: {
      excerpt: "Updated excerpt with refined trial details."
    },
    reason: "Refined clinical trial context",
    sourceId: source.id
  };

  const reviewerB: UpdateSourceClaimInput = {
    actor: { email: "reviewerB@thaiatlas.org", kind: "operator" },
    expectedVersion: 1, // Reviewer B also based work on version 1
    patch: {
      title: "Chula Medical Robot Version 2 Announced"
    },
    reason: "Title correction",
    sourceId: source.id
  };

  // Reviewer A saves successfully -> increments version to 2
  const resultA = await updateSourceClaim(reviewerA, repo);
  assert.equal(resultA.ok, true);
  if (!resultA.ok) return;
  assert.equal(resultA.version, 2);

  // Reviewer B attempts to save with stale expectedVersion 1 -> must fail with STALE_VERSION_CONFLICT
  const resultB = await updateSourceClaim(reviewerB, repo);
  assert.equal(resultB.ok, false);
  if (resultB.ok) return;
  assert.equal(resultB.code, "STALE_VERSION_CONFLICT");
  assert.equal(resultB.currentVersion, 2);
  assert.equal(resultB.expectedVersion, 1);
  assert.match(resultB.message, /Conflict detected/);

  // Reviewer B receives current snapshot to reconcile changes
  assert.equal(resultB.currentSnapshot.version, 2);
  assert.equal(resultB.currentSnapshot.source.excerpt, "Updated excerpt with refined trial details.");
});

test("R2: overlapping reviews cannot both commit the same version", async () => {
  const source = makeInitialSource();
  const repo = new InMemoryClaimRepository(source, samplePerspectives, sampleTriplets);
  const original = repo.executeAtomicUpdate.bind(repo);
  let queue = Promise.resolve();
  repo.executeAtomicUpdate = async (sourceId, updateFn) => {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await original(sourceId, updateFn); } finally { release(); }
  };
  const input: UpdateSourceClaimInput = {
    actor: { kind: "operator", email: "reviewer@example.org" }, expectedVersion: 1,
    patch: { title: "Review" }, reason: "Correction", sourceId: source.id
  };
  const results = await Promise.all([updateSourceClaim(input, repo), updateSourceClaim(input, repo)]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok && result.code === "STALE_VERSION_CONFLICT").length, 1);
});

test("R2: Reclassifying ACCEPTED -> REJECTED suppresses stale derived claims and invalidates search eligibility", async () => {
  const source = makeInitialSource();
  const repo = new InMemoryClaimRepository(source, samplePerspectives, sampleTriplets);

  // Reclassify to REJECTED (e.g. source debunked or non-humanoid)
  const rejectInput: UpdateSourceClaimInput = {
    actor: { email: "lead_curator@thaiatlas.org", kind: "operator" },
    expectedVersion: 1,
    patch: {
      relevanceReason: "Investigated: device is a telepresence tablet on wheels, not a humanoid embodiment.",
      relevanceStatus: "REJECTED"
    },
    reason: "Reclassification based on embodiment standard check",
    sourceId: source.id
  };

  const result = await updateSourceClaim(rejectInput, repo);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.version, 2);
  assert.equal(result.activePerspectivesCount, 0);
  assert.equal(result.activeTripletsCount, 0);
  assert.equal(result.suppressedAssertionsCount, 2); // 1 perspective + 1 triplet suppressed

  // In database repository: no active perspectives or triplets remain for this source
  const claimsAfter = await repo.findSourceWithClaims(source.id);
  assert.equal(claimsAfter.perspectives.length, 0);
  assert.equal(claimsAfter.triplets.length, 0);
  assert.equal(claimsAfter.source?.relevanceStatus, "REJECTED");

  // Verify Search Revalidation Hook integration
  const mockPrisma = {
    perspectiveAnnotation: {
      findUnique: async () => null // Deleted from DB
    },
    sourceRecord: {
      findUnique: async () => ({
        id: source.id,
        relevanceStatus: "REJECTED",
        title: source.title,
        excerpt: source.excerpt,
        url: source.url
      })
    },
    triplet: {
      findUnique: async () => null // Deleted from DB
    }
  };

  const sourceSearchDoc: SearchDocument = {
    body: source.excerpt,
    contentHash: computeContentHash({
      body: source.excerpt,
      metadata: {},
      title: source.title,
      typedId: `source:${source.id}`,
      url: source.url
    }),
    dependencyHash: computeDependencyHash(null),
    evidence: [],
    groupId: `source:${source.id}`,
    isPartial: false,
    isTitleOnly: false,
    kind: "source",
    language: "en",
    metadata: {},
    origin: "seed",
    parentTypedId: null,
    retrievalText: `${source.title} ${source.excerpt}`,
    title: source.title,
    typedId: `source:${source.id}`,
    url: source.url,
    vectorRow: null
  };

  const revalSource = await revalidateSearchDocument(sourceSearchDoc, mockPrisma);
  assert.equal(revalSource.isValid, false);
  assert.equal(revalSource.reason, "STATUS_INELIGIBLE");

  // Perspective doc revalidation
  const perspectiveSearchDoc: SearchDocument = {
    body: samplePerspectives[0].evidenceExcerpt,
    contentHash: "hash_pers",
    dependencyHash: computeDependencyHash(`source:${source.id}`, "ACCEPTED"),
    evidence: [],
    groupId: `source:${source.id}`,
    isPartial: false,
    isTitleOnly: false,
    kind: "perspective",
    language: "en",
    metadata: {},
    origin: "seed",
    parentTypedId: `source:${source.id}`,
    retrievalText: `healthcare_trust ${samplePerspectives[0].evidenceExcerpt}`,
    title: "healthcare_trust",
    typedId: "perspective:pers_01",
    url: source.url,
    vectorRow: null
  };

  const revalPers = await revalidateSearchDocument(perspectiveSearchDoc, mockPrisma);
  assert.equal(revalPers.isValid, false);
  assert.equal(revalPers.reason, "DELETED");
});

test("R2: Correcting source evidence supersedes obsolete assertions with new ones", async () => {
  const source = makeInitialSource();
  const repo = new InMemoryClaimRepository(source, samplePerspectives, sampleTriplets);

  const updatedPerspectives: PerspectiveAssertionItem[] = [
    {
      confidence: 0.94,
      evidenceExcerpt: "Updated pilot showed high patient acceptance across 12 hospital wards.",
      id: "pers_updated_01",
      method: "rules_with_evidence",
      perspectiveTheme: "healthcare_trust",
      sentiment: "positive",
      stance: "supportive",
      targetEntity: "Chula Healthcare Robot"
    }
  ];

  const correctionInput: UpdateSourceClaimInput = {
    actor: { email: "curator@thaiatlas.org", kind: "operator" },
    expectedVersion: 1,
    patch: {
      excerpt: "Corrected trial report excerpt with 12 hospital wards."
    },
    perspectives: updatedPerspectives,
    reason: "Update clinical survey assertion to final 12-ward dataset",
    sourceId: source.id
  };

  const result = await updateSourceClaim(correctionInput, repo);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.version, 2);
  assert.equal(result.activePerspectivesCount, 1);
  assert.equal(result.snapshot.assertions.perspectives[0].evidenceExcerpt, "Updated pilot showed high patient acceptance across 12 hospital wards.");

  // Check repository: old perspective 'pers_01' was replaced, only 'pers_updated_01' exists
  const claims = await repo.findSourceWithClaims(source.id);
  assert.equal(claims.perspectives.length, 1);
  assert.equal(claims.perspectives[0].id, "pers_updated_01");
});

test("R2: Transaction failure rolls back completely and allows idempotent retry", async () => {
  const source = makeInitialSource();
  const repo = new InMemoryClaimRepository(source, samplePerspectives, sampleTriplets);

  // Arm the repository to simulate a transient network/DB abort
  repo.shouldFailNextTransaction = true;

  const input: UpdateSourceClaimInput = {
    actor: { email: "reviewer@thaiatlas.org", kind: "operator" },
    expectedVersion: 1,
    patch: {
      title: "New Title Attempt"
    },
    reason: "Editorial correction",
    sourceId: source.id
  };

  await assert.rejects(
    async () => {
      await updateSourceClaim(input, repo);
    },
    { message: /Simulated database constraint violation/ }
  );

  // Verify all-or-nothing rollback: source remains at version 1 with original title and claims
  const checkAfterFailure = await repo.findSourceWithClaims(source.id);
  assert.equal(checkAfterFailure.source?.title, "Chula Unveils Healthcare Assistant Humanoid");
  const rawMeta = checkAfterFailure.source?.rawMeta as any;
  assert.equal(rawMeta._versioning?.version, 1);
  assert.equal(checkAfterFailure.perspectives.length, 1);
  assert.equal(checkAfterFailure.triplets.length, 1);

  // Retry the identical request without failure injection -> succeeds cleanly
  const retryResult = await updateSourceClaim(input, repo);
  assert.equal(retryResult.ok, true);
  if (!retryResult.ok) return;
  assert.equal(retryResult.version, 2);
  assert.equal(retryResult.snapshot.source.title, "New Title Attempt");
});

test("R2: Shared operator access policy fails closed on unauthenticated or unauthorized actors", async () => {
  const source = makeInitialSource();
  const repo = new InMemoryClaimRepository(source, samplePerspectives, sampleTriplets);

  // 1. Missing actor
  const noActorResult = await updateSourceClaim(
    {
      actor: null as any,
      expectedVersion: 1,
      patch: { title: "Hacked Title" },
      reason: "Unauthorized attempt",
      sourceId: source.id
    },
    repo
  );
  assert.equal(noActorResult.ok, false);
  assert.equal(noActorResult.code, "UNAUTHORIZED");

  // 2. Non-operator actor
  const invalidActorResult = await updateSourceClaim(
    {
      actor: { email: "guest@external.com", role: "USER" },
      expectedVersion: 1,
      patch: { title: "Hacked Title" },
      reason: "Unauthorized attempt",
      sourceId: source.id
    },
    repo
  );
  assert.equal(invalidActorResult.ok, false);
  assert.equal(invalidActorResult.code, "UNAUTHORIZED");

  for (const actor of [{ email: "attacker@external.org" }, { email: "attacker@external.org", role: undefined }]) {
    const result = await updateSourceClaim({
      actor, expectedVersion: 1, patch: { title: "Hacked Title" }, reason: "Unauthorized", sourceId: source.id
    }, repo);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "UNAUTHORIZED");
  }

  // 3. Database untouched
  const sourceAfter = await repo.findSourceWithClaims(source.id);
  assert.equal(sourceAfter.source?.title, "Chula Unveils Healthcare Assistant Humanoid");
});
