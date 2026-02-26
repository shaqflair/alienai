// ─────────────────────────────────────────────────────────────
//  Aliena — Decision Intelligence
//  Types · Deterministic signal engine · Rule-based fallback
// ─────────────────────────────────────────────────────────────

export type DecisionStatus =
  | "open"           // under consideration
  | "pending"        // awaiting approver
  | "approved"       // decision made, not yet implemented
  | "implemented"    // fully actioned
  | "deferred"       // parked for later
  | "rejected"       // formally rejected
  | "superseded";    // replaced by a later decision

export type DecisionImpact = "low" | "medium" | "high" | "critical";
export type DecisionCategory =
  | "Technical"
  | "Commercial"
  | "Resource"
  | "Schedule"
  | "Scope"
  | "Governance"
  | "Financial"
  | "Regulatory"
  | "Stakeholder"
  | "Other";

export type RAGStatus = "green" | "amber" | "red";

export interface DecisionOption {
  id: string;
  title: string;
  pros: string;
  cons: string;
  selected: boolean;
}

export interface Decision {
  id: string;
  ref: string;                    // e.g. "D-001"
  title: string;
  context: string;                // background / why this decision is needed
  rationale: string;              // reasoning behind the decision made
  decision: string;               // the actual decision statement
  category: DecisionCategory;
  status: DecisionStatus;
  impact: DecisionImpact;
  impactDescription?: string;     // free-text impact detail
  owner: string | null;           // decision maker
  approver?: string | null;       // if different from owner
  optionsConsidered?: DecisionOption[];
  dateRaised: string;             // ISO date
  neededByDate?: string | null;   // ISO date — deadline for decision
  approvedDate?: string | null;   // ISO date
  implementationDate?: string | null; // ISO date — when action will/did complete
  reviewDate?: string | null;     // ISO date — scheduled review
  reversible: boolean;            // can this be undone?
  linkedRisks?: string[];         // RAID item ids
  linkedChangeRequests?: string[];
  linkedMilestones?: string[];
  tags?: string[];
  lastUpdated: string;            // ISO date
  notes?: string;
}

// ─────────────────────────────────────────────
//  Signal types
// ─────────────────────────────────────────────

export type SignalCode =
  | "DECISION_OVERDUE"
  | "DECISION_STALE"
  | "HIGH_IMPACT_UNOWNED"
  | "RATIONALE_WEAK"
  | "IMPLEMENTATION_OVERDUE"
  | "CLUSTER_CONCENTRATION"
  | "REVERSAL_RISK"
  | "PENDING_ESCALATION";

export type SignalSeverity = "info" | "warning" | "critical";

export interface DecisionSignal {
  code: SignalCode;
  severity: SignalSeverity;
  label: string;
  detail: string;
  affectedIds: string[];
}

// ─────────────────────────────────────────────
//  AI response shape
// ─────────────────────────────────────────────

export interface DecisionIntelligenceResult {
  headline: string;
  rag: RAGStatus;
  narrative: string;
  keyDecisions: {
    ref: string;
    title: string;
    rationaleScore: number;       // 1-5
    rationaleAssessment: string;
    impactAssessment: string;
    urgency: "immediate" | "this_week" | "this_sprint" | "monitor";
  }[];
  pendingRisks: {
    ref: string;
    risk: string;
    recommendation: string;
  }[];
  pmActions: {
    action: string;
    priority: "high" | "medium" | "low";
    timeframe: string;
  }[];
  earlyWarnings: string[];
  fallback?: boolean;
}

// ─────────────────────────────────────────────
//  Date helpers
// ─────────────────────────────────────────────

export function daysTil(dateStr: string): number {
  return Math.round(
    (new Date(dateStr).getTime() - Date.now()) / 86400000
  );
}

export function daysSince(dateStr: string): number {
  return Math.round(
    (Date.now() - new Date(dateStr).getTime()) / 86400000
  );
}

// ─────────────────────────────────────────────
//  Rationale quality score (deterministic proxy)
// ─────────────────────────────────────────────

export function rationaleQualityScore(d: Decision): number {
  let score = 0;
  if (d.rationale && d.rationale.trim().length > 30) score += 2;
  else if (d.rationale && d.rationale.trim().length > 0) score += 1;
  if (d.context && d.context.trim().length > 20) score += 1;
  if (d.optionsConsidered && d.optionsConsidered.length >= 2) score += 1;
  if (d.impactDescription && d.impactDescription.trim().length > 10) score += 1;
  return Math.min(5, score);
}

// ─────────────────────────────────────────────
//  Deterministic signal engine
// ─────────────────────────────────────────────

