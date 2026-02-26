"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Plus, Trash2, TrendingUp, TrendingDown, AlertTriangle, Calendar, Sparkles } from "lucide-react";
import FinancialPlanMonthlyView, { type MonthlyData, type FYConfig } from "./FinancialPlanMonthlyView";
import FinancialIntelligencePanel from "./FinancialIntelligencePanel";
import { analyseFinancialPlan, type Signal } from "@/lib/financial-intelligence";

// ── Types ─────────────────────────────────────────────────────────────────────

export const CURRENCIES = ["GBP", "USD", "EUR", "AUD", "CAD"] as const;
export type Currency = typeof CURRENCIES[number];
export const CURRENCY_SYMBOLS: Record<Currency, string> = { GBP: "£", USD: "$", EUR: "€", AUD: "A$", CAD: "C$" };

export type CostCategory = "people" | "tools_licences" | "infrastructure" | "external_vendors" | "travel" | "contingency" | "other";
export const CATEGORY_LABELS: Record<CostCategory, string> = {
  people: "People & Contractors", tools_licences: "Tools & Licences",
  infrastructure: "Infrastructure", external_vendors: "External Vendors",
  travel: "Travel & Expenses", contingency: "Contingency", other: "Other",
};

export type CostLine = {
  id: string; category: CostCategory; description: string;
  budgeted: number | ""; actual: number | ""; forecast: number | ""; notes: string;
};

export type ChangeExposure = {
  id: string; change_ref: string; title: string;
  cost_impact: number | ""; status: "approved" | "pending" | "rejected"; notes: string;
};

export type FinancialPlanContent = {
  currency: Currency;
  total_approved_budget: number | "";
  summary: string;
  cost_lines: CostLine[];
  change_exposure: ChangeExposure[];
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
    currency, total_approved_budget: "", summary: "",
    cost_lines: [], change_exposure: [],
    variance_narrative: "", assumptions: "",
    monthly_data: {},
    fy_config: { fy_start_month: 4, fy_start_year: now.getFullYear(), num_months: 12 },
    last_updated_at: now.toISOString(),
  };
}

function emptyCostLine(): CostLine {
  return { id: uid(), category: "people", description: "", budgeted: "", actual: "", forecast: "", notes: "" };
}

function emptyChangeExposure(): ChangeExposure {
  return { id: uid(), change_ref: "", title: "", cost_impact: "", status: "pending", notes: "" };
}

