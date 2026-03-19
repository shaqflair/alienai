import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type PortfolioFilters = {
  q?: string;
  projectId?: string[];
  projectName?: string[];
  projectCode?: string[];
  projectManagerId?: string[];
  department?: string[];
};

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function uniqStrings(input: unknown): string[] {
  const out = new Set<string>();
  const push = (v: unknown) => {
    const s = safeStr(v).trim();
    if (s) out.add(s);
  };

  if (Array.isArray(input)) input.forEach(push);
  else if (typeof input === "string") input.split(",").forEach(push);
  else if (input != null) push(input);

  return Array.from(out);
}

function clampDays(x: number) {
  if (!Number.isFinite(x)) return 30;
  return Math.max(1, Math.min(365, Math.floor(x)));
}

function normalizeDays(v: unknown): 7 | 14 | 30 | 60 {
  const raw = safeStr(v).trim().toLowerCase();
  if (raw === "all") return 60;

  const n = clampDays(Number(raw || 30));
  if (n <= 7) return 7;
  if (n <= 14) return 14;
  if (n <= 30) return 30;
  return 60;
}

function parseFiltersFromSearchParams(sp: URLSearchParams): PortfolioFilters {
  const q = safeStr(sp.get("q")).trim() || undefined;
  const projectId = uniqStrings(sp.getAll("projectId"));
  const projectCode = uniqStrings([...sp.getAll("projectCode"), ...sp.getAll("code")]);
  const projectName = uniqStrings(sp.getAll("name"));
  const projectManagerId = uniqStrings(sp.getAll("pm"));
  const department = uniqStrings(sp.getAll("dept"));

  const out: PortfolioFilters = {};
  if (q) out.q = q;
  if (projectId.length) out.projectId = projectId;
  if (projectCode.length) out.projectCode = projectCode;
  if (projectName.length) out.projectName = projectName;
  if (projectManagerId.length) out.projectManagerId = projectManagerId;
  if (department.length) out.department = department;
  return out;
}

function normalizeFilters(input: any): PortfolioFilters {
  const out: PortfolioFilters = {};
  const q = safeStr(input?.q).trim();
  if (q) out.q = q;

  const projectId = uniqStrings(input?.projectId);
  const projectName = uniqStrings(input?.projectName);
  const projectCode = uniqStrings(input?.projectCode);
  const projectManagerId = uniqStrings(input?.projectManagerId);
  const department = uniqStrings(input?.department);

  if (projectId.length) out.projectId = projectId;
  if (projectName.length) out.projectName = projectName;
  if (projectCode.length) out.projectCode = projectCode;
  if (projectManagerId.length) out.projectManagerId = projectManagerId;
  if (department.length) out.department = department;

  return out;
}

function appendFiltersToPath(path: string, filters: PortfolioFilters) {
  const sp = new URLSearchParams();

  if (filters.q?.trim()) sp.set("q", filters.q.trim());
  (filters.projectCode ?? []).forEach((v) => sp.append("code", v));
  (filters.projectName ?? []).forEach((v) => sp.append("name", v));
  (filters.projectManagerId ?? []).forEach((v) => sp.append("pm", v));
  (filters.department ?? []).forEach((v) => sp.append("dept", v));
  // Pass confirmed project IDs explicitly so sub-APIs can filter by them
  (filters.projectId ?? []).forEach((v) => sp.append("projectId", v));

  const qs = sp.toString();
  return qs ? `${path}${path.includes("?") ? "&" : "?"}${qs}` : path;
}

async function fetchInternalJson<T>(
  req: NextRequest,
  path: string,
  init?: RequestInit,
): Promise<T | null> {
  try {
    const url = new URL(path, req.nextUrl.origin);
    const res = await fetch(url.toString(), {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        cookie: req.headers.get("cookie") ?? "",
      },
      cache: "no-store",
    });

    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as T | null;
  } catch {
    return null;
  }
}

/**
 * Resolve confirmed-only project IDs for the active organisation.
 * Pipeline projects are excluded from all stats — they only appear in
 * resource activity as their own data series.
 *
 * If the caller already passed explicit projectId filters (user-selected),
 * we honour those as-is rather than overriding them.
 */
