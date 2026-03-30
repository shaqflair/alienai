import "server-only";

import { NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { loadPortfolioHealth } from "@/lib/server/portfolio/loadPortfolioHealth";
import { loadMilestonesDue } from "@/lib/server/portfolio/loadMilestonesDue";
import { loadRaidPanel } from "@/lib/server/portfolio/loadRaidPanel";
import { loadFinancialPlanSummary } from "@/lib/server/portfolio/loadFinancialPlanSummary";
import { loadRecentWins } from "@/lib/server/portfolio/loadRecentWins";
import { loadResourceActivity } from "@/lib/server/portfolio/loadResourceActivity";
import { loadAiBriefing } from "@/lib/server/ai/loadAiBriefing";
import { loadPortfolioDueDigest } from "@/lib/server/ai/loadDueDigest";

export type PortfolioFilters = {
  q?: string;
  projectId?: string[];
  projectName?: string[];
  projectCode?: string[];
  projectManagerId?: string[];
  department?: string[];
};

export type DashboardSummaryPayload = {
  ok: true;
  days: 7 | 14 | 30 | 60;
  dueDays: 7 | 14 | 30 | 60;
  filters: PortfolioFilters;
  generated_at: string;
  scope: {
    scopedProjectCount: number;
    activeProjectCount: number;
    scopedProjectIds: string[];
    activeProjectIds: string[];
    windowDays: 7 | 14 | 30 | 60;
    dueWindowDays: 7 | 14 | 30 | 60;
  };
  activeProjects: Array<{
    id: string;
    title: string;
    client_name: string | null;
    project_code: string | null;
    status: string | null;
    lifecycle_state: string | null;
    state: string | null;
    phase: string | null;
    department: string | null;
    project_manager: string | null;
    project_manager_id: string | null;
    resource_status: string | null;
  }>;
  portfolioHealth: any;
  milestonesDue: any;
  raidPanel: any;
  financialPlanSummary: any;
  recentWins: any;
  resourceActivity: any;
  aiBriefing: any;
  dueDigest: any;
  insights: any[];
  executiveBriefing: any;
  financialPlan: any;
  due: any;
  cache?: {
    key: string;
    hit: boolean;
    ttlSeconds: number;
    scope: "memory" | "fresh";
  };
};

export function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export function uniqStrings(input: unknown): string[] {
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

export function clampDays(x: number) {
  if (!Number.isFinite(x)) return 30;
  return Math.max(1, Math.min(365, Math.floor(x)));
}

export function normalizeDays(v: unknown): 7 | 14 | 30 | 60 {
  const raw = safeStr(v).trim().toLowerCase();
  if (raw === "all") return 60;

  const n = clampDays(Number(raw || 30));
  if (n <= 7) return 7;
  if (n <= 14) return 14;
  if (n <= 30) return 30;
  return 60;
}

export function parseFiltersFromSearchParams(sp: URLSearchParams): PortfolioFilters {
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

export function normalizeFilters(input: any): PortfolioFilters {
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

export function sortStrings(input?: string[]) {
  return [...(input ?? [])].map((v) => safeStr(v).trim()).filter(Boolean).sort();
}

export function canonicalizeFilters(filters: PortfolioFilters): PortfolioFilters {
  const out: PortfolioFilters = {};
  if (filters.q?.trim()) out.q = filters.q.trim();
  if (filters.projectId?.length) out.projectId = sortStrings(filters.projectId);
  if (filters.projectName?.length) out.projectName = sortStrings(filters.projectName);
  if (filters.projectCode?.length) out.projectCode = sortStrings(filters.projectCode);
  if (filters.projectManagerId?.length) {
    out.projectManagerId = sortStrings(filters.projectManagerId);
  }
  if (filters.department?.length) out.department = sortStrings(filters.department);
  return out;
}

export function isTruthyFlag(v: unknown) {
  return v === true || v === "true" || v === 1 || v === "1";
}

export function normalizeStatusParts(row: any): string[] {
  return [row?.status, row?.lifecycle_state, row?.state, row?.phase]
    .map((v) => safeStr(v).trim().toLowerCase())
    .filter(Boolean);
}

export function isProjectActive(row: any): boolean {
  if (!row) return false;

  if (safeStr(row?.resource_status).trim().toLowerCase() === "pipeline") return false;
  if (row?.deleted_at) return false;
  if (isTruthyFlag(row?.is_deleted)) return false;
  if (row?.archived_at) return false;
  if (isTruthyFlag(row?.is_archived) || isTruthyFlag(row?.archived)) return false;
  if (row?.closed_at) return false;
  if (row?.cancelled_at) return false;

  if (row?.is_active === true || row?.active === true) return true;
  if (row?.is_active === false || row?.active === false) return false;

  const statuses = normalizeStatusParts(row);
  if (!statuses.length) return true;

  const blockedTerms = ["closed", "cancelled", "archived", "deleted"];

  return !statuses.some((s) => blockedTerms.some((term) => s.includes(term)));
}

export async function getScopedProjects(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filters: PortfolioFilters,
): Promise<any[]> {
  try {
    let query = supabase
      .from("projects")
      .select(`
        id,
        title,
        client_name,
        project_code,
        status,
        lifecycle_state,
        state,
        phase,
        is_active,
        active,
        deleted_at,
        is_deleted,
        is_archived,
        archived,
        archived_at,
        cancelled_at,
        closed_at,
        department,
        project_manager,
        project_manager_id,
        pm_name,
        pm_user_id,
        resource_status
      `)
      .is("deleted_at", null)
      .neq("resource_status", "pipeline")
      .limit(2000);

    if (filters.projectId?.length) {
      query = query.in("id", filters.projectId);
    }
    if (filters.projectCode?.length) {
      query = query.in("project_code", filters.projectCode);
    }

    const { data, error } = await query;
    if (error || !data?.length) return [];

    let rows = (data as any[]).filter(Boolean);

    if (filters.projectName?.length) {
      const needles = filters.projectName
        .map((v) => safeStr(v).trim().toLowerCase())
        .filter(Boolean);
      rows = rows.filter((r) => {
        const title = safeStr(r?.title).trim().toLowerCase();
        return needles.some((n) => title.includes(n));
      });
    }

    if (filters.projectManagerId?.length) {
      const pmSet = new Set(
        filters.projectManagerId.map((v) => safeStr(v).trim()).filter(Boolean),
      );
      rows = rows.filter((r) => {
        const ids = [
          safeStr(r?.project_manager_id).trim(),
          safeStr(r?.pm_user_id).trim(),
          safeStr(r?.project_manager).trim(),
          safeStr(r?.pm_name).trim(),
        ].filter(Boolean);
        return ids.some((v) => pmSet.has(v));
      });
    }

    if (filters.department?.length) {
      const deptNeedles = filters.department
        .map((v) => safeStr(v).trim().toLowerCase())
        .filter(Boolean);
      rows = rows.filter((r) => {
        const dept = safeStr(r?.department).trim().toLowerCase();
        return deptNeedles.some((d) => dept.includes(d));
      });
    }

    if (filters.q?.trim()) {
      const q = filters.q.trim().toLowerCase();
      rows = rows.filter((r) => {
        const hay = [
          safeStr(r?.title),
          safeStr(r?.project_code),
          safeStr(r?.department),
          safeStr(r?.project_manager),
          safeStr(r?.pm_name),
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    return rows;
  } catch {
    return [];
  }
}

export function normalizeAiBriefingPayload(input: any) {
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

export function zeroPortfolioHealth(days: 7 | 14 | 30 | 60) {
  return {
    ok: true,
    score: 0,
    portfolio_health: 0,
    days,
    windowDays: days,
    projectCount: 0,
    parts: {
      schedule: 0,
      raid: 0,
      budget: 0,
      governance: 0,
      flow: 0,
      approvals: 0,
      activity: 0,
    },
    projectScores: {},
    drivers: [],
    meta: { emptyScope: true },
  };
}

export function zeroMilestonesDue() {
  return {
    ok: true,
    count: 0,
    items: [],
  };
}

export function zeroRaidPanel(days: 7 | 14 | 30 | 60) {
  return {
    ok: true,
    panel: {
      days,
      due_total: 0,
      overdue_total: 0,
      risk_due: 0,
      issue_due: 0,
      dependency_due: 0,
      assumption_due: 0,
      risk_hi: 0,
      issue_hi: 0,
    },
  };
}

export function zeroFinancialPlanSummary() {
  return {
    ok: true,
    total_approved_budget: 0,
    total_spent: 0,
    variance_pct: 0,
    pending_exposure_pct: 0,
    rag: "G",
    currency: "GBP",
    project_count: 0,
    portfolio: {
      totalBudget: 0,
      totalActual: 0,
      variance_pct: 0,
      rag: "G",
    },
  };
}

export function zeroRecentWins() {
  return {
    ok: true,
    wins: [],
  };
}

export function zeroDueDigest(dueDays: 7 | 14 | 30 | 60) {
  return {
    ok: true,
    eventType: "artifact_due" as const,
    scope: "org" as const,
    ai: {
      summary: `No due items in the next ${dueDays} days.`,
      windowDays: dueDays,
      counts: {
        total: 0,
        milestone: 0,
        work_item: 0,
        raid: 0,
        artifact: 0,
        change: 0,
      },
      dueSoon: [],
      recommendedMessage: "",
    },
    stats: {
      total: 0,
    },
  };
}

export async function loadDashboardSummaryData(
  _req: NextRequest,
  input: {
    userId: string;
    days?: unknown;
    dueDays?: unknown;
    dueWindowDays?: unknown;
    filters?: any;
    cacheKey: string;
  },
): Promise<DashboardSummaryPayload> {
  const supabase = await createClient();

  const days = normalizeDays(input?.days);
  const dueDays = normalizeDays(input?.dueWindowDays ?? input?.dueDays);
  const filters = canonicalizeFilters(normalizeFilters(input?.filters));

  const scopedProjects = await getScopedProjects(supabase, filters);
  const activeScopedProjects = scopedProjects.filter(isProjectActive);

  const scopedProjectIds = scopedProjects.map((p) => String(p.id)).filter(Boolean);
  const activeProjectIds = activeScopedProjects.map((p) => String(p.id)).filter(Boolean);

  const confirmedFilters: PortfolioFilters = {
    ...filters,
    projectId: activeProjectIds,
  };

  const scopedFilters: PortfolioFilters = {
    projectId: activeProjectIds,
    projectName: confirmedFilters.projectName,
    projectCode: confirmedFilters.projectCode,
    projectManagerId: confirmedFilters.projectManagerId,
    department: confirmedFilters.department,
  };

  let portfolioHealth: any = null;
  let milestonesDue: any = null;
  let raidPanel: any = null;
  let financialPlanSummary: any = null;
  let recentWins: any = null;
  let resourceActivity: any = null;
  let aiBriefingRaw: any = null;
  let dueDigest: any = null;

  if (activeProjectIds.length === 0) {
    resourceActivity = await loadResourceActivity({
      userId: input.userId,
      days,
      filters: {
        projectId: scopedProjectIds,
        projectName: filters.projectName,
        projectCode: filters.projectCode,
        projectManagerId: filters.projectManagerId,
        department: filters.department,
      },
      supabase,
    });

    portfolioHealth = zeroPortfolioHealth(days);
    milestonesDue = zeroMilestonesDue();
    raidPanel = zeroRaidPanel(days);
    financialPlanSummary = zeroFinancialPlanSummary();
    recentWins = zeroRecentWins();
    aiBriefingRaw = {
      ok: true,
      insights: [],
      executive_briefing: null,
      briefing: null,
    };
    dueDigest = zeroDueDigest(dueDays);
  } else {
    [
      portfolioHealth,
      milestonesDue,
      raidPanel,
      financialPlanSummary,
      recentWins,
      resourceActivity,
      aiBriefingRaw,
      dueDigest,
    ] = await Promise.all([
      loadPortfolioHealth({
        userId: input.userId,
        days,
        filters: scopedFilters,
        supabase,
      }),
      loadMilestonesDue({
        userId: input.userId,
        days,
        filters: scopedFilters,
        supabase,
      }),
      loadRaidPanel({
        userId: input.userId,
        days,
        filters: scopedFilters,
        supabase,
      }),
      loadFinancialPlanSummary({
        userId: input.userId,
        filters: scopedFilters,
        supabase,
      }),
      loadRecentWins(_req, {
        userId: input.userId,
        days: 7,
        limit: 8,
        supabase,
      }),
      loadResourceActivity({
        userId: input.userId,
        days,
        filters: scopedFilters,
        supabase,
      }),
      loadAiBriefing({
        userId: input.userId,
        days,
        filters: {
          q: filters.q,
          projectId: scopedFilters.projectId,
          projectCode: scopedFilters.projectCode,
          pm: scopedFilters.projectManagerId,
          dept: scopedFilters.department,
        },
        supabase,
      }),
      loadPortfolioDueDigest({
        supabase,
        userId: input.userId,
        windowDays: dueDays,
      }),
    ]);
  }

  const aiBriefing = normalizeAiBriefingPayload(aiBriefingRaw);
  const insights = Array.isArray(aiBriefing?.insights) ? aiBriefing.insights : [];
  const executiveBriefing =
    aiBriefing?.executive_briefing ?? aiBriefing?.briefing ?? null;

  const activeProjects = activeScopedProjects
    .map((p) => ({
      id: String(p.id),
      title: safeStr(p.title).trim() || "Project",
      client_name: safeStr(p.client_name).trim() || null,
      project_code: p.project_code ?? null,
      status: safeStr(p.status).trim() || null,
      lifecycle_state: safeStr(p.lifecycle_state).trim() || null,
      state: safeStr(p.state).trim() || null,
      phase: safeStr(p.phase).trim() || null,
      department: safeStr(p.department).trim() || null,
      project_manager: safeStr(p.project_manager || p.pm_name).trim() || null,
      project_manager_id: safeStr(p.project_manager_id || p.pm_user_id).trim() || null,
      resource_status: safeStr(p.resource_status).trim() || null,
    }))
    .sort((a, b) => {
      const ac = safeStr(a.project_code).trim();
      const bc = safeStr(b.project_code).trim();
      if (ac && bc && ac !== bc) return ac.localeCompare(bc);
      return a.title.localeCompare(b.title);
    });

  const portfolioScore =
    portfolioHealth && typeof portfolioHealth === "object"
      ? Number((portfolioHealth as any).score ?? (portfolioHealth as any).portfolio_health ?? 0)
      : 0;

  const milestoneCount =
    typeof milestonesDue === "number"
      ? milestonesDue
      : Number((milestonesDue as any)?.count ?? 0);

  const raidDueCount =
    Number((raidPanel as any)?.panel?.due_total ?? (raidPanel as any)?.due_total ?? 0);

  if (
    activeProjectIds.length === 0 &&
    (portfolioScore > 0 || milestoneCount > 0 || raidDueCount > 0)
  ) {
    console.warn("[dashboard-summary] inconsistent payload", {
      activeProjectCount: activeProjectIds.length,
      portfolioScore,
      milestoneCount,
      raidDueCount,
      filters,
    });
  }

  return {
    ok: true,
    days,
    dueDays,
    filters,
    generated_at: new Date().toISOString(),

    scope: {
      scopedProjectCount: scopedProjectIds.length,
      activeProjectCount: activeProjectIds.length,
      scopedProjectIds,
      activeProjectIds,
      windowDays: days,
      dueWindowDays: dueDays,
    },
    activeProjects,

    portfolioHealth: portfolioHealth ?? null,
    milestonesDue: milestonesDue ?? null,
    raidPanel: raidPanel ?? null,
    financialPlanSummary: financialPlanSummary ?? null,
    recentWins: recentWins ?? null,
    resourceActivity: resourceActivity ?? null,
    aiBriefing: aiBriefingRaw ? aiBriefing : null,
    dueDigest: dueDigest ?? null,

    insights,
    executiveBriefing,
    financialPlan: financialPlanSummary ?? null,
    due: dueDigest ?? null,

    cache: {
      key: input.cacheKey,
      hit: false,
      ttlSeconds: 45,
      scope: "fresh",
    },
  };
}