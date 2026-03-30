import "server-only";

import { NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { filterActiveProjectIds } from "@/lib/server/project-scope";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";

export type PortfolioRecentWinsPayload = {
  ok: true;
  wins: any[];
  days: number;
  count: number;
  score: number;
  prev_score: number;
  delta: number;
  breakdown: Record<string, any>;
  meta: {
    organisationId: string | null;
    since_iso: string;
    total_wins: number;
    scope: any;
  };
};

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
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(
    d.getUTCMonth() + 1,
  ).padStart(2, "0")}/${d.getUTCFullYear()}`;
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

function projectCodeLabel(pc: any): string {
  if (typeof pc === "string") return pc.trim();
  if (typeof pc === "number" && Number.isFinite(pc)) return String(pc);
  if (pc && typeof pc === "object") {
    const v =
      safeStr(pc.project_code) ||
      safeStr(pc.code) ||
      safeStr(pc.value) ||
      safeStr(pc.id);
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

    if (Array.isArray(r)) {
      const ids = r.filter(Boolean);
      if (!ids.length && rawIds.length) {
        return failOpen("active filter returned 0 ids; failing open");
      }
      return { ids, ok: true, error: null as string | null };
    }

    const ids = Array.isArray(r?.projectIds) ? r.projectIds.filter(Boolean) : [];
    if (!ids.length && rawIds.length) {
      return failOpen("active filter returned 0 ids; failing open");
    }

    return {
      ids,
      ok: !r?.error,
      error: r?.error ? safeStr(r.error?.message || r.error) : null,
    };
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

async function getBudgetWins(
  supabase: any,
  projectIds: string[],
  since: string,
  projById: Map<string, any>,
) {
  const wins: any[] = [];
  if (!projectIds.length) return wins;

  const tables = ["project_financials", "project_budgets", "budgets"];

  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select(
        "id, project_id, budget, actual_cost, forecast_cost, updated_at, period_end, approved_budget, spent_to_date",
      )
      .in("project_id", projectIds)
      .gte("updated_at", since)
      .limit(200);

    if (error) continue;
    if (!Array.isArray(data) || !data.length) continue;

    for (const f of data) {
      const pid = safeStr((f as any)?.project_id).trim();
      const p = projById.get(pid);

      const budget = Number((f as any)?.budget ?? (f as any)?.approved_budget ?? 0);
      const actual = Number((f as any)?.actual_cost ?? (f as any)?.spent_to_date ?? 0);
      const forecast = Number((f as any)?.forecast_cost ?? actual);

      if (!budget || budget <= 0) continue;

      const underspend = budget - forecast;
      const pct = budget > 0 ? Math.round((actual / budget) * 100) : 0;

      if (underspend > 0 && pct <= 100) {
        wins.push({
          id: `budget_${(f as any).id}`,
          category: "Commercial",
          title: "On Budget",
          summary: `Project tracking ${Math.round(underspend).toLocaleString(
            "en-GB",
          )} under budget (${pct}% spent).`,
          happened_at:
            safeStr((f as any)?.updated_at || (f as any)?.period_end).trim() ||
            new Date().toISOString(),
          happened_at_uk: fmtDateUK((f as any)?.updated_at || (f as any)?.period_end),
          project_id: pid || null,
          project_title: p?.title || null,
          href: projectHref(p, pid),
        });
      }
    }

    break;
  }

  return wins;
}

async function fetchSuccessStoriesSummary(req: NextRequest, days: number) {
  const baseUrl = new URL(req.url);
  const summaryUrl = `${baseUrl.origin}/api/success-stories/summary?days=${days}`;

  const summaryRes = await fetch(summaryUrl, {
    headers: { cookie: req.headers.get("cookie") || "" },
    cache: "no-store",
  });

  if (!summaryRes.ok) {
    throw new Error("Failed to fetch summary");
  }

  return summaryRes.json();
}

export async function loadRecentWins(
  req: NextRequest,
  input: {
    userId: string;
    days?: unknown;
    limit?: unknown;
    supabase?: Awaited<ReturnType<typeof createClient>>;
  },
): Promise<PortfolioRecentWinsPayload> {
  const supabase = input.supabase ?? (await createClient());
  const days = Math.min(60, Math.max(7, parseInt(String(input?.days ?? 30), 10)));
  const limit = Math.min(20, Math.max(1, parseInt(String(input?.limit ?? 8), 10)));

  const summary = await fetchSuccessStoriesSummary(req, days);

  const topWins: any[] = (Array.isArray(summary?.top) ? summary.top : []).map((w: any) => ({
    ...w,
    type: w?.type ?? w?.category ?? "other",
    category: w?.category ?? w?.type ?? "other",
  }));

  const sharedScope = await resolvePortfolioScope(supabase, input.userId);
  const organisationId = sharedScope.organisationId ?? null;
  const scopeMeta = sharedScope.meta ?? {};
  const scopedRaw: string[] = Array.isArray(sharedScope.rawProjectIds)
    ? sharedScope.rawProjectIds
    : Array.isArray(sharedScope.projectIds)
      ? sharedScope.projectIds
      : [];

  const active = await normalizeActiveIds(supabase, scopedRaw);
  const projectIds = active.ids;

  const since = isoDaysAgo(days);

  const projById = new Map<string, any>();
  if (projectIds.length) {
    const { data: prows } = await supabase
      .from("projects")
      .select("id, title, project_code, project_manager, project_manager_id")
      .in("id", projectIds)
      .limit(2000);

    for (const p of prows ?? []) projById.set(String((p as any).id), p);
  }

  const winPids = [
    ...new Set(topWins.map((w: any) => extractProjectIdFromWin(w)).filter(Boolean)),
  ];
  const missingPids = winPids.filter((pid) => !projById.has(pid));

  if (missingPids.length) {
    const { data: extraProjs } = await supabase
      .from("projects")
      .select("id, title, project_code, project_manager, project_manager_id")
      .in("id", missingPids)
      .limit(500);

    for (const p of extraProjs ?? []) projById.set(String((p as any).id), p);
  }

  const pmById = new Map<string, string>();
  const pmIds = [
    ...new Set(
      [...projById.values()]
        .map((p: any) => safeStr(p?.project_manager_id).trim())
        .filter(Boolean),
    ),
  ];

  if (pmIds.length) {
    const { data: pmRows } = await supabase
      .from("profiles")
      .select("user_id, id, full_name, name")
      .in("user_id", pmIds)
      .limit(2000);

    for (const pm of pmRows ?? []) {
      const name = safeStr((pm as any)?.full_name || (pm as any)?.name).trim();
      const uid = safeStr((pm as any)?.user_id || (pm as any)?.id).trim();
      if (uid && name) pmById.set(uid, name);
    }
  }

  const budgetWins = await getBudgetWins(supabase, projectIds, since, projById);

  const allWins = [...topWins, ...budgetWins]
    .sort((a, b) => isoSortKey(b?.happened_at).localeCompare(isoSortKey(a?.happened_at)))
    .slice(0, limit)
    .map((w: any) => {
      const pid = extractProjectIdFromWin(w);
      const proj = pid ? projById.get(pid) : null;

      const pmId = safeStr(proj?.project_manager_id).trim();
      const pmName = (pmId && pmById.get(pmId)) || safeStr(proj?.project_manager).trim() || null;

      const projCode = safeStr(proj?.project_code || w?.project_code).trim() || null;
      const projName =
        safeStr(proj?.title || w?.project_title || w?.project_name).trim() || null;

      const href =
        w?.href ||
        (proj
          ? projectHref(proj, pid || null)
          : pid
            ? `/projects/${encodeURIComponent(pid)}`
            : null);

      return {
        ...w,
        project_id: pid || w?.project_id || null,
        project_code: projCode || null,
        project_name: projName || null,
        pm_name: pmName || null,
        href,
      };
    });

  return {
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
      organisationId,
      since_iso: since,
      total_wins: summary?.meta?.total_wins ?? allWins.length,
      scope: {
        ...scopeMeta,
        scopedIdsRaw: scopedRaw.length,
        scopedIdsActive: projectIds.length,
        active_filter_ok: active.ok,
        active_filter_error: active.error,
      },
    },
  };
}
