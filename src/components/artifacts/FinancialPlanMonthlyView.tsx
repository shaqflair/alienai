"use client";

import { useState, useCallback, useMemo } from "react";
import {
  ChevronRight, TrendingUp, TrendingDown, Lock,
  Settings2, Shuffle, CheckCircle2, AlertCircle, Info,
  User, ChevronDown, Calendar, ZoomIn, ZoomOut,
} from "lucide-react";
import {
  CURRENCY_SYMBOLS, type Currency, type CostLine,
  type FinancialPlanContent, type Resource,
  RESOURCE_ROLE_LABELS,
} from "./FinancialPlanEditor";
import { InlineQuarterFlags, InlineMonthFlag } from "./FinancialIntelligencePanel";
import type { Signal } from "@/lib/financial-intelligence";

// ── Types ─────────────────────────────────────────────────────────────────────

export type MonthKey = string; // "YYYY-MM"

export type MonthlyEntry = {
  budget: number | "";
  actual: number | "";
  forecast: number | "";
  /** Customer charge rate for this line/month */
  customer_rate?: number | "";
  locked: boolean;
};

export type MonthlyData = Record<string, Record<MonthKey, MonthlyEntry>>;

export type FYConfig = {
  fy_start_month: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  fy_start_year: number;
  num_months: number;
};

// Date range for the current view window (subset of full FY)
type DateRange = { start: MonthKey; end: MonthKey };

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
    qs.push({
      label: `Q${Math.floor(i / 3) + 1} FY${fyYear}/${String(fyYear + 1).slice(2)}`,
      months: slice,
    });
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

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function fmtMarginPct(revenue: number, cost: number): string {
  if (!revenue) return "—";
  const m = ((revenue - cost) / revenue) * 100;
  return `${m.toFixed(1)}%`;
}

function emptyEntry(): MonthlyEntry {
  return { budget: "", actual: "", forecast: "", customer_rate: "", locked: false };
}

function currentMonthKey(): MonthKey {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
}

function isCurrentMonth(mk: MonthKey) { return mk === currentMonthKey(); }
function isPastMonth(mk: MonthKey) { return mk < currentMonthKey(); }

