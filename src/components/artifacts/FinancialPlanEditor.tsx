"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  Plus, Trash2, TrendingUp, TrendingDown, AlertTriangle,
  Calendar, Users, Link2, Link2Off, Zap, ChevronRight,
  Check, AlertCircle,
} from "lucide-react";
import FinancialPlanMonthlyView, { type MonthlyData, type FYConfig } from "./FinancialPlanMonthlyView";
import FinancialIntelligencePanel from "./FinancialIntelligencePanel";
import { analyseFinancialPlan, type Signal } from "@/lib/financial-intelligence";
import ResourcePicker, { type PickedPerson } from "./ResourcePicker";
import { syncResourcesToMonthlyData, previewSync } from "./syncResourcesToMonthlyData";

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
  /** Links to auth.users.id — set when picked from org picker */
  user_id?: string;
  /** Display name — auto-filled from profile, can be overridden */
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
  /** Optional: which month this resource starts (YYYY-MM). Defaults to FY start. */
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
  return {
    id: uid(), category: "people", description: "",
    budgeted: "", actual: "", forecast: "", notes: "", override: false,
  };
}

function emptyChangeExposure(): ChangeExposure {
  return {
    id: uid(), change_ref: "", title: "",
    cost_impact: "", status: "pending", notes: "",
  };
}

function emptyResource(): Resource {
  return {
    id: uid(), user_id: undefined, name: "", role: "developer", type: "internal",
    rate_type: "day_rate", day_rate: "", planned_days: "",
    monthly_cost: "", planned_months: "", cost_line_id: null, notes: "",
  };
}

function resourceTotal(r: Resource): number {
  if (r.rate_type === "day_rate") {
    return (Number(r.day_rate) || 0) * (Number(r.planned_days) || 0);
  }
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
  if (!budget || forecast === "") return <span className="text-gray-300 text-xs">—</span>;
  const pct = ((Number(forecast) - Number(budget)) / Number(budget)) * 100;
  const over = pct > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${over ? "text-red-600" : "text-green-600"}`}>
      {over ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {over ? "+" : ""}{pct.toFixed(1)}%
    </span>
  );
}

function MoneyCell({
  value, onChange, symbol, readOnly = false,
}: {
  value: number | ""; onChange: (v: number | "") => void; symbol: string; readOnly?: boolean;
}) {
  return (
    <div className="flex items-center gap-1 px-1">
      <span className="text-xs text-gray-400">{symbol}</span>
      <input
        type="number" min={0} step={100} value={value}
        onChange={e => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        readOnly={readOnly}
        className={`w-24 border-0 bg-transparent py-1.5 text-sm text-right font-medium text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400 rounded ${readOnly ? "opacity-60 cursor-default" : ""}`}
        placeholder="0"
      />
    </div>
  );
}

function OverrideToggle({
  line, hasLinkedResources, resTotal, sym, onToggle,
}: {
  line: CostLine; hasLinkedResources: boolean; resTotal: number; sym: string; onToggle: () => void;
}) {
  if (!hasLinkedResources) return null;
  return (
    <button
      onClick={onToggle}
      title={line.override ? "Re-enable auto-update from resources" : "Override — stop auto-update"}
      className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border transition-all ${
        line.override
          ? "bg-amber-100 border-amber-300 text-amber-700 hover:bg-amber-200"
          : "bg-emerald-100 border-emerald-300 text-emerald-700 hover:bg-emerald-200"
      }`}
    >
      {line.override ? <Link2Off className="w-2.5 h-2.5" /> : <Link2 className="w-2.5 h-2.5" />}
      {line.override ? "Override" : `Auto ${fmt(resTotal, sym)}`}
    </button>
  );
}

// ── ResourceSyncBar ───────────────────────────────────────────────────────────

