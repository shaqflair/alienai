// src/app/api/portfolio/milestones/panel/route.ts
// ✅ Org-scoped: all org members see portfolio-wide milestone KPIs.
// ✅ clampDays handles "all" → 60 (HomePage sends ?days=all).
// ✅ No-store cache on all responses.
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveOrgActiveProjectScope } from "@/lib/server/project-scope";

export const runtime = "nodejs";

/* ---------------- helpers ---------------- */

function noStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function jsonOk(data: any, status = 200): NextResponse {
  return noStore(NextResponse.json({ ok: true, ...data }, { status }));
}

function jsonErr(error: string, status = 400, meta?: any): NextResponse {
  return noStore(NextResponse.json({ ok: false, error, meta }, { status }));
}

// ✅ Intercepts "all" before Number() conversion.
function clampDays(x: string | null, fallback = 30): 7 | 14 | 30 | 60 {
  const s = String(x ?? "").trim().toLowerCase();
  if (s === "all") return 60;
  const n = Number(s);
  return Number.isFinite(n) && new Set([7, 14, 30, 60]).has(n)
    ? (n as 7 | 14 | 30 | 60)
    : (fallback as 7 | 14 | 30 | 60);
}

function num(x: any, fallback = 0): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function emptyPanel(days: number) {
  return {
    days,
    due_count:          0,
    overdue_count:      0,
    ai_high_risk_count: 0,
    status_breakdown:   { planned: 0, at_risk: 0, overdue: 0 },
    slippage:           { avg_slip_days: 0, max_slip_days: 0 },
  };
}

/* ---------------- GET ---------------- */

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const url      = new URL(req.url);
    const days     = clampDays(url.searchParams.get("days"), 30);

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (authErr || !userId) return jsonErr("Not authenticated", 401);

    // ✅ Org-wide scope for executive dashboard.
    const scoped     = await resolveOrgActiveProjectScope(supabase, userId);
    const projectIds = (scoped?.projectIds ?? []).filter(Boolean);

    if (!projectIds.length) {
      return jsonOk({
        days,
        panel: emptyPanel(days),
        count: 0,
        meta: {
          scope:          "org",
          organisationId: scoped?.organisationId ?? null,
          projectCount:   0,
        },
      });
    }

    const { data, error } = await supabase.rpc(
      "get_schedule_milestones_kpis_portfolio",
      { p_project_ids: projectIds, p_window_days: days }
    );

    if (error) return jsonErr(error.message || "RPC failed", 500);

    const row = Array.isArray(data) ? data[0] : data;

    const planned     = num(row?.planned);
    const at_risk     = num(row?.at_risk);
    const overdue     = num(row?.overdue);
    const ai_high_risk = num(row?.ai_high_risk);
    const avg_slip    = num(row?.slip_avg_days);
    const max_slip    = num(row?.slip_max_days);

    // due_count comes from the RPC — don't re-sum to avoid drift if RPC adds new buckets.
    const due_count = num(row?.due_count, planned + at_risk + overdue);

    const panel = {
      days,
      due_count,
      overdue_count:      overdue,
      ai_high_risk_count: ai_high_risk,
      status_breakdown:   { planned, at_risk, overdue },
      slippage:           { avg_slip_days: avg_slip, max_slip_days: max_slip },
    };

    return jsonOk({
      days,
      panel,
      count: due_count,
      meta: {
        scope:          "org",
        organisationId: scoped?.organisationId ?? null,
        projectCount:   projectIds.length,
      },
    });
  } catch (e: any) {
    console.error("[GET /api/portfolio/milestones/panel]", e);
    return jsonErr(String(e?.message ?? e), 500);
  }
}