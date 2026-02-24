import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    items: [],
    debug: "exec approvals pending route alive",
    ts: new Date().toISOString(),
  });
}