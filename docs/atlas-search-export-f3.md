# Atlas Search Export & Current-Record Policy Specification (F3)

**Package:** Feature Package F3 — Issue #15  
**Assignee:** Suk-Nsr  
**Milestone:** Atlas Search — 6 hours  
**Status:** Completed  
**Artifacts Generated:**
- `data/search/documents.json`: Complete public keyword-only search corpus (8,122 documents)
- `data/search/manifest.json`: Search release manifest (Release ID: `search-v1-keyword`)
- `data/search/probe-128.json`: Stratified 128-document embedding probe sample
- `lib/search/policy.ts`: Public admission and exclusion policy definitions
- `lib/search/types.ts`: TypeScript contracts for search documents, manifest, and revalidation
- `lib/search/text-utils.ts`: Text sanitization, 2,000 Unicode code point capping, language detection, evidence ranges, and deterministic SHA-256 content hashing
- `lib/search/revalidation.ts`: Current-record revalidation suppressing deleted, hidden, or modified records before display
- `lib/search/exporter.ts`: Direct paginated database reader and offline seed fallback exporter
- `scripts/export-search-corpus.ts`: Automated CLI corpus exporter

---

## 1. Admission Policy by Record Kind

The search corpus covers 7 public kinds under strict admission criteria:

| Record Kind | Permitted Origins | Public Searchable Fields | Admission Criteria | Excluded Fields |
| :--- | :--- | :--- | :--- | :--- |
| **Source** | `openalex`, `github`, `youtube`, `gdelt`, `rss`, `web`, `manual_social`, `seed` | Title, substantive excerpt, author, platform, url, publishedAt | `relevanceStatus === "ACCEPTED"` | `rawMeta`, `relevanceReason`, `relevanceConfidence`, internal review notes |
| **Robot** | `public_catalog` | Canonical name, description, manufacturer, developerOrg, countryOfOrigin, robotType, embodimentLevel, officialUrl, firstSeenYear | Observed / developed in Thailand; not generic placeholder or unverified foreign robot | `primaryUseCase` (contains imported editorial notes), `sourceMeta` |
| **Contribution** | `approved_community` | Title, description, contributorName, organization, contributionType, license, sourceUrl | `visibility === "public"`, `verificationStatus === "APPROVED"`; parent robot must be eligible | Submitter contact details, unapproved drafts |
| **Perspective** | `seed`, `annotated_source` | Perspective theme, target entity, stance, sentiment, evidence excerpt, method, parent source title & url | Parent source must remain `ACCEPTED` | Reviewer notes, confidence scores |
| **Inventory** | `public_catalog` | Public display name, ownership status, condition status, owner organization, robot model name | `visibility === "public"`; parent robot model must be eligible | Serial numbers, custodians, exact locations, internal notes, acquisition costs, accessories |
| **Relationship** | `seed`, `accepted_triplets` | Subject, relation, object, confidence, source title & url | Parent source must remain `ACCEPTED` | Raw extraction payloads |
| **Entity** | `seed`, `verified_provenance` | Name, entity type, canonical key, provenance source url | Verified institutional or organizational source association | Arbitrary internal metadata |

### Global Exclusions
The search index strictly excludes:
- User records and account credentials
- Private inventory units and hardware serial numbers
- Submitter names and contact info from unreviewed or unpublished submissions
- Source pull jobs, pipeline runs, and internal task queues
- Cache tables and raw scraper payloads (`rawMeta`, `sourceMeta`)
- Internal reviewer notes and triage remarks

---

## 2. Text Normalization and Evidence Boundaries

1. **Placeholder Omission:** Known seed placeholders (e.g. `"OpenAlex abstract metadata available."`, `"Placeholder contribution for Thai human-robot interaction research."`) are detected and stripped before indexing. If a source's excerpt is purely a placeholder, it is labeled as `isTitleOnly: true`.
2. **Unicode Code Point Capping:** Body indexing text is capped at **2,000 Unicode code points** using `Array.from(text).slice(0, 2000)`. This prevents character corruption for Thai combining marks and tone diacritics. Truncated records carry `isPartial: true`.
3. **Evidence Offset Ranges:** Every search document provides a structured `evidence` array containing exact UTF-16 offset ranges (`startOffset`, `endOffset`) into the original stored field.
4. **Deterministic Hashes:** Every document computes a public-field `contentHash` and dependency `dependencyHash` using SHA-256.

---

## 3. Current-Record Revalidation

The `revalidateSearchDocument` and `revalidateSearchDocuments` helpers prevent serving stale, changed, or newly hidden records:
1. **Deletion Check:** If the record no longer exists in PostgreSQL, revalidation yields `{ isValid: false, reason: "DELETED" }`.
2. **Status Drift:** If a source or contribution is retracted or marked unapproved, revalidation yields `{ isValid: false, reason: "STATUS_INELIGIBLE" }`.
3. **Parent Invalidation:** If a parent source is unlinked or rejected, dependent perspective annotations and relationships yield `{ isValid: false, reason: "PARENT_INELIGIBLE" }`.
4. **Content Change:** If public fields change in the database after index compilation, hashes mismatch and the candidate is suppressed until the next index build (`CONTENT_CHANGED`).

---

## 4. Release Metrics (Keyword-Only v1)

Export produced via `pnpm run search:export`:
- **Total Eligible Documents:** 8,122
- **By Kind:**
  - `source`: 6,714
  - `robot`: 15 (15 Thai robot models; unverified foreign models like Bumi excluded)
  - `contribution`: 3
  - `perspective`: 4
  - `relationship`: 10
  - `entity`: 1,376
  - `inventory`: 0 (`emptyKinds: ["inventory"]`)
- **By Language:**
  - `th`: 18
  - `mixed`: 103
  - `en`: 7,961
  - `unknown`: 40
- **Probe Sample (`probe-128.json`):** Exactly 128 documents stratified across:
  - Thai: 18 (100% of available Thai records)
  - Mixed: 25
  - English: 85
  - Across all available record kinds (sources, robots, contributions, perspectives, relationships, entities)
- **Records SHA-256:** `08610eee9ce06b452766fe3a5cada8cf0beab89d5b01c20a3ed9da7031718a1d`
