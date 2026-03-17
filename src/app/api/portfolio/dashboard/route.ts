import "server-only";

import { NextResponse } from "next/server";

export const runtime = "nodejs";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type PortfolioFilters = {
  q?: string;
  projectName?: string[];
  projectCode?: string[];
  projectManagerId?: string[];
  department?: string[];
};

type HealthResponse =
  | { ok: false; error?: string; meta?: any }
  | {
      ok: true;
      score: number | null;
      portfolio_health: number;
      projectCount: number;
      parts: {
        schedule: number | null;
        raid: number | null;
        budget: number | null;
        governance: number | null;
        flow?: number | null;
        approvals?: number | null;
        activity?: number | null;
      };
      projectScores?: Record<string, { score: number; rag: "G" | "A" | "R" }>;
      drivers?: any[];
      meta?: any;
    };

type RaidPanelResponse =
  | { ok: false; error?: string; meta?: any }
  | {
      ok: true;
      panel: {
        days: number;
        due_total: number;
        overdue_total: number;
        risk_due?: number;
        issue_due?: number;
        dependency_due?: number;
        assumption_due?: number;
        risk_overdue?: number;
        issue_overdue?: number;
        dependency_overdue?: number;
        assumption_overdue?: number;
        risk_hi?: number;
        issue_hi?: number;
        dependency_hi?: number;
        assumption_hi?: number;
        overdue_hi?: number;
      };
      meta?: any;
    };

type MilestonesDueResponse =
  | { ok: false; error?: string; meta?: any }
  | { ok: true; count?: number; items?: any[]; meta?: any };

type FinancialPlanSummary =
  | { ok: false; error?: string; meta?: any }
  | {
      ok: true;
      total_approved_budget?: number | null;
      total_spent?: number | null;
      variance_pct?: number | null;
      pending_exposure_pct?: number | null;
      rag?: "G" | "A" | "R" | null;
      currency?: string | null;
      project_ref?: string | null;
      artifact_id?: string | null;
      project_count?: number;
      portfolio?: {
        totalBudget?: number | null;
        total_budget?: number | null;
        approvedBudget?: number | null;
        approved_budget?: number | null;
        totalApprovedBudget?: number | null;
        budgeted?: number | null;
        budget?: number | null;
        totalActual?: number | null;
        total_actual?: number | null;
        totalSpent?: number | null;
        total_spent?: number | null;
        actualSpent?: number | null;
        actual_spent?: number | null;
        actuals?: number | null;
        spent?: number | null;
        variance_pct?: number | null;
        variancePct?: number | null;
        variance?: number | null;
        rag?: "G" | "A" | "R" | null;
        currency?: string | null;
      };
      meta?: any;
    };

type ResourceActivityResponse =
  | { ok: false; error?: string; meta?: any }
  | { ok: true; weeks?: any[]; meta?: any };

type RecentWinsResponse =
  | { ok: false; error?: string; meta?: any }
  | { ok: true; wins?: any[]; meta?: any };

type AiBriefingResponse =
  | { ok: false; error?: string; meta?: any }
  | { ok: true; insights?: any[]; meta?: any };

