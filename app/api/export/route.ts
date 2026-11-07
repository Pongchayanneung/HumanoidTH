import { NextRequest, NextResponse } from "next/server";
import { getOperatorPrincipal } from "@/lib/operator";
import {
  isAllowedTable,
  normalizeTableName,
  ALLOWED_TABLES,
  TABLE_COLUMNS,
  buildExportRobotsQuery,
  buildExportContributionsQuery,
  buildExportInventoryQuery,
  buildExportSubmissionsQuery,
  buildExportPerspectiveAnnotationsQuery,
  buildExportPullJobsQuery,
  buildExportSourcesQuery,
  generateCsv,
  MAX_EXPORT_ROWS,
  type AllowedTable
} from "@/lib/csv-export";
import { isEligiblePublicRobot, isEligiblePublicContribution } from "@/lib/public-projection";

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
  const parsedLimit = limitParam ? parseInt(limitParam, 10) : MAX_EXPORT_ROWS;
  const limit = Number.isNaN(parsedLimit) || parsedLimit <= 0 ? MAX_EXPORT_ROWS : parsedLimit;

  let data: Record<string, unknown>[] = [];
  const { prisma } = await import("@/lib/prisma");

  switch (table) {
    case "robots": {
      const robots = await prisma.robotModel.findMany(buildExportRobotsQuery(q, limit));
      data = robots.filter((r) => isEligiblePublicRobot(String(r.canonicalName)));
      break;
    }
    case "contributions": {
      const contributions = await prisma.contribution.findMany(buildExportContributionsQuery(q, limit));
      data = contributions.filter((c) => isEligiblePublicContribution(c as any));
      break;
    }
    case "inventory":
    case "owned_inventory":
      data = await prisma.ownedInventory.findMany(buildExportInventoryQuery(q, limit));
      break;
    case "submissions": {
      const submissions = await prisma.submittedData.findMany(buildExportSubmissionsQuery(q, limit));
      data = submissions.filter((s) => s.status === "APPROVED");
      break;
    }
    case "perspective_annotations":
      data = await prisma.perspectiveAnnotation.findMany(buildExportPerspectiveAnnotationsQuery(q, limit));
      break;
    case "pull_jobs":
      data = await prisma.sourcePullJob.findMany(buildExportPullJobsQuery(q, limit));
      break;
    case "sources":
    default:
      data = await prisma.sourceRecord.findMany(buildExportSourcesQuery(q, limit));
      break;
  }

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
