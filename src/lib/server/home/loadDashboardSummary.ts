import "server-only";

import { NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { filterActiveProjectIds } from "@/lib/server/project-scope";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";
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
    completeness?: "full" | "partial" | "empty";
    mode?: string | null;
    reason?: string | null;
    rawProjectCount?: number;
    visibleProjectCount?: number;
    filteredVisibleProjectCount?: number;
    filteredActiveProjectCount?: number;
    usedFallback?: boolean;
    activeFilterOk?: boolean;
    activeFilterError?: string | null;
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

function looksMissingRelation(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("does not exist") ||
    msg.includes("relation") ||
    msg.includes("42p01")
  );
}

function looksMissingColumn(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

async function getProjectsByIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectIds: string[],
): Promise<any[]> {
  if (!projectIds.length) return [];

  const selectSets = [
    `
      id,
      title,
      client_name,
      project_code,
      status,
      lifecycle_state,
      state,
      phase,
      department,
      project_manager,
      project_manager_id,
      pm_name,
      pm_user_id,
      resource_status
    `,
    `
      id,
      title,
      client_name,
      project_code,
      status,
      lifecycle_state,
      state,
      phase,
      department,
      project_manager,
      project_manager_id,
      resource_status
    `,
    `
      id,
      title,
      client_name,
      project_code,
      status,
      lifecycle_state,
      state,
      phase,
      department,
      project_manager,
      project_manager_id
    `,
    `
      id,
      title,
      project_code,
      status,
      lifecycle_state,
      state,
      phase,
      department,
      project_manager,
      project_manager_id
    `,
    `
      id,
      title,
      project_code,
      status
    `,
    `
      id,
      title,
      project_code
    `,
    `
      id,
      title
    `,
  ];

  let lastError: any = null;

  for (const sel of selectSets) {
    const { data, error } = await supabase
      .from("projects")
      .select(sel)
      .in("id", projectIds)
      .limit(5000);

    if (!error && Array.isArray(data)) return data;

    lastError = error;
    if (!(looksMissingRelation(error) || looksMissingColumn(error))) break;
  }

  console.warn("[dashboard-summary:getProjectsByIds] failed to load project rows", {
    requestedIds: projectIds.length,
    error: safeStr(lastError?.message || lastError),
  });

  return [];
}

