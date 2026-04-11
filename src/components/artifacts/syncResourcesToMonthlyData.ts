// syncResourcesToMonthlyData.ts
// Syncs resource plan → monthly forecast/budget.
// When timesheetEntries are provided, also writes the `actual` field
// (approved_days × rate_card_rate) per month per cost line.

import type { Resource, CostLine } from "./FinancialPlanEditor";
import type { MonthlyData, FYConfig } from "./FinancialPlanMonthlyView";
import { computeActuals, type TimesheetEntry } from "./computeActuals";

export type MonthKey = string;

// ── Month key builder ────────────────────────────────────────────────────────

export function buildMonthKeys(fyConfig: FYConfig): MonthKey[] {
  const keys: MonthKey[] = [];
  let year = fyConfig.fy_start_year;
  let month = fyConfig.fy_start_month; // 1-based
  for (let i = 0; i < (fyConfig.num_months ?? 12); i++) {
    keys.push(`${year}-${String(month).padStart(2, "0")}`);
    month++;
    if (month > 12) { month = 1; year++; }
  }
  return keys;
}

// ── Per-resource monthly cost breakdown ─────────────────────────────────────

function resourceMonthlyBreakdown(r: Resource): { monthlyCost: number; durationMonths: number } | null {
  if (r.rate_type === "monthly_cost") {
    const cost = Number(r.monthly_cost) || 0;
    const months = Number(r.planned_months) || 0;
    if (!cost || !months) return null;
    return { monthlyCost: cost, durationMonths: months };
  }
  const rate = Number(r.day_rate) || 0;
  const days = Number(r.planned_days) || 0;
  if (!rate || !days) return null;
  const explicitMonths = Number(r.planned_months) || 0;
  const durationMonths = explicitMonths > 0 ? explicitMonths : Math.max(1, Math.ceil(days / 20));
  return { monthlyCost: (rate * days) / durationMonths, durationMonths };
}

// ── Main sync ────────────────────────────────────────────────────────────────

/**
 * syncResourcesToMonthlyData
 *
 * 1. Phases resource costs across FY months → writes `forecast` and `budget`.
 * 2. If `timesheetEntries` are provided, also writes `actual` per month
 *    (approved_days × effective day rate).
 *
 * The `actual` field is only written — never computed from existing monthly data.
 * Budget and forecast for lines with `override: true` are left untouched.
 */
export function syncResourcesToMonthlyData(
  resources: Resource[],
  costLines: CostLine[],
  monthlyData: MonthlyData,
  fyConfig: FYConfig,
  timesheetEntries: TimesheetEntry[] = [],
): MonthlyData {
  const allKeys = buildMonthKeys(fyConfig);
  if (!allKeys.length) return monthlyData;

  // Deep-copy existing data so we never mutate the original
  const result: MonthlyData = {};
  for (const [lineId, months] of Object.entries(monthlyData)) {
    result[lineId] = {};
    for (const [mk, entry] of Object.entries(months)) {
      result[lineId][mk] = { ...entry };
    }
  }

  // ── Phase planned costs (forecast + budget) ─────────────────────────────

  const byLine: Record<string, Resource[]> = {};
  for (const r of resources) {
    if (!r.cost_line_id) continue;
    const line = costLines.find(l => l.id === r.cost_line_id);
    if (!line || line.override) continue;
    if (!byLine[r.cost_line_id]) byLine[r.cost_line_id] = [];
    byLine[r.cost_line_id].push(r);
  }

  for (const [lineId, lineResources] of Object.entries(byLine)) {
    const monthCosts: Record<string, number> = {};
    for (const mk of allKeys) monthCosts[mk] = 0;

    for (const r of lineResources) {
      const breakdown = resourceMonthlyBreakdown(r);
      if (!breakdown) continue;
      const { monthlyCost, durationMonths } = breakdown;
      const rStart = r.start_month as string | undefined;
      const startIdx = rStart ? allKeys.indexOf(rStart) : 0;
      const safeStart = startIdx >= 0 ? startIdx : 0;
      const endIdx = Math.min(safeStart + durationMonths - 1, allKeys.length - 1);

      for (let i = safeStart; i <= endIdx; i++) {
        const mk = allKeys[i];
        const isLast = i === endIdx;
        const actualMonths = endIdx - safeStart + 1;
        // Remainder goes in the last month to avoid floating-point drift
        monthCosts[mk] += isLast
          ? monthlyCost * durationMonths - monthlyCost * (actualMonths - 1)
          : monthlyCost;
      }
    }

    if (!result[lineId]) result[lineId] = {};
    for (const mk of allKeys) {
      const cost = Math.round(monthCosts[mk] * 100) / 100;
      const existing = result[lineId][mk] ?? {
        budget: "", actual: "", forecast: "", customer_rate: "", locked: false,
      };
      result[lineId][mk] = {
        ...existing,
        forecast: cost > 0 ? cost : existing.forecast,
        budget: cost > 0 && (existing.budget === "" || existing.budget === 0) ? cost : existing.budget,
      };
    }
  }

  // ── Write actuals from approved timesheets ──────────────────────────────
  // This runs even for lines with override:true — actuals are always derived
  // from timesheets regardless of whether budget/forecast are manually overridden.

  if (timesheetEntries.length > 0) {
    const actualsByLine = computeActuals(resources, timesheetEntries);
    for (const [lineId, months] of Object.entries(actualsByLine)) {
      if (!result[lineId]) result[lineId] = {};
      for (const [mk, cost] of Object.entries(months)) {
        const existing = result[lineId][mk] ?? {
          budget: "", actual: "", forecast: "", customer_rate: "", locked: false,
        };
        result[lineId][mk] = { ...existing, actual: cost };
      }
    }
  }

  return result;
}

// ── Preview sync (unchanged logic, timesheet-aware) ──────────────────────────

export function previewSync(
  resources: Resource[],
  costLines: CostLine[],
  monthlyData: MonthlyData,
  fyConfig: FYConfig,
  timesheetEntries: TimesheetEntry[] = [],
): { lineId: string; lineLabel: string; totalBefore: number; totalAfter: number; monthsAffected: number }[] {
  const synced  = syncResourcesToMonthlyData(resources, costLines, monthlyData, fyConfig, timesheetEntries);
  const allKeys = buildMonthKeys(fyConfig);

  return costLines
    .filter(l => !l.override)
    .map(line => {
      const before = allKeys.reduce(
        (s, mk) => s + (Number(monthlyData[line.id]?.[mk]?.forecast) || 0), 0
      );
      const after = allKeys.reduce(
        (s, mk) => s + (Number(synced[line.id]?.[mk]?.forecast) || 0), 0
      );
      const monthsAffected = allKeys.filter(mk =>
        (Number(synced[line.id]?.[mk]?.forecast) || 0) !==
        (Number(monthlyData[line.id]?.[mk]?.forecast) || 0)
      ).length;
      return {
        lineId:        line.id,
        lineLabel:     line.description || line.category,
        totalBefore:   before,
        totalAfter:    after,
        monthsAffected,
      };
    })
    .filter(r => r.totalBefore !== r.totalAfter);
}