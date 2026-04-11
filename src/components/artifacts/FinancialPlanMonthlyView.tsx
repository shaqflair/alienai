"use client";

import { useState, useCallback, useMemo } from "react";
import { TrendingUp, TrendingDown, Lock, Settings2 } from "lucide-react";
import { CURRENCY_SYMBOLS, type Currency, type CostLine, type FinancialPlanContent } from "./FinancialPlanEditor";
import { InlineQuarterFlags, InlineMonthFlag } from "./FinancialIntelligencePanel";
import type { Signal } from "@/lib/financial-intelligence";

const P = {
  bg:       "#F7F7F5",
  surface:  "#FFFFFF",
  border:   "#E3E3DF",
  borderMd: "#C8C8C4",
  text:     "#0D0D0B",
  textMd:   "#4A4A46",
  textSm:   "#8A8A84",
  navy:     "#1B3652",
  navyLt:   "#EBF0F5",
  red:      "#B83A2E",
  redLt:    "#FDF2F1",
  green:    "#2A6E47",
  greenLt:  "#F0F7F3",
  amber:    "#8A5B1A",
  amberLt:  "#FDF6EC",
  violet:   "#4A3A7A",
  violetLt: "#F4F2FB",
  mono:     "'DM Mono', 'Courier New', monospace",
  sans:     "'DM Sans', system-ui, sans-serif",
} as const;

export type MonthKey = string;

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
  if (n === "" || n == null || isNaN(Number(n))) return "--";
  const v    = Number(n);
  const sign = v < 0 ? "-" : "";
  const abs  = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1000)      return `${sign}${sym}${abs.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
  return `${sign}${sym}${abs}`;
}

function fmtK(n: number | "" | null | undefined, sym: string): string {
  if (n === "" || n == null || isNaN(Number(n))) return "--";
  const v    = Number(n);
  if (v === 0) return "--";
  const sign = v < 0 ? "-" : "";
  const abs  = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(1)}M`;
  return `${sign}${sym}${(abs / 1000).toFixed(1)}k`;
}

function fmtGrand(n: number | "" | null | undefined, sym: string): string {
  return fmtK(n, sym);
}

function emptyEntry(): MonthlyEntry {
  return { budget: "", actual: "", forecast: "", locked: false };
}

function currentMonthKey(): MonthKey {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
}

function isCurrentMonth(mk: MonthKey) { return mk === currentMonthKey(); }
function isPastMonth(mk: MonthKey)    { return mk < currentMonthKey(); }

// A month's actual is HARD LOCKED once more than 4 weeks (28 days) have passed
// since the last day of that month. This gives a grace period for manual entry.
const GRACE_PERIOD_DAYS = 28;
function isHardLocked(mk: MonthKey): boolean {
  const [y, m] = mk.split("-").map(Number);
  // Last day of month mk
  const lastDay = new Date(y, m, 0); // day 0 of next month = last day of mk
  const now     = new Date();
  const diffMs  = now.getTime() - lastDay.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays > GRACE_PERIOD_DAYS;
}

// Days remaining in grace period (for UI hint)
function graceRemainingDays(mk: MonthKey): number {
  const [y, m] = mk.split("-").map(Number);
  const lastDay  = new Date(y, m, 0);
  const now      = new Date();
  const diffDays = (now.getTime() - lastDay.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, Math.ceil(GRACE_PERIOD_DAYS - diffDays));
}

function sumMonths(lines: CostLine[], md: MonthlyData, months: MonthKey[], field: "budget" | "actual" | "forecast"): number {
  return lines.reduce((s, l) => s + months.reduce((ms, mk) => ms + (Number(md[l.id]?.[mk]?.[field]) || 0), 0), 0);
}

function MoneyInput({ value, onChange, sym, locked, highlight, title }: {
  value: number | ""; onChange: (v: number | "") => void;
  sym: string; locked: boolean; highlight?: "blue" | "green" | "red" | "gray"; title?: string;
}) {
  const colorMap: Record<string, string> = { blue: P.navy, green: P.green, red: P.red, gray: P.textSm };
  const color = colorMap[highlight ?? "gray"];
  if (locked) {
    return (
      <div title={title} style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3, padding: "5px 6px", fontFamily: P.mono, fontSize: 10, color }}>
        <Lock style={{ width: 8, height: 8, opacity: 0.4, flexShrink: 0 }} />
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{value !== "" ? fmtK(value, sym) : "--"}</span>
      </div>
    );
  }
  return (
    <input type="number" value={value}
      onChange={e => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      title={title}
      style={{ width: "100%", textAlign: "right", fontSize: 10, fontFamily: P.mono, color, padding: "5px 6px", background: "transparent", border: "none", outline: "none", fontVariantNumeric: "tabular-nums" }}
      onFocus={e => { e.currentTarget.style.outline = `1px solid ${P.navy}`; e.currentTarget.style.background = "#EEF4FA"; }}
      onBlur={e => { e.currentTarget.style.outline = "none"; e.currentTarget.style.background = "transparent"; }}
      placeholder="--" step={100}
    />
  );
}

