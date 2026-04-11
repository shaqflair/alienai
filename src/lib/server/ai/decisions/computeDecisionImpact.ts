import "server-only";
import type { PremortemSignals } from "@/lib/server/ai/premortem/buildPremortemSignals";
import type { PremortemScore }   from "@/lib/server/ai/premortem/scorePremortem";

export type DecisionAction = {
  id:               string;
  priority:         "critical" | "high" | "medium";
  action:           string;
  rationale:        string;
  ownerHint:        string;
  pillar:           "schedule" | "governance" | "budget" | "stability";
  currentScore:    number;   // pillar score now
  resolvedScore:   number;   // pillar score if resolved
  scoreImprovement: number; // composite score delta
  riskReductionPct: number; // % reduction in overall failure risk
  effort:           "immediate" | "short_term" | "medium_term";
  evidenceRefs:    string[];
  consequence:     string;   // what happens if ignored
};

export type DecisionImpactResult = {
  currentFailureRisk:  number;
  decisions:            DecisionAction[];
  worstCase:            WhatIfScenario;
  bestCase:             WhatIfScenario;
  generatedAt:          string;
};

export type WhatIfScenario = {
  label:          string;
  description:    string;
  projectedScore: number;
  projectedBand:  string;
  keyAssumptions: string[];
};

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function riskBand(score: number): string {
  if (score >= 75) return "Critical";
  if (score >= 50) return "High";
  if (score >= 25) return "Moderate";
  return "Low";
}

// Given current pillar scores, compute composite
function composite(s: number, g: number, b: number, st: number): number {
  return clamp(0.35 * s + 0.25 * g + 0.20 * b + 0.20 * st);
}