function fmt(n: number | "" | null | undefined, sym: string): string {
  if (n === "" || n == null || isNaN(Number(n))) return "—";
  return `${sym}${Number(n).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

function sumField(lines: CostLine[], field: keyof CostLine): number {
  return lines.reduce((s, l) => s + (Number(l[field]) || 0), 0);
}

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

function MoneyCell({ value, onChange, symbol }: { value: number | ""; onChange: (v: number | "") => void; symbol: string }) {
  return (
    <div className="flex items-center gap-1 px-1">
      <span className="text-xs text-gray-400">{symbol}</span>
      <input type="number" min={0} step={1000} value={value}
        onChange={e => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        className="w-24 border-0 bg-transparent py-1.5 text-sm text-right font-medium text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400 rounded"
        placeholder="0" />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type Props = {
  content: FinancialPlanContent;
  onChange: (c: FinancialPlanContent) => void;
  readOnly?: boolean;
  raidItems?: Array<{ type: string; title: string; severity: string; status: string }>;
  approvalDelays?: Array<{ title: string; daysPending: number; cost_impact?: number }>;
};

export default function FinancialPlanEditor({ content, onChange, readOnly = false, raidItems, approvalDelays }: Props) {
  const [activeTab, setActiveTab] = useState<"budget" | "monthly" | "changes" | "narrative">("budget");
  const [signals, setSignals] = useState<Signal[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  const sym = CURRENCY_SYMBOLS[content.currency] ?? "£";
  const lines = content.cost_lines ?? [];

  const handleChange = useCallback((patch: FinancialPlanContent) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      onChange({ ...patch, last_updated_at: new Date().toISOString() });
    }, 500);
    onChange(patch);
  }, [onChange]);

  const updateField = useCallback(<K extends keyof FinancialPlanContent>(key: K, val: FinancialPlanContent[K]) => {
    handleChange({ ...content, [key]: val });
  }, [content, handleChange]);

  const updateLine = useCallback((id: string, patch: Partial<CostLine>) => {
    handleChange({ ...content, cost_lines: content.cost_lines.map(l => l.id === id ? { ...l, ...patch } : l) });
  }, [content, handleChange]);

  const addLine = useCallback(() => {
    handleChange({ ...content, cost_lines: [...content.cost_lines, emptyCostLine()] });
  }, [content, handleChange]);

  const removeLine = useCallback((id: string) => {
    handleChange({ ...content, cost_lines: content.cost_lines.filter(l => l.id !== id) });
  }, [content, handleChange]);

  const updateCE = useCallback((id: string, patch: Partial<ChangeExposure>) => {
    handleChange({ ...content, change_exposure: content.change_exposure.map(c => c.id === id ? { ...c, ...patch } : c) });
  }, [content, handleChange]);

  const addCE = useCallback(() => {
    handleChange({ ...content, change_exposure: [...content.change_exposure, emptyChangeExposure()] });
  }, [content, handleChange]);

  const removeCE = useCallback((id: string) => {
    handleChange({ ...content, change_exposure: content.change_exposure.filter(c => c.id !== id) });
  }, [content, handleChange]);

  const totalBudgeted = sumField(lines, "budgeted");
  const totalActual = sumField(lines, "actual");
  const totalForecast = sumField(lines, "forecast");
  const approvedBudget = Number(content.total_approved_budget) || 0;
  const forecastVariance = approvedBudget ? totalForecast - approvedBudget : null;
  const pendingExposure = content.change_exposure.filter(c => c.status === "pending").reduce((s, c) => s + (Number(c.cost_impact) || 0), 0);
  const approvedExposure = content.change_exposure.filter(c => c.status === "approved").reduce((s, c) => s + (Number(c.cost_impact) || 0), 0);
  const utilPct = approvedBudget ? Math.round((totalForecast / approvedBudget) * 100) : null;
  const overBudget = forecastVariance !== null && forecastVariance > 0;

  const fyConfig: FYConfig = content.fy_config ?? { fy_start_month: 4, fy_start_year: new Date().getFullYear(), num_months: 12 };
  const monthlyData: MonthlyData = content.monthly_data ?? {};

  useEffect(() => {
    const sigs = analyseFinancialPlan(content, monthlyData, fyConfig, { lastUpdatedAt: content.last_updated_at });
    setSignals(sigs);
  }, [content, monthlyData, fyConfig]);

  const criticalCount = signals.filter(s => s.severity === "critical").length;
  const warningCount = signals.filter(s => s.severity === "warning").length;

  const tabs = [
    { id: "budget" as const, label: "Cost Breakdown" },
    {
      id: "monthly" as const,
      label: "Monthly Phasing",
      badge: criticalCount > 0 ? { count: criticalCount, color: "bg-red-500" }
        : warningCount > 0 ? { count: warningCount, color: "bg-amber-500" }
        : null,
    },
    { id: "changes" as const, label: `Change Exposure${content.change_exposure.length > 0 ? ` (${content.change_exposure.length})` : ""}` },
    { id: "narrative" as const, label: "Narrative & Assumptions" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Currency</label>
          <select value={content.currency} onChange={e => updateField("currency", e.target.value as Currency)} disabled={readOnly}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-semibold text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {CURRENCIES.map(c => <option key={c} value={c}>{c} ({CURRENCY_SYMBOLS[c]})</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Total Approved Budget</label>
          <div className="flex items-center gap-1 border border-gray-200 rounded-lg px-3 py-1.5 bg-white">
            <span className="text-sm font-bold text-gray-500">{sym}</span>
            <input type="number" min={0} step={1000} value={content.total_approved_budget}
              onChange={e => updateField("total_approved_budget", e.target.value === "" ? "" : Number(e.target.value))}
              readOnly={readOnly} placeholder="0"
              className="w-36 border-0 bg-transparent text-sm font-semibold text-gray-800 focus:outline-none" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Budgeted", value: fmt(totalBudgeted, sym), sub: "across all lines", color: "text-gray-700" },
          { label: "Actual Spent", value: fmt(totalActual, sym), sub: approvedBudget ? `${Math.round((totalActual / approvedBudget) * 100)}% of budget` : "", color: "text-blue-600" },
          { label: "Total Forecast", value: fmt(totalForecast, sym), sub: utilPct !== null ? `${utilPct}% of approved` : "", color: overBudget ? "text-red-600" : "text-emerald-600" },
          { label: "Pending Exposure", value: fmt(pendingExposure, sym), sub: "from change requests", color: pendingExposure > 0 ? "text-amber-600" : "text-gray-400" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
            <div className="text-xs text-gray-500 mb-1">{s.label}</div>
            <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
            {s.sub && <div className="text-xs text-gray-400 mt-0.5">{s.sub}</div>}
          </div>
        ))}
      </div>

      {overBudget && forecastVariance !== null && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>Forecast exceeds approved budget by <strong>{fmt(forecastVariance, sym)}</strong>.</span>
        </div>
      )}

      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Plan Summary</label>
        <textarea value={content.summary} onChange={e => updateField("summary", e.target.value)} readOnly={readOnly} rows={2}
          placeholder="Brief overview of financial position and key spend areas..."
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.id ? "border-blue-500 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {tab.id === "monthly" && <Calendar className="w-3.5 h-3.5" />}
            {tab.label}
            {tab.id === "monthly" && tab.badge && (
              <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-xs font-bold ${tab.badge.color}`}>
                {tab.badge.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === "budget" && (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {["Category", "Description", `Budgeted (${sym})`, `Actual (${sym})`, `Forecast (${sym})`, "Variance", "Notes", ""].map((h, i) => (
                  <th key={i} className="px-3 py-2.5 text-left border-b border-gray-200 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">No cost lines yet. Click <strong>Add line</strong> below.</td></tr>
              )}
              {lines.map((l, idx) => (
                <tr key={l.id} className={`${idx % 2 === 0 ? "bg-white" : "bg-gray-50/50"} hover:bg-blue-50/20 group transition-colors`}>
                  <td className="border-b border-gray-100 min-w-[140px] px-2 py-1">
                    <select value={l.category} onChange={e => updateLine(l.id, { category: e.target.value as CostCategory })} disabled={readOnly}
                      className="w-full border-0 bg-transparent text-xs font-medium focus:outline-none focus:ring-1 focus:ring-blue-400 rounded cursor-pointer">
                      {(Object.keys(CATEGORY_LABELS) as CostCategory[]).map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                    </select>
                  </td>
                  <td className="border-b border-gray-100 min-w-[160px]">
                    <input type="text" value={l.description} onChange={e => updateLine(l.id, { description: e.target.value })} readOnly={readOnly}
                      placeholder="Description..." className="w-full border-0 bg-transparent px-2 py-1.5 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-400 rounded" />
                  </td>
                  <td className="border-b border-gray-100"><MoneyCell value={l.budgeted} onChange={v => updateLine(l.id, { budgeted: v })} symbol={sym} /></td>
                  <td className="border-b border-gray-100"><MoneyCell value={l.actual} onChange={v => updateLine(l.id, { actual: v })} symbol={sym} /></td>
                  <td className="border-b border-gray-100"><MoneyCell value={l.forecast} onChange={v => updateLine(l.id, { forecast: v })} symbol={sym} /></td>
                  <td className="border-b border-gray-100 px-3"><VarianceBadge budget={l.budgeted} forecast={l.forecast} /></td>
                  <td className="border-b border-gray-100 min-w-[160px]">
                    <input type="text" value={l.notes} onChange={e => updateLine(l.id, { notes: e.target.value })} readOnly={readOnly}
                      placeholder="Notes..." className="w-full border-0 bg-transparent px-2 py-1.5 text-sm text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-400 rounded" />
                  </td>
                  <td className="border-b border-gray-100 px-2">
                    {!readOnly && (
                      <button onClick={() => removeLine(l.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-400 hover:text-red-500 transition-all">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            {lines.length > 0 && (
              <tfoot>
                <tr className="bg-gray-100 font-semibold text-xs text-gray-700">
                  <td colSpan={2} className="px-3 py-2">Total</td>
                  <td className="px-3 py-2">{fmt(totalBudgeted, sym)}</td>
                  <td className="px-3 py-2">{fmt(totalActual, sym)}</td>
                  <td className="px-3 py-2">{fmt(totalForecast, sym)}</td>
                  <td className="px-3 py-2"><VarianceBadge budget={totalBudgeted} forecast={totalForecast} /></td>
                  <td colSpan={2} />
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

      {activeTab === "changes" && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-3 text-sm">
            {[
              { label: "Approved Exposure", value: fmt(approvedExposure, sym), color: "text-blue-600" },
              { label: "Pending Exposure", value: fmt(pendingExposure, sym), color: pendingExposure > 0 ? "text-amber-600" : "text-gray-400" },
              { label: "Total Exposure", value: fmt(approvedExposure + pendingExposure, sym), color: "text-gray-700" },
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
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">No change exposure logged yet.</td></tr>
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
                    <td className="border-b border-gray-100"><MoneyCell value={c.cost_impact} onChange={v => updateCE(c.id, { cost_impact: v })} symbol={sym} /></td>
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

      {activeTab === "narrative" && (
        <div className="flex flex-col gap-4">
          {[
            { key: "variance_narrative" as const, label: "Variance Narrative", placeholder: "Explain material variances between budget and forecast..." },
            { key: "assumptions" as const, label: "Assumptions & Constraints", placeholder: "Key assumptions: rates, headcount, duration, exchange rate basis..." },
          ].map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</label>
              <textarea value={content[key]} onChange={e => updateField(key, e.target.value)} readOnly={readOnly} rows={4}
                placeholder={placeholder}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
