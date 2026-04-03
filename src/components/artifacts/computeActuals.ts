// computeActuals.ts
// Pure function — approved_days × rate_card_rate, grouped by cost_line_id × month_key.
// This is the single source of truth for all "Actual" values in the financial plan.
// Nothing else should write to the actual field — it is derived-only.
//
// TWO sources of actuals:
// 1. Resource-plan entries (resource_id matches a plan resource with cost_line_id + day_rate)
// 2. Weekly timesheet entries (resource_id === "__weekly__") — mapped to people cost lines
//    using the implied day rate: budgeted / planned_days_from_resources.
//    If no resources exist, approved days are shown at £0 but still counted.

import type { Resource, CostLine } from "./FinancialPlanEditor";

// ── Timesheet types ───────────────────────────────────────────────────────────

export type TimesheetEntry = {
  /** FK → Resource.id, OR "__weekly__" for weekly timesheet bridge entries */
  resource_id: string;
  /** YYYY-MM */
  month_key: string;
  /** Number of approved days in this month */
  approved_days: number;
};

export type ActualsByLine = Record<string, Record<string, number>>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function impliedDayRate(resources: Resource[], costLines: CostLine[]): { lineId: string; rate: number } | null {
  // Find people cost lines
  const peopleLines = costLines.filter(l => l.category === "people");
  if (peopleLines.length === 0) return null;

  const targetLine = peopleLines[0];

  // Try to get avg day rate from linked resources
  const linkedResources = resources.filter(r => r.cost_line_id === targetLine.id);
  if (linkedResources.length > 0) {
    const rates = linkedResources.map(r =>
      r.rate_type === "day_rate"
        ? Number(r.day_rate) || 0
        : (Number(r.monthly_cost) || 0) / 20
    ).filter(r => r > 0);
    if (rates.length > 0) {
      const avg = rates.reduce((s, r) => s + r, 0) / rates.length;
      return { lineId: targetLine.id, rate: avg };
    }
  }

  // Fall back: use budgeted / planned days if available
  const budgeted = Number(targetLine.budgeted) || 0;
  const totalPlannedDays = resources
    .filter(r => r.cost_line_id === targetLine.id)
    .reduce((s, r) => {
      if (r.rate_type === "day_rate") return s + (Number(r.planned_days) || 0);
      return s + (Number(r.planned_months) || 0) * 20;
    }, 0);

  if (budgeted > 0 && totalPlannedDays > 0) {
    return { lineId: targetLine.id, rate: budgeted / totalPlannedDays };
  }

  // Last resort: show days at £0 cost but still populate the line
  return { lineId: targetLine.id, rate: 0 };
}

// ── Core computation ──────────────────────────────────────────────────────────

export function computeActuals(
  resources: Resource[],
  entries: TimesheetEntry[],
  costLines?: CostLine[],  // optional — needed to handle __weekly__ entries
): ActualsByLine {
  // Build lookup: resource_id → { lineId, dayRate }
  const dayRateByResourceId = new Map<string, { lineId: string; dayRate: number }>();

  for (const r of resources) {
    if (!r.cost_line_id) continue;
    let dayRate = 0;
    if (r.rate_type === "day_rate") {
      dayRate = Number(r.day_rate) || 0;
    } else {
      dayRate = (Number(r.monthly_cost) || 0) / 20;
    }
    if (dayRate <= 0) continue;
    dayRateByResourceId.set(r.id, { lineId: r.cost_line_id, dayRate });
  }

  // Pre-compute implied rate for weekly entries (only if costLines provided)
  const weeklyMapping = costLines ? impliedDayRate(resources, costLines) : null;

  const result: ActualsByLine = {};

  for (const entry of entries) {
    if (entry.approved_days <= 0) continue;

    let lineId: string;
    let dayRate: number;

    if (entry.resource_id === "__weekly__") {
      // Weekly timesheet bridge — map to people cost line
      if (!weeklyMapping) continue;
      lineId  = weeklyMapping.lineId;
      dayRate = weeklyMapping.rate;
    } else {
      const lookup = dayRateByResourceId.get(entry.resource_id);
      if (!lookup) continue;
      lineId  = lookup.lineId;
      dayRate = lookup.dayRate;
    }

    const cost = Math.round(entry.approved_days * dayRate * 100) / 100;
    if (!result[lineId]) result[lineId] = {};
    result[lineId][entry.month_key] = (result[lineId][entry.month_key] ?? 0) + cost;
  }

  return result;
}

export function computeActualTotalsPerLine(
  resources: Resource[],
  entries: TimesheetEntry[],
  costLines?: CostLine[],
): Record<string, number> {
  const byLine = computeActuals(resources, entries, costLines);
  const totals: Record<string, number> = {};
  for (const [lineId, months] of Object.entries(byLine)) {
    totals[lineId] = Object.values(months).reduce((s, v) => s + v, 0);
  }
  return totals;
}

export function applyActualsToMonthlyData(
  monthlyData: Record<string, Record<string, {
    budget: number | ""; actual: number | ""; forecast: number | "";
    customer_rate?: number | ""; locked?: boolean;
  }>>,
  actualsByLine: ActualsByLine,
): typeof monthlyData {
  const result = structuredClone(monthlyData);

  for (const [lineId, months] of Object.entries(actualsByLine)) {
    if (!result[lineId]) result[lineId] = {};
    for (const [mk, cost] of Object.entries(months)) {
      const existing = result[lineId][mk] ?? {
        budget: "", actual: "", forecast: "", customer_rate: "", locked: false,
      };
      result[lineId][mk] = { ...existing, actual: cost };
    }
  }

  return result;
}