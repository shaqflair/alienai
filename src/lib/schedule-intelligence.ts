// ─────────────────────────────────────────────────────────────
//  Aliena — Schedule Intelligence
//  Types · Deterministic signal engine · Rule-based fallback
// ─────────────────────────────────────────────────────────────

export type MilestoneStatus = "not_started" | "in_progress" | "complete" | "delayed" | "cancelled" | "on_hold";
export type MilestonePriority = "low" | "medium" | "high" | "critical";
export type RAGStatus = "green" | "amber" | "red";

export interface Milestone {
  id: string;
  ref: string;
  title: string;
  description?: string;
  phase: string;
  status: MilestoneStatus;
  priority: MilestonePriority;
  owner: string | null;
  baselineDate: string;
  forecastDate: string;
  actualDate?: string | null;
  float?: number;
  isCriticalPath: boolean;
  predecessors?: string[];
  successors?: string[];
  percentComplete: number;
  lastUpdated: string;
  notes?: string;
}

export type SignalCode = "MILESTONE_AT_RISK" | "MILESTONE_OVERDUE" | "CRITICAL_PATH_SLIP" | "DEPENDENCY_BLOCKED" | "FLOAT_EXHAUSTED" | "VELOCITY_DECLINING" | "BASELINE_DEVIATION" | "CLUSTER_SLIP";
export type SignalSeverity = "info" | "warning" | "critical";

export interface ScheduleSignal {
  code: SignalCode;
  severity: SignalSeverity;
  label: string;
  detail: string;
  affectedIds: string[];
}

export interface ScheduleIntelligenceResult {
  headline: string;
  rag: RAGStatus;
  narrative: string;
  criticalMilestones: {
    ref: string;
    title: string;
    slipDays: number;
    rationale: string;
    urgency: "immediate" | "this_week" | "this_sprint" | "monitor";
  }[];
  scheduleForecast: {
    overallSlipDays: number;
    projectedCompletionDate: string;
    confidenceLevel: "high" | "medium" | "low";
    forecastNote: string;
  };
  pmActions: {
    action: string;
    priority: "high" | "medium" | "low";
    timeframe: string;
  }[];
  earlyWarnings: string[];
  fallback?: boolean;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

export function daysTil(dateStr: string): number {
  return Math.round((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

export function daysSince(dateStr: string): number {
  return Math.round((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function computeScheduleSignals(milestones: Milestone[]): ScheduleSignal[] {
  const signals: ScheduleSignal[] = [];
  const active = milestones.filter(m => !["complete", "cancelled"].includes(m.status));

  // 1. OVERDUE
  const overdue = active.filter(m => m.forecastDate && daysTil(m.forecastDate) < 0);
  if (overdue.length > 0) {
    signals.push({ code: "MILESTONE_OVERDUE", severity: "critical", label: "Milestones Overdue", detail: `${overdue.length} items past forecast`, affectedIds: overdue.map(m => m.id) });
  }

  // 2. CRITICAL PATH SLIP
  const cpSlip = active.filter(m => m.isCriticalPath && daysBetween(m.baselineDate, m.forecastDate) > 0);
  if (cpSlip.length > 0) {
    signals.push({ code: "CRITICAL_PATH_SLIP", severity: "critical", label: "Critical Path Slip", detail: "Critical path milestones are behind baseline", affectedIds: cpSlip.map(m => m.id) });
  }

  // 3. AT RISK
  const atRisk = active.filter(m => daysTil(m.forecastDate) <= 14 && daysTil(m.forecastDate) >= 0 && m.percentComplete < 80);
  if (atRisk.length > 0) {
    signals.push({ code: "MILESTONE_AT_RISK", severity: "warning", label: "Milestones At Risk", detail: `${atRisk.length} items due soon with low completion`, affectedIds: atRisk.map(m => m.id) });
  }

  return signals;
}

export function ruleBasedScheduleAnalysis(milestones: Milestone[], signals: ScheduleSignal[]): ScheduleIntelligenceResult {
  const active = milestones.filter(m => !["complete", "cancelled"].includes(m.status));
  const cpMilestones = active.filter(m => m.isCriticalPath);
  const maxSlip = cpMilestones.length > 0 ? Math.max(...cpMilestones.map(m => daysBetween(m.baselineDate, m.forecastDate))) : 0;
  const projectedEnd = milestones.length > 0 ? milestones.map(m => m.forecastDate).sort().reverse()[0] : "N/A";

  return {
    headline: maxSlip > 0 ? `Schedule is slipping by ${maxSlip} days` : "Schedule is on track",
    rag: maxSlip > 7 ? "red" : maxSlip > 0 ? "amber" : "green",
    narrative: `Project has ${active.length} active milestones.`,
    criticalMilestones: [],
    scheduleForecast: { overallSlipDays: maxSlip, projectedCompletionDate: projectedEnd, confidenceLevel: "medium", forecastNote: "Calculated via baseline deviation" },
    pmActions: [{ action: "Review schedule baseline", priority: "medium", timeframe: "This week" }],
    earlyWarnings: signals.map(s => s.detail),
    fallback: true
  };
}
