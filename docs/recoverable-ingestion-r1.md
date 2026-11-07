# Recoverable Ingestion Jobs and Accurate Reporting (R1)

## Architectural Context
Resolves **Issue #25** (`[R1] Make ingestion jobs recoverable and accurately reported`) addressing Technical Audit Finding **T06** and Design Data Flow Audit Finding **D13**.

- **Finding T06**: Long ingestion tasks historically awaited external APIs and database transactions synchronously within web requests. Network interruptions, rate limits, or host timeouts left jobs in an indeterminate `RUNNING` state, with no durable checkpoint mechanism to resume without duplicating work or losing partial progress.
- **Finding D13**: Pull history conflated newly discovered items with updates and failed batches. Missing optional tokens (e.g. `GITHUB_TOKEN optional`) caused successful public data pulls to be labeled as `SKIPPED_MISSING_KEY`.

## Implementation Overview

### 1. M2 Operator Authorization & Permitted Provider Policy (`lib/ingest-workflow/`)
- Enforces fail-closed authentication: calls require an authenticated operator principal (`kind: "operator"`) or authenticated user session (`ADMIN` / `RESEARCHER`).
- Permitted provider allowlist: `PERMITTED_INGESTION_ADAPTERS` (`["OPENALEX", "GITHUB", "GDELT", "YOUTUBE"]`).
- Unauthenticated or unauthorized attempts fail closed immediately with `UNAUTHORIZED` before executing network requests or database writes.
- Disallowed adapters reject with `INVALID_PROVIDER`.

### 2. Bounded Execution & Resumable Checkpoints (`lib/ingest-workflow/checkpoint-store.ts`)
- Ingestion occurs in bounded batches (default: 5 records).
- After each batch successfully commits inside `prisma.$transaction`, durable checkpoints are persisted (`IngestionCheckpoint`):
  - `jobId`: unique persistent job ID.
  - `lastProcessedIndex`: number of records processed so far.
  - `counts`: accurate snapshot of progress (`recordsFound`, `recordsProcessed`, `recordsSaved`, `recordsNew`, `recordsUpdated`, `recordsSkipped`, `recordsFailed`, `acceptedCount`, `rejectedCount`, `uncertainCount`).
  - `completedUrls`: list of processed canonical URLs.
  - `persistedRecordIds`: list of database record IDs created/updated.
- If interrupted by network partitions, rate limits (429), or simulated exceptions:
  - Job status updates to `FAILED` with an informative error message and saved count, rather than hanging indefinitely as `RUNNING`.
  - Retrying with the same `jobId` detects the checkpoint, resumes from `lastProcessedIndex`, and processes remaining records without repeating completed items or double-counting.

### 3. Accurate Outcome Reporting (Finding D13)
- Distinguishes:
  - `recordsNew`: newly inserted source records.
  - `recordsUpdated`: existing records whose metadata/relevance was refreshed.
  - `recordsSkipped`: malformed URLs or duplicates within batch.
  - `recordsFailed`: records that encountered errors.
  - `acceptedCount`, `rejectedCount`, `uncertainCount`: relevance categorization.
- Transparent credential handling:
  - When optional credentials (e.g. `GITHUB_TOKEN optional`) are omitted but public records are retrieved, the job succeeds with an informative warning (`hasOptionalKeyWarning: true`), never falsely marked `SKIPPED_MISSING_KEY`.
  - Truly missing mandatory keys (e.g. `YOUTUBE_API_KEY` missing with 0 records) are recorded as `SKIPPED_MISSING_KEY`.

### 4. Containment Baseline Preservation
- The external public web route `POST /api/ingest/[adapter]` and action `runDataPull` remain fail-closed with `WORKFLOW_UNAVAILABLE` (HTTP 403) to preserve baseline containment tests (M7, M8) until live ingestion is formally scheduled for Pitch Day.
- The underlying engine is fully implemented, verified, and ready in `lib/ingest-workflow/`.

## Test Verification

Unit tests are codified in `test/recoverable-ingestion.test.ts`:
1. `R1: M2 Operator Authorization & Permitted Provider Policy` (pass)
2. `R1: Ingestion distinguishes new records, updates, and duplicates (Finding D13)` (pass)
3. `R1: Interruption saves checkpoint and allows safe, non-duplicating resume (Finding T06)` (pass)
4. `R1: Batch execution failure marks job FAILED and preserves partial progress` (pass)
5. `R1: Optional provider credentials produce warning, not false SKIPPED_MISSING_KEY (Finding D13)` (pass)

Commands executed:
```bash
pnpm test
pnpm run check:no-mock-data
pnpm run typecheck
```
All 300 test assertions pass; zero mock signals in web code; zero TypeScript diagnostics.
