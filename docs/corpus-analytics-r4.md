# [R4] Whole-Corpus Analytics and Date Semantics Repair

## 1. Overview & Objectives

This document details the implementation, date semantics model, and whole-corpus aggregation architecture for **Issue #28 ([R4] Repair whole-corpus analytics and date semantics)** addressing **Audit Reference D11**.

Prior to R4:
1. Overview metric cards and summary panels displayed the length of a capped `findMany({ take: 5000 })` query, misleading users into reading a 5,000-record loader limit as the true whole-corpus total.
2. Incompatible date concepts were blended together: `publishedAt` silently fell back to `createdAt` (ingestion time), turning database batch import bursts into artificial research spikes.
3. OpenAlex year-only citations and robot `firstSeenYear` were mapped to `YYYY-01-01T00:00:00.000Z`, causing an artificial spike every January in monthly trend views.
4. Earlier database query loader caps in graph construction silently dropped records without disclosing truncation to the caller.

The R4 implementation delivers:
1. **Whole-Corpus Aggregation (`lib/analytics/corpus-analytics.ts`)**: Server-side `count` queries across the full public dataset, guaranteeing that summary cards and BPMN lanes report true un-truncated totals regardless of visualization sample limits.
2. **Explicit Sample & Truncation Warnings**: When the loaded visualization sample is capped, the UI displays an explicit sample disclosure (`X of Y records, Z% coverage`) while maintaining whole-corpus totals in summary cards.
3. **Strict Date Semantics (`lib/analytics/date-semantics.ts`)**: Separates Event Time (`publication` / `observation`) from System Time (`ingestion`), preserves nulls without fake fallbacks, and eliminates the January spike artifact for year-only records.
4. **Interactive Date Dimension Switching**: The analytics playground allows toggling between **Publication / Event Date** and **Ingestion / System Date**.
5. **Database Loader Cap Disclosures in Graph**: Graph loading warns when database queries reach loader caps (`take: 1200` etc.).

---

## 2. Root Cause Analysis (Audit D11)

| Failure Mode | Baseline Implementation | Impact | R4 Repair |
| :--- | :--- | :--- | :--- |
| **Capped Sample Totals** | `sources.length` from `findMany({ take: 5000 })` shown as total source count. | A 6,714-source database was displayed as having only 5,000 sources. | `computeCorpusAggregates()` runs server-side `count` queries across the full eligible snapshot. |
| **Mixed Date Semantics** | `(item.publishedAt ?? item.createdAt).toISOString()` used as event date. | Ingestion bursts (bulk imports) appeared as research/public attention spikes. | `parseSourceDateSemantics` separates `eventDate` (`publishedAt`) from `ingestionDate` (`createdAt`); never falls back. |
| **Artificial January Spikes** | `firstSeenYear` converted to `new Date(firstSeenYear, 0, 1)`. | Year-only records were bucketed into January (`YYYY-01`), distorting monthly trends. | `formatTimeBucketKey` identifies `datePrecision: "year_only"` and groups into `"year_only"` in monthly view, preventing January distortion. |
| **Missing Data Obfuscation** | Records without dates were either omitted or filled with fallback dates. | Missing data rates were invisible to researchers. | Calculates and discloses missing publication dates and coverage fractions explicitly. |
| **Silent Graph Truncation** | Graph builder checked truncation on the built graph only; earlier query caps dropped records silently. | Graph reported `truncated: false` while database records were omitted. | `loadGraphRecordsFromPrisma` tracks query limits; appends warnings to `source.warnings` and sets `truncated: true`. |

---

## 3. Date Semantics Architecture

### 3.1 Date Classification

Each event in the corpus analytics workspace is assigned explicit date semantics:

```
Record Attributes
       │
       ├──> publishedAt (non-null, valid ISO date)
       │         └── If day/month precision: dateKind = "publication", datePrecision = "exact_date"
       │         └── If year citation only:  dateKind = "publication", datePrecision = "year_only"
       │
       ├──> publishedAt (null / missing)
       │         └── dateKind = "missing", datePrecision = "missing", eventDate = null
       │
       ├──> firstSeenYear (robot model)
       │         └── dateKind = "observation", datePrecision = "year_only", monthKey = null
       │
       └──> createdAt (system timestamp)
                 └── dateKind = "ingestion", datePrecision = "exact_date"
```

