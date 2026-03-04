// src/app/api/portfolio/recent-wins/route.ts — v4
// Proxies /api/success-stories/summary and adds budget wins
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveOrgActiveProjectScope } from "@/lib/server/project-scope";

function safeStr(x: any) { return typeof x === "string" ? x : x == null ? "" : String(x); }
function safeLower(x: any) { return safeStr(x).trim().toLowerCase(); }
function fmtDateUK(x: any): string | null {
  if (!x) return null;
  const s = String(x).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3].padStart(2,"0")}/${m[2].padStart(2,"0")}/${m[1]}`;
  const d = new Date(s); if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getUTCDate()).padStart(2,"0")}/${String(d.getUTCMonth()+1).padStart(2,"0")}/${d.getUTCFullYear()}`;
}
function isoSortKey(x: any) {
  if (!x) return ""; const d = new Date(String(x));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}
function isoDaysAgo(days: number) {
  const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString();
}

async function getBudgetWins(supabase: any, projectIds: string[], since: string, projById: Map<string, any>) {
  const wins: any[] = [];
  if (!projectIds.length) return wins;

  // Try project_financials first, then project_budgets
  const tables = ["project_financials", "project_budgets", "budgets"];
  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select("id, project_id, budget, actual_cost, forecast_cost, updated_at, period_end, approved_budget, spent_to_date")
      .in("project_id", projectIds)
      .gte("updated_at", since)
      .limit(200);

    if (error) continue;
    if (!Array.isArray(data) || !data.length) continue;

    for (const f of data) {
      const pid = safeStr(f?.project_id).trim();
      const p = projById.get(pid);
      const budget = Number(f?.budget ?? f?.approved_budget ?? 0);
      const actual = Number(f?.actual_cost ?? f?.spent_to_date ?? 0);
      const forecast = Number(f?.forecast_cost ?? actual);
      if (!budget || budget <= 0) continue;

      const underspend = budget - forecast;
      const pct = Math.round((actual / budget) * 100);

      // Only count as a win if under budget (positive signal)
      if (underspend > 0 && pct <= 100) {
        wins.push({
          id: `budget_${f.id}`,
          category: "Commercial",
          title: "On Budget",
          summary: `Project tracking £${Math.round(underspend).toLocaleString("en-GB")} under budget (${pct}% spent).`,
          happened_at: safeStr(f?.updated_at || f?.period_end).trim() || new Date().toISOString(),
          happened_at_uk: fmtDateUK(f?.updated_at || f?.period_end),
          project_id: pid || null,
          project_title: p?.title || null,
          href: pid ? `/projects/${pid}` : null,
        });
      }
    }
    break; // stop after first working table
  }
  return wins;
}

async function handle(req: NextRequest, days: number, limit: number) {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  // Fetch summary from existing success-stories endpoint
  const baseUrl = new URL(req.url);
  const summaryUrl = `${baseUrl.origin}/api/success-stories/summary?days=${days}`;
  const summaryRes = await fetch(summaryUrl, {
    headers: { cookie: req.headers.get("cookie") || "" },
    cache: "no-store",
  });

  if (!summaryRes.ok) {
    return NextResponse.json({ ok: false, error: "Failed to fetch summary" }, { status: 502 });
  }

  const summary = await summaryRes.json();
  const topWins: any[] = (Array.isArray(summary?.top) ? summary.top : []).map((w: any) => ({
  ...w,
  type: w?.type ?? w?.category ?? "other",
  category: w?.category ?? w?.type ?? "other",
}));

  // Build projById map from top wins for budget lookup
  const scoped = await resolveOrgActiveProjectScope(supabase, user.id);
  const projectIds: string[] = Array.isArray(scoped?.projectIds) ? scoped.projectIds : [];
  const since = isoDaysAgo(days);

  // Get project details including PM for enrichment
  const projById = new Map<string, any>();
  if (projectIds.length) {
    const { data: prows } = await supabase
      .from("projects")
      .select("id, title, project_code, project_manager, project_manager_id")
      .in("id", projectIds)
      .limit(1000);
    for (const p of prows ?? []) projById.set(String((p as any).id), p);
  }

  // Also fetch profile names for PM ids
  const pmById = new Map<string, string>();
  const pmIds = [...projById.values()]
    .map((p: any) => p?.project_manager_id).filter(Boolean);
  if (pmIds.length) {
    const { data: pmRows } = await supabase
      .from("profiles")
      .select("user_id, id, full_name, name, display_name")
      .in("user_id", pmIds)
      .limit(500);
    for (const pm of pmRows ?? []) {
      const name = safeStr((pm as any)?.full_name || (pm as any)?.display_name || (pm as any)?.name).trim();
      const uid = safeStr((pm as any)?.user_id || (pm as any)?.id).trim();
      if (uid && name) pmById.set(uid, name);
    }
  }

  // Get budget wins
  const budgetWins = await getBudgetWins(supabase, projectIds, since, projById);

  // Merge all wins, sort by date, limit
  const allWins = [...topWins, ...budgetWins]
    .sort((a, b) => isoSortKey(b.happened_at).localeCompare(isoSortKey(a.happened_at)))
    .slice(0, limit);

  const res = NextResponse.json({
    ok: true,
    wins: allWins,
    days,
    count: allWins.length,
    score: summary?.score ?? 0,
    prev_score: summary?.prev_score ?? 0,
    delta: summary?.delta ?? 0,
    breakdown: {
      ...(summary?.breakdown ?? {}),
      budget_on_track: budgetWins.length,
    },
    meta: {
      organisationId: scoped?.organisationId ?? null,
      since_iso: since,
      total_wins: summary?.meta?.total_wins ?? allWins.length,
    },
  });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const days = Math.min(60, Math.max(7, parseInt(url.searchParams.get("days") ?? "30", 10)));
    const limit = Math.min(20, Math.max(1, parseInt(url.searchParams.get("limit") ?? "8", 10)));
    return await handle(req, days, limit);
  } catch (e: any) {
    const res = NextResponse.json({ ok: false, error: safeStr(e?.message || e) }, { status: 500 });
    res.headers.set("Cache-Control", "no-store, max-age=0");
    return res;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const days = Math.min(60, Math.max(7, parseInt(String(body?.days ?? 30), 10)));
    const limit = Math.min(20, Math.max(1, parseInt(String(body?.limit ?? 8), 10)));
    return await handle(req, days, limit);
  } catch (e: any) {
    const res = NextResponse.json({ ok: false, error: safeStr(e?.message || e) }, { status: 500 });
    res.headers.set("Cache-Control", "no-store, max-age=0");
    return res;
  }
}

