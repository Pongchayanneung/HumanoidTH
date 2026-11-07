import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  isAllowedTable,
  normalizeTableName,
  ALLOWED_TABLES,
  TABLE_COLUMNS,
  buildExportPrismaQuery,
  generateCsv,
  MAX_EXPORT_ROWS,
  type AllowedTable
} from "@/lib/csv-export";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Public data protection (M3 / T03): CSV Export is strictly restricted to authenticated operators
  const expectedUser = process.env.ADMIN_BASIC_USER;
  const expectedPassword = process.env.ADMIN_BASIC_PASSWORD;

  // Fail closed if admin credentials are not explicitly configured in environment
  if (!expectedUser || !expectedPassword) {
    return NextResponse.json(
      { error: "Service Unavailable. Export authentication credentials are not configured on this server." },
      { status: 503 }
    );
  }

  const authHeader = req.headers.get("authorization");
  let isAuthorized = false;

  if (authHeader?.startsWith("Basic ")) {
    try {
      const [user, pass] = atob(authHeader.slice(6)).split(":");
      if (user === expectedUser && pass === expectedPassword) {
        isAuthorized = true;
      }
    } catch {
      // ignore
    }
  }

  if (!isAuthorized) {
    return NextResponse.json(
      { error: "Unauthorized. CSV Export is restricted to authenticated operators." },
      {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="Operator Export"' }
      }
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

  let data: any[] = [];
  const query = buildExportPrismaQuery(table, q, limit);

  switch (table) {
    case "robots":
      data = await prisma.robotModel.findMany(query as any);
      break;
    case "contributions":
      data = await prisma.contribution.findMany(query as any);
      break;
    case "inventory":
    case "owned_inventory":
      data = await prisma.ownedInventory.findMany(query as any);
      break;
    case "submissions":
      data = await prisma.submittedData.findMany(query as any);
      break;
    case "perspective_annotations":
      data = await prisma.perspectiveAnnotation.findMany(query as any);
      break;
    case "pull_jobs":
      data = await prisma.sourcePullJob.findMany(query as any);
      break;
    case "sources":
    default:
      data = await prisma.sourceRecord.findMany(query as any);
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