export function computeDecisionImpact(
  signals:  PremortemSignals,
  score:    PremortemScore,
): DecisionImpactResult {
  const now      = new Date().toISOString();
  const decisions: DecisionAction[] = [];
  const { pillars } = score;
  const current = score.failureRiskScore;

  // ── Schedule decisions ─────────────────────────────────────────────────
  if (signals.schedule.overdueCriticalCount > 0) {
    const resolvedSchedule = clamp(pillars.schedule - signals.schedule.overdueCriticalCount * 18);
    const delta = composite(resolvedSchedule, pillars.governance, pillars.budget, pillars.stability) - current;
    decisions.push({
      id: "resolve_critical_milestones",
      priority: "critical",
      action: `Convene critical-path milestone recovery review within 48 hours`,
      rationale: `${signals.schedule.overdueCriticalCount} critical milestone${signals.schedule.overdueCriticalCount !== 1 ? "s" : ""} are overdue — the single highest-weight driver in the failure risk model.`,
      ownerHint: "PM / Delivery Lead",
      pillar: "schedule",
      currentScore:    pillars.schedule,
      resolvedScore:   resolvedSchedule,
      scoreImprovement: Math.abs(delta),
      riskReductionPct: current > 0 ? Math.round((Math.abs(delta) / current) * 100) : 0,
      effort: "immediate",
      evidenceRefs: ["milestone:overdue_critical"],
      consequence: `Without action: delivery delay risk compounds at ~2× rate per week of critical-path slip.`,
    });
  }

  if (signals.schedule.overdueCount > 0 && signals.schedule.overdueCriticalCount === 0) {
    const resolvedSchedule = clamp(pillars.schedule - signals.schedule.overdueCount * 7);
    const delta = composite(resolvedSchedule, pillars.governance, pillars.budget, pillars.stability) - current;
    decisions.push({
      id: "resolve_overdue_milestones",
      priority: "high",
      action: `Triage ${signals.schedule.overdueCount} overdue milestone${signals.schedule.overdueCount !== 1 ? "s" : ""} and assign recovery owners`,
      rationale: `Non-critical milestones slipping increases structural delivery risk and reduces team confidence.`,
      ownerHint: "PM",
      pillar: "schedule",
      currentScore:    pillars.schedule,
      resolvedScore:   resolvedSchedule,
      scoreImprovement: Math.abs(delta),
      riskReductionPct: current > 0 ? Math.round((Math.abs(delta) / current) * 100) : 0,
      effort: "short_term",
      evidenceRefs: [],
      consequence: `Non-critical slippage often escalates to critical-path impact within 2–3 weeks if unaddressed.`,
    });
  }

  if ((signals.schedule.avgSlipDays ?? 0) > 14) {
    const slipPenalty  = Math.min(30, (signals.schedule.avgSlipDays ?? 0) * 1.2);
    const resolvedSchedule = clamp(pillars.schedule - slipPenalty * 0.6);
    const delta = composite(resolvedSchedule, pillars.governance, pillars.budget, pillars.stability) - current;
    decisions.push({
      id: "rebaseline_schedule",
      priority: "high",
      action: `Rebaseline the milestone plan — average slip of ${signals.schedule.avgSlipDays} days suggests structural drift`,
      rationale: `Milestones consistently slipping vs baseline indicates planning assumptions are no longer valid.`,
      ownerHint: "PM / Sponsor",
      pillar: "schedule",
      currentScore:    pillars.schedule,
      resolvedScore:   resolvedSchedule,
      scoreImprovement: Math.abs(delta),
      riskReductionPct: current > 0 ? Math.round((Math.abs(delta) / current) * 100) : 0,
      effort: "short_term",
      evidenceRefs: [],
      consequence: `Continuing against an invalid baseline means all downstream planning and reporting is misleading.`,
    });
  }

  // ── Governance decisions ───────────────────────────────────────────────
  if (signals.governance.overdueApprovalCount > 0) {
    const resolvedGov = clamp(pillars.governance - signals.governance.overdueApprovalCount * 13);
    const delta = composite(pillars.schedule, resolvedGov, pillars.budget, pillars.stability) - current;
    decisions.push({
      id: "clear_approval_backlog",
      priority: signals.governance.overdueApprovalCount >= 3 ? "critical" : "high",
      action: `Clear ${signals.governance.overdueApprovalCount} overdue approval${signals.governance.overdueApprovalCount !== 1 ? "s" : ""} — escalate to approvers within 24 hours`,
      rationale: `Approvals overdue SLA are blocking delivery decisions. Each day of latency compounds downstream delay.`,
      ownerHint: "Approvers / PMO Lead",
      pillar: "governance",
      currentScore:    pillars.governance,
      resolvedScore:   resolvedGov,
      scoreImprovement: Math.abs(delta),
      riskReductionPct: current > 0 ? Math.round((Math.abs(delta) / current) * 100) : 0,
      effort: "immediate",
      evidenceRefs: ["approval:overdue"],
      consequence: `Blocked approvals prevent scope, cost, and resource decisions — cascading delay across all dependent workstreams.`,
    });
  }

  if (signals.governance.missingMandatoryArtifactCount > 0) {
    const resolvedGov = clamp(pillars.governance - signals.governance.missingMandatoryArtifactCount * 13);
    const delta = composite(pillars.schedule, resolvedGov, pillars.budget, pillars.stability) - current;
    decisions.push({
      id: "approve_mandatory_artifacts",
      priority: "high",
      action: `Progress ${signals.governance.missingMandatoryArtifactCount} mandatory governance artifact${signals.governance.missingMandatoryArtifactCount !== 1 ? "s" : ""} to approved status`,
      rationale: `Unapproved charter, financial plan, or stakeholder register leaves the project without baselined controls.`,
      ownerHint: "PM / Governance Lead",
      pillar: "governance",
      currentScore:    pillars.governance,
      resolvedScore:   resolvedGov,
      scoreImprovement: Math.abs(delta),
      riskReductionPct: current > 0 ? Math.round((Math.abs(delta) / current) * 100) : 0,
      effort: "short_term",
      evidenceRefs: [],
      consequence: `Without approved baseline artifacts, change control and scope governance have no foundation to operate from.`,
    });
  }

  if (signals.governance.stuckChangeCount > 0) {
    const resolvedGov = clamp(pillars.governance - signals.governance.stuckChangeCount * 10);
    const delta = composite(pillars.schedule, resolvedGov, pillars.budget, pillars.stability) - current;
    decisions.push({
      id: "unblock_change_requests",
      priority: "medium",
      action: `Decision required on ${signals.governance.stuckChangeCount} change request${signals.governance.stuckChangeCount !== 1 ? "s" : ""} stuck in review for 5+ days`,
      rationale: `Stalled change requests create budget and scope uncertainty that prevents effective delivery planning.`,
      ownerHint: "Commercial Lead / Sponsor",
      pillar: "governance",
      currentScore:    pillars.governance,
      resolvedScore:   resolvedGov,
      scoreImprovement: Math.abs(delta),
      riskReductionPct: current > 0 ? Math.round((Math.abs(delta) / current) * 100) : 0,
      effort: "short_term",
      evidenceRefs: [],
      consequence: `Unresolved CRs accumulate as hidden financial exposure and create team uncertainty about scope.`,
    });
  }

  // ── Budget decisions ───────────────────────────────────────────────────
  if (!signals.budget.financialPlanApproved) {
    const resolvedBudget = clamp(pillars.budget - 22);
    const delta = composite(pillars.schedule, pillars.governance, resolvedBudget, pillars.stability) - current;
    decisions.push({
      id: "approve_financial_plan",
      priority: "high",
      action: `Obtain approval for the financial plan to baseline budget controls`,
      rationale: `Without an approved financial plan, there are no baselined cost controls or change governance mechanisms.`,
      ownerHint: "Commercial Lead / Sponsor",
      pillar: "budget",
      currentScore:    pillars.budget,
      resolvedScore:   resolvedBudget,
      scoreImprovement: Math.abs(delta),
      riskReductionPct: current > 0 ? Math.round((Math.abs(delta) / current) * 100) : 0,
      effort: "short_term",
      evidenceRefs: [],
      consequence: `Budget overruns cannot be formally controlled or escalated without an approved baseline.`,
    });
  }

  if ((signals.budget.variancePct ?? 0) > 10) {
    const resolvedBudget = clamp(pillars.budget - Math.min(40, (signals.budget.variancePct ?? 0) * 1.5));
    const delta = composite(pillars.schedule, pillars.governance, resolvedBudget, pillars.stability) - current;
    decisions.push({
      id: "address_budget_variance",
      priority: (signals.budget.variancePct ?? 0) > 25 ? "critical" : "high",
      action: `Review and explain forecast variance of ${signals.budget.variancePct?.toFixed(1)}% above approved budget`,
      rationale: `Forecast materially exceeds approved ceiling — either the plan needs revision or a change request is required.`,
      ownerHint: "Commercial Lead / PM",
      pillar: "budget",
      currentScore:    pillars.budget,
      resolvedScore:   resolvedBudget,
      scoreImprovement: Math.abs(delta),
      riskReductionPct: current > 0 ? Math.round((Math.abs(delta) / current) * 100) : 0,
      effort: "short_term",
      evidenceRefs: ["budget:variance"],
      consequence: `Unresolved forecast overrun will trigger budget breach and may require emergency board approval.`,
    });
  }

  if (signals.budget.unapprovedChangeValue > 0) {
    const approvedBudgetRef = signals.budget.approvedBudget ?? 100000;
    const exposurePct = (signals.budget.unapprovedChangeValue / approvedBudgetRef) * 100;
    if (exposurePct > 8) {
      const resolvedBudget = clamp(pillars.budget - Math.min(30, exposurePct * 1.2));
      const delta = composite(pillars.schedule, pillars.governance, resolvedBudget, pillars.stability) - current;
      decisions.push({
        id: "resolve_change_exposure",
        priority: exposurePct > 20 ? "critical" : "medium",
        action: `Decision required on £${Math.round(signals.budget.unapprovedChangeValue).toLocaleString()} of unapproved change exposure`,
        rationale: `Pending change exposure (${exposurePct.toFixed(1)}% of approved budget) creates financial uncertainty that prevents accurate forecasting.`,
        ownerHint: "Sponsor / Commercial Lead",
        pillar: "budget",
        currentScore:    pillars.budget,
        resolvedScore:   resolvedBudget,
        scoreImprovement: Math.abs(delta),
        riskReductionPct: current > 0 ? Math.round((Math.abs(delta) / current) * 100) : 0,
        effort: "short_term",
        evidenceRefs: ["budget:unapproved_cr"],
        consequence: `Exposure approved late typically inflates final cost by 15–20% due to compressed delivery adjustments.`,
      });
    }
  }

  // ── Stability decisions ────────────────────────────────────────────────
  if (signals.stability.contradictoryStatus) {
    const resolvedStab = clamp(pillars.stability - 25);
    const delta = composite(pillars.schedule, pillars.governance, pillars.budget, resolvedStab) - current;
    decisions.push({
      id: "correct_status_reporting",
      priority: "critical",
      action: `Update formal project status to reflect operational evidence — current status is misleading`,
      rationale: `Declared status contradicts delivery signals. False-green reporting prevents timely executive intervention.`,
      ownerHint: "PM / Sponsor",
      pillar: "stability",
      currentScore:    pillars.stability,
      resolvedScore:   resolvedStab,
      scoreImprovement: Math.abs(delta),
      riskReductionPct: current > 0 ? Math.round((Math.abs(delta) / current) * 100) : 0,
      effort: "immediate",
      evidenceRefs: ["status:false_green"],
      consequence: `Leadership cannot intervene if they believe delivery is healthy. False-green is the most dangerous governance failure mode.`,
    });
  }

  if (signals.stability.unresolvedIssueCount >= 3) {
    const penalty = Math.min(32, signals.stability.unresolvedIssueCount * 7);
    const resolvedStab = clamp(pillars.stability - penalty * 0.7);
    const delta = composite(pillars.schedule, pillars.governance, pillars.budget, resolvedStab) - current;
    decisions.push({
      id: "resolve_open_issues",
      priority: "high",
      action: `Assign resolution owners to ${signals.stability.unresolvedIssueCount} open delivery issues with target close dates`,
      rationale: `Unresolved issues without owners compound — delivery friction increases non-linearly with backlog size.`,
      ownerHint: "PM / Team Leads",
      pillar: "stability",
      currentScore:    pillars.stability,
      resolvedScore:   resolvedStab,
      scoreImprovement: Math.abs(delta),
      riskReductionPct: current > 0 ? Math.round((Math.abs(delta) / current) * 100) : 0,
      effort: "short_term",
      evidenceRefs: [],
      consequence: `Issue backlogs older than 3 weeks typically indicate systemic delivery problems, not isolated incidents.`,
    });
  }

  // Sort by score improvement descending
  decisions.sort((a, b) => b.scoreImprovement - a.scoreImprovement);

  // ── What-if scenarios ──────────────────────────────────────────────────
  const worstCaseScore = clamp(current + 15);
  const bestCaseScore  = decisions.length > 0
    ? clamp(current - decisions.slice(0, 3).reduce((s, d) => s + d.scoreImprovement, 0))
    : clamp(current - 10);

  const worstCase: WhatIfScenario = {
    label:          "If nothing changes",
    description:    "No actions taken. Current trajectory continues.",
    projectedScore: worstCaseScore,
    projectedBand:  riskBand(worstCaseScore),
    keyAssumptions: [
      "Overdue milestones continue to slip",
      "Approval backlog remains uncleared",
      "No governance interventions",
    ].filter((_, i) => {
      if (i === 0) return signals.schedule.overdueCount > 0;
      if (i === 1) return signals.governance.overdueApprovalCount > 0;
      return true;
    }),
  };

  const bestCase: WhatIfScenario = {
    label:          "If top 3 actions taken",
    description:    "Highest-impact decisions executed within 48 hours.",
    projectedScore: bestCaseScore,
    projectedBand:  riskBand(bestCaseScore),
    keyAssumptions: decisions.slice(0, 3).map(d => d.action.slice(0, 60) + (d.action.length > 60 ? "…" : "")),
  };

  return {
    currentFailureRisk: current,
    decisions: decisions.slice(0, 6),
    worstCase,
    bestCase,
    generatedAt: now,
  };
}