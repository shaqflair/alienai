// computeActuals.ts
// Pure function — approved_days × rate_card_rate, grouped by cost_line_id × month_key.
// This is the single source of truth for all "Actual" values in the financial plan.
// Nothing else should write to the actual field — it is derived-only.
//
// TWO sources of actuals:
// 1. Resource-plan entries (resource_id matches a plan resource with cost_line_id + day_rate)
// 2. Weekly timesheet entries (resource_id === "__weekly__") — approved_days holds
//    pre-computed £ cost (days × rate card rate from the server action).
//    dayRate=1 so the cost passes through unchanged.

import type { Resource, CostLine } from "./FinancialPlanEditor";

// ── Timesheet types ───────────────────────────────────────────────────────────

export type TimesheetEntry = {
  /** FK → Resource.id, OR "__weekly__" for weekly timesheet bridge entries */
  resource_id: string;
  /** YYYY-MM */
  month_key: string;
  /** Number of approved days (legacy) OR pre-computed £ cost (weekly, resource_id === "__weekly__") */
  approved_days: number;
};

export type ActualsByLine = Record<string, Record<string, number>>;

// ── Core computation ──────────────────────────────────────────────────────────

export function computeActuals(
  resources: Resource[],
  entries: TimesheetEntry[],
  costLines?: CostLine[],
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

  const result: ActualsByLine = {};

  for (const entry of entries) {
    if (entry.approved_days <= 0) continue;

    let lineId: string;
    let dayRate: number;

    if (entry.resource_id === "__weekly__") {
      // approved_days already holds pre-computed £ cost (days × rate card rate).
      // Set dayRate=1 so the value passes through unchanged.
      const peopleLine = costLines?.find(l => l.category === "people");
      if (!peopleLine) continue;
      lineId  = peopleLine.id;
      dayRate = 1;
    } else {
      // Legacy resource-plan entry — look up the resource's rate
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