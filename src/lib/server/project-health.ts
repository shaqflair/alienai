// src/lib/server/project-health.ts
// Single source of truth for health scoring — project + portfolio.
//
// Scoring changes:
//   Schedule   → milestones (overdue + slip) + WBS completion rate
//   RAID       → type-aware: Issues > High Risk > Dependencies/Assumptions
//   Budget     → spend vs budget AND resource over-allocation
//   Governance → Gate 1, stakeholder register, charter approved,
//                budget/financial plan approved, Gate 5 readiness
import { createServiceClient } from "@/lib/supabase/service";
/* ─── types ─── */

export type HealthParts = {
  schedule:   number | null;
  raid:       number | null;
  budget:     number | null;
  governance: number | null;
};

export type HealthResult = {
  score:  number | null;
  parts:  HealthParts;
  detail: {
    schedule:   ScheduleDetail;
    raid:       RaidDetail;
    budget:     BudgetDetail;
    governance: GovernanceDetail;
  };
};

export type ScheduleDetail = {
  total:             number;
  overdue:           number;
  critical:          number;
  avgSlipDays:       number;
  wbsTotal:          number;
  wbsComplete:       number;
  wbsCompletionPct:  number;
};

export type RaidDetail = {
  total:                number;
  openIssues:           number;
  highSeverityIssues:   number;
  highRisks:            number;
  openDependencies:     number;
  openAssumptions:      number;
  overdue:              number;
};

export type BudgetDetail = {
  budgetAmount:    number | null;
  spentAmount:     number;
  utilisationPct:  number | null;
  variance:        number | null;
  forecastOverrun: boolean;
  allocatedDays:   number | null;
  budgetDays:      number | null;
  overAllocated:   boolean;
};

export type GovernanceDetail = {
  charterApproved:              boolean;
  budgetApproved:               boolean;
  stakeholderRegisterPresent:   boolean;
  gate1Complete:                boolean;
  gate5Applicable:              boolean;
  gate5Ready:                   boolean;
  pendingApprovalCount:         number;
  openChangeRequests:           number;
};

/* ─── weights (single source of truth) ─── */

export const HEALTH_WEIGHTS = {
  schedule:   35,
  raid:       30,
  budget:     20,
  governance: 15,
} as const;

/* ─── utils ─── */

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/* ─── SCHEDULE scorer ─── */

