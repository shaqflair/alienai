import type { FinancialPlanContent, CostLine, ChangeExposure } from "@/components/artifacts/FinancialPlanEditor";
import type { MonthlyData, FYConfig } from "@/components/artifacts/FinancialPlanMonthlyView";

// ─────────────────────────────────────────────────────────────────────────────
// Signal types
// ─────────────────────────────────────────────────────────────────────────────

export type SignalSeverity = "critical" | "warning" | "info";

export type SignalCode =
  | "FORECAST_TRENDING_OVER_BUDGET"
  | "QUARTER_BREACH_PROJECTED"
  | "SPEND_ACCELERATION"
  | "STALE_FORECAST"
  | "PLAN_NOT_UPDATED"
  | "FORECAST_SPIKE"
  | "CHANGE_REQUEST_EXPOSURE"
  | "APPROVAL_DELAY_COST_RISK"
  | "UNDERSPEND_RISK"
  | "RAID_COST_SIGNAL";

export type Signal = {
  code: SignalCode;
  severity: SignalSeverity;
  scope: "plan" | "quarter" | "month" | "line";
  scopeKey: string;
  title: string;
  detail: string;
  value?: number;
  threshold?: number;
  affectedLines?: string[];
  aiContext?: string; 
};

export type AIDriver = {
  title: string;
  explanation: string;
  severity: "critical" | "warning" | "info";
  quarter: string | null;
  recommended_action: string;
};

export type AIWarning = {
  warning: string;
  likelihood: "high" | "medium" | "low";
  potential_impact: string;
};

export type FinancialAIAnalysis = {
  headline: string;
  overall_rag: "red" | "amber" | "green";
  narrative: string;
  drivers: AIDriver[];
  early_warnings: AIWarning[];
  pm_actions: string[];
  fallback?: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function buildMonthKeysFromConfig(cfg: FYConfig): string[] {
  const keys: string[] = [];
  let month = cfg.fy_start_month, year = cfg.fy_start_year;
  for (let i = 0; i < cfg.num_months; i++) {
    keys.push(`${year}-${String(month).padStart(2, "0")}`);
    if (++month > 12) { month = 1; year++; }
  }
  return keys;
}

export function buildQuartersFromKeys(keys: string[], fyStart: number) {
  const qs: { label: string; months: string[] }[] = [];
  for (let i = 0; i < keys.length; i += 3) {
    const slice = keys.slice(i, i + 3);
    if (!slice.length) break;
    const [y, m] = slice[0].split("-").map(Number);
    const fyYear = m >= fyStart ? y : y - 1;
    qs.push({ label: `Q${Math.floor(i / 3) + 1} FY${fyYear}/${String(fyYear + 1).slice(2)}`, months: slice });
  }
  return qs;
}

function currentMonthKey(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
}

function isPast(mk: string) { return mk < currentMonthKey(); }

export function sumMonthsForLines(
  lines: CostLine[],
  monthlyData: MonthlyData,
  months: string[],
  field: "budget" | "actual" | "forecast"
): number {
  return lines.reduce((s, l) =>
    s + months.reduce((ms, mk) => ms + (Number(monthlyData[l.id]?.[mk]?.[field]) || 0), 0), 0);
}

function weeksSince(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24 * 7);
}

