import "server-only";
import type { PremortemSignals } from "@/lib/server/ai/premortem/buildPremortemSignals";
import type { PremortemScore }   from "@/lib/server/ai/premortem/scorePremortem";

export type TruthStatus = "green" | "amber" | "red" | "unknown";

export type TruthLayerResult = {
  declaredStatus:      TruthStatus;
  evidenceStatus:      TruthStatus;
  confidenceInReporting: number;       // 0-100
  confidenceBand:      "high" | "medium" | "low";
  isFalseGreen:        boolean;
  isFalseAmber:        boolean;        // declared worse than evidence (sandbagging)
  gap:                 "none" | "minor" | "material" | "critical";
  signals:             TruthSignal[];
  narrative:           string;
  reportingRisk:       "low" | "medium" | "high" | "critical";
  generatedAt:         string;
};

export type TruthSignal = {
  id:        string;
  label:     string;
  declared:  string;
  evidence:  string;
  severity:  "low" | "medium" | "high";
  direction: "worse_than_declared" | "better_than_declared" | "consistent";
};

function safeStr(x: any): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function normStatus(s: string | null | undefined): TruthStatus {
  const v = safeStr(s).toLowerCase().replace(/[^a-z]/g, "");
  if (v === "green" || v === "g" || v === "ontrack" || v === "active") return "green";
  if (v === "amber" || v === "a" || v === "y" || v === "yellow" || v === "atrisk") return "amber";
  if (v === "red"   || v === "r" || v === "critical" || v === "offtrack") return "red";
  return "unknown";
}

function evidenceFromScore(score: number): TruthStatus {
  if (score >= 60) return "red";
  if (score >= 30) return "amber";
  return "green";
}

function gapLevel(declared: TruthStatus, evidence: TruthStatus): "none" | "minor" | "material" | "critical" {
  const order: Record<TruthStatus, number> = { green: 0, amber: 1, red: 2, unknown: -1 };
  const dOrder = order[declared];
  const eOrder = order[evidence];
  if (dOrder === -1 || eOrder === -1) return "none";
  const diff = eOrder - dOrder;
  if (diff <= 0) return "none";
  if (diff === 1) return "minor";
  if (diff === 2) return "material";
  return "critical";
}

