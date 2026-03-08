"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  Plus, Trash2, TrendingUp, TrendingDown, AlertTriangle,
  Calendar, Users, Link2, Link2Off, Zap, ChevronRight,
  Check, AlertCircle, Lock, Clock,
} from "lucide-react";
import FinancialPlanMonthlyView, { type MonthlyData, type FYConfig } from "./FinancialPlanMonthlyView";
import FinancialIntelligencePanel from "./FinancialIntelligencePanel";
import { analyseFinancialPlan, type Signal } from "@/lib/financial-intelligence";
import ResourcePicker, { type PickedPerson } from "./ResourcePicker";
// getRateForUser removed — rate card lookup uses fetch (/api/org/rate-card) to avoid blocking navigation
import { syncResourcesToMonthlyData, previewSync } from "./syncResourcesToMonthlyData";
import {
  computeActuals,
  computeActualTotalsPerLine,
  applyActualsToMonthlyData,
  type TimesheetEntry,
  type ActualsByLine,
} from "./computeActuals";

// ── Palantir design tokens ────────────────────────────────────────────────────
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
  blue:     "#1B3652",
  blueLt:   "#EBF0F5",
  mono:     "'DM Mono', 'Courier New', monospace",
  sans:     "'DM Sans', system-ui, sans-serif",
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export const CURRENCIES = ["GBP", "USD", "EUR", "AUD", "CAD"] as const;
export type Currency = typeof CURRENCIES[number];
export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  GBP: "£", USD: "$", EUR: "€", AUD: "A$", CAD: "C$",
};

export type CostCategory =
  | "people" | "tools_licences" | "infrastructure"
  | "external_vendors" | "travel" | "contingency" | "other";

export const CATEGORY_LABELS: Record<CostCategory, string> = {
  people: "People & Contractors",
  tools_licences: "Tools & Licences",
  infrastructure: "Infrastructure",
  external_vendors: "External Vendors",
  travel: "Travel & Expenses",
  contingency: "Contingency",
  other: "Other",
};

export type CostLine = {
  id: string;
  category: CostCategory;
  description: string;
  budgeted: number | "";
  actual: number | "";
  forecast: number | "";
  notes: string;
  override?: boolean;
};

export type ChangeExposure = {
  id: string;
  change_ref: string;
  title: string;
  cost_impact: number | "";
  status: "approved" | "pending" | "rejected";
  notes: string;
};

export type ResourceRateType = "day_rate" | "monthly_cost";
export type ResourceRole =
  | "project_manager" | "business_analyst" | "developer" | "designer"
  | "qa_engineer" | "architect" | "scrum_master" | "devops"
  | "consultant" | "contractor" | "vendor" | "other";
export type ResourceType = "internal" | "contractor" | "vendor" | "consultant";

export const RESOURCE_ROLE_LABELS: Record<ResourceRole, string> = {
  project_manager: "Project Manager",
  business_analyst: "Business Analyst",
  developer: "Developer",
  designer: "Designer / UX",
  qa_engineer: "QA Engineer",
  architect: "Architect",
  scrum_master: "Scrum Master",
  devops: "DevOps / Infra",
  consultant: "Consultant",
  contractor: "Contractor",
  vendor: "Vendor",
  other: "Other",
};

export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  internal: "Internal",
  contractor: "Contractor",
  vendor: "Vendor",
  consultant: "Consultant",
};

export type Resource = {
  id: string;
  user_id?: string;
  name: string;
  role: ResourceRole;
  type: ResourceType;
  rate_type: ResourceRateType;
  day_rate: number | "";
  planned_days: number | "";
  monthly_cost: number | "";
  planned_months: number | "";
  cost_line_id: string | null;
  notes: string;
  start_month?: string;
};

export type FinancialPlanContent = {
  currency: Currency;
  total_approved_budget: number | "";
  summary: string;
  cost_lines: CostLine[];
  change_exposure: ChangeExposure[];
  resources?: Resource[];
  variance_narrative: string;
  assumptions: string;
  monthly_data?: MonthlyData;
  fy_config?: FYConfig;
  last_updated_at?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 10); }

export function emptyFinancialPlan(currency: Currency = "GBP"): FinancialPlanContent {
  const now = new Date();
  return {
    currency,
    total_approved_budget: "",
    summary: "",
    cost_lines: [],
    change_exposure: [],
    resources: [],
    variance_narrative: "",
    assumptions: "",
    monthly_data: {},
    fy_config: {
      fy_start_month: 4,
      fy_start_year: now.getFullYear(),
      num_months: 12,
    },
    last_updated_at: now.toISOString(),
  };
}

function emptyCostLine(): CostLine {
  return { id: uid(), category: "people", description: "", budgeted: "", actual: "", forecast: "", notes: "", override: false };
}

function emptyChangeExposure(): ChangeExposure {
  return { id: uid(), change_ref: "", title: "", cost_impact: "", status: "pending", notes: "" };
}

function emptyResource(): Resource {
  return { id: uid(), user_id: undefined, name: "", role: "developer", type: "internal", rate_type: "day_rate", day_rate: "", planned_days: "", monthly_cost: "", planned_months: "", cost_line_id: null, notes: "" };
}

function resourceTotal(r: Resource): number {
  if (r.rate_type === "day_rate") return (Number(r.day_rate) || 0) * (Number(r.planned_days) || 0);
  return (Number(r.monthly_cost) || 0) * (Number(r.planned_months) || 0);
}

function rollupResourcesToLines(lines: CostLine[], resources: Resource[]): CostLine[] {
  const totals: Record<string, number> = {};
  for (const r of resources) {
    if (!r.cost_line_id) continue;
    const t = resourceTotal(r);
    if (t > 0) totals[r.cost_line_id] = (totals[r.cost_line_id] ?? 0) + t;
  }
  return lines.map(line => {
    if (line.override) return line;
    const rolled = totals[line.id];
    if (rolled === undefined) return line;
    return { ...line, budgeted: rolled, forecast: rolled };
  });
}

function applyActualsToCostLines(lines: CostLine[], actualTotals: Record<string, number>): CostLine[] {
  return lines.map(line => ({ ...line, actual: actualTotals[line.id] ?? (line.actual === "" ? "" : line.actual) }));
}

function fmt(n: number | "" | null | undefined, sym: string): string {
  if (n === "" || n == null || isNaN(Number(n))) return "—";
  return `${sym}${Number(n).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

function fmtShort(n: number, sym: string): string {
  if (!n) return "—";
  if (Math.abs(n) >= 1_000_000) return `${sym}${(Math.abs(n) / 1_000_000).toFixed(1)}M`;
  return `${sym}${Math.abs(n).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

function sumField(lines: CostLine[], field: keyof CostLine): number {
  return lines.reduce((s, l) => s + (Number(l[field]) || 0), 0);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function VarianceBadge({ budget, forecast }: { budget: number | ""; forecast: number | "" }) {
  if (!budget || forecast === "") return <span style={{ color: P.border, fontSize: 11 }}>—</span>;
  const pct = ((Number(forecast) - Number(budget)) / Number(budget)) * 100;
  const over = pct > 0;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, fontFamily: P.mono, color: over ? P.red : P.green }}>
      {over ? <TrendingUp style={{ width: 11, height: 11 }} /> : <TrendingDown style={{ width: 11, height: 11 }} />}
      {over ? "+" : ""}{pct.toFixed(1)}%
    </span>
  );
}