### 3.2 Time-Series Bucketing Rules (`formatTimeBucketKey`)

| Record Type | View Mode | Publication Dimension | Ingestion Dimension |
| :--- | :--- | :--- | :--- |
| **Exact Date Paper (2022-04-15)** | Month | `2022-04` | `YYYY-MM` (from createdAt) |
| **Exact Date Paper (2022-04-15)** | Year | `2022` | `YYYY` (from createdAt) |
| **Year-Only Citation (2020)** | Month | `year_only` *(never `2020-01`!)* | `YYYY-MM` (from createdAt) |
| **Year-Only Citation (2020)** | Year | `2020` | `YYYY` (from createdAt) |
| **Robot First-Seen (2019)** | Month | `year_only` *(never `2019-01`!)* | `YYYY-MM` (from createdAt) |
| **Robot First-Seen (2019)** | Year | `2019` | `YYYY` (from createdAt) |
| **Missing Publication Date** | Any | `undated` | `YYYY-MM` or `YYYY` (from createdAt) |

---

## 4. Whole-Corpus Aggregation & Sample Warnings

### 4.1 Server-Side Aggregation (`lib/analytics/corpus-analytics.ts`)

The aggregator executes parallel count queries scoped to public eligible records:
```ts
const [
  totalSources,
  totalRobots,
  totalContributions,
  totalPerspectives,
  totalScoredSources,
  sourcesWithPubDate,
  robotsWithYear
] = await Promise.all([
  prisma.sourceRecord.count({ where: { relevanceStatus: "ACCEPTED" } }),
  prisma.robotModel.count(),
  prisma.contribution.count({ where: { visibility: "public", verificationStatus: "APPROVED" } }),
  prisma.perspectiveAnnotation.count({ where: { source: { relevanceStatus: "ACCEPTED" } } }),
  prisma.sourceRecord.count({ where: { relevanceStatus: "ACCEPTED", relevanceConfidence: { gt: 0 } } }),
  prisma.sourceRecord.count({ where: { relevanceStatus: "ACCEPTED", publishedAt: { not: null } } }),
  prisma.robotModel.count({ where: { firstSeenYear: { not: null } } })
]);
```

### 4.2 Explicit Sample Warning in UI

When `isSampleTruncated === true` (`analyzedCount < totalEligibleCount`):
- Metric cards display true whole-corpus totals (`totalEligibleSources`).
- BPMN pipeline lanes display true whole-corpus counts.
- An alert banner is displayed:
  > **Sampled Visualization Active:** Charts plot a bounded sample of 5,000 records (74.8% coverage of 6,779 verified public records). Summary metric cards and BPMN pipeline lanes reflect the complete un-truncated corpus.
- Date disclosures disclose the exact number and rate of missing dates (e.g. `714 missing publication dates, 10.6%`).

---

## 5. Acceptance Verification Evidence

| Acceptance Check | Status | Verification Detail |
| :--- | :--- | :--- |
| **Aggregate complete defined eligible snapshot** | **PASSED** | Summary cards and BPMN lanes display whole-corpus counts via `prisma.*.count()`, not capped loader arrays. Verified in `test/corpus-analytics.test.ts`. |
| **Distinguish publication, observation, and ingestion dates** | **PASSED** | `dateKind` and `datePrecision` keep event time strictly separated from `createdAt`. Changing ingestion time does not shift publication trends. |
| **No artificial January spikes from year-only citations** | **PASSED** | In monthly view, year-only records are bucketed as `year_only`, eliminating the January spike flaw. |
| **Rejected/private records stay excluded** | **PASSED** | Only `relevanceStatus: "ACCEPTED"` and `visibility: "public"` records are included. |
| **Disclose snapshot/scope and missing data** | **PASSED** | UI displays scope notice, sample truncation warning, coverage percentage, and missing publication date rates. |
| **>5,000-row fixture reconciliation** | **PASSED** | Tested with 6,714-record fixture; produces full aggregates and `isSampleTruncated: true` warning. |

### Test Suite Execution
- `pnpm test`: **70/70 tests passed** (including 8 comprehensive tests in `test/corpus-analytics.test.ts`).
- `pnpm typecheck`: **0 errors**.