function monthLabel(mk: string): string {
  const [y, m] = mk.split("-");
  return `${MONTH_SHORT[Number(m) - 1]} ${y}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule engine 
// ─────────────────────────────────────────────────────────────────────────────

export function analyseFinancialPlan(
  content: FinancialPlanContent,
  monthlyData: MonthlyData,
  fyConfig: FYConfig,
  options?: {
    staleThresholdWeeks?: number;
    forecastTrendingPct?: number;
    spendAccelPct?: number;
    forecastSpikePct?: number;
    lastUpdatedAt?: string;
  }
): Signal[] {
  const signals: Signal[] = [];
  const staleWeeks    = options?.staleThresholdWeeks  ?? 3;
  const trendingPct   = options?.forecastTrendingPct  ?? 0.90;
  const accelPct      = options?.spendAccelPct        ?? 1.15;
  const spikePct      = options?.forecastSpikePct     ?? 0.20;

  const lines         = content.cost_lines           ?? [];
  const changes       = content.change_exposure      ?? [];
  const approvedBudget = Number(content.total_approved_budget) || 0;
  const allMonths     = buildMonthKeysFromConfig(fyConfig);
  const quarters      = buildQuartersFromKeys(allMonths, fyConfig.fy_start_month);

  // 1. Plan setup check
  const hasData = allMonths.some(mk =>
    lines.some(l => {
      const e = monthlyData[l.id]?.[mk];
      return e && (e.budget !== "" || e.actual !== "" || e.forecast !== "");
    })
  );
  if (!hasData && lines.length > 0) {
    signals.push({
      code: "PLAN_NOT_UPDATED",
      severity: "warning",
      scope: "plan",
      scopeKey: "plan",
      title: "Monthly phasing not set up",
      detail: "No monthly budget, actuals or forecast data entered.",
      aiContext: "Plan has zero monthly phasing data.",
    });
  }

  // 2. Stale forecast check
  if (options?.lastUpdatedAt) {
    const age = weeksSince(options.lastUpdatedAt);
    if (age > staleWeeks) {
      signals.push({
        code: "STALE_FORECAST",
        severity: age > staleWeeks * 2 ? "critical" : "warning",
        scope: "plan",
        scopeKey: "plan",
        title: `Forecast not updated for ${Math.round(age)} weeks`,
        detail: `Last updated ${Math.round(age)} weeks ago.`,
        value: Math.round(age),
        aiContext: `Plan stale by ${Math.round(age - staleWeeks)} weeks.`,
      });
    }
  }

  // 3. Quarter breaches & Trending
  for (const q of quarters) {
    const pastMonths   = q.months.filter(isPast);
    const qBudget   = sumMonthsForLines(lines, monthlyData, q.months, "budget");
    const qActual   = sumMonthsForLines(lines, monthlyData, pastMonths, "actual");
    const qForecast = sumMonthsForLines(lines, monthlyData, q.months, "forecast");

    if (!qBudget) continue;

    const forecastPct = qForecast / qBudget;
    if (forecastPct >= trendingPct && forecastPct < 1.0) {
      signals.push({
        code: "FORECAST_TRENDING_OVER_BUDGET",
        severity: "warning",
        scope: "quarter",
        scopeKey: q.label,
        title: `${q.label} forecast approaching budget ceiling`,
        detail: `Forecast is within £${(qBudget - qForecast).toLocaleString()} of budget.`,
        aiContext: `${q.label} at ${(forecastPct*100).toFixed(1)}% of budget.`,
      });
    }

    if (qForecast > qBudget) {
      signals.push({
        code: "QUARTER_BREACH_PROJECTED",
        severity: "critical",
        scope: "quarter",
        scopeKey: q.label,
        title: `${q.label} forecast over budget`,
        detail: `Overrun by £${(qForecast - qBudget).toLocaleString()}.`,
        aiContext: `${q.label} breach by £${(qForecast - qBudget).toLocaleString()}.`,
      });
    }
  }

  return signals.sort((a, b) => (a.severity === "critical" ? -1 : 1));
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule-based AI fallback
// ─────────────────────────────────────────────────────────────────────────────

export function ruleBasedAnalysis(
  signals: Signal[],
  content: FinancialPlanContent,
  monthlyData: MonthlyData,
  fyConfig: FYConfig,
): FinancialAIAnalysis {
  const criticals = signals.filter(s => s.severity === "critical");
  const rag: "red" | "amber" | "green" = criticals.length > 0 ? "red" : signals.length > 0 ? "amber" : "green";

  return {
    headline: criticals.length > 0 ? "Critical financial risks detected" : "Financial plan stable",
    overall_rag: rag,
    narrative: `Detected ${signals.length} total signals. PM review suggested for phased forecasts.`,
    drivers: signals.slice(0, 3).map(s => ({
      title: s.title,
      explanation: s.detail,
      severity: s.severity,
      quarter: s.scope === "quarter" ? s.scopeKey : null,
      recommended_action: "Review forecast accuracy."
    })),
    early_warnings: [],
    pm_actions: ["Update monthly actuals", "Review Q-on-Q variances"],
    fallback: true
  };
}

export const SEVERITY_STYLE = {
  critical: { bg: "bg-red-50", border: "border-red-300", text: "text-red-800" },
  warning: { bg: "bg-amber-50", border: "border-amber-300", text: "text-amber-800" },
  info: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-800" },
};
