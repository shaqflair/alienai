import "server-only";
import { NextResponse } from "next/server";
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
 * Normalise Supabase RPC output shapes into a plain object
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
    risk_due: 0,
    issue_due: 0,
    dependency_due: 0,
    assumption_due: 0,
    risk_overdue: 0,
    issue_overdue: 0,
    dependency_overdue: 0,
    assumption_overdue: 0,
    risk_hi: 0,
    issue_hi: 0,
    dependency_hi: 0,
    assumption_hi: 0,
    overdue_hi: 0,
  };
}

function num(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function pickFirstFinite(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

type TypedCounts = {
  risk_due: number;
  issue_due: number;
  dependency_due: number;
  assumption_due: number;
  risk_overdue: number;
  issue_overdue: number;
  dependency_overdue: number;
  assumption_overdue: number;
};

/**
 * Compute due/overdue counts per RAID type
 */
async function computeTypedCounts(opts: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  projectIds: string[];
  days: number;
  openStatuses: string[];
}): Promise<TypedCounts> {
  const { supabase, projectIds, days, openStatuses } = opts;
  const types = ["Risk", "Issue", "Dependency", "Assumption"] as const;
  const todayISO = new Date().toISOString().slice(0, 10);
  const end = new Date();
  end.setDate(end.getDate() + days);
  const endISO = end.toISOString().slice(0, 10);

  const countFor = async (type: (typeof types)[number], mode: "due" | "overdue") => {
    let q = supabase
      .from("raid_items")
      .select("id", { count: "exact", head: true })
      .in("project_id", projectIds)
      .in("status", openStatuses)
      .not("due_date", "is", null)
      .eq("type", type);

    if (mode === "due") {
      q = q.gte("due_date", todayISO).lte("due_date", endISO);
    } else {
      q = q.lt("due_date", todayISO);
    }
    const r = await q;
    return Number(r.count ?? 0);
  };

  const results = await Promise.all([
    countFor("Risk", "due"), countFor("Issue", "due"), countFor("Dependency", "due"), countFor("Assumption", "due"),
    countFor("Risk", "overdue"), countFor("Issue", "overdue"), countFor("Dependency", "overdue"), countFor("Assumption", "overdue")
  ]);

  return {
    risk_due: results[0], issue_due: results[1], dependency_due: results[2], assumption_due: results[3],
    risk_overdue: results[4], issue_overdue: results[5], dependency_overdue: results[6], assumption_overdue: results[7]
  };
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const url = new URL(req.url);
  const days = clampDays(url.searchParams.get("days"));

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const scoped = await resolveActiveProjectScope(supabase, auth.user.id);
  const projectIds = scoped.projectIds;

  if (!projectIds.length) {
    return NextResponse.json({
      ok: true,
      panel: emptyPanel(days),
      meta: { project_count: 0, active_only: true, scope: scoped.meta },
    });
  }

  const openStatuses = ["Open", "In Progress"];
  const { data: panelData, error: panelErr } = await supabase.rpc("get_portfolio_raid_panel", {
    p_project_ids: projectIds,
    p_days: days,
  });

  let typed: TypedCounts;
  try {
    typed = await computeTypedCounts({ supabase, projectIds, days, openStatuses });
  } catch {
    typed = { risk_due: 0, issue_due: 0, dependency_due: 0, assumption_due: 0, risk_overdue: 0, issue_overdue: 0, dependency_overdue: 0, assumption_overdue: 0 };
  }

  if (!panelErr) {
    const panel = normalizePanel(panelData, "get_portfolio_raid_panel") ?? {};
    const due_total = (num(typed.risk_due) + num(typed.issue_due) + num(typed.dependency_due) + num(typed.assumption_due)) || num(pickFirstFinite(panel, ["due_total", "due_count"]), 0);
    const overdue_total = (num(typed.risk_overdue) + num(typed.issue_overdue) + num(typed.dependency_overdue) + num(typed.assumption_overdue)) || num(pickFirstFinite(panel, ["overdue_total", "overdue_count"]), 0);

    return NextResponse.json({
      ok: true,
      panel: { ...emptyPanel(days), ...panel, ...typed, due_total, overdue_total },
      meta: { project_count: projectIds.length, active_only: true, scope: scoped.meta },
    });
  }

  const { data: hiData, error: hiErr } = await supabase.rpc("get_portfolio_raid_hi_crit", {
    p_project_ids: projectIds,
    p_days: days,
  });

  if (hiErr) return NextResponse.json({ ok: false, error: `${panelErr.message} | ${hiErr.message}` }, { status: 500 });

  const hiPanel = normalizePanel(hiData, "get_portfolio_raid_hi_crit") ?? {};
  return NextResponse.json({
    ok: true,
    panel: {
      ...emptyPanel(days),
      ...typed,
      due_total: num(typed.risk_due) + num(typed.issue_due) + num(typed.dependency_due) + num(typed.assumption_due),
      overdue_total: num(typed.risk_overdue) + num(typed.issue_overdue) + num(typed.dependency_overdue) + num(typed.assumption_overdue),
      risk_hi: num(hiPanel?.risk_hi), issue_hi: num(hiPanel?.issue_hi), dependency_hi: num(hiPanel?.dependency_hi), assumption_hi: num(hiPanel?.assumption_hi), overdue_hi: num(hiPanel?.overdue_hi)
    },
    meta: { project_count: projectIds.length, active_only: true, used_fallback: true, rpc_error: panelErr.message, scope: scoped.meta },
  });
}