const STALE_DAYS = 21;
const PENDING_ESCALATION_DAYS = 14;
const CLUSTER_THRESHOLD = 3;
const WEAK_RATIONALE_SCORE = 2;

export function computeDecisionSignals(decisions: Decision[]): DecisionSignal[] {
  const signals: DecisionSignal[] = [];

  const open = decisions.filter(
    (d) => !["implemented", "rejected", "superseded"].includes(d.status)
  );

  // 1. DECISION_OVERDUE — needed-by date passed, still open
  const overdue = open.filter(
    (d) => d.neededByDate && daysTil(d.neededByDate) < 0
  );
  if (overdue.length > 0) {
    signals.push({
      code: "DECISION_OVERDUE",
      severity: "critical",
      label: "Decisions Overdue",
      detail: `${overdue.length} decision${overdue.length > 1 ? "s" : ""} past needed-by date`,
      affectedIds: overdue.map((d) => d.id),
    });
  }

  // 2. DECISION_STALE — open, not updated in STALE_DAYS
  const stale = open.filter(
    (d) => daysSince(d.lastUpdated) > STALE_DAYS
  );
  if (stale.length > 0) {
    signals.push({
      code: "DECISION_STALE",
      severity: "warning",
      label: "Stale Decisions",
      detail: `${stale.length} decision${stale.length > 1 ? "s" : ""} not updated in ${STALE_DAYS}+ days`,
      affectedIds: stale.map((d) => d.id),
    });
  }

  // 3. HIGH_IMPACT_UNOWNED — high/critical impact with no owner
  const unowned = open.filter(
    (d) => ["high", "critical"].includes(d.impact) && !d.owner
  );
  if (unowned.length > 0) {
    signals.push({
      code: "HIGH_IMPACT_UNOWNED",
      severity: "critical",
      label: "High Impact Unowned",
      detail: `${unowned.length} high/critical impact decision${unowned.length > 1 ? "s" : ""} have no owner`,
      affectedIds: unowned.map((d) => d.id),
    });
  }

  // 4. RATIONALE_WEAK — low rationale quality score
  const weakRationale = decisions.filter(
    (d) =>
      !["rejected", "superseded"].includes(d.status) &&
      rationaleQualityScore(d) <= WEAK_RATIONALE_SCORE
  );
  if (weakRationale.length > 0) {
    signals.push({
      code: "RATIONALE_WEAK",
      severity: "warning",
      label: "Weak Rationale",
      detail: `${weakRationale.length} decision${weakRationale.length > 1 ? "s" : ""} have insufficient rationale or context`,
      affectedIds: weakRationale.map((d) => d.id),
    });
  }

  // 5. IMPLEMENTATION_OVERDUE — approved but implementation date passed
  const implOverdue = decisions.filter(
    (d) =>
      d.status === "approved" &&
      d.implementationDate &&
      daysTil(d.implementationDate) < 0
  );
  if (implOverdue.length > 0) {
    signals.push({
      code: "IMPLEMENTATION_OVERDUE",
      severity: "critical",
      label: "Implementation Overdue",
      detail: `${implOverdue.length} approved decision${implOverdue.length > 1 ? "s" : ""} past implementation date`,
      affectedIds: implOverdue.map((d) => d.id),
    });
  }

  // 6. CLUSTER_CONCENTRATION — 3+ open decisions in same category
  const categoryCounts: Record<string, string[]> = {};
  open.forEach((d) => {
    if (!categoryCounts[d.category]) categoryCounts[d.category] = [];
    categoryCounts[d.category].push(d.id);
  });
  Object.entries(categoryCounts).forEach(([cat, ids]) => {
    if (ids.length >= CLUSTER_THRESHOLD) {
      signals.push({
        code: "CLUSTER_CONCENTRATION",
        severity: "warning",
        label: `${cat} Decision Cluster`,
        detail: `${ids.length} open decisions concentrated in "${cat}" — systemic issue likely`,
        affectedIds: ids,
      });
    }
  });

  // 7. REVERSAL_RISK — reversible decision with no review date
  const reversalRisk = open.filter(
    (d) =>
      d.reversible &&
      d.status === "approved" &&
      !d.reviewDate
  );
  if (reversalRisk.length > 0) {
    signals.push({
      code: "REVERSAL_RISK",
      severity: "warning",
      label: "Reversal Risk",
      detail: `${reversalRisk.length} reversible decision${reversalRisk.length > 1 ? "s" : ""} approved with no review date scheduled`,
      affectedIds: reversalRisk.map((d) => d.id),
    });
  }

  // 8. PENDING_ESCALATION — open for > PENDING_ESCALATION_DAYS
  const pendingTooLong = open.filter(
    (d) =>
      ["open", "pending"].includes(d.status) &&
      daysSince(d.dateRaised) > PENDING_ESCALATION_DAYS &&
      ["high", "critical"].includes(d.impact)
  );
  if (pendingTooLong.length > 0) {
    signals.push({
      code: "PENDING_ESCALATION",
      severity: "warning",
      label: "Pending Escalation",
      detail: `${pendingTooLong.length} high-impact decision${pendingTooLong.length > 1 ? "s" : ""} open for ${PENDING_ESCALATION_DAYS}+ days without resolution`,
      affectedIds: pendingTooLong.map((d) => d.id),
    });
  }

  return signals;
}

