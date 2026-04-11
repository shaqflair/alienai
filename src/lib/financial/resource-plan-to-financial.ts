import type { MonthlyData, MonthlyEntry, FYConfig } from "@/components/artifacts/FinancialPlanMonthlyView";
import type { CostLine } from "@/components/artifacts/FinancialPlanEditor";

export type ResourceAllocation = {
  id:                     string;        // role_requirement id
  person_id:              string | null; // filled_by_person_id (null = unfilled)
  person_name:            string | null;
  role_title:             string;
  seniority_level:        string | null;
  required_days_per_week: number;        // e.g. 2
  start_date:             string;        // ISO date "YYYY-MM-DD"
  end_date:               string;        // ISO date "YYYY-MM-DD"
  day_rate:               number | null; // from rate card, null if not found
  rate_source:            "personal" | "role" | null;
};

export type MonthlyResourceForecast = {
  // key: "YYYY-MM"
  [monthKey: string]: {
    // key: allocation id
    [allocationId: string]: {
      person_name:   string | null;
      role_title:    string;
      days:          number;        // pro-rated days for this month
      day_rate:      number | null;
      cost:          number | null; // days × day_rate, null if no rate
      is_partial:    boolean;       // true if start or end month
    };
  };
};

export type ResourcePlanForecastResult = {
  monthly_data_patch: MonthlyData;
  monthly_totals: Record<string, { days: number; cost: number; has_missing_rates: boolean }>;
  missing_rates: Array<{ id: string; role_title: string; person_name: string | null }>;
  detail: MonthlyResourceForecast;
};

const WEEKS_PER_MONTH = 4.333_333;

function daysInMonthForAllocation(
  year: number,
  month: number, // 1-12
  allocStart: Date,
  allocEnd: Date,
  daysPerWeek: number
): { days: number; isPartial: boolean } {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd   = new Date(Date.UTC(year, month, 0)); 

  const overlapStart = allocStart > monthStart ? allocStart : monthStart;
  const overlapEnd   = allocEnd   < monthEnd   ? allocEnd   : monthEnd;

  if (overlapStart > overlapEnd) return { days: 0, isPartial: false };

  const daysInMonth = monthEnd.getUTCDate();
  const overlapDays = Math.round(
    (overlapEnd.getTime() - overlapStart.getTime()) / 86_400_000
  ) + 1;

  const fraction = overlapDays / daysInMonth;
  const isPartial = overlapDays < daysInMonth;

  const days = Math.round(fraction * daysPerWeek * WEEKS_PER_MONTH * 10) / 10;

  return { days, isPartial };
}

function buildMonthKeys(cfg: FYConfig): string[] {
  const keys: string[] = [];
  let m = cfg.fy_start_month, y = cfg.fy_start_year;
  for (let i = 0; i < cfg.num_months; i++) {
    keys.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) { m = 1; y++; }
  }
  return keys;
}