type ArtifactDueResponse =
  | { ok: false; error?: string; meta?: any }
  | {
      ok: true;
      eventType: "artifact_due";
      ai?: {
        summary?: string;
        windowDays?: number;
        counts?: {
          total: number;
          milestone: number;
          work_item: number;
          raid: number;
          artifact: number;
          change: number;
        };
        dueSoon?: any[];
        recommendedMessage?: string;
      };
      stats?: any;
      meta?: any;
    };

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function noStoreJson(data: any, status = 200) {
  const res = NextResponse.json(data, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function num(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function clampWindowDays(v: any): 7 | 14 | 30 | 60 {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "all") return 60;
  const n = Number(s);
  const allowed = new Set([7, 14, 30, 60]);
  return Number.isFinite(n) && allowed.has(n) ? (n as 7 | 14 | 30 | 60) : 30;
}

function clampDueWindowDays(v: any): 7 | 14 | 30 {
  const n = Number(v);
  return n === 7 || n === 14 || n === 30 ? n : 14;
}

function uniqStrings(xs: any): string[] {
  const arr = Array.isArray(xs) ? xs : xs == null ? [] : [xs];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const v of arr) {
    const s = safeStr(v).trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }

  return out;
}

function parseFiltersFromUrl(url: URL): PortfolioFilters {
  const q = safeStr(url.searchParams.get("q")).trim() || undefined;
  const projectName = uniqStrings(url.searchParams.getAll("name").flatMap((x) => x.split(",")));
  const projectCode = uniqStrings(url.searchParams.getAll("code").flatMap((x) => x.split(",")));
  const projectManagerId = uniqStrings(url.searchParams.getAll("pm").flatMap((x) => x.split(",")));
  const department = uniqStrings(url.searchParams.getAll("dept").flatMap((x) => x.split(",")));

  const out: PortfolioFilters = {};
  if (q) out.q = q;
  if (projectName.length) out.projectName = projectName;
  if (projectCode.length) out.projectCode = projectCode;
  if (projectManagerId.length) out.projectManagerId = projectManagerId;
  if (department.length) out.department = department;
  return out;
}

function parseFiltersFromBody(body: any): PortfolioFilters {
  const f = body?.filters ?? body?.filter ?? body?.where ?? body ?? {};
  const out: PortfolioFilters = {};

  const q = safeStr(f?.q).trim() || undefined;
  const projectName = uniqStrings(f?.projectName ?? f?.projectNames ?? f?.name ?? f?.project_name);
  const projectCode = uniqStrings(f?.projectCode ?? f?.projectCodes ?? f?.code ?? f?.project_code);
  const projectManagerId = uniqStrings(
    f?.projectManagerId ?? f?.projectManagerIds ?? f?.pm ?? f?.project_manager_id,
  );
  const department = uniqStrings(f?.department ?? f?.departments ?? f?.dept);

  if (q) out.q = q;
  if (projectName.length) out.projectName = projectName;
  if (projectCode.length) out.projectCode = projectCode;
  if (projectManagerId.length) out.projectManagerId = projectManagerId;
  if (department.length) out.department = department;

  return out;
}

function appendFiltersToSearchParams(sp: URLSearchParams, filters: PortfolioFilters) {
  if (filters.q?.trim()) sp.set("q", filters.q.trim());
  for (const v of filters.projectName ?? []) sp.append("name", v);
  for (const v of filters.projectCode ?? []) sp.append("code", v);
  for (const v of filters.projectManagerId ?? []) sp.append("pm", v);
  for (const v of filters.department ?? []) sp.append("dept", v);
}

function scoreToRag(score: number | null): "G" | "A" | "R" | null {
  if (score == null || !Number.isFinite(score)) return null;
  if (score >= 85) return "G";
  if (score >= 70) return "A";
  return "R";
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}

async function fetchInternalJson<T>(
  req: Request,
  path: string,
  init?: RequestInit,
  timeoutMs = 8000,
): Promise<T> {
  const url = new URL(path, req.url).toString();

  const headers = new Headers(init?.headers || {});
  const cookie = req.headers.get("cookie");
  const auth = req.headers.get("authorization");

  if (cookie && !headers.has("cookie")) headers.set("cookie", cookie);
  if (auth && !headers.has("authorization")) headers.set("authorization", auth);

  const res = await withTimeout(
    fetch(url, {
      ...init,
      headers,
      cache: "no-store",
    }),
    timeoutMs,
    path,
  );

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(`${path} failed (${res.status})${json?.error ? `: ${json.error}` : ""}`);
  }

  return json as T;
}

function settledValue<T>(r: PromiseSettledResult<T>): T | null {
  return r.status === "fulfilled" ? r.value : null;
}

function settledError(r: PromiseSettledResult<any>): string | null {
  return r.status === "rejected" ? safeStr(r.reason?.message || r.reason) : null;
}

function normalizeFinancialSummary(fp: FinancialPlanSummary | null) {
  if (!fp || fp.ok !== true) {
    return {
      totalApprovedBudget: null as number | null,
      totalSpent: null as number | null,
      variancePct: null as number | null,
      rag: null as "G" | "A" | "R" | null,
      currency: "£" as string | null,
    };
  }

  const anyFp = fp as any;
  const p = anyFp.portfolio ?? {};

  const totalApprovedBudgetRaw =
    p.totalBudget ??
    p.total_budget ??
    p.approvedBudget ??
    p.approved_budget ??
    p.totalApprovedBudget ??
    p.budgeted ??
    p.budget ??
    anyFp.total_approved_budget ??
    anyFp.approved_budget ??
    anyFp.total_budget ??
    anyFp.budget_total ??
    anyFp.budgeted ??
    anyFp.total_budgeted ??
    anyFp.budget ??
    anyFp.plan_budget ??
    anyFp.total_plan_budget ??
    anyFp.approved;

  const totalSpentRaw =
    p.totalActual ??
    p.total_actual ??
    p.totalSpent ??
    p.total_spent ??
    p.actualSpent ??
    p.actual_spent ??
    p.actuals ??
    p.spent ??
    anyFp.total_spent ??
    anyFp.actual_spent ??
    anyFp.spent_total ??
    anyFp.total_actual ??
    anyFp.actual ??
    anyFp.spent ??
    anyFp.total_actuals ??
    anyFp.actuals_total;

  const variancePctRaw =
    anyFp.variance_pct ??
    p.variance_pct ??
    p.variancePct ??
    p.variance;

  const rag =
    (anyFp.rag ?? p.rag ?? null) as "G" | "A" | "R" | null;

  const currency = safeStr(anyFp.currency ?? p.currency).trim() || "£";

  return {
    totalApprovedBudget:
      totalApprovedBudgetRaw != null && Number.isFinite(Number(totalApprovedBudgetRaw))
        ? Number(totalApprovedBudgetRaw)
        : null,
    totalSpent:
      totalSpentRaw != null && Number.isFinite(Number(totalSpentRaw))
        ? Number(totalSpentRaw)
        : null,
    variancePct:
      variancePctRaw != null && Number.isFinite(Number(variancePctRaw))
        ? Math.round(Number(variancePctRaw) * 10) / 10
        : null,
    rag,
    currency,
  };
}

