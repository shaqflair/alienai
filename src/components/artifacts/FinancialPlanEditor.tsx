"use client";

import { useState, useCallback, useEffect, useMemo, useTransition, useRef } from "react";
import {
  Plus, Trash2, TrendingUp, TrendingDown, AlertTriangle,
  Calendar, Users, Link2, Link2Off, Zap, ChevronRight,
  Check, AlertCircle, Lock, Clock, Receipt,
} from "lucide-react";
import FinancialPlanMonthlyView, { type MonthlyData, type FYConfig } from "./FinancialPlanMonthlyView";
import FinancialIntelligencePanel from "./FinancialIntelligencePanel";
import { analyseFinancialPlan, type Signal } from "@/lib/financial-intelligence";
import ResourcePicker, { type PickedPerson } from "./ResourcePicker";
import { syncResourcesToMonthlyData, previewSync } from "./syncResourcesToMonthlyData";
import {
  computeActuals,
  computeActualTotalsPerLine,
  applyActualsToMonthlyData,
  type TimesheetEntry,
  type ActualsByLine,
} from "./computeActuals";
import ResourcePlanSyncBar from "./ResourcePlanSyncBar";
import HeatmapResourcesPanel from "./HeatmapResourcesPanel";
import BillingCockpit, { type Invoice } from "./BillingCockpit";

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
  violet:   "#0e7490",
  violetLt: "#ecfeff",
  blue:     "#1B3652",
  blueLt:   "#EBF0F5",
  mono:     "'DM Mono', 'Courier New', monospace",
  sans:     "'DM Sans', system-ui, sans-serif",
} as const;

export const CURRENCIES = ["GBP", "USD", "EUR", "AUD", "CAD"] as const;
export type Currency = typeof CURRENCIES[number];
export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  GBP: "\u00a3", USD: "$", EUR: "\u20ac", AUD: "A$", CAD: "C$",
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
  budgeted:  number | "";
  actual:    number | "";
  forecast:  number | "";
  notes: string;
  override?: boolean;
  unit_cost:    number | "";
  unit_charge:  number | "";
  quantity:     number | "";
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
  resource_plan_synced_at?: string;
  resource_plan_overridden_months?: string;
  // BILLING: invoice history stored on the plan content
  invoices?: Invoice[];
};

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
    fy_config: { fy_start_month: 4, fy_start_year: now.getFullYear(), num_months: 12 },
    last_updated_at: now.toISOString(),
    invoices: [],
  };
}

