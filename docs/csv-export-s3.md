# Public-Policy-Safe CSV Downloads Specification (S3)

**Package:** Backlog Extension S3 — Issue #23  
**Assignee:** Suk-Nsr  
**Status:** Completed  
**Audit References:** T11, D12  
**Artifacts Modified & Created:**
- `lib/csv-export.ts`: Reusable CSV export logic, table schema allowlists, bounded execution, formula injection neutralization, Prisma query builder with public predicates, and shared `fetchExportableRecords` data loader
- `app/api/export/route.ts`: Secure export endpoint enforcing operator auth, table normalization, query filtering, and CSV serialization
- `app/database/page.tsx`: Database browser table preview and export button achieving 100% filter, ordering, and row membership parity with CSV downloads
- `test/csv-export.test.ts`: Complete unit test suite verifying table normalization, column allowlists, public policy row predicates, formula neutralization, empty table schemas, route responses, contribution query shapes, and browser/export parity

---

## 1. Problem Statement & Audit Findings

Legacy CSV export suffered from verified security and data integrity issues:
1. **Audit D12 (Mismatched Tables & Lost Search Scope):**
   - Selecting `owned_inventory` fell through to `SourceRecord` while retaining an inventory filename (`owned_inventory.csv`).
   - The UI search filter (`q`) was omitted from export URLs, so the export disregarded the on-screen filter.
   - Empty exports returned plain text `"No data available"` or synthetic `"id,empty"` records rather than a stable CSV schema.
   - Unrecognized table names silently fell back to exporting sources.
2. **Audit T11 (Spreadsheet Formula Injection & Unbounded In-Memory Loading):**
   - User-controlled strings starting with formula trigger characters (`=`, `+`, `-`, `@`, etc.) were exported raw, exposing spreadsheet users to formula execution risks.
   - Private inventory hardware serials, custodians, exact locations, internal notes, and submitter contact details were leaked without explicit column projections.
   - Entire tables were queried without limits, risking memory exhaustion.
3. **Prisma Field Alignment & Public Policy Row Predicates:**
   - Queries must strictly project valid scalar fields defined in `prisma/schema.prisma` (`robotModelId` instead of non-existent `robotModelName`, omitting non-existent `country` on sources, and `category`/`description` on submissions).
   - Export queries must strictly enforce public policy predicates on rows (`visibility: "public"`, `relevanceStatus: "ACCEPTED"`, `verificationStatus: "APPROVED"`), preventing unreviewed or private rows from leaking.
4. **Displayed View & Export Membership Parity (Review Finding):**
   - The database browser (`app/database/page.tsx`) and the export endpoint (`app/api/export/route.ts`) must have 100% parity in row membership, ordering (`orderBy: { createdAt: "desc" }`), and displayed columns.
   - Querying raw rows on the page while filtering CSVs creates discrepancies; both surfaces must use the shared public-policy data loader (`fetchExportableRecords`).

---

## 2. Implemented Architecture & Protections

### 2.1 Operator Authentication Boundary & Table Validation
- **Operator Session Authentication:** Export endpoint is strictly gated with `getOperatorPrincipal()`. Unsigned cookies (`admin_session`, `user_role`, `user_email`) and HTTP Basic authentication credentials are strictly rejected (fail closed with HTTP 403 `WORKFLOW_UNAVAILABLE`).
- **Table Normalization:** The export API strictly validates the `table` query parameter using `normalizeTableName`:
  - Retained Allowed Tables: `sources`, `robots`, `contributions`, `inventory`, `owned_inventory`, `perspective_annotations`, `pull_jobs`.
  - Submissions Export Disabled: Submissions export is disabled pending review workflow policy confirmation. Any attempt to export submissions returns HTTP 403 `WORKFLOW_UNAVAILABLE`.
  - Any invalid or unrecognized table (e.g. `table=users`, `table=passwords`) **fails immediately with HTTP 400 Bad Request** and an explicit error payload listing allowed tables.
  - Input is normalized (case-insensitive, trimmed, aliases mapped). For example, `ROBOTS` or `robots` maps to `robots`, and `owned_inventory` maps canonically to `inventory`.

### 2.2 Explicit Permitted Public Columns & Row Policy Predicates
Each retained table enforces a strict column allowlist (`TABLE_COLUMNS`) and public policy row predicates:

