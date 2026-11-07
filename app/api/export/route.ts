import { NextRequest, NextResponse } from "next/server";
import { getOperatorPrincipal } from "@/lib/operator";
import {
  isAllowedTable,
  normalizeTableName,
  ALLOWED_TABLES,
  TABLE_COLUMNS,
  fetchExportableRecords,
  generateCsv,
  DEFAULT_EXPORT_LIMIT,
  type AllowedTable
} from "@/lib/csv-export";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Public data protection (M3 / T03 / M2): CSV Export is strictly restricted to authenticated operators
  // Unsigned cookies (admin_session, user_role, user_email) and Basic auth credentials must never grant operator access.
  const session = await getOperatorPrincipal();
  if (!session.ok) {
    return NextResponse.json(
      { ok: false, code: "WORKFLOW_UNAVAILABLE" },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const rawTable = searchParams.get("table") || "sources";
  const rawTableLower = rawTable.trim().toLowerCase();

  // Fail-closed for submissions: Submissions export is disabled pending review workflow policy confirmation.
  if (rawTableLower === "submissions" || rawTableLower === "submission") {
    return NextResponse.json(
      {
        ok: false,
        code: "WORKFLOW_UNAVAILABLE",
        error: "Submissions export is disabled pending review workflow policy confirmation."
      },
      { status: 403 }
    );
  }

  const normalized = normalizeTableName(rawTable);

  // Validate allowed table selection (Audit D12 / S3)
  if (!normalized) {
    return NextResponse.json(
      {
        error: `Invalid table '${rawTable}'. Allowed tables: ${ALLOWED_TABLES.join(", ")}`
      },
      { status: 400 }
    );
  }

  const table: AllowedTable = normalized;
  const q = searchParams.get("q");
  const limitParam = searchParams.get("limit");
  const parsedLimit = limitParam ? parseInt(limitParam, 10) : DEFAULT_EXPORT_LIMIT;
  const limit = Number.isNaN(parsedLimit) || parsedLimit <= 0 ? DEFAULT_EXPORT_LIMIT : parsedLimit;

  const data = await fetchExportableRecords(table, q, limit);

  const columns = TABLE_COLUMNS[table];
  const csvContent = generateCsv(columns, data || []);

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${table}.csv"`
    }
  });
}
