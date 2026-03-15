"use client";

import { useState, useCallback, useMemo } from "react";
import { TrendingUp, TrendingDown, Lock, Settings2 } from "lucide-react";
import { CURRENCY_SYMBOLS, type Currency, type CostLine, type FinancialPlanContent } from "./FinancialPlanEditor";
import { InlineQuarterFlags, InlineMonthFlag } from "./FinancialIntelligencePanel";
import type { Signal } from "@/lib/financial-intelligence";

// -- Palantir design tokens ----------------------------------------------------
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

// -- Types ---------------------------------------------------------------------

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

// -- Helpers -------------------------------------------------------------------

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
  const v = Number(n);
  if (Math.abs(v) >= 1_000_000) return `${sym}${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1000) return `${sym}${Math.abs(v).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
  return `${sym}${Math.abs(v)}`;
}

function fmtK(n: number | "" | null | undefined, sym: string): string {
  if (n === "" || n == null || isNaN(Number(n))) return "--";
  const v = Number(n);
  if (v === 0) return "--";
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

// -- MoneyInput ----------------------------------------------------------------

function MoneyInput({ value, onChange, sym, locked, highlight }: {
  value: number | ""; onChange: (v: number | "") => void;
  sym: string; locked: boolean; highlight?: "blue" | "green" | "red" | "gray";
}) {
  const colorMap: Record<string, string> = {
    blue:  P.navy,
    green: P.green,
    red:   P.red,
    gray:  P.textSm,
  };
  const color = colorMap[highlight ?? "gray"];

  if (locked) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, padding: "6px 8px", fontFamily: P.mono, fontSize: 10, color }}>
        <Lock style={{ width: 9, height: 9, opacity: 0.4, flexShrink: 0 }} />
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{value !== "" ? fmtK(value, sym) : "--"}</span>
      </div>
    );
  }
  return (
    <input
      type="number"
      value={value}
      onChange={e => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      style={{
        width: "100%", textAlign: "right", fontSize: 10, fontFamily: P.mono,
        color, padding: "6px 8px", background: "transparent",
        border: "none", outline: "none", fontVariantNumeric: "tabular-nums",
      }}
      onFocus={e => { e.currentTarget.style.outline = `1px solid ${P.navy}`; e.currentTarget.style.background = "#EEF4FA"; }}
      onBlur={e => { e.currentTarget.style.outline = "none"; e.currentTarget.style.background = "transparent"; }}
      placeholder="--"
      step={100}
    />
  );
}

// -- Quarter header row --------------------------------------------------------

