import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  return NextResponse.json({ ok: false, code: "WORKFLOW_UNAVAILABLE" }, { status: 403 });
}
