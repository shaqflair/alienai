// src/app/api/portfolio/recent-wins/route.ts — v5 (ORG-WIDE + ACTIVE FILTER + project_code href)
// Proxies /api/success-stories/summary and adds budget wins
//
// Fixes / Adds:
//   ✅ RW-F1: ORG-wide scope via resolveOrgActiveProjectScope
//   ✅ RW-F2: Active-only project filtering via filterActiveProjectIds (normalized + FAIL-OPEN)
//   ✅ RW-F3: All responses no-store
//   ✅ RW-F4: Links prefer project_code (human id) else UUID fallback
//   ✅ RW-F5: Better PID extraction + enrichment safety

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveOrgActiveProjectScope, filterActiveProjectIds } from "@/lib/server/project-scope";

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function fmtDateUK(x: any): string | null {
  if (!x) return null;
  const s = String(x).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[1]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

function isoSortKey(x: any) {
  if (!x) return "";
  const d = new Date(String(x));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function withNoStore(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function projectCodeLabel(pc: any): string {
  if (typeof pc === "string") return pc.trim();
  if (typeof pc === "number" && Number.isFinite(pc)) return String(pc);
  if (pc && typeof pc === "object") {
    const v = safeStr(pc.project_code) || safeStr(pc.code) || safeStr(pc.value) || safeStr(pc.id);
    return v.trim();
  }
  return "";
}

function projectHref(project: any, projectIdFallback?: string | null) {
  const code = projectCodeLabel(project?.project_code);
  const ref = code || safeStr(projectIdFallback).trim();
  return ref ? `/projects/${encodeURIComponent(ref)}` : null;
}

async function normalizeActiveIds(supabase: any, rawIds: string[]) {
  const failOpen = (reason: string) => ({
    ids: rawIds,
    ok: false,
    error: reason,
  });

  try {
    const r: any = await filterActiveProjectIds(supabase, rawIds);

    // string[]
    if (Array.isArray(r)) {
      const ids = r.filter(Boolean);
      if (!ids.length && rawIds.length) return failOpen("active filter returned 0 ids; failing open");
      return { ids, ok: true, error: null as string | null };
    }

    // { projectIds }
    const ids = Array.isArray(r?.projectIds) ? r.projectIds.filter(Boolean) : [];
    if (!ids.length && rawIds.length) return failOpen("active filter returned 0 ids; failing open");
    return { ids, ok: !r?.error, error: r?.error ? safeStr(r.error?.message || r.error) : null };
  } catch (e: any) {
    return failOpen(safeStr(e?.message || e || "active filter failed"));
  }
}

function extractProjectIdFromWin(w: any) {
  return (
    safeStr(w?.project_id).trim() ||
    safeStr(w?.projectId).trim() ||
    safeStr(w?.project_uuid).trim() ||
    safeStr(w?.project).trim() ||
    ""
  );
}

async function getBudgetWins(supabase: any, projectIds: string[], since: string, projById: Map<string, any>) {
  const wins: any[] = [];
  if (!projectIds.length) return wins;

  // Try project_financials first, then project_budgets, then budgets
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
      const pct = budget > 0 ? Math.round((actual / budget) * 100) : 0;

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
          // ✅ RW-F4: prefer project_code else UUID
          href: projectHref(p, pid),
        });
      }
    }

    break; // stop after first working table
  }

  return wins;
}