// ─────────────────────────────────────────────
//  Rule-based fallback
// ─────────────────────────────────────────────

export function ruleBasedDecisionAnalysis(
  decisions: Decision[],
  signals: DecisionSignal[]
): DecisionIntelligenceResult {
  const open = decisions.filter(
    (d) => !["implemented", "rejected", "superseded"].includes(d.status)
  );
  const critical = signals.filter((s) => s.severity === "critical");
  const warnings = signals.filter((s) => s.severity === "warning");

  const rag: RAGStatus =
    critical.length > 0 ? "red" : warnings.length >= 2 ? "amber" : "green";

  const keyDecisions = open
    .filter((d) => ["high", "critical"].includes(d.impact))
    .sort((a, b) => {
      const impactScore = { critical: 3, high: 2, medium: 1, low: 0 };
      return impactScore[b.impact] - impactScore[a.impact];
    })
    .slice(0, 3)
    .map((d) => {
      const rScore = rationaleQualityScore(d);
      const overdueBy = d.neededByDate ? Math.max(0, -daysTil(d.neededByDate)) : 0;
      return {
        ref: d.ref,
        title: d.title,
        rationaleScore: rScore,
        rationaleAssessment:
          rScore >= 4 ? "Well documented with context and options" :
          rScore >= 3 ? "Adequate rationale — could be strengthened" :
          rScore >= 2 ? "Rationale present but thin" :
          "Rationale missing or insufficient",
        impactAssessment: `${d.impact.charAt(0).toUpperCase() + d.impact.slice(1)} impact — ${d.impactDescription || "no impact detail provided"}`,
        urgency: (
          overdueBy > 0 ? "immediate" :
          d.neededByDate && daysTil(d.neededByDate) <= 7 ? "this_week" :
          d.neededByDate && daysTil(d.neededByDate) <= 14 ? "this_sprint" :
          "monitor"
        ) as "immediate" | "this_week" | "this_sprint" | "monitor",
      };
    });

  const overdue = open.filter((d) => d.neededByDate && daysTil(d.neededByDate) < 0);
  const unowned = open.filter((d) => !d.owner);

  return {
    headline:
      critical.length > 0
        ? `${critical.length} critical decision signal${critical.length > 1 ? "s" : ""} require immediate action`
        : warnings.length > 0
        ? `${warnings.length} decision warning${warnings.length > 1 ? "s" : ""} — log needs attention`
        : "Decision log is in good order",
    rag,
    narrative: `${open.length} open decision${open.length !== 1 ? "s" : ""} across ${new Set(open.map((d) => d.category)).size} categories. ${
      overdue.length > 0
        ? `${overdue.length} decision${overdue.length !== 1 ? "s are" : " is"} past needed-by date. `
        : ""
    }${unowned.length > 0 ? `${unowned.length} decision${unowned.length !== 1 ? "s are" : " is"} unowned.` : "All decisions have owners."}`,
    keyDecisions,
    pendingRisks: open
      .filter((d) => d.status === "pending" && ["high", "critical"].includes(d.impact))
      .slice(0, 2)
      .map((d) => ({
        ref: d.ref,
        risk: `Pending ${d.impact} impact decision on ${d.title}`,
        recommendation: d.approver
          ? `Chase ${d.approver} for approval`
          : "Assign approver and set deadline",
      })),
    pmActions: [
      ...(overdue.length > 0
        ? [{ action: `Resolve ${overdue.length} overdue decision${overdue.length > 1 ? "s" : ""}`, priority: "high" as const, timeframe: "Today" }]
        : []),
      ...(unowned.length > 0
        ? [{ action: "Assign owners to unowned decisions", priority: "high" as const, timeframe: "This week" }]
        : []),
      { action: "Strengthen rationale on weak decision records", priority: "medium" as const, timeframe: "This sprint" },
    ],
    earlyWarnings: signals.slice(0, 3).map((s) => s.detail),
    fallback: true,
  };
}