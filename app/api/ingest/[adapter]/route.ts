import { NextResponse } from "next/server";

type Params = Promise<{ adapter: string }>;

export async function POST(_request: Request, _context: { params: Params }) {
  return NextResponse.json({ ok: false, code: "WORKFLOW_UNAVAILABLE" }, { status: 403 });
}