export function computeTruthLayer(
  signals:          PremortemSignals,
  score:            PremortemScore,
  declaredStatusRaw?: string | null,
): TruthLayerResult {
  const now            = new Date().toISOString();
  const declared       = normStatus(declaredStatusRaw ?? signals.project.status);
  const evidence       = evidenceFromScore(score.failureRiskScore);
  const truthSignals:  TruthSignal[] = [];

  // ── Signal 1: Schedule vs status ──────────────────────────────────────
  if (signals.schedule.overdueCriticalCount > 0) {
    const direction = declared === "green" ? "worse_than_declared" : "consistent";
    truthSignals.push({
      id: "critical_milestones_overdue",
      label: "Critical-path milestones",
      declared: declared === "green" ? "On track" : declared,
      evidence: `${signals.schedule.overdueCriticalCount} overdue — delivery at risk`,
      severity: "high",
      direction,
    });
  }

  if (signals.schedule.overdueCount > 2 && signals.schedule.overdueCriticalCount === 0) {
    truthSignals.push({
      id: "milestones_overdue",
      label: "Milestone completion",
      declared: declared === "green" ? "On track" : declared,
      evidence: `${signals.schedule.overdueCount} milestones past due date`,
      severity: "medium",
      direction: declared === "green" ? "worse_than_declared" : "consistent",
    });
  }

  // ── Signal 2: Governance vs status ────────────────────────────────────
  if (signals.governance.overdueApprovalCount > 1) {
    truthSignals.push({
      id: "approvals_blocked",
      label: "Approval pipeline",
      declared: declared === "green" ? "Healthy" : declared,
      evidence: `${signals.governance.overdueApprovalCount} approvals overdue SLA`,
      severity: signals.governance.overdueApprovalCount >= 3 ? "high" : "medium",
      direction: declared === "green" ? "worse_than_declared" : "consistent",
    });
  }

  if (signals.governance.missingMandatoryArtifactCount > 0) {
    truthSignals.push({
      id: "missing_artifacts",
      label: "Governance baseline",
      declared: declared === "green" ? "Controlled" : declared,
      evidence: `${signals.governance.missingMandatoryArtifactCount} mandatory artifact${signals.governance.missingMandatoryArtifactCount !== 1 ? "s" : ""} not approved`,
      severity: "medium",
      direction: declared === "green" ? "worse_than_declared" : "consistent",
    });
  }

  if (signals.governance.staleWeeklyReport && declared === "green") {
    truthSignals.push({
      id: "stale_reporting",
      label: "Reporting cadence",
      declared: "Active governance",
      evidence: "No artifact updates in 14+ days",
      severity: "medium",
      direction: "worse_than_declared",
    });
  }

  // ── Signal 3: Budget vs status ─────────────────────────────────────────
  if ((signals.budget.variancePct ?? 0) > 10 && declared !== "red") {
    truthSignals.push({
      id: "budget_variance",
      label: "Financial position",
      declared: declared === "green" ? "Within budget" : "Monitoring",
      evidence: `Forecast ${signals.budget.variancePct?.toFixed(1)}% above approved budget`,
      severity: (signals.budget.variancePct ?? 0) > 25 ? "high" : "medium",
      direction: "worse_than_declared",
    });
  }

  if (signals.budget.unapprovedChangeValue > 0 && declared === "green") {
    const approvedBudgetRef = signals.budget.approvedBudget ?? 100000;
    const exposurePct = (signals.budget.unapprovedChangeValue / approvedBudgetRef) * 100;
    if (exposurePct > 10) {
      truthSignals.push({
        id: "hidden_exposure",
        label: "Change exposure",
        declared: "Controlled",
        evidence: `£${Math.round(signals.budget.unapprovedChangeValue).toLocaleString()} unapproved (${exposurePct.toFixed(0)}% of budget)`,
        severity: "medium",
        direction: "worse_than_declared",
      });
    }
  }

  // ── Signal 4: Stability vs status ─────────────────────────────────────
  if (signals.stability.unresolvedIssueCount >= 3 && declared === "green") {
    truthSignals.push({
      id: "issue_backlog",
      label: "Delivery issues",
      declared: "No significant issues",
      evidence: `${signals.stability.unresolvedIssueCount} unresolved issues open`,
      severity: signals.stability.unresolvedIssueCount >= 5 ? "high" : "medium",
      direction: "worse_than_declared",
    });
  }

  if (signals.stability.risingIssueTrend && declared !== "red") {
    truthSignals.push({
      id: "rising_issues",
      label: "Issue trend",
      declared: declared === "green" ? "Stable" : "Monitoring",
      evidence: "Issue count rising vs prior period",
      severity: "medium",
      direction: "worse_than_declared",
    });
  }

  // ── Sandbagging detection (declared worse than evidence) ──────────────
  const isFalseAmber = declared === "amber" && evidence === "green" && score.confidence >= 60;
  if (isFalseAmber) {
    truthSignals.push({
      id: "possible_sandbagging",
      label: "Risk conservatism",
      declared: "Amber (at risk)",
      evidence: "Delivery signals suggest green / low risk",
      severity: "low",
      direction: "better_than_declared",
    });
  }

  // ── Confidence in reporting ────────────────────────────────────────────
  const worseSignals    = truthSignals.filter(s => s.direction === "worse_than_declared");
  const highSevWorse    = worseSignals.filter(s => s.severity === "high").length;
  const medSevWorse     = worseSignals.filter(s => s.severity === "medium").length;

  let confidence = 100;
  confidence -= highSevWorse * 25;
  confidence -= medSevWorse  * 12;
  if (score.confidence < 50) confidence -= 15; // low data quality
  if (signals.governance.staleWeeklyReport) confidence -= 10;
  confidence = Math.max(10, Math.min(100, confidence));

  const confidenceBand: "high" | "medium" | "low" =
    confidence >= 70 ? "high" : confidence >= 40 ? "medium" : "low";

  // ── Gap and false-green ────────────────────────────────────────────────
  const gap         = gapLevel(declared, evidence);
  const isFalseGreen = score.hiddenRisk || (declared === "green" && evidence !== "green");

  // ── Reporting risk ────────────────────────────────────────────────────
  const reportingRisk: "low" | "medium" | "high" | "critical" =
    isFalseGreen && gap === "critical" ? "critical" :
    isFalseGreen && gap === "material" ? "high" :
    gap === "minor" || (isFalseGreen && gap === "none") ? "medium" : "low";

  // ── Narrative ─────────────────────────────────────────────────────────
  let narrative = "";
  if (isFalseGreen && gap === "critical") {
    narrative = `Project is reported as ${declared} but delivery evidence indicates ${evidence} risk. This is a material governance concern — executive visibility is being obscured by optimistic reporting. Immediate status correction is recommended.`;
  } else if (isFalseGreen && gap === "material") {
    narrative = `Declared status (${declared}) does not fully reflect the operational evidence. ${worseSignals.length} signal${worseSignals.length !== 1 ? "s" : ""} indicate higher risk than reported. Status should be reviewed and updated.`;
  } else if (gap === "minor") {
    narrative = `Declared status (${declared}) is slightly optimistic relative to current evidence. Minor signals suggest closer monitoring is warranted.`;
  } else if (isFalseAmber) {
    narrative = `Project may be reported more conservatively than evidence supports. Current signals suggest delivery risk is lower than the declared ${declared} status.`;
  } else {
    narrative = `Declared status (${declared}) is broadly consistent with delivery evidence. Confidence in reporting quality: ${confidence}%.`;
  }

  return {
    declaredStatus:          declared,
    evidenceStatus:          evidence,
    confidenceInReporting:   confidence,
    confidenceBand,
    isFalseGreen,
    isFalseAmber,
    gap,
    signals:                 truthSignals,
    narrative,
    reportingRisk,
    generatedAt:             now,
  };
}