type Props = {
  content: FinancialPlanContent;
  monthlyData: MonthlyData;
  onMonthlyDataChange: (d: MonthlyData) => void;
  fyConfig: FYConfig;
  onFyConfigChange: (c: FYConfig) => void;
  signals?: Signal[];
  readOnly?: boolean;
  baselineMonthlyData?: MonthlyData;
};

const FY_START_OPTIONS = [
  { value: 1,  label: "Jan -- Calendar year" },
  { value: 4,  label: "Apr -- UK FY" },
  { value: 7,  label: "Jul" },
  { value: 10, label: "Oct" },
];

const DURATION_OPTIONS = [
  { value: 12, label: "12 months" },
  { value: 18, label: "18 months" },
  { value: 24, label: "24 months" },
  { value: 36, label: "36 months" },
];

const thBase: React.CSSProperties = {
  padding: "3px 4px", textAlign: "right", fontFamily: P.mono,
  fontSize: 8, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase",
  borderBottom: `1px solid ${P.borderMd}`,
};

export default function FinancialPlanMonthlyView({
  content, monthlyData, onMonthlyDataChange, fyConfig, onFyConfigChange, signals = [], readOnly = false, baselineMonthlyData,
}: Props) {
  const [activeQuarters, setActiveQuarters] = useState<Set<string> | null>(null);
  const [viewMode, setViewMode] = useState<"full" | "bud_fct">("full");
  const [showConfig, setShowConfig] = useState(false);

  const sym   = CURRENCY_SYMBOLS[content.currency as Currency] ?? "\u00a3";
  const lines = content.cost_lines ?? [];

  const monthKeys = useMemo(() => buildMonthKeys(fyConfig), [fyConfig]);
  const quarters  = useMemo(() => buildQuarters(monthKeys, fyConfig.fy_start_month), [monthKeys, fyConfig.fy_start_month]);

  const visibleMonths = useMemo(() => {
    if (!activeQuarters || activeQuarters.size === 0) return monthKeys;
    return quarters
      .filter(q => activeQuarters.has(q.label))
      .flatMap(q => q.months);
  }, [activeQuarters, monthKeys, quarters]);

  const toggleQuarter = useCallback((label: string) => {
    setActiveQuarters(prev => {
      const current = prev ?? new Set(quarters.map(q => q.label));
      const next = new Set(current);
      if (next.has(label) && next.size === 1) return null;
      if (next.has(label)) { next.delete(label); } else { next.add(label); }
      if (next.size === quarters.length) return null;
      return next;
    });
  }, [quarters]);

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
        actual:   isPastMonth(mk) || isCurrentMonth(mk) ? sumMonths(lines, monthlyData, [mk], "actual") : 0,
        forecast: sumMonths(lines, monthlyData, [mk], "forecast"),
      };
    }
    return result;
  }, [monthKeys, monthlyData, lines]);

  const grandTotalForecast = visibleMonths.reduce((s, mk) => s + (monthTotals[mk]?.forecast ?? 0), 0);
  const grandTotalBudget   = visibleMonths.reduce((s, mk) => s + (monthTotals[mk]?.budget ?? 0), 0);

  const criticalCount = signals.filter(s => s.severity === "critical").length;
  const warningCount  = signals.filter(s => s.severity === "warning").length;

  if (lines.length === 0) {
    return (
      <div style={{ border: `1px dashed ${P.amber}`, background: P.amberLt, padding: "48px 24px", textAlign: "center" }}>
        <p style={{ fontFamily: P.sans, fontSize: 13, color: P.amber }}>
          Add cost lines in <strong>Cost Breakdown</strong> first, then return here to enter monthly phasing.
        </p>
      </div>
    );
  }

  const selectStyle: React.CSSProperties = {
    border: `1px solid ${P.border}`, background: P.surface,
    fontFamily: P.mono, fontSize: 10, color: P.text,
    padding: "5px 8px", outline: "none", cursor: "pointer",
  };

  const visibleQuarters = quarters.filter(q => q.months.some(mk => visibleMonths.includes(mk)));
  const colsPerMonth = viewMode === "full" ? 3 : 2;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, fontFamily: P.sans }}>

      {/* -- Toolbar -- */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {criticalCount > 0 && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", background: P.redLt, border: `1px solid #F0B0AA`, fontFamily: P.mono, fontSize: 9, color: P.red, letterSpacing: "0.06em" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: P.red, display: "inline-block" }} />
              {criticalCount} CRITICAL
            </span>
          )}
          {warningCount > 0 && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", background: P.amberLt, border: `1px solid #E0C080`, fontFamily: P.mono, fontSize: 9, color: P.amber, letterSpacing: "0.06em" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: P.amber, display: "inline-block" }} />
              {warningCount} WARNING{warningCount > 1 ? "S" : ""}
            </span>
          )}
          {criticalCount === 0 && warningCount === 0 && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", background: P.greenLt, border: `1px solid #A0D0B8`, fontFamily: P.mono, fontSize: 9, color: P.green, letterSpacing: "0.06em" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: P.green, display: "inline-block" }} />
              ON TRACK
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ display: "flex", border: `1px solid ${P.border}` }}>
            {(["full", "bud_fct"] as const).map(m => (
              <button key={m} onClick={() => setViewMode(m)} style={{ padding: "5px 10px", fontFamily: P.mono, fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", background: viewMode === m ? P.navy : P.bg, color: viewMode === m ? "#FFF" : P.textMd, border: "none" }}>
                {m === "full" ? "Bud + Act + Fct" : "Bud + Fct only"}
              </button>
            ))}
          </div>
          <button onClick={() => setShowConfig(v => !v)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", border: `1px solid ${P.border}`, background: showConfig ? "#E8EDF2" : P.bg, color: showConfig ? P.navy : P.textMd, fontFamily: P.mono, fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}>
            <Settings2 style={{ width: 11, height: 11 }} /> CFG
          </button>
        </div>
      </div>

      {/* -- Actuals legend -- */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: P.violetLt, border: `1px solid #C0B0E0`, fontFamily: P.mono, fontSize: 10, color: P.violet }}>
        <Lock style={{ width: 11, height: 11, flexShrink: 0 }} />
        <span>
          <strong>People actuals</strong> are auto-populated from approved timesheets and locked.
          <span style={{ marginLeft: 12, color: P.amber }}>
            <strong>Tools &amp; other actuals</strong> are editable for {GRACE_PERIOD_DAYS} days after month-end, then locked.
          </span>
        </span>
      </div>

      {/* -- Quarter filter buttons -- */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <span style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm, letterSpacing: "0.08em", textTransform: "uppercase", marginRight: 4 }}>Filter:</span>
        <button
          onClick={() => setActiveQuarters(null)}
          style={{ padding: "4px 12px", fontFamily: P.mono, fontSize: 9, fontWeight: 700, cursor: "pointer", border: "1px solid", borderColor: !activeQuarters ? P.navy : P.border, background: !activeQuarters ? P.navy : P.bg, color: !activeQuarters ? "#FFF" : P.textMd, borderRadius: 3 }}
        >
          All quarters
        </button>
        {quarters.map(q => {
          const isActive = !activeQuarters || activeQuarters.has(q.label);
          const qBudget   = sumMonths(lines, monthlyData, q.months, "budget");
          const qForecast = sumMonths(lines, monthlyData, q.months, "forecast");
          const over = qBudget > 0 && qForecast > qBudget;
          const qSigs = signals.filter((s): s is Signal & { scopeKey: string } =>
            s && typeof s === "object" && "scopeKey" in s && s.scopeKey === q.label
          );
          const hasCrit = qSigs.some(s => s.severity === "critical");
          return (
            <button key={q.label} onClick={() => toggleQuarter(q.label)} style={{
              padding: "4px 12px", fontFamily: P.mono, fontSize: 9, fontWeight: 700,
              cursor: "pointer", border: "1px solid", borderRadius: 3,
              borderColor: isActive ? (hasCrit ? P.red : over ? P.amber : P.navy) : P.border,
              background: isActive ? (hasCrit ? P.redLt : over ? P.amberLt : P.navyLt) : P.bg,
              color: isActive ? (hasCrit ? P.red : over ? P.amber : P.navy) : P.textSm,
              opacity: isActive ? 1 : 0.5,
            }}>
              {q.label.split(" ")[0]} {q.label.split(" ")[1]}
              {qForecast !== 0 && <span style={{ marginLeft: 6, fontWeight: 400, opacity: 0.7 }}>{fmtK(qForecast, sym)}</span>}
              {hasCrit && <span style={{ marginLeft: 4, color: P.red }}>!</span>}
            </button>
          );
        })}
      </div>

      {/* -- Config panel -- */}
      {showConfig && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-end", padding: "12px 16px", border: `1px solid ${P.border}`, background: P.surface }}>
          {[
            { label: "FY Start Month", control: (
              <select value={fyConfig.fy_start_month} onChange={e => onFyConfigChange({ ...fyConfig, fy_start_month: Number(e.target.value) as FYConfig["fy_start_month"] })} disabled={readOnly} style={selectStyle}>
                {FY_START_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )},
            { label: "FY Start Year", control: (
              <input type="number" value={fyConfig.fy_start_year} onChange={e => onFyConfigChange({ ...fyConfig, fy_start_year: Number(e.target.value) })} disabled={readOnly} min={2020} max={2040} style={{ ...selectStyle, width: 88 }} />
            )},
            { label: "Duration", control: (
              <select value={fyConfig.num_months} onChange={e => onFyConfigChange({ ...fyConfig, num_months: Number(e.target.value) })} disabled={readOnly} style={selectStyle}>
                {DURATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )},
            { label: "Grace Period", control: (
              <div style={{ fontFamily: P.mono, fontSize: 11, color: P.textMd, padding: "5px 8px", border: `1px solid ${P.border}`, background: "#F4F4F2" }}>
                {GRACE_PERIOD_DAYS} days after month-end
              </div>
            )},
          ].map(({ label, control }) => (
            <div key={label}>
              <div style={{ fontFamily: P.mono, fontSize: 8, letterSpacing: "0.1em", textTransform: "uppercase", color: P.textSm, marginBottom: 5 }}>{label}</div>
              {control}
            </div>
          ))}
        </div>
      )}

      {/* -- Legend -- */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        {[
          { bg: "#EEF4F9", bc: "#A0BAD0", l: "Budget" },
          ...(viewMode === "full" ? [
            { bg: P.violetLt, bc: "#C0B0E0", l: "Actual — locked (timesheets)" },
            { bg: "#FFF8F0", bc: "#E0C080", l: "Actual — grace period" },
          ] : []),
          { bg: P.greenLt, bc: "#A0D0B8", l: "Forecast" },
          { bg: P.redLt, bc: "#F0B0AA", l: "Over budget" },
        ].map(({ bg, bc, l }) => (
          <span key={l} style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: P.mono, fontSize: 9, color: P.textSm, letterSpacing: "0.06em" }}>
            <span style={{ width: 10, height: 10, background: bg, border: `1px solid ${bc}`, display: "inline-block", flexShrink: 0 }} />
            {l.toUpperCase()}
          </span>
        ))}
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: P.mono, fontSize: 9, color: P.textSm, letterSpacing: "0.06em" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: P.navy, boxShadow: `0 0 0 2px ${P.navyLt}`, display: "inline-block", flexShrink: 0 }} />
          CURRENT MONTH
        </span>
      </div>

      {/* -- TABLE -- */}
      <div style={{ border: `1px solid ${P.borderMd}`, maxHeight: "70vh", overflowY: "auto", overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", background: P.surface, minWidth: `${220 + visibleMonths.length * (colsPerMonth === 3 ? 168 : 120) + 100}px` }}>

          <thead style={{ position: "sticky", top: 0, zIndex: 20 }}>
            {/* Row 1: Quarter labels */}
            <tr style={{ background: "#EFEFEC" }}>
              <th style={{ position: "sticky", left: 0, zIndex: 30, background: "#EFEFEC", minWidth: 220, padding: "7px 10px", textAlign: "left", borderRight: `1px solid ${P.borderMd}`, borderBottom: `1px solid ${P.border}`, fontFamily: P.mono, fontSize: 8, color: P.textSm, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 500 }}>
                Cost Line
              </th>
              {visibleQuarters.map(q => {
                const qMonths = q.months.filter(mk => visibleMonths.includes(mk));
                return (
                  <th key={q.label} colSpan={qMonths.length * colsPerMonth} style={{ padding: "7px 10px", textAlign: "center", fontFamily: P.mono, fontSize: 9, fontWeight: 600, color: P.text, letterSpacing: "0.08em", textTransform: "uppercase", borderRight: `1px solid ${P.borderMd}`, borderBottom: `1px solid ${P.border}`, background: "#F2F2EF" }}>
                    {q.label}
                    <InlineQuarterFlags quarterLabel={q.label} signals={signals} />
                  </th>
                );
              })}
              <th style={{ position: "sticky", right: 0, zIndex: 30, background: "#EFEFEC", minWidth: 100, padding: "7px 10px", textAlign: "right", borderLeft: `1px solid ${P.borderMd}`, borderBottom: `1px solid ${P.border}`, fontFamily: P.mono, fontSize: 8, color: P.textSm, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 500 }}>
                Total FCT
              </th>
            </tr>

            {/* Row 2: Month labels */}
            <tr style={{ background: "#F7F7F5" }}>
              <th style={{ position: "sticky", left: 0, zIndex: 30, background: "#F7F7F5", padding: "4px 10px", borderRight: `1px solid ${P.borderMd}`, borderBottom: `1px solid ${P.border}` }} />
              {visibleMonths.map(mk => {
                const month     = Number(mk.split("-")[1]);
                const year      = Number(mk.split("-")[0]);
                const isCurrent = isCurrentMonth(mk);
                const isPast    = isPastMonth(mk);
                const hardLocked = isHardLocked(mk);
                const graceLeft  = !hardLocked && isPast ? graceRemainingDays(mk) : 0;
                return (
                  <th key={mk} colSpan={colsPerMonth} style={{ padding: "5px 4px", textAlign: "center", borderRight: `1px solid ${P.border}`, borderBottom: `1px solid ${P.border}`, background: isCurrent ? "#E8F0F8" : isPast ? "#F9F9F7" : "#F7F7F5", opacity: hardLocked && !isCurrent ? 0.75 : 1 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}>
                      {isCurrent && <span style={{ width: 5, height: 5, borderRadius: "50%", background: P.navy, boxShadow: `0 0 0 2px ${P.navyLt}`, display: "inline-block", flexShrink: 0 }} />}
                      <span style={{ fontFamily: P.mono, fontSize: 10, fontWeight: isCurrent ? 600 : 400, color: isCurrent ? P.navy : P.text }}>{MONTH_SHORT[month - 1]}</span>
                      <span style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm }}>{String(year).slice(2)}</span>
                      <InlineMonthFlag monthKey={mk} signals={signals} />
                    </div>
                    {/* Grace period indicator */}
                    {isPast && !hardLocked && graceLeft > 0 && (
                      <div style={{ fontFamily: P.mono, fontSize: 7, color: P.amber, marginTop: 2, opacity: 0.8 }}>
                        {graceLeft}d grace
                      </div>
                    )}
                    {isPast && hardLocked && (
                      <div style={{ fontFamily: P.mono, fontSize: 7, color: P.textSm, marginTop: 2, opacity: 0.6 }}>
                        locked
                      </div>
                    )}
                  </th>
                );
              })}
              <th style={{ position: "sticky", right: 0, zIndex: 30, background: "#F7F7F5", padding: "4px 10px", borderLeft: `1px solid ${P.borderMd}`, borderBottom: `1px solid ${P.border}` }} />
            </tr>

            {/* Row 3: B/A/F sub-labels */}
            <tr style={{ background: "#F2F2EF" }}>
              <th style={{ position: "sticky", left: 0, zIndex: 30, background: "#F2F2EF", padding: "3px 10px", borderRight: `1px solid ${P.borderMd}`, borderBottom: `1px solid ${P.borderMd}` }} />
              {visibleMonths.flatMap(mk => {
                const cols = viewMode === "full"
                  ? [
                      <th key={`${mk}-b`} style={{ ...thBase, background: "#EEF4F9", color: P.navy, minWidth: 52 }}>BUD</th>,
                      <th key={`${mk}-a`} style={{ ...thBase, background: P.violetLt, color: P.violet, minWidth: 52 }}>ACT</th>,
                      <th key={`${mk}-f`} style={{ ...thBase, background: "#F0F7F3", color: P.green, borderRight: `1px solid ${P.border}`, minWidth: 52 }}>FCT</th>,
                    ]
                  : [
                      <th key={`${mk}-b`} style={{ ...thBase, background: "#EEF4F9", color: P.navy, minWidth: 58 }}>BUD</th>,
                      <th key={`${mk}-f`} style={{ ...thBase, background: "#F0F7F3", color: P.green, borderRight: `1px solid ${P.border}`, minWidth: 58 }}>FCT</th>,
                    ];
                return cols;
              })}
              <th style={{ ...thBase, position: "sticky", right: 0, zIndex: 30, background: "#F0F7F3", color: P.green, borderLeft: `1px solid ${P.borderMd}`, textAlign: "right", padding: "3px 10px" }}>FCT</th>
            </tr>
          </thead>

          <tbody>
            {lines.map((line, li) => {
              const lineFctTotal = visibleMonths.reduce((s, mk) => s + (Number(monthlyData[line.id]?.[mk]?.forecast) || 0), 0);
              const lineBudTotal = visibleMonths.reduce((s, mk) => s + (Number(monthlyData[line.id]?.[mk]?.budget) || 0), 0);
              const isOver = lineBudTotal > 0 && lineFctTotal > lineBudTotal;
              const isNeg  = lineFctTotal < 0;
              const rowBg  = li % 2 === 0 ? P.surface : "#FAFAF8";

              // People category: actuals always locked (from timesheets)
              const isPeopleLine = line.category === "people";

              return (
                <tr key={line.id} style={{ background: rowBg, borderBottom: `1px solid ${P.border}` }}>
                  <td style={{ position: "sticky", left: 0, zIndex: 10, padding: "6px 10px 6px 16px", borderRight: `1px solid ${P.border}`, background: rowBg, minWidth: 220 }}>
                    <span style={{ fontFamily: P.sans, fontSize: 11, fontWeight: 500, color: P.text, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>
                      {line.description || <span style={{ fontStyle: "italic", color: P.textSm }}>{line.category}</span>}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm }}>{line.category}</span>
                      {isPeopleLine && (
                        <span style={{ fontFamily: P.mono, fontSize: 7, color: P.violet, background: P.violetLt, padding: "1px 4px", border: `1px solid #C0B0E0` }}>
                          TIMESHEET
                        </span>
                      )}
                    </div>
                  </td>
                  {visibleMonths.flatMap(mk => {
                    const e = monthlyData[line.id]?.[mk] ?? emptyEntry();
                    const past       = isPastMonth(mk);
                    const hardLocked = isHardLocked(mk);
                    const graceLeft  = !hardLocked && past ? graceRemainingDays(mk) : 0;

                    // Actual locking rules:
                    // - People: ALWAYS locked (populated from timesheets via applyActualsToMonthlyData)
                    // - Others: editable during grace period, hard-locked after 4 weeks
                    const actualLocked =
                      readOnly ||
                      isPeopleLine ||           // timesheets own this
                      (past && hardLocked);     // grace period expired

                    const actualBg = isPeopleLine
                      ? (li % 2 === 0 ? P.violetLt : "#EEE8F8")     // violet = from timesheets
                      : past && !hardLocked
                        ? (li % 2 === 0 ? "#FFF8F0" : "#FFF3E0")    // amber tint = grace period
                        : past && hardLocked
                          ? "#F9F9F7"                                  // grey = hard locked
                          : (li % 2 === 0 ? "#F9F7FF" : "#F3EFF8");  // future = light violet

                    const actualTitle = isPeopleLine
                      ? "Locked — populated automatically from approved timesheets"
                      : hardLocked && past
                        ? "Locked — grace period of 28 days has passed"
                        : past && !hardLocked
                          ? `Editable — ${graceLeft} day${graceLeft !== 1 ? "s" : ""} remaining in grace period`
                          : undefined;

                    const fOver = e.budget && Number(e.forecast) > Number(e.budget);
                    const cols = viewMode === "full"
                      ? [
                          <td key={`${mk}-b`} style={{ borderBottom: `1px solid ${P.border}`, background: "#F2F8FF", minWidth: 52 }}>
                            <MoneyInput value={e.budget} onChange={v => updateEntry(line.id, mk, { budget: v })} sym={sym} locked={readOnly} highlight="blue" />
                          </td>,
                          <td key={`${mk}-a`} style={{ borderBottom: `1px solid ${P.border}`, background: actualBg, minWidth: 52 }}>
                            <MoneyInput
                              value={e.actual}
                              onChange={v => updateEntry(line.id, mk, { actual: v })}
                              sym={sym}
                              locked={actualLocked}
                              highlight={isPeopleLine ? "gray" : past && !hardLocked ? "blue" : "gray"}
                              title={actualTitle}
                            />
                          </td>,
                          <td key={`${mk}-f`} style={{ borderBottom: `1px solid ${P.border}`, borderRight: `1px solid ${P.border}`, minWidth: 52, background: fOver ? "#FDF5F4" : "#F3FAF6" }}>
                            <MoneyInput value={e.forecast} onChange={v => updateEntry(line.id, mk, { forecast: v })} sym={sym} locked={readOnly} highlight={fOver ? "red" : "green"} />
                          </td>,
                        ]
                      : [
                          <td key={`${mk}-b`} style={{ borderBottom: `1px solid ${P.border}`, background: "#F2F8FF", minWidth: 58 }}>
                            <MoneyInput value={e.budget} onChange={v => updateEntry(line.id, mk, { budget: v })} sym={sym} locked={readOnly} highlight="blue" />
                          </td>,
                          <td key={`${mk}-f`} style={{ borderBottom: `1px solid ${P.border}`, borderRight: `1px solid ${P.border}`, minWidth: 58, background: fOver ? "#FDF5F4" : "#F3FAF6" }}>
                            <MoneyInput value={e.forecast} onChange={v => updateEntry(line.id, mk, { forecast: v })} sym={sym} locked={readOnly} highlight={fOver ? "red" : "green"} />
                          </td>,
                        ];
                    return cols;
                  })}
                  <td style={{ position: "sticky", right: 0, zIndex: 10, padding: "5px 10px", textAlign: "right", fontFamily: P.mono, fontSize: 10, fontWeight: 700, color: isNeg ? P.red : isOver ? P.red : lineFctTotal > 0 ? P.green : P.textSm, background: rowBg, borderLeft: `1px solid ${P.border}`, borderBottom: `1px solid ${P.border}`, fontVariantNumeric: "tabular-nums" }}>
                    {lineFctTotal !== 0 ? fmtK(lineFctTotal, sym) : "--"}
                  </td>
                </tr>
              );
            })}
          </tbody>

          <tfoot style={{ position: "sticky", bottom: 0, zIndex: 20 }}>
            <tr style={{ background: "#EAEAE7", borderTop: `2px solid ${P.borderMd}` }}>
              <td style={{ position: "sticky", left: 0, zIndex: 30, padding: "7px 10px", background: "#EAEAE7", borderRight: `1px solid ${P.borderMd}`, fontFamily: P.mono, fontSize: 8, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: P.textMd }}>
                Grand Total
              </td>
              {visibleMonths.flatMap(mk => {
                const t    = monthTotals[mk];
                const fNeg  = t.forecast < 0;
                const fOver = t.budget > 0 && t.forecast > t.budget;
                return viewMode === "full"
                  ? [
                      <td key={`ft-${mk}-b`} style={{ padding: "6px 5px", textAlign: "right", fontFamily: P.mono, fontSize: 10, fontWeight: 600, color: P.navy, background: "#E8F0F8", fontVariantNumeric: "tabular-nums" }}>
                        {t.budget ? fmtGrand(t.budget, sym) : "--"}
                      </td>,
                      <td key={`ft-${mk}-a`} style={{ padding: "6px 5px", textAlign: "right", fontFamily: P.mono, fontSize: 10, color: P.violet, background: "#F0EEFF", fontVariantNumeric: "tabular-nums" }}>
                        {t.actual ? fmtGrand(t.actual, sym) : "--"}
                      </td>,
                      <td key={`ft-${mk}-f`} style={{ padding: "6px 5px", textAlign: "right", fontFamily: P.mono, fontSize: 10, fontWeight: 700, color: fNeg ? P.red : fOver ? P.red : P.green, background: (fNeg || fOver) ? "#FAF0EE" : "#E8F5EE", borderRight: `1px solid ${P.border}`, fontVariantNumeric: "tabular-nums" }}>
                        {t.forecast !== 0 ? fmtGrand(t.forecast, sym) : "--"}
                      </td>,
                    ]
                  : [
                      <td key={`ft-${mk}-b`} style={{ padding: "6px 5px", textAlign: "right", fontFamily: P.mono, fontSize: 10, fontWeight: 600, color: P.navy, background: "#E8F0F8", fontVariantNumeric: "tabular-nums" }}>
                        {t.budget ? fmtGrand(t.budget, sym) : "--"}
                      </td>,
                      <td key={`ft-${mk}-f`} style={{ padding: "6px 5px", textAlign: "right", fontFamily: P.mono, fontSize: 10, fontWeight: 700, color: fNeg ? P.red : fOver ? P.red : P.green, background: (fNeg || fOver) ? "#FAF0EE" : "#E8F5EE", borderRight: `1px solid ${P.border}`, fontVariantNumeric: "tabular-nums" }}>
                        {t.forecast !== 0 ? fmtGrand(t.forecast, sym) : "--"}
                      </td>,
                    ];
              })}
              <td style={{ position: "sticky", right: 0, zIndex: 30, padding: "7px 12px", textAlign: "right", fontFamily: P.mono, fontSize: 13, fontWeight: 700, color: grandTotalForecast < 0 ? P.red : grandTotalBudget > 0 && grandTotalForecast > grandTotalBudget ? P.red : P.green, background: "#EAEAE7", borderLeft: `1px solid ${P.borderMd}`, fontVariantNumeric: "tabular-nums" }}>
                {grandTotalForecast !== 0 ? fmtGrand(grandTotalForecast, sym) : "--"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* -- Movement strips -- */}
      {visibleMonths.length > 0 && (
        <div style={{ border: `1px solid #E0D8B0`, background: "#FDFAF2", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div style={{ fontFamily: P.mono, fontSize: 8, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: P.amber, marginBottom: 6 }}>
              Forecast Revision (vs last saved)
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {baselineMonthlyData ? (
                (() => {
                  const changed = visibleMonths.filter(mk => {
                    const curr = sumMonths(lines, monthlyData, [mk], "forecast");
                    const base = sumMonths(lines, baselineMonthlyData, [mk], "forecast");
                    return curr !== base;
                  });
                  if (changed.length === 0) {
                    return <span style={{ fontFamily: P.mono, fontSize: 10, color: P.textSm, fontStyle: "italic" }}>No changes since last save</span>;
                  }
                  return changed.map(mk => {
                    const curr = sumMonths(lines, monthlyData, [mk], "forecast");
                    const base = sumMonths(lines, baselineMonthlyData, [mk], "forecast");
                    const mv = curr - base;
                    const [y, m] = mk.split("-");
                    const up = mv > 0;
                    return (
                      <div key={mk} style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 9px", background: up ? P.redLt : P.greenLt, border: `1px solid ${up ? "#F0B0AA" : "#A0D0B8"}`, fontFamily: P.mono, fontSize: 10 }}>
                        <span style={{ color: P.textSm }}>{MONTH_SHORT[Number(m) - 1]} {y.slice(2)}</span>
                        <span style={{ fontWeight: 600, color: up ? P.red : P.green, fontVariantNumeric: "tabular-nums" }}>{up ? "+" : "-"}{fmtK(Math.abs(mv), sym)}</span>
                      </div>
                    );
                  });
                })()
              ) : (
                <span style={{ fontFamily: P.mono, fontSize: 10, color: P.textSm, fontStyle: "italic" }}>Save the plan once to enable revision tracking</span>
              )}
            </div>
          </div>

          <div style={{ borderTop: `1px dashed #E0D0A0` }} />

          <div>
            <div style={{ fontFamily: P.mono, fontSize: 8, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: P.amber, marginBottom: 6 }}>
              Budget vs Forecast (per month)
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {visibleMonths.map(mk => {
                const bud = monthTotals[mk]?.budget ?? 0;
                const fct = monthTotals[mk]?.forecast ?? 0;
                if (!bud && !fct) return null;
                const gap = fct - bud;
                const [y, m] = mk.split("-");
                const over  = gap > 0;
                const under = gap < 0;
                return (
                  <div key={mk} style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 9px", background: over ? P.redLt : under ? P.greenLt : "#F4F4F2", border: `1px solid ${over ? "#F0B0AA" : under ? "#A0D0B8" : P.border}`, fontFamily: P.mono, fontSize: 10 }}>
                    <span style={{ color: P.textSm }}>{MONTH_SHORT[Number(m) - 1]} {y.slice(2)}</span>
                    {gap === 0 ? (
                      <span style={{ color: P.textSm, fontWeight: 500 }}>on budget</span>
                    ) : (
                      <>
                        <span style={{ fontWeight: 600, color: over ? P.red : P.green, fontVariantNumeric: "tabular-nums" }}>{over ? "+" : "-"}{fmtK(Math.abs(gap), sym)}</span>
                        <span style={{ fontSize: 9, color: P.textSm }}>{over ? "over" : "under"}</span>
                      </>
                    )}
                  </div>
                );
              })}
              {visibleMonths.every(mk => !(monthTotals[mk]?.budget) && !(monthTotals[mk]?.forecast)) && (
                <span style={{ fontFamily: P.mono, fontSize: 10, color: P.textSm, fontStyle: "italic" }}>No budget or forecast data yet</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* -- Quarter summary cards -- */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${visibleQuarters.length}, 1fr)`, gap: 8 }}>
        {visibleQuarters.map(q => {
          const qMonths   = q.months.filter(mk => visibleMonths.includes(mk));
          const qBudget   = sumMonths(lines, monthlyData, qMonths, "budget");
          const qActual   = sumMonths(lines, monthlyData, qMonths.filter(mk => isPastMonth(mk) || isCurrentMonth(mk)), "actual");
          const qForecast = sumMonths(lines, monthlyData, qMonths, "forecast");
          const qVariance = qBudget ? qForecast - qBudget : 0;
          const qUtil     = qBudget ? Math.round((qForecast / qBudget) * 100) : null;
          const over      = qBudget > 0 && qForecast > qBudget;
          const qSigs     = signals.filter((s): s is Signal & { scopeKey: string } => s && typeof s === "object" && "scopeKey" in s && s.scopeKey === q.label);
          const hasCrit   = qSigs.some(s => s.severity === "critical");
          return (
            <div key={q.label} style={{ border: `1px solid ${hasCrit ? "#F0B0AA" : over ? "#E0C080" : P.border}`, background: hasCrit ? P.redLt : over ? P.amberLt : P.surface, padding: "10px 12px" }}>
              <div style={{ fontFamily: P.mono, fontSize: 9, fontWeight: 700, color: hasCrit ? P.red : over ? P.amber : P.navy, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
                {q.label}{hasCrit && <span style={{ marginLeft: 6, color: P.red }}>!</span>}
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontFamily: P.mono, fontSize: 10 }}>
                <span style={{ color: P.textSm }}>Budget <strong style={{ color: P.navy }}>{fmt(qBudget, sym)}</strong></span>
                <span style={{ color: P.textSm }}>Forecast <strong style={{ color: qForecast < 0 ? P.red : over ? P.red : P.green }}>{fmt(qForecast, sym)}</strong></span>
                {qActual > 0 && <span style={{ color: P.textSm }}>Actual <strong style={{ color: P.violet }}>{fmt(qActual, sym)}</strong></span>}
              </div>
              {qBudget > 0 && (
                <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, fontFamily: P.mono, fontSize: 9 }}>
                  {over ? <TrendingUp style={{ width: 10, height: 10, color: P.red }} /> : <TrendingDown style={{ width: 10, height: 10, color: P.green }} />}
                  <span style={{ color: over ? P.red : P.green, fontWeight: 600 }}>
                    {over ? "+" : ""}{fmt(qVariance, sym)} ({over ? "+" : ""}{(qForecast && qBudget ? ((qForecast - qBudget) / qBudget * 100).toFixed(1) : "0")}%)
                  </span>
                  {qUtil !== null && <span style={{ marginLeft: "auto", color: P.textSm }}>Util: <strong style={{ color: qUtil > 100 ? P.red : qUtil > 85 ? P.amber : P.textMd }}>{qUtil}%</strong></span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}