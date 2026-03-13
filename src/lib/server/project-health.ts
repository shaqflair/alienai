// src/lib/server/project-health.ts
// Shared health scoring logic used by both the project page and portfolio route.
// Any change to weights or formulas here automatically applies everywhere.

/* ─── types ─── */

export type HealthParts = {
  schedule: number | null;
  raid: number | null;
  budget: number | null;
  governance: number | null;
};

export type HealthResult = {
  score: number | null;
  parts: HealthParts;
  detail: {
    schedule: ScheduleDetail;
    raid: RaidDetail;
    budget: BudgetDetail;
    governance: GovernanceDetail;
  };
};

export type ScheduleDetail = {
  total: number;
  overdue: number;
  critical: number;
  avgSlipDays: number;
};

export type RaidDetail = {
  total: number;
  highRisk: number;
  overdue: number;
};

export type BudgetDetail = {
  budgetAmount: number | null;   // approved budget (£/currency)
  spentAmount: number;           // actual spend to date
  utilisationPct: number | null; // spentAmount / budgetAmount * 100
  variance: number | null;       // budgetAmount - spentAmount (positive = under budget)
  forecastOverrun: boolean;      // true if already over budget
};

export type GovernanceDetail = {
  pendingApprovalCount: number;
  openChangeRequests: number;
};

/* ─── weights (single source of truth) ─── */

export const HEALTH_WEIGHTS = {
  schedule: 35,
  raid: 30,
  budget: 20,
  governance: 15,
} as const;

/* ─── utils ─── */

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function looksMissingRelation(err: any): boolean {
  const msg = String(err?.message || "").toLowerCase();
  return (
    msg.includes("does not exist") ||
    msg.includes("relation") ||
    msg.includes("42p01")
  );
}

/* ─── pure scorers ─── */

export function scoreSchedule(
  milestones: any[],
  today: string,
): { score: number | null; detail: ScheduleDetail } {
  const detail: ScheduleDetail = { total: 0, overdue: 0, critical: 0, avgSlipDays: 0 };
  if (!milestones.length) return { score: null, detail };

  let score = 100;
  let slipSum = 0;
  let slipCount = 0;
  detail.total = milestones.length;

  for (const m of milestones) {
    const st = String(m.status ?? "").toLowerCase();
    const done = ["completed", "done", "closed"].includes(st);
    const end = m.end_date ? String(m.end_date).slice(0, 10) : null;
    const base = m.baseline_end ? String(m.baseline_end).slice(0, 10) : null;

    if (!done && end && end < today) {
      detail.overdue++;
      score -= m.critical_path_flag ? (detail.critical++, 12) : 8;
    }

    if (end && base) {
      const slip = Math.max(
        0,
        Math.round(
          (new Date(`${end}T00:00:00Z`).getTime() -
            new Date(`${base}T00:00:00Z`).getTime()) / 86_400_000,
        ),
      );
      slipSum += slip;
      slipCount++;
    }
  }

  detail.avgSlipDays = slipCount ? Math.round(slipSum / slipCount) : 0;
  score -= Math.min(15, Math.round(detail.avgSlipDays * 1.5));
  return { score: clamp(score), detail };
}

export function scoreRaid(
  raidItems: any[],
  today: string,
): { score: number | null; detail: RaidDetail } {
  const detail: RaidDetail = { total: 0, highRisk: 0, overdue: 0 };
  if (!raidItems.length) return { score: null, detail };

  let score = 100;
  detail.total = raidItems.length;

  for (const r of raidItems) {
    const p = Number(r.probability ?? 0);
    const s = Number(r.severity ?? 0);
    const composite =
      r.probability != null && r.severity != null ? Math.round((p * s) / 100) : 0;

    if (composite >= 70) { score -= 8; detail.highRisk++; }
    else if (composite >= 50) { score -= 4; }

    const due = r.due_date ? String(r.due_date).slice(0, 10) : null;
    if (due && due < today) { score -= 6; detail.overdue++; }
  }

  return { score: clamp(score), detail };
}

/**
 * Budget score: actual money spent vs approved budget_amount.
 *
 * Bands:
 *   ≤75%   spent → 100  (healthy)
 *   76–90% spent → 100→85  (minor decay, approaching limit)
 *   91–100% spent → 85→60  (steeper decay, nearing exhaustion)
 *   101–120% spent → 60→20 (over budget)
 *   >120%  spent → 10  (significantly over budget)
 *
 * Returns null score when no budget_amount is set — dimension is excluded
 * from the weighted average rather than penalising projects with no budget.
 */
