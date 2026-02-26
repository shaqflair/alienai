"use client";

import { useState, useCallback, useMemo } from "react";
import { ChevronDown, ChevronRight, TrendingUp, TrendingDown, Lock } from "lucide-react";
import { CURRENCY_SYMBOLS, type Currency, type CostLine, type FinancialPlanContent } from "./FinancialPlanEditor";
import { InlineQuarterFlags, InlineMonthFlag } from "./FinancialIntelligencePanel";
import type { Signal } from "@/lib/financial-intelligence";

// ── Types ─────────────────────────────────────────────────────────────────────

export type MonthKey = string; // "YYYY-MM"

export type MonthlyEntry = {
  budget: number | "";
  actual: number | "";
  forecast: number | "";
  locked: boolean;
};

export type MonthlyData = Record<string, Record<MonthKey, MonthlyEntry>>;

export type FYConfig = {
  fy_start_month: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  fy_start_year: number;
  num_months: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export function buildMonthKeys(cfg: FYConfig): MonthKey[] {
  const keys: MonthKey[] = [];
  let month = cfg.fy_start_month, year = cfg.fy_start_year;
  for (let i = 0; i < cfg.num_months; i++) {
    keys.push(`${year}-${String(month).padStart(2, "0")}`);
    if (++month > 12) { month = 1; year++; }
  }
  return keys;
}

export function buildQuarters(keys: MonthKey[], fyStart: number) {
  const qs: { label: string; months: MonthKey[] }[] = [];
  for (let i = 0; i < keys.length; i += 3) {
    const slice = keys.slice(i, i + 3);
    if (!slice.length) break;
    const [y, m] = slice[0].split("-").map(Number);
    const fyYear = m >= fyStart ? y : y - 1;
    qs.push({ label: `Q${Math.floor(i / 3) + 1} FY${fyYear}/${String(fyYear + 1).slice(2)}`, months: slice });
  }
  return qs;
}

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmt(n: number | "" | null | undefined, sym: string): string {
  if (n === "" || n == null || isNaN(Number(n))) return "—";
  const v = Number(n);
  if (Math.abs(v) >= 1000) return `${sym}${Math.abs(v).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
  return `${sym}${Math.abs(v)}`;
}

function fmtK(n: number | "" | null | undefined, sym: string): string {
  if (n === "" || n == null || isNaN(Number(n))) return "—";
  const v = Number(n);
  if (v === 0) return "—";
  return `${sym}${(Math.abs(v) / 1000).toFixed(1)}k`;
}

function emptyEntry(): MonthlyEntry {
  return { budget: "", actual: "", forecast: "", locked: false };
}

function currentMonthKey(): MonthKey {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
}

function isCurrentMonth(mk: MonthKey) { return mk === currentMonthKey(); }
function isPastMonth(mk: MonthKey) { return mk < currentMonthKey(); }

function sumMonths(lines: CostLine[], md: MonthlyData, months: MonthKey[], field: "budget" | "actual" | "forecast"): number {
  return lines.reduce((s, l) => s + months.reduce((ms, mk) => ms + (Number(md[l.id]?.[mk]?.[field]) || 0), 0), 0);
}

// ── MoneyInput ────────────────────────────────────────────────────────────────

function MoneyInput({ value, onChange, sym, locked, highlight }: {
  value: number | ""; onChange: (v: number | "") => void;
  sym: string; locked: boolean; highlight?: "blue" | "green" | "red" | "gray";
}) {
  const colorMap = {
    blue: "text-blue-700 font-semibold", green: "text-emerald-700 font-semibold",
    red: "text-red-600 font-semibold", gray: "text-gray-400",
  };
  const cls = colorMap[highlight ?? "gray"];
  if (locked) {
    return (
      <div className={`flex items-center justify-end gap-1 px-1 py-1.5 text-xs ${cls}`}>
        <Lock className="w-2.5 h-2.5 opacity-40" />
        <span>{value !== "" ? fmtK(value, sym) : "—"}</span>
      </div>
    );
  }
  return (
    <input type="number" value={value}
      onChange={e => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      className={`w-full text-right text-xs px-1 py-1.5 bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-blue-300 rounded ${cls}`}
      placeholder="—" step={100} />
  );
}

// ── Quarter summary row ───────────────────────────────────────────────────────

function QuarterSummaryRow({ label, months, monthlyData, lines, sym, collapsed, onToggle, signals }: {
  label: string; months: MonthKey[]; monthlyData: MonthlyData;
  lines: CostLine[]; sym: string; collapsed: boolean;
  onToggle: () => void; signals: Signal[];
}) {
  const totals = useMemo(() => {
    let budget = 0, actual = 0, forecast = 0;
    for (const lineId of lines.map(l => l.id)) {
      for (const mk of months) {
        const e = monthlyData[lineId]?.[mk];
        budget += Number(e?.budget ?? 0) || 0;
        actual += Number(e?.actual ?? 0) || 0;
        forecast += Number(e?.forecast ?? 0) || 0;
      }
    }
    return { budget, actual, forecast };
  }, [months, monthlyData, lines]);

  const variance = totals.budget ? totals.forecast - totals.budget : null;
  const utilPct = totals.budget ? Math.round((totals.forecast / totals.budget) * 100) : null;
  const over = variance !== null && variance > 0;
  const quarterSignals = signals.filter(s => s.scopeKey === label);
  const hasCritical = quarterSignals.some(s => s.severity === "critical");
  const hasWarning = quarterSignals.some(s => s.severity === "warning");

  return (
    <tr
      className={`cursor-pointer select-none transition-colors ${hasCritical ? "bg-red-900" : hasWarning ? "bg-amber-900" : "bg-slate-800"} text-white`}
      onClick={onToggle}
    >
      <td className={`px-3 py-2.5 sticky left-0 z-10 min-w-[180px] ${hasCritical ? "bg-red-900" : hasWarning ? "bg-amber-900" : "bg-slate-800"}`}>
        <div className="flex items-center gap-2">
          {collapsed ? <ChevronRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />}
          <span className="text-xs font-bold tracking-wide text-white">{label}</span>
          <InlineQuarterFlags quarterLabel={label} signals={signals} />
        </div>
      </td>
      <td colSpan={months.length * 3} className="px-3 py-2.5">
        <div className="flex items-center gap-5 text-xs flex-wrap">
          <div><span className={`${hasCritical ? "text-red-300" : "text-slate-400"}`}>Budget </span><span className="font-semibold text-blue-300">{fmt(totals.budget, sym)}</span></div>
          <div><span className={`${hasCritical ? "text-red-300" : "text-slate-400"}`}>Actual </span><span className="font-semibold text-white">{fmt(totals.actual, sym)}</span></div>
          <div><span className={`${hasCritical ? "text-red-300" : "text-slate-400"}`}>Forecast </span>
            <span className={`font-semibold ${over ? "text-red-400" : "text-emerald-400"}`}>{fmt(totals.forecast, sym)}</span>
          </div>
          {variance !== null && (
            <div className={`flex items-center gap-1 ${over ? "text-red-400" : "text-emerald-400"}`}>
              {over ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              <span className="font-semibold">{over ? "+" : ""}{fmt(variance, sym)}</span>
              {totals.budget > 0 && (
                <span className={`text-xs ${hasCritical ? "text-red-300" : "text-slate-400"}`}>
                  ({over ? "+" : ""}{(((totals.forecast - totals.budget) / totals.budget) * 100).toFixed(1)}%)
                </span>
              )}
            </div>
          )}
          {utilPct !== null && (
            <div><span className={`${hasCritical ? "text-red-300" : "text-slate-400"}`}>Util </span>
              <span className={`font-semibold ${utilPct > 100 ? "text-red-400" : "text-slate-200"}`}>{utilPct}%</span>
            </div>
          )}
        </div>
      </td>
      <td className={`px-3 py-2.5 sticky right-0 z-10 ${hasCritical ? "bg-red-900" : hasWarning ? "bg-amber-900" : "bg-slate-800"}`} />
    </tr>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  content: FinancialPlanContent;
  monthlyData: MonthlyData;
  onMonthlyDataChange: (d: MonthlyData) => void;
  fyConfig: FYConfig;
  onFyConfigChange: (c: FYConfig) => void;
  signals?: Signal[];
  readOnly?: boolean;
};

const FY_START_OPTIONS = [
  { value: 1, label: "January" },
  { value: 4, label: "April (UK Gov/NHS)" },
  { value: 7, label: "July" },
  { value: 10, label: "October" },
];
const DURATION_OPTIONS = [
  { value: 12, label: "12 months" },
  { value: 18, label: "18 months" },
  { value: 24, label: "24 months" },
  { value: 36, label: "36 months" },
];

// ── Main ──────────────────────────────────────────────────────────────────────

export default function FinancialPlanMonthlyView({
  content, monthlyData, onMonthlyDataChange, fyConfig, onFyConfigChange, signals = [], readOnly = false,
}: Props) {
  const [collapsedQuarters, setCollapsedQuarters] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"monthly" | "quarterly">("monthly");

  const sym = CURRENCY_SYMBOLS[content.currency as Currency] ?? "£";
  const lines = content.cost_lines ?? [];

  const monthKeys = useMemo(() => buildMonthKeys(fyConfig), [fyConfig]);
  const quarters = useMemo(() => buildQuarters(monthKeys, fyConfig.fy_start_month), [monthKeys, fyConfig.fy_start_month]);

  const toggleQuarter = useCallback((label: string) => {
    setCollapsedQuarters(prev => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  }, []);

  const updateEntry = useCallback((lineId: string, mk: MonthKey, patch: Partial<MonthlyEntry>) => {
    onMonthlyDataChange({
      ...monthlyData,
      [lineId]: {
        ...(monthlyData[lineId] ?? {}),
        [mk]: { ...emptyEntry(), ...(monthlyData[lineId]?.[mk] ?? {}), ...patch },
      },
    });
  }, [monthlyData, onMonthlyDataChange]);

  const monthTotals = useMemo(() => {
    const result: Record<MonthKey, { budget: number; actual: number; forecast: number }> = {};
    for (const mk of monthKeys) {
      result[mk] = {
        budget: sumMonths(lines, monthlyData, [mk], "budget"),
        actual: sumMonths(lines, monthlyData, [mk], "actual"),
        forecast: sumMonths(lines, monthlyData, [mk], "forecast"),
      };
    }
    return result;
  }, [monthKeys, monthlyData, lines]);

  const forecastMovement = useMemo(() => {
    const result: Record<MonthKey, number | null> = {};
    for (let i = 0; i < monthKeys.length; i++) {
      if (i === 0) { result[monthKeys[i]] = null; continue; }
      result[monthKeys[i]] = (monthTotals[monthKeys[i]]?.forecast ?? 0) - (monthTotals[monthKeys[i - 1]]?.forecast ?? 0);
    }
    return result;
  }, [monthKeys, monthTotals]);

  if (lines.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-8 text-center text-sm text-amber-700">
        Add cost lines in <strong>Cost Breakdown</strong> first, then return here to enter monthly phasing.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-end justify-between">
        <div className="flex gap-3 flex-wrap">
          {[
            {
              label: "FY Start Month",
              control: (
                <select value={fyConfig.fy_start_month}
                  onChange={e => onFyConfigChange({ ...fyConfig, fy_start_month: Number(e.target.value) as FYConfig["fy_start_month"] })}
                  disabled={readOnly}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {FY_START_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ),
            },
            {
              label: "FY Start Year",
              control: (
                <input type="number" value={fyConfig.fy_start_year}
                  onChange={e => onFyConfigChange({ ...fyConfig, fy_start_year: Number(e.target.value) })}
                  disabled={readOnly} min={2020} max={2040}
                  className="w-24 border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
              ),
            },
            {
              label: "Duration",
              control: (
                <select value={fyConfig.num_months}
                  onChange={e => onFyConfigChange({ ...fyConfig, num_months: Number(e.target.value) })}
                  disabled={readOnly}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {DURATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ),
            },
          ].map(({ label, control }) => (
            <div key={label}>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</label>
              {control}
            </div>
          ))}
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {(["monthly", "quarterly"] as const).map(m => (
            <button key={m} onClick={() => setViewMode(m)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors capitalize ${viewMode === m ? "bg-white shadow text-gray-800" : "text-gray-500 hover:text-gray-700"}`}>
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-100 border border-blue-300" />Budget (fixed)</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gray-100 border border-gray-300" /><Lock className="w-2.5 h-2.5" />Actual</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-300" />Forecast</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-100 border border-red-300" />Over budget</span>
        {signals.length > 0 && <span className="flex items-center gap-1.5 text-amber-600 font-semibold">● Signals active — see Intelligence panel</span>}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm" style={{ maxHeight: "65vh", overflowY: "auto" }}>
        <table className="text-xs border-collapse" style={{ minWidth: `${180 + monthKeys.length * 96 + 120}px` }}>
          <thead className="sticky top-0 z-20">
            {/* Quarter header */}
            <tr className="bg-gray-900 text-white">
              <th className="sticky left-0 bg-gray-900 z-30 min-w-[180px] px-3 py-2 text-left font-semibold text-gray-300 border-r border-gray-700">Cost Line</th>
              {quarters.map(q => (
                viewMode === "quarterly"
                  ? <th key={q.label} colSpan={5} className="px-3 py-2 text-center font-bold border-r border-gray-700 whitespace-nowrap">{q.label}</th>
                  : <th key={q.label} colSpan={q.months.length * 3} className="px-3 py-2 text-center font-bold border-r border-gray-700 whitespace-nowrap">{q.label}</th>
              ))}
              <th className="sticky right-0 bg-gray-900 z-30 min-w-[90px] px-3 py-2 text-center font-semibold text-gray-300">Total</th>
            </tr>

            {/* Month sub-headers */}
            {viewMode === "monthly" && (
              <tr className="bg-gray-800 text-white">
                <th className="sticky left-0 bg-gray-800 z-30 px-3 py-1.5 border-r border-gray-700" />
                {quarters.flatMap(q =>
                  q.months.map(mk => {
                    const { year, month } = { year: Number(mk.split("-")[0]), month: Number(mk.split("-")[1]) };
                    const isCurrent = isCurrentMonth(mk);
                    const isPast = isPastMonth(mk);
                    const monthSigs = signals.filter(s => s.scope === "month" && s.scopeKey === mk);
                    const hasCriticalMonth = monthSigs.some(s => s.severity === "critical");
                    return (
                      <th key={mk} colSpan={3}
                        className={`px-2 py-1.5 text-center border-r border-gray-700 whitespace-nowrap ${isCurrent ? "bg-blue-900" : hasCriticalMonth ? "bg-red-900/60" : isPast ? "opacity-70" : ""}`}>
                        <div className="flex items-center justify-center gap-1">
                          <span className="font-semibold">{MONTH_SHORT[month - 1]}</span>
                          <span className="text-gray-500">{String(year).slice(2)}</span>
                          {isCurrent && <span className="text-blue-400">●</span>}
                          <InlineMonthFlag monthKey={mk} signals={signals} />
                        </div>
                      </th>
                    );
                  })
                )}
                <th className="sticky right-0 bg-gray-800 z-30 px-3 py-1.5" />
              </tr>
            )}

            {/* Bud/Act/Fct sub-labels */}
            <tr className="bg-gray-700 text-gray-300">
              <th className="sticky left-0 bg-gray-700 z-30 px-3 py-1 text-gray-400 text-left border-r border-gray-600" />
              {viewMode === "monthly"
                ? quarters.flatMap(q => q.months.flatMap(mk => [
                    <th key={`${mk}-b`} className="px-1 py-1 text-center text-blue-300 font-medium w-8">Bud</th>,
                    <th key={`${mk}-a`} className="px-1 py-1 text-center text-gray-300 font-medium w-8">Act</th>,
                    <th key={`${mk}-f`} className="px-1 py-1 text-center text-emerald-300 font-medium w-8 border-r border-gray-600">Fct</th>,
                  ]))
                : quarters.flatMap(q => [
                    <th key={`${q.label}-b`} className="px-2 py-1 text-center text-blue-300 font-medium">Budget</th>,
                    <th key={`${q.label}-a`} className="px-2 py-1 text-center text-gray-300 font-medium">Actual</th>,
                    <th key={`${q.label}-f`} className="px-2 py-1 text-center text-emerald-300 font-medium">Forecast</th>,
                    <th key={`${q.label}-v`} className="px-2 py-1 text-center text-amber-300 font-medium">Var £</th>,
                    <th key={`${q.label}-u`} className="px-2 py-1 text-center text-gray-300 font-medium border-r border-gray-600">Util%</th>,
                  ])
              }
              <th className="sticky right-0 bg-gray-700 z-30 px-2 py-1 text-center text-emerald-300">Fct</th>
            </tr>
          </thead>

          <tbody>
            {viewMode === "monthly"
              ? quarters.map(q => {
                  const isCollapsed = collapsedQuarters.has(q.label);
                  return [
                    <QuarterSummaryRow key={`q-${q.label}`} label={q.label} months={q.months}
                      monthlyData={monthlyData} lines={lines} sym={sym}
                      collapsed={isCollapsed} onToggle={() => toggleQuarter(q.label)} signals={signals} />,

                    ...(isCollapsed ? [] : [
                      ...lines.map((line, li) => {
                        const lineTotal = q.months.reduce((s, mk) => s + (Number(monthlyData[line.id]?.[mk]?.forecast) || 0), 0);
                        const lineBudgetTotal = q.months.reduce((s, mk) => s + (Number(monthlyData[line.id]?.[mk]?.budget) || 0), 0);
                        const lineSigs = signals.filter(s => s.affectedLines?.includes(line.id) && s.scope === "quarter" && s.scopeKey === q.label);
                        const hasLineWarning = lineSigs.length > 0;

                        return (
                          <tr key={`${q.label}-${line.id}`}
                            className={`${hasLineWarning ? "bg-amber-50/40" : li % 2 === 0 ? "bg-white" : "bg-gray-50/60"} hover:bg-blue-50/20 transition-colors`}>
                            <td className={`sticky left-0 z-10 px-3 py-1.5 border-b border-gray-100 border-r border-gray-200 ${hasLineWarning ? "bg-amber-50" : li % 2 === 0 ? "bg-white" : "bg-gray-50"}`}>
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium text-gray-700 truncate max-w-[140px]" title={line.description || line.category}>
                                  {line.description || line.category}
                                </span>
                                {hasLineWarning && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" title={lineSigs.map(s => s.title).join(", ")} />}
                              </div>
                            </td>
                            {q.months.map(mk => {
                              const e = monthlyData[line.id]?.[mk] ?? emptyEntry();
                              const locked = isPastMonth(mk);
                              const fOver = e.budget && Number(e.forecast) > Number(e.budget);
                              return [
                                <td key={`${mk}-b`} className="border-b border-gray-100 bg-blue-50/40 min-w-[52px]">
                                  <MoneyInput value={e.budget} onChange={v => updateEntry(line.id, mk, { budget: v })} sym={sym} locked={readOnly} highlight="blue" />
                                </td>,
                                <td key={`${mk}-a`} className="border-b border-gray-100 min-w-[52px]">
                                  <MoneyInput value={e.actual} onChange={v => updateEntry(line.id, mk, { actual: v })} sym={sym} locked={locked || readOnly} highlight="gray" />
                                </td>,
                                <td key={`${mk}-f`} className={`border-b border-gray-100 border-r border-gray-200 min-w-[52px] ${fOver ? "bg-red-50/40" : "bg-emerald-50/30"}`}>
                                  <MoneyInput value={e.forecast} onChange={v => updateEntry(line.id, mk, { forecast: v })} sym={sym} locked={locked || readOnly} highlight={fOver ? "red" : "green"} />
                                </td>,
                              ];
                            })}
                            <td className={`sticky right-0 z-10 px-3 py-1.5 border-b border-gray-100 text-right font-semibold text-xs ${li % 2 === 0 ? "bg-white" : "bg-gray-50"} ${lineBudgetTotal && lineTotal > lineBudgetTotal ? "text-red-600" : "text-emerald-700"}`}>
                              {lineTotal ? fmtK(lineTotal, sym) : "—"}
                            </td>
                          </tr>
                        );
                      }),

                      // Monthly totals row
                      <tr key={`${q.label}-totals`} className="bg-slate-100 font-semibold">
                        <td className="sticky left-0 bg-slate-100 z-10 px-3 py-1.5 border-b border-slate-200 border-r border-slate-200 text-slate-600 text-xs uppercase tracking-wide">Q Total</td>
                        {q.months.flatMap(mk => {
                          const t = monthTotals[mk];
                          const fOver = t.budget && t.forecast > t.budget;
                          return [
                            <td key={`${mk}-tb`} className="border-b border-slate-200 bg-blue-100/60 px-1 py-1.5 text-right text-blue-700 font-semibold text-xs">{t.budget ? fmtK(t.budget, sym) : "—"}</td>,
                            <td key={`${mk}-ta`} className="border-b border-slate-200 px-1 py-1.5 text-right text-gray-700 text-xs">{t.actual ? fmtK(t.actual, sym) : "—"}</td>,
                            <td key={`${mk}-tf`} className={`border-b border-slate-200 border-r border-slate-200 px-1 py-1.5 text-right font-bold text-xs ${fOver ? "text-red-600" : "text-emerald-700"}`}>
                              {t.forecast ? fmtK(t.forecast, sym) : "—"}
                            </td>,
                          ];
                        })}
                        <td className="sticky right-0 bg-slate-100 z-10 px-3 py-1.5 border-b border-slate-200 text-right text-xs font-bold text-gray-700">
                          {fmtK(q.months.reduce((s, mk) => s + (monthTotals[mk]?.forecast ?? 0), 0), sym)}
                        </td>
                      </tr>,

                      // Forecast movement row
                      <tr key={`${q.label}-movement`} className="bg-amber-50/60">
                        <td className="sticky left-0 bg-amber-50/80 z-10 px-3 py-1 border-b border-amber-100 border-r border-amber-100 text-amber-700 text-xs font-medium">Fct Movement</td>
                        {q.months.flatMap(mk => {
                          const mv = forecastMovement[mk];
                          const hasMove = mv !== null && mv !== 0;
                          return [
                            <td key={`${mk}-mv1`} className="border-b border-amber-100 bg-amber-50/40" />,
                            <td key={`${mk}-mv2`} className="border-b border-amber-100 bg-amber-50/40" />,
                            <td key={`${mk}-mv3`} className="border-b border-amber-100 border-r border-amber-100 px-1 py-1 text-right">
                              {hasMove ? (
                                <span className={`flex items-center justify-end gap-0.5 text-xs font-semibold ${(mv ?? 0) > 0 ? "text-red-500" : "text-emerald-600"}`}>
                                  {(mv ?? 0) > 0 ? "▲" : "▼"}{fmtK(Math.abs(mv!), sym)}
                                </span>
                              ) : <span className="text-gray-300">—</span>}
                            </td>,
                          ];
                        })}
                        <td className="sticky right-0 bg-amber-50/80 z-10 px-3 py-1 border-b border-amber-100" />
                      </tr>,
                    ]),
                  ];
                })

              // Quarterly view
              : quarters.map(q => {
                  const qBudget = sumMonths(lines, monthlyData, q.months, "budget");
                  const qActual = sumMonths(lines, monthlyData, q.months.filter(isPastMonth), "actual");
                  const qForecast = sumMonths(lines, monthlyData, q.months, "forecast");
                  const qVariance = qBudget ? qForecast - qBudget : 0;
                  const qUtil = qBudget ? Math.round((qForecast / qBudget) * 100) : null;
                  const over = qBudget && qForecast > qBudget;
                  const qSigs = signals.filter(s => s.scopeKey === q.label);
                  const qCrit = qSigs.some(s => s.severity === "critical");

                  return (
                    <tr key={q.label} className={`border-b border-gray-200 hover:bg-gray-50 ${qCrit ? "bg-red-50/30" : "bg-white"}`}>
                      <td className="sticky left-0 bg-white z-10 px-3 py-2.5 border-r border-gray-200">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-gray-800">{q.label}</span>
                          <InlineQuarterFlags quarterLabel={q.label} signals={signals} />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right text-blue-700 font-semibold">{fmt(qBudget, sym)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-700">{fmt(qActual, sym)}</td>
                      <td className={`px-3 py-2.5 text-right font-bold ${over ? "text-red-600" : "text-emerald-700"}`}>{fmt(qForecast, sym)}</td>
                      <td className={`px-3 py-2.5 text-right font-semibold ${over ? "text-red-500" : "text-emerald-600"}`}>
                        {qBudget ? `${over ? "+" : ""}${fmt(qVariance, sym)}` : "—"}
                      </td>
                      <td className={`px-3 py-2.5 text-right border-r border-gray-200 ${(qUtil ?? 0) > 100 ? "text-red-600 font-bold" : "text-gray-600"}`}>
                        {qUtil !== null ? `${qUtil}%` : "—"}
                      </td>
                      <td className="sticky right-0 bg-white z-10 px-3 py-2.5 text-right font-bold text-gray-700">{fmt(qForecast, sym)}</td>
                    </tr>
                  );
                })
            }
          </tbody>

          <tfoot className="sticky bottom-0 z-20">
            <tr className="bg-gray-900 text-white font-bold">
              <td className="sticky left-0 bg-gray-900 z-30 px-3 py-2 text-gray-300 text-xs uppercase tracking-wide border-r border-gray-700">Grand Total</td>
              {viewMode === "monthly"
                ? monthKeys.flatMap(mk => {
                    const t = monthTotals[mk];
                    const fOver = t.budget && t.forecast > t.budget;
                    return [
                      <td key={`ft-${mk}-b`} className="px-1 py-2 text-right text-blue-300 bg-blue-900/40 text-xs">{t.budget ? fmtK(t.budget, sym) : "—"}</td>,
                      <td key={`ft-${mk}-a`} className="px-1 py-2 text-right text-gray-300 text-xs">{t.actual ? fmtK(t.actual, sym) : "—"}</td>,
                      <td key={`ft-${mk}-f`} className={`px-1 py-2 text-right font-bold text-xs border-r border-gray-700 ${fOver ? "text-red-400" : "text-emerald-400"}`}>{t.forecast ? fmtK(t.forecast, sym) : "—"}</td>,
                    ];
                  })
                : quarters.flatMap(q => {
                    const qB = sumMonths(lines, monthlyData, q.months, "budget");
                    const qA = sumMonths(lines, monthlyData, q.months, "actual");
                    const qF = sumMonths(lines, monthlyData, q.months, "forecast");
                    const qV = qB ? qF - qB : 0;
                    const qU = qB ? Math.round((qF / qB) * 100) : null;
                    return [
                      <td key={`${q.label}-b`} className="px-2 py-2 text-right text-blue-300 text-xs">{fmt(qB, sym)}</td>,
                      <td key={`${q.label}-a`} className="px-2 py-2 text-right text-gray-300 text-xs">{fmt(qA, sym)}</td>,
                      <td key={`${q.label}-f`} className={`px-2 py-2 text-right font-bold text-xs ${qF > qB ? "text-red-400" : "text-emerald-400"}`}>{fmt(qF, sym)}</td>,
                      <td key={`${q.label}-v`} className="px-2 py-2 text-right text-amber-300 text-xs">{qB ? fmt(qV, sym) : "—"}</td>,
                      <td key={`${q.label}-u`} className="px-2 py-2 text-right text-gray-300 text-xs border-r border-gray-700">{qU !== null ? `${qU}%` : "—"}</td>,
                    ];
                  })
              }
              <td className="sticky right-0 bg-gray-900 z-30 px-3 py-2 text-right text-emerald-300 text-xs font-bold">
                {fmtK(monthKeys.reduce((s, mk) => s + (monthTotals[mk]?.forecast ?? 0), 0), sym)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Forecast movement strip */}
      {viewMode === "monthly" && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <div className="text-xs font-bold text-amber-800 uppercase tracking-wide mb-2">Forecast Movement (month-on-month)</div>
          <div className="flex flex-wrap gap-2">
            {monthKeys.map(mk => {
              const mv = forecastMovement[mk];
              if (!mv || mv === 0) return null;
              const [y, m] = mk.split("-");
              const up = mv > 0;
              return (
                <div key={mk} className={`px-2 py-1 rounded border text-[10px] flex items-center gap-1.5 ${up ? "bg-red-50 border-red-200 text-red-700" : "bg-emerald-50 border-emerald-200 text-emerald-700"}`}>
                  <span className="font-bold opacity-60">{MONTH_SHORT[Number(m)-1]} {y.slice(2)}:</span>
                  <span className="font-bold">{up ? "+" : "-"}{fmtK(Math.abs(mv), sym)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
