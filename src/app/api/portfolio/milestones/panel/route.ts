// src/app/api/ai/schedule-milestones/kpis/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveActiveProjectScope } from "@/lib/server/project-scope";

export const runtime = "nodejs";

/* ---------------- helpers ---------------- */

function clampDays(x: string | null, fallback = 30): 7 | 14 | 30 | 60 {
  const n = Number(x);
  const allowed = new Set([7, 14, 30, 60]);
  return Number.isFinite(n) && allowed.has(n) ? (n as any) : (fallback as any);
}

function num(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function ok(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}
function err(message: string, status = 400, meta?: any) {
  const res = NextResponse.json({ ok: false, error: message, meta }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function emptyPanel(days: number) {
  return {
    days,
    due_count: 0,
    overdue_count: 0,
    ai_high_risk_count: 0,
    status_breakdown: { planned: 0, at_risk: 0, overdue: 0 },
    slippage: { avg_slip_days: 0, max_slip_days: 0 },
  };
}

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const url = new URL(req.url);

    const days = clampDays(url.searchParams.get("days"), 30);

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    const userId = auth?.user?.id || null;
    if (authErr || !userId) return err("Not authenticated", 401);

    // ✅ ACTIVE + ACCESSIBLE projects only
    const scoped = await resolveActiveProjectScope(supabase, userId);
    const projectIds = Array.isArray(scoped?.projectIds) ? scoped.projectIds.filter(Boolean) : [];

    // Return zeroed schema if no active projects in scope
    if (!projectIds.length) {
      return ok({
        days,
        panel: emptyPanel(days),
        count: 0,
        meta: { scope: scoped?.meta ?? null },
      });
    }

    // RPC call for aggregated portfolio metrics
    const { data, error } = await supabase.rpc("get_schedule_milestones_kpis_portfolio", {
      p_project_ids: projectIds,
      p_window_days: days,
    });

    if (error) return err(error.message || "RPC failed", 500);

    const row = Array.isArray(data) ? data[0] : data;

    const planned = num(row?.planned);
    const at_risk = num(row?.at_risk);
    const overdue = num(row?.overdue);
    const ai_high_risk = num(row?.ai_high_risk);
    const slip_avg_days = num(row?.slip_avg_days);
    const slip_max_days = num(row?.slip_max_days);

    // ✅ “Due count” should represent total items in the window (planned + at risk + overdue)
    const due_count = planned + at_risk + overdue;

    const panel = {
      days,
      due_count,
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

    return ok({
      days,
      panel,
      count: due_count,
      meta: { scope: scoped?.meta ?? null, projectCount: projectIds.length },
    });
  } catch (e: any) {
    console.error("[GET /api/ai/schedule-milestones/kpis]", e);
    return err(String(e?.message || e || "Failed"), 500);
  }
}
