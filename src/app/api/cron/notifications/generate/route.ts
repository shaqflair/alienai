// src/app/api/cron/notifications/generate/route.ts
import "server-only";

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function s(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

/**
 * Protect cron using Authorization: Bearer <CRON_SECRET>
 * - Set CRON_SECRET in Vercel env
 * - Configure Vercel Cron to send header Authorization: Bearer <CRON_SECRET>
 */
function assertCronAuth(req: Request) {
  const expected = (process.env.CRON_SECRET || "").trim();
  if (!expected) return; // allow if not configured (dev / early go-live)
  const got = (req.headers.get("authorization") || "").trim();
  if (got !== `Bearer ${expected}`) throw new Error("Unauthorized");
}

export async function GET(req: Request) {
  try {
    assertCronAuth(req);

    // ✅ safe no-op for now (won't change data)
    return NextResponse.json({
      ok: true,
      generated: 0,
      meta: { ts: new Date().toISOString() },
    });
  } catch (e: any) {
    const msg = s(e?.message || e);
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

export async function POST(req: Request) {
  return GET(req);
}