async function applyDashboardFilters(
  supabase: Awaited<ReturnType<typeof createClient>>,
  scopedProjectIds: string[],
  filters: PortfolioFilters,
) {
  const meta: any = { applied: false, filters, notes: [] as string[] };

  if (!scopedProjectIds.length) {
    return { projectIds: [], projectRows: [], meta: { ...meta, applied: true } };
  }

  const hasFilters =
    Boolean(filters.q?.trim()) ||
    Boolean(filters.projectId?.length) ||
    Boolean(filters.projectName?.length) ||
    Boolean(filters.projectCode?.length) ||
    Boolean(filters.projectManagerId?.length) ||
    Boolean(filters.department?.length);

  if (!hasFilters) {
    const rows = await getProjectsByIds(supabase, scopedProjectIds);
    return { projectIds: scopedProjectIds, projectRows: rows, meta };
  }

  let workingIds = scopedProjectIds;

  if (filters.projectId?.length) {
    const wanted = new Set(filters.projectId.map((v) => safeStr(v).trim()).filter(Boolean));
    workingIds = scopedProjectIds.filter((id) => wanted.has(String(id)));
    meta.notes.push(`Applied explicit projectId scope (${workingIds.length}).`);
  }

  const rows = await getProjectsByIds(supabase, workingIds);

  if (!rows.length) {
    meta.applied = true;
    meta.notes.push("Could not read projects for filtering; falling back to current scope.");
    return { projectIds: workingIds, projectRows: [], meta };
  }

  let filtered = rows;

  if (filters.projectName?.length) {
    const needles = filters.projectName
      .map((v) => safeStr(v).trim().toLowerCase())
      .filter(Boolean);

    filtered = filtered.filter((r) => {
      const title = safeStr(r?.title).trim().toLowerCase();
      return needles.some((n) => title.includes(n));
    });
  }

  if (filters.projectCode?.length) {
    const needles = filters.projectCode
      .map((v) => safeStr(v).trim().toLowerCase())
      .filter(Boolean);

    filtered = filtered.filter((r) => {
      const code = projectCodeLabel(r?.project_code).toLowerCase();
      return needles.some((n) => code.includes(n));
    });
  }

  if (filters.projectManagerId?.length) {
    const pmSet = new Set(
      filters.projectManagerId.map((v) => safeStr(v).trim()).filter(Boolean),
    );

    filtered = filtered.filter((r) => {
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

    filtered = filtered.filter((r) => {
      const dept = safeStr(r?.department).trim().toLowerCase();
      return deptNeedles.some((d) => dept.includes(d));
    });
  }

  if (filters.q?.trim()) {
    const q = filters.q.trim().toLowerCase();

    filtered = filtered.filter((r) => {
      const hay = [
        safeStr(r?.title),
        safeStr(r?.project_code),
        safeStr(r?.department),
        safeStr(r?.project_manager),
        safeStr(r?.pm_name),
        safeStr(r?.client_name),
      ]
        .join(" ")
        .toLowerCase();

      return hay.includes(q);
    });
  }

  const outIds = filtered
    .map((r) => safeStr(r?.id).trim())
    .filter(Boolean);

  meta.applied = true;
  meta.counts = { before: scopedProjectIds.length, after: outIds.length };

  return {
    projectIds: outIds,
    projectRows: filtered,
    meta,
  };
}

async function normalizeActiveIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  visibleProjectIds: string[],
) {
  const failOpen = (reason: string) => ({
    ids: visibleProjectIds,
    ok: false,
    error: reason,
  });

  if (!visibleProjectIds.length) {
    return { ids: [], ok: true, error: null as string | null };
  }

  try {
    const r: any = await filterActiveProjectIds(supabase, visibleProjectIds);

    if (Array.isArray(r)) {
      const ids = r.filter(Boolean);
      if (!ids.length && visibleProjectIds.length) {
        return failOpen("active filter returned 0 ids; failing open");
      }
      return { ids, ok: true, error: null as string | null };
    }

    const ids = Array.isArray(r?.projectIds) ? r.projectIds.filter(Boolean) : [];
    if (!ids.length && visibleProjectIds.length) {
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
    score: null,
    portfolio_health: 0,
    days,
    windowDays: days,
    projectCount: 0,
    parts: {
      schedule: null,
      raid: null,
      budget: null,
      governance: null,
      flow: null,
      approvals: null,
      activity: null,
    },
    projectScores: {},
    drivers: [],
    meta: {
      emptyScope: true,
      completeness: "empty",
      reason: "NO_ACTIVE_PROJECTS",
    },
  };
}

export function zeroMilestonesDue(days: 7 | 14 | 30 | 60) {
  return {
    ok: true,
    days,
    count: 0,
    meta: {
      projectCount: 0,
      completeness: "empty",
      reason: "NO_ACTIVE_PROJECTS",
    },
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
      risk_overdue: 0,
      issue_overdue: 0,
      dependency_overdue: 0,
      assumption_overdue: 0,
      risk_hi: 0,
      issue_hi: 0,
      dependency_hi: 0,
      assumption_hi: 0,
      overdue_hi: 0,
    },
    meta: {
      projectCount: 0,
      completeness: "empty",
      reason: "NO_ACTIVE_PROJECTS",
    },
  };
}

export function zeroFinancialPlanSummary() {
  return {
    ok: true,
    total_approved_budget: null,
    total_spent: null,
    variance_pct: null,
    pending_exposure_pct: null,
    rag: "A",
    currency: "GBP",
    project_count: 0,
    portfolio: {
      totalBudget: 0,
      totalActual: 0,
      totalForecast: 0,
      totalVariance: 0,
      projectCount: 0,
      withPlanCount: 0,
      variancePct: null,
      rag: "A",
      meta: {
        totalApprovedBudget: 0,
        totalEffectiveBudget: 0,
        completeness: "empty",
        reason: "NO_ACTIVE_PROJECTS",
      },
    },
    projects: [],
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

  const scope = await resolvePortfolioScope(supabase, input.userId);
  const scopeMeta = scope.meta ?? {};

  const rawProjectIds = uniqStrings(Array.isArray(scope.rawProjectIds) ? scope.rawProjectIds : []);
  const visibleProjectIdsFromScope = uniqStrings(
    Array.isArray(scope.projectIds) ? scope.projectIds : [],
  );

  const filtered = await applyDashboardFilters(supabase, visibleProjectIdsFromScope, filters);
  const filteredVisibleProjectIds = uniqStrings(filtered.projectIds);

  const active = await normalizeActiveIds(supabase, filteredVisibleProjectIds);
  const filteredActiveProjectIds = uniqStrings(active.ids);

  const completeness: "full" | "partial" | "empty" =
    filteredVisibleProjectIds.length === 0
      ? "empty"
      : filteredActiveProjectIds.length === filteredVisibleProjectIds.length
        ? "full"
        : "partial";

  const activeProjectRowMap = new Map(
    (Array.isArray(filtered.projectRows) ? filtered.projectRows : []).map((r: any) => [
      safeStr(r?.id).trim(),
      r,
    ]),
  );

  let activeProjects = filteredActiveProjectIds
    .map((id) => activeProjectRowMap.get(id))
    .filter(Boolean)
    .map((p: any) => ({
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
    }));

  if (!activeProjects.length && filteredActiveProjectIds.length) {
    const fallbackRows = await getProjectsByIds(supabase, filteredActiveProjectIds);
    activeProjects = fallbackRows.map((p: any) => ({
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
    }));
  }

  activeProjects.sort((a, b) => {
    const ac = safeStr(a.project_code).trim();
    const bc = safeStr(b.project_code).trim();
    if (ac && bc && ac !== bc) return ac.localeCompare(bc);
    return a.title.localeCompare(b.title);
  });

  const moduleFilters: PortfolioFilters = {
    q: filters.q,
    projectId: filteredVisibleProjectIds,
    projectName: filters.projectName,
    projectCode: filters.projectCode,
    projectManagerId: filters.projectManagerId,
    department: filters.department,
  };

  let portfolioHealth: any = null;
  let milestonesDue: any = null;
  let raidPanel: any = null;
  let financialPlanSummary: any = null;
  let recentWins: any = null;
  let resourceActivity: any = null;
  let aiBriefingRaw: any = null;
  let dueDigest: any = null;

  if (filteredVisibleProjectIds.length === 0) {
    portfolioHealth = zeroPortfolioHealth(days);
    milestonesDue = zeroMilestonesDue(days);
    raidPanel = zeroRaidPanel(days);
    financialPlanSummary = zeroFinancialPlanSummary();
    recentWins = zeroRecentWins();
    resourceActivity = await loadResourceActivity({
      userId: input.userId,
      days,
      filters: {
        projectId: [],
        projectName: filters.projectName,
        projectCode: filters.projectCode,
        projectManagerId: filters.projectManagerId,
        department: filters.department,
      },
      supabase,
    });
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
        filters: moduleFilters,
        supabase,
      }),
      loadMilestonesDue({
        userId: input.userId,
        days,
        filters: moduleFilters,
        supabase,
      }),
      loadRaidPanel({
        userId: input.userId,
        days,
        filters: moduleFilters,
        supabase,
      }),
      loadFinancialPlanSummary({
        userId: input.userId,
        filters: moduleFilters,
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
        filters: moduleFilters,
        supabase,
      }),
      loadAiBriefing({
        userId: input.userId,
        days,
        filters: {
          q: filters.q,
          projectId: filteredVisibleProjectIds,
          projectCode: filters.projectCode,
          pm: filters.projectManagerId,
          dept: filters.department,
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
    filteredActiveProjectIds.length === 0 &&
    (portfolioScore > 0 || milestoneCount > 0 || raidDueCount > 0)
  ) {
    console.warn("[dashboard-summary] inconsistent payload", {
      activeProjectCount: filteredActiveProjectIds.length,
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
      scopedProjectCount: filteredVisibleProjectIds.length,
      activeProjectCount: filteredActiveProjectIds.length,
      scopedProjectIds: filteredVisibleProjectIds,
      activeProjectIds: filteredActiveProjectIds,
      windowDays: days,
      dueWindowDays: dueDays,
      completeness,
      mode: safeStr(scopeMeta?.mode) || null,
      reason: safeStr(scopeMeta?.reason) || null,
      rawProjectCount: rawProjectIds.length,
      visibleProjectCount: visibleProjectIdsFromScope.length,
      filteredVisibleProjectCount: filteredVisibleProjectIds.length,
      filteredActiveProjectCount: filteredActiveProjectIds.length,
      usedFallback: Boolean(scopeMeta?.usedFallback) || !active.ok,
      activeFilterOk: active.ok,
      activeFilterError: active.error,
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