function emptyCostLine(): CostLine {
  return { id: uid(), category: "people", description: "", budgeted: "", actual: "", forecast: "", notes: "", override: false, unit_cost: "", unit_charge: "", quantity: "" };
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
  if (n === "" || n == null || isNaN(Number(n))) return "\u2014";
  return `${sym}${Number(n).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

function fmtShort(n: number, sym: string): string {
  if (!n) return "\u2014";
  if (Math.abs(n) >= 1_000_000) return `${sym}${(Math.abs(n) / 1_000_000).toFixed(1)}M`;
  return `${sym}${Math.abs(n).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

function sumField(lines: CostLine[], field: keyof CostLine): number {
  return lines.reduce((s, l) => s + (Number(l[field]) || 0), 0);
}

function VarianceBadge({ budget, forecast }: { budget: number | ""; forecast: number | "" }) {
  if (!budget || forecast === "") return <span style={{ color: P.border, fontSize: 11 }}>\u2014</span>;
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
        style={{ width: 96, border: "none", background: "transparent", padding: "6px 0", fontSize: 12, textAlign: "right", fontWeight: 500, color: P.text, fontFamily: P.mono, outline: "none", opacity: readOnly ? 0.6 : 1, cursor: readOnly ? "default" : "text" }}
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
    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "6px 8px", margin: "0 4px", background: hasValue ? P.violetLt : "#F4F4F2", border: `1px solid ${hasValue ? "#a5f3fc" : P.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {hasValue
          ? <Lock style={{ width: 10, height: 10, color: P.violet, flexShrink: 0 }} />
          : <Clock style={{ width: 10, height: 10, color: P.textSm, flexShrink: 0, opacity: 0.4 }} />
        }
        <span style={{ fontSize: 12, fontWeight: 600, fontFamily: P.mono, color: hasValue ? P.violet : P.textSm, fontVariantNumeric: "tabular-nums" }}>
          {hasValue ? fmt(value, symbol) : "\u2014"}
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
    <button type="button" onClick={onToggle}
      style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", fontFamily: P.mono, fontSize: 9, fontWeight: 700, letterSpacing: "0.04em", cursor: "pointer", background: line.override ? P.amberLt : P.greenLt, border: `1px solid ${line.override ? "#E0C080" : "#A0D0B8"}`, color: line.override ? P.amber : P.green }}
      title={line.override ? "Re-enable auto-update from resources" : "Override -- stop auto-update"}>
      {line.override ? <Link2Off style={{ width: 9, height: 9 }} /> : <Link2 style={{ width: 9, height: 9 }} />}
      {line.override ? "Override" : `Auto ${fmt(resTotal, sym)}`}
    </button>
  );
}

function ResourceSyncBar({ resources, costLines, monthlyData, fyConfig, currency, timesheetEntries, onSync }: {
  resources: Resource[]; costLines: CostLine[]; monthlyData: MonthlyData;
  fyConfig: FYConfig; currency: string; timesheetEntries: TimesheetEntry[];
  onSync: (d: MonthlyData) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [synced, setSynced] = useState(false);
  const sym = CURRENCY_SYMBOLS[currency as Currency] ?? "\u00a3";
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

  const barBg     = synced ? P.greenLt : hasChanges ? P.navyLt : P.bg;
  const barBorder = synced ? "#A0D0B8" : hasChanges ? "#A0BAD0" : P.border;

  return (
    <div style={{ border: `1px solid ${barBorder}`, background: barBg, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Zap style={{ width: 14, height: 14, flexShrink: 0, color: synced ? P.green : hasChanges ? P.navy : P.textSm }} />
          <div>
            <div style={{ fontFamily: P.mono, fontSize: 10, fontWeight: 700, color: synced ? P.green : hasChanges ? P.navy : P.textMd, letterSpacing: "0.04em" }}>
              {synced ? "Monthly phasing synced -- actuals from approved timesheets"
                : hasChanges ? `${readyResources.length} resource${readyResources.length !== 1 ? "s" : ""} ready to sync to monthly phasing`
                : "Monthly phasing is up to date with resources"}
            </div>
            <div style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm, marginTop: 2 }}>
              {readyResources.length} ready &middot; {unreadyResources.length} missing rate or qty &middot; {resources.filter(r => !r.cost_line_id).length} unlinked
              {timesheetEntries.length > 0 && (
                <span style={{ marginLeft: 8, color: P.violet, fontWeight: 600 }}>
                  &middot; {timesheetEntries.length} approved timesheet entr{timesheetEntries.length !== 1 ? "ies" : "y"}
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {hasChanges && !synced && (
            <>
              <button type="button" onClick={() => setExpanded(v => !v)} style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: P.mono, fontSize: 10, color: P.navy, cursor: "pointer", background: "none", border: "none", fontWeight: 500 }}>
                Preview
                <ChevronRight style={{ width: 12, height: 12, transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }} />
              </button>
              <button type="button" onClick={handleSync} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", background: P.navy, color: "#FFF", fontFamily: P.mono, fontSize: 10, fontWeight: 700, border: "none", cursor: "pointer", letterSpacing: "0.04em" }}>
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
                  <span style={{ color: P.border }}>{"\u2192"}</span>
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
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 16px", background: P.violetLt, borderTop: `1px solid #a5f3fc` }}>
              <Lock style={{ width: 13, height: 13, color: P.violet, flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontFamily: P.mono, fontSize: 9, color: P.violet }}>
                <strong>Actuals</strong> will be auto-computed from{" "}
                <strong>{timesheetEntries.length} approved timesheet entr{timesheetEntries.length !== 1 ? "ies" : "y"}</strong>{" "}
                (approved days x rate card rate). The Actual column is locked.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   ResourcesTab
───────────────────────────────────────────────────────────────────── */

type HeatmapPerson = {
  person_id: string; name: string; job_title: string; role_title: string;
  cost_day_rate: number | null; charge_day_rate: number | null;
  rate_source: "personal" | "role" | null;
  week_count: number; total_days: number;
  planned_cost: number | null; planned_charge: number | null;
};

function useHeatmapPeople(projectId: string, artifactId?: string, onLoad?: (count: number) => void) {
  const [people,  setPeople]  = useState<HeatmapPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId || !artifactId) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`/api/artifacts/financial-plan/resource-plan-sync?projectId=${encodeURIComponent(projectId)}&artifactId=${encodeURIComponent(artifactId)}`, { cache: "no-store" });
      const text = await res.text();
      let json: any;
      try { json = JSON.parse(text); } catch { throw new Error(`Route not found or compile error (${res.status})`); }
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      const loadedPeople = json.people ?? [];
      setPeople(loadedPeople);
      onLoad?.(loadedPeople.length);
    } catch (e: any) {
      setError(e.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [projectId, artifactId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);
  return { people, loading, error, reload: load };
}

function ResourcesTab({
  resources, costLines, sym, currency, readOnly, onChange, organisationId,
  monthlyData, fyConfig, timesheetEntries, actualsByLine, onSyncMonthly,
  projectId, artifactId, onPeopleLoaded,
}: {
  resources: Resource[]; costLines: CostLine[]; sym: string; currency: Currency;
  readOnly: boolean; onChange: (r: Resource[]) => void; organisationId: string;
  monthlyData: MonthlyData; fyConfig: FYConfig; timesheetEntries: TimesheetEntry[];
  actualsByLine: ActualsByLine; onSyncMonthly: (d: MonthlyData) => void;
  projectId: string; artifactId?: string; onPeopleLoaded?: (count: number) => void;
}) {
  const { people, loading, error, reload } = useHeatmapPeople(projectId, artifactId, onPeopleLoaded);
  const [showExceptions, setShowExceptions] = useState(false);

  const update = useCallback((id: string, patch: Partial<Resource>) =>
    onChange(resources.map(r => r.id === id ? { ...r, ...patch } : r)),
  [onChange, resources]);

  const approvedDaysByResource = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of timesheetEntries) map[e.resource_id] = (map[e.resource_id] ?? 0) + e.approved_days;
    return map;
  }, [timesheetEntries]);

  const manualByPersonId = useMemo(() => {
    const map = new Map<string, Resource>();
    for (const r of resources) { if (r.user_id) map.set(r.user_id, r); }
    return map;
  }, [resources]);

  const heatmapPersonIds = new Set(people.map(p => p.person_id));
  const exceptions = resources.filter(r => !r.user_id || !heatmapPersonIds.has(r.user_id));

  const heatmapTotalDays    = people.reduce((s, p) => s + p.total_days, 0);
  const heatmapTotalCost    = people.reduce((s, p) => s + (p.planned_cost ?? 0), 0);
  const heatmapApprovedDays = people.reduce((s, p) => { const r = manualByPersonId.get(p.person_id); return s + (r ? (approvedDaysByResource[r.id] ?? 0) : 0); }, 0);
  const missingRate         = people.filter(p => p.cost_day_rate == null && p.charge_day_rate == null);

  const thStyle: React.CSSProperties = { padding: "8px 10px", textAlign: "left", fontFamily: P.mono, fontSize: 8, fontWeight: 600, color: P.textSm, letterSpacing: "0.08em", textTransform: "uppercase", borderBottom: `1px solid ${P.borderMd}`, whiteSpace: "nowrap", background: "#F4F4F2" };
  const thViolet: React.CSSProperties = { ...thStyle, color: P.violet, background: P.violetLt };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: P.sans }}>
      {missingRate.length > 0 && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 12px", background: P.amberLt, border: `1px solid #E0C080`, fontSize: 11, color: P.amber }}>
          <AlertCircle style={{ width: 12, height: 12, flexShrink: 0, marginTop: 1 }} />
          <span><strong>{missingRate.map(p => p.name).join(", ")}</strong>{missingRate.length === 1 ? " has" : " have"} no rate card entry. Add their job title to the rate card to include them in the cost forecast.</span>
        </div>
      )}

      <div style={{ border: `1px solid ${P.borderMd}`, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 900 }}>
          <thead>
            <tr style={{ background: "#F4F4F2", borderBottom: `1px solid ${P.borderMd}` }}>
              <th style={{ ...thStyle, minWidth: 200 }}>Person / Role</th>
              <th style={{ ...thStyle, minWidth: 100 }}>Job Title</th>
              <th style={thStyle}>Cost / Day</th>
              <th style={thStyle}>Charge / Day</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Planned Days</th>
              <th style={{ ...thViolet, textAlign: "right" }}>Approved Days</th>
              <th style={{ ...thViolet, textAlign: "right" }}>Variance</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Cost</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Charge-out</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Margin</th>
              <th style={{ ...thViolet, textAlign: "right" }}>Actual Cost</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Weeks</th>
              <th style={{ ...thStyle, minWidth: 120 }}>Links to</th>
              {!readOnly && <th style={{ ...thStyle, width: 32 }} />}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={11} style={{ padding: "24px 16px", textAlign: "center", fontFamily: P.mono, fontSize: 11, color: P.textSm }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <div style={{ width: 12, height: 12, border: `2px solid ${P.border}`, borderTopColor: P.navy, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                  Loading from heatmap…<style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                </div>
              </td></tr>
            )}
            {!loading && error && (
              <tr><td colSpan={11} style={{ padding: "16px", background: P.redLt }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: P.mono, fontSize: 11, color: P.red }}>
                  <AlertCircle style={{ width: 12, height: 12 }} />{error}
                  <button type="button" onClick={reload} style={{ marginLeft: 8, background: "none", border: "none", cursor: "pointer", color: P.red, fontFamily: P.mono, fontSize: 10, textDecoration: "underline" }}>Retry</button>
                </div>
              </td></tr>
            )}
            {!loading && !error && people.length === 0 && (
              <tr><td colSpan={11} style={{ padding: "32px 16px", textAlign: "center", fontFamily: P.sans, fontSize: 13, color: P.textSm }}>No allocations found on the capacity heatmap for this project.</td></tr>
            )}

            {!loading && !error && people.map((person, idx) => {
              const manualResource = manualByPersonId.get(person.person_id);
              const approvedDays   = manualResource ? (approvedDaysByResource[manualResource.id] ?? 0) : 0;
              const variance       = approvedDays > 0 ? approvedDays - person.total_days : null;
              const margin         = person.planned_cost != null && person.planned_charge != null ? person.planned_charge - person.planned_cost : null;
              const marginPct      = person.planned_charge != null && person.planned_charge > 0 && margin != null ? Math.round((margin / person.planned_charge) * 100) : null;
              const actualCost     = person.cost_day_rate != null && approvedDays > 0 ? Math.round(approvedDays * person.cost_day_rate) : null;
              const hasTimesheet   = approvedDays > 0;
              const rowBg          = idx % 2 === 0 ? P.surface : "#FAFAF8";
              const linkedLine     = manualResource ? costLines.find(l => l.id === manualResource.cost_line_id) : null;
              const initials       = person.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();

              return (
                <tr key={person.person_id} style={{ background: rowBg, borderBottom: `1px solid ${P.border}` }}>
                  <td style={{ padding: "10px 10px", background: rowBg }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: P.navy, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, flexShrink: 0, fontFamily: P.mono }}>{initials}</div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: P.text }}>{person.name}</div>
                        <div style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm, marginTop: 1 }}>From heatmap</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: "10px 10px", background: rowBg }}>
                    <div style={{ fontSize: 11, color: P.textMd }}>{person.job_title || person.role_title || "—"}</div>
                    {person.rate_source && <div style={{ fontFamily: P.mono, fontSize: 8, color: P.green, marginTop: 2 }}>{person.rate_source === "personal" ? "personal rate" : "role rate"}</div>}
                  </td>
                  <td style={{ padding: "10px 10px", background: rowBg }}>
                    {person.cost_day_rate != null ? (<><div style={{ fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: P.navy }}>{sym}{person.cost_day_rate.toLocaleString()}</div><div style={{ fontFamily: P.mono, fontSize: 8, color: P.textSm }}>internal cost</div></>) : <span style={{ fontFamily: P.mono, fontSize: 9, fontWeight: 700, color: P.amber }}>No rate</span>}
                  </td>
                  <td style={{ padding: "10px 10px", background: rowBg }}>
                    {person.charge_day_rate != null ? (<><div style={{ fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: "#059669" }}>{sym}{person.charge_day_rate.toLocaleString()}</div><div style={{ fontFamily: P.mono, fontSize: 8, color: P.textSm }}>charge-out</div></>) : <span style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm }}>—</span>}
                  </td>
                  <td style={{ padding: "10px 10px", textAlign: "right", background: rowBg }}>
                    <div style={{ fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: P.text }}>{person.total_days.toFixed(1)}</div>
                    <div style={{ fontFamily: P.mono, fontSize: 8, color: P.textSm }}>days</div>
                  </td>
                  <td style={{ padding: "10px 10px", textAlign: "right", background: idx % 2 === 0 ? P.violetLt : "#e0f7fa" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                      <Lock style={{ width: 8, height: 8, color: P.violet, opacity: 0.5 }} />
                      <span style={{ fontFamily: P.mono, fontSize: 12, fontWeight: 600, color: hasTimesheet ? P.violet : P.textSm }}>{hasTimesheet ? approvedDays.toFixed(1) : "—"}</span>
                    </div>
                    <div style={{ fontFamily: P.mono, fontSize: 8, color: P.violet, opacity: 0.7, textAlign: "right" }}>{hasTimesheet ? "approved" : "no timesheets"}</div>
                  </td>
                  <td style={{ padding: "10px 10px", textAlign: "right", background: idx % 2 === 0 ? P.violetLt : "#e0f7fa" }}>
                    {variance !== null ? (<><div style={{ fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: variance > 0 ? P.red : variance < 0 ? P.green : P.textSm }}>{variance > 0 ? "+" : ""}{variance.toFixed(1)}</div><div style={{ fontFamily: P.mono, fontSize: 8, color: P.textSm }}>{variance > 0 ? "over plan" : variance < 0 ? "under plan" : "on plan"}</div></>) : <span style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm }}>—</span>}
                  </td>
                  <td style={{ padding: "10px 10px", textAlign: "right", background: rowBg }}>
                    {person.planned_cost != null ? (<><div style={{ fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: P.navy }}>{sym}{person.planned_cost.toLocaleString()}</div><div style={{ fontFamily: P.mono, fontSize: 8, color: P.textSm }}>cost</div></>) : <span style={{ fontFamily: P.mono, fontSize: 9, color: P.amber }}>—</span>}
                  </td>
                  <td style={{ padding: "10px 10px", textAlign: "right", background: rowBg }}>
                    {person.planned_charge != null ? (<><div style={{ fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: "#059669" }}>{sym}{person.planned_charge.toLocaleString()}</div><div style={{ fontFamily: P.mono, fontSize: 8, color: P.textSm }}>charge</div></>) : <span style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm }}>—</span>}
                  </td>
                  <td style={{ padding: "10px 10px", textAlign: "right", background: rowBg }}>
                    {margin != null ? (<><div style={{ fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: margin >= 0 ? "#059669" : P.red }}>{sym}{Math.abs(margin).toLocaleString()}</div>{marginPct != null && <div style={{ fontFamily: P.mono, fontSize: 8, color: margin >= 0 ? "#059669" : P.red }}>{marginPct}% margin</div>}</>) : <span style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm }}>—</span>}
                  </td>
                  <td style={{ padding: "10px 10px", textAlign: "right", background: idx % 2 === 0 ? P.violetLt : "#e0f7fa" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                      <Lock style={{ width: 8, height: 8, color: P.violet, opacity: 0.5 }} />
                      <span style={{ fontFamily: P.mono, fontSize: 12, fontWeight: 600, color: actualCost != null ? P.violet : P.textSm }}>{actualCost != null ? `${sym}${actualCost.toLocaleString()}` : "—"}</span>
                    </div>
                    <div style={{ fontFamily: P.mono, fontSize: 8, color: P.violet, opacity: 0.7, textAlign: "right" }}>{hasTimesheet ? "actual" : "awaiting"}</div>
                  </td>
                  <td style={{ padding: "10px 10px", textAlign: "right", background: rowBg }}>
                    <div style={{ fontFamily: P.mono, fontSize: 12, fontWeight: 600, color: P.text }}>{person.week_count}</div>
                    <div style={{ fontFamily: P.mono, fontSize: 8, color: P.textSm }}>weeks</div>
                  </td>
                  <td style={{ padding: "6px 8px", background: rowBg, minWidth: 120 }}>
                    {manualResource ? (
                      <>
                        <select value={manualResource.cost_line_id ?? ""} onChange={e => update(manualResource.id, { cost_line_id: e.target.value || null })} disabled={readOnly}
                          style={{ width: "100%", border: `1px solid ${P.border}`, background: P.surface, fontSize: 10, fontFamily: P.sans, padding: "4px 6px", color: P.text, outline: "none", cursor: readOnly ? "default" : "pointer" }}>
                          <option value="">-- not linked --</option>
                          {costLines.map(l => <option key={l.id} value={l.id}>{l.description || l.category}</option>)}
                        </select>
                        {linkedLine && <div style={{ fontFamily: P.mono, fontSize: 8, color: P.green, marginTop: 2 }}>{linkedLine.override ? "Override" : "Auto-updating"}</div>}
                      </>
                    ) : <span style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm }}>—</span>}
                  </td>
                  {!readOnly && (
                    <td style={{ padding: "6px 6px", textAlign: "center", background: rowBg, width: 32 }}>
                      <button type="button" onClick={reload} title="Refresh from heatmap"
                        style={{ padding: 4, background: "none", border: "none", cursor: "pointer", color: P.textSm, opacity: 0.4 }}
                        onMouseEnter={e => { e.currentTarget.style.opacity = "1"; }} onMouseLeave={e => { e.currentTarget.style.opacity = "0.4"; }}>
                        <Zap style={{ width: 12, height: 12 }} />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}

            {showExceptions && exceptions.map((r, idx) => {
              const approvedDays = approvedDaysByResource[r.id] ?? 0;
              const plannedDays  = Number(r.planned_days) || 0;
              const variance     = approvedDays > 0 ? approvedDays - plannedDays : null;
              const dayRate      = r.rate_type === "day_rate" ? Number(r.day_rate) || 0 : (Number(r.monthly_cost) || 0) / 20;
              const plannedCost  = dayRate > 0 && plannedDays > 0 ? Math.round(plannedDays * dayRate) : null;
              const actualCost   = dayRate > 0 && approvedDays > 0 ? Math.round(approvedDays * dayRate) : null;
              const hasTimesheet = approvedDays > 0;
              const baseIdx      = people.length + idx;
              const rowBg        = baseIdx % 2 === 0 ? "#FFFDF5" : "#FFF9EC";

              return (
                <tr key={r.id} style={{ background: rowBg, borderBottom: `1px solid ${P.border}` }}>
                  <td style={{ padding: "8px 10px", background: rowBg }}>
                    <ResourcePicker organisationId={organisationId} value={r.user_id ?? null} currentResource={r} disabled={readOnly}
                      onPick={async (person: PickedPerson) => {
                        let patch: Partial<Resource> = { user_id: person.user_id || undefined, name: person.full_name ?? person.name ?? person.email ?? r.name, ...(person.rate_type != null ? { rate_type: person.rate_type, day_rate: person.rate_type === "day_rate" ? (person.rate ?? "") : r.day_rate, monthly_cost: person.rate_type === "monthly_cost" ? (person.rate ?? "") : r.monthly_cost, type: (person.resource_type ?? r.type) as ResourceType } : {}) };
                        if (person.user_id && organisationId) {
                          try {
                            const res = await fetch(`/api/org/rate-card?orgId=${encodeURIComponent(organisationId)}&userId=${encodeURIComponent(person.user_id)}`, { cache: "no-store" });
                            const d = await res.json().catch(() => ({ ok: false, match: null }));
                            if (d.ok && d.match) patch = { ...patch, rate_type: d.match.rate_type, day_rate: d.match.rate_type === "day_rate" ? d.match.rate : r.day_rate, monthly_cost: d.match.rate_type === "monthly_cost" ? d.match.rate : r.monthly_cost, type: d.match.resource_type as ResourceType };
                          } catch {}
                        }
                        update(r.id, patch);
                      }} />
                    <input type="text" value={r.name} onChange={e => update(r.id, { name: e.target.value })} readOnly={readOnly} placeholder="Label..." style={{ width: "100%", border: "none", background: "transparent", padding: "2px 6px", fontSize: 10, color: P.textMd, fontFamily: P.sans, outline: "none" }} />
                    <div style={{ fontFamily: P.mono, fontSize: 8, color: P.amber, padding: "0 6px 2px" }}>Exception</div>
                  </td>
                  <td style={{ padding: "8px 10px", background: rowBg }}>
                    <div style={{ display: "flex", background: "#EDEDEB", padding: 2, gap: 2, marginBottom: 4 }}>
                      {(["day_rate", "monthly_cost"] as ResourceRateType[]).map(rt => (
                        <button type="button" key={rt} onClick={() => !readOnly && update(r.id, { rate_type: rt })}
                          style={{ padding: "2px 6px", fontSize: 8, fontFamily: P.mono, fontWeight: 700, cursor: readOnly ? "default" : "pointer", background: r.rate_type === rt ? P.surface : "transparent", color: r.rate_type === rt ? P.text : P.textSm, border: r.rate_type === rt ? `1px solid ${P.border}` : "1px solid transparent" }}>
                          {rt === "day_rate" ? "Day" : "Mo"}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td style={{ padding: "8px 10px", background: rowBg }}>
                    <MoneyCell value={r.rate_type === "day_rate" ? r.day_rate : r.monthly_cost} onChange={v => update(r.id, r.rate_type === "day_rate" ? { day_rate: v } : { monthly_cost: v })} symbol={sym} readOnly={readOnly} />
                  </td>
                  <td style={{ padding: "8px 10px", background: rowBg }}>
                    <input type="number" min={0} step={1} value={r.rate_type === "day_rate" ? r.planned_days : r.planned_months}
                      onChange={e => { const v = e.target.value === "" ? "" : Number(e.target.value); update(r.id, r.rate_type === "day_rate" ? { planned_days: v } : { planned_months: v }); }}
                      readOnly={readOnly} placeholder="0" style={{ width: 60, border: "none", background: "transparent", padding: "4px", fontSize: 12, textAlign: "right", fontFamily: P.mono, fontWeight: 500, color: P.text, outline: "none" }} />
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "right", background: baseIdx % 2 === 0 ? P.violetLt : "#e0f7fa" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                      <Lock style={{ width: 8, height: 8, color: P.violet, opacity: 0.5 }} />
                      <span style={{ fontFamily: P.mono, fontSize: 12, fontWeight: 600, color: hasTimesheet ? P.violet : P.textSm }}>{hasTimesheet ? approvedDays.toFixed(1) : "—"}</span>
                    </div>
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "right", background: baseIdx % 2 === 0 ? P.violetLt : "#e0f7fa" }}>
                    {variance !== null ? <span style={{ fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: variance > 0 ? P.red : P.green }}>{variance > 0 ? "+" : ""}{variance.toFixed(1)}</span> : <span style={{ color: P.textSm }}>—</span>}
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "right", background: rowBg }}>
                    <span style={{ fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: P.navy }}>{plannedCost != null ? `${sym}${plannedCost.toLocaleString()}` : "—"}</span>
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "right", background: baseIdx % 2 === 0 ? P.violetLt : "#e0f7fa" }}>
                    <span style={{ fontFamily: P.mono, fontSize: 12, fontWeight: 600, color: actualCost != null ? P.violet : P.textSm }}>{actualCost != null ? `${sym}${actualCost.toLocaleString()}` : "—"}</span>
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "right", background: rowBg }}><span style={{ fontFamily: P.mono, fontSize: 10, color: P.textSm }}>manual</span></td>
                  <td style={{ padding: "6px 8px", background: rowBg }}>
                    <select value={r.cost_line_id ?? ""} onChange={e => update(r.id, { cost_line_id: e.target.value || null })} disabled={readOnly}
                      style={{ width: "100%", border: `1px solid ${P.border}`, background: P.surface, fontSize: 10, fontFamily: P.sans, padding: "4px 6px", color: P.text, outline: "none" }}>
                      <option value="">-- not linked --</option>
                      {costLines.map(l => <option key={l.id} value={l.id}>{l.description || l.category}</option>)}
                    </select>
                  </td>
                  {!readOnly && (
                    <td style={{ padding: "6px 6px", textAlign: "center", background: rowBg }}>
                      <button type="button" onClick={() => onChange(resources.filter(x => x.id !== r.id))}
                        style={{ padding: 4, background: "none", border: "none", cursor: "pointer", color: P.textSm, opacity: 0.35 }}
                        onMouseEnter={e => { e.currentTarget.style.color = P.red; e.currentTarget.style.opacity = "1"; }}
                        onMouseLeave={e => { e.currentTarget.style.color = P.textSm; e.currentTarget.style.opacity = "0.35"; }}>
                        <Trash2 style={{ width: 13, height: 13 }} />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>

          {!loading && !error && people.length > 0 && (
            <tfoot>
              <tr style={{ background: "#F0F0ED", borderTop: `1px solid ${P.borderMd}` }}>
                <td colSpan={2} style={{ padding: "8px 10px", fontFamily: P.mono, fontSize: 9, fontWeight: 700, color: P.textMd, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  Total · {people.length} from heatmap{exceptions.length > 0 ? ` + ${exceptions.length} exception${exceptions.length !== 1 ? "s" : ""}` : ""}
                </td>
                <td style={{ padding: "8px 10px" }} /><td style={{ padding: "8px 10px" }} />
                <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: P.text }}>{heatmapTotalDays.toFixed(1)}</td>
                <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: P.violet, background: P.violetLt }}>{heatmapApprovedDays > 0 ? heatmapApprovedDays.toFixed(1) : "—"}</td>
                <td style={{ padding: "8px 10px", background: P.violetLt }} />
                <td style={{ padding: "8px 10px", textAlign: "right" }}>
                  {heatmapTotalCost > 0 && <><div style={{ fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: P.navy }}>{sym}{heatmapTotalCost.toLocaleString("en-GB", { maximumFractionDigits: 0 })}</div><div style={{ fontFamily: P.mono, fontSize: 8, color: P.textSm }}>cost</div></>}
                </td>
                <td style={{ padding: "8px 10px", textAlign: "right" }}>
                  {(() => { const tc = people.reduce((s, p) => s + (p.planned_charge ?? 0), 0); return tc > 0 ? <><div style={{ fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: "#059669" }}>{sym}{tc.toLocaleString("en-GB", { maximumFractionDigits: 0 })}</div><div style={{ fontFamily: P.mono, fontSize: 8, color: P.textSm }}>charge</div></> : <span style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm }}>—</span>; })()}
                </td>
                <td style={{ padding: "8px 10px", textAlign: "right" }}>
                  {(() => { const tc = people.reduce((s, p) => s + (p.planned_charge ?? 0), 0); const m = tc - heatmapTotalCost; const pct = tc > 0 ? Math.round((m / tc) * 100) : null; return tc > 0 && heatmapTotalCost > 0 ? <><div style={{ fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: m >= 0 ? "#059669" : P.red }}>{sym}{Math.abs(m).toLocaleString("en-GB", { maximumFractionDigits: 0 })}</div>{pct != null && <div style={{ fontFamily: P.mono, fontSize: 8, color: m >= 0 ? "#059669" : P.red }}>{pct}% margin</div>}</> : <span style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm }}>—</span>; })()}
                </td>
                <td style={{ padding: "8px 10px", background: P.violetLt }} />
                <td colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>

        {!readOnly && (
          <div style={{ padding: "8px 16px", background: P.bg, borderTop: `1px solid ${P.border}`, display: "flex", alignItems: "center", gap: 12 }}>
            <button type="button" onClick={() => { setShowExceptions(true); onChange([...resources, emptyResource()]); }}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: `1px dashed ${P.amber}`, padding: "5px 12px", fontFamily: P.sans, fontSize: 11, color: P.amber, cursor: "pointer", fontWeight: 600 }}>
              <Plus style={{ width: 13, height: 13 }} /> Add exception
            </button>
            {exceptions.length > 0 && !showExceptions && <button type="button" onClick={() => setShowExceptions(true)} style={{ fontFamily: P.mono, fontSize: 9, color: P.amber, background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>Show {exceptions.length} exception{exceptions.length !== 1 ? "s" : ""}</button>}
            {showExceptions && exceptions.length > 0 && <button type="button" onClick={() => setShowExceptions(false)} style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm, background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>Hide exceptions</button>}
            <span style={{ marginLeft: "auto", fontFamily: P.mono, fontSize: 9, color: P.textSm }}>Exceptions: manual costs not in the heatmap (contractors, one-off purchases)</span>
            <button type="button" onClick={reload} title="Refresh from heatmap" style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: P.mono, fontSize: 9, color: P.navy, background: "none", border: "none", cursor: "pointer", opacity: 0.6 }}>
              <Zap style={{ width: 10, height: 10 }} /> Refresh heatmap
            </button>
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, border: `1px solid #a5f3fc`, background: P.violetLt, padding: "8px 12px", fontSize: 11, color: P.violet }}>
        <Lock style={{ width: 12, height: 12, flexShrink: 0, marginTop: 1 }} />
        <span><strong>Approved days &amp; actual cost are locked</strong> — computed from approved timesheets × rate card. Planned days and allocation come from the capacity heatmap.</span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Main Editor