function addMonths(mk: MonthKey, n: number): MonthKey {
  const [y, m] = mk.split("-").map(Number);
  const d = new Date(y, m - 1 + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function sumField(md: MonthlyData, lineIds: string[], months: MonthKey[], field: keyof MonthlyEntry): number {
  return lineIds.reduce((s, id) =>
    s + months.reduce((ms, mk) => ms + (Number(md[id]?.[mk]?.[field]) || 0), 0), 0);
}

// ── Colour helpers (light theme) ──────────────────────────────────────────────

const th = "bg-gray-50 text-gray-500 font-semibold text-[10px] uppercase tracking-wider border-b border-gray-200 px-2 py-2";
const td = "border-b border-gray-100 px-2";

// ── MoneyInput (light theme) ──────────────────────────────────────────────────

function MoneyInput({
  value, onChange, sym, locked,
  color = "default",
}: {
  value: number | "";
  onChange: (v: number | "") => void;
  sym: string;
  locked: boolean;
  color?: "default" | "blue" | "green" | "red" | "purple" | "orange";
}) {
  const colorCls = {
    default: "text-gray-700",
    blue:    "text-blue-700 font-semibold",
    green:   "text-emerald-700 font-semibold",
    red:     "text-red-600 font-semibold",
    purple:  "text-purple-700 font-semibold",
    orange:  "text-orange-600 font-semibold",
  }[color];

  if (locked) {
    return (
      <div className={`flex items-center justify-end gap-1 px-2 py-1.5 text-xs ${colorCls}`}>
        <Lock className="w-2.5 h-2.5 opacity-20 flex-shrink-0" />
        <span className="tabular-nums">{value !== "" ? fmtK(value, sym) : "—"}</span>
      </div>
    );
  }
  return (
    <input
      type="number"
      value={value}
      onChange={e => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      className={`w-full text-right text-xs px-2 py-1.5 bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:bg-blue-50 rounded transition-all tabular-nums ${colorCls} placeholder-gray-300`}
      placeholder="—"
      step={100}
    />
  );
}

// ── Margin badge ──────────────────────────────────────────────────────────────

function MarginBadge({ revenue, cost }: { revenue: number; cost: number }) {
  if (!revenue || !cost) return <span className="text-gray-300 text-xs tabular-nums">—</span>;
  const margin = ((revenue - cost) / revenue) * 100;
  const good = margin >= 20;
  const warn = margin >= 0 && margin < 20;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold tabular-nums ${
      good ? "bg-emerald-100 text-emerald-700"
      : warn ? "bg-amber-100 text-amber-700"
      : "bg-red-100 text-red-600"
    }`}>
      {margin.toFixed(1)}%
    </span>
  );
}

// ── Date range selector ───────────────────────────────────────────────────────

type ViewWindow = "3m" | "6m" | "fy" | "12m" | "all" | "custom";

function DateRangeSelector({
  allKeys,
  viewRange,
  setViewRange,
  viewWindow,
  setViewWindow,
}: {
  allKeys: MonthKey[];
  viewRange: DateRange;
  setViewRange: (r: DateRange) => void;
  viewWindow: ViewWindow;
  setViewWindow: (w: ViewWindow) => void;
}) {
  const presets: { label: string; value: ViewWindow }[] = [
    { label: "3M",   value: "3m"  },
    { label: "6M",   value: "6m"  },
    { label: "FY",   value: "fy"  },
    { label: "12M",  value: "12m" },
    { label: "All",  value: "all" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Calendar className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
      <span className="text-xs text-gray-500 font-medium">View:</span>
      <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
        {presets.map(p => (
          <button
            key={p.value}
            onClick={() => setViewWindow(p.value)}
            className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
              viewWindow === p.value
                ? "bg-white shadow text-gray-900"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setViewWindow("custom")}
          className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
            viewWindow === "custom" ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Custom
        </button>
      </div>

      {viewWindow === "custom" && (
        <div className="flex items-center gap-2">
          <select
            value={viewRange.start}
            onChange={e => setViewRange({ ...viewRange, start: e.target.value })}
            className="border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            {allKeys.map(mk => {
              const [y, m] = mk.split("-");
              return <option key={mk} value={mk}>{MONTH_SHORT[Number(m)-1]} {y}</option>;
            })}
          </select>
          <span className="text-gray-400 text-xs">to</span>
          <select
            value={viewRange.end}
            onChange={e => setViewRange({ ...viewRange, end: e.target.value })}
            className="border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            {allKeys.filter(mk => mk >= viewRange.start).map(mk => {
              const [y, m] = mk.split("-");
              return <option key={mk} value={mk}>{MONTH_SHORT[Number(m)-1]} {y}</option>;
            })}
          </select>
        </div>
      )}

      <span className="text-[10px] text-gray-400 tabular-nums">
        {viewRange.start !== viewRange.end
          ? `${MONTH_SHORT[Number(viewRange.start.split("-")[1])-1]} ${viewRange.start.split("-")[0]} – ${MONTH_SHORT[Number(viewRange.end.split("-")[1])-1]} ${viewRange.end.split("-")[0]}`
          : ""
        }
      </span>
    </div>
  );
}

// ── Reconciliation bar (light theme) ─────────────────────────────────────────

type ReconcRow = {
  line: CostLine;
  cbBudget: number; cbForecast: number;
  phasedBudget: number; phasedForecast: number;
  allOk: boolean; hasAnyCB: boolean; hasAnyPhased: boolean;
  budgetDiff: number; forecastDiff: number;
};

function ReconciliationBar({
  reconciliation, sym, readOnly, onDistribute,
}: {
  reconciliation: ReconcRow[];
  sym: string;
  readOnly: boolean;
  onDistribute: (lineId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const unreconciled = reconciliation.filter(r => r.hasAnyCB && !r.allOk);
  const empty = reconciliation.every(r => !r.hasAnyCB && !r.hasAnyPhased);
  if (empty) return null;
  const allGood = unreconciled.length === 0;

  return (
    <div className={`rounded-xl border overflow-hidden ${allGood ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
      <button onClick={() => setExpanded(v => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <div className="flex items-center gap-3">
          {allGood
            ? <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
            : <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 animate-pulse" />
          }
          <div>
            <span className={`text-xs font-bold ${allGood ? "text-emerald-700" : "text-amber-700"}`}>
              {allGood
                ? "Monthly phasing reconciled with Cost Breakdown"
                : `${unreconciled.length} line${unreconciled.length > 1 ? "s" : ""} not fully phased`}
            </span>
            {!allGood && (
              <p className="text-[10px] text-amber-600 mt-0.5">
                Use <strong>Distribute</strong> to auto-spread Cost Breakdown totals across months
              </p>
            )}
          </div>
        </div>
        <ChevronRight className={`w-4 h-4 flex-shrink-0 text-gray-400 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`} />
      </button>

      {expanded && (
        <div className="border-t border-gray-200 divide-y divide-gray-100">
          {reconciliation.filter(r => r.hasAnyCB || r.hasAnyPhased).map(r => (
            <div key={r.line.id} className="px-4 py-3 flex items-center gap-4 bg-white">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  {r.allOk
                    ? <CheckCircle2 className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                    : <AlertCircle className="w-3 h-3 text-amber-500 flex-shrink-0" />
                  }
                  <span className="text-xs font-semibold text-gray-800 truncate">
                    {r.line.description || r.line.category}
                  </span>
                </div>
                <div className="flex flex-wrap gap-4">
                  {[
                    { label: "Budget",   cb: r.cbBudget,   phased: r.phasedBudget,   diff: r.budgetDiff   },
                    { label: "Forecast", cb: r.cbForecast, phased: r.phasedForecast, diff: r.forecastDiff },
                  ].filter(f => f.cb > 0 || f.phased > 0).map(f => (
                    <div key={f.label} className="flex items-center gap-1.5 text-xs">
                      <span className="text-gray-400 text-[10px] font-semibold uppercase">{f.label}</span>
                      <span className="text-gray-600 tabular-nums">{fmt(f.cb, sym)}</span>
                      <span className="text-gray-300">→</span>
                      <span className="text-gray-600 tabular-nums">{fmt(f.phased, sym)}</span>
                      {Math.abs(f.diff) > 1 && (
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold tabular-nums ${
                          f.diff > 0 ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"
                        }`}>
                          {f.diff > 0 ? "+" : ""}{fmt(f.diff, sym)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              {!readOnly && (
                <button
                  onClick={() => onDistribute(r.line.id)}
                  className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-gray-50 border border-gray-200 text-gray-600 hover:text-gray-900 text-[11px] font-semibold transition-all shadow-sm"
                >
                  <Shuffle className="w-3 h-3" /> Distribute
                </button>
              )}
            </div>
          ))}
          {!readOnly && unreconciled.length > 1 && (
            <div className="px-4 py-3 bg-gray-50 flex justify-end">
              <button
                onClick={() => unreconciled.forEach(r => onDistribute(r.line.id))}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition-all shadow-sm"
              >
                <Shuffle className="w-3.5 h-3.5" />
                Distribute all {unreconciled.length} lines
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Phasing summary (light theme) ─────────────────────────────────────────────

function PhasingSummaryCallout({
  totalCbBudget, totalCbForecast, totalPhasedBudget, grandTotalForecast,
  totalRevenue, totalCost, sym,
}: {
  totalCbBudget: number; totalCbForecast: number;
  totalPhasedBudget: number; grandTotalForecast: number;
  totalRevenue: number; totalCost: number;
  sym: string;
}) {
  const budgetPct   = totalCbBudget   > 0 ? Math.round((totalPhasedBudget   / totalCbBudget)   * 100) : null;
  const forecastPct = totalCbForecast > 0 ? Math.round((grandTotalForecast  / totalCbForecast) * 100) : null;
  const margin      = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : null;

  if (totalCbBudget === 0 && totalCbForecast === 0) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm px-5 py-4">
      <div className="flex items-center gap-2 mb-3">
        <Info className="w-3.5 h-3.5 text-gray-400" />
        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Phasing Summary</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Budget phased */}
        {totalCbBudget > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-gray-500 font-semibold uppercase">Budget phased</span>
              <span className={`text-[10px] font-bold tabular-nums ${budgetPct === 100 ? "text-emerald-600" : "text-amber-600"}`}>
                {budgetPct ?? "—"}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${budgetPct === 100 ? "bg-emerald-500" : "bg-blue-400"}`}
                style={{ width: `${Math.min(budgetPct ?? 0, 100)}%` }}
              />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-gray-400 tabular-nums">{fmt(totalPhasedBudget, sym)}</span>
              <span className="text-[10px] text-gray-400 tabular-nums">{fmt(totalCbBudget, sym)}</span>
            </div>
          </div>
        )}

        {/* Forecast phased */}
        {totalCbForecast > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-gray-500 font-semibold uppercase">Forecast phased</span>
              <span className={`text-[10px] font-bold tabular-nums ${forecastPct === 100 ? "text-emerald-600" : "text-amber-600"}`}>
                {forecastPct ?? "—"}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${forecastPct === 100 ? "bg-emerald-500" : "bg-emerald-400"}`}
                style={{ width: `${Math.min(forecastPct ?? 0, 100)}%` }}
              />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-gray-400 tabular-nums">{fmt(grandTotalForecast, sym)}</span>
              <span className="text-[10px] text-gray-400 tabular-nums">{fmt(totalCbForecast, sym)}</span>
            </div>
          </div>
        )}

        {/* Revenue */}
        {totalRevenue > 0 && (
          <div>
            <div className="text-[10px] text-gray-500 font-semibold uppercase mb-1.5">Customer Revenue</div>
            <div className="text-lg font-bold text-purple-700 tabular-nums">{fmt(totalRevenue, sym)}</div>
            <div className="text-[10px] text-gray-400 mt-0.5">total charged</div>
          </div>
        )}

        {/* Margin */}
        {margin !== null && (
          <div>
            <div className="text-[10px] text-gray-500 font-semibold uppercase mb-1.5">Gross Margin</div>
            <div className={`text-lg font-bold tabular-nums ${margin >= 20 ? "text-emerald-600" : margin >= 0 ? "text-amber-600" : "text-red-600"}`}>
              {margin.toFixed(1)}%
            </div>
            <div className="text-[10px] text-gray-400 mt-0.5">{fmt(totalRevenue - totalCost, sym)} gross profit</div>
          </div>
        )}
      </div>
    </div>
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

type ViewMode = "monthly" | "quarterly";
type ColumnSet = "cost" | "revenue" | "margin" | "all";

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
  { value: 48, label: "4 years" },
  { value: 60, label: "5 years" },
  { value: 72, label: "6 years" },
];

// ── Main ──────────────────────────────────────────────────────────────────────

export default function FinancialPlanMonthlyView({
  content, monthlyData, onMonthlyDataChange, fyConfig, onFyConfigChange,
  signals = [], readOnly = false,
}: Props) {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode]   = useState<ViewMode>("monthly");
  const [columnSet, setColumnSet] = useState<ColumnSet>("cost");
  const [showConfig, setShowConfig] = useState(false);
  const [viewWindow, setViewWindow] = useState<ViewWindow>("fy");
  const [showResources, setShowResources] = useState(true);

  const sym   = CURRENCY_SYMBOLS[content.currency as Currency] ?? "£";
  const lines = content.cost_lines ?? [];
  const resources: Resource[] = content.resources ?? [];

  // ── All month keys (full project span) ────────────────────────────────────
  const allMonthKeys = useMemo(() => buildMonthKeys(fyConfig), [fyConfig]);
  const quarters     = useMemo(() => buildQuarters(allMonthKeys, fyConfig.fy_start_month), [allMonthKeys, fyConfig.fy_start_month]);

  // ── Compute visible date range from window preset ─────────────────────────
  const [customRange, setCustomRange] = useState<DateRange>({
    start: allMonthKeys[0] ?? currentMonthKey(),
    end:   allMonthKeys[allMonthKeys.length - 1] ?? currentMonthKey(),
  });

  const visibleKeys = useMemo(() => {
    const now = currentMonthKey();
    let start: MonthKey, end: MonthKey;

    if (viewWindow === "custom") {
      start = customRange.start;
      end   = customRange.end;
    } else if (viewWindow === "3m") {
      start = now;
      end   = addMonths(now, 2);
    } else if (viewWindow === "6m") {
      start = now;
      end   = addMonths(now, 5);
    } else if (viewWindow === "12m") {
      start = now;
      end   = addMonths(now, 11);
    } else if (viewWindow === "fy") {
      // Show the FY quarter that contains now
      const fyQ = quarters.find(q => q.months.includes(now)) ?? quarters[0];
      const fyStart = fyQ ? fyQ.months[0] : allMonthKeys[0];
      // Show the full FY (all months in same FY year as now)
      const fyMonths = quarters
        .filter(q => q.label.includes(fyQ?.label?.split(" ")[1] ?? ""))
        .flatMap(q => q.months);
      start = fyMonths[0] ?? allMonthKeys[0];
      end   = fyMonths[fyMonths.length - 1] ?? allMonthKeys[allMonthKeys.length - 1];
    } else {
      // "all"
      start = allMonthKeys[0];
      end   = allMonthKeys[allMonthKeys.length - 1];
    }

    return allMonthKeys.filter(mk => mk >= start && mk <= end);
  }, [viewWindow, customRange, allMonthKeys, quarters]);

  const visibleQuarters = useMemo(() =>
    quarters
      .map(q => ({ ...q, months: q.months.filter(mk => visibleKeys.includes(mk)) }))
      .filter(q => q.months.length > 0),
    [quarters, visibleKeys]);

  // ── Entry helpers ─────────────────────────────────────────────────────────
  const updateEntry = useCallback((lineId: string, mk: MonthKey, patch: Partial<MonthlyEntry>) => {
    onMonthlyDataChange({
      ...monthlyData,
      [lineId]: {
        ...(monthlyData[lineId] ?? {}),
        [mk]: { ...emptyEntry(), ...(monthlyData[lineId]?.[mk] ?? {}), ...patch },
      },
    });
  }, [monthlyData, onMonthlyDataChange]);

  // ── Month totals ──────────────────────────────────────────────────────────
  const lineIds = lines.map(l => l.id);

  const monthTotals = useMemo(() => {
    const result: Record<MonthKey, { budget: number; actual: number; forecast: number; revenue: number }> = {};
    for (const mk of visibleKeys) {
      result[mk] = {
        budget:   sumField(monthlyData, lineIds, [mk], "budget"),
        actual:   sumField(monthlyData, lineIds, [mk], "actual"),
        forecast: sumField(monthlyData, lineIds, [mk], "forecast"),
        revenue:  sumField(monthlyData, lineIds, [mk], "customer_rate"),
      };
    }
    return result;
  }, [visibleKeys, monthlyData, lineIds]);

  // ── Forecast movement ─────────────────────────────────────────────────────
  const forecastMovement = useMemo(() => {
    const result: Record<MonthKey, number | null> = {};
    for (let i = 0; i < visibleKeys.length; i++) {
      if (i === 0) { result[visibleKeys[i]] = null; continue; }
      result[visibleKeys[i]] = (monthTotals[visibleKeys[i]]?.forecast ?? 0) - (monthTotals[visibleKeys[i - 1]]?.forecast ?? 0);
    }
    return result;
  }, [visibleKeys, monthTotals]);

  // ── Grand totals ──────────────────────────────────────────────────────────
  const grandCost    = visibleKeys.reduce((s, mk) => s + (monthTotals[mk]?.forecast ?? 0), 0);
  const grandRevenue = visibleKeys.reduce((s, mk) => s + (monthTotals[mk]?.revenue  ?? 0), 0);
  const grandMargin  = grandRevenue > 0 ? ((grandRevenue - grandCost) / grandRevenue) * 100 : null;

  // ── Reconciliation ────────────────────────────────────────────────────────
  const reconciliation: ReconcRow[] = useMemo(() => lines.map(line => {
    const cbBudget   = Number(line.budgeted) || 0;
    const cbForecast = Number(line.forecast) || 0;
    const phasedBudget   = allMonthKeys.reduce((s, mk) => s + (Number(monthlyData[line.id]?.[mk]?.budget)   || 0), 0);
    const phasedForecast = allMonthKeys.reduce((s, mk) => s + (Number(monthlyData[line.id]?.[mk]?.forecast) || 0), 0);
    const TOLERANCE = 1;
    const budgetOk   = cbBudget   === 0 || Math.abs(phasedBudget   - cbBudget)   <= TOLERANCE;
    const forecastOk = cbForecast === 0 || Math.abs(phasedForecast - cbForecast) <= TOLERANCE;
    return {
      line, cbBudget, cbForecast, phasedBudget, phasedForecast,
      allOk: budgetOk && forecastOk,
      hasAnyCB: cbBudget > 0 || cbForecast > 0,
      hasAnyPhased: phasedBudget > 0 || phasedForecast > 0,
      budgetDiff:   phasedBudget   - cbBudget,
      forecastDiff: phasedForecast - cbForecast,
    };
  }), [lines, allMonthKeys, monthlyData]);

  const totalCbBudget     = lines.reduce((s, l) => s + (Number(l.budgeted) || 0), 0);
  const totalCbForecast   = lines.reduce((s, l) => s + (Number(l.forecast) || 0), 0);
  const totalPhasedBudget = visibleKeys.reduce((s, mk) => s + (monthTotals[mk]?.budget ?? 0), 0);

  // ── Distribute evenly ─────────────────────────────────────────────────────
  const distributeEvenly = useCallback((lineId: string) => {
    const line = lines.find(l => l.id === lineId);
    if (!line || allMonthKeys.length === 0) return;
    const cbBudget = Number(line.budgeted) || 0;
    const cbForecast = Number(line.forecast) || 0;
    const n = allMonthKeys.length;
    const updated: Record<MonthKey, MonthlyEntry> = {};
    allMonthKeys.forEach((mk, i) => {
      const existing = monthlyData[lineId]?.[mk] ?? emptyEntry();
      const isLast = i === n - 1;
      const pB = cbBudget   > 0 ? Math.floor((cbBudget   / n) * 100) / 100 : undefined;
      const pF = cbForecast > 0 ? Math.floor((cbForecast / n) * 100) / 100 : undefined;
      updated[mk] = {
        ...existing,
        budget:   pB !== undefined ? (isLast ? Math.round((cbBudget   - pB * i) * 100) / 100 : pB) : existing.budget,
        forecast: pF !== undefined ? (isLast ? Math.round((cbForecast - pF * i) * 100) / 100 : pF) : existing.forecast,
      };
    });
    onMonthlyDataChange({ ...monthlyData, [lineId]: updated });
  }, [lines, allMonthKeys, monthlyData, onMonthlyDataChange]);

  const toggleSection = useCallback((key: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const criticalCount = signals.filter(s => s.severity === "critical").length;
  const warningCount  = signals.filter(s => s.severity === "warning").length;

  // ── Column definitions per mode ───────────────────────────────────────────
  const showCost    = columnSet === "cost"    || columnSet === "all";
  const showRevenue = columnSet === "revenue" || columnSet === "margin" || columnSet === "all";
  const showMargin  = columnSet === "margin"  || columnSet === "all";
  // Number of columns per month
  const colsPerMonth = (showCost ? 3 : 0) + (showRevenue ? 1 : 0) + (showMargin ? 1 : 0);

  if (lines.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-blue-200 bg-blue-50 px-6 py-12 text-center">
        <p className="text-sm text-blue-500 font-medium">
          Add cost lines in <strong>Cost Breakdown</strong> first, then return here to phase them monthly.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">

      {/* ── Phasing summary ── */}
      <PhasingSummaryCallout
        totalCbBudget={totalCbBudget}
        totalCbForecast={totalCbForecast}
        totalPhasedBudget={totalPhasedBudget}
        grandTotalForecast={grandCost}
        totalRevenue={grandRevenue}
        totalCost={grandCost}
        sym={sym}
      />

      {/* ── Reconciliation ── */}
      <ReconciliationBar
        reconciliation={reconciliation}
        sym={sym}
        readOnly={readOnly}
        onDistribute={distributeEvenly}
      />

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: signals + date range */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Signal badges */}
          {criticalCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-100 border border-red-200 text-red-700 text-xs font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />{criticalCount} critical
            </span>
          )}
          {warningCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 border border-amber-200 text-amber-700 text-xs font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />{warningCount} warning{warningCount > 1 ? "s" : ""}
            </span>
          )}
          {criticalCount === 0 && warningCount === 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />On track
            </span>
          )}

          <DateRangeSelector
            allKeys={allMonthKeys}
            viewRange={customRange}
            setViewRange={setCustomRange}
            viewWindow={viewWindow}
            setViewWindow={w => {
              setViewWindow(w);
              if (w !== "custom") {
                setCustomRange({ start: allMonthKeys[0], end: allMonthKeys[allMonthKeys.length - 1] });
              }
            }}
          />
        </div>

        {/* Right: view controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Column set */}
          <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
            {([
              { value: "cost",    label: "Cost" },
              { value: "revenue", label: "Revenue" },
              { value: "margin",  label: "Margin" },
              { value: "all",     label: "All" },
            ] as { value: ColumnSet; label: string }[]).map(o => (
              <button key={o.value} onClick={() => setColumnSet(o.value)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all ${columnSet === o.value ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
              >
                {o.label}
              </button>
            ))}
          </div>

          {/* Monthly / Quarterly */}
          <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
            {(["monthly", "quarterly"] as ViewMode[]).map(m => (
              <button key={m} onClick={() => setViewMode(m)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all capitalize ${viewMode === m ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
              >
                {m}
              </button>
            ))}
          </div>

          {/* Resources toggle */}
          <button
            onClick={() => setShowResources(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${showResources ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"}`}
          >
            <User className="w-3.5 h-3.5" />
            Resources
          </button>

          {/* Config */}
          <button
            onClick={() => setShowConfig(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${showConfig ? "bg-gray-800 border-gray-800 text-white" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"}`}
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Config panel ── */}
      {showConfig && (
        <div className="flex flex-wrap gap-4 items-end p-4 rounded-xl border border-gray-200 bg-gray-50 shadow-sm">
          {[
            {
              label: "FY Start Month",
              control: (
                <select value={fyConfig.fy_start_month}
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
                <input type="number" value={fyConfig.fy_start_year}
                  onChange={e => onFyConfigChange({ ...fyConfig, fy_start_year: Number(e.target.value) })}
                  disabled={readOnly} min={2020} max={2040}
                  className="w-24 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              ),
            },
            {
              label: "Project Duration",
              control: (
                <select value={fyConfig.num_months}
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
      <div className="flex flex-wrap gap-5 text-xs text-gray-500 px-1">
        {showCost && <>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-100 border border-blue-300" />Budget</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gray-100 border border-gray-300" /><Lock className="w-2.5 h-2.5" /> Actual</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-300" />Forecast (cost)</span>
        </>}
        {showRevenue && <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-purple-100 border border-purple-300" />Customer rate</span>}
        {showMargin  && <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-100 border border-orange-300" />Margin</span>}
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-500 ring-2 ring-blue-200" />Current month</span>
      </div>

      {/* ── Main table ── */}
      <div
        className="rounded-2xl border border-gray-200 overflow-hidden shadow-sm bg-white"
        style={{ maxHeight: "72vh", overflowY: "auto", overflowX: "auto" }}
      >
        <table
          className="text-xs border-collapse bg-white"
          style={{ minWidth: `${240 + visibleKeys.length * (colsPerMonth * 58 + 8) + 100}px` }}
        >
          {/* ── THEAD ── */}
          <thead className="sticky top-0 z-20">

            {/* Quarter / month group headers */}
            <tr className="bg-gray-900">
              <th className="sticky left-0 z-30 bg-gray-900 min-w-[220px] px-4 py-3 text-left text-xs font-semibold text-gray-300 border-r border-gray-700 uppercase tracking-widest">
                Cost Line
              </th>
              {viewMode === "monthly"
                ? visibleQuarters.map(q => (
                    <th key={q.label} colSpan={q.months.length * colsPerMonth}
                      className="px-3 py-3 text-center text-xs font-bold text-white border-r border-gray-700 tracking-wide"
                    >
                      {q.label}
                    </th>
                  ))
                : visibleQuarters.map(q => (
                    <th key={q.label} colSpan={colsPerMonth + 1}
                      className="px-3 py-3 text-center text-xs font-bold text-white border-r border-gray-700"
                    >
                      {q.label}
                    </th>
                  ))
              }
              <th className="sticky right-0 z-30 bg-gray-900 min-w-[100px] px-3 py-3 text-center text-xs font-semibold text-gray-300 uppercase tracking-widest">
                Total
              </th>
            </tr>

            {/* Month name row */}
            {viewMode === "monthly" && (
              <tr className="bg-gray-800">
                <th className="sticky left-0 z-30 bg-gray-800 px-4 py-2 border-r border-gray-700" />
                {visibleQuarters.flatMap(q =>
                  q.months.map(mk => {
                    const month = Number(mk.split("-")[1]);
                    const year  = Number(mk.split("-")[0]);
                    const isCurrent = isCurrentMonth(mk);
                    const mSigs = signals.filter(s => s.scope === "month" && s.scopeKey === mk);
                    return (
                      <th key={mk} colSpan={colsPerMonth}
                        className={`px-2 py-2 text-center border-r border-gray-700 whitespace-nowrap ${isCurrent ? "bg-blue-900" : ""}`}
                      >
                        <div className="flex items-center justify-center gap-1.5">
                          {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 ring-2 ring-blue-400/40 flex-shrink-0" />}
                          <span className={`font-bold text-[11px] ${isCurrent ? "text-blue-200" : "text-gray-200"}`}>
                            {MONTH_SHORT[month - 1]}
                          </span>
                          <span className="text-gray-500 text-[10px]">{String(year).slice(2)}</span>
                          <InlineMonthFlag monthKey={mk} signals={signals} />
                        </div>
                      </th>
                    );
                  })
                )}
                <th className="sticky right-0 z-30 bg-gray-800 px-3 py-2" />
              </tr>
            )}

            {/* Column label row */}
            <tr className="bg-gray-100 border-b border-gray-200">
              <th className={`sticky left-0 z-30 bg-gray-100 ${th} border-r border-gray-200 min-w-[220px]`} />
              {viewMode === "monthly"
                ? visibleQuarters.flatMap(q => q.months.flatMap(mk => [
                    showCost    && <th key={`${mk}-b`}  className={th}>Bud</th>,
                    showCost    && <th key={`${mk}-a`}  className={th}>Act</th>,
                    showCost    && <th key={`${mk}-f`}  className={`${th} border-r border-gray-200`}>Cost</th>,
                    showRevenue && <th key={`${mk}-r`}  className={`${th} text-purple-600`}>Rev</th>,
                    showMargin  && <th key={`${mk}-m`}  className={`${th} text-orange-600 border-r border-gray-200`}>Mgn</th>,
                  ].filter(Boolean)))
                : visibleQuarters.flatMap(q => [
                    showCost    && <th key={`${q.label}-b`}  className={th}>Budget</th>,
                    showCost    && <th key={`${q.label}-a`}  className={th}>Actual</th>,
                    showCost    && <th key={`${q.label}-f`}  className={th}>Cost</th>,
                    showRevenue && <th key={`${q.label}-r`}  className={`${th} text-purple-600`}>Revenue</th>,
                    showMargin  && <th key={`${q.label}-m`}  className={`${th} text-orange-600`}>Margin</th>,
                    <th key={`${q.label}-u`} className={`${th} border-r border-gray-200`}>Util</th>,
                  ].filter(Boolean))
              }
              <th className={`sticky right-0 z-30 bg-gray-100 ${th}`}>
                {showMargin ? "Mgn%" : "Fct"}
              </th>
            </tr>
          </thead>

          {/* ── TBODY ── */}
          <tbody>
            {viewMode === "monthly"
              ? visibleQuarters.map(q => {
                  const qCollapsed = collapsedSections.has(q.label);
                  const qBudget   = sumField(monthlyData, lineIds, q.months, "budget");
                  const qActual   = sumField(monthlyData, lineIds, q.months, "actual");
                  const qForecast = sumField(monthlyData, lineIds, q.months, "forecast");
                  const qRevenue  = sumField(monthlyData, lineIds, q.months, "customer_rate");
                  const qOver     = qBudget > 0 && qForecast > qBudget;
                  const qMargin   = qRevenue > 0 ? ((qRevenue - qForecast) / qRevenue) * 100 : null;
                  const qSigs     = signals.filter(s => s.scopeKey === q.label);
                  const hasCrit   = qSigs.some(s => s.severity === "critical");
                  const hasWarn   = qSigs.some(s => s.severity === "warning");

                  return [
                    // ── Quarter header ──
                    <tr key={`q-${q.label}`}
                      className={`cursor-pointer select-none ${hasCrit ? "bg-red-50" : hasWarn ? "bg-amber-50" : "bg-gray-50"} hover:bg-gray-100 transition-colors`}
                      onClick={() => toggleSection(q.label)}
                    >
                      <td className={`sticky left-0 z-10 px-4 py-2.5 border-b border-r border-gray-200 ${hasCrit ? "bg-red-50" : hasWarn ? "bg-amber-50" : "bg-gray-50"}`}>
                        <div className="flex items-center gap-2.5">
                          <ChevronRight className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${qCollapsed ? "" : "rotate-90"}`} />
                          <span className="text-xs font-bold text-gray-700 tracking-wide uppercase">{q.label}</span>
                          <InlineQuarterFlags quarterLabel={q.label} signals={signals} />
                        </div>
                      </td>
                      <td colSpan={q.months.length * colsPerMonth} className="px-4 py-2.5 border-b border-gray-200">
                        <div className="flex items-center gap-5 text-xs">
                          {showCost && <>
                            <span className="text-gray-400">Budget <strong className="text-blue-700 tabular-nums">{fmt(qBudget, sym)}</strong></span>
                            <span className="text-gray-400">Cost <strong className={`tabular-nums ${qOver ? "text-red-600" : "text-emerald-700"}`}>{fmt(qForecast, sym)}</strong></span>
                          </>}
                          {showRevenue && qRevenue > 0 && (
                            <span className="text-gray-400">Revenue <strong className="text-purple-700 tabular-nums">{fmt(qRevenue, sym)}</strong></span>
                          )}
                          {showMargin && qMargin !== null && (
                            <span className="text-gray-400">Margin <strong className={`tabular-nums ${qMargin >= 20 ? "text-emerald-600" : qMargin >= 0 ? "text-amber-600" : "text-red-600"}`}>{qMargin.toFixed(1)}%</strong></span>
                          )}
                        </div>
                      </td>
                      <td className={`sticky right-0 z-10 px-3 py-2.5 border-b border-gray-200 ${hasCrit ? "bg-red-50" : hasWarn ? "bg-amber-50" : "bg-gray-50"}`} />
                    </tr>,

                    // ── Cost lines ──
                    ...(qCollapsed ? [] : [
                      ...lines.map((line, li) => {
                        const lineFct = q.months.reduce((s, mk) => s + (Number(monthlyData[line.id]?.[mk]?.forecast) || 0), 0);
                        const lineBud = q.months.reduce((s, mk) => s + (Number(monthlyData[line.id]?.[mk]?.budget)   || 0), 0);
                        const lineRev = q.months.reduce((s, mk) => s + (Number(monthlyData[line.id]?.[mk]?.customer_rate) || 0), 0);
                        const isOver  = lineBud > 0 && lineFct > lineBud;
                        const rowBg   = li % 2 === 0 ? "bg-white" : "bg-gray-50/60";
                        const lineResources = resources.filter(r => r.cost_line_id === line.id);
                        const recRow  = reconciliation.find(r => r.line.id === line.id);

                        return [
                          // Main cost line row
                          <tr key={`${q.label}-${line.id}`} className={`${rowBg} hover:bg-blue-50/30 group transition-colors`}>
                            <td className={`sticky left-0 z-10 px-3 py-1.5 border-b border-gray-100 border-r border-gray-200 ${rowBg}`}>
                              <div className="flex items-center gap-2">
                                {/* Reconciliation dot */}
                                {recRow?.hasAnyCB && (
                                  <span title={recRow.allOk ? "Reconciled" : "Not fully phased"}
                                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${recRow.allOk ? "bg-emerald-400" : "bg-amber-400 animate-pulse"}`}
                                  />
                                )}
                                <span className="font-medium text-gray-800 truncate max-w-[160px] text-xs" title={line.description || line.category}>
                                  {line.description || <span className="text-gray-400 italic">{line.category}</span>}
                                </span>
                              </div>
                              <div className="text-[10px] text-gray-400 pl-3.5 truncate">{line.category.replace(/_/g," ")}</div>
                            </td>
                            {q.months.map(mk => {
                              const e = monthlyData[line.id]?.[mk] ?? emptyEntry();
                              const locked = isPastMonth(mk);
                              const fOver  = Number(e.budget) > 0 && Number(e.forecast) > Number(e.budget);
                              const rev    = Number(e.customer_rate) || 0;
                              const cost   = Number(e.forecast) || 0;
                              return [
                                showCost && (
                                  <td key={`${mk}-b`} className="border-b border-gray-100 bg-blue-50/40 min-w-[52px]">
                                    <MoneyInput value={e.budget} onChange={v => updateEntry(line.id, mk, { budget: v })} sym={sym} locked={readOnly} color="blue" />
                                  </td>
                                ),
                                showCost && (
                                  <td key={`${mk}-a`} className="border-b border-gray-100 min-w-[52px]">
                                    <MoneyInput value={e.actual} onChange={v => updateEntry(line.id, mk, { actual: v })} sym={sym} locked={locked || readOnly} color="default" />
                                  </td>
                                ),
                                showCost && (
                                  <td key={`${mk}-f`} className={`border-b border-gray-100 border-r border-gray-200 min-w-[52px] ${fOver ? "bg-red-50" : "bg-emerald-50/40"}`}>
                                    <MoneyInput value={e.forecast} onChange={v => updateEntry(line.id, mk, { forecast: v })} sym={sym} locked={locked || readOnly} color={fOver ? "red" : "green"} />
                                  </td>
                                ),
                                showRevenue && (
                                  <td key={`${mk}-r`} className="border-b border-gray-100 bg-purple-50/40 min-w-[52px]">
                                    <MoneyInput value={e.customer_rate ?? ""} onChange={v => updateEntry(line.id, mk, { customer_rate: v })} sym={sym} locked={readOnly} color="purple" />
                                  </td>
                                ),
                                showMargin && (
                                  <td key={`${mk}-m`} className="border-b border-gray-100 border-r border-gray-200 px-2 py-1.5 min-w-[52px]">
                                    <MarginBadge revenue={rev} cost={cost} />
                                  </td>
                                ),
                              ].filter(Boolean);
                            })}
                            <td className={`sticky right-0 z-10 px-2 py-1.5 border-b border-gray-100 text-right ${rowBg}`}>
                              {showMargin && lineRev > 0
                                ? <MarginBadge revenue={lineRev} cost={lineFct} />
                                : <span className={`text-xs font-bold tabular-nums ${isOver ? "text-red-600" : lineFct > 0 ? "text-emerald-700" : "text-gray-300"}`}>{lineFct ? fmtK(lineFct, sym) : "—"}</span>
                              }
                            </td>
                          </tr>,

                          // ── Resource sub-rows ──
                          ...(showResources && lineResources.length > 0
                            ? lineResources.map(r => {
                                const rateDisplay = r.rate_type === "day_rate"
                                  ? `${fmt(r.day_rate, sym)}/day × ${r.planned_days}d`
                                  : `${fmt(r.monthly_cost, sym)}/mo × ${r.planned_months}mo`;
                                return (
                                  <tr key={`${q.label}-${line.id}-r-${r.id}`} className="bg-blue-50/20 hover:bg-blue-50/40 transition-colors">
                                    <td className="sticky left-0 z-10 bg-blue-50/20 px-3 py-1 border-b border-blue-100/60 border-r border-gray-200">
                                      <div className="flex items-center gap-2 pl-5">
                                        <User className="w-2.5 h-2.5 text-blue-400 flex-shrink-0" />
                                        <div>
                                          <span className="text-[11px] font-medium text-blue-800 truncate max-w-[130px] block">
                                            {r.name || RESOURCE_ROLE_LABELS[r.role]}
                                          </span>
                                          <span className="text-[9px] text-blue-400">{RESOURCE_ROLE_LABELS[r.role]} · {rateDisplay}</span>
                                        </div>
                                      </div>
                                    </td>
                                    <td colSpan={q.months.length * colsPerMonth} className="border-b border-blue-100/60 px-3 py-1">
                                      <span className="text-[10px] text-blue-500 italic">Resource cost rolls up into {line.description || line.category}</span>
                                    </td>
                                    <td className="sticky right-0 z-10 bg-blue-50/20 border-b border-blue-100/60 px-2 py-1" />
                                  </tr>
                                );
                              })
                            : []),
                        ];
                      }),

                      // ── Q totals row ──
                      <tr key={`${q.label}-totals`} className="bg-gray-100 font-semibold">
                        <td className="sticky left-0 z-10 bg-gray-100 px-4 py-2 border-b border-gray-200 border-r border-gray-200 text-[10px] font-black uppercase text-gray-500 tracking-widest">
                          Q Total
                        </td>
                        {q.months.flatMap(mk => {
                          const t = monthTotals[mk] ?? { budget: 0, actual: 0, forecast: 0, revenue: 0 };
                          const fOver = t.budget > 0 && t.forecast > t.budget;
                          const mPct  = t.revenue > 0 ? ((t.revenue - t.forecast) / t.revenue) * 100 : null;
                          return [
                            showCost    && <td key={`${mk}-tb`} className="border-b border-gray-200 bg-blue-50 px-2 py-2 text-right text-blue-700 text-xs tabular-nums font-bold">{t.budget ? fmtK(t.budget, sym) : "—"}</td>,
                            showCost    && <td key={`${mk}-ta`} className="border-b border-gray-200 px-2 py-2 text-right text-gray-500 text-xs tabular-nums">{t.actual ? fmtK(t.actual, sym) : "—"}</td>,
                            showCost    && <td key={`${mk}-tf`} className={`border-b border-gray-200 border-r border-gray-200 px-2 py-2 text-right font-bold text-xs tabular-nums ${fOver ? "text-red-600" : "text-emerald-700"}`}>{t.forecast ? fmtK(t.forecast, sym) : "—"}</td>,
                            showRevenue && <td key={`${mk}-tr`} className="border-b border-gray-200 bg-purple-50 px-2 py-2 text-right text-purple-700 font-bold text-xs tabular-nums">{t.revenue ? fmtK(t.revenue, sym) : "—"}</td>,
                            showMargin  && <td key={`${mk}-tm`} className="border-b border-gray-200 border-r border-gray-200 px-2 py-2 text-right">
                              {mPct !== null ? <MarginBadge revenue={t.revenue} cost={t.forecast} /> : <span className="text-gray-300 text-xs">—</span>}
                            </td>,
                          ].filter(Boolean);
                        })}
                        <td className="sticky right-0 z-10 bg-gray-100 px-2 py-2 border-b border-gray-200 text-right text-xs font-bold text-gray-700 tabular-nums">
                          {showMargin && qRevenue > 0
                            ? <MarginBadge revenue={qRevenue} cost={qForecast} />
                            : fmtK(qForecast, sym)
                          }
                        </td>
                      </tr>,

                      // ── Movement row ──
                      <tr key={`${q.label}-mv`} className="bg-amber-50/40">
                        <td className="sticky left-0 z-10 bg-amber-50/60 px-4 py-1 border-b border-amber-100 border-r border-gray-200 text-[10px] text-amber-600 font-semibold uppercase tracking-widest">
                          Δ Movement
                        </td>
                        {q.months.flatMap(mk => {
                          const mv = forecastMovement[mk];
                          const hasMove = mv !== null && mv !== 0;
                          return [
                            showCost    && <td key={`${mk}-m1`} className="border-b border-amber-100 bg-amber-50/20" />,
                            showCost    && <td key={`${mk}-m2`} className="border-b border-amber-100 bg-amber-50/20" />,
                            showCost    && (
                              <td key={`${mk}-m3`} className="border-b border-amber-100 border-r border-gray-200 px-2 py-1 text-right bg-amber-50/20">
                                {hasMove ? (
                                  <span className={`text-[10px] font-bold tabular-nums ${(mv ?? 0) > 0 ? "text-red-500" : "text-emerald-600"}`}>
                                    {(mv ?? 0) > 0 ? "▲" : "▼"} {fmtK(Math.abs(mv!), sym)}
                                  </span>
                                ) : <span className="text-gray-300">—</span>}
                              </td>
                            ),
                            showRevenue && <td key={`${mk}-m4`} className="border-b border-amber-100" />,
                            showMargin  && <td key={`${mk}-m5`} className="border-b border-amber-100 border-r border-gray-200" />,
                          ].filter(Boolean);
                        })}
                        <td className="sticky right-0 z-10 bg-amber-50/60 border-b border-amber-100" />
                      </tr>,
                    ]),
                  ];
                })

              // ── Quarterly view ──
              : visibleQuarters.map(q => {
                  const qB  = sumField(monthlyData, lineIds, q.months, "budget");
                  const qA  = sumField(monthlyData, lineIds, q.months, "actual");
                  const qF  = sumField(monthlyData, lineIds, q.months, "forecast");
                  const qR  = sumField(monthlyData, lineIds, q.months, "customer_rate");
                  const qV  = qB ? qF - qB : 0;
                  const qU  = qB ? Math.round((qF / qB) * 100) : null;
                  const qM  = qR > 0 ? ((qR - qF) / qR) * 100 : null;
                  const over = qB > 0 && qF > qB;
                  const qSigs = signals.filter(s => s.scopeKey === q.label);
                  const hasCrit = qSigs.some(s => s.severity === "critical");

                  return (
                    <tr key={q.label} className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${hasCrit ? "bg-red-50" : "bg-white"}`}>
                      <td className="sticky left-0 z-10 bg-white px-4 py-3 border-r border-gray-200">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-gray-800 text-xs tracking-wide">{q.label}</span>
                          <InlineQuarterFlags quarterLabel={q.label} signals={signals} />
                        </div>
                      </td>
                      {showCost    && <td className="px-3 py-3 text-right text-blue-700 font-semibold tabular-nums text-xs">{fmt(qB, sym)}</td>}
                      {showCost    && <td className="px-3 py-3 text-right text-gray-500 tabular-nums text-xs">{fmt(qA, sym)}</td>}
                      {showCost    && <td className={`px-3 py-3 text-right font-bold tabular-nums text-xs ${over ? "text-red-600" : "text-emerald-700"}`}>{fmt(qF, sym)}</td>}
                      {showRevenue && <td className="px-3 py-3 text-right text-purple-700 font-semibold tabular-nums text-xs">{qR ? fmt(qR, sym) : "—"}</td>}
                      {showMargin  && <td className="px-3 py-3 text-right text-xs">{qM !== null ? <MarginBadge revenue={qR} cost={qF} /> : "—"}</td>}
                      <td className="px-3 py-3 text-right text-xs font-semibold text-gray-600 border-r border-gray-200 tabular-nums">
                        {qU !== null ? `${qU}%` : "—"}
                      </td>
                      <td className="sticky right-0 z-10 bg-white px-3 py-3 text-right font-bold text-gray-800 tabular-nums text-xs">
                        {showMargin && qR > 0 ? <MarginBadge revenue={qR} cost={qF} /> : fmt(qF, sym)}
                      </td>
                    </tr>
                  );
                })
            }
          </tbody>

          {/* ── TFOOT ── */}
          <tfoot className="sticky bottom-0 z-20">
            <tr className="bg-gray-900">
              <td className="sticky left-0 z-30 bg-gray-900 px-4 py-3 text-gray-300 text-[10px] font-black uppercase tracking-widest border-r border-gray-700">
                Grand Total
              </td>
              {viewMode === "monthly"
                ? visibleKeys.flatMap(mk => {
                    const t = monthTotals[mk] ?? { budget: 0, actual: 0, forecast: 0, revenue: 0 };
                    const fOver = t.budget > 0 && t.forecast > t.budget;
                    return [
                      showCost    && <td key={`ft-${mk}-b`} className="px-2 py-3 text-right text-blue-300 bg-blue-900/30 text-xs font-bold tabular-nums">{t.budget ? fmtK(t.budget, sym) : "—"}</td>,
                      showCost    && <td key={`ft-${mk}-a`} className="px-2 py-3 text-right text-gray-400 text-xs tabular-nums">{t.actual ? fmtK(t.actual, sym) : "—"}</td>,
                      showCost    && <td key={`ft-${mk}-f`} className={`px-2 py-3 text-right font-black text-xs border-r border-gray-700 tabular-nums ${fOver ? "text-red-400" : "text-emerald-400"}`}>{t.forecast ? fmtK(t.forecast, sym) : "—"}</td>,
                      showRevenue && <td key={`ft-${mk}-r`} className="px-2 py-3 text-right text-purple-300 bg-purple-900/20 text-xs font-bold tabular-nums">{t.revenue ? fmtK(t.revenue, sym) : "—"}</td>,
                      showMargin  && <td key={`ft-${mk}-m`} className="px-2 py-3 text-right border-r border-gray-700">
                        {t.revenue > 0 ? <MarginBadge revenue={t.revenue} cost={t.forecast} /> : <span className="text-gray-600 text-xs">—</span>}
                      </td>,
                    ].filter(Boolean);
                  })
                : visibleQuarters.flatMap(q => {
                    const qB = sumField(monthlyData, lineIds, q.months, "budget");
                    const qA = sumField(monthlyData, lineIds, q.months, "actual");
                    const qF = sumField(monthlyData, lineIds, q.months, "forecast");
                    const qR = sumField(monthlyData, lineIds, q.months, "customer_rate");
                    return [
                      showCost    && <td key={`${q.label}-b`} className="px-2 py-3 text-right text-blue-300 text-xs font-bold tabular-nums">{fmt(qB, sym)}</td>,
                      showCost    && <td key={`${q.label}-a`} className="px-2 py-3 text-right text-gray-400 text-xs tabular-nums">{fmt(qA, sym)}</td>,
                      showCost    && <td key={`${q.label}-f`} className={`px-2 py-3 text-right font-black text-xs tabular-nums ${qF > qB ? "text-red-400" : "text-emerald-400"}`}>{fmt(qF, sym)}</td>,
                      showRevenue && <td key={`${q.label}-r`} className="px-2 py-3 text-right text-purple-300 text-xs font-bold tabular-nums">{qR ? fmt(qR, sym) : "—"}</td>,
                      showMargin  && <td key={`${q.label}-m`} className="px-2 py-3 text-right border-r border-gray-700">
                        {qR > 0 ? <MarginBadge revenue={qR} cost={qF} /> : <span className="text-gray-600 text-xs">—</span>}
                      </td>,
                      <td key={`${q.label}-u`} className="px-2 py-3 text-right text-gray-400 text-xs border-r border-gray-700 tabular-nums">
                        {qB ? `${Math.round((qF / qB) * 100)}%` : "—"}
                      </td>,
                    ].filter(Boolean);
                  })
              }
              <td className="sticky right-0 z-30 bg-gray-900 px-4 py-3 text-right">
                {showMargin && grandRevenue > 0
                  ? <MarginBadge revenue={grandRevenue} cost={grandCost} />
                  : <span className="text-emerald-400 text-sm font-black tabular-nums">{grandCost ? fmtK(grandCost, sym) : "—"}</span>
                }
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── Forecast movement strip ── */}
      {viewMode === "monthly" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-2.5">
            Forecast Movement (month-on-month)
          </div>
          <div className="flex flex-wrap gap-2">
            {visibleKeys.map(mk => {
              const mv = forecastMovement[mk];
              if (!mv || mv === 0) return null;
              const [y, m] = mk.split("-");
              const up = mv > 0;
              return (
                <div key={mk} className={`px-2.5 py-1.5 rounded-lg border text-[11px] flex items-center gap-1.5 font-semibold ${up ? "bg-red-100 border-red-200 text-red-700" : "bg-emerald-100 border-emerald-200 text-emerald-700"}`}>
                  <span className="opacity-60 font-normal">{MONTH_SHORT[Number(m)-1]} {y.slice(2)}</span>
                  <span>{up ? "▲" : "▼"} {fmtK(Math.abs(mv), sym)}</span>
                </div>
              );
            })}
            {visibleKeys.every(mk => !forecastMovement[mk]) && (
              <span className="text-xs text-amber-500 italic">No forecast movement in this view window</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}