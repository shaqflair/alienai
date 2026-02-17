// src/app/api/cron/notifications/generate/route.ts
import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vercel Cron / server-to-server protection:
 * - Set CRON_SECRET in env
 * - Configure your cron to send header: x-cron-secret: <CRON_SECRET>
 */
function assertCronAuth(req: Request) {
  const expected = (process.env.CRON_SECRET || "").trim();
  if (!expected) return; // allow if not configured (dev)
  const got = (req.headers.get("x-cron-secret") || "").trim();
  if (!got || got !== expected) {
    throw new Error("Unauthorized");
  }
}

function s(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

/**
 * Minimal generator:
 * - safe no-op (returns ok) to unblock deployments
 * - You can extend this to generate notifications from due items / approvals / AI events
 */
export async function GET(req: Request) {
  try {
    assertCronAuth(req);

    const sb = await createClient();

    // ? If you later add logic, keep it server-only.
    // Example placeholder "health check" query (doesn't change data):
    // const { count } = await sb.from("notifications").select("id", { count: "exact", head: true });

    return NextResponse.json({
      ok: true,
      generated: 0,
      meta: {
        note: "cron generate is currently a safe no-op (server-only). Extend with your notification generation rules.",
        ts: new Date().toISOString(),
      },
    });
  } catch (e: any) {
    const msg = s(e?.message || e);
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

export async function POST(req: Request) {
  // allow POST too (some cron systems prefer POST)
  return GET(req);
}