/* -------------------------------------------------------------------------- */
/* Handler                                                                    */
/* -------------------------------------------------------------------------- */

async function handle(req: Request, method: "GET" | "POST") {
  try {
    const url = new URL(req.url);

    let body: any = null;
    if (method === "POST") {
      try {
        body = await req.json();
      } catch {
        body = {};
      }
    }

    const windowDays = clampWindowDays(
      method === "POST" ? body?.windowDays ?? body?.days : url.searchParams.get("days"),
    );

    const dueWindowDays = clampDueWindowDays(
      method === "POST" ? body?.dueWindowDays : url.searchParams.get("dueWindowDays"),
    );

    const includeAi = method === "POST"
      ? body?.includeAi !== false
      : url.searchParams.get("includeAi") !== "false";

    const filters = method === "POST" ? parseFiltersFromBody(body) : parseFiltersFromUrl(url);

    const sharedQs = new URLSearchParams();
    sharedQs.set("days", String(windowDays));
    appendFiltersToSearchParams(sharedQs, filters);

    const recentWinsQs = new URLSearchParams();
    recentWinsQs.set("days", "7");
    recentWinsQs.set("limit", safeStr(method === "POST" ? body?.winsLimit : url.searchParams.get("winsLimit")) || "8");
    appendFiltersToSearchParams(recentWinsQs, filters);

    const healthPromise = fetchInternalJson<HealthResponse>(
      req,
      "/api/portfolio/health",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          days: windowDays,
          filters,
        }),
      },
      10000,
    );

    const raidPromise = fetchInternalJson<RaidPanelResponse>(
      req,
      "/api/portfolio/raid-panel",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          days: windowDays,
          filters,
        }),
      },
      10000,
    );

    const milestonesPromise = fetchInternalJson<MilestonesDueResponse>(
      req,
      `/api/portfolio/milestones-due?${sharedQs.toString()}`,
      undefined,
      8000,
    );

    const financePromise = fetchInternalJson<FinancialPlanSummary>(
      req,
      `/api/portfolio/financial-plan-summary?${sharedQs.toString()}`,
      undefined,
      8000,
    );

    const resourcePromise = fetchInternalJson<ResourceActivityResponse>(
      req,
      `/api/portfolio/resource-activity?${sharedQs.toString()}`,
      undefined,
      8000,
    );

    const winsPromise = fetchInternalJson<RecentWinsResponse>(
      req,
      `/api/portfolio/recent-wins?${recentWinsQs.toString()}`,
      undefined,
      8000,
    );

    const duePromise = fetchInternalJson<ArtifactDueResponse>(
      req,
      "/api/ai/events",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: "artifact_due",
          windowDays: dueWindowDays,
          filters,
        }),
      },
      10000,
    );

    const briefingPromise = includeAi
      ? fetchInternalJson<AiBriefingResponse>(
          req,
          `/api/ai/briefing?${sharedQs.toString()}`,
          undefined,
          7000,
        )
      : Promise.resolve(null as AiBriefingResponse | null);

    const results = await Promise.allSettled([
      healthPromise,
      raidPromise,
      milestonesPromise,
      financePromise,
      resourcePromise,
      winsPromise,
      duePromise,
      briefingPromise,
    ]);

    const [
      healthResult,
      raidResult,
      milestonesResult,
      financeResult,
      resourceResult,
      winsResult,
      dueResult,
      briefingResult,
    ] = results;

    const health = settledValue(healthResult);
    const raid = settledValue(raidResult);
    const milestones = settledValue(milestonesResult);
    const finance = settledValue(financeResult);
    const resource = settledValue(resourceResult);
    const wins = settledValue(winsResult);
    const due = settledValue(dueResult);
    const briefing = settledValue(briefingResult);

    const healthScore =
      health && health.ok === true
        ? (health.score != null ? health.score : health.portfolio_health ?? null)
        : null;

    const healthRag = scoreToRag(
      healthScore != null && Number.isFinite(Number(healthScore))
        ? Number(healthScore)
        : null,
    );

    const projectScores =
      health && health.ok === true && health.projectScores
        ? health.projectScores
        : {};

    let liveRagCounts = { g: 0, a: 0, r: 0 };
    for (const v of Object.values(projectScores)) {
      if (v?.rag === "G") liveRagCounts.g += 1;
      else if (v?.rag === "A") liveRagCounts.a += 1;
      else if (v?.rag === "R") liveRagCounts.r += 1;
    }

    const raidPanel =
      raid && raid.ok === true
        ? raid.panel
        : null;

    const raidHighSeverity =
      num(raidPanel?.risk_hi) + num(raidPanel?.issue_hi);

    const financeNormalized = normalizeFinancialSummary(finance);

    const dueItems =
      due && due.ok === true && Array.isArray(due.ai?.dueSoon)
        ? due.ai!.dueSoon
        : [];

    const partial = {
      healthFailed: !health || health.ok !== true,
      raidFailed: !raid || raid.ok !== true,
      milestonesFailed: !milestones || milestones.ok !== true,
      financeFailed: !finance || finance.ok !== true,
      resourceFailed: !resource || resource.ok !== true,
      winsFailed: !wins || wins.ok !== true,
      dueFailed: !due || due.ok !== true,
      briefingFailed: includeAi ? (!briefing || briefing.ok !== true) : false,
    };

    return noStoreJson({
      ok: true,
      generatedAt: new Date().toISOString(),
      windowDays,
      dueWindowDays,
      filters,
      cards: {
        portfolioHealth: {
          score:
            healthScore != null && Number.isFinite(Number(healthScore))
              ? Math.round(Number(healthScore))
              : null,
          rag: healthRag,
          counts: liveRagCounts,
          delta: null,
        },
        openRisks: {
          dueTotal: num(raidPanel?.due_total),
          highSeverity: raidHighSeverity,
        },
        milestonesDue: {
          count:
            milestones && milestones.ok === true
              ? num((milestones as any).count)
              : 0,
        },
        budgetHealth: {
          totalApprovedBudget: financeNormalized.totalApprovedBudget,
          totalSpent: financeNormalized.totalSpent,
          variancePct: financeNormalized.variancePct,
          rag: financeNormalized.rag,
          currency: financeNormalized.currency,
        },
      },
      health: {
        projectCount:
          health && health.ok === true
            ? num(health.projectCount)
            : 0,
        parts:
          health && health.ok === true
            ? health.parts
            : {
                schedule: null,
                raid: null,
                budget: null,
                governance: null,
                flow: null,
                approvals: null,
                activity: null,
              },
        projectScores,
        drivers:
          health && health.ok === true && Array.isArray(health.drivers)
            ? health.drivers
            : [],
        meta:
          health && "meta" in health ? health.meta : null,
      },
      raidPanel,
      due: {
        summary:
          due && due.ok === true ? due.ai?.summary ?? "" : "",
        counts:
          due && due.ok === true
            ? due.ai?.counts ?? {
                total: 0,
                milestone: 0,
                work_item: 0,
                raid: 0,
                artifact: 0,
                change: 0,
              }
            : {
                total: 0,
                milestone: 0,
                work_item: 0,
                raid: 0,
                artifact: 0,
                change: 0,
              },
        items: dueItems,
        recommendedMessage:
          due && due.ok === true ? due.ai?.recommendedMessage ?? "" : "",
        meta:
          due && "meta" in due ? due.meta : null,
      },
      resourceActivity: {
        weeks:
          resource && resource.ok === true && Array.isArray(resource.weeks)
            ? resource.weeks
            : [],
        meta:
          resource && "meta" in resource ? resource.meta : null,
      },
      recentWins: {
        wins:
          wins && wins.ok === true && Array.isArray(wins.wins)
            ? wins.wins
            : [],
        meta:
          wins && "meta" in wins ? wins.meta : null,
      },
      aiBriefing: includeAi
        ? {
            insights:
              briefing && briefing.ok === true && Array.isArray(briefing.insights)
                ? briefing.insights
                : [],
            meta:
              briefing && "meta" in briefing ? briefing.meta : null,
          }
        : null,
      partial,
      errors: {
        health: settledError(healthResult),
        raid: settledError(raidResult),
        milestones: settledError(milestonesResult),
        finance: settledError(financeResult),
        resource: settledError(resourceResult),
        wins: settledError(winsResult),
        due: settledError(dueResult),
        briefing: settledError(briefingResult),
      },
    });
  } catch (e: any) {
    return noStoreJson(
      {
        ok: false,
        error: "Portfolio dashboard route failed",
        meta: {
          detail: safeStr(e?.message || e),
          stack: process.env.NODE_ENV === "development" ? safeStr(e?.stack) : undefined,
        },
      },
      500,
    );
  }
}

export async function GET(req: Request) {
  return handle(req, "GET");
}

export async function POST(req: Request) {
  return handle(req, "POST");
}