export function scoreBudget(
  budgetAmount: number | null,
  spentAmount: number,
): { score: number | null; detail: BudgetDetail } {
  const detail: BudgetDetail = {
    budgetAmount,
    spentAmount,
    utilisationPct: null,
    variance: null,
    forecastOverrun: false,
  };

  if (budgetAmount == null || budgetAmount <= 0) {
    return { score: null, detail };
  }

  const pct = (spentAmount / budgetAmount) * 100;
  detail.utilisationPct = Math.round(pct * 10) / 10;
  detail.variance = budgetAmount - spentAmount;
  detail.forecastOverrun = pct > 100;

  let score: number;
  if      (pct <= 75)  score = 100;
  else if (pct <= 90)  score = 100 - ((pct - 75)  / 15) * 15;  // 100→85
  else if (pct <= 100) score = 85  - ((pct - 90)  / 10) * 25;  // 85→60
  else if (pct <= 120) score = 60  - ((pct - 100) / 20) * 40;  // 60→20
  else                 score = 10;

  return { score: clamp(score), detail };
}

export function scoreGovernance(
  pendingApprovalCount: number,
  openChangeRequests: number,
): { score: number; detail: GovernanceDetail } {
  const detail: GovernanceDetail = { pendingApprovalCount, openChangeRequests };
  let score = 100;
  score -= Math.min(35, pendingApprovalCount * 5);
  score -= Math.min(25, openChangeRequests * 4);
  return { score: clamp(score), detail };
}

/* ─── weighted aggregator ─── */

export function computeWeightedScore(parts: HealthParts): number | null {
  const dims = [
    { val: parts.schedule,   w: HEALTH_WEIGHTS.schedule },
    { val: parts.raid,       w: HEALTH_WEIGHTS.raid },
    { val: parts.budget,     w: HEALTH_WEIGHTS.budget },
    { val: parts.governance, w: HEALTH_WEIGHTS.governance },
  ].filter((d) => d.val != null) as { val: number; w: number }[];

  if (!dims.length) return null;

  const totalW  = dims.reduce((s, d) => s + d.w, 0);
  const weighted = dims.reduce((s, d) => s + d.val * d.w, 0);
  return clamp(weighted / totalW);
}

/* ─── main entry point (used by project page) ─── */

export function computeHealthFromData(opts: {
  milestones: any[];
  raidItems: any[];
  budgetAmount: number | null;
  spentAmount: number;
  pendingApprovalCount: number;
  openChangeRequests: number;
  today?: string;
}): HealthResult {
  const today = opts.today ?? ymd(new Date());

  const { score: scheduleScore, detail: scheduleDetail } = scoreSchedule(opts.milestones, today);
  const { score: raidScore,     detail: raidDetail     } = scoreRaid(opts.raidItems, today);
  const { score: budgetScore,   detail: budgetDetail   } = scoreBudget(opts.budgetAmount, opts.spentAmount);
  const { score: govScore,      detail: govDetail      } = scoreGovernance(
    opts.pendingApprovalCount,
    opts.openChangeRequests,
  );

  const parts: HealthParts = {
    schedule: scheduleScore,
    raid:     raidScore,
    budget:   budgetScore,
    governance: govScore,
  };

  return {
    score: computeWeightedScore(parts),
    parts,
    detail: {
      schedule:   scheduleDetail,
      raid:       raidDetail,
      budget:     budgetDetail,
      governance: govDetail,
    },
  };
}

/* ─── portfolio data fetchers ─── */

async function fetchPortfolioMilestones(supabase: any, projectIds: string[]) {
  const { data, error } = await supabase
    .from("schedule_milestones")
    .select("project_id, end_date, baseline_end, status, critical_path_flag")
    .in("project_id", projectIds)
    .limit(20000);

  if (error) return { ok: false, rows: [] as any[] };
  return { ok: true, rows: Array.isArray(data) ? data : [] };
}

async function fetchPortfolioRaid(supabase: any, projectIds: string[]) {
  const { data, error } = await supabase
    .from("raid_items")
    .select("project_id, status, due_date, probability, severity")
    .in("project_id", projectIds)
    .not("status", "in", '("Closed","Invalid")')
    .limit(20000);

  if (error) return { ok: false, rows: [] as any[] };
  return { ok: true, rows: Array.isArray(data) ? data : [] };
}

/**
 * Fetches approved budget from projects.budget_amount and sums actual spend
 * from project_spend per project.
 */
async function fetchPortfolioBudget(
  supabase: any,
  projectIds: string[],
): Promise<Map<string, { budgetAmount: number | null; spentAmount: number }>> {
  const [budgetResult, spendResult] = await Promise.allSettled([
    supabase
      .from("projects")
      .select("id, budget_amount")
      .in("id", projectIds)
      .limit(20000),
    supabase
      .from("project_spend")
      .select("project_id, amount")
      .in("project_id", projectIds)
      .is("deleted_at", null)
      .limit(100000),
  ]);

  const budgetRows: any[] =
    budgetResult.status === "fulfilled" ? budgetResult.value.data ?? [] : [];
  const spendRows: any[] =
    spendResult.status === "fulfilled" ? spendResult.value.data ?? [] : [];

  // Sum spend per project
  const spentByProject = new Map<string, number>();
  for (const row of spendRows) {
    const pid = String(row.project_id);
    spentByProject.set(pid, (spentByProject.get(pid) ?? 0) + Number(row.amount ?? 0));
  }

  const result = new Map<string, { budgetAmount: number | null; spentAmount: number }>();

  for (const p of budgetRows) {
    const pid = String(p.id);
    result.set(pid, {
      budgetAmount: p.budget_amount != null ? Number(p.budget_amount) : null,
      spentAmount: spentByProject.get(pid) ?? 0,
    });
  }

  // Ensure every project ID is represented
  for (const pid of projectIds) {
    if (!result.has(pid)) {
      result.set(pid, { budgetAmount: null, spentAmount: spentByProject.get(pid) ?? 0 });
    }
  }

  return result;
}