async function handle(req: NextRequest, days: number, limit: number) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    return withNoStore(NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }));
  }

  // Fetch summary from existing success-stories endpoint
  const baseUrl = new URL(req.url);
  const summaryUrl = `${baseUrl.origin}/api/success-stories/summary?days=${days}`;

  const summaryRes = await fetch(summaryUrl, {
    headers: { cookie: req.headers.get("cookie") || "" },
    cache: "no-store",
  });

  if (!summaryRes.ok) {
    return withNoStore(NextResponse.json({ ok: false, error: "Failed to fetch summary" }, { status: 502 }));
  }

  const summary = await summaryRes.json();

  const topWins: any[] = (Array.isArray(summary?.top) ? summary.top : []).map((w: any) => ({
    ...w,
    type: w?.type ?? w?.category ?? "other",
    category: w?.category ?? w?.type ?? "other",
  }));

  // ORG-wide scope
  const scoped = await resolveOrgActiveProjectScope(supabase, user.id);
  const scopedRaw: string[] = Array.isArray(scoped?.projectIds) ? scoped.projectIds.filter(Boolean) : [];

  // ✅ active filter (normalized + fail-open)
  const active = await normalizeActiveIds(supabase, scopedRaw);
  const projectIds = active.ids;

  const since = isoDaysAgo(days);

  // Project details for enrichment
  const projById = new Map<string, any>();
  if (projectIds.length) {
    const { data: prows } = await supabase
      .from("projects")
      .select("id, title, project_code, project_manager, project_manager_id")
      .in("id", projectIds)
      .limit(2000);

    for (const p of prows ?? []) projById.set(String((p as any).id), p);
  }

  // Enrich projById with project_ids from topWins not already loaded
  const winPids = [...new Set(topWins.map((w: any) => extractProjectIdFromWin(w)).filter(Boolean))];
  const missingPids = winPids.filter((pid) => !projById.has(pid));

  if (missingPids.length) {
    const { data: extraProjs } = await supabase
      .from("projects")
      .select("id, title, project_code, project_manager, project_manager_id")
      .in("id", missingPids)
      .limit(500);

    for (const p of extraProjs ?? []) projById.set(String((p as any).id), p);
  }

  // PM name lookup
  const pmById = new Map<string, string>();
  const pmIds = [...new Set([...projById.values()].map((p: any) => safeStr(p?.project_manager_id).trim()).filter(Boolean))];

  if (pmIds.length) {
    const { data: pmRows } = await supabase
      .from("profiles")
      .select("user_id, id, full_name, name, display_name")
      .in("user_id", pmIds)
      .limit(2000);

    for (const pm of pmRows ?? []) {
      const name = safeStr((pm as any)?.full_name || (pm as any)?.display_name || (pm as any)?.name).trim();
      const uid = safeStr((pm as any)?.user_id || (pm as any)?.id).trim();
      if (uid && name) pmById.set(uid, name);
    }
  }

  // Budget wins (scoped to ACTIVE org projects)
  const budgetWins = await getBudgetWins(supabase, projectIds, since, projById);

  // Merge, sort, limit, enrich
  const allWins = [...topWins, ...budgetWins]
    .sort((a, b) => isoSortKey(b?.happened_at).localeCompare(isoSortKey(a?.happened_at)))
    .slice(0, limit)
    .map((w: any) => {
      const pid = extractProjectIdFromWin(w);
      const proj = pid ? projById.get(pid) : null;

      const pmId = safeStr(proj?.project_manager_id).trim();
      const pmName = (pmId && pmById.get(pmId)) || safeStr(proj?.project_manager).trim() || null;

      const projCode = safeStr(proj?.project_code || w?.project_code).trim() || null;
      const projName = safeStr(proj?.title || w?.project_title || w?.project_name).trim() || null;

      // ✅ RW-F4: prefer project_code else UUID
      const href =
        w?.href ||
        (proj ? projectHref(proj, pid || null) : pid ? `/projects/${encodeURIComponent(pid)}` : null);

      return {
        ...w,
        project_id: pid || w?.project_id || null,
        project_code: projCode || null,
        project_name: projName || null,
        pm_name: pmName || null,
        href,
      };
    });

  return withNoStore(
    NextResponse.json({
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
        scope: {
          ...(scoped?.meta ?? {}),
          scopedIdsRaw: scopedRaw.length,
          scopedIdsActive: projectIds.length,
          active_filter_ok: active.ok,
          active_filter_error: active.error,
        },
      },
    }),
  );
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const days = Math.min(60, Math.max(7, parseInt(url.searchParams.get("days") ?? "30", 10)));
    const limit = Math.min(20, Math.max(1, parseInt(url.searchParams.get("limit") ?? "8", 10)));
    return await handle(req, days, limit);
  } catch (e: any) {
    return withNoStore(NextResponse.json({ ok: false, error: safeStr(e?.message || e) }, { status: 500 }));
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const days = Math.min(60, Math.max(7, parseInt(String(body?.days ?? 30), 10)));
    const limit = Math.min(20, Math.max(1, parseInt(String(body?.limit ?? 8), 10)));
    return await handle(req, days, limit);
  } catch (e: any) {
    return withNoStore(NextResponse.json({ ok: false, error: safeStr(e?.message || e) }, { status: 500 }));
  }
}