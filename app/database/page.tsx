import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslation, parseLanguage } from "@/lib/translations";
import { getOperatorPrincipal } from "@/lib/operator";
import { normalizeScalarParam, readBoundedTextParam } from "@/lib/contribution-filters";
import {
  fetchExportableRecords,
  TABLE_COLUMNS,
  DEFAULT_EXPORT_LIMIT,
  normalizeTableName,
  type AllowedTable
} from "@/lib/csv-export";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Raw Database Browser",
  robots: { index: false, follow: false }
};

type SearchParams = Promise<{ table?: string | string[]; q?: string | string[] }>;

const tableOptions = [
  { value: "sources", label: "Source Records" },
  { value: "robots", label: "Robot Models" },
  { value: "owned_inventory", label: "Owned Inventory" },
  { value: "contributions", label: "Contributions" },
  { value: "perspective_annotations", label: "Perspective Annotations" },
  { value: "pull_jobs", label: "Source Pull Jobs" }
] as const;

export default async function DatabasePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const rawTable = normalizeScalarParam(params.table);
  const isSubmissions =
    rawTable?.trim().toLowerCase() === "submissions" ||
    rawTable?.trim().toLowerCase() === "submission";
  const normalizedTable = normalizeTableName(rawTable);
  const table: AllowedTable = normalizedTable ?? "sources";
  const search = readBoundedTextParam(params.q);
  const q = search.value ?? "";

  const cookieStore = await cookies();
  const lang = parseLanguage(cookieStore.get("lang")?.value);
  const t = getTranslation(lang);

  // Defense in depth (M3 / T03): Raw database browsing is restricted to verified operators.
  // Reads verified operator principal; unauthenticated visitors are gated with an access restricted view.
  const session = await getOperatorPrincipal();
  if (!session.ok) {
    return (
      <div className="panel" style={{ padding: "32px", textAlign: "center", margin: "40px auto", maxWidth: "600px" }}>
        <h1 style={{ color: "var(--danger)", marginBottom: "12px" }}>Access Restricted</h1>
        <p className="muted" style={{ lineHeight: "1.6", marginBottom: "20px" }}>
          The Raw Database Browser contains internal inventory details, pending community submissions, and unverified data. It is restricted to authenticated operators in accordance with the public data projection policy (M3).
        </p>
        <Link className="button primary" href="/admin-login?from=/database">
          Log in as Operator
        </Link>
      </div>
    );
  }

  let data: Record<string, unknown>[] = [];
  let unavailable = false;

  if (!isSubmissions && !search.invalid) {
    try {
      // S3 Parity: Query identical exportable dataset using shared query builder, row predicates, and limit.
      data = await fetchExportableRecords(table, q, DEFAULT_EXPORT_LIMIT);
    } catch (error) {
      console.error("Database query failed in database browser page:", error);
      unavailable = true;
    }
  }

  // Column headers based strictly on explicit TABLE_COLUMNS allowlist
  const headers = isSubmissions ? [] : TABLE_COLUMNS[table] ?? [];

  return (
    <>
      <div className="topline">
        <div>
          <h1>{t.databaseTitle}</h1>
          <p className="muted">{t.databaseDesc}</p>
        </div>
        <div className="toolbar">
          {isSubmissions ? (
            <span
              className="button"
              style={{ opacity: 0.6, cursor: "not-allowed" }}
              aria-disabled="true"
              title="Submissions export is disabled pending review workflow policy confirmation."
            >
              Export CSV (disabled)
            </span>
          ) : (
            <a
              className="button primary"
              href={`/api/export?table=${table}${q ? `&q=${encodeURIComponent(q)}` : ""}&limit=${DEFAULT_EXPORT_LIMIT}`}
              download
            >
              Export CSV ({table.replace(/_/g, " ")})
            </a>
          )}
        </div>
      </div>

      {isSubmissions && (
        <div className="notice" role="alert" style={{ marginBottom: "16px" }}>
          <strong>Submissions Workflow Notice:</strong> Community submissions export and browsing are disabled pending review workflow policy confirmation (Issue #23).
        </div>
      )}

      <div className="panel muted" style={{ fontSize: "12px", marginBottom: "16px", padding: "10px 14px" }}>
        <strong>Export Policy Notice (S3):</strong> Displayed table view and CSV downloads have aligned public privacy boundaries (sensitive hardware serials, exact locations, custodians, and unreviewed submitter contacts are redacted; only verified/approved rows are exported) matching active search query filters.
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .db-form {
          display: grid;
          grid-template-columns: 1fr 2fr 100px;
          gap: 10px;
          align-items: end;
          margin-bottom: 16px;
        }
        @media (max-width: 768px) {
          .db-form {
            grid-template-columns: 1fr;
          }
          .db-form .query-btn {
            width: 100%;
          }
        }
      `}} />

      {search.invalid && (
        <p className="notice" role="alert">Invalid text search. Use at most 200 characters and no control characters.</p>
      )}
      {unavailable && <p className="notice" role="alert">{lang === "th" ? "ขณะนี้ไม่สามารถอ่านฐานข้อมูลได้" : "The database could not be read. Try again."}</p>}

      {/* Selector & Search Form */}
      <form method="GET" className="panel db-form">
        <label style={{ fontSize: "12px", display: "flex", flexDirection: "column", gap: "4px" }}>
          Table selection
          <select name="table" defaultValue={isSubmissions ? "submissions" : table}>
            {tableOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>

        <label style={{ fontSize: "12px", display: "flex", flexDirection: "column", gap: "4px" }}>
          Text Search within table
          <input name="q" defaultValue={q} placeholder={`Search fields in ${table}...`} />
        </label>

        <button type="submit" className="primary query-btn" style={{ minHeight: "36px" }}>Query</button>
      </form>

      {/* Dense Monospace Grid view */}
      {!unavailable && <div className="panel" style={{ padding: "12px" }}>
        <h2 style={{ fontSize: "14px", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "10px" }}>
          Table Preview: <code>{isSubmissions ? "submissions" : table}</code> ({data.length} records)
        </h2>
        
        <div className="table-wrap" style={{ border: "1px solid var(--border)", borderRadius: "4px" }}>
          <table style={{ fontFamily: "monospace", fontSize: "11px", whiteSpace: "nowrap" }}>
            <thead>
              <tr style={{ background: "var(--surface-muted)" }}>
                {headers.map(h => (
                  <th key={h} style={{ borderRight: "1px solid var(--border)", padding: "6px 8px" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, idx) => (
                <tr key={idx} style={{ borderBottom: "1px solid var(--border)" }}>
                  {headers.map(h => {
                    const val = row[h];
                    let displayVal = "";
                    if (val === null || val === undefined) {
                      displayVal = "NULL";
                    } else if (val instanceof Date) {
                      displayVal = val.toLocaleString();
                    } else if (typeof val === "object") {
                      displayVal = JSON.stringify(val);
                    } else {
                      displayVal = String(val);
                    }
                    return (
                      <td key={h} style={{ borderRight: "1px solid var(--border)", padding: "6px 8px", color: val === null ? "var(--text-secondary)" : "inherit" }}>
                        {displayVal.length > 50 ? `${displayVal.slice(0, 48)}...` : displayVal}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {!data.length && (
                <tr>
                  <td className="empty" colSpan={headers.length || 1} style={{ textAlign: "center", padding: "20px" }}>
                    {isSubmissions
                      ? "Submissions export and browsing are disabled pending review workflow policy confirmation."
                      : "No records found in this table query."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>}
    </>
  );
}
