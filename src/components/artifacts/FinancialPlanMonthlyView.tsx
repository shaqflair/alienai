"use client";

import { useState, useCallback, useMemo } from "react";
import { ChevronDown, ChevronRight, TrendingUp, TrendingDown, Lock, Settings2 } from "lucide-react";
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
  if (Math.abs(v) >= 1_000_000) return `${sym}${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1000) return `${sym}${Math.abs(v).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
  return `${sym}${Math.abs(v)}`;
}

function fmtK(n: number | "" | null | undefined, sym: string): string {
  if (n === "" || n == null || isNaN(Number(n))) return "—";
  const v = Number(n);
  if (v === 0) return "—";
  if (Math.abs(v) >= 1_000_000) return `${sym}${(Math.abs(v) / 1_000_000).toFixed(1)}M`;
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
    blue:  "text-blue-300 font-semibold",
    green: "text-emerald-300 font-semibold",
    red:   "text-red-400 font-semibold",
    gray:  "text-slate-400",
  };
  const cls = colorMap[highlight ?? "gray"];

  if (locked) {
    return (
      <div className={`flex items-center justify-end gap-1 px-2 py-2 text-xs ${cls}`}>
        <Lock className="w-2.5 h-2.5 opacity-30" />
        <span className="tabular-nums">{value !== "" ? fmtK(value, sym) : "—"}</span>
      </div>
    );
  }
  return (
    <input
      type="number"
      value={value}
      onChange={e => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      className={`w-full text-right text-xs px-2 py-2 bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-blue-500/40 focus:bg-white/5 rounded-md transition-all tabular-nums ${cls} placeholder-slate-600`}
      placeholder="—"
      step={100}
    />
  );
}

// ── Quarter header row ────────────────────────────────────────────────────────

