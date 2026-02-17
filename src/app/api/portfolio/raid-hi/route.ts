// src/app/api/portfolio/raid-panel/route.ts
import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveActiveProjectScope } from "@/lib/server/project-scope";

export const runtime = "nodejs";

function clampDays(v: string | null) {
  const n = Number(v);
  const allowed = new Set([7, 14, 30, 60]);
  return allowed.has(n) ? n : 30;
}

function safeJson(x: any): any {
  if (!x) return null;
  if (typeof x === "object") return x;
  try {
    return JSON.parse(String(x));
  } catch {
    return null;
  }
}

/**
 * Normalise Supabase RPC output shapes into a plain object:
 * - { ... }
 * - { fn_name: { ... } }
 * - [ { fn_name: { ... } } ]
 * - stringified JSON
 */
function normalizePanel(raw: any, fnName?: string) {
  const j = safeJson(raw);

  if (Array.isArray(j) && j.length) {
    const first = j[0];
    if (fnName && first?.[fnName]) return safeJson(first[fnName]);
    if (first?.get_portfolio_raid_panel) return safeJson(first.get_portfolio_raid_panel);
    if (first?.get_portfolio_raid_hi_crit) return safeJson(first.get_portfolio_raid_hi_crit);
    return safeJson(first);
  }

  if (fnName && j?.[fnName]) return safeJson(j[fnName]);
  if (j?.get_portfolio_raid_panel) return safeJson(j.get_portfolio_raid_panel);
  if (j?.get_portfolio_raid_hi_crit) return safeJson(j.get_portfolio_raid_hi_crit);

  return j;
}

function emptyPanel(days: number) {
  return {
    days,
    due_total: 0,
    overdue_total: 0,
    risk_hi: 0,
    issue_hi: 0,
    dependency_hi: 0,
    assumption_hi: 0,
    overdue_hi: 0,
  };
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const url = new URL(req.url);
  const days = clampDays(url.searchParams.get("days"));

  // âœ… auth
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  // âœ… ACTIVE projects in scope (membership + not deleted + not closed)
  const scoped = await resolveActiveProjectScope(supabase, auth.user.id);
  const projectIds = scoped.projectIds;

  if (!projectIds.length) {
    return NextResponse.json({
      ok: true,
      panel: emptyPanel(days),
      meta: { project_count: 0, active_only: true, scope: scoped.meta },
    });
  }

  // âœ… Preferred: single RPC that returns BOTH totals + hi/crit breakdown
  const { data: panelData, error: panelErr } = await supabase.rpc("get_portfolio_raid_panel", {
    p_project_ids: projectIds,
    p_days: days,
  });

  if (!panelErr) {
    const panel = normalizePanel(panelData, "get_portfolio_raid_panel") ?? {};
    return NextResponse.json({
      ok: true,
      panel: {
        ...emptyPanel(days),
        ...panel,
        days: Number(panel?.days ?? days),
      },
      meta: { project_count: projectIds.length, active_only: true, scope: scoped.meta },
    });
  }

  // âœ… Fallback: hi/crit function + compute totals directly (all priorities)
  const { data: hiData, error: hiErr } = await supabase.rpc("get_portfolio_raid_hi_crit", {
    p_project_ids: projectIds,
    p_days: days,
  });

  if (hiErr) {
    return NextResponse.json(
      { ok: false, error: `${panelErr.message} | ${hiErr.message}` },
      { status: 500 }
    );
  }

  const hiPanel = normalizePanel(hiData, "get_portfolio_raid_hi_crit") ?? {};

  const openStatuses = ["Open", "In Progress"];

  const todayISO = new Date().toISOString().slice(0, 10); // yyyy-mm-dd
  const end = new Date();
  end.setDate(end.getDate() + days);
  const endISO = end.toISOString().slice(0, 10);

  const dueTotalQ = await supabase
    .from("raid_items")
    .select("id", { count: "exact", head: true })
    .in("project_id", projectIds)
    .in("status", openStatuses)
    .not("due_date", "is", null)
    .gte("due_date", todayISO)
    .lte("due_date", endISO);

  const overdueTotalQ = await supabase
    .from("raid_items")
    .select("id", { count: "exact", head: true })
    .in("project_id", projectIds)
    .in("status", openStatuses)
    .not("due_date", "is", null)
    .lt("due_date", todayISO);

  const due_total = Number(dueTotalQ.count ?? 0);
  const overdue_total = Number(overdueTotalQ.count ?? 0);

  return NextResponse.json({
    ok: true,
    panel: {
      ...emptyPanel(days),
      days,
      due_total,
      overdue_total,
      risk_hi: Number(hiPanel?.risk_hi ?? 0),
      issue_hi: Number(hiPanel?.issue_hi ?? 0),
      dependency_hi: Number(hiPanel?.dependency_hi ?? 0),
      assumption_hi: Number(hiPanel?.assumption_hi ?? 0),
      overdue_hi: Number(hiPanel?.overdue_hi ?? 0),
    },
    meta: {
      project_count: projectIds.length,
      active_only: true,
      used_fallback: true,
      rpc_error: panelErr.message,
      scope: scoped.meta,
    },
  });
}


