import type { Resource, CostLine, FYConfig } from "./FinancialPlanEditor";
import type { MonthlyData } from "./FinancialPlanMonthlyView";

export type MonthKey = string;

function buildMonthKeys(fyConfig: FYConfig): MonthKey[] {
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

export function syncResourcesToMonthlyData(
  resources: Resource[],
  costLines: CostLine[],
  monthlyData: MonthlyData,
  fyConfig: FYConfig,
): MonthlyData {
  const allKeys = buildMonthKeys(fyConfig);
  if (!allKeys.length) return monthlyData;

  const result: MonthlyData = {};
  for (const [lineId, months] of Object.entries(monthlyData)) {
    result[lineId] = {};
    for (const [mk, entry] of Object.entries(months)) {
      result[lineId][mk] = { ...entry };
    }
  }

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
      const rStart = (r as any).start_month as string | undefined;
      const startIdx = rStart ? allKeys.indexOf(rStart) : 0;
      const safeStart = startIdx >= 0 ? startIdx : 0;
      const endIdx = Math.min(safeStart + durationMonths - 1, allKeys.length - 1);
      for (let i = safeStart; i <= endIdx; i++) {
        const mk = allKeys[i];
        const isLast = i === endIdx;
        const actualMonths = endIdx - safeStart + 1;
        monthCosts[mk] += isLast
          ? monthlyCost * durationMonths - monthlyCost * (actualMonths - 1)
          : monthlyCost;
      }
    }

    if (!result[lineId]) result[lineId] = {};
    for (const mk of allKeys) {
      const cost = Math.round(monthCosts[mk] * 100) / 100;
      const existing = result[lineId][mk] ?? { budget: "", actual: "", forecast: "", customer_rate: "", locked: false };
      result[lineId][mk] = {
        ...existing,
        forecast: cost > 0 ? cost : existing.forecast,
        budget: cost > 0 && (existing.budget === "" || existing.budget === 0) ? cost : existing.budget,
      };
    }
  }

  return result;
}

export function previewSync(
  resources: Resource[],
  costLines: CostLine[],
  monthlyData: MonthlyData,
  fyConfig: FYConfig,
): { lineId: string; lineLabel: string; totalBefore: number; totalAfter: number; monthsAffected: number }[] {
  const synced = syncResourcesToMonthlyData(resources, costLines, monthlyData, fyConfig);
  const allKeys = buildMonthKeys(fyConfig);

  return costLines
    .filter(l => !l.override)
    .map(line => {
      const before = allKeys.reduce((s, mk) => s + (Number(monthlyData[line.id]?.[mk]?.forecast) || 0), 0);
      const after  = allKeys.reduce((s, mk) => s + (Number(synced[line.id]?.[mk]?.forecast) || 0), 0);
      const monthsAffected = allKeys.filter(mk =>
        (Number(synced[line.id]?.[mk]?.forecast) || 0) !== (Number(monthlyData[line.id]?.[mk]?.forecast) || 0)
      ).length;
      return { lineId: line.id, lineLabel: line.description || line.category, totalBefore: before, totalAfter: after, monthsAffected };
    })
    .filter(r => r.totalBefore !== r.totalAfter);
}
