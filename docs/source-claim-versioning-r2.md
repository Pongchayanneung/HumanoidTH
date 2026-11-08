# Source Claim Versioning and Stale Publication Prevention (R2)

## Architectural Context
Resolves **Issue #26** (`[R2] Version source claims and prevent stale conflicting publication`) addressing Technical Audit Finding **T07** and Design Data Flow Audit Finding **D06**.

- **Finding T07**: Source and derived-record updates historically lacked a shared atomic version. Updating source classification or evidence separate from annotations and triplets left orphaned or stale claims attached to changed or rejected evidence. Reviewers could silently overwrite each other's edits.
- **Finding D06**: Updating or retiring a source did not reliably purge or supersede derived claims across perspectives, graph relationships, and search indexes, preventing researchers from obtaining reproducible lineage.

## Implementation Overview

### 1. Identifiable Source & Assertion Versions (`lib/claim-versioning/`)
- **Deterministic Content & Assertion Hashing**:
  - `computeSourceContentHash`: Computes SHA-256 over canonicalized key-value pairs (`id`, `url`, `title`, `excerpt`, `relevanceStatus`, `relevanceReason`, `author`, `platform`, `publishedAt`).
  - `computeAssertionsHash`: Sorts perspective annotations (by theme, target entity, evidence excerpt) and triplets (by subject, relation, object) deterministically to compute a canonical SHA-256 digest.
  - `computeSnapshotHash`: Cryptographic digest combining content hash, assertions hash, version number, and parent snapshot hash.
- **Reproducible Snapshots (`ReproducibleSourceSnapshot`)**:
  - Each revision generates a self-contained snapshot identifying source attributes, active assertions, actor, reason, timestamp, and lineage pointer.
  - `verifySnapshotIntegrity`: Recalculates hashes and detects any content, assertion, or lineage tampering.
- **Zero-Migration Version Storage**:
  - In full adherence to Project Rule 7, versioning metadata is persisted inside `SourceRecord.rawMeta._versioning`, storing monotonic revision number, content hashes, snapshot hashes, status (`ACTIVE` vs `RETIRED`), and audit history (`history[]`).

### 2. Stale Claim Suppression on Retirement and Correction
- **Atomic Retirement**: When a source is reclassified to `REJECTED`, `UNCERTAIN`, or `PENDING`:
  - All active `PerspectiveAnnotation` and `Triplet` records associated with the source are atomically purged within a single `prisma.$transaction`.
  - Stale derived claims cannot leak into `/perspectives`, `/dashboard`, or network graph queries.
- **Evidence Correction**: When an accepted source's text or assertions change:
  - Obsolete perspective annotations and triplets not present in the new set are removed.
  - New assertions are inserted with parent source attribution.
- **Search Revalidation Integration**:
  - Verified with `revalidateSearchDocument` from `lib/search/revalidation.ts`:
    - Reclassified sources return `STATUS_INELIGIBLE`.
    - Purged perspectives and triplets return `PARENT_INELIGIBLE` or `DELETED`.
    - Modified source text returns `CONTENT_CHANGED`.

### 3. Optimistic Concurrency Control (OCC)
- Review updates require `expectedVersion` (and optional `expectedContentHash`).
- If another reviewer committed an update in the interim (`currentVersion !== expectedVersion`), the write is rejected with `STALE_VERSION_CONFLICT`.
- The rejection payload returns the current active snapshot, allowing the reviewer to inspect the concurrent changes without silent loss of editorial work.

### 4. Atomic Transaction Rollback & Failure Retry
- All database mutations are wrapped inside `prisma.$transaction`.
- If any operation fails (validation error, constraint violation, simulated partition), the transaction rolls back completely, leaving the prior version and all assertions untouched.
- Idempotent retries after resolving failure succeed cleanly without duplicate claims or corrupted version history.

### 5. Shared Operator Access Policy
- Enforces fail-closed authentication: calls require a valid `OperatorPrincipal` (`kind: "operator"`) or authenticated user session (`ADMIN` / `RESEARCHER`).
- Unauthorized requests fail closed with `UNAUTHORIZED` before executing database queries or storage allocations.

### 6. Round 2 behaviour and known limits
- Snapshot parent hashes: conflict responses recompute `currentSnapshot` with the stored parent hash, so its `snapshotHash` equals the committed revision hash. The first edit of a record with no stored versioning chains to the baseline snapshot hash.
- Evidence correction: when `patch.title` or `patch.excerpt` changes and the caller supplies no `perspectives` / `triplets`, machine-derived perspectives and all triplets are retired (they came from the superseded evidence). Human and seed perspectives are kept. Pass explicit arrays to re-assert claims. Patching other fields keeps existing assertions.
- Ingestion vs reviewers: `saveSources` skips (and logs) a record whose last version was written by a human reviewer (`lastUpdatedBy` not `ingest`, `system` or `seed`). It does not merge crawler output into reviewed records; the reviewer re-ingests through `updateSourceClaim`.
- Re-ingestion that reclassifies a curated (SEED / triplet_relation) record to a non-accepted status does not delete curated annotations or triplets (policy test in `classification-uncertainty.test.ts`). They are excluded from public views and search because eligibility is gated on the parent source being `ACCEPTED`, and search revalidation returns `STATUS_INELIGIBLE`.
- Not delivered: `isAuthorizedOperator` checks the shape of the caller-supplied principal and does not verify a session or credential; `updateSourceClaim` has no production caller yet (no API route). These are open and must not be read as live editorial access.

## Test Verification

Unit and integration tests are codified in `test/source-claim-versioning.test.ts`:
1. `Reproducible snapshots maintain deterministic hashes and cryptographic integrity` (pass)
2. `Concurrent edits detect conflicts (OCC) instead of silently overwriting` (pass)
3. `Reclassifying ACCEPTED -> REJECTED suppresses stale derived claims and invalidates search eligibility` (pass)
4. `Correcting source evidence supersedes obsolete assertions with new ones` (pass)
5. `Transaction failure rolls back completely and allows idempotent retry` (pass)
6. `Shared operator access policy fails closed on unauthenticated or unauthorized actors` (pass)

Commands executed:
```bash
pnpm test
pnpm run check:no-mock-data
pnpm run typecheck
```
Offline run (`DATABASE_URL` pointing at an unreachable host): tsc clean, `tsx --test test/*.test.ts` 305 pass, 0 fail, 6 skipped. No live PostgreSQL concurrency test was run.