async function getConfirmedProjectIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filters: PortfolioFilters,
): Promise<string[]> {
  // If the caller already specified explicit project IDs, honour them as-is.
  if (filters.projectId?.length) return filters.projectId;

  try {
    let query = supabase
      .from("projects")
      .select("id")
      .is("deleted_at", null)
      .neq("resource_status", "pipeline")
      .neq("status", "closed");

    // Narrow further if project code filters are present
    if (filters.projectCode?.length) {
      query = query.in("project_code", filters.projectCode);
    }

    const { data, error } = await query.limit(2000);
    if (error || !data?.length) return [];
    return (data as any[]).map((r) => String(r.id)).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeAiBriefingPayload(input: any) {
  const src = input && typeof input === "object" ? input : null;
  const insights = Array.isArray(src?.insights) ? src.insights : [];
  const executiveBriefing = src?.executive_briefing ?? src?.briefing ?? src?.data ?? null;

  return {
    ...(src ?? {}),
    insights,
    executive_briefing: executiveBriefing,
    briefing: executiveBriefing,
  };
}

async function buildDashboardSummary(
  req: NextRequest,
  input: { days?: unknown; dueDays?: unknown; dueWindowDays?: unknown; filters?: any },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const days = normalizeDays(input?.days);
  const dueDays = normalizeDays(input?.dueWindowDays ?? input?.dueDays);
  const filters = normalizeFilters(input?.filters);

  // Resolve confirmed-only project IDs once and inject into filters so every
  // downstream API (milestones, RAID, resource activity, AI events) only sees
  // confirmed projects. Pipeline projects appear in resource activity via their
  // own data series — they must not inflate RAID, milestone, or health stats.
  const confirmedIds = await getConfirmedProjectIds(supabase, filters);
  const confirmedFilters: PortfolioFilters = {
    ...filters,
    projectId: confirmedIds.length ? confirmedIds : filters.projectId,
  };

  const [
    portfolioHealth,
    milestonesDue,
    raidPanel,
    financialPlanSummary,
    recentWins,
    resourceActivity,
    aiBriefingRaw,
    dueDigest,
  ] = await Promise.all([
    // All stats use confirmedFilters — pipeline excluded
    fetchInternalJson<any>(req, appendFiltersToPath(`/api/portfolio/health?days=${days}`, confirmedFilters)),
    fetchInternalJson<any>(req, appendFiltersToPath(`/api/portfolio/milestones-due?days=${days}`, confirmedFilters)),
    fetchInternalJson<any>(req, appendFiltersToPath(`/api/portfolio/raid-panel?days=${days}`, confirmedFilters)),
    fetchInternalJson<any>(req, appendFiltersToPath(`/api/portfolio/financial-plan-summary?days=${days}`, confirmedFilters)),
    fetchInternalJson<any>(req, appendFiltersToPath(`/api/portfolio/recent-wins?days=7&limit=8`, confirmedFilters)),
    // Resource activity intentionally uses original filters — pipeline appears as its own series
    fetchInternalJson<any>(req, appendFiltersToPath(`/api/portfolio/resource-activity?days=${days}`, filters)),
    fetchInternalJson<any>(req, appendFiltersToPath(`/api/ai/briefing?days=${days}`, confirmedFilters)),
    fetchInternalJson<any>(req, `/api/ai/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: "artifact_due",
        windowDays: dueDays,
        filters: confirmedFilters,
      }),
    }),
  ]);

  const aiBriefing = normalizeAiBriefingPayload(aiBriefingRaw);
  const insights = Array.isArray(aiBriefing?.insights) ? aiBriefing.insights : [];
  const executiveBriefing =
    aiBriefing?.executive_briefing ?? aiBriefing?.briefing ?? null;

  return NextResponse.json(
    {
      ok: true,
      days,
      dueDays,
      filters,
      generated_at: new Date().toISOString(),

      // canonical payload used by current homepage route consumer
      portfolioHealth: portfolioHealth ?? null,
      milestonesDue: milestonesDue ?? null,
      raidPanel: raidPanel ?? null,
      financialPlanSummary: financialPlanSummary ?? null,
      recentWins: recentWins ?? null,
      resourceActivity: resourceActivity ?? null,
      aiBriefing: aiBriefingRaw ? aiBriefing : null,
      dueDigest: dueDigest ?? null,

      // compatibility aliases for older/newer homepage mappings
      insights,
      executiveBriefing,
      financialPlan: financialPlanSummary ?? null,
      due: dueDigest ?? null,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    },
  );
}

export async function GET(req: NextRequest) {
  const filters = parseFiltersFromSearchParams(req.nextUrl.searchParams);
  const days = normalizeDays(req.nextUrl.searchParams.get("days"));
  const dueDays = normalizeDays(req.nextUrl.searchParams.get("dueDays"));

  return buildDashboardSummary(req, {
    days,
    dueDays,
    filters,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return buildDashboardSummary(req, body ?? {});
}