function ResourceSyncBar({
  resources, costLines, monthlyData, fyConfig, currency, onSync,
}: {
  resources:   Resource[];
  costLines:   CostLine[];
  monthlyData: MonthlyData;
  fyConfig:    FYConfig;
  currency:    string;
  onSync:      (d: MonthlyData) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [synced,   setSynced]   = useState(false);

  const sym = CURRENCY_SYMBOLS[currency as Currency] ?? "£";

  const preview = previewSync(resources, costLines, monthlyData, fyConfig);

  const readyResources = resources.filter(r =>
    r.cost_line_id &&
    (
      (r.rate_type === "day_rate"     && Number(r.day_rate)     > 0 && Number(r.planned_days)   > 0) ||
      (r.rate_type === "monthly_cost" && Number(r.monthly_cost) > 0 && Number(r.planned_months) > 0)
    )
  );

  const unreadyResources = resources.filter(r =>
    r.cost_line_id &&
    !(
      (r.rate_type === "day_rate"     && Number(r.day_rate)     > 0 && Number(r.planned_days)   > 0) ||
      (r.rate_type === "monthly_cost" && Number(r.monthly_cost) > 0 && Number(r.planned_months) > 0)
    )
  );

  if (resources.length === 0) return null;

  const hasChanges = preview.length > 0;

  function handleSync() {
    const newData = syncResourcesToMonthlyData(resources, costLines, monthlyData, fyConfig);
    onSync(newData);
    setSynced(true);
    setTimeout(() => setSynced(false), 3000);
    setExpanded(false);
  }

  return (
    <div className={`rounded-xl border overflow-hidden ${
      synced       ? "border-emerald-200 bg-emerald-50"
      : hasChanges ? "border-blue-200 bg-blue-50"
      :              "border-gray-200 bg-gray-50"
    }`}>
      <div className="flex items-center justify-between px-4 py-3 gap-3">
        <div className="flex items-center gap-3">
          <Zap className={`w-4 h-4 flex-shrink-0 ${
            synced ? "text-emerald-500" : hasChanges ? "text-blue-500" : "text-gray-400"
          }`} />
          <div>
            <div className={`text-xs font-bold ${
              synced ? "text-emerald-700" : hasChanges ? "text-blue-700" : "text-gray-600"
            }`}>
              {synced
                ? "Monthly phasing synced from resources"
                : hasChanges
                ? `${readyResources.length} resource${readyResources.length !== 1 ? "s" : ""} ready to sync to monthly phasing`
                : "Monthly phasing is up to date with resources"
              }
            </div>
            <div className="text-[10px] text-gray-400 mt-0.5">
              {readyResources.length} ready · {unreadyResources.length} missing rate or qty · {resources.filter(r => !r.cost_line_id).length} unlinked
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {hasChanges && !synced && (
            <>
              <button
                onClick={() => setExpanded(v => !v)}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                Preview
                <ChevronRight className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
              </button>
              <button
                onClick={handleSync}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-all shadow-sm"
              >
                <Zap className="w-3 h-3" />
                Sync to monthly
              </button>
            </>
          )}
          {synced && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold">
              <Check className="w-3.5 h-3.5" /> Synced
            </span>
          )}
        </div>
      </div>

      {expanded && hasChanges && (
        <div className="border-t border-blue-100 bg-white divide-y divide-gray-100">
          {preview.map(row => {
            const delta = row.totalAfter - row.totalBefore;
            return (
              <div key={row.lineId} className="px-4 py-2.5 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-gray-800 truncate">{row.lineLabel}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">{row.monthsAffected} month{row.monthsAffected !== 1 ? "s" : ""} will change</div>
                </div>
                <div className="flex items-center gap-2 text-xs tabular-nums flex-shrink-0">
                  <span className="text-gray-400">{fmtShort(row.totalBefore, sym)}</span>
                  <span className="text-gray-300">→</span>
                  <span className="font-bold text-gray-800">{fmtShort(row.totalAfter, sym)}</span>
                  {delta !== 0 && (
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                      delta > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                    }`}>
                      {delta > 0 ? "+" : ""}{fmtShort(delta, sym)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {unreadyResources.length > 0 && (
            <div className="px-4 py-2.5 flex items-start gap-2 bg-amber-50">
              <AlertCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="text-[10px] text-amber-700">
                <strong>{unreadyResources.length} resource{unreadyResources.length !== 1 ? "s" : ""}</strong> linked but missing rate or qty:
                <ul className="mt-1 list-disc list-inside">
                  {unreadyResources.map(r => <li key={r.id}>{r.name || "Unnamed"}</li>)}
                </ul>
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
  monthlyData, fyConfig, onSyncMonthly,
}: {
  resources:      Resource[];
  costLines:      CostLine[];
  sym:            string;
  currency:       Currency;
  readOnly:       boolean;
  onChange:       (r: Resource[]) => void;
  organisationId: string;
  monthlyData:    MonthlyData;
  fyConfig:       FYConfig;
  onSyncMonthly:  (d: MonthlyData) => void;
}) {
  const update = (id: string, patch: Partial<Resource>) =>
    onChange(resources.map(r => r.id === id ? { ...r, ...patch } : r));

  const totalCost    = resources.reduce((s, r) => s + resourceTotal(r), 0);
  const linkedCost   = resources.filter(r => r.cost_line_id).reduce((s, r) => s + resourceTotal(r), 0);
  const unlinkedCost = totalCost - linkedCost;

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

  return (
    <div className="flex flex-col gap-5">

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Resources",      value: String(resources.length), sub: "across all roles",                                                          color: "text-gray-700"   },
          { label: "Total Resource Cost",  value: fmt(totalCost, sym),      sub: "calculated from rates",                                                     color: "text-blue-600"   },
          { label: "Linked to Cost Lines", value: fmt(linkedCost, sym),     sub: `${byLine.length} line${byLine.length !== 1 ? "s" : ""} receiving rollup`,   color: "text-emerald-600" },
          { label: "Unlinked Cost",        value: fmt(unlinkedCost, sym),   sub: unlinkedCost > 0 ? "not rolling up" : "all linked",                          color: unlinkedCost > 0 ? "text-amber-600" : "text-gray-400" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
            <div className="text-xs text-gray-500 mb-1">{s.label}</div>
            <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Rollup summary */}
      {byLine.length > 0 && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/50 px-4 py-3">
          <div className="flex items-center gap-2 mb-2.5">
            <Link2 className="w-3.5 h-3.5 text-blue-500" />
            <span className="text-xs font-bold text-blue-700 uppercase tracking-wide">Cost Line Rollup</span>
          </div>
          <div className="flex flex-wrap gap-3">
            {byLine.map(({ line, resources: lr, total }) => (
              <div key={line.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${line.override ? "bg-amber-50 border-amber-200" : "bg-white border-blue-200"}`}>
                <span className="font-semibold text-gray-700 max-w-[120px] truncate">{line.description || line.category}</span>
                <span className="text-gray-400">←</span>
                <span className="text-slate-500">{lr.length} resource{lr.length !== 1 ? "s" : ""}</span>
                <span className="font-bold text-blue-600">{fmt(total, sym)}</span>
                {line.override && <span className="text-[10px] font-semibold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">Override</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sync bar — wires resources to monthly phasing */}
      {!readOnly && (
        <ResourceSyncBar
          resources={resources}
          costLines={costLines}
          monthlyData={monthlyData}
          fyConfig={fyConfig}
          currency={currency}
          onSync={onSyncMonthly}
        />
      )}

      {/* Rate card hint */}
      <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
        <Users className="w-3.5 h-3.5 flex-shrink-0" />
        <span>
          Pick a person from your organisation — their rate auto-fills from the{" "}
          <strong>Rate Card</strong>. Org admins manage rates in{" "}
          <strong>Organisation Settings → Rate Cards</strong>.
          Then hit <strong>Sync to monthly</strong> to phase costs across the timeline.
        </span>
      </div>

      {/* Resource table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
              {["Person / Role", "Type", "Rate Method", "Rate", "Qty", "Total", "Start Month", "Links to", "Notes", ""].map((h, i) => (
                <th key={i} className="px-3 py-2.5 text-left border-b border-gray-200 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {resources.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-sm text-gray-400">
                  No resources yet. Click <strong>Add resource</strong> below.
                </td>
              </tr>
            )}
            {resources.map((r, idx) => {
              const total      = resourceTotal(r);
              const linkedLine = costLines.find(l => l.id === r.cost_line_id);
              const hasRate    = r.rate_type === "day_rate"
                ? Number(r.day_rate) > 0
                : Number(r.monthly_cost) > 0;

              return (
                <tr key={r.id} className={`${idx % 2 === 0 ? "bg-white" : "bg-gray-50/50"} hover:bg-blue-50/20 group transition-colors`}>

                  {/* Person — searchable picker */}
                  <td className="border-b border-gray-100 min-w-[220px] px-2 py-1.5">
                    <ResourcePicker
                      organisationId={organisationId}
                      value={r.user_id ?? null}
                      currentResource={r}
                      disabled={readOnly}
                      onPick={(person: PickedPerson) => {
                        update(r.id, {
                          user_id: person.user_id || undefined,
                          name:    person.full_name ?? person.email ?? r.name,
                          ...(person.rate_type != null ? {
                            rate_type:    person.rate_type,
                            day_rate:     person.rate_type === "day_rate"     ? (person.rate ?? "") : r.day_rate,
                            monthly_cost: person.rate_type === "monthly_cost" ? (person.rate ?? "") : r.monthly_cost,
                            type:         (person.resource_type ?? r.type) as ResourceType,
                          } : {}),
                        });
                      }}
                    />
                    {/* Role label override */}
                    <input
                      type="text"
                      value={r.name}
                      onChange={e => update(r.id, { name: e.target.value })}
                      readOnly={readOnly}
                      placeholder="Role label override…"
                      className="w-full border-0 bg-transparent px-2 py-0.5 text-[11px] text-gray-500 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-400 rounded mt-0.5"
                    />
                  </td>

                  {/* Type */}
                  <td className="border-b border-gray-100 min-w-[110px] px-2 py-1">
                    <select
                      value={r.type}
                      onChange={e => update(r.id, { type: e.target.value as ResourceType })}
                      disabled={readOnly}
                      className={`text-xs font-semibold px-2 py-1.5 rounded-full border-0 cursor-pointer focus:outline-none w-full ${
                        r.type === "internal"    ? "bg-blue-100 text-blue-700"
                        : r.type === "contractor" ? "bg-amber-100 text-amber-700"
                        : r.type === "vendor"     ? "bg-purple-100 text-purple-700"
                        : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {(Object.keys(RESOURCE_TYPE_LABELS) as ResourceType[]).map(t => (
                        <option key={t} value={t}>{RESOURCE_TYPE_LABELS[t]}</option>
                      ))}
                    </select>
                  </td>

                  {/* Rate method toggle */}
                  <td className="border-b border-gray-100 px-2 py-1">
                    <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5 w-fit">
                      {(["day_rate", "monthly_cost"] as ResourceRateType[]).map(rt => (
                        <button
                          key={rt}
                          onClick={() => !readOnly && update(r.id, { rate_type: rt })}
                          className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all whitespace-nowrap ${
                            r.rate_type === rt ? "bg-white shadow text-gray-800" : "text-gray-400 hover:text-gray-600"
                          }`}
                        >
                          {rt === "day_rate" ? "Day Rate" : "Monthly"}
                        </button>
                      ))}
                    </div>
                  </td>

                  {/* Rate */}
                  <td className="border-b border-gray-100 min-w-[110px]">
                    <div className="relative">
                      {r.rate_type === "day_rate" ? (
                        <MoneyCell value={r.day_rate} onChange={v => update(r.id, { day_rate: v })} symbol={sym} readOnly={readOnly} />
                      ) : (
                        <MoneyCell value={r.monthly_cost} onChange={v => update(r.id, { monthly_cost: v })} symbol={sym} readOnly={readOnly} />
                      )}
                    </div>
                    <div className="px-3 text-[10px] text-gray-400">
                      {r.rate_type === "day_rate" ? "per day" : "per month"}
                    </div>
                    {/* Rate card badge */}
                    {hasRate && r.user_id && (
                      <div className="px-2 mt-0.5">
                        <span className="inline-flex items-center gap-1 text-[9px] text-emerald-600 font-semibold">
                          <Zap className="w-2 h-2" /> from rate card
                        </span>
                      </div>
                    )}
                  </td>

                  {/* Qty */}
                  <td className="border-b border-gray-100 min-w-[80px] px-2 py-1">
                    <input
                      type="number" min={0} step={r.rate_type === "day_rate" ? 1 : 0.5}
                      value={r.rate_type === "day_rate" ? r.planned_days : r.planned_months}
                      onChange={e => {
                        const v = e.target.value === "" ? "" : Number(e.target.value);
                        update(r.id, r.rate_type === "day_rate" ? { planned_days: v } : { planned_months: v });
                      }}
                      readOnly={readOnly}
                      placeholder="0"
                      className="w-full border-0 bg-transparent px-2 py-1.5 text-sm text-right font-medium text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400 rounded"
                    />
                    <div className="px-2 text-[10px] text-gray-400 text-right">
                      {r.rate_type === "day_rate" ? "days" : "months"}
                    </div>
                  </td>

                  {/* Calculated total */}
                  <td className="border-b border-gray-100 px-3 py-1">
                    <div className={`text-sm font-bold tabular-nums ${total > 0 ? "text-gray-800" : "text-gray-300"}`}>
                      {total > 0 ? fmt(total, sym) : "—"}
                    </div>
                    {total > 0 && <div className="text-[10px] text-gray-400">calculated</div>}
                  </td>

                  {/* Start month */}
                  <td className="border-b border-gray-100 min-w-[110px] px-2 py-1">
                    <input
                      type="month"
                      value={r.start_month ?? ""}
                      onChange={e => update(r.id, { start_month: e.target.value || undefined })}
                      readOnly={readOnly}
                      className="w-full border border-gray-200 bg-white text-xs rounded-lg px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                    <div className="text-[9px] text-gray-400 px-1 mt-0.5">optional</div>
                  </td>

                  {/* Links to cost line */}
                  <td className="border-b border-gray-100 min-w-[160px] px-2 py-1">
                    <select
                      value={r.cost_line_id ?? ""}
                      onChange={e => update(r.id, { cost_line_id: e.target.value || null })}
                      disabled={readOnly}
                      className="w-full border border-gray-200 bg-white text-xs rounded-lg px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400 cursor-pointer"
                    >
                      <option value="">— not linked —</option>
                      {costLines.map(l => (
                        <option key={l.id} value={l.id}>{l.description || l.category}</option>
                      ))}
                    </select>
                    {linkedLine && (
                      <div className="flex items-center gap-1 mt-1 px-1">
                        <Link2 className="w-2.5 h-2.5 text-emerald-500 flex-shrink-0" />
                        <span className="text-[10px] text-emerald-600 font-medium truncate max-w-[120px]">
                          {linkedLine.override ? "Override active" : "Auto-updating"}
                        </span>
                      </div>
                    )}
                  </td>

                  {/* Notes */}
                  <td className="border-b border-gray-100 min-w-[140px]">
                    <input
                      type="text" value={r.notes}
                      onChange={e => update(r.id, { notes: e.target.value })}
                      readOnly={readOnly}
                      placeholder="Notes…"
                      className="w-full border-0 bg-transparent px-2 py-1.5 text-sm text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-400 rounded"
                    />
                  </td>

                  {/* Delete */}
                  <td className="border-b border-gray-100 px-2">
                    {!readOnly && (
                      <button
                        onClick={() => onChange(resources.filter(x => x.id !== r.id))}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-400 hover:text-red-500 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {resources.length > 0 && (
            <tfoot>
              <tr className="bg-gray-100 font-semibold text-xs text-gray-700">
                <td colSpan={5} className="px-3 py-2">Total</td>
                <td className="px-3 py-2 font-bold text-gray-800">{fmt(totalCost, sym)}</td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          )}
        </table>

        {!readOnly && (
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-200">
            <button
              onClick={() => onChange([...resources, emptyResource()])}
              className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors"
            >
              <Plus className="w-4 h-4" /> Add resource
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
  raidItems?: Array<{ type: string; title: string; severity: string; status: string }>;
  approvalDelays?: Array<{ title: string; daysPending: number; cost_impact?: number }>;
};

export default function FinancialPlanEditor({
  content, onChange, readOnly = false, organisationId, raidItems, approvalDelays,
}: Props) {
  const [activeTab, setActiveTab] = useState<"budget" | "resources" | "monthly" | "changes" | "narrative">("budget");
  const [signals, setSignals]     = useState<Signal[]>([]);
  const saveTimer                 = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const sym       = CURRENCY_SYMBOLS[content.currency] ?? "£";
  const lines     = content.cost_lines ?? [];
  const resources = content.resources  ?? [];

  const resourceTotalsByLine = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of resources) {
      if (!r.cost_line_id) continue;
      const t = resourceTotal(r);
      if (t > 0) map[r.cost_line_id] = (map[r.cost_line_id] ?? 0) + t;
    }
    return map;
  }, [resources]);

  const handleChange = useCallback((patch: FinancialPlanContent) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      onChange({ ...patch, last_updated_at: new Date().toISOString() });
    }, 500);
    onChange(patch);
  }, [onChange]);

  const updateField = useCallback(<K extends keyof FinancialPlanContent>(
    key: K, val: FinancialPlanContent[K]
  ) => {
    handleChange({ ...content, [key]: val });
  }, [content, handleChange]);

  const handleResourcesChange = useCallback((newResources: Resource[]) => {
    const newLines = rollupResourcesToLines(lines, newResources);
    handleChange({ ...content, resources: newResources, cost_lines: newLines });
  }, [content, lines, handleChange]);

  const updateLine = useCallback((id: string, patch: Partial<CostLine>) => {
    handleChange({
      ...content,
      cost_lines: content.cost_lines.map(l => l.id === id ? { ...l, ...patch } : l),
    });
  }, [content, handleChange]);

  const toggleLineOverride = useCallback((id: string) => {
    const line = lines.find(l => l.id === id);
    if (!line) return;
    const newOverride = !line.override;
    let newLines = lines.map(l => l.id === id ? { ...l, override: newOverride } : l);
    if (!newOverride) newLines = rollupResourcesToLines(newLines, resources);
    handleChange({ ...content, cost_lines: newLines });
  }, [content, lines, resources, handleChange]);

  const addLine = useCallback(() => {
    handleChange({ ...content, cost_lines: [...content.cost_lines, emptyCostLine()] });
  }, [content, handleChange]);

  const removeLine = useCallback((id: string) => {
    const newResources = resources.map(r => r.cost_line_id === id ? { ...r, cost_line_id: null } : r);
    handleChange({
      ...content,
      cost_lines: content.cost_lines.filter(l => l.id !== id),
      resources:  newResources,
    });
  }, [content, resources, handleChange]);

  const updateCE = useCallback((id: string, patch: Partial<ChangeExposure>) => {
    handleChange({
      ...content,
      change_exposure: content.change_exposure.map(c => c.id === id ? { ...c, ...patch } : c),
    });
  }, [content, handleChange]);

  const addCE    = useCallback(() => {
    handleChange({ ...content, change_exposure: [...content.change_exposure, emptyChangeExposure()] });
  }, [content, handleChange]);

  const removeCE = useCallback((id: string) => {
    handleChange({ ...content, change_exposure: content.change_exposure.filter(c => c.id !== id) });
  }, [content, handleChange]);

  // Totals
  const totalBudgeted    = sumField(lines, "budgeted");
  const totalActual      = sumField(lines, "actual");
  const totalForecast    = sumField(lines, "forecast");
  const approvedBudget   = Number(content.total_approved_budget) || 0;
  const forecastVariance = approvedBudget ? totalForecast - approvedBudget : null;
  const pendingExposure  = content.change_exposure.filter(c => c.status === "pending").reduce((s, c) => s + (Number(c.cost_impact) || 0), 0);
  const approvedExposure = content.change_exposure.filter(c => c.status === "approved").reduce((s, c) => s + (Number(c.cost_impact) || 0), 0);
  const utilPct          = approvedBudget ? Math.round((totalForecast / approvedBudget) * 100) : null;
  const overBudget       = forecastVariance !== null && forecastVariance > 0;
  const totalResourceCost = resources.reduce((s, r) => s + resourceTotal(r), 0);

  const fyConfig:    FYConfig    = content.fy_config    ?? { fy_start_month: 4, fy_start_year: new Date().getFullYear(), num_months: 12 };
  const monthlyData: MonthlyData = content.monthly_data ?? {};

  useEffect(() => {
    const sigs = analyseFinancialPlan(content, monthlyData, fyConfig, { lastUpdatedAt: content.last_updated_at });
    setSignals(sigs);
  }, [content, monthlyData, fyConfig]);

  const criticalCount = signals.filter(s => s.severity === "critical").length;
  const warningCount  = signals.filter(s => s.severity === "warning").length;

  const tabs = [
    { id: "budget"    as const, label: "Cost Breakdown" },
    { id: "resources" as const, label: `Resources${resources.length > 0 ? ` (${resources.length})` : ""}` },
    {
      id: "monthly" as const,
      label: "Monthly Phasing",
      badge: criticalCount > 0
        ? { count: criticalCount, color: "bg-red-500" }
        : warningCount > 0
        ? { count: warningCount, color: "bg-amber-500" }
        : null,
    },
    { id: "changes"   as const, label: `Change Exposure${content.change_exposure.length > 0 ? ` (${content.change_exposure.length})` : ""}` },
    { id: "narrative" as const, label: "Narrative & Assumptions" },
  ];

  return (
    <div className="flex flex-col gap-4">

      {/* ── Header controls ── */}
      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Currency</label>
          <select
            value={content.currency}
            onChange={e => updateField("currency", e.target.value as Currency)}
            disabled={readOnly}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-semibold text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {CURRENCIES.map(c => <option key={c} value={c}>{c} ({CURRENCY_SYMBOLS[c]})</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Total Approved Budget</label>
          <div className="flex items-center gap-1 border border-gray-200 rounded-lg px-3 py-1.5 bg-white">
            <span className="text-sm font-bold text-gray-500">{sym}</span>
            <input
              type="number" min={0} step={1000}
              value={content.total_approved_budget}
              onChange={e => updateField("total_approved_budget", e.target.value === "" ? "" : Number(e.target.value))}
              readOnly={readOnly}
              placeholder="0"
              className="w-36 border-0 bg-transparent text-sm font-semibold text-gray-800 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Budgeted",         value: fmt(totalBudgeted, sym),   sub: "across all cost lines",                                                    color: "text-gray-700"   },
          { label: "Actual Spent",     value: fmt(totalActual, sym),     sub: approvedBudget ? `${Math.round((totalActual / approvedBudget) * 100)}% of budget` : "", color: "text-blue-600"   },
          { label: "Total Forecast",   value: fmt(totalForecast, sym),   sub: utilPct !== null ? `${utilPct}% of approved` : "",                           color: overBudget ? "text-red-600" : "text-emerald-600" },
          { label: "Pending Exposure", value: fmt(pendingExposure, sym), sub: "from change requests",                                                      color: pendingExposure > 0 ? "text-amber-600" : "text-gray-400" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
            <div className="text-xs text-gray-500 mb-1">{s.label}</div>
            <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
            {s.sub && <div className="text-xs text-gray-400 mt-0.5">{s.sub}</div>}
          </div>
        ))}
      </div>

      {/* Resource cost callout */}
      {totalResourceCost > 0 && approvedBudget > 0 && (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm border ${
          totalResourceCost > approvedBudget
            ? "bg-red-50 border-red-200 text-red-700"
            : "bg-blue-50 border-blue-200 text-blue-700"
        }`}>
          <Users className="w-4 h-4 flex-shrink-0" />
          <span>
            Resource costs total <strong>{fmt(totalResourceCost, sym)}</strong>
            {" "}({Math.round((totalResourceCost / approvedBudget) * 100)}% of approved budget).
            {totalResourceCost > approvedBudget && " ⚠ Exceeds approved budget."}
          </span>
        </div>
      )}

      {overBudget && forecastVariance !== null && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>Forecast exceeds approved budget by <strong>{fmt(forecastVariance, sym)}</strong>.</span>
        </div>
      )}

      {/* ── Plan Summary ── */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Plan Summary</label>
        <textarea
          value={content.summary}
          onChange={e => updateField("summary", e.target.value)}
          readOnly={readOnly}
          rows={2}
          placeholder="Brief overview of financial position and key spend areas..."
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.id === "monthly"   && <Calendar className="w-3.5 h-3.5" />}
            {tab.id === "resources" && <Users className="w-3.5 h-3.5" />}
            {tab.label}
            {tab.id === "monthly" && (tab as any).badge && (
              <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-xs font-bold ${(tab as any).badge.color}`}>
                {(tab as any).badge.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Cost Breakdown ── */}
      {activeTab === "budget" && (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {["Category", "Description", `Budgeted (${sym})`, `Actual (${sym})`, `Forecast (${sym})`, "Variance", "Resources", "Notes", ""].map((h, i) => (
                  <th key={i} className="px-3 py-2.5 text-left border-b border-gray-200 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-400">
                    No cost lines yet. Click <strong>Add line</strong> below.
                  </td>
                </tr>
              )}
              {lines.map((l, idx) => {
                const resTotal     = resourceTotalsByLine[l.id] ?? 0;
                const hasResources = resTotal > 0;
                return (
                  <tr key={l.id} className={`${idx % 2 === 0 ? "bg-white" : "bg-gray-50/50"} hover:bg-blue-50/20 group transition-colors`}>
                    <td className="border-b border-gray-100 min-w-[140px] px-2 py-1">
                      <select
                        value={l.category}
                        onChange={e => updateLine(l.id, { category: e.target.value as CostCategory })}
                        disabled={readOnly}
                        className="w-full border-0 bg-transparent text-xs font-medium focus:outline-none focus:ring-1 focus:ring-blue-400 rounded cursor-pointer"
                      >
                        {(Object.keys(CATEGORY_LABELS) as CostCategory[]).map(c => (
                          <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="border-b border-gray-100 min-w-[160px]">
                      <input
                        type="text" value={l.description}
                        onChange={e => updateLine(l.id, { description: e.target.value })}
                        readOnly={readOnly}
                        placeholder="Description..."
                        className="w-full border-0 bg-transparent px-2 py-1.5 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-400 rounded"
                      />
                    </td>
                    <td className={`border-b border-gray-100 ${hasResources && !l.override ? "bg-blue-50/40" : ""}`}>
                      <MoneyCell value={l.budgeted} onChange={v => updateLine(l.id, { budgeted: v })} symbol={sym} readOnly={readOnly || (hasResources && !l.override)} />
                    </td>
                    <td className="border-b border-gray-100">
                      <MoneyCell value={l.actual} onChange={v => updateLine(l.id, { actual: v })} symbol={sym} readOnly={readOnly} />
                    </td>
                    <td className={`border-b border-gray-100 ${hasResources && !l.override ? "bg-blue-50/40" : ""}`}>
                      <MoneyCell value={l.forecast} onChange={v => updateLine(l.id, { forecast: v })} symbol={sym} readOnly={readOnly || (hasResources && !l.override)} />
                    </td>
                    <td className="border-b border-gray-100 px-3">
                      <VarianceBadge budget={l.budgeted} forecast={l.forecast} />
                    </td>
                    <td className="border-b border-gray-100 px-2 min-w-[130px]">
                      {!readOnly && (
                        <OverrideToggle
                          line={l}
                          hasLinkedResources={hasResources}
                          resTotal={resTotal}
                          sym={sym}
                          onToggle={() => toggleLineOverride(l.id)}
                        />
                      )}
                      {!hasResources && <span className="text-[10px] text-gray-300 px-1">no resources</span>}
                    </td>
                    <td className="border-b border-gray-100 min-w-[160px]">
                      <input
                        type="text" value={l.notes}
                        onChange={e => updateLine(l.id, { notes: e.target.value })}
                        readOnly={readOnly}
                        placeholder="Notes..."
                        className="w-full border-0 bg-transparent px-2 py-1.5 text-sm text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-400 rounded"
                      />
                    </td>
                    <td className="border-b border-gray-100 px-2">
                      {!readOnly && (
                        <button onClick={() => removeLine(l.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-400 hover:text-red-500 transition-all">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {lines.length > 0 && (
              <tfoot>
                <tr className="bg-gray-100 font-semibold text-xs text-gray-700">
                  <td colSpan={2} className="px-3 py-2">Total</td>
                  <td className="px-3 py-2">{fmt(totalBudgeted, sym)}</td>
                  <td className="px-3 py-2">{fmt(totalActual, sym)}</td>
                  <td className="px-3 py-2">{fmt(totalForecast, sym)}</td>
                  <td className="px-3 py-2"><VarianceBadge budget={totalBudgeted} forecast={totalForecast} /></td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
          {!readOnly && (
            <div className="px-4 py-2 bg-gray-50 border-t border-gray-200">
              <button onClick={addLine} className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors">
                <Plus className="w-4 h-4" /> Add line
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Resources ── */}
      {activeTab === "resources" && (
        <ResourcesTab
          resources={resources}
          costLines={lines}
          sym={sym}
          currency={content.currency}
          readOnly={readOnly}
          onChange={handleResourcesChange}
          organisationId={organisationId}
          monthlyData={monthlyData}
          fyConfig={fyConfig}
          onSyncMonthly={d => updateField("monthly_data", d)}
        />
      )}

      {/* ── Monthly Phasing ── */}
      {activeTab === "monthly" && (
        <div className="flex flex-col gap-4">
          <FinancialIntelligencePanel
            content={content}
            monthlyData={monthlyData}
            fyConfig={fyConfig}
            lastUpdatedAt={content.last_updated_at}
            raidItems={raidItems}
            approvalDelays={approvalDelays}
            onSignalsChange={setSignals}
          />
          <FinancialPlanMonthlyView
            content={content}
            monthlyData={monthlyData}
            onMonthlyDataChange={d => updateField("monthly_data", d)}
            fyConfig={fyConfig}
            onFyConfigChange={c => updateField("fy_config", c)}
            signals={signals}
            readOnly={readOnly}
          />
        </div>
      )}

      {/* ── Change Exposure ── */}
      {activeTab === "changes" && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-3 text-sm">
            {[
              { label: "Approved Exposure", value: fmt(approvedExposure, sym),                   color: "text-blue-600"   },
              { label: "Pending Exposure",  value: fmt(pendingExposure, sym),                    color: pendingExposure > 0 ? "text-amber-600" : "text-gray-400" },
              { label: "Total Exposure",    value: fmt(approvedExposure + pendingExposure, sym),  color: "text-gray-700"   },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
                <div className="text-xs text-gray-500">{s.label}</div>
                <div className={`text-base font-bold ${s.color}`}>{s.value}</div>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {["Change Ref", "Title", `Cost Impact (${sym})`, "Status", "Notes", ""].map((h, i) => (
                    <th key={i} className="px-3 py-2.5 text-left border-b border-gray-200">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {content.change_exposure.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">No change exposure logged yet.</td>
                  </tr>
                )}
                {content.change_exposure.map((c, idx) => (
                  <tr key={c.id} className={`${idx % 2 === 0 ? "bg-white" : "bg-gray-50/50"} group hover:bg-amber-50/20 transition-colors`}>
                    <td className="border-b border-gray-100">
                      <input type="text" value={c.change_ref} onChange={e => updateCE(c.id, { change_ref: e.target.value })} readOnly={readOnly}
                        placeholder="CR-001" className="w-full border-0 bg-transparent px-2 py-1.5 text-sm font-mono text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400 rounded" />
                    </td>
                    <td className="border-b border-gray-100 min-w-[180px]">
                      <input type="text" value={c.title} onChange={e => updateCE(c.id, { title: e.target.value })} readOnly={readOnly}
                        placeholder="Change title..." className="w-full border-0 bg-transparent px-2 py-1.5 text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400 rounded" />
                    </td>
                    <td className="border-b border-gray-100">
                      <MoneyCell value={c.cost_impact} onChange={v => updateCE(c.id, { cost_impact: v })} symbol={sym} readOnly={readOnly} />
                    </td>
                    <td className="border-b border-gray-100 px-2">
                      <select value={c.status} onChange={e => updateCE(c.id, { status: e.target.value as ChangeExposure["status"] })} disabled={readOnly}
                        className={`text-xs font-semibold px-2 py-1 rounded-full border-0 cursor-pointer focus:outline-none ${c.status === "approved" ? "bg-green-100 text-green-700" : c.status === "pending" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"}`}>
                        <option value="approved">Approved</option>
                        <option value="pending">Pending</option>
                        <option value="rejected">Rejected</option>
                      </select>
                    </td>
                    <td className="border-b border-gray-100 min-w-[160px]">
                      <input type="text" value={c.notes} onChange={e => updateCE(c.id, { notes: e.target.value })} readOnly={readOnly}
                        placeholder="Notes..." className="w-full border-0 bg-transparent px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400 rounded" />
                    </td>
                    <td className="border-b border-gray-100 px-2">
                      {!readOnly && (
                        <button onClick={() => removeCE(c.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-400 hover:text-red-500 transition-all">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!readOnly && (
              <div className="px-4 py-2 bg-gray-50 border-t border-gray-200">
                <button onClick={addCE} className="flex items-center gap-1.5 text-sm text-amber-600 hover:text-amber-700 font-medium transition-colors">
                  <Plus className="w-4 h-4" /> Add change exposure
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Narrative ── */}
      {activeTab === "narrative" && (
        <div className="flex flex-col gap-4">
          {[
            { key: "variance_narrative" as const, label: "Variance Narrative",        placeholder: "Explain material variances between budget and forecast..." },
            { key: "assumptions"        as const, label: "Assumptions & Constraints", placeholder: "Key assumptions: rates, headcount, duration, exchange rate basis..." },
          ].map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</label>
              <textarea
                value={content[key]}
                onChange={e => updateField(key, e.target.value)}
                readOnly={readOnly}
                rows={4}
                placeholder={placeholder}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}