function MoneyCell({ value, onChange, symbol, readOnly = false }: {
  value: number | ""; onChange: (v: number | "") => void; symbol: string; readOnly?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 4px" }}>
      <span style={{ fontSize: 11, color: P.textSm, fontFamily: P.mono }}>{symbol}</span>
      <input
        type="number" min={0} step={100} value={value}
        onChange={e => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        readOnly={readOnly}
        style={{
          width: 96, border: "none", background: "transparent", padding: "6px 0",
          fontSize: 12, textAlign: "right", fontWeight: 500, color: P.text,
          fontFamily: P.mono, outline: "none", opacity: readOnly ? 0.6 : 1,
          cursor: readOnly ? "default" : "text",
        }}
        onFocus={e => { if (!readOnly) e.currentTarget.style.outline = `1px solid ${P.navy}`; }}
        onBlur={e => { e.currentTarget.style.outline = "none"; }}
        placeholder="0"
      />
    </div>
  );
}

function ActualCell({ value, symbol, approvedDays, hasTimesheetData }: {
  value: number | ""; symbol: string; approvedDays: number; hasTimesheetData: boolean;
}) {
  const hasValue = value !== "" && value !== 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "6px 8px", margin: "0 4px", background: hasValue ? P.violetLt : "#F4F4F2", border: `1px solid ${hasValue ? "#C0B0E0" : P.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {hasValue
          ? <Lock style={{ width: 10, height: 10, color: P.violet, flexShrink: 0 }} />
          : <Clock style={{ width: 10, height: 10, color: P.textSm, flexShrink: 0, opacity: 0.4 }} />
        }
        <span style={{ fontSize: 12, fontWeight: 600, fontFamily: P.mono, color: hasValue ? P.violet : P.textSm, fontVariantNumeric: "tabular-nums" }}>
          {hasValue ? fmt(value, symbol) : "—"}
        </span>
      </div>
      {hasTimesheetData && approvedDays > 0 && (
        <div style={{ fontSize: 9, color: P.violet, fontFamily: P.mono, paddingLeft: 16, opacity: 0.7 }}>
          {approvedDays.toLocaleString()} day{approvedDays !== 1 ? "s" : ""} approved
        </div>
      )}
      {!hasTimesheetData && (
        <div style={{ fontSize: 9, color: P.textSm, fontFamily: P.mono, paddingLeft: 16 }}>awaiting timesheets</div>
      )}
    </div>
  );
}

function OverrideToggle({ line, hasLinkedResources, resTotal, sym, onToggle }: {
  line: CostLine; hasLinkedResources: boolean; resTotal: number; sym: string; onToggle: () => void;
}) {
  if (!hasLinkedResources) return null;
  return (
    <button
      onClick={onToggle}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px",
        fontFamily: P.mono, fontSize: 9, fontWeight: 700, letterSpacing: "0.04em", cursor: "pointer",
        background: line.override ? P.amberLt : P.greenLt,
        border: `1px solid ${line.override ? "#E0C080" : "#A0D0B8"}`,
        color: line.override ? P.amber : P.green,
      }}
      title={line.override ? "Re-enable auto-update from resources" : "Override — stop auto-update"}
    >
      {line.override ? <Link2Off style={{ width: 9, height: 9 }} /> : <Link2 style={{ width: 9, height: 9 }} />}
      {line.override ? "Override" : `Auto ${fmt(resTotal, sym)}`}
    </button>
  );
}

// ── ResourceSyncBar ───────────────────────────────────────────────────────────

function ResourceSyncBar({ resources, costLines, monthlyData, fyConfig, currency, timesheetEntries, onSync }: {
  resources: Resource[]; costLines: CostLine[]; monthlyData: MonthlyData;
  fyConfig: FYConfig; currency: string; timesheetEntries: TimesheetEntry[];
  onSync: (d: MonthlyData) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [synced, setSynced]     = useState(false);
  const sym = CURRENCY_SYMBOLS[currency as Currency] ?? "£";
  const preview = previewSync(resources, costLines, monthlyData, fyConfig);

  const readyResources = resources.filter(r =>
    r.cost_line_id &&
    ((r.rate_type === "day_rate" && Number(r.day_rate) > 0 && Number(r.planned_days) > 0) ||
     (r.rate_type === "monthly_cost" && Number(r.monthly_cost) > 0 && Number(r.planned_months) > 0))
  );
  const unreadyResources = resources.filter(r =>
    r.cost_line_id &&
    !((r.rate_type === "day_rate" && Number(r.day_rate) > 0 && Number(r.planned_days) > 0) ||
      (r.rate_type === "monthly_cost" && Number(r.monthly_cost) > 0 && Number(r.planned_months) > 0))
  );

  if (resources.length === 0) return null;
  const hasChanges = preview.length > 0;

  function handleSync() {
    let newData = syncResourcesToMonthlyData(resources, costLines, monthlyData, fyConfig);
    const actualsByLine = computeActuals(resources, timesheetEntries);
    newData = applyActualsToMonthlyData(newData, actualsByLine);
    onSync(newData);
    setSynced(true);
    setTimeout(() => setSynced(false), 3000);
    setExpanded(false);
  }

  const barBg = synced ? P.greenLt : hasChanges ? P.navyLt : P.bg;
  const barBorder = synced ? "#A0D0B8" : hasChanges ? "#A0BAD0" : P.border;

  return (
    <div style={{ border: `1px solid ${barBorder}`, background: barBg, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Zap style={{ width: 14, height: 14, flexShrink: 0, color: synced ? P.green : hasChanges ? P.navy : P.textSm }} />
          <div>
            <div style={{ fontFamily: P.mono, fontSize: 10, fontWeight: 700, color: synced ? P.green : hasChanges ? P.navy : P.textMd, letterSpacing: "0.04em" }}>
              {synced ? "Monthly phasing synced — actuals from approved timesheets"
                : hasChanges ? `${readyResources.length} resource${readyResources.length !== 1 ? "s" : ""} ready to sync to monthly phasing`
                : "Monthly phasing is up to date with resources"}
            </div>
            <div style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm, marginTop: 2 }}>
              {readyResources.length} ready · {unreadyResources.length} missing rate or qty · {resources.filter(r => !r.cost_line_id).length} unlinked
              {timesheetEntries.length > 0 && (
                <span style={{ marginLeft: 8, color: P.violet, fontWeight: 600 }}>
                  · {timesheetEntries.length} approved timesheet entr{timesheetEntries.length !== 1 ? "ies" : "y"}
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {hasChanges && !synced && (
            <>
              <button onClick={() => setExpanded(v => !v)} style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: P.mono, fontSize: 10, color: P.navy, cursor: "pointer", background: "none", border: "none", fontWeight: 500 }}>
                Preview
                <ChevronRight style={{ width: 12, height: 12, transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }} />
              </button>
              <button onClick={handleSync} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", background: P.navy, color: "#FFF", fontFamily: P.mono, fontSize: 10, fontWeight: 700, border: "none", cursor: "pointer", letterSpacing: "0.04em" }}>
                <Zap style={{ width: 11, height: 11 }} /> SYNC TO MONTHLY
              </button>
            </>
          )}
          {synced && (
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: P.mono, fontSize: 10, color: P.green, fontWeight: 600 }}>
              <Check style={{ width: 12, height: 12 }} /> Synced
            </span>
          )}
        </div>
      </div>

      {expanded && hasChanges && (
        <div style={{ borderTop: `1px solid ${P.border}`, background: P.surface }}>
          {preview.map(row => {
            const delta = row.totalAfter - row.totalBefore;
            return (
              <div key={row.lineId} style={{ display: "flex", alignItems: "center", gap: 16, padding: "8px 16px", borderBottom: `1px solid ${P.border}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: P.sans, fontSize: 11, fontWeight: 600, color: P.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.lineLabel}</div>
                  <div style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm, marginTop: 2 }}>{row.monthsAffected} month{row.monthsAffected !== 1 ? "s" : ""} will change</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: P.mono, fontSize: 11, flexShrink: 0 }}>
                  <span style={{ color: P.textSm }}>{fmtShort(row.totalBefore, sym)}</span>
                  <span style={{ color: P.border }}>→</span>
                  <span style={{ fontWeight: 700, color: P.text }}>{fmtShort(row.totalAfter, sym)}</span>
                  {delta !== 0 && (
                    <span style={{ padding: "2px 6px", fontFamily: P.mono, fontSize: 9, fontWeight: 700, background: delta > 0 ? P.amberLt : P.greenLt, color: delta > 0 ? P.amber : P.green, border: `1px solid ${delta > 0 ? "#E0C080" : "#A0D0B8"}` }}>
                      {delta > 0 ? "+" : ""}{fmtShort(delta, sym)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {unreadyResources.length > 0 && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 16px", background: P.amberLt, borderTop: `1px solid #E0C080` }}>
              <AlertCircle style={{ width: 13, height: 13, color: P.amber, flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontFamily: P.mono, fontSize: 9, color: P.amber }}>
                <strong>{unreadyResources.length} resource{unreadyResources.length !== 1 ? "s" : ""}</strong> linked but missing rate or qty:
                <ul style={{ marginTop: 4, paddingLeft: 16, listStyle: "disc" }}>
                  {unreadyResources.map(r => <li key={r.id}>{r.name || "Unnamed"}</li>)}
                </ul>
              </div>
            </div>
          )}
          {timesheetEntries.length > 0 && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 16px", background: P.violetLt, borderTop: `1px solid #C0B0E0` }}>
              <Lock style={{ width: 13, height: 13, color: P.violet, flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontFamily: P.mono, fontSize: 9, color: P.violet }}>
                <strong>Actuals</strong> will be auto-computed from{" "}
                <strong>{timesheetEntries.length} approved timesheet entr{timesheetEntries.length !== 1 ? "ies" : "y"}</strong>{" "}
                (approved days × rate card rate). The Actual column is locked.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Resources tab ─────────────────────────────────────────────────────────────

function ResourcesTab({
  resources, costLines, sym, currency, readOnly, onChange, organisationId,
  monthlyData, fyConfig, timesheetEntries, actualsByLine, onSyncMonthly,
}: {
  resources: Resource[]; costLines: CostLine[]; sym: string; currency: Currency;
  readOnly: boolean; onChange: (r: Resource[]) => void; organisationId: string;
  monthlyData: MonthlyData; fyConfig: FYConfig; timesheetEntries: TimesheetEntry[];
  actualsByLine: ActualsByLine; onSyncMonthly: (d: MonthlyData) => void;
}) {
  const update = useCallback((id: string, patch: Partial<Resource>) =>
    onChange(resources.map(r => r.id === id ? { ...r, ...patch } : r)),
  [onChange, resources]);

  const totalCost    = resources.reduce((s, r) => s + resourceTotal(r), 0);
  const linkedCost   = resources.filter(r => r.cost_line_id).reduce((s, r) => s + resourceTotal(r), 0);
  const unlinkedCost = totalCost - linkedCost;

  const approvedDaysByResource = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of timesheetEntries) map[e.resource_id] = (map[e.resource_id] ?? 0) + e.approved_days;
    return map;
  }, [timesheetEntries]);

  const byLine = useMemo(() => {
    const map: Record<string, { line: CostLine; resources: Resource[]; total: number }> = {};
    for (const r of resources) {
      if (!r.cost_line_id) continue;
      const line = costLines.find(l => l.id === r.cost_line_id);
      if (!line) continue;
      if (!map[line.id]) map[line.id] = { line, resources: [], total: 0 };
      map[line.id].resources.push(r);
      map[line.id].total += resourceTotal(r);
    }
    return Object.values(map);
  }, [resources, costLines]);

  const statCards = [
    { label: "Total Resources",      value: String(resources.length), sub: "across all roles",                                                          color: P.text     },
    { label: "Total Resource Cost",  value: fmt(totalCost, sym),      sub: "calculated from rates",                                                     color: P.navy     },
    { label: "Linked to Cost Lines", value: fmt(linkedCost, sym),     sub: `${byLine.length} line${byLine.length !== 1 ? "s" : ""} receiving rollup`,   color: P.green    },
    { label: "Unlinked Cost",        value: fmt(unlinkedCost, sym),   sub: unlinkedCost > 0 ? "not rolling up" : "all linked",                          color: unlinkedCost > 0 ? P.amber : P.textSm },
  ];

  const typeBadgeStyle = (type: ResourceType): React.CSSProperties => ({
    fontSize: 10, fontWeight: 600, fontFamily: P.mono, padding: "3px 8px",
    background: type === "internal" ? P.navyLt : type === "contractor" ? P.amberLt : type === "vendor" ? P.violetLt : "#F4F4F2",
    color:      type === "internal" ? P.navy   : type === "contractor" ? P.amber   : type === "vendor" ? P.violet   : P.textMd,
    border: "none", cursor: readOnly ? "default" : "pointer", outline: "none",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, fontFamily: P.sans }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        {statCards.map(s => (
          <div key={s.label} style={{ background: P.surface, border: `1px solid ${P.border}`, padding: "12px 16px" }}>
            <div style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontFamily: P.mono, fontSize: 16, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm, marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {byLine.length > 0 && (
        <div style={{ border: `1px solid ${P.border}`, background: P.navyLt, padding: "10px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <Link2 style={{ width: 12, height: 12, color: P.navy }} />
            <span style={{ fontFamily: P.mono, fontSize: 9, fontWeight: 700, color: P.navy, letterSpacing: "0.1em", textTransform: "uppercase" }}>Cost Line Rollup</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {byLine.map(({ line, resources: lr, total }) => (
              <div key={line.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", background: line.override ? P.amberLt : P.surface, border: `1px solid ${line.override ? "#E0C080" : P.border}`, fontSize: 11 }}>
                <span style={{ fontWeight: 600, color: P.text, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{line.description || line.category}</span>
                <span style={{ color: P.textSm }}>←</span>
                <span style={{ fontFamily: P.mono, fontSize: 9, color: P.textMd }}>{lr.length} resource{lr.length !== 1 ? "s" : ""}</span>
                <span style={{ fontFamily: P.mono, fontWeight: 700, color: P.navy }}>{fmt(total, sym)}</span>
                {line.override && <span style={{ fontFamily: P.mono, fontSize: 9, fontWeight: 700, color: P.amber, background: P.amberLt, border: `1px solid #E0C080`, padding: "1px 5px" }}>Override</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {!readOnly && (
        <ResourceSyncBar resources={resources} costLines={costLines} monthlyData={monthlyData} fyConfig={fyConfig} currency={currency} timesheetEntries={timesheetEntries} onSync={onSyncMonthly} />
      )}

      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, border: `1px solid #C0B0E0`, background: P.violetLt, padding: "8px 12px", fontSize: 11, color: P.violet }}>
        <Lock style={{ width: 12, height: 12, flexShrink: 0, marginTop: 1 }} />
        <span><strong>People actuals are locked</strong> — computed from approved timesheet days × rate card rate. Hardware, infrastructure and vendor lines can be edited manually in the Cost Breakdown tab.</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${P.border}`, background: P.navyLt, padding: "8px 12px", fontSize: 11, color: P.navy }}>
        <Users style={{ width: 12, height: 12, flexShrink: 0 }} />
        <span>Pick a person from your organisation — their rate auto-fills from the <strong>Rate Card</strong>. Then hit <strong>Sync to monthly</strong> to phase costs across the timeline.</span>
      </div>

      <div style={{ border: `1px solid ${P.borderMd}`, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#F4F4F2", borderBottom: `1px solid ${P.borderMd}` }}>
              {["Person / Role", "Type", "Rate Method", "Rate", "Planned Qty", "Total", "Approved Days", "Actual Cost", "Start Month", "Links to", "Notes", ""].map((h, i) => (
                <th key={i} style={{ padding: "8px 10px", textAlign: "left", fontFamily: P.mono, fontSize: 8, fontWeight: 600, color: h === "Approved Days" || h === "Actual Cost" ? P.violet : P.textSm, letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap", borderBottom: `1px solid ${P.borderMd}`, background: h === "Approved Days" || h === "Actual Cost" ? P.violetLt : "#F4F4F2" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {resources.length === 0 && (
              <tr>
                <td colSpan={12} style={{ padding: "40px 16px", textAlign: "center", fontFamily: P.sans, fontSize: 13, color: P.textSm }}>
                  No resources yet. Click <strong>Add resource</strong> below.
                </td>
              </tr>
            )}
            {resources.map((r, idx) => {
              const total            = resourceTotal(r);
              const linkedLine       = costLines.find(l => l.id === r.cost_line_id);
              const hasRate          = r.rate_type === "day_rate" ? Number(r.day_rate) > 0 : Number(r.monthly_cost) > 0;
              const approvedDays     = approvedDaysByResource[r.id] ?? 0;
              const effectiveDayRate = r.rate_type === "day_rate" ? Number(r.day_rate) || 0 : (Number(r.monthly_cost) || 0) / 20;
              const actualCost       = Math.round(approvedDays * effectiveDayRate * 100) / 100;
              const hasTimesheet     = approvedDays > 0;
              const rowBg            = idx % 2 === 0 ? P.surface : "#FAFAF8";

              const cellStyle: React.CSSProperties = { borderBottom: `1px solid ${P.border}`, background: rowBg };

              return (
                <tr key={r.id} style={cellStyle}>
                  <td style={{ ...cellStyle, minWidth: 220, padding: "4px 8px" }}>
                    <ResourcePicker
                      organisationId={organisationId} value={r.user_id ?? null}
                      currentResource={r} disabled={readOnly}
                      onPick={useCallback(async (person: PickedPerson) => {
                        // Build patch but DON'T apply yet - wait for fetch
                        let finalPatch: Partial<Resource> = {
                          user_id: person.user_id || undefined,
                          name: person.full_name ?? person.name ?? person.email ?? r.name,
                          ...(person.rate_type != null ? {
                            rate_type: person.rate_type,
                            day_rate: person.rate_type === "day_rate" ? (person.rate ?? "") : r.day_rate,
                            monthly_cost: person.rate_type === "monthly_cost" ? (person.rate ?? "") : r.monthly_cost,
                            type: (person.resource_type ?? r.type) as ResourceType,
                          } : {}),
                        };

                        // ── Rate card lookup via fetch (NOT server action) ──────────────────
                        // Server actions block Next.js navigation while in-flight; fetch does not.
                        const personUid = person.user_id;
                        if (personUid && organisationId) {
                          try {
                            const res = await fetch(
                              `/api/org/rate-card?orgId=${encodeURIComponent(organisationId)}&userId=${encodeURIComponent(personUid)}`,
                              { cache: "no-store" }
                            );
                            const d = await res.json().catch(() => ({ ok: false, match: null }));
                            const match = d.ok && d.match ? d.match : null;
                            if (match) {
                              finalPatch = {
                                ...finalPatch,
                                rate_type:    match.rate_type,
                                day_rate:     match.rate_type === "day_rate"     ? match.rate : r.day_rate,
                                monthly_cost: match.rate_type === "monthly_cost" ? match.rate : r.monthly_cost,
                                type:         match.resource_type as ResourceType,
                              };
                            }
                          } catch (e) {
                            console.warn("Rate card lookup failed:", e);
                          }
                        }

                        // Apply single update after all async work completes
                        update(r.id, finalPatch);
                      }, [r.id, r.name, r.day_rate, r.monthly_cost, r.type, organisationId, update])}
                    />
                    <input type="text" value={r.name} onChange={e => update(r.id, { name: e.target.value })} readOnly={readOnly}
                      placeholder="Role label override…"
                      style={{ width: "100%", border: "none", background: "transparent", padding: "2px 6px", fontSize: 10, color: P.textMd, fontFamily: P.sans, outline: "none" }}
                    />
                  </td>
                  <td style={{ ...cellStyle, minWidth: 110, padding: "4px 6px" }}>
                    <select value={r.type} onChange={e => update(r.id, { type: e.target.value as ResourceType })} disabled={readOnly} style={typeBadgeStyle(r.type)}>
                      {(Object.keys(RESOURCE_TYPE_LABELS) as ResourceType[]).map(t => (
                        <option key={t} value={t}>{RESOURCE_TYPE_LABELS[t]}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ ...cellStyle, padding: "4px 6px" }}>
                    <div style={{ display: "flex", background: "#EDEDEB", padding: 2, gap: 2 }}>
                      {(["day_rate", "monthly_cost"] as ResourceRateType[]).map(rt => (
                        <button key={rt} onClick={() => !readOnly && update(r.id, { rate_type: rt })} style={{ padding: "4px 8px", fontSize: 9, fontFamily: P.mono, fontWeight: 700, cursor: readOnly ? "default" : "pointer", background: r.rate_type === rt ? P.surface : "transparent", color: r.rate_type === rt ? P.text : P.textSm, border: r.rate_type === rt ? `1px solid ${P.border}` : "1px solid transparent", whiteSpace: "nowrap" }}>
                          {rt === "day_rate" ? "Day Rate" : "Monthly"}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td style={{ ...cellStyle, minWidth: 110 }}>
                    {r.rate_type === "day_rate"
                      ? <MoneyCell value={r.day_rate} onChange={v => update(r.id, { day_rate: v })} symbol={sym} readOnly={readOnly} />
                      : <MoneyCell value={r.monthly_cost} onChange={v => update(r.id, { monthly_cost: v })} symbol={sym} readOnly={readOnly} />
                    }
                    <div style={{ padding: "0 8px 2px", fontFamily: P.mono, fontSize: 9, color: P.textSm }}>
                      {r.rate_type === "day_rate" ? "per day" : "per month"}
                    </div>
                    {hasRate && r.user_id && (
                      <div style={{ padding: "0 6px 4px", display: "flex", alignItems: "center", gap: 4, fontFamily: P.mono, fontSize: 9, color: P.green }}>
                        <Zap style={{ width: 9, height: 9 }} /> from rate card
                      </div>
                    )}
                  </td>
                  <td style={{ ...cellStyle, minWidth: 80, padding: "4px 6px" }}>
                    <input type="number" min={0} step={r.rate_type === "day_rate" ? 1 : 0.5}
                      value={r.rate_type === "day_rate" ? r.planned_days : r.planned_months}
                      onChange={e => { const v = e.target.value === "" ? "" : Number(e.target.value); update(r.id, r.rate_type === "day_rate" ? { planned_days: v } : { planned_months: v }); }}
                      readOnly={readOnly} placeholder="0"
                      style={{ width: "100%", border: "none", background: "transparent", padding: "6px 4px", fontSize: 12, textAlign: "right", fontFamily: P.mono, fontWeight: 500, color: P.text, outline: "none" }}
                    />
                    <div style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm, textAlign: "right", padding: "0 4px 2px" }}>
                      {r.rate_type === "day_rate" ? "days planned" : "months planned"}
                    </div>
                  </td>
                  <td style={{ ...cellStyle, padding: "4px 10px" }}>
                    <div style={{ fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: total > 0 ? P.text : P.textSm, fontVariantNumeric: "tabular-nums" }}>{total > 0 ? fmt(total, sym) : "—"}</div>
                    {total > 0 && <div style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm }}>planned total</div>}
                  </td>
                  <td style={{ ...cellStyle, background: idx % 2 === 0 ? P.violetLt : "#F0EEFA", padding: "4px 10px", minWidth: 100 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Lock style={{ width: 9, height: 9, color: P.violet, flexShrink: 0, opacity: 0.5 }} />
                      <span style={{ fontFamily: P.mono, fontSize: 12, fontWeight: 600, color: hasTimesheet ? P.violet : P.textSm, fontVariantNumeric: "tabular-nums" }}>
                        {hasTimesheet ? approvedDays.toLocaleString() : "—"}
                      </span>
                    </div>
                    <div style={{ fontFamily: P.mono, fontSize: 9, color: P.violet, marginTop: 2, opacity: 0.7 }}>{hasTimesheet ? "approved days" : "no timesheets"}</div>
                    {hasTimesheet && r.rate_type === "day_rate" && Number(r.planned_days) > 0 && (
                      <div style={{ fontFamily: P.mono, fontSize: 9, fontWeight: 600, marginTop: 2, color: approvedDays > Number(r.planned_days) ? P.red : P.green }}>
                        {approvedDays > Number(r.planned_days) ? "▲" : "▼"} {Math.abs(approvedDays - Number(r.planned_days))} vs plan
                      </div>
                    )}
                  </td>
                  <td style={{ ...cellStyle, background: idx % 2 === 0 ? P.violetLt : "#F0EEFA", padding: "4px 10px", minWidth: 110 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Lock style={{ width: 9, height: 9, color: P.violet, flexShrink: 0, opacity: 0.5 }} />
                      <span style={{ fontFamily: P.mono, fontSize: 12, fontWeight: 600, color: actualCost > 0 ? P.violet : P.textSm, fontVariantNumeric: "tabular-nums" }}>
                        {actualCost > 0 ? fmt(actualCost, sym) : "—"}
                      </span>
                    </div>
                    <div style={{ fontFamily: P.mono, fontSize: 9, color: P.violet, marginTop: 2, opacity: 0.7 }}>{hasTimesheet ? "actual spend" : "awaiting timesheets"}</div>
                    {actualCost > 0 && total > 0 && (
                      <div style={{ fontFamily: P.mono, fontSize: 9, fontWeight: 600, marginTop: 2, color: actualCost > total ? P.red : P.green }}>
                        {Math.round((actualCost / total) * 100)}% of planned spend
                      </div>
                    )}
                  </td>
                  <td style={{ ...cellStyle, minWidth: 110, padding: "4px 6px" }}>
                    <input type="month" value={r.start_month ?? ""} onChange={e => update(r.id, { start_month: e.target.value || undefined })} readOnly={readOnly}
                      style={{ width: "100%", border: `1px solid ${P.border}`, background: P.surface, fontSize: 11, fontFamily: P.mono, padding: "5px 6px", color: P.text, outline: "none" }}
                    />
                    <div style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm, marginTop: 2 }}>optional</div>
                  </td>
                  <td style={{ ...cellStyle, minWidth: 160, padding: "4px 6px" }}>
                    <select value={r.cost_line_id ?? ""} onChange={e => update(r.id, { cost_line_id: e.target.value || null })} disabled={readOnly}
                      style={{ width: "100%", border: `1px solid ${P.border}`, background: P.surface, fontSize: 11, fontFamily: P.sans, padding: "5px 6px", color: P.text, outline: "none", cursor: readOnly ? "default" : "pointer" }}>
                      <option value="">— not linked —</option>
                      {costLines.map(l => <option key={l.id} value={l.id}>{l.description || l.category}</option>)}
                    </select>
                    {linkedLine && (
                      <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 4, padding: "0 2px" }}>
                        <Link2 style={{ width: 10, height: 10, color: P.green, flexShrink: 0 }} />
                        <span style={{ fontFamily: P.mono, fontSize: 9, color: P.green, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {linkedLine.override ? "Override active" : "Auto-updating"}
                        </span>
                      </div>
                    )}
                  </td>
                  <td style={{ ...cellStyle, minWidth: 140 }}>
                    <input type="text" value={r.notes} onChange={e => update(r.id, { notes: e.target.value })} readOnly={readOnly}
                      placeholder="Notes…"
                      style={{ width: "100%", border: "none", background: "transparent", padding: "6px 8px", fontSize: 12, color: P.text, fontFamily: P.sans, outline: "none" }}
                    />
                  </td>
                  <td style={{ ...cellStyle, padding: "4px 6px" }}>
                    {!readOnly && (
                      <button onClick={() => onChange(resources.filter(x => x.id !== r.id))} style={{ padding: 4, background: "none", border: "none", cursor: "pointer", color: P.textSm, opacity: 0, transition: "opacity 0.1s" }}
                        onMouseEnter={e => (e.currentTarget.style.color = P.red, e.currentTarget.style.opacity = "1")}
                        onMouseLeave={e => (e.currentTarget.style.color = P.textSm, e.currentTarget.style.opacity = "0")}
                        aria-label="Delete resource"
                      >
                        <Trash2 style={{ width: 13, height: 13 }} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {resources.length > 0 && (
            <tfoot>
              <tr style={{ background: "#F0F0ED", borderTop: `1px solid ${P.borderMd}` }}>
                <td colSpan={5} style={{ padding: "8px 10px", fontFamily: P.mono, fontSize: 9, fontWeight: 700, color: P.textMd, letterSpacing: "0.06em", textTransform: "uppercase" }}>Total</td>
                <td style={{ padding: "8px 10px", fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: P.text }}>{fmt(totalCost, sym)}</td>
                <td style={{ padding: "8px 10px", fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: P.violet, background: P.violetLt }}>
                  {Object.values(approvedDaysByResource).reduce((s, d) => s + d, 0).toLocaleString()} days
                </td>
                <td style={{ padding: "8px 10px", fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: P.violet, background: P.violetLt }}>
                  {fmt(resources.reduce((s, r) => { const days = approvedDaysByResource[r.id] ?? 0; const rate = r.rate_type === "day_rate" ? Number(r.day_rate) || 0 : (Number(r.monthly_cost) || 0) / 20; return s + days * rate; }, 0), sym)}
                </td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          )}
        </table>
        {!readOnly && (
          <div style={{ padding: "8px 16px", background: P.bg, borderTop: `1px solid ${P.border}` }}>
            <button onClick={() => onChange([...resources, emptyResource()])} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", fontFamily: P.sans, fontSize: 12, color: P.navy, cursor: "pointer", fontWeight: 500 }}>
              <Plus style={{ width: 14, height: 14 }} /> Add resource
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type Props = {
  content: FinancialPlanContent;
  onChange: (c: FinancialPlanContent) => void;
  readOnly?: boolean;
  organisationId: string;
  // When provided, auto-save goes directly to the API route — no server action,
  // no RSC router refresh, no sidebar re-fetches on every keystroke.
  projectId?: string;
  artifactId?: string;
  timesheetEntries?: TimesheetEntry[];
  raidItems?: Array<{ type: string; title: string; severity: string; status: string }>;
  approvalDelays?: Array<{ title: string; daysPending: number; cost_impact?: number }>;
};

export default function FinancialPlanEditor({
  content, onChange, readOnly = false, organisationId,
  projectId, artifactId,
  timesheetEntries = [], raidItems, approvalDelays,
}: Props) {
  const [activeTab, setActiveTab] = useState<"budget" | "resources" | "monthly" | "changes" | "narrative">("budget");
  const [signals, setSignals]     = useState<Signal[]>([]);
  const saveTimer                 = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── LOCAL STATE: UI reads from localContent, server save is debounced ──────
  // This prevents the parent's server action from blocking Next.js navigation
  // on every keystroke. localContent updates instantly; onChange fires after 500ms.
  const [localContent, setLocalContent] = useState<FinancialPlanContent>(content);

  // Sync local state when the parent loads a different artifact (identity change)
  const lastContentRef = useRef(content);
  useEffect(() => {
    if (content !== lastContentRef.current) {
      lastContentRef.current = content;
      setLocalContent(content);
    }
  }, [content]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const sym       = CURRENCY_SYMBOLS[localContent.currency] ?? "£";
  const lines     = localContent.cost_lines ?? [];
  const resources = localContent.resources  ?? [];

  const actualsByLine = useMemo(() => computeActuals(resources, timesheetEntries), [resources, timesheetEntries]);
  const actualTotalsPerLine = useMemo(() => computeActualTotalsPerLine(resources, timesheetEntries), [resources, timesheetEntries]);
  const linesWithActuals = useMemo(() => applyActualsToCostLines(lines, actualTotalsPerLine), [lines, actualTotalsPerLine]);

  const totalApprovedDays = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of timesheetEntries) map[e.resource_id] = (map[e.resource_id] ?? 0) + e.approved_days;
    return Object.values(map).reduce((s, d) => s + d, 0);
  }, [timesheetEntries]);

  const resourceTotalsByLine = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of resources) {
      if (!r.cost_line_id) continue;
      const t = resourceTotal(r);
      if (t > 0) map[r.cost_line_id] = (map[r.cost_line_id] ?? 0) + t;
    }
    return map;
  }, [resources]);

  // Stable deps for the signals analyser useEffect
  const contentDeps = useMemo(() => ({
    currency: localContent.currency,
    total_approved_budget: localContent.total_approved_budget,
    summary: localContent.summary,
    cost_lines: localContent.cost_lines,
    change_exposure: localContent.change_exposure,
    resources: localContent.resources,
    variance_narrative: localContent.variance_narrative,
    assumptions: localContent.assumptions,
    last_updated_at: localContent.last_updated_at,
  }), [
    localContent.currency,
    localContent.total_approved_budget,
    localContent.summary,
    localContent.cost_lines,
    localContent.change_exposure,
    localContent.resources,
    localContent.variance_narrative,
    localContent.assumptions,
    localContent.last_updated_at,
  ]);

  // ── THE FIX: instant local update + debounced API-route save ──────────────
  // Using fetch() to /api/artifacts/save-json instead of a server action:
  // Next.js triggers an RSC router refresh after every server action — even
  // updateArtifactJsonSilent — which re-fetches the entire layout tree and
  // swallows click events during the debounce window. A plain fetch() is
  // completely invisible to the router.
  const handleChange = useCallback((patch: FinancialPlanContent) => {
    setLocalContent(patch);
    clearTimeout(saveTimer.current);
    const now = new Date().toISOString();
    const patched = { ...patch, last_updated_at: now };
    saveTimer.current = setTimeout(() => {
      if (projectId && artifactId) {
        fetch("/api/artifacts/save-json", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, artifactId, contentJson: patched }),
        }).catch(() => { /* silent — auto-save errors don't surface to the user */ });
      } else {
        // Fallback for callers that don't pass projectId/artifactId
        onChange(patched);
      }
    }, 500);
  }, [onChange, projectId, artifactId]);

  const updateField = useCallback(<K extends keyof FinancialPlanContent>(key: K, val: FinancialPlanContent[K]) => {
    handleChange({ ...localContent, [key]: val });
  }, [localContent, handleChange]);

  const handleResourcesChange = useCallback((newResources: Resource[]) => {
    const newLines = rollupResourcesToLines(lines, newResources);
    handleChange({ ...localContent, resources: newResources, cost_lines: newLines });
  }, [localContent, lines, handleChange]);

  const updateLine = useCallback((id: string, patch: Partial<CostLine>) => {
    handleChange({ ...localContent, cost_lines: localContent.cost_lines.map(l => l.id === id ? { ...l, ...patch } : l) });
  }, [localContent, handleChange]);

  const toggleLineOverride = useCallback((id: string) => {
    const line = lines.find(l => l.id === id);
    if (!line) return;
    const newOverride = !line.override;
    let newLines = lines.map(l => l.id === id ? { ...l, override: newOverride } : l);
    if (!newOverride) newLines = rollupResourcesToLines(newLines, resources);
    handleChange({ ...localContent, cost_lines: newLines });
  }, [localContent, lines, resources, handleChange]);

  const addLine = useCallback(() => {
    handleChange({ ...localContent, cost_lines: [...localContent.cost_lines, emptyCostLine()] });
  }, [localContent, handleChange]);

  const removeLine = useCallback((id: string) => {
    const newResources = resources.map(r => r.cost_line_id === id ? { ...r, cost_line_id: null } : r);
    handleChange({ ...localContent, cost_lines: localContent.cost_lines.filter(l => l.id !== id), resources: newResources });
  }, [localContent, resources, handleChange]);

  const updateCE = useCallback((id: string, patch: Partial<ChangeExposure>) => {
    handleChange({ ...localContent, change_exposure: localContent.change_exposure.map(c => c.id === id ? { ...c, ...patch } : c) });
  }, [localContent, handleChange]);

  const addCE = useCallback(() => {
    handleChange({ ...localContent, change_exposure: [...localContent.change_exposure, emptyChangeExposure()] });
  }, [localContent, handleChange]);

  const removeCE = useCallback((id: string) => {
    handleChange({ ...localContent, change_exposure: localContent.change_exposure.filter(c => c.id !== id) });
  }, [localContent, handleChange]);

  const totalBudgeted    = sumField(linesWithActuals, "budgeted");
  const totalActual      = sumField(linesWithActuals, "actual");
  const totalForecast    = sumField(linesWithActuals, "forecast");
  const approvedBudget   = Number(localContent.total_approved_budget) || 0;
  const forecastVariance = approvedBudget ? totalForecast - approvedBudget : null;
  const pendingExposure  = localContent.change_exposure.filter(c => c.status === "pending").reduce((s, c) => s + (Number(c.cost_impact) || 0), 0);
  const approvedExposure = localContent.change_exposure.filter(c => c.status === "approved").reduce((s, c) => s + (Number(c.cost_impact) || 0), 0);
  const utilPct          = approvedBudget ? Math.round((totalForecast / approvedBudget) * 100) : null;
  const overBudget       = forecastVariance !== null && forecastVariance > 0;
  const totalResourceCost = resources.reduce((s, r) => s + resourceTotal(r), 0);

  const fyConfig = useMemo<FYConfig>(
    () => localContent.fy_config ?? { fy_start_month: 4, fy_start_year: new Date().getFullYear(), num_months: 12 },
    [localContent.fy_config]
  );

  const monthlyData = useMemo<MonthlyData>(
    () => localContent.monthly_data ?? {},
    [localContent.monthly_data]
  );

  const monthlyDataWithActuals = useMemo(() => applyActualsToMonthlyData(monthlyData, actualsByLine), [monthlyData, actualsByLine]);

  useEffect(() => {
    const sigs = analyseFinancialPlan(contentDeps, monthlyDataWithActuals, fyConfig, { lastUpdatedAt: contentDeps.last_updated_at });
    setSignals(sigs);
  }, [contentDeps, monthlyDataWithActuals, fyConfig]);

  const criticalCount = signals.filter(s => s.severity === "critical").length;
  const warningCount  = signals.filter(s => s.severity === "warning").length;

  const tabs = useMemo(() => [
    { id: "budget"    as const, label: "Cost Breakdown" },
    { id: "resources" as const, label: `Resources${resources.length > 0 ? ` (${resources.length})` : ""}` },
    {
      id: "monthly" as const,
      label: "Monthly Phasing",
      badge: criticalCount > 0 ? { count: criticalCount, color: P.red } : warningCount > 0 ? { count: warningCount, color: P.amber } : undefined,
    },
    { id: "changes"   as const, label: `Change Exposure${localContent.change_exposure.length > 0 ? ` (${localContent.change_exposure.length})` : ""}` },
    { id: "narrative" as const, label: "Narrative & Assumptions" },
  ], [resources.length, localContent.change_exposure.length, criticalCount, warningCount]);

  const inputBase: React.CSSProperties = { border: `1px solid ${P.border}`, background: P.surface, fontFamily: P.sans, fontSize: 13, color: P.text, padding: "6px 10px", outline: "none" };
  const labelStyle: React.CSSProperties = { display: "block", fontFamily: P.mono, fontSize: 8, fontWeight: 600, color: P.textSm, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: P.sans }}>

      {/* ── Currency + budget header ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end" }}>
        <div>
          <label style={labelStyle}>Currency</label>
          <select value={localContent.currency} onChange={e => updateField("currency", e.target.value as Currency)} disabled={readOnly} style={{ ...inputBase, fontFamily: P.mono, fontWeight: 600 }}>
            {CURRENCIES.map(c => <option key={c} value={c}>{c} ({CURRENCY_SYMBOLS[c]})</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Total Approved Budget</label>
          <div style={{ display: "flex", alignItems: "center", gap: 4, border: `1px solid ${P.border}`, background: P.surface, padding: "0 10px" }}>
            <span style={{ fontFamily: P.mono, fontSize: 13, fontWeight: 700, color: P.textSm }}>{sym}</span>
            <input type="number" min={0} step={1000} value={localContent.total_approved_budget}
              onChange={e => updateField("total_approved_budget", e.target.value === "" ? "" : Number(e.target.value))}
              readOnly={readOnly} placeholder="0"
              style={{ width: 144, border: "none", background: "transparent", fontSize: 13, fontWeight: 600, fontFamily: P.mono, color: P.text, outline: "none", padding: "6px 0" }}
            />
          </div>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        {[
          { label: "Budgeted",         value: fmt(totalBudgeted, sym),   sub: "across all cost lines",                                                                             color: P.text,   locked: false },
          { label: "Actual Spent",     value: fmt(totalActual, sym),     sub: totalApprovedDays > 0 ? `${totalApprovedDays.toLocaleString()} approved days` : "awaiting approved timesheets", color: P.violet, locked: true },
          { label: "Total Forecast",   value: fmt(totalForecast, sym),   sub: utilPct !== null ? `${utilPct}% of approved` : "",                                                   color: overBudget ? P.red : P.green, locked: false },
          { label: "Pending Exposure", value: fmt(pendingExposure, sym), sub: "from change requests",                                                                              color: pendingExposure > 0 ? P.amber : P.textSm, locked: false },
        ].map(s => (
          <div key={s.label} style={{ background: s.locked ? P.violetLt : P.surface, border: `1px solid ${s.locked ? "#C0B0E0" : P.border}`, padding: "12px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              {s.locked && <Lock style={{ width: 10, height: 10, color: P.violet }} />}
              <span style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm, letterSpacing: "0.06em", textTransform: "uppercase" }}>{s.label}</span>
            </div>
            <div style={{ fontFamily: P.mono, fontSize: 18, fontWeight: 700, color: s.color, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
            {s.sub && <div style={{ fontFamily: P.mono, fontSize: 9, color: s.locked ? P.violet : P.textSm, marginTop: 3, opacity: s.locked ? 0.7 : 1 }}>{s.sub}</div>}
          </div>
        ))}
      </div>

      {totalResourceCost > 0 && approvedBudget > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", fontSize: 12, border: `1px solid ${totalResourceCost > approvedBudget ? "#F0B0AA" : P.border}`, background: totalResourceCost > approvedBudget ? P.redLt : P.navyLt, color: totalResourceCost > approvedBudget ? P.red : P.navy }}>
          <Users style={{ width: 13, height: 13, flexShrink: 0 }} />
          <span>Resource costs total <strong>{fmt(totalResourceCost, sym)}</strong> ({Math.round((totalResourceCost / approvedBudget) * 100)}% of approved budget).{totalResourceCost > approvedBudget && " ⚠ Exceeds approved budget."}</span>
        </div>
      )}

      {overBudget && forecastVariance !== null && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", fontSize: 12, border: `1px solid #F0B0AA`, background: P.redLt, color: P.red }}>
          <AlertTriangle style={{ width: 13, height: 13, flexShrink: 0 }} />
          <span>Forecast exceeds approved budget by <strong>{fmt(forecastVariance, sym)}</strong>.</span>
        </div>
      )}

      {/* ── Summary ── */}
      <div>
        <label style={labelStyle}>Plan Summary</label>
        <textarea value={localContent.summary} onChange={e => updateField("summary", e.target.value)} readOnly={readOnly} rows={2}
          placeholder="Brief overview of financial position and key spend areas..."
          style={{ ...inputBase, width: "100%", resize: "none", lineHeight: 1.5 }}
        />
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: "flex", gap: 0, borderBottom: `2px solid ${P.border}`, overflowX: "auto" }}>
        {tabs.map(tab => {
          const active = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "8px 16px",
                fontFamily: P.sans, fontSize: 12, fontWeight: active ? 600 : 400, cursor: "pointer",
                background: "none", border: "none", borderBottom: `2px solid ${active ? P.navy : "transparent"}`,
                color: active ? P.navy : P.textMd, marginBottom: -2, whiteSpace: "nowrap",
                transition: "all 0.1s",
              }}
            >
              {tab.id === "monthly"   && <Calendar style={{ width: 12, height: 12 }} />}
              {tab.id === "resources" && <Users style={{ width: 12, height: 12 }} />}
              {tab.label}
              {tab.id === "monthly" && tab.badge && (
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 16, height: 16, background: tab.badge.color, color: "#FFF", fontFamily: P.mono, fontSize: 9, fontWeight: 700 }}>
                  {tab.badge.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Cost Breakdown tab ── */}
      {activeTab === "budget" && (
        <div style={{ border: `1px solid ${P.borderMd}`, overflow: "hidden" }}>
          <div style={{ padding: "6px 12px", background: P.violetLt, borderBottom: `1px solid #C0B0E0`, display: "flex", alignItems: "center", gap: 6, fontFamily: P.mono, fontSize: 9, color: P.violet, fontWeight: 500 }}>
            <Lock style={{ width: 11, height: 11 }} />
            People actuals are locked — auto-computed from approved timesheets × rate card. All other categories (hardware, infrastructure, vendors etc.) can be edited manually.
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#F4F4F2", borderBottom: `1px solid ${P.borderMd}` }}>
                {["Category", "Description", `Budgeted (${sym})`, `Actual (${sym}) ⓘ`, `Forecast (${sym})`, "Variance", "Resources", "Notes", ""].map((h, i) => (
                  <th key={i} style={{ padding: "8px 10px", textAlign: "left", fontFamily: P.mono, fontSize: 8, fontWeight: 600, color: h.startsWith("Actual") ? P.violet : P.textSm, letterSpacing: "0.08em", textTransform: "uppercase", borderBottom: `1px solid ${P.borderMd}`, background: h.startsWith("Actual") ? P.violetLt : "#F4F4F2", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ padding: "32px 16px", textAlign: "center", fontFamily: P.sans, fontSize: 13, color: P.textSm }}>
                    No cost lines yet. Click <strong>Add line</strong> below.
                  </td>
                </tr>
              )}
              {linesWithActuals.map((l, idx) => {
                const resTotal     = resourceTotalsByLine[l.id] ?? 0;
                const hasResources = resTotal > 0;
                const lineApprovedDays = timesheetEntries.filter(e => { const r = resources.find(r => r.id === e.resource_id); return r?.cost_line_id === l.id; }).reduce((s, e) => s + e.approved_days, 0);
                const hasTimesheetData = lineApprovedDays > 0;
                const rowBg = idx % 2 === 0 ? P.surface : "#FAFAF8";
                const cellBase: React.CSSProperties = { borderBottom: `1px solid ${P.border}`, background: rowBg };

                return (
                  <tr key={l.id} style={{ background: rowBg }}>
                    <td style={{ ...cellBase, minWidth: 140, padding: "4px 6px" }}>
                      <select value={l.category} onChange={e => updateLine(l.id, { category: e.target.value as CostCategory })} disabled={readOnly}
                        style={{ width: "100%", border: "none", background: "transparent", fontSize: 11, fontFamily: P.sans, fontWeight: 500, color: P.text, outline: "none", cursor: readOnly ? "default" : "pointer" }}>
                        {(Object.keys(CATEGORY_LABELS) as CostCategory[]).map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                      </select>
                    </td>
                    <td style={{ ...cellBase, minWidth: 160 }}>
                      <input type="text" value={l.description} onChange={e => updateLine(l.id, { description: e.target.value })} readOnly={readOnly}
                        placeholder="Description..."
                        style={{ width: "100%", border: "none", background: "transparent", padding: "6px 8px", fontSize: 12, color: P.text, fontFamily: P.sans, outline: "none" }}
                      />
                    </td>
                    <td style={{ ...cellBase, background: hasResources && !l.override ? "#F2F8FF" : rowBg }}>
                      <MoneyCell value={l.budgeted} onChange={v => updateLine(l.id, { budgeted: v })} symbol={sym} readOnly={readOnly || (hasResources && !l.override)} />
                    </td>
                    <td style={{ ...cellBase, background: l.category === "people" ? P.violetLt : rowBg }}>
                      {l.category === "people" ? (
                        <ActualCell value={l.actual} symbol={sym} approvedDays={lineApprovedDays} hasTimesheetData={hasTimesheetData} />
                      ) : (
                        <MoneyCell value={l.actual} onChange={v => updateLine(l.id, { actual: v })} symbol={sym} readOnly={readOnly} />
                      )}
                    </td>
                    <td style={{ ...cellBase, background: hasResources && !l.override ? "#F2F8FF" : rowBg }}>
                      <MoneyCell value={l.forecast} onChange={v => updateLine(l.id, { forecast: v })} symbol={sym} readOnly={readOnly || (hasResources && !l.override)} />
                    </td>
                    <td style={{ ...cellBase, padding: "4px 10px" }}>
                      <VarianceBadge budget={l.budgeted} forecast={l.forecast} />
                    </td>
                    <td style={{ ...cellBase, padding: "4px 8px", minWidth: 130 }}>
                      {!readOnly && <OverrideToggle line={l} hasLinkedResources={hasResources} resTotal={resTotal} sym={sym} onToggle={() => toggleLineOverride(l.id)} />}
                      {!hasResources && <span style={{ fontFamily: P.mono, fontSize: 9, color: P.border }}>no resources</span>}
                    </td>
                    <td style={{ ...cellBase, minWidth: 160 }}>
                      <input type="text" value={l.notes} onChange={e => updateLine(l.id, { notes: e.target.value })} readOnly={readOnly}
                        placeholder="Notes..."
                        style={{ width: "100%", border: "none", background: "transparent", padding: "6px 8px", fontSize: 12, color: P.textMd, fontFamily: P.sans, outline: "none" }}
                      />
                    </td>
                    <td style={{ ...cellBase, padding: "4px 6px" }}>
                      {!readOnly && (
                        <button onClick={() => removeLine(l.id)} style={{ padding: 4, background: "none", border: "none", cursor: "pointer", color: P.textSm, opacity: 0 }}
                          onMouseEnter={e => (e.currentTarget.style.color = P.red, e.currentTarget.style.opacity = "1")}
                          onMouseLeave={e => (e.currentTarget.style.color = P.textSm, e.currentTarget.style.opacity = "0")}
                          aria-label="Delete cost line"
                        >
                          <Trash2 style={{ width: 13, height: 13 }} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {lines.length > 0 && (
              <tfoot>
                <tr style={{ background: "#F0F0ED", borderTop: `2px solid ${P.borderMd}` }}>
                  <td colSpan={2} style={{ padding: "8px 10px", fontFamily: P.mono, fontSize: 9, fontWeight: 700, color: P.textMd, letterSpacing: "0.06em", textTransform: "uppercase" }}>Total</td>
                  <td style={{ padding: "8px 10px", fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: P.text }}>{fmt(totalBudgeted, sym)}</td>
                  <td style={{ padding: "8px 10px", background: P.violetLt }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: P.violet }}>
                      <Lock style={{ width: 10, height: 10 }} /> {fmt(totalActual, sym)}
                    </span>
                  </td>
                  <td style={{ padding: "8px 10px", fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: P.text }}>{fmt(totalForecast, sym)}</td>
                  <td style={{ padding: "8px 10px" }}><VarianceBadge budget={totalBudgeted} forecast={totalForecast} /></td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
          {!readOnly && (
            <div style={{ padding: "8px 16px", background: P.bg, borderTop: `1px solid ${P.border}` }}>
              <button onClick={addLine} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", fontFamily: P.sans, fontSize: 12, color: P.navy, cursor: "pointer", fontWeight: 500 }}>
                <Plus style={{ width: 14, height: 14 }} /> Add line
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Resources tab ── */}
      {activeTab === "resources" && (
        <ResourcesTab
          resources={resources} costLines={lines} sym={sym} currency={localContent.currency}
          readOnly={readOnly} onChange={handleResourcesChange} organisationId={organisationId}
          monthlyData={monthlyData} fyConfig={fyConfig} timesheetEntries={timesheetEntries}
          actualsByLine={actualsByLine} onSyncMonthly={d => updateField("monthly_data", d)}
        />
      )}

      {/* ── Monthly tab ── */}
      {activeTab === "monthly" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {!readOnly && resources.length > 0 && (
            <ResourceSyncBar resources={resources} costLines={lines} monthlyData={monthlyData} fyConfig={fyConfig} currency={localContent.currency} timesheetEntries={timesheetEntries} onSync={d => updateField("monthly_data", d)} />
          )}
          <FinancialIntelligencePanel
            content={localContent} monthlyData={monthlyDataWithActuals} fyConfig={fyConfig}
            lastUpdatedAt={localContent.last_updated_at} raidItems={raidItems}
            approvalDelays={approvalDelays} onSignalsChange={setSignals}
          />
          <FinancialPlanMonthlyView
            content={localContent} monthlyData={monthlyDataWithActuals}
            onMonthlyDataChange={d => updateField("monthly_data", d)}
            fyConfig={fyConfig} onFyConfigChange={c => updateField("fy_config", c)}
            signals={signals} readOnly={readOnly}
          />
        </div>
      )}

      {/* ── Changes tab ── */}
      {activeTab === "changes" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {[
              { label: "Approved Exposure", value: fmt(approvedExposure, sym),                  color: P.navy  },
              { label: "Pending Exposure",  value: fmt(pendingExposure, sym),                   color: pendingExposure > 0 ? P.amber : P.textSm },
              { label: "Total Exposure",    value: fmt(approvedExposure + pendingExposure, sym), color: P.text  },
            ].map(s => (
              <div key={s.label} style={{ background: P.surface, border: `1px solid ${P.border}`, padding: "12px 16px" }}>
                <div style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontFamily: P.mono, fontSize: 16, fontWeight: 700, color: s.color, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
              </div>
            ))}
          </div>
          <div style={{ border: `1px solid ${P.borderMd}`, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#F4F4F2", borderBottom: `1px solid ${P.borderMd}` }}>
                  {["Change Ref", "Title", `Cost Impact (${sym})`, "Status", "Notes", ""].map((h, i) => (
                    <th key={i} style={{ padding: "8px 10px", textAlign: "left", fontFamily: P.mono, fontSize: 8, fontWeight: 600, color: P.textSm, letterSpacing: "0.08em", textTransform: "uppercase", borderBottom: `1px solid ${P.borderMd}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {localContent.change_exposure.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: "32px 16px", textAlign: "center", fontFamily: P.sans, fontSize: 13, color: P.textSm }}>No change exposure logged yet.</td></tr>
                )}
                {localContent.change_exposure.map((c, idx) => {
                  const rowBg = idx % 2 === 0 ? P.surface : "#FAFAF8";
                  const cellBase: React.CSSProperties = { borderBottom: `1px solid ${P.border}`, background: rowBg };
                  return (
                    <tr key={c.id} style={{ background: rowBg }}>
                      <td style={cellBase}>
                        <input type="text" value={c.change_ref} onChange={e => updateCE(c.id, { change_ref: e.target.value })} readOnly={readOnly}
                          placeholder="CR-001" style={{ width: "100%", border: "none", background: "transparent", padding: "6px 8px", fontSize: 11, fontFamily: P.mono, color: P.textMd, outline: "none" }} />
                      </td>
                      <td style={{ ...cellBase, minWidth: 180 }}>
                        <input type="text" value={c.title} onChange={e => updateCE(c.id, { title: e.target.value })} readOnly={readOnly}
                          placeholder="Change title..." style={{ width: "100%", border: "none", background: "transparent", padding: "6px 8px", fontSize: 12, color: P.text, fontFamily: P.sans, outline: "none" }} />
                      </td>
                      <td style={cellBase}>
                        <MoneyCell value={c.cost_impact} onChange={v => updateCE(c.id, { cost_impact: v })} symbol={sym} readOnly={readOnly} />
                      </td>
                      <td style={{ ...cellBase, padding: "4px 8px" }}>
                        <select value={c.status} onChange={e => updateCE(c.id, { status: e.target.value as ChangeExposure["status"] })} disabled={readOnly}
                          style={{ fontSize: 10, fontFamily: P.mono, fontWeight: 700, padding: "3px 8px", border: "none", cursor: readOnly ? "default" : "pointer", outline: "none", background: c.status === "approved" ? P.greenLt : c.status === "pending" ? P.amberLt : "#F4F4F2", color: c.status === "approved" ? P.green : c.status === "pending" ? P.amber : P.textSm }}>
                          <option value="approved">Approved</option>
                          <option value="pending">Pending</option>
                          <option value="rejected">Rejected</option>
                        </select>
                      </td>
                      <td style={{ ...cellBase, minWidth: 160 }}>
                        <input type="text" value={c.notes} onChange={e => updateCE(c.id, { notes: e.target.value })} readOnly={readOnly}
                          placeholder="Notes..." style={{ width: "100%", border: "none", background: "transparent", padding: "6px 8px", fontSize: 12, color: P.textMd, fontFamily: P.sans, outline: "none" }} />
                      </td>
                      <td style={{ ...cellBase, padding: "4px 6px" }}>
                        {!readOnly && (
                          <button onClick={() => removeCE(c.id)} style={{ padding: 4, background: "none", border: "none", cursor: "pointer", color: P.textSm, opacity: 0 }}
                            onMouseEnter={e => (e.currentTarget.style.color = P.red, e.currentTarget.style.opacity = "1")}
                            onMouseLeave={e => (e.currentTarget.style.color = P.textSm, e.currentTarget.style.opacity = "0")}
                            aria-label="Delete change exposure"
                          >
                            <Trash2 style={{ width: 13, height: 13 }} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!readOnly && (
              <div style={{ padding: "8px 16px", background: P.bg, borderTop: `1px solid ${P.border}` }}>
                <button onClick={addCE} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", fontFamily: P.sans, fontSize: 12, color: P.amber, cursor: "pointer", fontWeight: 500 }}>
                  <Plus style={{ width: 14, height: 14 }} /> Add change exposure
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Narrative tab ── */}
      {activeTab === "narrative" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {[
            { key: "variance_narrative" as const, label: "Variance Narrative",        placeholder: "Explain material variances between budget and forecast..." },
            { key: "assumptions"        as const, label: "Assumptions & Constraints", placeholder: "Key assumptions: rates, headcount, duration, exchange rate basis..." },
          ].map(({ key, label, placeholder }) => (
            <div key={key}>
              <label style={labelStyle}>{label}</label>
              <textarea value={localContent[key]} onChange={e => updateField(key, e.target.value)} readOnly={readOnly} rows={4}
                placeholder={placeholder}
                style={{ ...inputBase, width: "100%", resize: "vertical", lineHeight: 1.6 }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}