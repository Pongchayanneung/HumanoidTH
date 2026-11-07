# Public-Policy-Safe CSV Downloads Specification (S3)

**Package:** Backlog Extension S3 — Issue #23  
**Assignee:** Suk-Nsr  
**Status:** Completed  
**Audit References:** T11, D12  
**Artifacts Modified & Created:**
- `lib/csv-export.ts`: Reusable CSV export logic, table schema allowlists, bounded execution, and formula injection neutralization
- `app/api/export/route.ts`: Secure export endpoint enforcing operator auth, table validation, query filtering, and CSV serialization
- `app/database/page.tsx`: Database browser export button preserving search filter `q`
- `test/csv-export.test.ts`: Complete unit test suite verifying table validation, column whitelisting, formula neutralization, empty table schemas, and route responses

---

## 1. Problem Statement & Audit Findings

Legacy CSV export suffered from two verified issues:
1. **Audit D12 (Mismatched Tables & Lost Search Scope):**
   - Selecting `owned_inventory` fell through to `SourceRecord` while retaining an inventory filename (`owned_inventory.csv`).
   - The UI search filter (`q`) was omitted from export URLs, so the export disregarded the on-screen filter.
   - Empty exports returned plain text `"No data available"` or synthetic `"id,empty"` records rather than a stable CSV schema.
   - Unrecognized table names silently fell back to exporting sources.
2. **Audit T11 (Spreadsheet Formula Injection & Unbounded In-Memory Loading):**
   - User-controlled strings starting with formula trigger characters (`=`, `+`, `-`, `@`, etc.) were exported raw, exposing spreadsheet users to formula execution risks.
   - Private inventory hardware serials, custodians, exact locations, internal notes, and submitter contact details were leaked without explicit column projections.
   - Entire tables were queried without limits, risking memory exhaustion.

---

## 2. Implemented Architecture & Protections

### 2.1 Table Validation & Normalization
The export API strictly validates the `table` query parameter against `ALLOWED_TABLES`:
- Allowed: `sources`, `robots`, `contributions`, `inventory`, `owned_inventory`, `submissions`, `perspective_annotations`.
- Any invalid or unrecognized table (e.g. `table=users`, `table=passwords`) **fails immediately with HTTP 400 Bad Request** and an explicit error payload listing allowed tables.
- `owned_inventory` maps canonically to `inventory`.

### 2.2 Explicit Permitted Public Columns
Each table enforces a strict column allowlist (`TABLE_COLUMNS`):

| Table | Permitted Export Columns | Strictly Excluded / Redacted |
| :--- | :--- | :--- |
| **`sources`** | `id`, `title`, `excerpt`, `author`, `platform`, `url`, `publishedAt`, `country`, `relevanceStatus` | `rawMeta`, `sourceMeta`, internal notes |
| **`robots`** | `id`, `canonicalName`, `description`, `manufacturer`, `developerOrg`, `countryOfOrigin`, `robotType`, `embodimentLevel`, `officialUrl`, `firstSeenYear`, `thailandStatus` | `primaryUseCase` editorial notes |
| **`contributions`** | `id`, `title`, `description`, `contributorName`, `organization`, `contributionType`, `license`, `sourceUrl`, `verificationStatus` | Unreviewed submitter contacts |
| **`inventory`** | `id`, `displayName`, `ownershipStatus`, `conditionStatus`, `ownerOrg`, `robotModelName` | **`serialNumber`**, **`custodian`**, **`locationLabel`**, **`notes`** |
| **`submissions`** | `id`, `title`, `description`, `category`, `status`, `sourceUrl`, `createdAt` | **`submitterContact`**, **`submitterEmail`** |
| **`perspective_annotations`**| `id`, `perspectiveTheme`, `targetEntity`, `stance`, `sentiment`, `evidenceExcerpt`, `method`, `createdAt` | Reviewer notes |

### 2.3 Spreadsheet Formula Injection Neutralization
The `escapeCsvValue` sanitizer neutralizes all risky formula trigger characters:
- Triggers detected: `^[=+\-@\t\r|%]`
- When detected, the string is prepended with a single quote (`'`), instructing spreadsheet engines (Excel, Google Sheets, LibreOffice Calc) to parse the cell as a literal text string rather than an executable formula.
- Embedded quotes are escaped (`""`) and fields containing delimiters, newlines, or quotes are wrapped in standard RFC 4180 double quotes.
- Null bytes (`\0`) are stripped.

### 2.4 Filter Synchronization & Stable Empty Tables
- The export endpoint reads `q` from the request URL and constructs the corresponding Prisma `where` clause matching the on-screen database browser.
- The UI download button in `app/database/page.tsx` forwards `q` when active: `/api/export?table=${table}&q=${encodeURIComponent(q)}`.
- If a query produces 0 records, the API returns **headers only** (e.g. `id,title,excerpt\r\n`), maintaining standard table schemas for automated parsers.

### 2.5 Bounded Execution
All table export queries cap `take` at `MAX_EXPORT_ROWS = 2000`, preventing out-of-memory denial of service.
