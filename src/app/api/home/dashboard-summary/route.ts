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

function parseDays(v: string | null): 7 | 14 | 30 | 60 {
  const n = clampDays(Number(v || 30));
  if (n <= 7) return 7;
  if (n <= 14) return 14;
  if (n <= 30) return 30;
  return 60;
}

function parseFilters(req: NextRequest): PortfolioFilters {
  const sp = req.nextUrl.searchParams;
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

function appendFiltersToPath(path: string, filters: PortfolioFilters) {
  const sp = new URLSearchParams();
  if (filters.q?.trim()) sp.set("q", filters.q.trim());
  (filters.projectCode ?? []).forEach((v) => sp.append("code", v));
  (filters.projectName ?? []).forEach((v) => sp.append("name", v));
  (filters.projectManagerId ?? []).forEach((v) => sp.append("pm", v));
  (filters.department ?? []).forEach((v) => sp.append("dept", v));
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

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const days = parseDays(req.nextUrl.searchParams.get("days"));
  const dueDays = parseDays(req.nextUrl.searchParams.get("dueDays"));
  const filters = parseFilters(req);

  const [
    portfolioHealth,
    milestonesDue,
    raidPanel,
    financialPlanSummary,
    recentWins,
    resourceActivity,
    aiBriefing,
    dueDigest,
  ] = await Promise.all([
    fetchInternalJson<any>(req, appendFiltersToPath(`/api/portfolio/health?days=${days}`, filters)),
    fetchInternalJson<any>(req, appendFiltersToPath(`/api/portfolio/milestones-due?days=${days}`, filters)),
    fetchInternalJson<any>(req, appendFiltersToPath(`/api/portfolio/raid-panel?days=${days}`, filters)),
    fetchInternalJson<any>(req, appendFiltersToPath(`/api/portfolio/financial-plan-summary?days=${days}`, filters)),
    fetchInternalJson<any>(req, appendFiltersToPath(`/api/portfolio/recent-wins?days=7&limit=8`, filters)),
    fetchInternalJson<any>(req, appendFiltersToPath(`/api/portfolio/resource-activity?days=${days}`, filters)),
    fetchInternalJson<any>(req, appendFiltersToPath(`/api/ai/briefing?days=${days}`, filters)),
    fetchInternalJson<any>(req, `/api/ai/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType: "artifact_due", windowDays: dueDays, filters }),
    }),
  ]);

  return NextResponse.json(
    {
      ok: true,
      days,
      dueDays,
      filters,
      portfolioHealth: portfolioHealth ?? null,
      milestonesDue: milestonesDue ?? null,
      raidPanel: raidPanel ?? null,
      financialPlanSummary: financialPlanSummary ?? null,
      recentWins: recentWins ?? null,
      resourceActivity: resourceActivity ?? null,
      aiBriefing: aiBriefing ?? null,
      dueDigest: dueDigest ?? null,
      generated_at: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}