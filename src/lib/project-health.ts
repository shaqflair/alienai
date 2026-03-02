// ─────────────────────────────────────────────────────────────
//  Aliena — Project Health Dashboard
//  Types · Cross-artifact rollup signal engine · Fallback
// ─────────────────────────────────────────────────────────────

export type RAGStatus = "green" | "amber" | "red" | "unknown";
export type TrendDirection = "improving" | "stable" | "deteriorating" | "unknown";

// ─────────────────────────────────────────────
//  RAG thresholds (used by UI hover + scoring)
//  Green threshold requested: ≥ 85
// ─────────────────────────────────────────────

export const RAG_THRESHOLDS = {
  GREEN_MIN: 85,
  AMBER_MIN: 70,
} as const;

function clamp01to100(x: any): number {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Convert a numeric health score into RAG.
 * - Green: ≥ 85
 * - Amber: 70–84
 * - Red:   < 70
 */
export function scoreToRag(score: number | null | undefined): RAGStatus {
  if (score == null) return "unknown";
  const s = clamp01to100(score);
  if (s >= RAG_THRESHOLDS.GREEN_MIN) return "green";
  if (s >= RAG_THRESHOLDS.AMBER_MIN) return "amber";
  return "red";
}

/**
 * Human-readable RAG logic description for hover/tooltips.
 * Optionally pass a score (health %) to include it in the text.
 */
export function describeRagLogic(rag: RAGStatus, score?: number | null): string {
  const s = score == null ? null : clamp01to100(score);
  const withScore = s == null ? "" : ` (${s}%)`;
  if (rag === "green") return `Green${withScore}: Health ≥ ${RAG_THRESHOLDS.GREEN_MIN}%. Delivery + cost + resourcing are within acceptable thresholds.`;
  if (rag === "amber") return `Amber${withScore}: Health ${RAG_THRESHOLDS.AMBER_MIN}–${RAG_THRESHOLDS.GREEN_MIN - 1}%. Early risk signals present — investigate schedule adherence, RAID exposure, budget variance, and resourcing constraints.`;
  if (rag === "red") return `Red${withScore}: Health < ${RAG_THRESHOLDS.AMBER_MIN}%. Material risk to delivery — immediate review recommended (schedule, RAID, budget, and resourcing).`;
  return "Unknown: No health score calculated yet for this project.";
}

// ─────────────────────────────────────────────
//  Per-artifact health snapshot
// ─────────────────────────────────────────────

export type ArtifactKey = "financial" | "resource" | "raid" | "schedule" | "overall";

export interface ArtifactHealth {
  key: ArtifactKey;
  label: string;
  rag: RAGStatus;
  headline: string;
  criticalSignals: number;
  warningSignals: number;
  lastUpdated: string | null; // ISO
  fallback: boolean;
}

// ─────────────────────────────────────────────
//  Health snapshot (stored in Supabase for trend)
// ─────────────────────────────────────────────

export interface ProjectHealthSnapshot {
  id?: string;
  projectId: string;
  snapshotDate: string; // ISO date (YYYY-MM-DD)
  overallRag: RAGStatus;

  financialRag: RAGStatus;
  resourceRag: RAGStatus;
  raidRag: RAGStatus;
  scheduleRag: RAGStatus;

  totalCriticalSignals: number;
  totalWarningSignals: number;
  headline: string;
  generatedAt: string; // ISO datetime
}

// ─────────────────────────────────────────────
//  AI result shape
// ─────────────────────────────────────────────

export interface ProjectHealthResult {
  headline: string;
  rag: RAGStatus;
  narrative: string;
  artifactBreakdown: {
    key: ArtifactKey;
    label: string;
    rag: RAGStatus;
    summary: string;
    topConcern: string | null;
  }[];
  crossCuttingRisks: {
    title: string;
    rationale: string;
    urgency: "immediate" | "this_week" | "this_sprint" | "monitor";
  }[];
  execActions: {
    action: string;
    owner: string;
    priority: "high" | "medium" | "low";
    timeframe: string;
  }[];
  earlyWarnings: string[];
  fallback?: boolean;
}

// ─────────────────────────────────────────────
//  Rollup signal types
// ─────────────────────────────────────────────

export type HealthSignalCode =
  | "MULTI_ARTIFACT_RED"
  | "TREND_DETERIORATING"
  | "STALE_ARTIFACTS"
  | "CRITICAL_SIGNAL_SPIKE"
  | "UNRESOLVED_ESCALATIONS"
  | "SCHEDULE_FINANCIAL_CORRELATION"
  | "SCHEDULE_RESOURCE_CORRELATION"
  | "FINANCIAL_RESOURCE_CORRELATION";

export type SignalSeverity = "info" | "warning" | "critical";

export interface HealthSignal {
  code: HealthSignalCode;
  severity: SignalSeverity;
  label: string;
  detail: string;
  affectedArtifacts: ArtifactKey[];
}

// ─────────────────────────────────────────────
//  Rollup signal engine
// ─────────────────────────────────────────────

const STALE_HOURS = 48;

function hoursAgo(isoDate: string | null): number {
  if (!isoDate) return Infinity;
  return (Date.now() - new Date(isoDate).getTime()) / 3600000;
}

export function computeHealthSignals(
  artifacts: ArtifactHealth[],
  snapshots: ProjectHealthSnapshot[]
): HealthSignal[] {
  const signals: HealthSignal[] = [];
  const byKey = Object.fromEntries(artifacts.map((a) => [a.key, a])) as Record<ArtifactKey, ArtifactHealth>;

  // 1. MULTI_ARTIFACT_RED
  const redArtifacts = artifacts.filter((a) => a.key !== "overall" && a.rag === "red");
  if (redArtifacts.length >= 2) {
    signals.push({
      code: "MULTI_ARTIFACT_RED",
      severity: "critical",
      label: "Multiple Red Artifacts",
      detail: `${redArtifacts.map((a) => a.label).join(" and ")} are both RED — compounding project risk`,
      affectedArtifacts: redArtifacts.map((a) => a.key),
    });
  }

  // 2. TREND_DETERIORATING
  if (snapshots.length >= 3) {
    const recent = [...snapshots]
      .sort((a, b) => new Date(b.snapshotDate).getTime() - new Date(a.snapshotDate).getTime())
      .slice(0, 3);
    const ragScore = (r: RAGStatus) => (r === "red" ? 2 : r === "amber" ? 1 : 0);
    const scores = recent.map((s) => ragScore(s.overallRag));
    if (scores[0] > scores[1] && scores[1] >= scores[2]) {
      signals.push({
        code: "TREND_DETERIORATING",
        severity: "warning",
        label: "Trend Deteriorating",
        detail: "Overall project health has worsened across the last 3 snapshots",
        affectedArtifacts: ["overall"],
      });
    }
  }

  // 3. STALE_ARTIFACTS
  const staleArtifacts = artifacts.filter(
    (a) => a.key !== "overall" && hoursAgo(a.lastUpdated) > STALE_HOURS
  );
  if (staleArtifacts.length > 0) {
    signals.push({
      code: "STALE_ARTIFACTS",
      severity: "warning",
      label: "Stale Intelligence",
      detail: `${staleArtifacts.map((a) => a.label).join(", ")} ${
        staleArtifacts.length > 1 ? "have" : "has"
      } not been refreshed in ${STALE_HOURS}+ hours`,
      affectedArtifacts: staleArtifacts.map((a) => a.key),
    });
  }

  // 4. CRITICAL_SIGNAL_SPIKE
  if (snapshots.length >= 2) {
    const sorted = [...snapshots].sort(
      (a, b) => new Date(b.snapshotDate).getTime() - new Date(a.snapshotDate).getTime()
    );
    const currentCritical = artifacts.reduce((sum, a) => sum + a.criticalSignals, 0);
    const previousCritical = sorted[1]?.totalCriticalSignals ?? 0;
    if (currentCritical > previousCritical + 1) {
      signals.push({
        code: "CRITICAL_SIGNAL_SPIKE",
        severity: "critical",
        label: "Critical Signal Spike",
        detail: `Critical signals increased from ${previousCritical} to ${currentCritical} since last snapshot`,
        affectedArtifacts: ["overall"],
      });
    }
  }

  // 5. UNRESOLVED_ESCALATIONS
  // Escalate when two or more of (RAID, Financial, Resource) have critical signals.
  const escalationArtifacts = artifacts.filter(
    (a) => ["raid", "financial", "resource"].includes(a.key) && a.criticalSignals > 0
  );
  if (escalationArtifacts.length >= 2) {
    const labels = escalationArtifacts.map((a) => a.label).join(" and ");
    signals.push({
      code: "UNRESOLVED_ESCALATIONS",
      severity: "critical",
      label: "Unresolved Escalations",
      detail: `${labels} have unresolved critical signals — escalation to sponsor recommended`,
      affectedArtifacts: escalationArtifacts.map((a) => a.key),
    });
  }

  // 6. SCHEDULE_FINANCIAL_CORRELATION
  const sH = byKey["schedule"];
  const fH = byKey["financial"];
  if (sH && fH && ["amber", "red"].includes(sH.rag) && ["amber", "red"].includes(fH.rag)) {
    signals.push({
      code: "SCHEDULE_FINANCIAL_CORRELATION",
      severity: sH.rag === "red" && fH.rag === "red" ? "critical" : "warning",
      label: "Schedule & Cost Pressure",
      detail: "Schedule slip and cost pressure are occurring simultaneously — delivery risk elevated",
      affectedArtifacts: ["schedule", "financial"],
    });
  }

  // 7. SCHEDULE_RESOURCE_CORRELATION
  const rH = byKey["resource"];
  if (sH && rH && ["amber", "red"].includes(sH.rag) && ["amber", "red"].includes(rH.rag)) {
    signals.push({
      code: "SCHEDULE_RESOURCE_CORRELATION",
      severity: sH.rag === "red" && rH.rag === "red" ? "critical" : "warning",
      label: "Schedule & Resourcing Pressure",
      detail: "Schedule pressure and resourcing constraints are occurring together — delivery capacity risk elevated",
      affectedArtifacts: ["schedule", "resource"],
    });
  }

  // 8. FINANCIAL_RESOURCE_CORRELATION
  if (fH && rH && ["amber", "red"].includes(fH.rag) && ["amber", "red"].includes(rH.rag)) {
    signals.push({
      code: "FINANCIAL_RESOURCE_CORRELATION",
      severity: fH.rag === "red" && rH.rag === "red" ? "critical" : "warning",
      label: "Cost & Resourcing Pressure",
      detail: "Cost pressure and resourcing constraints are occurring together — recovery options narrowing",
      affectedArtifacts: ["financial", "resource"],
    });
  }

  return signals;
}

/**
 * Roll up a set of artifact RAGs into an overall RAG.
 * Rules (simple + conservative):
 * - If any artifact is red => overall red
 * - If 2+ ambers => overall red
 * - If any amber => overall amber
 * - Otherwise green
 */
export function rollupRAG(artifacts: ArtifactHealth[]): RAGStatus {
  const relevant = artifacts.filter((a) => a.key !== "overall" && a.rag !== "unknown");
  if (relevant.length === 0) return "unknown";
  if (relevant.some((a) => a.rag === "red")) return "red";
  if (relevant.filter((a) => a.rag === "amber").length >= 2) return "red";
  if (relevant.some((a) => a.rag === "amber")) return "amber";
  return "green";
}

export function computeTrend(snapshots: ProjectHealthSnapshot[], windowDays: number): TrendDirection {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const recent = snapshots
    .filter((s) => new Date(s.snapshotDate) >= cutoff)
    .sort((a, b) => new Date(a.snapshotDate).getTime() - new Date(b.snapshotDate).getTime());
  if (recent.length < 2) return "unknown";
  const ragScore = (r: RAGStatus) => (r === "red" ? 2 : r === "amber" ? 1 : 0);
  const first = ragScore(recent[0].overallRag);
  const last = ragScore(recent[recent.length - 1].overallRag);
  return last < first ? "improving" : last > first ? "deteriorating" : "stable";
}

export function ruleBasedHealthAnalysis(
  artifacts: ArtifactHealth[],
  signals: HealthSignal[],
  snapshots: ProjectHealthSnapshot[]
): ProjectHealthResult {
  const rag = rollupRAG(artifacts);
  const critical = signals.filter((s) => s.severity === "critical");
  const warnings = signals.filter((s) => s.severity === "warning");

  const artifactBreakdown = artifacts
    .filter((a) => a.key !== "overall")
    .map((a) => ({
      key: a.key,
      label: a.label,
      rag: a.rag,
      summary: a.headline || `${a.criticalSignals} critical, ${a.warningSignals} warning signals`,
      topConcern:
        a.criticalSignals > 0
          ? `${a.criticalSignals} unresolved critical signal${a.criticalSignals > 1 ? "s" : ""}`
          : null,
    }));

  const redCount = artifacts.filter((a) => a.key !== "overall" && a.rag === "red").length;
  const amberCount = artifacts.filter((a) => a.key !== "overall" && a.rag === "amber").length;

  return {
    headline:
      critical.length > 0
        ? `${critical.length} cross-artifact critical signals`
        : warnings.length > 0
        ? `${warnings.length} cross-artifact warnings to monitor`
        : "Project health on track",
    rag,
    narrative: `${redCount} artifacts in red, ${amberCount} in amber.`,
    artifactBreakdown,
    crossCuttingRisks: signals
      .slice(0, 3)
      .map((s) => ({
        title: s.label,
        rationale: s.detail,
        urgency: s.severity === "critical" ? "immediate" : "this_week",
      })),
    execActions:
      critical.length > 0
        ? [
            {
              action: "Exec Review",
              owner: "PM",
              priority: "high",
              timeframe: "Today",
            },
          ]
        : [],
    earlyWarnings: signals.map((s) => s.detail).slice(0, 4),
    fallback: true,
  };
}