function QuarterRow({ label, months, monthlyData, lines, sym, collapsed, onToggle, signals }: {
  label: string; months: MonthKey[]; monthlyData: MonthlyData;
  lines: CostLine[]; sym: string; collapsed: boolean;
  onToggle: () => void; signals: Signal[];
}) {
  const [hovered, setHovered] = useState(false);

  const totals = useMemo(() => {
    let budget = 0, actual = 0, forecast = 0;
    for (const lineId of lines.map(l => l.id)) {
      for (const mk of months) {
        const e = monthlyData[lineId]?.[mk];
        budget   += Number(e?.budget   ?? 0) || 0;
        // Only sum actuals for past months - future entries may carry projected
        // values from applyActualsToMonthlyData that should not show as "actual"
        if (isPastMonth(mk)) actual += Number(e?.actual ?? 0) || 0;
        forecast += Number(e?.forecast ?? 0) || 0;
      }
    }
    return { budget, actual, forecast };
  }, [months, monthlyData, lines]);

  const variance = totals.budget ? totals.forecast - totals.budget : null;
  const over = variance !== null && variance > 0;
  const util = totals.budget ? Math.round((totals.forecast / totals.budget) * 100) : null;
  const qSigs = signals.filter((s): s is Signal & { scopeKey: string } =>
    s && typeof s === "object" && "scopeKey" in s && s.scopeKey === label
  );
  const hasCritical = qSigs.some(s => s.severity === "critical");
  const hasWarning  = qSigs.some(s => s.severity === "warning");

  const rowBg = hovered ? "#E8E8E4"
    : hasCritical ? P.redLt
    : hasWarning  ? P.amberLt
    : "#EEEEEB";

  return (
    <tr
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ cursor: "pointer", background: rowBg, borderBottom: `1px solid ${P.borderMd}`, transition: "background 0.1s" }}
    >
      <td style={{
        padding: "9px 10px", position: "sticky", left: 0, zIndex: 10,
        minWidth: 200, borderRight: `1px solid ${P.borderMd}`, background: rowBg,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{
            fontFamily: P.mono, fontSize: 11, display: "inline-block",
            transform: collapsed ? "rotate(0deg)" : "rotate(90deg)",
            transition: "transform 0.15s", color: P.textMd,
          }}>?</span>
          <span style={{ fontFamily: P.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: P.text }}>
            {label}
          </span>
          <InlineQuarterFlags quarterLabel={label} signals={signals} />
        </div>
      </td>
      <td colSpan={months.length * 3} style={{ padding: "9px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", fontFamily: P.mono, fontSize: 10 }}>
          <span style={{ color: P.textSm }}>Budget <span style={{ color: P.navy, fontWeight: 600 }}>{fmt(totals.budget, sym)}</span></span>
          <span style={{ color: P.textSm }}>Actual <span style={{ color: P.violet, fontWeight: 500 }}>{fmt(totals.actual, sym)}</span></span>
          <span style={{ color: P.textSm }}>Forecast <span style={{ color: over ? P.red : P.green, fontWeight: 600 }}>{fmt(totals.forecast, sym)}</span></span>
          {variance !== null && (
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontWeight: 600, color: over ? P.red : P.green }}>
              {over ? <TrendingUp style={{ width: 11, height: 11 }} /> : <TrendingDown style={{ width: 11, height: 11 }} />}
              {over ? "+" : ""}{fmt(variance, sym)}
              {totals.budget > 0 && (
                <span style={{ fontWeight: 400, color: P.textSm }}>
                  ({over ? "+" : ""}{(((totals.forecast - totals.budget) / totals.budget) * 100).toFixed(1)}%)
                </span>
              )}
            </span>
          )}
          {util !== null && (
            <span style={{ marginLeft: "auto", color: P.textSm }}>
              Util: <span style={{ fontWeight: 600, color: util > 100 ? P.red : util > 85 ? P.amber : P.textMd }}>{util}%</span>
            </span>
          )}
        </div>
      </td>
      <td style={{ position: "sticky", right: 0, zIndex: 10, background: rowBg, borderLeft: `1px solid ${P.borderMd}`, minWidth: 90 }} />
    </tr>
  );
}

// -- Props ---------------------------------------------------------------------

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
  { value: 1,  label: "Jan ? Calendar year" },
  { value: 4,  label: "Apr ? UK / NHS" },
  { value: 7,  label: "Jul" },
  { value: 10, label: "Oct" },
];

const DURATION_OPTIONS = [
  { value: 12, label: "12 months" },
  { value: 18, label: "18 months" },
  { value: 24, label: "24 months" },
  { value: 36, label: "36 months" },
];

// -- Shared cell style ---------------------------------------------------------

const thBase: React.CSSProperties = {
  padding: "3px 4px", textAlign: "right", fontFamily: P.mono,
  fontSize: 8, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase",
  borderBottom: `1px solid ${P.borderMd}`,
};

// -- Main ----------------------------------------------------------------------

