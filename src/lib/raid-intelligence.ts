// ─────────────────────────────────────────────────────────────
//  Aliena — RAID Intelligence
//  Deterministic signals + rule-based fallback analysis
// ─────────────────────────────────────────────────────────────

export type RAIDType = "risk" | "assumption" | "issue" | "dependency";

export type RAIDStatus =
  | "open"
  | "in_progress"
  | "closed"
  | "mitigated"
  | "accepted"
  | "blocked"
  | "resolved";

export type RiskProbability = "low" | "medium" | "high" | "critical";
export type RiskImpact = "low" | "medium" | "high" | "critical";
export type RAGStatus = "green" | "amber" | "red";

export interface RAIDItem {
  id: string;
  type: RAIDType;
  ref: string;
  title: string;
  description: string;
  category: string;
  status: RAIDStatus;
  probability?: RiskProbability;
  impact: RiskImpact;
  riskScore?: number;
  previousRiskScore?: number;
  owner: string | null;
  dateRaised: string;
  dueDate: string | null;
  lastUpdated: string;
  mitigationPlan?: string;
  mitigationActions?: MitigationAction[];
  linkedChangeRequests?: string[];
  linkedItems?: string[];
  reviewedDate?: string;
  closedDate?: string | null;
  notes?: string;
}

export interface MitigationAction {
  id: string;
  description: string;
  owner: string;
  dueDate: string;
  status: "not_started" | "in_progress" | "complete";
}

export type SignalCode =
  | "RISK_HEAT_CRITICAL"
  | "ACTION_OVERDUE"
  | "ACTION_STALE"
  | "ESCALATION_REQUIRED"
  | "MITIGATION_NOT_STARTED"
  | "DEPENDENCY_BLOCKED"
  | "RISK_TREND_WORSENING"
  | "CLUSTER_CONCENTRATION";

export type SignalSeverity = "info" | "warning" | "critical";

export interface RAIDSignal {
  code: SignalCode;
  severity: SignalSeverity;
  label: string;
  detail: string;
  affectedIds: string[];
}

export interface RAIDIntelligenceResult {
  headline: string;
  rag: RAGStatus;
  narrative: string;
  topRisks: {
    ref: string;
    title: string;
    rationale: string;
    urgency: "immediate" | "this_week" | "this_sprint" | "monitor";
  }[];
  escalations: {
    ref: string;
    reason: string;
    recommendedAction: string;
  }[];
  pmActions: {
    action: string;
    priority: "high" | "medium" | "low";
    timeframe: string;
  }[];
  earlyWarnings: string[];
  fallback?: boolean;
}

const SCORE_MAP: Record<RiskProbability | RiskImpact, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function calcRiskScore(probability: RiskProbability, impact: RiskImpact): number {
  return SCORE_MAP[probability] * SCORE_MAP[impact];
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

function daysTil(dateStr: string): number {
  return Math.floor((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export function computeRAIDSignals(items: RAIDItem[]): RAIDSignal[] {
  const signals: RAIDSignal[] = [];
  const open = items.filter((i) => !["closed", "resolved", "mitigated"].includes(i.status));

  // 1. RISK_HEAT_CRITICAL
  const criticalRisks = open.filter(i => i.type === "risk" && i.probability && calcRiskScore(i.probability, i.impact) >= 9);
  if (criticalRisks.length > 0) {
    signals.push({
      code: "RISK_HEAT_CRITICAL",
      severity: "critical",
      label: "Critical Risk Heat",
      detail: `${criticalRisks.length} risks with score >= 9`,
      affectedIds: criticalRisks.map(r => r.id),
    });
  }

  // 2. ACTION_OVERDUE
  const overdue = open.filter(i => i.dueDate && daysTil(i.dueDate) < 0);
  if (overdue.length > 0) {
    signals.push({
      code: "ACTION_OVERDUE",
      severity: "critical",
      label: "Actions Overdue",
      detail: `${overdue.length} items past due date`,
      affectedIds: overdue.map(i => i.id),
    });
  }

  // 3. ACTION_STALE
  const stale = open.filter(i => daysSince(i.lastUpdated) > 14);
  if (stale.length > 0) {
    signals.push({
      code: "ACTION_STALE",
      severity: "warning",
      label: "Stale RAID Items",
      detail: `${stale.length} items not updated in 14+ days`,
      affectedIds: stale.map(i => i.id),
    });
  }

  // 4. DEPENDENCY_BLOCKED
  const blocked = items.filter(i => i.type === "dependency" && i.status === "blocked");
  if (blocked.length > 0) {
    signals.push({
      code: "DEPENDENCY_BLOCKED",
      severity: "critical",
      label: "Dependencies Blocked",
      detail: `${blocked.length} blocked dependencies detected`,
      affectedIds: blocked.map(i => i.id),
    });
  }

  return signals;
}

export function ruleBasedRAIDAnalysis(items: RAIDItem[], signals: RAIDSignal[]): RAIDIntelligenceResult {
  const open = items.filter((i) => !["closed", "resolved", "mitigated"].includes(i.status));
  const criticalSignals = signals.filter((s) => s.severity === "critical");
  const rag: RAGStatus = criticalSignals.length > 0 ? "red" : "green";

  return {
    headline: criticalSignals.length > 0 ? "Critical signals require attention" : "RAID log is healthy",
    rag,
    narrative: `Project has ${open.length} open items.`,
    topRisks: [],
    escalations: [],
    pmActions: [{ action: "Review RAID log", priority: "medium", timeframe: "This week" }],
    earlyWarnings: signals.map(s => s.detail),
    fallback: true
  };
}