export function scoreSchedule(
  milestones: any[],
  wbsItems:   any[],
  today:      string,
): { score: number | null; detail: ScheduleDetail } {
  const detail: ScheduleDetail = {
    total: 0, overdue: 0, critical: 0, avgSlipDays: 0,
    wbsTotal: 0, wbsComplete: 0, wbsCompletionPct: 0,
  };

  // WBS completion
  if (wbsItems.length) {
    detail.wbsTotal = wbsItems.length;
    const doneStatuses = new Set(["done", "completed", "complete", "closed", "delivered"]);
    detail.wbsComplete = wbsItems.filter((w) => {
      const st = String(w?.status || w?.delivery_status || "").toLowerCase().replace(/\s+/g, "_");
      return doneStatuses.has(st);
    }).length;
    detail.wbsCompletionPct = Math.round((detail.wbsComplete / detail.wbsTotal) * 100);
  }

  if (!milestones.length && !wbsItems.length) return { score: null, detail };

  let score = 100;
  let slipSum = 0;
  let slipCount = 0;
  detail.total = milestones.length;

  for (const m of milestones) {
    const st   = String(m.status ?? "").toLowerCase();
    const done = ["completed", "done", "closed"].includes(st);
    const end  = m.end_date  ? String(m.end_date).slice(0, 10)  : null;
    const base = m.baseline_end ? String(m.baseline_end).slice(0, 10) : null;

    if (!done && end && end < today) {
      detail.overdue++;
      if (m.critical_path_flag) { detail.critical++; score -= 12; }
      else                      { score -= 8; }
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

  // WBS completion penalty
  if (detail.wbsTotal > 0) {
    const pct = detail.wbsCompletionPct;
    if      (pct < 30) score -= 15;
    else if (pct < 50) score -= 10;
    else if (pct < 70) score -= 5;
    // ≥70% no penalty
  }

  return { score: clamp(score), detail };
}

/* ─── RAID scorer (type-aware) ─── */
//
// Type hierarchy: Issue > High Risk > Dependency / Assumption
//
// Penalty per open item by type + severity:
//   Issue       high  → -12    med → -7    low → -3
//   Risk        high  → -8     med → -4    low → -2
//   Dependency        → -4 each (open, unresolved)
//   Assumption        → -3 each (open, unvalidated)
//   Overdue     any   → -5 (cap 20)

function raidType(r: any): "issue" | "risk" | "dependency" | "assumption" | "other" {
  const t = String(r?.type || r?.item_type || r?.category || "").toLowerCase().trim();
  if (t.includes("issue"))      return "issue";
  if (t.includes("risk"))       return "risk";
  if (t.includes("depend"))     return "dependency";
  if (t.includes("assump"))     return "assumption";
  if (t.includes("action"))     return "issue"; // treat actions like issues
  return "other";
}

function raidSev(r: any): "high" | "medium" | "low" {
  const p  = Number(r.probability ?? 0);
  const s  = Number(r.severity ?? 0);
  const composite = (r.probability != null && r.severity != null) ? Math.round((p * s) / 100) : 0;
  if (composite >= 70) return "high";
  if (composite >= 40) return "medium";

  // Only use TEXT fields for label — r?.severity is a number (e.g. 60) and would
  // short-circuit before priority is ever reached via String(60) = "60"
  const label = String(r?.severity_label || r?.priority || r?.impact || r?.rag || "").toLowerCase();
  if (["high", "critical", "severe", "red"].some((k) => label.includes(k))) return "high";
  if (["medium", "med", "amber"].some((k) => label.includes(k))) return "medium";
  return "low";
}

function raidOpen(r: any): boolean {
  const st = String(r?.status || r?.state || "").toLowerCase();
  if (!st) return true;
  return !["closed", "resolved", "complete", "completed", "cancelled", "canceled"].some((k) => st.includes(k));
}

export function scoreRaid(
  raidItems: any[],
  today:     string,
): { score: number | null; detail: RaidDetail } {
  const detail: RaidDetail = {
    total: 0, openIssues: 0, highSeverityIssues: 0,
    highRisks: 0, openDependencies: 0, openAssumptions: 0, overdue: 0,
  };

  // No RAID items = perfect score (nothing to penalise)
if (!raidItems.length) return { score: 100, detail };

  detail.total = raidItems.length;
  let score = 100;
  let overduePenalty = 0;

  for (const r of raidItems) {
    if (!raidOpen(r)) continue;

    const typ = raidType(r);
    const sev = raidSev(r);
    const due = r.due_date ? String(r.due_date).slice(0, 10) : null;

    if (due && due < today) {
      detail.overdue++;
      overduePenalty = Math.min(20, overduePenalty + 5);
    }

    if (typ === "issue") {
      detail.openIssues++;
      if (sev === "high")   { detail.highSeverityIssues++; score -= 12; }
      else if (sev === "medium")                           { score -= 7;  }
      else                                                 { score -= 3;  }
    } else if (typ === "risk") {
      if (sev === "high")   { detail.highRisks++; score -= 8; }
      else if (sev === "medium")                  { score -= 4; }
      else                                        { score -= 2; }
    } else if (typ === "dependency") {
      detail.openDependencies++;
      score -= 4;
    } else if (typ === "assumption") {
      detail.openAssumptions++;
      score -= 3;
    } else {
      // 'other' — treat like low risk
      if (sev === "high")   score -= 6;
      else if (sev === "medium") score -= 3;
      else                  score -= 1;
    }
  }

  score -= overduePenalty;
  return { score: clamp(score), detail };
}

/* ─── BUDGET scorer (spend + overallocation) ─── */

export function scoreBudget(
  budgetAmount:  number | null,
  spentAmount:   number,
  allocatedDays: number | null = null,
  budgetDays:    number | null = null,
): { score: number | null; detail: BudgetDetail } {
  const detail: BudgetDetail = {
    budgetAmount, spentAmount,
    utilisationPct: null, variance: null, forecastOverrun: false,
    allocatedDays, budgetDays, overAllocated: false,
  };

  if (budgetAmount == null || budgetAmount <= 0) {
    // Still score overallocation if we have day data
    if (allocatedDays != null && budgetDays != null && budgetDays > 0) {
      const allocPct = (allocatedDays / budgetDays) * 100;
      detail.overAllocated = allocPct > 110;
      if (allocPct > 120) return { score: 40, detail };
      if (allocPct > 110) return { score: 60, detail };
    }
    return { score: null, detail };
  }

  const pct = (spentAmount / budgetAmount) * 100;
  detail.utilisationPct = Math.round(pct * 10) / 10;
  detail.variance       = budgetAmount - spentAmount;
  detail.forecastOverrun = pct > 100;

  let score: number;
  if      (pct <= 75)  score = 100;
  else if (pct <= 90)  score = 100 - ((pct - 75)  / 15) * 15;  // 100→85
  else if (pct <= 100) score = 85  - ((pct - 90)  / 10) * 25;  // 85→60
  else if (pct <= 120) score = 60  - ((pct - 100) / 20) * 40;  // 60→20
  else                 score = 10;

  // Overallocation penalty on top of spend
  if (allocatedDays != null && budgetDays != null && budgetDays > 0) {
    const allocPct = (allocatedDays / budgetDays) * 100;
    detail.overAllocated = allocPct > 110;
    if      (allocPct > 130) score = Math.min(score, 30);
    else if (allocPct > 120) score = Math.min(score, 45);
    else if (allocPct > 110) score = Math.min(score, 60);
  }

  return { score: clamp(score), detail };
}

/* ─── GOVERNANCE scorer ─── */
//
// Checkpoints (weighted — only applicable ones are counted):
//   Charter approved         30 pts  (always applicable)
//   Budget/fin plan approved 20 pts  (always applicable)
//   Stakeholder register     20 pts  (always applicable)
//   Gate 1 complete          20 pts  (always applicable)
//   Gate 5 readiness         10 pts  (only if end_date within 60 days)
//
// Score = achieved_pts / applicable_pts * 100
// Pending approvals and open CRs apply an additional deduction.

export function scoreGovernance(opts: {
  charterApproved:            boolean;
  budgetApproved:             boolean;
  stakeholderRegisterPresent: boolean;
  gate1Complete:              boolean;
  gate5Applicable:            boolean;
  gate5Ready:                 boolean;
  pendingApprovalCount:       number;
  openChangeRequests:         number;
}): { score: number; detail: GovernanceDetail } {
  const detail: GovernanceDetail = { ...opts };

  let achieved  = 0;
  let possible  = 0;

  const add = (pts: number, met: boolean) => {
    possible  += pts;
    if (met) achieved += pts;
  };

  add(30, opts.charterApproved);
  add(20, opts.budgetApproved);
  add(20, opts.stakeholderRegisterPresent);
  add(20, opts.gate1Complete);
  if (opts.gate5Applicable) add(10, opts.gate5Ready);

  let score = possible > 0 ? (achieved / possible) * 100 : 50;

  // Pending approvals / open CRs reduce score
  score -= Math.min(20, opts.pendingApprovalCount * 4);
  score -= Math.min(15, opts.openChangeRequests    * 3);

  return { score: clamp(score), detail };
}

/* ─── weighted aggregator ─── */

export function computeWeightedScore(parts: HealthParts): number | null {
  const dims = [
    { val: parts.schedule,   w: HEALTH_WEIGHTS.schedule   },
    { val: parts.raid,       w: HEALTH_WEIGHTS.raid        },
    { val: parts.budget,     w: HEALTH_WEIGHTS.budget      },
    { val: parts.governance, w: HEALTH_WEIGHTS.governance  },
  ].filter((d) => d.val != null) as { val: number; w: number }[];

  if (!dims.length) return null;

  const totalW   = dims.reduce((s, d) => s + d.w, 0);
  const weighted = dims.reduce((s, d) => s + d.val * d.w, 0);
  return clamp(weighted / totalW);
}

/* ─── main entry point ─── */

export function computeHealthFromData(opts: {
  milestones:                 any[];
  wbsItems?:                  any[];
  raidItems:                  any[];
  budgetAmount:               number | null;
  spentAmount:                number;
  allocatedDays?:             number | null;
  budgetDays?:                number | null;
  pendingApprovalCount:       number;
  openChangeRequests:         number;
  charterApproved?:           boolean;
  budgetApproved?:            boolean;
  stakeholderRegisterPresent?: boolean;
  gate1Complete?:             boolean;
  gate5Applicable?:           boolean;
  gate5Ready?:                boolean;
  today?:                     string;
}): HealthResult {
  const today = opts.today ?? ymd(new Date());

  const { score: scheduleScore, detail: scheduleDetail } =
    scoreSchedule(opts.milestones, opts.wbsItems ?? [], today);

  const { score: raidScore, detail: raidDetail } =
    scoreRaid(opts.raidItems, today);

  const { score: budgetScore, detail: budgetDetail } =
    scoreBudget(opts.budgetAmount, opts.spentAmount, opts.allocatedDays ?? null, opts.budgetDays ?? null);

  const { score: govScore, detail: govDetail } =
    scoreGovernance({
      charterApproved:            opts.charterApproved            ?? false,
      budgetApproved:             opts.budgetApproved             ?? false,
      stakeholderRegisterPresent: opts.stakeholderRegisterPresent ?? false,
      gate1Complete:              opts.gate1Complete              ?? false,
      gate5Applicable:            opts.gate5Applicable            ?? false,
      gate5Ready:                 opts.gate5Ready                 ?? false,
      pendingApprovalCount:       opts.pendingApprovalCount,
      openChangeRequests:         opts.openChangeRequests,
    });

  const parts: HealthParts = {
    schedule:   scheduleScore,
    raid:       raidScore,
    budget:     budgetScore,
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
  return { ok: !error, rows: Array.isArray(data) ? data : [] };
}

async function fetchPortfolioWbs(supabase: any, projectIds: string[]) {
  const { data, error } = await supabase
    .from("wbs_items")
    .select("project_id, status")
    .in("project_id", projectIds)
    .limit(50000);
  return { ok: !error, rows: Array.isArray(data) ? data : [] };
}

async function fetchPortfolioRaid(supabase: any, projectIds: string[]) {
  const adminClient = createServiceClient();
  const { data, error } = await adminClient
    .from("raid_items")
    .select("project_id, status, due_date, probability, severity, type, impact, priority")
    .in("project_id", projectIds)
    .limit(20000);

  // Filter in code — case-insensitive
  const CLOSED = ["closed", "invalid", "resolved", "done", "completed", "cancelled", "canceled"];
  const rows = Array.isArray(data)
    ? data.filter((r: any) => {
        const st = String(r?.status || "").toLowerCase();
        return !CLOSED.some((k) => st.includes(k));
      })
    : [];

  return { ok: !error, rows };
}

async function fetchPortfolioBudget(
  supabase: any,
  projectIds: string[],
): Promise<Map<string, { budgetAmount: number | null; spentAmount: number }>> {
  const [budgetResult, spendResult, artResult] = await Promise.allSettled([
    supabase.from("projects").select("id, budget_amount, resource_status, status").in("id", projectIds).limit(20000),
    supabase.from("project_spend").select("project_id, amount").in("project_id", projectIds).is("deleted_at", null).limit(100000),
    // Fetch financial plan cost_lines for fallback spend (covers licence fees etc.)
    supabase.from("artifacts").select("project_id, content_json").in("project_id", projectIds).eq("type", "FINANCIAL_PLAN").eq("is_current", true).limit(1000),
  ]);

  const budgetRows: any[] = budgetResult.status === "fulfilled" ? budgetResult.value.data ?? [] : [];
  const spendRows:  any[] = spendResult.status  === "fulfilled" ? spendResult.value.data  ?? [] : [];
  const artRows:    any[] = artResult.status     === "fulfilled" ? artResult.value.data    ?? [] : [];

  // Primary spend: project_spend table
  const spentByProject = new Map<string, number>();
  for (const row of spendRows) {
    const pid = String(row.project_id);
    spentByProject.set(pid, (spentByProject.get(pid) ?? 0) + Number(row.amount ?? 0));
  }

  // Fallback spend: sum cost_lines[].actual from financial plan artifact
  const artSpentByProject = new Map<string, number>();
  for (const art of artRows) {
    const pid = String(art.project_id);
    const lines = Array.isArray(art.content_json?.cost_lines) ? art.content_json.cost_lines : [];
    const lineTotal = lines.reduce((sum: number, line: any) => {
      const actual = Number(line?.actual ?? 0);
      return sum + (Number.isFinite(actual) && actual > 0 ? actual : 0);
    }, 0);
    if (lineTotal > 0) artSpentByProject.set(pid, (artSpentByProject.get(pid) ?? 0) + lineTotal);
  }

  const result = new Map<string, { budgetAmount: number | null; spentAmount: number }>();
  for (const p of budgetRows) {
    const pid = String(p.id);
    const dbSpend = spentByProject.get(pid) ?? 0;
    const artSpend = artSpentByProject.get(pid) ?? 0;
    result.set(pid, {
      budgetAmount: p.budget_amount != null ? Number(p.budget_amount) : null,
      spentAmount:  dbSpend > 0 ? dbSpend : artSpend,
    });
  }
  for (const pid of projectIds) {
    if (!result.has(pid)) {
      const dbSpend = spentByProject.get(pid) ?? 0;
      const artSpend = artSpentByProject.get(pid) ?? 0;
      result.set(pid, { budgetAmount: null, spentAmount: dbSpend > 0 ? dbSpend : artSpend });
    }
  }
  return result;
}

async function fetchPortfolioGovernance(supabase: any, projectIds: string[]) {
  const CHARTER_TYPES    = ["PROJECT_CHARTER", "CHARTER"];
  const FINANCIAL_TYPES  = ["FINANCIAL_PLAN"];
  const STAKEHOLDER_TYPES = ["STAKEHOLDER_REGISTER", "STAKEHOLDERS"];

  const [approvalsRes, changeReqsRes, artifactsRes, projectsRes, gatesRes] = await Promise.allSettled([
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
    supabase
      .from("artifacts")
      .select("project_id, artifact_type, type, status, is_current")
      .in("project_id", projectIds)
      .eq("is_current", true)
      .limit(50000),
    supabase
      .from("projects")
      .select("id, finish_date, lifecycle_status, budget_days")
      .in("id", projectIds)
      .limit(20000),
    supabase
      .from("project_gates")
      .select("project_id, gate_number, status, passed_at")
      .in("project_id", projectIds)
      .limit(50000),
  ]);

  const approvals:  any[] = approvalsRes.status  === "fulfilled" ? approvalsRes.value.data  ?? [] : [];
  const changeReqs: any[] = changeReqsRes.status === "fulfilled" ? changeReqsRes.value.data ?? [] : [];
  const artifacts:  any[] = artifactsRes.status  === "fulfilled" ? artifactsRes.value.data  ?? [] : [];
  const projects:   any[] = projectsRes.status   === "fulfilled" ? projectsRes.value.data   ?? [] : [];
  const gates:      any[] = (gatesRes as any).status === "fulfilled" ? (gatesRes as any).value.data ?? [] : [];

  const openStatuses = new Set(["pending", "open", "submitted", "draft"]);
  const approvedStatuses = new Set(["approved", "active", "current", "published", "signed_off", "signed off"]);

  const canonType = (a: any) => String(a?.artifact_type || a?.type || "").toUpperCase().trim();

  // Per-project governance flags
  const byProject = new Map<string, {
    charterApproved:            boolean;
    budgetApproved:             boolean;
    stakeholderRegisterPresent: boolean;
    gate1Complete:              boolean;
    gate5Applicable:            boolean;
    gate5Ready:                 boolean;
    pendingApprovals:           number;
    openCRs:                    number;
    budgetDays:                 number | null;
  }>();

  const today = ymd(new Date());
  const sixtyDaysFromNow = ymd(new Date(Date.now() + 60 * 86400000));

  for (const pid of projectIds) {
    const proj     = projects.find((p: any) => String(p.id) === pid);
    const endDate  = proj?.finish_date ? String(proj.finish_date).slice(0, 10) : null;
    const gate5Applicable = !!(endDate && endDate <= sixtyDaysFromNow && endDate >= today);
    const gate1Row = gates.find((g: any) => String(g.project_id) === pid && Number(g.gate_number) === 1);
    const gate1Complete = !!(gate1Row?.passed_at || gate1Row?.status === "passed" || gate1Row?.status === "complete");
    const gate5Row = gates.find((g: any) => String(g.project_id) === pid && Number(g.gate_number) === 5);
    const gate5Ready = !!(gate5Row?.passed_at || gate5Row?.status === "passed");

    byProject.set(pid, {
      charterApproved:            false,
      budgetApproved:             false,
      stakeholderRegisterPresent: false,
      gate1Complete,
      gate5Applicable,
      gate5Ready,
      pendingApprovals:           0,
      openCRs:                    0,
      budgetDays:                 proj?.budget_days != null ? Number(proj.budget_days) : null,
    });
  }

  // Artifacts
  for (const a of artifacts) {
    const pid  = String(a.project_id);
    const rec  = byProject.get(pid);
    if (!rec) continue;
    const ct   = canonType(a);
    const stat = String(a.status || "").toLowerCase().replace(/\s+/g, "_");
    const isApproved = approvedStatuses.has(stat) || stat.includes("approv") || stat.includes("publish");

    if (CHARTER_TYPES.includes(ct)    && isApproved) rec.charterApproved            = true;
    if (FINANCIAL_TYPES.includes(ct)  && isApproved) rec.budgetApproved             = true;
    // Stakeholder register counts as present even if draft
    if (STAKEHOLDER_TYPES.includes(ct))              rec.stakeholderRegisterPresent = true;
  }

  // Pending approvals
  for (const a of approvals) {
    const rec = byProject.get(String(a.project_id));
    if (rec) rec.pendingApprovals++;
  }

  // Open CRs
  for (const c of changeReqs) {
    if (openStatuses.has(String(c.status ?? "").toLowerCase())) {
      const rec = byProject.get(String(c.project_id));
      if (rec) rec.openCRs++;
    }
  }

  return byProject;
}

/* ─── portfolio scorer ─── */

export async function computePortfolioHealth(
  supabase:    any,
  projectIds:  string[],
  windowDays:  number,
): Promise<{
  score:        number | null;
  parts:        HealthParts;
  projectCount: number;
  perProject:   Record<string, HealthResult>;
}> {
  if (!projectIds.length) {
    return {
      score: null,
      parts: { schedule: null, raid: null, budget: null, governance: null },
      projectCount: 0,
      perProject: {},
    };
  }

  // Exclude pipeline projects from health scoring
  const { data: projectMeta } = await supabase
    .from("projects")
    .select("id, resource_status, status")
    .in("id", projectIds)
    .limit(20000);

  const activeIds = projectIds.filter((pid) => {
    const p = Array.isArray(projectMeta) ? projectMeta.find((r: any) => String(r.id) === pid) : null;
    // Exclude if resource_status OR status is "pipeline"
    const resourceStatus = String(p?.resource_status ?? "").toLowerCase();
    const status = String(p?.status ?? "").toLowerCase();
    return resourceStatus !== "pipeline" && status !== "pipeline";
  });

  if (!activeIds.length) {
    return {
      score: null,
      parts: { schedule: null, raid: null, budget: null, governance: null },
      projectCount: 0,
      perProject: {},
    };
  }

  const today = ymd(new Date());

  const [milestonesRes, raidRes, budgetMap, govMap] = await Promise.all([
    fetchPortfolioMilestones(supabase, activeIds),
    fetchPortfolioRaid(supabase, activeIds),
    fetchPortfolioBudget(supabase, activeIds),
    fetchPortfolioGovernance(supabase, activeIds),
  ]);

  // Group by project
  const milestonesByProject = new Map<string, any[]>();
  const raidByProject       = new Map<string, any[]>();

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

  // Score each project
  const perProject: Record<string, HealthResult> = {};

  for (const pid of activeIds) {
    const budget = budgetMap.get(pid) ?? { budgetAmount: null, spentAmount: 0 };
    const gov    = govMap.get(pid);

    perProject[pid] = computeHealthFromData({
      milestones:                 milestonesByProject.get(pid) ?? [],
      raidItems:                  raidByProject.get(pid) ?? [],
      budgetAmount:               budget.budgetAmount,
      spentAmount:                budget.spentAmount,
      budgetDays:                 gov?.budgetDays ?? null,
      pendingApprovalCount:       gov?.pendingApprovals ?? 0,
      openChangeRequests:         gov?.openCRs ?? 0,
      charterApproved:            gov?.charterApproved            ?? false,
      budgetApproved:             gov?.budgetApproved             ?? false,
      stakeholderRegisterPresent: gov?.stakeholderRegisterPresent ?? false,
      gate1Complete:              gov?.gate1Complete              ?? false,
      gate5Applicable:            gov?.gate5Applicable            ?? false,
      gate5Ready:                 gov?.gate5Ready                 ?? false,
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
    const vals = scoredProjects.map((r) => r.parts[key]).filter((v) => v != null) as number[];
    if (!vals.length) return null;
    return clamp(vals.reduce((s, v) => s + v, 0) / vals.length);
  };

  return {
    score: clamp(scoredProjects.reduce((s, r) => s + r.score!, 0) / scoredProjects.length),
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