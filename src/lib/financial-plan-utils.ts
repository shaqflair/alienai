// Shared utilities for extracting financial summary data from FinancialPlanContent
// Used by WeeklyReportEditor and ExecutiveDashboard

import type { FinancialPlanContent, CostLine } from "@/components/artifact/FinancialPlanEditor";

export type FinancialSnapshot = {
  currency: string;
  sym: string;
  approvedBudget: number;
  totalBudgeted: number;
  totalActual: number;
  totalForecast: number;
  forecastVariance: number | null;      // forecast - approvedBudget (null if no budget)
  forecastVariancePct: number | null;   // as %
  utilPct: number | null;               // totalForecast / approvedBudget * 100
  spentPct: number | null;              // totalActual / approvedBudget * 100
  pendingExposure: number;
  approvedExposure: number;
  totalExposure: number;
  overBudget: boolean;
  summary: string;
  varianceNarrative: string;
  lastUpdatedAt: string | null;
  topCategories: Array<{ category: string; forecast: number; pct: number }>;
  ragStatus: "red" | "amber" | "green";
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: "£", USD: "$", EUR: "€", AUD: "A$", CAD: "C$",
};

function sumField(lines: CostLine[], field: "budgeted" | "actual" | "forecast"): number {
  return lines.reduce((s, l) => s + (Number(l[field]) || 0), 0);
}

export function extractFinancialSnapshot(content: FinancialPlanContent): FinancialSnapshot {
  const lines = content.cost_lines ?? [];
  const sym = CURRENCY_SYMBOLS[content.currency] ?? "£";

  const approvedBudget = Number(content.total_approved_budget) || 0;
  const totalBudgeted  = sumField(lines, "budgeted");
  const totalActual    = sumField(lines, "actual");
  const totalForecast  = sumField(lines, "forecast");

  const forecastVariance    = approvedBudget ? totalForecast - approvedBudget : null;
  const forecastVariancePct = approvedBudget && forecastVariance !== null
    ? (forecastVariance / approvedBudget) * 100 : null;
  const utilPct  = approvedBudget ? Math.round((totalForecast / approvedBudget) * 100) : null;
  const spentPct = approvedBudget ? Math.round((totalActual   / approvedBudget) * 100) : null;

  const pendingExposure  = (content.change_exposure ?? []).filter(c => c.status === "pending")
    .reduce((s, c) => s + (Number(c.cost_impact) || 0), 0);
  const approvedExposure = (content.change_exposure ?? []).filter(c => c.status === "approved")
    .reduce((s, c) => s + (Number(c.cost_impact) || 0), 0);

  // Group forecast by category
  const byCategory: Record<string, number> = {};
  for (const l of lines) {
    byCategory[l.category] = (byCategory[l.category] || 0) + (Number(l.forecast) || 0);
  }
  const topCategories = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([category, forecast]) => ({
      category,
      forecast,
      pct: totalForecast > 0 ? Math.round((forecast / totalForecast) * 100) : 0,
    }));

  const overBudget = forecastVariance !== null && forecastVariance > 0;

  // RAG: red if >5% over budget or critical change exposure, amber if 0–5% or pending exposure, else green
  const ragStatus: "red" | "amber" | "green" =
    (forecastVariancePct !== null && forecastVariancePct > 5) || (pendingExposure > approvedBudget * 0.1)
      ? "red"
      : overBudget || pendingExposure > 0
        ? "amber"
        : "green";

  return {
    currency: content.currency,
    sym,
    approvedBudget,
    totalBudgeted,
    totalActual,
    totalForecast,
    forecastVariance,
    forecastVariancePct,
    utilPct,
    spentPct,
    pendingExposure,
    approvedExposure,
    totalExposure: approvedExposure + pendingExposure,
    overBudget,
    summary: content.summary ?? "",
    varianceNarrative: content.variance_narrative ?? "",
    lastUpdatedAt: content.last_updated_at ?? null,
    topCategories,
    ragStatus,
  };
}

export function fmtMoney(n: number, sym: string): string {
  if (!n && n !== 0) return "—";
  return `${sym}${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

export function fmtPct(n: number | null, opts?: { sign?: boolean }): string {
  if (n == null) return "—";
  const s = opts?.sign && n > 0 ? "+" : "";
  return `${s}${n.toFixed(1)}%`;
}
