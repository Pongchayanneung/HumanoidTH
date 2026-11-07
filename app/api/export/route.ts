import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Public data protection (M3 / T03): CSV Export is restricted to authenticated operators
  const adminCookie = req.cookies.get("admin_session")?.value;
  const authHeader = req.headers.get("authorization");
  const expectedUser = process.env.ADMIN_BASIC_USER || "creativelab.co.th@gmail.com";
  const expectedPassword = process.env.ADMIN_BASIC_PASSWORD || "I@M_Cr3LabTH_F4M";
  let isAuthorized = adminCookie === "true";

  if (!isAuthorized && authHeader?.startsWith("Basic ")) {
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
      { status: 401 }
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
    case "perspective_annotations":
      data = await prisma.perspectiveAnnotation.findMany();
      break;
    case "pull_jobs":
      data = await prisma.sourcePullJob.findMany();
      break;
    default:
      data = await prisma.sourceRecord.findMany();
  }

  if (data.length === 0) {
    return new NextResponse("id,empty\n1,No records found", {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${table}_export.csv"`
      }
    });
  }

  // Parse columns
  const keys = Object.keys(data[0]);
  
  // Helper to escape values for CSV compatibility and formula safety
  const escapeCSVValue = (val: any) => {
    if (val === null || val === undefined) return "";
    let str = typeof val === "object" ? JSON.stringify(val) : String(val);
    // Neutralize spreadsheet formula injection
    if (/^[=+\-@\t\r]/.test(str)) {
      str = "'" + str;
    }
    // Escape double quotes by doubling them
    str = str.replace(/"/g, '""');
    // Wrap in double quotes if it contains commas, quotes, or newlines
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
      return `"${str}"`;
    }
    return str;
  };

  // Build CSV content
  const headerRow = keys.join(",");
  const rows = data.map((row) => 
    keys.map((key) => escapeCSVValue(row[key])).join(",")
  );

  const csvContent = [headerRow, ...rows].join("\n");

  return new NextResponse(csvContent, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${table}_export.csv"`
    }
  });
}
