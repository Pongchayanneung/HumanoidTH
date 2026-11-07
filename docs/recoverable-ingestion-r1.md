# Recoverable Ingestion Jobs and Accurate Reporting (R1)

## Architectural Context
Work in progress for **Issue #25** (`[R1] Make ingestion jobs recoverable and accurately reported`) addressing Technical Audit Finding **T06** and Design Data Flow Audit Finding **D13**.

- **Finding T06**: Long ingestion tasks historically awaited external APIs and database transactions synchronously within web requests. Network interruptions, rate limits, or host timeouts left jobs in an indeterminate `RUNNING` state, with no durable checkpoint mechanism to resume without duplicating work or losing partial progress.
- **Finding D13**: Pull history conflated newly discovered items with updates and failed batches. Missing optional tokens (e.g. `GITHUB_TOKEN optional`) caused successful public data pulls to be labeled as `SKIPPED_MISSING_KEY`.

## Implementation Overview

### 1. M2 Operator Authorization & Permitted Provider Policy (`lib/ingest-workflow/`)
- The production executor validates an operator session token through M2.
- Permitted provider allowlist: `PERMITTED_INGESTION_ADAPTERS` (`["OPENALEX", "GITHUB", "GDELT", "YOUTUBE"]`).
- Unauthenticated or unauthorized attempts fail closed immediately with `UNAUTHORIZED` before executing network requests or database writes.
- Disallowed adapters reject with `INVALID_PROVIDER`.

### 2. Bounded Execution & Resumable Checkpoints (`lib/ingest-workflow/checkpoint-store.ts`)
- Ingestion occurs in bounded batches (default: 5 records).
- Each source is saved in a separate transaction. Checkpoints are written to the local filesystem after each batch and are not atomic with source writes (`IngestionCheckpoint`):
  - `jobId`: unique persistent job ID.
  - `lastProcessedIndex`: number of records processed so far.
  - `counts`: snapshot of reported progress (`recordsFound`, `recordsProcessed`, `recordsSaved`, `recordsNew`, `recordsUpdated`, `recordsSkipped`, `recordsFailed`, `acceptedCount`, `rejectedCount`, `uncertainCount`).
  - `completedUrls`: list of processed input URLs.
  - `persistedRecordIds`: list of database record IDs created/updated.
- For interruption and failure:
  - Caught batch failures update the job to `FAILED`; a process crash can leave it `RUNNING`. Provider fetches run outside this engine.
  - Retrying checks the input against the checkpoint, but a partial batch commit or process crash between source writes and checkpoint persistence can cause replay and incorrect counts. Local checkpoints are not shared between instances.

### 3. Outcome Reporting (Finding D13)
- The in-memory result intends to distinguish the following, but the database and UI/API/CLI do not persist or expose this breakdown consistently:
  - `recordsNew`: newly inserted source records.
  - `recordsUpdated`: existing records whose metadata/relevance was refreshed.
  - `recordsSkipped`: intended for malformed URLs or duplicates within a batch; the PostgreSQL repository currently miscounts duplicates.
  - `recordsFailed`: records that encountered errors.
  - `acceptedCount`, `rejectedCount`, `uncertainCount`: relevance categorization.
- Transparent credential handling:
  - When optional credentials (e.g. `GITHUB_TOKEN optional`) are omitted but public records are retrieved, the job succeeds with an informative warning (`hasOptionalKeyWarning: true`), never falsely marked `SKIPPED_MISSING_KEY`.
  - Truly missing mandatory keys (e.g. `YOUTUBE_API_KEY` missing with 0 records) are recorded as `SKIPPED_MISSING_KEY`.

### 4. Containment Baseline Preservation
- The external public web route `POST /api/ingest/[adapter]` and action `runDataPull` remain fail-closed with `WORKFLOW_UNAVAILABLE` (HTTP 403) to preserve baseline containment tests (M7, M8) until live ingestion is formally scheduled for Pitch Day.
- Provider fetching, distributed recovery, atomic batch progress, and unified history remain incomplete. Do not enable live ingestion.

## Test Verification

See `test/recoverable-ingestion.test.ts` for controlled in-memory tests. These do not verify provider failures, PostgreSQL transactions, distributed restart recovery, or UI/API/CLI history agreement. Run the tests for current results rather than relying on a fixed pass count.