export default function FinancialPlanMonthlyView({
  content, monthlyData, onMonthlyDataChange, fyConfig, onFyConfigChange, signals = [], readOnly = false,
}: Props) {
  const [collapsedQuarters, setCollapsedQuarters] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"monthly" | "quarterly">("monthly");
  const [showConfig, setShowConfig] = useState(false);

  const sym   = CURRENCY_SYMBOLS[content.currency as Currency] ?? "\u00a3";
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

  // FIX 1: Only count actuals for past months. applyActualsToMonthlyData writes
  // projected timesheet values into current/future month entries - these must not
  // appear as "actual" in Grand Total rows or they inflate the actual total while
  // the per-row actual cells (which also guard isPastMonth) show zero.
  const monthTotals = useMemo(() => {
    const result: Record<MonthKey, { budget: number; actual: number; forecast: number }> = {};
    for (const mk of monthKeys) {
      result[mk] = {
        budget:   sumMonths(lines, monthlyData, [mk], "budget"),
        actual:   isPastMonth(mk) ? sumMonths(lines, monthlyData, [mk], "actual") : 0,
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: P.sans }}>

      {/* -- Toolbar -- */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {criticalCount > 0 && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", background: P.redLt, border: `1px solid #F0B0AA`, fontFamily: P.mono, fontSize: 9, color: P.red, letterSpacing: "0.06em" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: P.red, display: "inline-block", animation: "pulse 2s infinite" }} />
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
          <button
            onClick={() => setShowConfig(v => !v)}
            style={{
              display: "flex", alignItems: "center", gap: 5, padding: "5px 12px",
              border: `1px solid ${showConfig ? P.borderMd : P.border}`,
              background: showConfig ? "#E8EDF2" : P.bg, color: showConfig ? P.navy : P.textMd,
              fontFamily: P.mono, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            <Settings2 style={{ width: 12, height: 12 }} /> CONFIGURE
          </button>
          <div style={{ display: "flex" }}>
            {(["monthly", "quarterly"] as const).map(m => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                style={{
                  padding: "5px 12px", fontFamily: P.mono, fontSize: 9, letterSpacing: "0.08em",
                  textTransform: "uppercase", cursor: "pointer",
                  background: viewMode === m ? P.navy : P.bg,
                  color: viewMode === m ? "#FFF" : P.textMd,
                  border: `1px solid ${viewMode === m ? P.navy : P.border}`,
                }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* -- Config panel -- */}
      {showConfig && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-end", padding: "14px 18px", border: `1px solid ${P.border}`, background: P.surface }}>
          {[
            {
              label: "FY Start Month",
              control: (
                <select value={fyConfig.fy_start_month} onChange={e => onFyConfigChange({ ...fyConfig, fy_start_month: Number(e.target.value) as FYConfig["fy_start_month"] })} disabled={readOnly} style={selectStyle}>
                  {FY_START_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ),
            },
            {
              label: "FY Start Year",
              control: (
                <input type="number" value={fyConfig.fy_start_year} onChange={e => onFyConfigChange({ ...fyConfig, fy_start_year: Number(e.target.value) })} disabled={readOnly} min={2020} max={2040} style={{ ...selectStyle, width: 88 }} />
              ),
            },
            {
              label: "Duration",
              control: (
                <select value={fyConfig.num_months} onChange={e => onFyConfigChange({ ...fyConfig, num_months: Number(e.target.value) })} disabled={readOnly} style={selectStyle}>
                  {DURATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ),
            },
          ].map(({ label, control }) => (
            <div key={label}>
              <div style={{ fontFamily: P.mono, fontSize: 8, letterSpacing: "0.1em", textTransform: "uppercase", color: P.textSm, marginBottom: 5 }}>{label}</div>
              {control}
            </div>
          ))}
        </div>
      )}

      {/* -- Legend -- */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
        {[
          { bg: "#EEF4F9", bc: "#A0BAD0", l: "Budget" },
          { bg: P.violetLt, bc: "#C0B0E0", l: "Actual (locked)" },
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

      {/* -- Table -- */}
      <div style={{ border: `1px solid ${P.borderMd}`, overflow: "hidden", maxHeight: "70vh", overflowY: "auto", overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", background: P.surface, minWidth: `${200 + monthKeys.length * 168 + 90}px` }}>

          {/* -- THEAD -- */}
          <thead style={{ position: "sticky", top: 0, zIndex: 20 }}>

            {/* Quarter header */}
            <tr style={{ background: "#EFEFEC" }}>
              <th style={{ position: "sticky", left: 0, zIndex: 30, background: "#EFEFEC", minWidth: 200, padding: "7px 10px", textAlign: "left", borderRight: `1px solid ${P.borderMd}`, borderBottom: `1px solid ${P.borderMd}`, fontFamily: P.mono, fontSize: 8, color: P.textSm, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 500 }}>
                Cost Line
              </th>
              {viewMode === "monthly"
                ? quarters.map(q => (
                    <th key={q.label} colSpan={q.months.length * 3} style={{ padding: "7px 10px", textAlign: "center", fontFamily: P.mono, fontSize: 9, fontWeight: 500, color: P.text, letterSpacing: "0.08em", textTransform: "uppercase", borderRight: `1px solid ${P.borderMd}`, borderBottom: `1px solid ${P.border}`, background: "#F2F2EF" }}>
                      {q.label}
                    </th>
                  ))
                : quarters.map(q => (
                    <th key={q.label} colSpan={5} style={{ padding: "7px 10px", textAlign: "center", fontFamily: P.mono, fontSize: 9, fontWeight: 500, color: P.text, letterSpacing: "0.08em", textTransform: "uppercase", borderRight: `1px solid ${P.borderMd}`, borderBottom: `1px solid ${P.border}`, background: "#F2F2EF" }}>
                      {q.label}
                    </th>
                  ))
              }
              <th style={{ position: "sticky", right: 0, zIndex: 30, background: "#EFEFEC", minWidth: 90, padding: "7px 10px", textAlign: "right", borderLeft: `1px solid ${P.borderMd}`, borderBottom: `1px solid ${P.borderMd}`, fontFamily: P.mono, fontSize: 8, color: P.textSm, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 500 }}>
                Total
              </th>
            </tr>

            {/* Month sub-headers */}
            {viewMode === "monthly" && (
              <tr style={{ background: "#F7F7F5" }}>
                <th style={{ position: "sticky", left: 0, zIndex: 30, background: "#F7F7F5", padding: "4px 10px", borderRight: `1px solid ${P.borderMd}`, borderBottom: `1px solid ${P.border}` }} />
                {quarters.flatMap(q =>
                  q.months.map(mk => {
                    const month     = Number(mk.split("-")[1]);
                    const year      = Number(mk.split("-")[0]);
                    const isCurrent = isCurrentMonth(mk);
                    const isPast    = isPastMonth(mk);
                    const mSigs     = signals.filter((s): s is Signal & { scope: string; scopeKey: string } =>
                      s && typeof s === "object" && "scope" in s && "scopeKey" in s && s.scope === "month" && s.scopeKey === mk
                    );
                    const hasCrit = mSigs.some(s => s.severity === "critical");
                    return (
                      <th key={mk} colSpan={3} style={{ padding: "5px 4px", textAlign: "center", borderRight: `1px solid ${P.border}`, borderBottom: `1px solid ${P.border}`, background: isCurrent ? "#E8F0F8" : hasCrit ? P.redLt : isPast ? "#F9F9F7" : "#F7F7F5", opacity: isPast && !isCurrent ? 0.75 : 1 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                          {isCurrent && <span style={{ width: 5, height: 5, borderRadius: "50%", background: P.navy, boxShadow: `0 0 0 2px ${P.navyLt}`, display: "inline-block", flexShrink: 0 }} />}
                          <span style={{ fontFamily: P.mono, fontSize: 10, fontWeight: isCurrent ? 600 : 400, color: isCurrent ? P.navy : P.text }}>
                            {MONTH_SHORT[month - 1]}
                          </span>
                          <span style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm }}>{String(year).slice(2)}</span>
                          <InlineMonthFlag monthKey={mk} signals={signals} />
                        </div>
                      </th>
                    );
                  })
                )}
                <th style={{ position: "sticky", right: 0, zIndex: 30, background: "#F7F7F5", padding: "4px 10px", borderLeft: `1px solid ${P.borderMd}`, borderBottom: `1px solid ${P.border}` }} />
              </tr>
            )}

            {/* Bud / Act / Fct labels */}
            <tr style={{ background: "#F2F2EF" }}>
              <th style={{ position: "sticky", left: 0, zIndex: 30, background: "#F2F2EF", padding: "3px 10px", borderRight: `1px solid ${P.borderMd}`, borderBottom: `1px solid ${P.borderMd}` }} />
              {viewMode === "monthly"
                ? quarters.flatMap(q => q.months.flatMap(mk => [
                    <th key={`${mk}-b`} style={{ ...thBase, background: "#EEF4F9", color: P.navy, minWidth: 56 }}>BUD</th>,
                    <th key={`${mk}-a`} style={{ ...thBase, background: P.violetLt, color: P.violet, minWidth: 56 }}>ACT</th>,
                    <th key={`${mk}-f`} style={{ ...thBase, background: "#F0F7F3", color: P.green, borderRight: `1px solid ${P.border}`, minWidth: 56 }}>FCT</th>,
                  ]))
                : quarters.flatMap(q => [
                    <th key={`${q.label}-b`} style={{ ...thBase, background: "#EEF4F9", color: P.navy, padding: "3px 6px" }}>Budget</th>,
                    <th key={`${q.label}-a`} style={{ ...thBase, background: P.violetLt, color: P.violet, padding: "3px 6px" }}>Actual</th>,
                    <th key={`${q.label}-f`} style={{ ...thBase, background: "#F0F7F3", color: P.green, padding: "3px 6px" }}>Forecast</th>,
                    <th key={`${q.label}-v`} style={{ ...thBase, color: P.amber, padding: "3px 6px" }}>Var</th>,
                    <th key={`${q.label}-u`} style={{ ...thBase, color: P.textSm, borderRight: `1px solid ${P.border}`, padding: "3px 6px" }}>Util%</th>,
                  ])
              }
              <th style={{ ...thBase, position: "sticky", right: 0, zIndex: 30, background: "#F0F7F3", color: P.green, borderLeft: `1px solid ${P.borderMd}`, textAlign: "right", padding: "3px 10px" }}>FCT</th>
            </tr>
          </thead>

          {/* -- TBODY -- */}
          <tbody>
            {viewMode === "monthly"
              ? quarters.flatMap(q => {
                  const isCollapsed = collapsedQuarters.has(q.label);
                  const quarterRow = (
                    <QuarterRow
                      key={`q-${q.label}`}
                      label={q.label} months={q.months}
                      monthlyData={monthlyData} lines={lines} sym={sym}
                      collapsed={isCollapsed} onToggle={() => toggleQuarter(q.label)}
                      signals={signals}
                    />
                  );

                  if (isCollapsed) return [quarterRow];

                  const costLineRows = lines.map((line, li) => {
                    const lineFctTotal = q.months.reduce((s, mk) => s + (Number(monthlyData[line.id]?.[mk]?.forecast) || 0), 0);
                    const lineBudTotal = q.months.reduce((s, mk) => s + (Number(monthlyData[line.id]?.[mk]?.budget) || 0), 0);
                    const isOver = lineBudTotal > 0 && lineFctTotal > lineBudTotal;
                    const rowBg  = li % 2 === 0 ? P.surface : "#FAFAF8";

                    return (
                      <tr key={`${q.label}-${line.id}`} style={{ background: rowBg, borderBottom: `1px solid ${P.border}` }}>
                        <td style={{ position: "sticky", left: 0, zIndex: 10, padding: "5px 10px 5px 22px", borderRight: `1px solid ${P.border}`, background: rowBg, minWidth: 200 }}>
                          <span style={{ fontFamily: P.sans, fontSize: 11, fontWeight: 500, color: P.text, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>
                            {line.description || <span style={{ fontStyle: "italic", color: P.textSm }}>{line.category}</span>}
                          </span>
                        </td>
                        {q.months.flatMap(mk => {
                          const e      = monthlyData[line.id]?.[mk] ?? emptyEntry();
                          const locked = isPastMonth(mk);
                          const fOver  = e.budget && Number(e.forecast) > Number(e.budget);
                          return [
                            <td key={`${mk}-b`} style={{ borderBottom: `1px solid ${P.border}`, background: "#F2F8FF", minWidth: 56 }}>
                              <MoneyInput value={e.budget} onChange={v => updateEntry(line.id, mk, { budget: v })} sym={sym} locked={readOnly} highlight="blue" />
                            </td>,
                            <td key={`${mk}-a`} style={{ borderBottom: `1px solid ${P.border}`, background: "#F9F7FF", minWidth: 56 }}>
                              <MoneyInput value={e.actual} onChange={v => updateEntry(line.id, mk, { actual: v })} sym={sym} locked={locked || readOnly} highlight="gray" />
                            </td>,
                            <td key={`${mk}-f`} style={{ borderBottom: `1px solid ${P.border}`, borderRight: `1px solid ${P.border}`, minWidth: 56, background: fOver ? "#FDF5F4" : "#F3FAF6" }}>
                              <MoneyInput value={e.forecast} onChange={v => updateEntry(line.id, mk, { forecast: v })} sym={sym} locked={locked || readOnly} highlight={fOver ? "red" : "green"} />
                            </td>,
                          ];
                        })}
                        <td style={{ position: "sticky", right: 0, zIndex: 10, padding: "4px 10px", textAlign: "right", fontFamily: P.mono, fontSize: 10, fontWeight: 600, color: isOver ? P.red : lineFctTotal > 0 ? P.green : P.textSm, background: rowBg, borderLeft: `1px solid ${P.border}`, borderBottom: `1px solid ${P.border}`, fontVariantNumeric: "tabular-nums" }}>
                          {lineFctTotal ? fmtK(lineFctTotal, sym) : "--"}
                        </td>
                      </tr>
                    );
                  });

                  const totalsRow = (
                    <tr key={`${q.label}-totals`} style={{ background: "#F0F0ED", borderBottom: `2px solid ${P.borderMd}` }}>
                      <td style={{ position: "sticky", left: 0, zIndex: 10, padding: "5px 10px 5px 22px", borderRight: `1px solid ${P.borderMd}`, background: "#F0F0ED", fontFamily: P.mono, fontSize: 8, fontWeight: 600, color: P.textSm, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                        Q Total
                      </td>
                      {q.months.flatMap(mk => {
                        const t     = monthTotals[mk];
                        const fOver = t.budget && t.forecast > t.budget;
                        return [
                          <td key={`${mk}-tb`} style={{ padding: "5px 6px", textAlign: "right", fontFamily: P.mono, fontSize: 10, fontWeight: 600, color: P.navy, background: "#E8F0F8", fontVariantNumeric: "tabular-nums" }}>{t.budget ? fmtK(t.budget, sym) : "--"}</td>,
                          <td key={`${mk}-ta`} style={{ padding: "5px 6px", textAlign: "right", fontFamily: P.mono, fontSize: 10, color: P.violet, background: "#F0EEFF", fontVariantNumeric: "tabular-nums" }}>{t.actual ? fmtK(t.actual, sym) : "--"}</td>,
                          <td key={`${mk}-tf`} style={{ padding: "5px 6px", textAlign: "right", fontFamily: P.mono, fontSize: 10, fontWeight: 600, color: fOver ? P.red : P.green, background: fOver ? "#FBF0EE" : "#EAF5EE", borderRight: `1px solid ${P.border}`, fontVariantNumeric: "tabular-nums" }}>{t.forecast ? fmtK(t.forecast, sym) : "--"}</td>,
                        ];
                      })}
                      <td style={{ position: "sticky", right: 0, zIndex: 10, padding: "5px 10px", textAlign: "right", fontFamily: P.mono, fontSize: 11, fontWeight: 700, color: P.text, background: "#F0F0ED", borderLeft: `1px solid ${P.borderMd}`, fontVariantNumeric: "tabular-nums" }}>
                        {fmtK(q.months.reduce((s, mk) => s + (monthTotals[mk]?.forecast ?? 0), 0), sym)}
                      </td>
                    </tr>
                  );

                  const movementRow = (
                    <tr key={`${q.label}-movement`} style={{ background: "#FDFAF2", borderBottom: `1px solid #E8E0C0` }}>
                      <td style={{ position: "sticky", left: 0, zIndex: 10, padding: "4px 10px 4px 22px", borderRight: `1px solid #E8E0C0`, background: "#FDFAF2", fontFamily: P.mono, fontSize: 8, fontWeight: 600, color: P.amber, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                        ? Movement
                      </td>
                      {q.months.flatMap(mk => {
                        const mv      = forecastMovement[mk];
                        const hasMove = mv !== null && mv !== 0;
                        return [
                          <td key={`${mk}-mv1`} style={{ background: "#FDFAF2", borderBottom: `1px solid #F0E8C0` }} />,
                          <td key={`${mk}-mv2`} style={{ background: "#FDFAF2", borderBottom: `1px solid #F0E8C0` }} />,
                          <td key={`${mk}-mv3`} style={{ padding: "4px 6px", textAlign: "right", background: "#FDFAF2", borderRight: `1px solid #E8E0C0`, borderBottom: `1px solid #F0E8C0` }}>
                            {hasMove ? (
                              <span style={{ fontFamily: P.mono, fontSize: 9, fontWeight: 600, color: (mv ?? 0) > 0 ? P.red : P.green, fontVariantNumeric: "tabular-nums" }}>
                                {(mv ?? 0) > 0 ? "+" : "-"} {fmtK(Math.abs(mv!), sym)}
                              </span>
                            ) : <span style={{ fontFamily: P.mono, fontSize: 9, color: P.border }}>?</span>}
                          </td>,
                        ];
                      })}
                      <td style={{ position: "sticky", right: 0, zIndex: 10, background: "#FDFAF2", borderLeft: `1px solid #E8E0C0` }} />
                    </tr>
                  );

                  return [quarterRow, ...costLineRows, totalsRow, movementRow];
                })

              // -- Quarterly view --
              : quarters.map((q, qi) => {
                  const qBudget   = sumMonths(lines, monthlyData, q.months, "budget");
                  // Only count actuals for past months - consistent with monthly view cell locking
                  const qActual   = sumMonths(lines, monthlyData, q.months.filter(isPastMonth), "actual");
                  const qForecast = sumMonths(lines, monthlyData, q.months, "forecast");
                  const qVariance = qBudget ? qForecast - qBudget : 0;
                  const qUtil     = qBudget ? Math.round((qForecast / qBudget) * 100) : null;
                  const over      = qBudget > 0 && qForecast > qBudget;
                  const qSigs     = signals.filter((s): s is Signal & { scopeKey: string } =>
                    s && typeof s === "object" && "scopeKey" in s && s.scopeKey === q.label
                  );
                  const qCrit = qSigs.some(s => s.severity === "critical");
                  const rowBg = qCrit ? P.redLt : qi % 2 === 0 ? P.surface : "#FAFAF8";

                  return (
                    <tr key={q.label} style={{ background: rowBg, borderBottom: `1px solid ${P.border}` }}>
                      <td style={{ position: "sticky", left: 0, zIndex: 10, padding: "10px", background: rowBg, minWidth: 200, borderRight: `1px solid ${P.border}` }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontFamily: P.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: P.text }}>{q.label}</span>
                          <InlineQuarterFlags quarterLabel={q.label} signals={signals} />
                        </div>
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: P.mono, fontSize: 11, fontWeight: 500, color: P.navy, background: "#F2F8FF", fontVariantNumeric: "tabular-nums" }}>{fmt(qBudget, sym)}</td>
                      <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: P.mono, fontSize: 11, color: P.violet, background: "#F9F7FF", fontVariantNumeric: "tabular-nums" }}>{fmt(qActual, sym)}</td>
                      <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: P.mono, fontSize: 11, fontWeight: 600, color: over ? P.red : P.green, background: over ? P.redLt : P.greenLt, fontVariantNumeric: "tabular-nums" }}>{fmt(qForecast, sym)}</td>
                      <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: P.mono, fontSize: 11, fontWeight: 500, color: over ? P.red : P.green, fontVariantNumeric: "tabular-nums" }}>
                        {qBudget ? `${over ? "+" : ""}${fmt(qVariance, sym)}` : "--"}
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: P.mono, fontSize: 11, color: (qUtil ?? 0) > 100 ? P.red : (qUtil ?? 0) > 85 ? P.amber : P.textMd, borderRight: `1px solid ${P.border}`, fontVariantNumeric: "tabular-nums" }}>
                        {qUtil !== null ? `${qUtil}%` : "--"}
                      </td>
                      <td style={{ position: "sticky", right: 0, zIndex: 10, padding: "10px", textAlign: "right", fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: P.text, background: rowBg, borderLeft: `1px solid ${P.border}`, fontVariantNumeric: "tabular-nums" }}>
                        {fmt(qForecast, sym)}
                      </td>
                    </tr>
                  );
                })
            }
          </tbody>

          {/* -- TFOOT -- */}
          <tfoot style={{ position: "sticky", bottom: 0, zIndex: 20 }}>
            <tr style={{ background: "#EAEAE7", borderTop: `2px solid ${P.borderMd}` }}>
              <td style={{ position: "sticky", left: 0, zIndex: 30, padding: "8px 10px", background: "#EAEAE7", borderRight: `1px solid ${P.borderMd}`, fontFamily: P.mono, fontSize: 8, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: P.textMd }}>
                Grand Total
              </td>
              {viewMode === "monthly"
                ? monthKeys.flatMap(mk => {
                    const t     = monthTotals[mk];
                    const fOver = t.budget && t.forecast > t.budget;
                    return [
                      <td key={`ft-${mk}-b`} style={{ padding: "7px 6px", textAlign: "right", fontFamily: P.mono, fontSize: 10, fontWeight: 600, color: P.navy, background: "#E8F0F8", fontVariantNumeric: "tabular-nums" }}>{t.budget ? fmtK(t.budget, sym) : "--"}</td>,
                      <td key={`ft-${mk}-a`} style={{ padding: "7px 6px", textAlign: "right", fontFamily: P.mono, fontSize: 10, color: P.violet, background: "#F0EEFF", fontVariantNumeric: "tabular-nums" }}>{t.actual ? fmtK(t.actual, sym) : "--"}</td>,
                      <td key={`ft-${mk}-f`} style={{ padding: "7px 6px", textAlign: "right", fontFamily: P.mono, fontSize: 10, fontWeight: 700, color: fOver ? P.red : P.green, background: fOver ? "#FAF0EE" : "#E8F5EE", borderRight: `1px solid ${P.border}`, fontVariantNumeric: "tabular-nums" }}>{t.forecast ? fmtK(t.forecast, sym) : "--"}</td>,
                    ];
                  })
                : quarters.flatMap(q => {
                    const qB = sumMonths(lines, monthlyData, q.months, "budget");
                    // FIX 2: Grand Total quarterly actual - match tbody filter (past months only)
                    const qA = sumMonths(lines, monthlyData, q.months.filter(isPastMonth), "actual");
                    const qF = sumMonths(lines, monthlyData, q.months, "forecast");
                    const qV = qB ? qF - qB : 0;
                    const qU = qB ? Math.round((qF / qB) * 100) : null;
                    return [
                      <td key={`${q.label}-b`} style={{ padding: "7px 8px", textAlign: "right", fontFamily: P.mono, fontSize: 10, fontWeight: 600, color: P.navy, background: "#E8F0F8", fontVariantNumeric: "tabular-nums" }}>{fmt(qB, sym)}</td>,
                      <td key={`${q.label}-a`} style={{ padding: "7px 8px", textAlign: "right", fontFamily: P.mono, fontSize: 10, color: P.violet, background: "#F0EEFF", fontVariantNumeric: "tabular-nums" }}>{fmt(qA, sym)}</td>,
                      <td key={`${q.label}-f`} style={{ padding: "7px 8px", textAlign: "right", fontFamily: P.mono, fontSize: 10, fontWeight: 700, color: qF > qB ? P.red : P.green, background: qF > qB ? "#FAF0EE" : "#E8F5EE", fontVariantNumeric: "tabular-nums" }}>{fmt(qF, sym)}</td>,
                      <td key={`${q.label}-v`} style={{ padding: "7px 8px", textAlign: "right", fontFamily: P.mono, fontSize: 10, color: P.amber, fontVariantNumeric: "tabular-nums" }}>{qB ? fmt(qV, sym) : "--"}</td>,
                      <td key={`${q.label}-u`} style={{ padding: "7px 8px", textAlign: "right", fontFamily: P.mono, fontSize: 10, color: P.textMd, borderRight: `1px solid ${P.border}`, fontVariantNumeric: "tabular-nums" }}>{qU !== null ? `${qU}%` : "--"}</td>,
                    ];
                  })
              }
              <td style={{ position: "sticky", right: 0, zIndex: 30, padding: "8px 12px", textAlign: "right", fontFamily: P.mono, fontSize: 13, fontWeight: 700, color: P.green, background: "#EAEAE7", borderLeft: `1px solid ${P.borderMd}`, fontVariantNumeric: "tabular-nums" }}>
                {grandTotalForecast ? fmtK(grandTotalForecast, sym) : "--"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* -- Forecast movement strip -- */}
      {viewMode === "monthly" && (
        <div style={{ border: `1px solid #E0D8B0`, background: "#FDFAF2", padding: "12px 16px" }}>
          <div style={{ fontFamily: P.mono, fontSize: 8, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: P.amber, marginBottom: 8 }}>
            Forecast Movement (month-on-month)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {monthKeys.map(mk => {
              const mv = forecastMovement[mk];
              if (!mv || mv === 0) return null;
              // Don't show movement for future months with no data
              if (!isPastMonth(mk) && !(monthTotals[mk]?.forecast)) return null;
              const [y, m] = mk.split("-");
              const up = mv > 0;
              return (
                <div key={mk} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 10px", background: up ? P.redLt : P.greenLt, border: `1px solid ${up ? "#F0B0AA" : "#A0D0B8"}`, fontFamily: P.mono, fontSize: 10 }}>
                  <span style={{ color: P.textSm }}>{MONTH_SHORT[Number(m) - 1]} {y.slice(2)}</span>
                  <span style={{ fontWeight: 600, color: up ? P.red : P.green, fontVariantNumeric: "tabular-nums" }}>{up ? "+" : "-"} {fmtK(Math.abs(mv), sym)}</span>
                </div>
              );
            })}
            {monthKeys.every(mk => !forecastMovement[mk]) && (
              <span style={{ fontFamily: P.mono, fontSize: 10, color: P.textSm, fontStyle: "italic" }}>No forecast movement yet</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}