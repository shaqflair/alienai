import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PremortemSignals = {
  project: {
    id: string;
    code: string | null;
    title: string;
    status: string | null;
    finishDate: string | null;
  };
  completeness: {
    milestones: boolean;
    raid: boolean;
    approvals: boolean;
    financials: boolean;
    recentArtifacts: boolean;
  };
  schedule: {
    overdueCriticalCount: number;
    overdueCount: number;
    avgSlipDays: number | null;
    dueSoonAtRiskCount: number;
    stagnatingCount: number;
  };
  governance: {
    pendingApprovalCount: number;
    overdueApprovalCount: number;
    stuckChangeCount: number;
    missingMandatoryArtifactCount: number;
    staleWeeklyReport: boolean;
    gateGapCount: number;
  };
  budget: {
    approvedBudget: number | null;
    actualSpend: number | null;
    forecastSpend: number | null;
    variancePct: number | null;
    unapprovedChangeValue: number;
    financialPlanApproved: boolean;
  };
  stability: {
    unresolvedIssueCount: number;
    overdueRaidCount: number;
    risingIssueTrend: boolean;
    lowRecentActivity: boolean;
    contradictoryStatus: boolean;
  };
  evidence: Array<{
    ref: string;
    type: string;
    label: string;
    href?: string;
    meta?: Record<string, any>;
  }>;
};

function safeNum(x: any): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function safeStr(x: any): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function daysBetween(a: string, b: Date = new Date()): number {
  const d = new Date(a);
  if (isNaN(d.getTime())) return 0;
  return Math.round((b.getTime() - d.getTime()) / 86400000);
}

