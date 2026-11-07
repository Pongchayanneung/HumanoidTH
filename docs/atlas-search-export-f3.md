# Atlas Search Export & Current-Record Policy Specification (F3)

**Package:** Feature Package F3 — Issue #15  
**Assignee:** Suk-Nsr  
**Milestone:** Atlas Search — 6 hours  
**Status:** Completed  
**Artifacts Generated:**
- `data/search/documents.json`: Complete public keyword-only search corpus (6,746 documents)
- `data/search/manifest.json`: Search release manifest (Release ID: `search-v1-keyword`)
- `data/search/probe-128.json`: Stratified 128-document embedding probe sample
- `lib/search/policy.ts`: Public admission and exclusion policy definitions
- `lib/search/types.ts`: TypeScript contracts for search documents, manifest, and revalidation
- `lib/search/text-utils.ts`: Text sanitization, 2,000 Unicode code point capping, language detection, evidence ranges, and deterministic SHA-256 content hashing
- `lib/search/revalidation.ts`: Current-record revalidation suppressing deleted, hidden, or modified records before display
- `lib/search/exporter.ts`: Direct paginated database reader (never run, no test covers it) and offline seed fallback exporter
- `scripts/export-search-corpus.ts`: Automated CLI corpus exporter

---

## 1. Admission Policy by Record Kind

The search corpus covers 7 public kinds under strict admission criteria:

| Record Kind | Permitted Origins | Public Searchable Fields | Admission Criteria | Excluded Fields |
| :--- | :--- | :--- | :--- | :--- |
| **Source** | `openalex`, `github`, `youtube`, `gdelt`, `rss`, `web`, `manual_social`, `seed` | Title, substantive excerpt, author, platform, url, publishedAt | `relevanceStatus === "ACCEPTED"` | `rawMeta`, `relevanceReason`, `relevanceConfidence`, internal review notes |
| **Robot** | `public_catalog` | Canonical name, description, manufacturer, developerOrg, countryOfOrigin, robotType, embodimentLevel, officialUrl, firstSeenYear | Observed / developed in Thailand; not generic placeholder or unverified foreign robot | `primaryUseCase` (contains imported editorial notes), `sourceMeta` |
| **Contribution** | `approved_community` | Title, description, contributorName, organization, contributionType, license, sourceUrl | `visibility === "public"`, `verificationStatus === "APPROVED"`; parent robot must be eligible | Submitter contact details, unapproved drafts |
| **Perspective** | `seed` | Perspective theme, target entity, stance, sentiment, evidence excerpt, method, parent source title & url | Parent source must remain `ACCEPTED` | Reviewer notes, confidence scores |
| **Inventory** | `public_catalog` | Public display name, ownership status, condition status, owner organization, robot model name | `visibility === "public"`; parent robot model must be eligible (excluded in v1: 0 items) | Serial numbers, custodians, exact locations, internal notes, acquisition costs, accessories |
| **Relationship** | `seed` | Subject, relation, object, confidence, source title & url | Parent source must remain `ACCEPTED` | Raw extraction payloads |
| **Entity** | `seed` | Name, entity type, canonical key, provenance source url | Verified institutional or organizational source association (excluded in v1 pending verification) | Arbitrary internal metadata |

### Global Exclusions
The search index strictly excludes:
- User records and account credentials
- Private inventory units and hardware serial numbers
- Submitter names and contact info from unreviewed or unpublished submissions
- Source pull jobs, pipeline runs, and internal task queues
- Cache tables and raw scraper payloads (`rawMeta`, `sourceMeta`)
- Internal reviewer notes and triage remarks
- Unverified organization names without explicit provenance verification (reported under `emptyKinds: ["inventory", "entity"]`)

---

## 2. Text Normalization and Evidence Boundaries