export function computeResourcePlanForecast(
  allocations:     ResourceAllocation[],
  costLineId:      string,
  fyConfig:        FYConfig,
  existingData:    MonthlyData,
  overriddenMonths: Set<string> = new Set()
): ResourcePlanForecastResult {
  const monthKeys = buildMonthKeys(fyConfig);
  const detail: MonthlyResourceForecast = {};
  const missingRates: ResourcePlanForecastResult["missing_rates"] = [];
  const missingRateIds = new Set<string>();

  for (const alloc of allocations) {
    if (!alloc.start_date || !alloc.end_date) continue;

    const allocStart = new Date(alloc.start_date + "T00:00:00Z");
    const allocEnd   = new Date(alloc.end_date   + "T00:00:00Z");

    if (!alloc.day_rate && !missingRateIds.has(alloc.id)) {
      missingRates.push({ id: alloc.id, role_title: alloc.role_title, person_name: alloc.person_name });
      missingRateIds.add(alloc.id);
    }

    for (const mk of monthKeys) {
      const [y, mo] = mk.split("-").map(Number);
      const { days, isPartial } = daysInMonthForAllocation(y, mo, allocStart, allocEnd, alloc.required_days_per_week);

      if (days <= 0) continue;

      if (!detail[mk]) detail[mk] = {};
      detail[mk][alloc.id] = {
        person_name: alloc.person_name,
        role_title:  alloc.role_title,
        days,
        day_rate:    alloc.day_rate,
        cost:        alloc.day_rate != null ? Math.round(days * alloc.day_rate) : null,
        is_partial:  isPartial,
      };
    }
  }

  const monthlyTotals: ResourcePlanForecastResult["monthly_totals"] = {};
  const patch: MonthlyData = { ...existingData };

  if (!patch[costLineId]) patch[costLineId] = {};

  for (const mk of monthKeys) {
    if (overriddenMonths.has(mk)) continue;

    const monthDetail = detail[mk] ?? {};
    const entries = Object.values(monthDetail);

    let totalDays  = 0;
    let totalCost  = 0;
    let hasMissing = false;

    for (const e of entries) {
      totalDays += e.days;
      if (e.cost != null) {
        totalCost += e.cost;
      } else {
        hasMissing = true;
      }
    }

    monthlyTotals[mk] = {
      days:              Math.round(totalDays * 10) / 10,
      cost:              Math.round(totalCost),
      has_missing_rates: hasMissing,
    };

    const existing = patch[costLineId]?.[mk] ?? { budget: "", actual: "", forecast: "", locked: false };

    patch[costLineId] = {
      ...patch[costLineId],
      [mk]: {
        ...existing,
        forecast: totalCost > 0 ? totalCost : existing.forecast,
        budget:   existing.budget !== "" ? existing.budget : (totalCost > 0 ? totalCost : ""),
        locked:   false,
      } satisfies MonthlyEntry,
    };
  }

  return {
    monthly_data_patch: patch,
    monthly_totals:      monthlyTotals,
    missing_rates:       missingRates,
    detail,
  };
}

export function mapRoleRequirementsToAllocations(
  roleRows: Array<{
    id: string;
    role_title: string;
    seniority_level?: string | null;
    required_days_per_week: number;
    start_date: string;
    end_date: string;
    filled_by_person_id?: string | null;
    notes?: string | null;
  }>,
  rateCardMatches: Map<string, { day_rate: number; rate_source: "personal" | "role" }>,
  personNames:      Map<string, string>
): ResourceAllocation[] {
  return roleRows.map(row => {
    const rateMatch = rateCardMatches.get(row.id) ?? null;
    const personId  = row.filled_by_person_id ?? null;
    return {
      id:                     row.id,
      person_id:              personId,
      person_name:            personId ? (personNames.get(personId) ?? null) : null,
      role_title:             row.role_title,
      seniority_level:        row.seniority_level ?? null,
      required_days_per_week: row.required_days_per_week,
      start_date:             row.start_date,
      end_date:               row.end_date,
      day_rate:               rateMatch?.day_rate ?? null,
      rate_source:            rateMatch?.rate_source ?? null,
    };
  });
}

export function findOrCreatePeopleCostLine(costLines: CostLine[]): { line: CostLine; isNew: boolean } {
  const existing = costLines.find(l => l.category === "people");
  if (existing) return { line: existing, isNew: false };

  const newLine: CostLine = {
    id:          Math.random().toString(36).slice(2, 10),
    category:    "people",
    description: "People & Contractors (resource plan)",
    budgeted:    "",
    actual:      "",
    forecast:    "",
    notes:       "Auto-calculated from resource plan. Admin override available.",
    override:    false,
  };
  return { line: newLine, isNew: true };
}

export function formatMonthlySummary(
  totals: ResourcePlanForecastResult["monthly_totals"],
  currency: string
): string {
  const sym = { GBP: "£", USD: "$", EUR: "€", AUD: "A$", CAD: "C$" }[currency] ?? "£";
  const months = Object.values(totals).filter(t => t.cost > 0);
  if (!months.length) return "No costs calculated";

  const totalCost  = months.reduce((s, t) => s + t.cost, 0);
  const avgMonthly = Math.round(totalCost / months.length);

  return `${sym}${totalCost.toLocaleString()} total · ${sym}${avgMonthly.toLocaleString()}/month avg across ${months.length} months`;
}