export async function buildPremortemSignals(
  supabase: SupabaseClient,
  projectId: string,
  windowDays = 30
): Promise<PremortemSignals> {
  const now    = new Date();
  const today  = now.toISOString().slice(0, 10);
  const plus14 = new Date(now.getTime() + 14 * 86400000).toISOString().slice(0, 10);
  const minus30 = new Date(now.getTime() - 30 * 86400000).toISOString();
  const evidence: PremortemSignals["evidence"] = [];

  /* ── Project core ─────────────────────────────────────────────── */
  const { data: proj } = await supabase
    .from("projects")
    .select("id, title, project_code, status, resource_status, target_end_date, end_date")
    .eq("id", projectId)
    .maybeSingle();

  const projectSignal: PremortemSignals["project"] = {
    id:         projectId,
    code:       safeStr(proj?.project_code) || null,
    title:      safeStr(proj?.title) || "Project",
    status:     safeStr(proj?.status) || null,
    finishDate: safeStr(proj?.target_end_date || proj?.end_date) || null,
  };

  /* ── Milestones ───────────────────────────────────────────────── */
  const { data: milestones } = await supabase
    .from("milestones")
    .select("id, title, due_date, status, is_critical, baseline_date, completion_date")
    .eq("project_id", projectId);

  const ms = milestones ?? [];
  const activeMilestones = ms.filter(m =>
    !["completed", "done", "cancelled", "closed"].includes(safeStr(m.status).toLowerCase())
  );
  const overdueCritical = activeMilestones.filter(m =>
    m.is_critical && m.due_date && m.due_date < today
  );
  const overdueAll = activeMilestones.filter(m => m.due_date && m.due_date < today);
  const dueSoonAtRisk = activeMilestones.filter(m =>
    m.due_date && m.due_date >= today && m.due_date <= plus14
  );
  const slips = ms
    .filter(m => m.baseline_date && m.due_date && m.due_date > m.baseline_date)
    .map(m => daysBetween(m.baseline_date, new Date(m.due_date)));
  const avgSlipDays = slips.length ? Math.round(slips.reduce((a, b) => a + b, 0) / slips.length) : null;

  if (overdueCritical.length > 0) {
    overdueCritical.slice(0, 3).forEach(m => {
      evidence.push({
        ref: `milestone:${m.id}`,
        type: "milestone",
        label: `Critical milestone overdue: ${m.title}`,
        meta: { due_date: m.due_date, days_overdue: daysBetween(m.due_date) },
      });
    });
  }

  const schedule: PremortemSignals["schedule"] = {
    overdueCriticalCount: overdueCritical.length,
    overdueCount:         overdueAll.length,
    avgSlipDays,
    dueSoonAtRiskCount:   dueSoonAtRisk.length,
    stagnatingCount:      activeMilestones.filter(m => !m.completion_date && daysBetween(safeStr(m.due_date)) > 7).length,
  };

  /* ── RAID ─────────────────────────────────────────────────────── */
  const { data: raidItems } = await supabase
    .from("raid_items")
    .select("id, title, type, severity, status, due_date, created_at, updated_at")
    .eq("project_id", projectId)
    .not("status", "in", '("closed","resolved","done","cancelled")');

  const raid = raidItems ?? [];
  const overdueRaid = raid.filter(r => r.due_date && r.due_date < today);
  const highSeverity = raid.filter(r =>
    ["high", "critical", "very_high"].includes(safeStr(r.severity).toLowerCase())
  );
  const recentRaid30 = raid.filter(r => safeStr(r.created_at) > minus30);
  const { count: prevRaidCount } = await supabase
    .from("raid_items")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .gte("created_at", new Date(now.getTime() - 60 * 86400000).toISOString())
    .lt("created_at", minus30);
  const risingIssueTrend = recentRaid30.length > 0 && recentRaid30.length > (prevRaidCount ?? 0);

  if (highSeverity.length > 0) {
    highSeverity.slice(0, 2).forEach(r => {
      evidence.push({
        ref: `raid:${r.id}`, type: "raid",
        label: `High severity ${r.type ?? "item"}: ${r.title}`,
        meta: { severity: r.severity, status: r.status },
      });
    });
  }

  const stability: PremortemSignals["stability"] = {
    unresolvedIssueCount: raid.filter(r => safeStr(r.type).toLowerCase() === "issue").length,
    overdueRaidCount:     overdueRaid.length,
    risingIssueTrend,
    lowRecentActivity:    false, // set below
    contradictoryStatus:  false, // set below
  };

  /* ── Governance / Approvals ───────────────────────────────────── */
  const { data: pendingSteps } = await supabase
    .from("artifact_approval_steps")
    .select("id, artifact_id, created_at, status")
    .eq("status", "pending");

  const pendingStepIds = (pendingSteps ?? []).map((s: any) => safeStr(s.artifact_id));
  let projectPendingSteps: any[] = [];
  if (pendingStepIds.length) {
    const { data: projArts } = await supabase
      .from("artifacts")
      .select("id")
      .eq("project_id", projectId)
      .in("id", pendingStepIds);
    const projArtIds = new Set((projArts ?? []).map((a: any) => safeStr(a.id)));
    projectPendingSteps = (pendingSteps ?? []).filter((s: any) => projArtIds.has(safeStr(s.artifact_id)));
  }

  const overdueApprovals = projectPendingSteps.filter(s =>
    daysBetween(safeStr(s.created_at)) > 7
  );

  const { data: stuckCRs } = await supabase
    .from("change_requests")
    .select("id, title, decision_status, created_at, ai_cost")
    .eq("project_id", projectId)
    .eq("decision_status", "submitted");

  const stuckChanges = (stuckCRs ?? []).filter(cr => daysBetween(safeStr(cr.created_at)) > 5);

  const mandatoryTypes = ["PROJECT_CHARTER", "CHARTER", "FINANCIAL_PLAN", "STAKEHOLDER_REGISTER", "STAKEHOLDERS"];
  const { data: approvedArts } = await supabase
    .from("artifacts")
    .select("type, approval_status")
    .eq("project_id", projectId)
    .in("type", mandatoryTypes);

  const approvedSet = new Set((approvedArts ?? [])
    .filter((a: any) => {
      const st = safeStr(a.approval_status || a.status).toLowerCase().replace(/\s+/g, "_");
      return st === "approved" || st === "baselined" || st === "active" || st === "current" ||
             st.includes("approv") || st.includes("publish");
    })
    .map((a: any) => safeStr(a.type)));
  const missingMandatoryCount = mandatoryTypes.filter(t => !approvedSet.has(t)).length;

  const { data: recentArtifact } = await supabase
    .from("artifacts")
    .select("id, updated_at")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastArtifactAge = recentArtifact?.updated_at
    ? daysBetween(safeStr(recentArtifact.updated_at))
    : 999;
  const staleWeeklyReport = lastArtifactAge > 14;

  if (overdueApprovals.length > 0) {
    evidence.push({
      ref: `approval:overdue`, type: "approval",
      label: `${overdueApprovals.length} approval step(s) pending > 7 days`,
      meta: { count: overdueApprovals.length },
    });
  }
  if (stuckChanges.length > 0) {
    stuckChanges.slice(0, 2).forEach(cr => {
      evidence.push({
        ref: `change:${cr.id}`, type: "change_request",
        label: `Change request stuck in review: ${cr.title}`,
        meta: { days_stuck: daysBetween(safeStr(cr.created_at)), cost: cr.ai_cost },
      });
    });
  }

  const governance: PremortemSignals["governance"] = {
    pendingApprovalCount:           projectPendingSteps.length,
    overdueApprovalCount:           overdueApprovals.length,
    stuckChangeCount:               stuckChanges.length,
    missingMandatoryArtifactCount:  missingMandatoryCount,
    staleWeeklyReport,
    gateGapCount:                   missingMandatoryCount,
  };

  /* ── Budget / Financial ───────────────────────────────────────── */
  const { data: fpArt } = await supabase
    .from("artifacts")
    .select("content_json, approval_status")
    .eq("project_id", projectId)
    .eq("type", "financial_plan")
    .eq("is_current", true)
    .maybeSingle();

  const fpContent   = (fpArt?.content_json as any) ?? {};
  const costLines   = Array.isArray(fpContent.cost_lines) ? fpContent.cost_lines : [];
  const changeExp   = Array.isArray(fpContent.change_exposure) ? fpContent.change_exposure : [];
  const approvedBudget  = safeNum(fpContent.total_approved_budget) || null;
  const totalForecast   = costLines.reduce((s: number, l: any) => s + safeNum(l.forecast), 0) || null;
  const totalActual     = costLines.reduce((s: number, l: any) => s + safeNum(l.actual), 0) || null;
  const variancePct     = approvedBudget && totalForecast
    ? ((totalForecast - approvedBudget) / approvedBudget) * 100
    : null;
  const unapprovedChangeValue = changeExp
    .filter((c: any) => c.status === "pending")
    .reduce((s: number, c: any) => s + safeNum(c.cost_impact), 0);
  const fpApproved = ["approved", "baselined"].includes(safeStr(fpArt?.approval_status).toLowerCase());

  if (variancePct !== null && variancePct > 10) {
    evidence.push({
      ref: "budget:variance", type: "financial",
      label: `Forecast exceeds approved budget by ${variancePct.toFixed(1)}%`,
      meta: { approved: approvedBudget, forecast: totalForecast, variance_pct: variancePct },
    });
  }
  if (unapprovedChangeValue > 0) {
    evidence.push({
      ref: "budget:unapproved_cr", type: "financial",
      label: `£${Math.round(unapprovedChangeValue).toLocaleString()} unapproved change exposure`,
      meta: { value: unapprovedChangeValue },
    });
  }

  const budget: PremortemSignals["budget"] = {
    approvedBudget,
    actualSpend:        totalActual,
    forecastSpend:      totalForecast,
    variancePct:        variancePct !== null ? Math.round(variancePct * 10) / 10 : null,
    unapprovedChangeValue,
    financialPlanApproved: fpApproved,
  };

  /* ── Stability — activity + contradictory status ──────────────── */
  const { data: recentEvents } = await supabase
    .from("project_events")
    .select("id")
    .eq("project_id", projectId)
    .gte("created_at", minus30)
    .limit(5);

  const lowRecentActivity = !recentEvents || recentEvents.length < 2;

  const declaredStatus = safeStr(proj?.status).toLowerCase();
  const isGreen = declaredStatus === "green" || declaredStatus === "on_track" || declaredStatus === "g";
  const worseningEvidence = overdueCritical.length > 0 || overdueApprovals.length > 1 || overdueRaid.length > 2;
  const contradictoryStatus = isGreen && worseningEvidence;

  if (contradictoryStatus) {
    evidence.push({
      ref: "status:false_green", type: "status",
      label: "Project declared green/on-track but worsening operational signals detected",
      meta: { declared_status: proj?.status, overdue_critical: overdueCritical.length },
    });
  }

  stability.lowRecentActivity  = lowRecentActivity;
  stability.contradictoryStatus = contradictoryStatus;

  /* ── Completeness ─────────────────────────────────────────────── */
  const completeness: PremortemSignals["completeness"] = {
    milestones:      ms.length >= 2,
    raid:            raid.length >= 1,
    approvals:       projectPendingSteps.length >= 0,
    financials:      !!fpArt,
    recentArtifacts: lastArtifactAge < 30,
  };

  return {
    project: projectSignal,
    completeness,
    schedule,
    governance,
    budget,
    stability,
    evidence,
  };
}