───────────────────────────────────────────────────────────────────── */

type Props = {
  content: FinancialPlanContent;
  onChange: (c: FinancialPlanContent) => void;
  readOnly?: boolean;
  budgetLocked?: boolean;
  organisationId: string;
  artifactId?: string;
  projectId: string;
  isAdmin?: boolean;
  onRequestReload?: () => void;
  timesheetEntries?: TimesheetEntry[];
  raidItems?: Array<{ type: string; title: string; severity: string; status: string }>;
  approvalDelays?: Array<{ title: string; daysPending: number; cost_impact?: number }>;
};

export default function FinancialPlanEditor({
  content, onChange, readOnly = false, budgetLocked = false,
  organisationId, artifactId, projectId, isAdmin = false,
  onRequestReload, timesheetEntries = [], raidItems, approvalDelays,
}: Props) {
  const [activeTab, setActiveTab] = useState<"budget" | "resources" | "monthly" | "changes" | "narrative" | "billing">("budget");
  const [signals, setSignals]     = useState<Signal[]>([]);
  const [heatmapPeopleCount, setHeatmapPeopleCount] = useState<number | null>(null);
  const [heatmapTotals, setHeatmapTotals] = useState<{ totalCost: number; totalCharge: number; hasBothRates: boolean } | null>(null);

  const handlePeopleLoaded = useCallback((count: number) => { setHeatmapPeopleCount(count); }, []);
  const [, startTransition] = useTransition();
  const lastSignalsKeyRef    = useRef<string>("");
  const baselineMonthlyDataRef = useRef<MonthlyData | null>(null);

  const [overriddenMonths, setOverriddenMonths] = useState<string[]>(() => {
    try { const raw = (content as any).resource_plan_overridden_months; return raw ? JSON.parse(raw) : []; } catch { return []; }
  });

  useEffect(() => {
    if (!projectId || !artifactId) return;
    fetch(`/api/artifacts/financial-plan/resource-plan-sync?projectId=${encodeURIComponent(projectId)}&artifactId=${encodeURIComponent(artifactId)}`, { cache: "no-store" })
      .then(r => r.json()).then(d => {
        if (!d.ok) return;
        const people: Array<{ planned_cost: number | null; planned_charge: number | null; cost_day_rate: number | null; charge_day_rate: number | null }> = d.people ?? [];
        setHeatmapTotals({
          totalCost:   people.reduce((s, p) => s + (p.planned_cost   ?? 0), 0),
          totalCharge: people.reduce((s, p) => s + (p.planned_charge ?? 0), 0),
          hasBothRates: people.some(p => p.cost_day_rate != null && p.charge_day_rate != null && p.cost_day_rate !== p.charge_day_rate),
        });
      }).catch(() => {});
  }, [projectId, artifactId]);

  if (baselineMonthlyDataRef.current === null && content.monthly_data && Object.keys(content.monthly_data).length > 0) {
    baselineMonthlyDataRef.current = JSON.parse(JSON.stringify(content.monthly_data));
  }

  const sym       = CURRENCY_SYMBOLS[content.currency] ?? "\u00a3";
  const lines     = content.cost_lines ?? [];
  const resources = content.resources ?? [];
  const invoices  = content.invoices  ?? [];

  const actualsByLine       = useMemo(() => computeActuals(resources, timesheetEntries), [resources, timesheetEntries]);
  const actualTotalsPerLine = useMemo(() => computeActualTotalsPerLine(resources, timesheetEntries), [resources, timesheetEntries]);
  const linesWithActuals    = useMemo(() => applyActualsToCostLines(lines, actualTotalsPerLine), [lines, actualTotalsPerLine]);

  const totalApprovedDays = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of timesheetEntries) map[e.resource_id] = (map[e.resource_id] ?? 0) + e.approved_days;
    return Object.values(map).reduce((s, d) => s + d, 0);
  }, [timesheetEntries]);

  const resourceTotalsByLine = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of resources) { if (!r.cost_line_id) continue; const t = resourceTotal(r); if (t > 0) map[r.cost_line_id] = (map[r.cost_line_id] ?? 0) + t; }
    return map;
  }, [resources]);

  const contentDeps = useMemo(() => ({
    currency: content.currency, total_approved_budget: content.total_approved_budget,
    summary: content.summary, cost_lines: content.cost_lines,
    change_exposure: content.change_exposure, resources: content.resources,
    variance_narrative: content.variance_narrative, assumptions: content.assumptions,
    last_updated_at: content.last_updated_at,
  }), [content.currency, content.total_approved_budget, content.summary, content.cost_lines, content.change_exposure, content.resources, content.variance_narrative, content.assumptions, content.last_updated_at]);

  const handleChange   = useCallback((patch: FinancialPlanContent) => onChange(patch), [onChange]);
  const updateField    = useCallback(<K extends keyof FinancialPlanContent>(key: K, val: FinancialPlanContent[K]) => { handleChange({ ...content, [key]: val }); }, [content, handleChange]);
  const handleResourcesChange = useCallback((newResources: Resource[]) => { const newLines = rollupResourcesToLines(lines, newResources); handleChange({ ...content, resources: newResources, cost_lines: newLines }); }, [content, lines, handleChange]);
  const updateLine     = useCallback((id: string, patch: Partial<CostLine>) => { handleChange({ ...content, cost_lines: content.cost_lines.map(l => l.id === id ? { ...l, ...patch } : l) }); }, [content, handleChange]);
  const toggleLineOverride = useCallback((id: string) => {
    const line = lines.find(l => l.id === id); if (!line) return;
    const newOverride = !line.override;
    let newLines = lines.map(l => l.id === id ? { ...l, override: newOverride } : l);
    if (!newOverride) newLines = rollupResourcesToLines(newLines, resources);
    handleChange({ ...content, cost_lines: newLines });
  }, [content, lines, resources, handleChange]);
  const addLine    = useCallback(() => handleChange({ ...content, cost_lines: [...content.cost_lines, emptyCostLine()] }), [content, handleChange]);
  const removeLine = useCallback((id: string) => { const newResources = resources.map(r => r.cost_line_id === id ? { ...r, cost_line_id: null } : r); handleChange({ ...content, cost_lines: content.cost_lines.filter(l => l.id !== id), resources: newResources }); }, [content, resources, handleChange]);
  const updateCE   = useCallback((id: string, patch: Partial<ChangeExposure>) => { handleChange({ ...content, change_exposure: content.change_exposure.map(c => c.id === id ? { ...c, ...patch } : c) }); }, [content, handleChange]);
  const addCE      = useCallback(() => handleChange({ ...content, change_exposure: [...content.change_exposure, emptyChangeExposure()] }), [content, handleChange]);
  const removeCE   = useCallback((id: string) => handleChange({ ...content, change_exposure: content.change_exposure.filter(c => c.id !== id) }), [content, handleChange]);

  const fyConfig               = useMemo<FYConfig>(() => content.fy_config ?? { fy_start_month: 4, fy_start_year: new Date().getFullYear(), num_months: 12 }, [content.fy_config]);
  const monthlyData            = useMemo<MonthlyData>(() => content.monthly_data ?? {}, [content.monthly_data]);
  const monthlyDataWithActuals = useMemo(() => applyActualsToMonthlyData(monthlyData, actualsByLine), [monthlyData, actualsByLine]);

  // FIX 2: Derive forecast from monthly phasing — single source of truth
  const forecastFromMonthly = useMemo(() => {
    const result: Record<string, number> = {};
    for (const line of lines) {
      const lineData = monthlyData[line.id];
      if (!lineData) continue;
      const total = Object.values(lineData).reduce((s, e) => s + (Number(e.forecast) || 0), 0);
      if (total !== 0) result[line.id] = total;
    }
    return result;
  }, [lines, monthlyData]);

  const linesForDisplay = useMemo(() =>
    linesWithActuals.map(l => ({ ...l, forecast: forecastFromMonthly[l.id] !== undefined ? forecastFromMonthly[l.id] : l.forecast })),
  [linesWithActuals, forecastFromMonthly]);

  const totalBudgeted     = sumField(linesForDisplay, "budgeted");
  const totalActual       = sumField(linesForDisplay, "actual");
  const totalForecast     = sumField(linesForDisplay, "forecast");
  const approvedBudget    = Number(content.total_approved_budget) || 0;
  const forecastVariance  = approvedBudget ? totalForecast - approvedBudget : null;
  const pendingExposure   = content.change_exposure.filter(c => c.status === "pending").reduce((s, c) => s + (Number(c.cost_impact) || 0), 0);
  const approvedExposure  = content.change_exposure.filter(c => c.status === "approved").reduce((s, c) => s + (Number(c.cost_impact) || 0), 0);
  const utilPct           = approvedBudget ? Math.round((totalForecast / approvedBudget) * 100) : null;
  const overBudget        = forecastVariance !== null && forecastVariance > 0;
  const totalResourceCost = resources.reduce((s, r) => s + resourceTotal(r), 0);
  const avgDayRate        = heatmapTotals && totalApprovedDays > 0 ? heatmapTotals.totalCost / totalApprovedDays : 0;

  useEffect(() => {
    const sigs = analyseFinancialPlan(contentDeps, monthlyDataWithActuals, fyConfig, { lastUpdatedAt: contentDeps.last_updated_at });
    const key  = JSON.stringify(sigs);
    if (key === lastSignalsKeyRef.current) return;
    lastSignalsKeyRef.current = key;
    startTransition(() => setSignals(sigs));
  }, [contentDeps, monthlyDataWithActuals, fyConfig, startTransition]);

  const criticalCount = signals.filter(s => s.severity === "critical").length;
  const warningCount  = signals.filter(s => s.severity === "warning").length;

  const tabs = useMemo(() => [
    { id: "budget"    as const, label: "Cost Breakdown" },
    { id: "resources" as const, label: `Resources${heatmapPeopleCount != null ? ` (${heatmapPeopleCount})` : ""}` },
    { id: "monthly"   as const, label: "Monthly Phasing", badge: criticalCount > 0 ? { count: criticalCount, color: P.red } : warningCount > 0 ? { count: warningCount, color: P.amber } : undefined },
    { id: "changes"   as const, label: `Change Exposure${content.change_exposure.length > 0 ? ` (${content.change_exposure.length})` : ""}` },
    { id: "narrative" as const, label: "Narrative & Assumptions" },
    { id: "billing"   as const, label: `Billing${invoices.length > 0 ? ` (${invoices.length})` : ""}` },
  ], [heatmapPeopleCount, content.change_exposure.length, criticalCount, warningCount, invoices.length]);

  const inputBase: React.CSSProperties  = { border: `1px solid ${P.border}`, background: P.surface, fontFamily: P.sans, fontSize: 13, color: P.text, padding: "6px 10px", outline: "none" };
  const labelStyle: React.CSSProperties = { display: "block", fontFamily: P.mono, fontSize: 8, fontWeight: 600, color: P.textSm, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: P.sans }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end" }}>
        <div>
          <label style={labelStyle}>Currency</label>
          <select value={content.currency} onChange={e => updateField("currency", e.target.value as Currency)} disabled={readOnly} style={{ ...inputBase, fontFamily: P.mono, fontWeight: 600 }}>
            {CURRENCIES.map(c => <option key={c} value={c}>{c} ({CURRENCY_SYMBOLS[c]})</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>
            Total Approved Budget
            {budgetLocked && <span style={{ marginLeft: 6, fontFamily: P.mono, fontSize: 8, fontWeight: 700, color: P.green, background: P.greenLt, border: `1px solid #A0D0B8`, padding: "2px 6px", letterSpacing: "0.06em" }}>BASELINED</span>}
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 4, border: `1px solid ${budgetLocked ? "#A0D0B8" : P.border}`, background: budgetLocked ? P.greenLt : P.surface, padding: "0 10px" }}>
            {budgetLocked && <Lock style={{ width: 12, height: 12, color: P.green, flexShrink: 0 }} />}
            <span style={{ fontFamily: P.mono, fontSize: 13, fontWeight: 700, color: budgetLocked ? P.green : P.textSm }}>{sym}</span>
            <input type="number" min={0} step={1000} value={content.total_approved_budget}
              onChange={e => updateField("total_approved_budget", e.target.value === "" ? "" : Number(e.target.value))}
              readOnly={readOnly || budgetLocked} placeholder="0"
              title={budgetLocked ? "Budget is baselined and locked. Raise a Change Request to uplift it." : undefined}
              style={{ width: 144, border: "none", background: "transparent", fontSize: 13, fontWeight: 600, fontFamily: P.mono, color: budgetLocked ? P.green : P.text, outline: "none", padding: "6px 0", cursor: budgetLocked ? "not-allowed" : "text" }} />
          </div>
          {budgetLocked && <div style={{ marginTop: 4, fontFamily: P.mono, fontSize: 9, color: P.green, display: "flex", alignItems: "center", gap: 4 }}><Lock style={{ width: 9, height: 9 }} /> Locked -- raise a Change Request to uplift</div>}
        </div>
        {artifactId && (
          <a href={`/api/artifacts/financial-plan/export/xlsx?artifactId=${encodeURIComponent(artifactId)}`}
            style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 12px", border: `1px solid ${P.border}`, background: P.bg, color: P.textMd, fontSize: 11, fontWeight: 600, textDecoration: "none", fontFamily: P.mono, marginBottom: 2, flexShrink: 0 }}
            download>Export XLSX</a>
        )}
      </div>

      {/* ── KPI cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        {[
          { label: "Budgeted",         value: fmt(totalBudgeted, sym),   sub: "across all cost lines",          color: P.text,   locked: false },
          { label: "Actual Spent",     value: fmt(totalActual, sym),     sub: totalApprovedDays > 0 ? `${totalApprovedDays.toLocaleString()} approved days` : "awaiting approved timesheets", color: P.violet, locked: true },
          { label: "Total Forecast",   value: fmt(totalForecast, sym),   sub: utilPct !== null ? `${utilPct}% of approved` : "", color: overBudget ? P.red : P.green, locked: false },
          { label: "Pending Exposure", value: fmt(pendingExposure, sym), sub: "from change requests",           color: pendingExposure > 0 ? P.amber : P.textSm, locked: false },
        ].map(s => (
          <div key={s.label} style={{ background: s.locked ? P.violetLt : P.surface, border: `1px solid ${s.locked ? "#a5f3fc" : P.border}`, padding: "12px 16px" }}>
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
          <span>Resource costs total <strong>{fmt(totalResourceCost, sym)}</strong> ({Math.round((totalResourceCost / approvedBudget) * 100)}% of approved budget).{totalResourceCost > approvedBudget && " Warning: Exceeds approved budget."}</span>
        </div>
      )}

      {overBudget && forecastVariance !== null && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", fontSize: 12, border: `1px solid #F0B0AA`, background: P.redLt, color: P.red }}>
          <AlertTriangle style={{ width: 13, height: 13, flexShrink: 0 }} />
          <span>Forecast exceeds approved budget by <strong>{fmt(forecastVariance, sym)}</strong>.</span>
        </div>
      )}

      <div>
        <label style={labelStyle}>Plan Summary</label>
        <textarea value={content.summary} onChange={e => updateField("summary", e.target.value)} readOnly={readOnly} rows={2}
          placeholder="Brief overview of financial position and key spend areas..."
          style={{ ...inputBase, width: "100%", resize: "none", lineHeight: 1.5 }} />
      </div>

      {/* ── Tab bar ── */}
      <div style={{ display: "flex", gap: 0, borderBottom: `2px solid ${P.border}`, overflowX: "auto" }}>
        {tabs.map(tab => {
          const active = activeTab === tab.id;
          return (
            <button type="button" key={tab.id} onClick={() => setActiveTab(tab.id)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", fontFamily: P.sans, fontSize: 12, fontWeight: active ? 600 : 400, cursor: "pointer", background: "none", border: "none", borderBottom: `2px solid ${active ? P.navy : "transparent"}`, color: active ? P.navy : P.textMd, marginBottom: -2, whiteSpace: "nowrap", transition: "all 0.1s" }}>
              {tab.id === "monthly"   && <Calendar style={{ width: 12, height: 12 }} />}
              {tab.id === "resources" && <Users    style={{ width: 12, height: 12 }} />}
              {tab.id === "billing"   && <Receipt  style={{ width: 12, height: 12 }} />}
              {tab.label}
              {tab.id === "monthly" && tab.badge && (
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 16, height: 16, background: tab.badge.color, color: "#FFF", fontFamily: P.mono, fontSize: 9, fontWeight: 700 }}>{tab.badge.count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Cost Breakdown ── */}
      {activeTab === "budget" && (
        <div style={{ border: `1px solid ${P.borderMd}`, overflow: "hidden" }}>
          <div style={{ padding: "6px 12px", background: P.violetLt, borderBottom: `1px solid #a5f3fc`, display: "flex", alignItems: "center", gap: 6, fontFamily: P.mono, fontSize: 9, color: P.violet, fontWeight: 500 }}>
            <Lock style={{ width: 11, height: 11 }} />
            People actuals are locked -- auto-computed from approved timesheets x rate card. Forecast is derived from Monthly Phasing and is read-only here.
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#F4F4F2", borderBottom: `1px solid ${P.borderMd}` }}>
                {[
                  { h: "Category",          bg: "#F4F4F2", color: P.textSm },
                  { h: "Description",       bg: "#F4F4F2", color: P.textSm },
                  { h: `Budgeted (${sym})`, bg: "#F4F4F2", color: P.textSm },
                  { h: `Actual (${sym})`,   bg: P.violetLt, color: P.violet },
                  { h: `Forecast (${sym})`, bg: P.greenLt,  color: P.green },
                  { h: "Variance",          bg: "#F4F4F2", color: P.textSm },
                  { h: "Qty",               bg: "#f0fdf4", color: "#065f46" },
                  { h: "Unit Cost",         bg: "#f0fdf4", color: "#065f46" },
                  { h: "Unit Charge",       bg: "#f0fdf4", color: "#059669" },
                  { h: "Margin",            bg: "#f0fdf4", color: "#059669" },
                  { h: "Resources",         bg: "#F4F4F2", color: P.textSm },
                  { h: "Notes",             bg: "#F4F4F2", color: P.textSm },
                  { h: "",                  bg: "#F4F4F2", color: P.textSm },
                ].map(({ h, bg, color }, i) => (
                  <th key={i} style={{ padding: "8px 10px", textAlign: "left", fontFamily: P.mono, fontSize: 8, fontWeight: 600, color, letterSpacing: "0.08em", textTransform: "uppercase", borderBottom: `1px solid ${P.borderMd}`, background: bg, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && <tr><td colSpan={13} style={{ padding: "32px 16px", textAlign: "center", fontFamily: P.sans, fontSize: 13, color: P.textSm }}>No cost lines yet. Click <strong>Add line</strong> below.</td></tr>}
              {linesForDisplay.map((l, idx) => {
                const resTotal          = resourceTotalsByLine[l.id] ?? 0;
                const hasResources      = resTotal > 0;
                const lineApprovedDays  = timesheetEntries.filter(e => { const r = resources.find(r => r.id === e.resource_id); return r?.cost_line_id === l.id; }).reduce((s, e) => s + e.approved_days, 0);
                const hasTimesheetData  = lineApprovedDays > 0;
                const rowBg             = idx % 2 === 0 ? P.surface : "#FAFAF8";
                const cellBase: React.CSSProperties = { borderBottom: `1px solid ${P.border}`, background: rowBg };
                const greenBg           = idx % 2 === 0 ? "#f0fdf4" : "#e8faf0";
                const qty               = Number(l.quantity   || 0);
                const unitCost          = Number(l.unit_cost   || 0);
                const unitCharge        = Number(l.unit_charge || 0);
                const lineCost          = qty > 0 && unitCost   > 0 ? qty * unitCost   : null;
                const lineCharge        = qty > 0 && unitCharge > 0 ? qty * unitCharge : null;
                const lineMargin        = lineCost != null && lineCharge != null ? lineCharge - lineCost : null;
                const marginPct         = lineCharge != null && lineCharge > 0 && lineMargin != null ? Math.round((lineMargin / lineCharge) * 100) : null;
                const isPeople          = l.category === "people";
                const hasMonthlForecast = forecastFromMonthly[l.id] !== undefined;

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
                        placeholder="Description..." style={{ width: "100%", border: "none", background: "transparent", padding: "6px 8px", fontSize: 12, color: P.text, fontFamily: P.sans, outline: "none" }} />
                    </td>
                    <td style={{ ...cellBase, background: hasResources && !l.override ? "#F2F8FF" : rowBg }}>
                      <MoneyCell value={l.budgeted} onChange={v => updateLine(l.id, { budgeted: v })} symbol={sym} readOnly={readOnly || (hasResources && !l.override)} />
                    </td>
                    <td style={{ ...cellBase, background: isPeople ? P.violetLt : rowBg }}>
                      {isPeople
                        ? <ActualCell value={l.actual} symbol={sym} approvedDays={lineApprovedDays} hasTimesheetData={hasTimesheetData} />
                        : <MoneyCell value={l.actual} onChange={v => updateLine(l.id, { actual: v })} symbol={sym} readOnly={readOnly} />
                      }
                    </td>
                    {/* FIX 2: Forecast locked when monthly phasing data exists */}
                    <td style={{ ...cellBase, background: hasMonthlForecast ? P.greenLt : hasResources && !l.override ? "#F2F8FF" : rowBg }}>
                      {hasMonthlForecast ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 8px" }} title="Derived from Monthly Phasing — edit values there to update">
                          <Lock style={{ width: 9, height: 9, color: P.green, flexShrink: 0, opacity: 0.7 }} />
                          <span style={{ fontFamily: P.mono, fontSize: 12, fontWeight: 600, color: P.green, fontVariantNumeric: "tabular-nums" }}>{fmt(forecastFromMonthly[l.id], sym)}</span>
                        </div>
                      ) : (
                        <MoneyCell value={l.forecast} onChange={v => updateLine(l.id, { forecast: v })} symbol={sym} readOnly={readOnly || (hasResources && !l.override)} />
                      )}
                    </td>
                    <td style={{ ...cellBase, padding: "4px 10px" }}><VarianceBadge budget={l.budgeted} forecast={l.forecast} /></td>
                    <td style={{ ...cellBase, background: isPeople ? rowBg : greenBg, minWidth: 60 }}>
                      {!isPeople ? <input type="number" min={0} step={1} value={l.quantity === "" ? "" : l.quantity} onChange={e => updateLine(l.id, { quantity: e.target.value === "" ? "" : Number(e.target.value) })} readOnly={readOnly} placeholder="1" style={{ width: "100%", border: "none", background: "transparent", padding: "6px 8px", fontSize: 12, color: P.text, fontFamily: P.mono, outline: "none" }} />
                        : <span style={{ padding: "6px 8px", display: "block", fontFamily: P.mono, fontSize: 9, color: P.border }}>—</span>}
                    </td>
                    <td style={{ ...cellBase, background: isPeople ? rowBg : greenBg }}>
                      {!isPeople ? <MoneyCell value={l.unit_cost} onChange={v => { const q = Number(l.quantity || 0); const patch: Partial<CostLine> = { unit_cost: v }; if (q > 0 && v !== "") patch.budgeted = q * Number(v); updateLine(l.id, patch); }} symbol={sym} readOnly={readOnly} />
                        : <span style={{ padding: "6px 8px", display: "block", fontFamily: P.mono, fontSize: 9, color: P.border }}>—</span>}
                    </td>
                    <td style={{ ...cellBase, background: isPeople ? rowBg : greenBg }}>
                      {!isPeople ? <MoneyCell value={l.unit_charge} onChange={v => { const q = Number(l.quantity || 0); const patch: Partial<CostLine> = { unit_charge: v }; if (q > 0 && v !== "") patch.forecast = q * Number(v); updateLine(l.id, patch); }} symbol={sym} readOnly={readOnly} />
                        : <span style={{ padding: "6px 8px", display: "block", fontFamily: P.mono, fontSize: 9, color: P.border }}>—</span>}
                    </td>
                    <td style={{ ...cellBase, background: isPeople ? rowBg : greenBg, padding: "4px 10px" }}>
                      {!isPeople && lineMargin != null ? (
                        <div>
                          <div style={{ fontFamily: P.mono, fontSize: 11, fontWeight: 700, color: lineMargin >= 0 ? "#059669" : P.red }}>{sym}{Math.abs(lineMargin).toLocaleString("en-GB", { maximumFractionDigits: 0 })}</div>
                          {marginPct != null && <div style={{ fontFamily: P.mono, fontSize: 8, color: lineMargin >= 0 ? "#059669" : P.red }}>{marginPct}% margin</div>}
                        </div>
                      ) : <span style={{ fontFamily: P.mono, fontSize: 9, color: P.border }}>—</span>}
                    </td>
                    <td style={{ ...cellBase, padding: "4px 8px", minWidth: 130 }}>
                      {!readOnly && <OverrideToggle line={l} hasLinkedResources={hasResources} resTotal={resTotal} sym={sym} onToggle={() => toggleLineOverride(l.id)} />}
                      {!hasResources && <span style={{ fontFamily: P.mono, fontSize: 9, color: P.border }}>no resources</span>}
                    </td>
                    <td style={{ ...cellBase, minWidth: 160 }}>
                      <input type="text" value={l.notes} onChange={e => updateLine(l.id, { notes: e.target.value })} readOnly={readOnly}
                        placeholder="Notes..." style={{ width: "100%", border: "none", background: "transparent", padding: "6px 8px", fontSize: 12, color: P.textMd, fontFamily: P.sans, outline: "none" }} />
                    </td>
                    <td style={{ ...cellBase, padding: "4px 6px" }}>
                      {!readOnly && <button type="button" onClick={() => removeLine(l.id)} style={{ padding: 4, background: "none", border: "none", cursor: "pointer", color: P.textSm, opacity: 0 }}
                        onMouseEnter={e => { e.currentTarget.style.color = P.red; e.currentTarget.style.opacity = "1"; }}
                        onMouseLeave={e => { e.currentTarget.style.color = P.textSm; e.currentTarget.style.opacity = "0.35"; }} aria-label="Delete cost line"><Trash2 style={{ width: 13, height: 13 }} /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {lines.length > 0 && (() => {
              const nonPL = linesForDisplay.filter(l => l.category !== "people");
              const tlc   = nonPL.reduce((s, l) => { const q = Number(l.quantity || 0), uc = Number(l.unit_cost || 0); return s + (q > 0 && uc > 0 ? q * uc : 0); }, 0);
              const tlch  = nonPL.reduce((s, l) => { const q = Number(l.quantity || 0), uch = Number(l.unit_charge || 0); return s + (q > 0 && uch > 0 ? q * uch : 0); }, 0);
              const tlm   = tlch - tlc;
              const tlmp  = tlch > 0 ? Math.round((tlm / tlch) * 100) : null;
              return (
                <tfoot>
                  <tr style={{ background: "#F0F0ED", borderTop: `2px solid ${P.borderMd}` }}>
                    <td colSpan={2} style={{ padding: "8px 10px", fontFamily: P.mono, fontSize: 9, fontWeight: 700, color: P.textMd, letterSpacing: "0.06em", textTransform: "uppercase" }}>Total</td>
                    <td style={{ padding: "8px 10px", fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: P.text }}>{fmt(totalBudgeted, sym)}</td>
                    <td style={{ padding: "8px 10px", background: P.violetLt }}><span style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: P.violet }}><Lock style={{ width: 10, height: 10 }} /> {fmt(totalActual, sym)}</span></td>
                    <td style={{ padding: "8px 10px", background: P.greenLt }}><span style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: P.green }}><Lock style={{ width: 10, height: 10 }} /> {fmt(totalForecast, sym)}</span></td>
                    <td style={{ padding: "8px 10px" }}><VarianceBadge budget={totalBudgeted} forecast={totalForecast} /></td>
                    <td /><td />
                    <td style={{ padding: "8px 10px", background: "#f0fdf4" }}>{tlch > 0 && <div style={{ fontFamily: P.mono, fontSize: 11, fontWeight: 700, color: "#059669" }}>{sym}{tlch.toLocaleString("en-GB", { maximumFractionDigits: 0 })}</div>}</td>
                    <td style={{ padding: "8px 10px", background: "#f0fdf4" }}>{tlc > 0 && tlch > 0 && <div><div style={{ fontFamily: P.mono, fontSize: 11, fontWeight: 700, color: tlm >= 0 ? "#059669" : P.red }}>{sym}{Math.abs(tlm).toLocaleString("en-GB", { maximumFractionDigits: 0 })}</div>{tlmp != null && <div style={{ fontFamily: P.mono, fontSize: 8, color: tlm >= 0 ? "#059669" : P.red }}>{tlmp}% margin</div>}</div>}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              );
            })()}
          </table>
          {!readOnly && (
            <div style={{ padding: "8px 16px", background: P.bg, borderTop: `1px solid ${P.border}` }}>
              <button type="button" onClick={addLine} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", fontFamily: P.sans, fontSize: 12, color: P.navy, cursor: "pointer", fontWeight: 500 }}>
                <Plus style={{ width: 14, height: 14 }} /> Add line
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Resources ── */}
      {activeTab === "resources" && (
        <ResourcesTab resources={resources} costLines={lines} sym={sym} currency={content.currency}
          readOnly={readOnly} onChange={handleResourcesChange} organisationId={organisationId}
          monthlyData={monthlyData} fyConfig={fyConfig} timesheetEntries={timesheetEntries}
          actualsByLine={actualsByLine} onSyncMonthly={d => updateField("monthly_data", d)}
          projectId={projectId} artifactId={artifactId} onPeopleLoaded={handlePeopleLoaded} />
      )}

      {/* ── Monthly Phasing ── */}
      {activeTab === "monthly" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {heatmapTotals && (() => {
            const { totalCost: pc, totalCharge: pch } = heatmapTotals;
            const tc  = pc  + lines.filter(l => l.category !== "people").reduce((s, l) => { const q = Number(l.quantity || 0), uc = Number(l.unit_cost || 0); return s + (q > 0 && uc > 0 ? q * uc : Number(l.budgeted || 0)); }, 0);
            const tch = pch + lines.filter(l => l.category !== "people").reduce((s, l) => { const q = Number(l.quantity || 0), uch = Number(l.unit_charge || 0); return s + (q > 0 && uch > 0 ? q * uch : Number(l.forecast || l.budgeted || 0)); }, 0);
            if (tc === 0 && tch === 0) return null;
            const m = tch - tc; const mp = tch > 0 ? Math.round((m / tch) * 100) : null;
            return (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                <div style={{ border: `1px solid ${P.border}`, background: P.navyLt, padding: "12px 16px" }}><div style={{ fontFamily: P.mono, fontSize: 8, fontWeight: 700, color: P.textSm, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Total Internal Cost</div><div style={{ fontFamily: P.mono, fontSize: 18, fontWeight: 700, color: P.navy }}>{sym}{tc.toLocaleString("en-GB", { maximumFractionDigits: 0 })}</div><div style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm, marginTop: 2 }}>people + tools &amp; licences</div></div>
                <div style={{ border: "1px solid #a7f3d0", background: "#f0fdf4", padding: "12px 16px" }}><div style={{ fontFamily: P.mono, fontSize: 8, fontWeight: 700, color: "#065f46", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Total Charge-out Revenue</div><div style={{ fontFamily: P.mono, fontSize: 18, fontWeight: 700, color: "#059669" }}>{tch > 0 ? `${sym}${tch.toLocaleString("en-GB", { maximumFractionDigits: 0 })}` : "—"}</div><div style={{ fontFamily: P.mono, fontSize: 9, color: "#065f46", marginTop: 2 }}>what client is billed</div></div>
                <div style={{ border: `1px solid ${m >= 0 ? "#a7f3d0" : "#fecaca"}`, background: m >= 0 ? "#f0fdf4" : "#fff5f5", padding: "12px 16px" }}><div style={{ fontFamily: P.mono, fontSize: 8, fontWeight: 700, color: m >= 0 ? "#065f46" : P.red, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Gross Margin</div><div style={{ fontFamily: P.mono, fontSize: 18, fontWeight: 700, color: m >= 0 ? "#059669" : P.red }}>{tch > 0 ? `${sym}${Math.abs(m).toLocaleString("en-GB", { maximumFractionDigits: 0 })}` : "—"}</div><div style={{ fontFamily: P.mono, fontSize: 9, color: m >= 0 ? "#065f46" : P.red, marginTop: 2 }}>{mp != null ? `${mp}% margin` : "add charge-out rates to see margin"}</div></div>
              </div>
            );
          })()}

          {artifactId && projectId && (
            <ResourcePlanSyncBar projectId={projectId} artifactId={artifactId} isAdmin={isAdmin}
              currency={content.currency} lastSyncedAt={content.resource_plan_synced_at ?? null}
              overriddenMonths={overriddenMonths}
              onOverrideChange={months => { setOverriddenMonths(months); handleChange({ ...content, resource_plan_overridden_months: JSON.stringify(months) }); }}
              onSynced={() => { onRequestReload?.(); }} />
          )}

          {!readOnly && resources.length > 0 && (
            <ResourceSyncBar resources={resources} costLines={lines} monthlyData={monthlyData}
              fyConfig={fyConfig} currency={content.currency} timesheetEntries={timesheetEntries}
              onSync={d => updateField("monthly_data", d)} />
          )}

          <FinancialIntelligencePanel content={content} monthlyData={monthlyDataWithActuals} fyConfig={fyConfig}
            lastUpdatedAt={content.last_updated_at} raidItems={raidItems} approvalDelays={approvalDelays} onSignalsChange={setSignals} />

          <FinancialPlanMonthlyView content={content} monthlyData={monthlyDataWithActuals}
            onMonthlyDataChange={d => updateField("monthly_data", d)}
            fyConfig={fyConfig} onFyConfigChange={c => updateField("fy_config", c)}
            signals={signals} readOnly={readOnly} baselineMonthlyData={baselineMonthlyDataRef.current ?? undefined} />
        </div>
      )}

      {/* ── Change Exposure ── */}
      {activeTab === "changes" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {[
              { label: "Approved Exposure", value: fmt(approvedExposure, sym), color: P.navy },
              { label: "Pending Exposure",  value: fmt(pendingExposure, sym),  color: pendingExposure > 0 ? P.amber : P.textSm },
              { label: "Total Exposure",    value: fmt(approvedExposure + pendingExposure, sym), color: P.text },
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
                {content.change_exposure.length === 0 && <tr><td colSpan={6} style={{ padding: "32px 16px", textAlign: "center", fontFamily: P.sans, fontSize: 13, color: P.textSm }}>No change exposure logged yet.</td></tr>}
                {content.change_exposure.map((c, idx) => {
                  const rowBg = idx % 2 === 0 ? P.surface : "#FAFAF8";
                  const cb: React.CSSProperties = { borderBottom: `1px solid ${P.border}`, background: rowBg };
                  return (
                    <tr key={c.id} style={{ background: rowBg }}>
                      <td style={cb}><input type="text" value={c.change_ref} onChange={e => updateCE(c.id, { change_ref: e.target.value })} readOnly={readOnly} placeholder="CR-001" style={{ width: "100%", border: "none", background: "transparent", padding: "6px 8px", fontSize: 11, fontFamily: P.mono, color: P.textMd, outline: "none" }} /></td>
                      <td style={{ ...cb, minWidth: 180 }}><input type="text" value={c.title} onChange={e => updateCE(c.id, { title: e.target.value })} readOnly={readOnly} placeholder="Change title..." style={{ width: "100%", border: "none", background: "transparent", padding: "6px 8px", fontSize: 12, color: P.text, fontFamily: P.sans, outline: "none" }} /></td>
                      <td style={cb}><MoneyCell value={c.cost_impact} onChange={v => updateCE(c.id, { cost_impact: v })} symbol={sym} readOnly={readOnly} /></td>
                      <td style={{ ...cb, padding: "4px 8px" }}>
                        <select value={c.status} onChange={e => updateCE(c.id, { status: e.target.value as ChangeExposure["status"] })} disabled={readOnly}
                          style={{ fontSize: 10, fontFamily: P.mono, fontWeight: 700, padding: "3px 8px", border: "none", cursor: readOnly ? "default" : "pointer", outline: "none", background: c.status === "approved" ? P.greenLt : c.status === "pending" ? P.amberLt : "#F4F4F2", color: c.status === "approved" ? P.green : c.status === "pending" ? P.amber : P.textSm }}>
                          <option value="approved">Approved</option><option value="pending">Pending</option><option value="rejected">Rejected</option>
                        </select>
                      </td>
                      <td style={{ ...cb, minWidth: 160 }}><input type="text" value={c.notes} onChange={e => updateCE(c.id, { notes: e.target.value })} readOnly={readOnly} placeholder="Notes..." style={{ width: "100%", border: "none", background: "transparent", padding: "6px 8px", fontSize: 12, color: P.textMd, fontFamily: P.sans, outline: "none" }} /></td>
                      <td style={{ ...cb, padding: "4px 6px" }}>
                        {!readOnly && <button type="button" onClick={() => removeCE(c.id)} style={{ padding: 4, background: "none", border: "none", cursor: "pointer", color: P.textSm, opacity: 0 }}
                          onMouseEnter={e => { e.currentTarget.style.color = P.red; e.currentTarget.style.opacity = "1"; }}
                          onMouseLeave={e => { e.currentTarget.style.color = P.textSm; e.currentTarget.style.opacity = "0"; }} aria-label="Delete change exposure"><Trash2 style={{ width: 13, height: 13 }} /></button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!readOnly && <div style={{ padding: "8px 16px", background: P.bg, borderTop: `1px solid ${P.border}` }}>
              <button type="button" onClick={addCE} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", fontFamily: P.sans, fontSize: 12, color: P.amber, cursor: "pointer", fontWeight: 500 }}>
                <Plus style={{ width: 14, height: 14 }} /> Add change exposure
              </button>
            </div>}
          </div>
        </div>
      )}

      {/* ── Narrative ── */}
      {activeTab === "narrative" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {[
            { key: "variance_narrative" as const, label: "Variance Narrative",        placeholder: "Explain material variances between budget and forecast..." },
            { key: "assumptions"        as const, label: "Assumptions & Constraints", placeholder: "Key assumptions: rates, headcount, duration, exchange rate basis..." },
          ].map(({ key, label, placeholder }) => (
            <div key={key}>
              <label style={labelStyle}>{label}</label>
              <textarea value={content[key]} onChange={e => updateField(key, e.target.value)} readOnly={readOnly} rows={4}
                placeholder={placeholder} style={{ ...inputBase, width: "100%", resize: "vertical", lineHeight: 1.6 }} />
            </div>
          ))}
        </div>
      )}

      {/* ── Billing ── */}
      {activeTab === "billing" && (
        <BillingCockpit
          invoices={invoices}
          onInvoicesChange={inv => updateField("invoices", inv)}
          costLines={lines}
          changeExposure={content.change_exposure}
          currency={content.currency}
          totalForecast={totalForecast}
          totalBudget={approvedBudget}
          plannedCost={heatmapTotals?.totalCost ?? 0}
          plannedCharge={heatmapTotals?.totalCharge ?? 0}
          totalCostToDate={totalActual}
          approvedDaysTotal={totalApprovedDays}
          avgDayRate={avgDayRate}
          readOnly={readOnly}
        />
      )}

    </div>
  );
}