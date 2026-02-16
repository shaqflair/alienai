import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

/* ---------------- helpers ---------------- */

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

  // Get project memberships for the current user
  const { data: memberships, error: memErr } = await supabase
    .from("project_members")
    .select("project_id, removed_at")
    .eq("user_id", userId)
    .is("removed_at", null);

  if (memErr) {
    return NextResponse.json({ ok: false, error: memErr.message }, { status: 500 });
  }

  const projectIds = (memberships || []).map((m: any) => m.project_id).filter(Boolean);

  // Return zeroed out schema if no projects found to avoid frontend crashes
  if (!projectIds.length) {
    return NextResponse.json({
      ok: true,
      days,
      panel: {
        days,
        due_count: 0,
        overdue_count: 0,
        ai_high_risk_count: 0,
        status_breakdown: { planned: 0, at_risk: 0, overdue: 0 },
        slippage: { avg_slip_days: 0, max_slip_days: 0 },
      },
      count: 0,
    });
  }

  // RPC call for aggregated portfolio metrics
  const { data, error } = await supabase.rpc("get_schedule_milestones_kpis_portfolio", {
    p_project_ids: projectIds,
    p_window_days: days,
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : data;

  const planned = num(row?.planned);
  const at_risk = num(row?.at_risk);
  const overdue = num(row?.overdue);
  const ai_high_risk = num(row?.ai_high_risk);
  const slip_avg_days = num(row?.slip_avg_days);
  const slip_max_days = num(row?.slip_max_days);

  // Structure the response for a "Panel" or "Widget" component
  const panel = {
    days,
    due_count: planned,
    overdue_count: overdue,
    ai_high_risk_count: ai_high_risk,
    status_breakdown: {
      planned,
      at_risk,
      overdue,
    },
    slippage: {
      avg_slip_days: slip_avg_days,
      max_slip_days: slip_max_days,
    },
  };

  return NextResponse.json({ ok: true, days, panel, count: planned });
}
