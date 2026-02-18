import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

/* ---------------- helpers ---------------- */

/**
 * Ensures the 'days' query parameter is within allowed thresholds
 * to maintain consistent reporting buckets.
 */
function clampDays(x: string | null, fallback = 30) {
  const n = Number(x);
  if (!Number.isFinite(n)) return fallback;
  const allowed = new Set([7, 14, 30, 60]);
  return allowed.has(n) ? n : fallback;
}

function num(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const url = new URL(req.url);

  const days = clampDays(url.searchParams.get("days"), 30);

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  // Fetch only active memberships to respect RLS and project access
  const { data: memberships, error: memErr } = await supabase
    .from("project_members")
    .select("project_id, removed_at")
    .eq("user_id", userId)
    .is("removed_at", null);

  if (memErr) {
    return NextResponse.json({ ok: false, error: memErr.message }, { status: 500 });
  }

  const projectIds = (memberships || []).map((m: any) => m.project_id).filter(Boolean);

  if (!projectIds.length) {
    return NextResponse.json({ ok: true, days, count: 0 });
  }

  // ? Single RPC call for portfolio totals: efficient multi-project aggregation
  const { data, error } = await supabase.rpc("get_schedule_milestones_kpis_portfolio", {
    p_project_ids: projectIds,
    p_window_days: days,
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  const planned = num(row?.planned);

  return NextResponse.json({ ok: true, days, count: planned });
}