function QuarterRow({ label, months, monthlyData, lines, sym, collapsed, onToggle, signals }: {
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
  const over = variance !== null && variance > 0;
  const util = totals.budget ? Math.round((totals.forecast / totals.budget) * 100) : null;
  const qSigs = signals.filter(s => s.scopeKey === label);
  const hasCritical = qSigs.some(s => s.severity === "critical");
  const hasWarning = qSigs.some(s => s.severity === "warning");

  const bgColor = hasCritical
    ? "bg-red-950/80 border-red-800/60"
    : hasWarning
    ? "bg-amber-950/70 border-amber-800/50"
    : "bg-slate-800/90 border-slate-700/50";

  return (
    <tr
      className={`cursor-pointer select-none transition-all group ${bgColor}`}
      onClick={onToggle}
    >
      <td className={`px-4 py-3 sticky left-0 z-10 min-w-[200px] border-r border-slate-700/30 ${bgColor}`}>
        <div className="flex items-center gap-2.5">
          <span className={`flex-shrink-0 transition-transform duration-200 ${collapsed ? "" : "rotate-90"}`}>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
          </span>
          <span className="text-xs font-bold tracking-widest uppercase text-slate-200 letter-spacing-wider">{label}</span>
          <InlineQuarterFlags quarterLabel={label} signals={signals} />
        </div>
      </td>
      <td colSpan={months.length * 3} className="px-4 py-3">
        <div className="flex items-center gap-6 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 font-medium">Budget</span>
            <span className="font-bold text-blue-400 tabular-nums">{fmt(totals.budget, sym)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 font-medium">Actual</span>
            <span className="font-bold text-slate-200 tabular-nums">{fmt(totals.actual, sym)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 font-medium">Forecast</span>
            <span className={`font-bold tabular-nums ${over ? "text-red-400" : "text-emerald-400"}`}>{fmt(totals.forecast, sym)}</span>
          </div>
          {variance !== null && (
            <div className={`flex items-center gap-1 ${over ? "text-red-400" : "text-emerald-400"}`}>
              {over ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              <span className="font-bold tabular-nums">{over ? "+" : ""}{fmt(variance, sym)}</span>
              {totals.budget > 0 && (
                <span className="text-slate-500">({over ? "+" : ""}{(((totals.forecast - totals.budget) / totals.budget) * 100).toFixed(1)}%)</span>
              )}
            </div>
          )}
          {util !== null && (
            <div className="flex items-center gap-1.5 ml-auto">
              <span className="text-slate-500 font-medium">Util</span>
              <span className={`font-bold tabular-nums ${util > 100 ? "text-red-400" : util > 85 ? "text-amber-400" : "text-slate-300"}`}>{util}%</span>
            </div>
          )}
        </div>
      </td>
      <td className={`px-3 py-3 sticky right-0 z-10 ${bgColor}`} />
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
  { value: 1,  label: "Jan — Calendar year" },
  { value: 4,  label: "Apr — UK / NHS" },
  { value: 7,  label: "Jul" },
  { value: 10, label: "Oct" },
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
  const [showConfig, setShowConfig] = useState(false);

  const sym = CURRENCY_SYMBOLS[content.currency as Currency] ?? "£";
  const lines = content.cost_lines ?? [];

  const monthKeys = useMemo(() => buildMonthKeys(fyConfig), [fyConfig]);
  const quarters  = useMemo(() => buildQuarters(monthKeys, fyConfig.fy_start_month), [monthKeys, fyConfig.fy_start_month]);

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
        budget:   sumMonths(lines, monthlyData, [mk], "budget"),
        actual:   sumMonths(lines, monthlyData, [mk], "actual"),
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

  const grandTotalForecast = monthKeys.reduce((s, mk) => s + (monthTotals[mk]?.forecast ?? 0), 0);

  const criticalCount = signals.filter(s => s.severity === "critical").length;
  const warningCount  = signals.filter(s => s.severity === "warning").length;

  if (lines.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-amber-300/40 bg-amber-950/10 px-6 py-12 text-center">
        <p className="text-sm text-amber-500/80 font-medium">Add cost lines in <strong className="text-amber-400">Cost Breakdown</strong> first, then return here to enter monthly phasing.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">

        {/* Signal badges */}
        <div className="flex items-center gap-2">
          {criticalCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-950 border border-red-700/50 text-red-400 text-xs font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              {criticalCount} critical
            </span>
          )}
          {warningCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-950 border border-amber-700/50 text-amber-400 text-xs font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              {warningCount} warning{warningCount > 1 ? "s" : ""}
            </span>
          )}
          {criticalCount === 0 && warningCount === 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950 border border-emerald-700/50 text-emerald-400 text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              On track
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Config toggle */}
          <button
            onClick={() => setShowConfig(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${showConfig ? "bg-slate-800 border-slate-600 text-white" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"}`}
          >
            <Settings2 className="w-3.5 h-3.5" />
            Configure
          </button>

          {/* View toggle */}
          <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
            {(["monthly", "quarterly"] as const).map(m => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all capitalize ${
                  viewMode === m
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Config panel ── */}
      {showConfig && (
        <div className="flex flex-wrap gap-4 items-end p-4 rounded-xl border border-gray-200 bg-gray-50">
          {[
            {
              label: "FY Start Month",
              control: (
                <select
                  value={fyConfig.fy_start_month}
                  onChange={e => onFyConfigChange({ ...fyConfig, fy_start_month: Number(e.target.value) as FYConfig["fy_start_month"] })}
                  disabled={readOnly}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {FY_START_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ),
            },
            {
              label: "FY Start Year",
              control: (
                <input
                  type="number" value={fyConfig.fy_start_year}
                  onChange={e => onFyConfigChange({ ...fyConfig, fy_start_year: Number(e.target.value) })}
                  disabled={readOnly} min={2020} max={2040}
                  className="w-24 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              ),
            },
            {
              label: "Duration",
              control: (
                <select
                  value={fyConfig.num_months}
                  onChange={e => onFyConfigChange({ ...fyConfig, num_months: Number(e.target.value) })}
                  disabled={readOnly}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {DURATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ),
            },
          ].map(({ label, control }) => (
            <div key={label}>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</label>
              {control}
            </div>
          ))}
        </div>
      )}

      {/* ── Legend ── */}
      <div className="flex flex-wrap gap-5 text-xs text-slate-500 px-1">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-blue-900/60 border border-blue-600/40" />
          Budget
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-slate-700/60 border border-slate-600/40" />
          <Lock className="w-2.5 h-2.5" /> Actual (locked past months)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-emerald-900/60 border border-emerald-600/40" />
          Forecast
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-red-900/60 border border-red-600/40" />
          Over budget
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-400 ring-2 ring-blue-400/30" />
          Current month
        </span>
      </div>

      {/* ── Table ── */}
      <div
        className="rounded-2xl overflow-hidden border border-slate-700/50 shadow-2xl shadow-slate-900/30"
        style={{ maxHeight: "70vh", overflowY: "auto", overflowX: "auto" }}
      >
        <table
          className="text-xs border-collapse bg-slate-900"
          style={{ minWidth: `${200 + monthKeys.length * 100 + 120}px` }}
        >
          {/* ── THEAD ── */}
          <thead className="sticky top-0 z-20">

            {/* Quarter header */}
            <tr className="bg-slate-950">
              <th className="sticky left-0 bg-slate-950 z-30 min-w-[200px] px-4 py-3 text-left font-semibold text-slate-400 border-r border-slate-700/50 text-xs tracking-widest uppercase">
                Cost Line
              </th>
              {viewMode === "monthly"
                ? quarters.map(q => (
                    <th
                      key={q.label}
                      colSpan={q.months.length * 3}
                      className="px-3 py-3 text-center font-bold border-r border-slate-700/50 text-slate-200 text-xs tracking-wide"
                      style={{ background: "linear-gradient(180deg, #0f172a 0%, #1e293b 100%)" }}
                    >
                      {q.label}
                    </th>
                  ))
                : quarters.map(q => (
                    <th key={q.label} colSpan={5} className="px-3 py-3 text-center font-bold border-r border-slate-700/50 text-slate-200 text-xs tracking-wide bg-slate-950">
                      {q.label}
                    </th>
                  ))
              }
              <th className="sticky right-0 bg-slate-950 z-30 min-w-[90px] px-3 py-3 text-center font-semibold text-slate-400 text-xs tracking-widest uppercase">
                Total
              </th>
            </tr>

            {/* Month sub-headers */}
            {viewMode === "monthly" && (
              <tr className="bg-slate-900">
                <th className="sticky left-0 bg-slate-900 z-30 px-4 py-2 border-r border-slate-700/50" />
                {quarters.flatMap(q =>
                  q.months.map(mk => {
                    const month = Number(mk.split("-")[1]);
                    const year  = Number(mk.split("-")[0]);
                    const isCurrent = isCurrentMonth(mk);
                    const isPast    = isPastMonth(mk);
                    const mSigs     = signals.filter(s => s.scope === "month" && s.scopeKey === mk);
                    const hasCrit   = mSigs.some(s => s.severity === "critical");

                    return (
                      <th
                        key={mk}
                        colSpan={3}
                        className={`px-2 py-2 text-center border-r border-slate-700/30 whitespace-nowrap transition-colors ${
                          isCurrent
                            ? "bg-blue-900/40 border-blue-700/40"
                            : hasCrit
                            ? "bg-red-900/30"
                            : isPast
                            ? "opacity-60"
                            : ""
                        }`}
                      >
                        <div className="flex items-center justify-center gap-1.5">
                          {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 ring-2 ring-blue-400/30 flex-shrink-0" />}
                          <span className="font-bold text-slate-200">{MONTH_SHORT[month - 1]}</span>
                          <span className="text-slate-600 text-[10px]">{String(year).slice(2)}</span>
                          <InlineMonthFlag monthKey={mk} signals={signals} />
                        </div>
                      </th>
                    );
                  })
                )}
                <th className="sticky right-0 bg-slate-900 z-30 px-3 py-2" />
              </tr>
            )}

            {/* Bud / Act / Fct labels */}
            <tr className="bg-slate-800/80">
              <th className="sticky left-0 bg-slate-800/80 z-30 px-4 py-1.5 text-slate-500 text-left border-r border-slate-700/50 text-[10px] uppercase tracking-widest" />
              {viewMode === "monthly"
                ? quarters.flatMap(q => q.months.flatMap(mk => [
                    <th key={`${mk}-b`} className="px-1 py-1.5 text-center text-blue-400/80 font-semibold text-[10px] uppercase tracking-wider w-8">Bud</th>,
                    <th key={`${mk}-a`} className="px-1 py-1.5 text-center text-slate-400/80 font-semibold text-[10px] uppercase tracking-wider w-8">Act</th>,
                    <th key={`${mk}-f`} className="px-1 py-1.5 text-center text-emerald-400/80 font-semibold text-[10px] uppercase tracking-wider w-8 border-r border-slate-700/30">Fct</th>,
                  ]))
                : quarters.flatMap(q => [
                    <th key={`${q.label}-b`} className="px-2 py-1.5 text-center text-blue-400/80 font-semibold text-[10px] uppercase">Budget</th>,
                    <th key={`${q.label}-a`} className="px-2 py-1.5 text-center text-slate-400/80 font-semibold text-[10px] uppercase">Actual</th>,
                    <th key={`${q.label}-f`} className="px-2 py-1.5 text-center text-emerald-400/80 font-semibold text-[10px] uppercase">Forecast</th>,
                    <th key={`${q.label}-v`} className="px-2 py-1.5 text-center text-amber-400/80 font-semibold text-[10px] uppercase">Var</th>,
                    <th key={`${q.label}-u`} className="px-2 py-1.5 text-center text-slate-400/80 font-semibold text-[10px] uppercase border-r border-slate-700/30">Util</th>,
                  ])
              }
              <th className="sticky right-0 bg-slate-800/80 z-30 px-2 py-1.5 text-center text-emerald-400/80 text-[10px] uppercase tracking-wider">Fct</th>
            </tr>
          </thead>

          {/* ── TBODY ── */}
          <tbody>
            {viewMode === "monthly"
              ? quarters.map(q => {
                  const isCollapsed = collapsedQuarters.has(q.label);
                  return [
                    <QuarterRow
                      key={`q-${q.label}`}
                      label={q.label} months={q.months}
                      monthlyData={monthlyData} lines={lines} sym={sym}
                      collapsed={isCollapsed} onToggle={() => toggleQuarter(q.label)}
                      signals={signals}
                    />,

                    ...(isCollapsed ? [] : [
                      // Cost lines
                      ...lines.map((line, li) => {
                        const lineFctTotal = q.months.reduce((s, mk) => s + (Number(monthlyData[line.id]?.[mk]?.forecast) || 0), 0);
                        const lineBudTotal = q.months.reduce((s, mk) => s + (Number(monthlyData[line.id]?.[mk]?.budget) || 0), 0);
                        const isOver = lineBudTotal > 0 && lineFctTotal > lineBudTotal;
                        const rowBg = li % 2 === 0 ? "bg-slate-900" : "bg-slate-800/40";

                        return (
                          <tr key={`${q.label}-${line.id}`} className={`${rowBg} hover:bg-slate-800/70 transition-colors group`}>
                            <td className={`sticky left-0 z-10 px-4 py-0.5 border-b border-slate-700/20 border-r border-slate-700/30 ${rowBg}`}>
                              <span className="font-medium text-slate-300 truncate max-w-[160px] block text-xs" title={line.description || line.category}>
                                {line.description || <span className="text-slate-500 italic">{line.category}</span>}
                              </span>
                            </td>
                            {q.months.map(mk => {
                              const e = monthlyData[line.id]?.[mk] ?? emptyEntry();
                              const locked = isPastMonth(mk);
                              const fOver = e.budget && Number(e.forecast) > Number(e.budget);
                              return [
                                <td key={`${mk}-b`} className="border-b border-slate-700/20 bg-blue-950/20 min-w-[56px]">
                                  <MoneyInput value={e.budget} onChange={v => updateEntry(line.id, mk, { budget: v })} sym={sym} locked={readOnly} highlight="blue" />
                                </td>,
                                <td key={`${mk}-a`} className="border-b border-slate-700/20 min-w-[56px]">
                                  <MoneyInput value={e.actual} onChange={v => updateEntry(line.id, mk, { actual: v })} sym={sym} locked={locked || readOnly} highlight="gray" />
                                </td>,
                                <td key={`${mk}-f`} className={`border-b border-slate-700/20 border-r border-slate-700/30 min-w-[56px] ${fOver ? "bg-red-950/30" : "bg-emerald-950/20"}`}>
                                  <MoneyInput value={e.forecast} onChange={v => updateEntry(line.id, mk, { forecast: v })} sym={sym} locked={locked || readOnly} highlight={fOver ? "red" : "green"} />
                                </td>,
                              ];
                            })}
                            <td className={`sticky right-0 z-10 px-3 py-1.5 border-b border-slate-700/20 text-right font-bold text-xs tabular-nums ${rowBg} ${isOver ? "text-red-400" : lineFctTotal > 0 ? "text-emerald-400" : "text-slate-600"}`}>
                              {lineFctTotal ? fmtK(lineFctTotal, sym) : "—"}
                            </td>
                          </tr>
                        );
                      }),

                      // Q totals row
                      <tr key={`${q.label}-totals`} className="bg-slate-700/30">
                        <td className="sticky left-0 bg-slate-700/50 z-10 px-4 py-2 border-b border-slate-600/30 border-r border-slate-600/30 text-slate-400 text-[10px] font-bold uppercase tracking-widest">
                          Q Total
                        </td>
                        {q.months.flatMap(mk => {
                          const t = monthTotals[mk];
                          const fOver = t.budget && t.forecast > t.budget;
                          return [
                            <td key={`${mk}-tb`} className="border-b border-slate-600/30 bg-blue-900/20 px-2 py-2 text-right text-blue-300 font-bold text-xs tabular-nums">{t.budget ? fmtK(t.budget, sym) : "—"}</td>,
                            <td key={`${mk}-ta`} className="border-b border-slate-600/30 px-2 py-2 text-right text-slate-400 text-xs tabular-nums">{t.actual ? fmtK(t.actual, sym) : "—"}</td>,
                            <td key={`${mk}-tf`} className={`border-b border-slate-600/30 border-r border-slate-600/30 px-2 py-2 text-right font-bold text-xs tabular-nums ${fOver ? "text-red-400" : "text-emerald-400"}`}>
                              {t.forecast ? fmtK(t.forecast, sym) : "—"}
                            </td>,
                          ];
                        })}
                        <td className="sticky right-0 bg-slate-700/50 z-10 px-3 py-2 border-b border-slate-600/30 text-right text-xs font-bold text-slate-200 tabular-nums">
                          {fmtK(q.months.reduce((s, mk) => s + (monthTotals[mk]?.forecast ?? 0), 0), sym)}
                        </td>
                      </tr>,

                      // Forecast movement row
                      <tr key={`${q.label}-movement`} className="bg-amber-950/10">
                        <td className="sticky left-0 bg-amber-950/20 z-10 px-4 py-1.5 border-b border-amber-900/20 border-r border-amber-900/20 text-amber-600/80 text-[10px] font-semibold uppercase tracking-widest">
                          Δ Movement
                        </td>
                        {q.months.flatMap(mk => {
                          const mv = forecastMovement[mk];
                          const hasMove = mv !== null && mv !== 0;
                          return [
                            <td key={`${mk}-mv1`} className="border-b border-amber-900/10 bg-amber-950/5" />,
                            <td key={`${mk}-mv2`} className="border-b border-amber-900/10 bg-amber-950/5" />,
                            <td key={`${mk}-mv3`} className="border-b border-amber-900/10 border-r border-amber-900/20 px-2 py-1.5 text-right bg-amber-950/5">
                              {hasMove ? (
                                <span className={`inline-flex items-center justify-end gap-0.5 text-[10px] font-bold tabular-nums ${(mv ?? 0) > 0 ? "text-red-400" : "text-emerald-400"}`}>
                                  {(mv ?? 0) > 0 ? "▲" : "▼"} {fmtK(Math.abs(mv!), sym)}
                                </span>
                              ) : <span className="text-slate-700">—</span>}
                            </td>,
                          ];
                        })}
                        <td className="sticky right-0 bg-amber-950/20 z-10 px-3 py-1.5 border-b border-amber-900/20" />
                      </tr>,
                    ]),
                  ];
                })

              // ── Quarterly view ──
              : quarters.map(q => {
                  const qBudget   = sumMonths(lines, monthlyData, q.months, "budget");
                  const qActual   = sumMonths(lines, monthlyData, q.months.filter(isPastMonth), "actual");
                  const qForecast = sumMonths(lines, monthlyData, q.months, "forecast");
                  const qVariance = qBudget ? qForecast - qBudget : 0;
                  const qUtil     = qBudget ? Math.round((qForecast / qBudget) * 100) : null;
                  const over      = qBudget > 0 && qForecast > qBudget;
                  const qSigs     = signals.filter(s => s.scopeKey === q.label);
                  const qCrit     = qSigs.some(s => s.severity === "critical");

                  return (
                    <tr key={q.label} className={`border-b border-slate-700/30 hover:bg-slate-800/50 transition-colors ${qCrit ? "bg-red-950/20" : "bg-slate-900"}`}>
                      <td className="sticky left-0 bg-slate-900 z-10 px-4 py-3 border-r border-slate-700/50">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-200 tracking-wide">{q.label}</span>
                          <InlineQuarterFlags quarterLabel={q.label} signals={signals} />
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right text-blue-300 font-semibold tabular-nums">{fmt(qBudget, sym)}</td>
                      <td className="px-3 py-3 text-right text-slate-400 tabular-nums">{fmt(qActual, sym)}</td>
                      <td className={`px-3 py-3 text-right font-bold tabular-nums ${over ? "text-red-400" : "text-emerald-400"}`}>{fmt(qForecast, sym)}</td>
                      <td className={`px-3 py-3 text-right font-semibold tabular-nums ${over ? "text-red-400" : "text-emerald-400"}`}>
                        {qBudget ? `${over ? "+" : ""}${fmt(qVariance, sym)}` : "—"}
                      </td>
                      <td className={`px-3 py-3 text-right border-r border-slate-700/30 font-semibold tabular-nums ${(qUtil ?? 0) > 100 ? "text-red-400" : (qUtil ?? 0) > 85 ? "text-amber-400" : "text-slate-300"}`}>
                        {qUtil !== null ? `${qUtil}%` : "—"}
                      </td>
                      <td className="sticky right-0 bg-slate-900 z-10 px-3 py-3 text-right font-bold text-slate-200 tabular-nums">{fmt(qForecast, sym)}</td>
                    </tr>
                  );
                })
            }
          </tbody>

          {/* ── TFOOT ── */}
          <tfoot className="sticky bottom-0 z-20">
            <tr style={{ background: "linear-gradient(180deg, #020617 0%, #0f172a 100%)" }}>
              <td className="sticky left-0 z-30 px-4 py-3 text-slate-300 text-[10px] font-black uppercase tracking-widest border-r border-slate-700/50"
                style={{ background: "linear-gradient(180deg, #020617 0%, #0f172a 100%)" }}
              >
                Grand Total
              </td>
              {viewMode === "monthly"
                ? monthKeys.flatMap(mk => {
                    const t = monthTotals[mk];
                    const fOver = t.budget && t.forecast > t.budget;
                    return [
                      <td key={`ft-${mk}-b`} className="px-2 py-3 text-right text-blue-400/80 bg-blue-950/30 text-xs font-bold tabular-nums">{t.budget ? fmtK(t.budget, sym) : "—"}</td>,
                      <td key={`ft-${mk}-a`} className="px-2 py-3 text-right text-slate-500 text-xs tabular-nums">{t.actual ? fmtK(t.actual, sym) : "—"}</td>,
                      <td key={`ft-${mk}-f`} className={`px-2 py-3 text-right font-black text-xs border-r border-slate-700/50 tabular-nums ${fOver ? "text-red-400" : "text-emerald-400"}`}>{t.forecast ? fmtK(t.forecast, sym) : "—"}</td>,
                    ];
                  })
                : quarters.flatMap(q => {
                    const qB = sumMonths(lines, monthlyData, q.months, "budget");
                    const qA = sumMonths(lines, monthlyData, q.months, "actual");
                    const qF = sumMonths(lines, monthlyData, q.months, "forecast");
                    const qV = qB ? qF - qB : 0;
                    const qU = qB ? Math.round((qF / qB) * 100) : null;
                    return [
                      <td key={`${q.label}-b`} className="px-2 py-3 text-right text-blue-400/80 text-xs font-bold tabular-nums">{fmt(qB, sym)}</td>,
                      <td key={`${q.label}-a`} className="px-2 py-3 text-right text-slate-500 text-xs tabular-nums">{fmt(qA, sym)}</td>,
                      <td key={`${q.label}-f`} className={`px-2 py-3 text-right font-black text-xs tabular-nums ${qF > qB ? "text-red-400" : "text-emerald-400"}`}>{fmt(qF, sym)}</td>,
                      <td key={`${q.label}-v`} className="px-2 py-3 text-right text-amber-400/80 text-xs tabular-nums">{qB ? fmt(qV, sym) : "—"}</td>,
                      <td key={`${q.label}-u`} className="px-2 py-3 text-right text-slate-400 text-xs border-r border-slate-700/50 tabular-nums">{qU !== null ? `${qU}%` : "—"}</td>,
                    ];
                  })
              }
              <td
                className="sticky right-0 z-30 px-4 py-3 text-right text-emerald-400 text-sm font-black tabular-nums"
                style={{ background: "linear-gradient(180deg, #020617 0%, #0f172a 100%)" }}
              >
                {grandTotalForecast ? fmtK(grandTotalForecast, sym) : "—"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── Forecast movement strip ── */}
      {viewMode === "monthly" && (
        <div className="rounded-xl border border-amber-900/30 bg-amber-950/10 px-4 py-3">
          <div className="text-[10px] font-black text-amber-600/80 uppercase tracking-widest mb-2.5">
            Forecast Movement (month-on-month)
          </div>
          <div className="flex flex-wrap gap-2">
            {monthKeys.map(mk => {
              const mv = forecastMovement[mk];
              if (!mv || mv === 0) return null;
              const [y, m] = mk.split("-");
              const up = mv > 0;
              return (
                <div
                  key={mk}
                  className={`px-2.5 py-1.5 rounded-lg border text-[11px] flex items-center gap-1.5 font-semibold ${
                    up
                      ? "bg-red-950/60 border-red-800/40 text-red-300"
                      : "bg-emerald-950/60 border-emerald-800/40 text-emerald-300"
                  }`}
                >
                  <span className="opacity-50 font-normal">{MONTH_SHORT[Number(m)-1]} {y.slice(2)}</span>
                  <span>{up ? "▲" : "▼"} {fmtK(Math.abs(mv), sym)}</span>
                </div>
              );
            })}
            {monthKeys.every(mk => !forecastMovement[mk]) && (
              <span className="text-xs text-amber-700/60 italic">No forecast movement yet</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}