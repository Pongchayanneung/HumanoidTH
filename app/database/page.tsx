import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { getTranslation } from "@/lib/translations";
import { getOperatorPrincipal } from "@/lib/operator";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Raw Database Browser",
  robots: { index: false, follow: false }
};

type SearchParams = Promise<{ table?: string; q?: string }>;

const tableOptions = [
  { value: "sources", label: "Source Records" },
  { value: "robots", label: "Robot Models" },
  { value: "owned_inventory", label: "Owned Inventory" },
  { value: "contributions", label: "Contributions" },
  { value: "submissions", label: "Submitted Data" },
  { value: "perspective_annotations", label: "Perspective Annotations" },
  { value: "pull_jobs", label: "Source Pull Jobs" }
] as const;

export default async function DatabasePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const table = tableOptions.some(t => t.value === params.table) ? params.table! : "sources";
  const q = params.q ?? "";

  const cookieStore = await cookies();
  const lang = (cookieStore.get("lang")?.value || "en") as "en" | "th";
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

  let data: any[] = [];

  try {
    switch (table) {
      case "robots":
        data = await prisma.robotModel.findMany({
          where: q ? { canonicalName: { contains: q, mode: "insensitive" } } : {},
          orderBy: { createdAt: "desc" },
          take: 250
        });
        break;
      case "owned_inventory":
        data = await prisma.ownedInventory.findMany({
          where: q ? { displayName: { contains: q, mode: "insensitive" } } : {},
          orderBy: { createdAt: "desc" },
          take: 250
        });
        break;
      case "contributions":
        data = await prisma.contribution.findMany({
          where: q ? { title: { contains: q, mode: "insensitive" } } : {},
          orderBy: { createdAt: "desc" },
          take: 250
        });
        break;
      case "submissions":
        data = await prisma.submittedData.findMany({
          where: q ? { title: { contains: q, mode: "insensitive" } } : {},
          orderBy: { createdAt: "desc" },
          take: 250
        });
        break;
      case "perspective_annotations":
        data = await prisma.perspectiveAnnotation.findMany({
          where: q ? { perspectiveTheme: { contains: q, mode: "insensitive" } } : {},
          orderBy: { createdAt: "desc" },
          take: 250
        });
        break;
      case "pull_jobs":
        data = await prisma.sourcePullJob.findMany({
          where: q ? { query: { contains: q, mode: "insensitive" } } : {},
          orderBy: { createdAt: "desc" },
          take: 250
        });
        break;
      default:
        data = await prisma.sourceRecord.findMany({
          where: q ? { title: { contains: q, mode: "insensitive" } } : {},
          orderBy: { createdAt: "desc" },
          take: 250
        });
    }
  } catch (error) {
    console.error("Database query failed in database browser page:", error);
  }

  // Column headers based on keys in records
  const headers = data.length > 0 ? Object.keys(data[0]) : [];

  return (
    <>
      <div className="topline">
        <div>
          <h1>{t.databaseTitle}</h1>
          <p className="muted">{t.databaseDesc}</p>
        </div>
        <div className="toolbar">
          <a className="button primary" href={`/api/export?table=${table}`} download>
            Export CSV ({table.replace(/_/g, " ")})
          </a>
        </div>
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

      {/* Selector & Search Form */}
      <form method="GET" className="panel db-form">
        <label style={{ fontSize: "12px", display: "flex", flexDirection: "column", gap: "4px" }}>
          Table selection
          <select name="table" defaultValue={table}>
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
      <div className="panel" style={{ padding: "12px" }}>
        <h2 style={{ fontSize: "14px", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "10px" }}>
          Table Preview: <code>{table}</code> ({data.length} records)
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
                    No records found in this table query.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