async function fetchPortfolioGovernance(supabase: any, projectIds: string[]) {
  const [approvalsResult, changeReqsResult] = await Promise.allSettled([
    supabase
      .from("approvals")
      .select("id, project_id, status")
      .in("project_id", projectIds)
      .eq("status", "pending")
      .limit(20000),
    supabase
      .from("change_requests")
      .select("id, project_id, status")
      .in("project_id", projectIds)
      .limit(20000),
  ]);

  const approvals: any[] =
    approvalsResult.status === "fulfilled" ? approvalsResult.value.data ?? [] : [];
  const changeReqs: any[] =
    changeReqsResult.status === "fulfilled" ? changeReqsResult.value.data ?? [] : [];

  const openStatuses = new Set(["pending", "open", "submitted", "draft"]);

  return {
    pendingApprovals: approvals,
    openChangeRequests: changeReqs.filter((c) =>
      openStatuses.has(String(c.status ?? "").toLowerCase()),
    ),
  };
}

/* ─── portfolio scorer ─── */

export async function computePortfolioHealth(
  supabase: any,
  projectIds: string[],
  windowDays: number,
): Promise<{
  score: number | null;
  parts: HealthParts;
  projectCount: number;
  perProject: Record<string, HealthResult>;
}> {
  if (!projectIds.length) {
    return {
      score: null,
      parts: { schedule: null, raid: null, budget: null, governance: null },
      projectCount: 0,
      perProject: {},
    };
  }

  const today = ymd(new Date());

  const [milestonesRes, raidRes, budgetMap, govRes] = await Promise.all([
    fetchPortfolioMilestones(supabase, projectIds),
    fetchPortfolioRaid(supabase, projectIds),
    fetchPortfolioBudget(supabase, projectIds),
    fetchPortfolioGovernance(supabase, projectIds),
  ]);

  // Group by project
  const milestonesByProject = new Map<string, any[]>();
  const raidByProject = new Map<string, any[]>();

  for (const r of milestonesRes.rows) {
    const pid = String(r.project_id);
    if (!milestonesByProject.has(pid)) milestonesByProject.set(pid, []);
    milestonesByProject.get(pid)!.push(r);
  }

  for (const r of raidRes.rows) {
    const pid = String(r.project_id);
    if (!raidByProject.has(pid)) raidByProject.set(pid, []);
    raidByProject.get(pid)!.push(r);
  }

  const approvalsByProject = new Map<string, number>();
  const changesByProject = new Map<string, number>();

  for (const a of govRes.pendingApprovals) {
    const pid = String(a.project_id);
    approvalsByProject.set(pid, (approvalsByProject.get(pid) ?? 0) + 1);
  }
  for (const c of govRes.openChangeRequests) {
    const pid = String(c.project_id);
    changesByProject.set(pid, (changesByProject.get(pid) ?? 0) + 1);
  }

  // Score each project individually
  const perProject: Record<string, HealthResult> = {};

  for (const pid of projectIds) {
    const budget = budgetMap.get(pid) ?? { budgetAmount: null, spentAmount: 0 };

    perProject[pid] = computeHealthFromData({
      milestones:           milestonesByProject.get(pid) ?? [],
      raidItems:            raidByProject.get(pid) ?? [],
      budgetAmount:         budget.budgetAmount,
      spentAmount:          budget.spentAmount,
      pendingApprovalCount: approvalsByProject.get(pid) ?? 0,
      openChangeRequests:   changesByProject.get(pid) ?? 0,
      today,
    });
  }

  const scoredProjects = Object.values(perProject).filter((r) => r.score != null);

  if (!scoredProjects.length) {
    return {
      score: null,
      parts: { schedule: null, raid: null, budget: null, governance: null },
      projectCount: projectIds.length,
      perProject,
    };
  }

  const avgPart = (key: keyof HealthParts): number | null => {
    const vals = scoredProjects
      .map((r) => r.parts[key])
      .filter((v) => v != null) as number[];
    if (!vals.length) return null;
    return clamp(vals.reduce((s, v) => s + v, 0) / vals.length);
  };

  return {
    score: clamp(
      scoredProjects.reduce((s, r) => s + r.score!, 0) / scoredProjects.length,
    ),
    parts: {
      schedule:   avgPart("schedule"),
      raid:       avgPart("raid"),
      budget:     avgPart("budget"),
      governance: avgPart("governance"),
    },
    projectCount: projectIds.length,
    perProject,
  };
}