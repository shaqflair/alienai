// computeActuals.ts
// Pure function — approved_days × rate_card_rate, grouped by cost_line_id × month_key.
// This is the single source of truth for all "Actual" values in the financial plan.
// Nothing else should write to the actual field — it is derived-only.

import type { Resource } from "./FinancialPlanEditor";

// ── Timesheet types ───────────────────────────────────────────────────────────

/**
 * One approved timesheet entry: a resource, a month, and how many days were approved.
 * Stored in `timesheet_entries` table; only status="approved" rows are used here.
 */
export type TimesheetEntry = {
  /** FK → Resource.id (the plan resource row, NOT auth.users.id) */
  resource_id: string;
  /** YYYY-MM */
  month_key: string;
  /** Number of approved days in this month for this resource */
  approved_days: number;
};

/**
 * Result shape: cost_line_id → month_key → computed actual cost (£).
 */
export type ActualsByLine = Record<string, Record<string, number>>;

// ── Core computation ──────────────────────────────────────────────────────────

/**
 * computeActuals
 *
 * For each timesheet entry:
 * cost = approved_days × rate_card_rate
 * where rate_card_rate = resource.day_rate (if rate_type === "day_rate")
 * = resource.monthly_cost / 20 (if rate_type === "monthly_cost",
 * normalised to a daily equivalent using 20 working days/month)
 *
 * Results are accumulated per (cost_line_id, month_key).
 * Resources with no cost_line_id are ignored.
 *
 * @param resources - The plan's resource list (with rate card data).
 * @param entries   - Approved timesheet entries (status === "approved" only).
 * @returns         - ActualsByLine map.
 */
export function computeActuals(
  resources: Resource[],
  entries: TimesheetEntry[],
): ActualsByLine {
  // Build a quick lookup: resource_id → effective day rate
  const dayRateByResourceId = new Map<string, { lineId: string; dayRate: number }>();

  for (const r of resources) {
    if (!r.cost_line_id) continue;

    let dayRate = 0;
    if (r.rate_type === "day_rate") {
      dayRate = Number(r.day_rate) || 0;
    } else {
      // monthly_cost → daily equivalent (20 working days per month)
      dayRate = (Number(r.monthly_cost) || 0) / 20;
    }

    if (dayRate <= 0) continue;

    dayRateByResourceId.set(r.id, { lineId: r.cost_line_id, dayRate });
  }

  const result: ActualsByLine = {};

  for (const entry of entries) {
    const lookup = dayRateByResourceId.get(entry.resource_id);
    if (!lookup) continue;
    if (entry.approved_days <= 0) continue;

    const { lineId, dayRate } = lookup;
    const cost = Math.round(entry.approved_days * dayRate * 100) / 100;

    if (!result[lineId]) result[lineId] = {};
    result[lineId][entry.month_key] = (result[lineId][entry.month_key] ?? 0) + cost;
  }

  return result;
}

/**
 * computeActualTotalsPerLine
 *
 * Convenience wrapper — returns the total actual cost per cost_line_id
 * (summed across all months). Used to populate CostLine.actual.
 */
export function computeActualTotalsPerLine(
  resources: Resource[],
  entries: TimesheetEntry[],
): Record<string, number> {
  const byLine = computeActuals(resources, entries);
  const totals: Record<string, number> = {};
  for (const [lineId, months] of Object.entries(byLine)) {
    totals[lineId] = Object.values(months).reduce((s, v) => s + v, 0);
  }
  return totals;
}

/**
 * applyActualsToMonthlyData
 *
 * Writes the computed actuals into a MonthlyData snapshot.
 * Existing budget / forecast values are preserved; only `actual` is overwritten.
 */
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