1. **Placeholder Omission:** Known seed placeholders (e.g. `"OpenAlex abstract metadata available."`, `"Academic paper about ... indexed on OpenAlex."`, `"Placeholder contribution for Thai human-robot interaction research."`) are detected and stripped before indexing. Sources where excerpts are purely placeholders/templates are indexed as `isTitleOnly: true` with empty body.
2. **Unicode Code Point Capping:** Body indexing text is capped at **2,000 Unicode code points** using `Array.from(text).slice(0, 2000)`. This prevents character corruption for Thai combining marks and tone diacritics. Truncated records carry `isPartial: true`.
3. **Evidence Offset Ranges:** Every search document provides a structured `evidence` array containing exact UTF-16 offset ranges (`startOffset`, `endOffset`) into the original stored field.
4. **Deterministic Hashes:** Every document computes a public-field `contentHash` and dependency `dependencyHash` using SHA-256. Parent links in perspectives and relationships point to source document typed IDs (`source:seed-N`) where the parent source is in this release; 3 of 4 perspectives and 4 of 10 relationships have `parentTypedId: null` because their parent source is not in the release.
5. **Database vs Seed Execution:** The database export path is implemented with paginated Prisma reads; it has not been run against any database and no unit test covers it (the tests cover the seed path and shared utilities only). For the hackathon build, the published static index is generated from the authoritative seed dataset, where all 6,714 sources are exported (as seed import assigns `ACCEPTED`), while database exports filter by explicit `relevanceStatus === "ACCEPTED"`.

---

## 3. Current-Record Revalidation

The `revalidateSearchDocument` and `revalidateSearchDocuments` helpers prevent serving stale, changed, or newly hidden records:

> [!NOTE]
> Document revalidation (`revalidateSearchDocument`) queries Postgres by primary key cuid, and therefore applies to database-exported corpora (`exportSearchCorpusFromDb`). Offline seed-exported documents (`exportSearchCorpusFromSeed`) use indexed `seed-N` IDs and are intended for offline embedding and benchmark evaluation until stable primary key mapping is wired into F1.

1. **Deletion Check & Missing Client:** If the database client is missing or the record no longer exists in PostgreSQL, revalidation fails closed with `{ isValid: false, reason: "DELETED" }`.
2. **Status Drift:** If a source or contribution is retracted or marked unapproved, revalidation yields `{ isValid: false, reason: "STATUS_INELIGIBLE" }`.
3. **Parent Invalidation & Dependency Hash:** If a parent source is unlinked, modified, or rejected, dependent perspective annotations and relationships yield `{ isValid: false, reason: "PARENT_INELIGIBLE" }` or `{ isValid: false, reason: "DEPENDENCY_CHANGED" }`.
4. **Content Change:** If public fields change in the database after index compilation, hashes mismatch and the candidate is suppressed until the next index build (`CONTENT_CHANGED`).

---

## 4. Release Metrics (Keyword-Only v1)

Export produced via `pnpm run search:export`:
- **Total Eligible Documents:** 6,746
- **By Kind:**
  - `source`: 6,714 (including 3,799 title-only sources)
  - `robot`: 15 (15 Thai robot models; unverified foreign models like Bumi excluded)
  - `contribution`: 3
  - `perspective`: 4
  - `relationship`: 10
  - `entity`: 0 (`emptyKinds: ["inventory", "entity"]`)
  - `inventory`: 0 (`emptyKinds: ["inventory", "entity"]`)
- **By Language:**
  - `th`: 18
  - `mixed`: 103
  - `en`: 6,583
  - `unknown`: 42
- **Probe Sample (`probe-128.json`):** Exactly 128 documents stratified across:
  - Thai: 18 (100% of available Thai records)
  - Mixed: 25
  - Core catalog: 15 robots, 3 contributions, 4 perspectives, 10 relationships
  - Sources: 96 balanced across OpenAlex (40), GitHub (24), YouTube (32) with max retrieval length up to 1,435 characters
- **Records SHA-256 (on disk):** `84a65671821c3935645f29cf27ebc8ab250c95dadd06a83ea846f972b3de8417`