| Table | Permitted Export Columns | Strictly Excluded / Redacted | Row Policy Predicate |
| :--- | :--- | :--- | :--- |
| **`sources`** | `id`, `sourceType`, `title`, `url`, `excerpt`, `author`, `platform`, `publishedAt`, `relevanceStatus` | `rawMeta`, internal notes | `relevanceStatus: "ACCEPTED"` |
| **`robots`** | `id`, `canonicalName`, `description`, `manufacturer`, `developerOrg`, `countryOfOrigin`, `robotType`, `embodimentLevel`, `officialUrl`, `firstSeenYear`, `thailandStatus` | Internal editorial notes | `thailandStatus in [...]`, case-insensitive public exclusions (`publicRobotWhere`), and in-memory `isEligiblePublicRobot` |
| **`contributions`** | `id`, `title`, `description`, `contributorName`, `organization`, `contributionType`, `license`, `sourceUrl`, `verificationStatus` | `visibility` (used for verification only), unreviewed submitter contacts | `visibility: "public"`, `verificationStatus: "APPROVED"`, and in-memory `isEligiblePublicContribution` |
| **`inventory`** | `id`, `displayName`, `ownershipStatus`, `conditionStatus`, `ownerOrg`, `robotModelId` | **`serialNumber`**, **`custodian`**, **`locationLabel`**, **`notes`** | `visibility: "public"` |
| **`submissions`** | *(Export Disabled)* | All submitter contacts and internal notes | Disabled pending workflow policy confirmation (403) |
| **`perspective_annotations`**| `id`, `sourceId`, `perspectiveTheme`, `targetEntity`, `stance`, `sentiment`, `evidenceExcerpt`, `method`, `createdAt` | Internal reviewer notes | Parent `source: { relevanceStatus: "ACCEPTED" }` |
| **`pull_jobs`** | `id`, `adapter`, `query`, `status`, `recordsFound`, `recordsSaved`, `startedAt`, `finishedAt`, `createdAt` | Internal error stack traces | Bounded operator execution |

### 2.3 Mixed-Case Placeholder Neutralization & Dual-Layer Policy Enforcement
- In `lib/public-projection.ts`, `publicRobotWhere` applies `mode: "insensitive"` across all excluded terms:
  - `"placeholder"` (neutralizes `pLaCeHoLdEr`, `PLACEHOLDER`, `Placeholder`, etc.)
  - `"prototype pending"`
  - `"rumored_unverified"`
  - Excluded out-of-scope foreign demo models (`"bumi humanoid robot"`, `"ubtech walker"`, `"hospital delivery service robot"`, `"thai university social robot prototype"`)
- Dual-layer enforcement:
  1. **SQL query level:** Prisma applies `ILIKE` clauses via `mode: "insensitive"`.
  2. **In-memory level:** Filtered through `isEligiblePublicRobot(canonicalName)`, guaranteeing strict equivalence with `app/robots/page.tsx` and `lib/network-graph.ts`.

### 2.4 Contribution Query Projection & Validation
- In `buildExportContributionsQuery`, `select` explicitly includes `visibility: true` alongside public metadata fields.
- `isEligiblePublicContribution` verifies that `c.visibility === "public"` and `c.verificationStatus === "APPROVED"`.
- `generateCsv` maps only keys in `TABLE_COLUMNS.contributions`, ensuring that internal verification fields like `visibility` are never leaked into the resulting CSV header or rows.

### 2.5 Submissions Export Policy
- Submissions export is kept completely disabled pending review workflow policy confirmation.
- Direct API calls (`/api/export?table=submissions`) return HTTP 403 `{"ok": false, "code": "WORKFLOW_UNAVAILABLE", "error": "Submissions export is disabled pending review workflow policy confirmation."}`.
- In the database browser (`/database?table=submissions`), an informative banner explains that submissions browsing and export are disabled, with a disabled export button and zero records loaded.

### 2.6 Browser Preview & Export Membership Parity
- Both `app/database/page.tsx` and `app/api/export/route.ts` invoke the shared `fetchExportableRecords(table, q, limit)` function.
- Uniform ordering: All retained queries apply `orderBy: { createdAt: "desc" }`.
- Uniform pagination: Both default to `DEFAULT_EXPORT_LIMIT = 250`, with export URLs synchronizing active search filter `q` and bounded limit.
- Result: The records visible in the browser preview table are 100% identical in sequence, membership, and columns to the exported CSV.

### 2.7 Spreadsheet Formula Injection Neutralization
The `escapeCsvValue` sanitizer neutralizes all risky formula trigger characters:
- Triggers detected: `^[=+\-@\t\r|%]`
- When detected, the string is prepended with a single quote (`'`), instructing spreadsheet engines (Excel, Google Sheets, LibreOffice Calc) to parse the cell as a literal text string rather than an executable formula.
- Embedded quotes are escaped (`""`) and fields containing delimiters, newlines, or quotes are wrapped in standard RFC 4180 double quotes.
- Null bytes (`\0`) are stripped.

### 2.8 Bounded Execution
All table export queries cap `take` at `MAX_EXPORT_ROWS = 2000`, preventing out-of-memory denial of service.
