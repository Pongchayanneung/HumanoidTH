import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
  const table = searchParams.get("table") || "sources";

  let data: any[] = [];

  switch (table) {
    case "robots":
      data = await prisma.robotModel.findMany();
      break;
    case "contributions":
      data = await prisma.contribution.findMany();
      break;
    case "submissions":
      data = await prisma.submittedData.findMany();
      break;
    case "inventory":
    case "owned_inventory":
      data = await prisma.ownedInventory.findMany();
      break;
    case "perspective_annotations":
      data = await prisma.perspectiveAnnotation.findMany();
      break;
    case "pull_jobs":
      data = await prisma.sourcePullJob.findMany();
      break;
    case "sources":
      data = await prisma.sourceRecord.findMany();
      break;
    default:
      return new NextResponse(JSON.stringify({ error: `Unknown export table '${table}'.` }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
  }

  if (!data || data.length === 0) {
    return new NextResponse("No data available", {
      headers: {
        "Content-Type": "text/plain",
        "Content-Disposition": `attachment; filename="${table}.csv"`
      }
    });
  }

  const headers = Object.keys(data[0]);

  // Sanitize spreadsheet formula injection characters: =, +, -, @, \t, \r
  const escapeCsvValue = (val: any) => {
    if (val === null || val === undefined) return "";
    let str = typeof val === "object" ? JSON.stringify(val) : String(val);

    // If the value starts with risky formula trigger characters, prefix with single quote
    if (/^[=+\-@\t\r]/.test(str)) {
      str = `'${str}`;
    }

    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvRows = [
    headers.join(","),
    ...data.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(","))
  ];

  return new NextResponse(csvRows.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${table}.csv"`
    }
  });
}
