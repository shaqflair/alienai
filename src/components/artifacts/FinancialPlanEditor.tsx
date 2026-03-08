"use client";

import React, { useState, useCallback, useMemo } from "react";
import {
  Plus, Trash2, TrendingUp, TrendingDown, AlertTriangle,
  Calendar, Users, Link2, Link2Off, Zap, ChevronRight,
  Check, AlertCircle, Lock, Clock, X
} from "lucide-react";
import FinancialPlanMonthlyView, { type MonthlyData, type FYConfig } from "./FinancialPlanMonthlyView";
import ResourcePicker, { type PickedPerson } from "./ResourcePicker";
import { syncResourcesToMonthlyData, previewSync } from "./syncResourcesToMonthlyData";
import {
  computeActuals,
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
  mono:     "'DM Mono', 'Courier New', monospace",
  sans:     "'DM Sans', system-ui, sans-serif",
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────
export const CURRENCIES = ["GBP", "USD", "EUR", "AUD", "CAD"] as const;
export type Currency = typeof CURRENCIES[number];
export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  GBP: "£", USD: "$", EUR: "€", AUD: "A$", CAD: "C$",
};

export type CostCategory = "people" | "tools_licences" | "infrastructure" | "external_vendors" | "travel" | "contingency" | "other";

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

export type ResourceRateType = "day_rate" | "monthly_cost";
export type ResourceType = "internal" | "contractor" | "vendor" | "consultant";

export type Resource = {
  id: string;
  user_id?: string;
  name: string;
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10); }

function resourceTotal(r: Resource): number {
  if (r.rate_type === "day_rate") return (Number(r.day_rate) || 0) * (Number(r.planned_days) || 0);
  return (Number(r.monthly_cost) || 0) * (Number(r.planned_months) || 0);
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

// ── Sub-components ────────────────────────────────────────────────────────────

function ResourceSyncBar({ resources, costLines, monthlyData, fyConfig, currency, timesheetEntries, onSync }: any) {
  const [expanded, setExpanded] = useState(false);
  const [synced, setSynced] = useState(false);
  const sym = CURRENCY_SYMBOLS[currency as Currency] ?? "£";
  const preview = previewSync(resources, costLines, monthlyData, fyConfig);

  const hasChanges = preview.length > 0;

  const handleSync = () => {
    const newData = syncResourcesToMonthlyData(resources, costLines, monthlyData, fyConfig);
    onSync(newData);
    setSynced(true);
    setTimeout(() => setSynced(false), 3000);
    setExpanded(false);
  };

  return (
    <div style={{ border: `1px solid ${synced ? "#A0D0B8" : hasChanges ? "#A0BAD0" : P.border}`, background: synced ? P.greenLt : hasChanges ? P.navyLt : P.bg, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Zap style={{ width: 14, height: 14, color: synced ? P.green : hasChanges ? P.navy : P.textSm }} />
          <div>
            <div style={{ fontFamily: P.mono, fontSize: 10, fontWeight: 700, color: synced ? P.green : hasChanges ? P.navy : P.textMd }}>
              {synced ? "Monthly phasing synced — actuals from approved timesheets" : hasChanges ? "Resource changes detected: sync to monthly phasing" : "Monthly phasing is up to date"}
            </div>
          </div>
        </div>
        {hasChanges && !synced && (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setExpanded(!expanded)} style={{ background: "none", border: "none", color: P.navy, cursor: "pointer", fontSize: 10, fontFamily: P.mono }}>
              Preview {expanded ? "▲" : "▼"}
            </button>
            <button onClick={handleSync} style={{ background: P.navy, color: "white", padding: "6px 14px", border: "none", cursor: "pointer", fontSize: 10, fontFamily: P.mono, fontWeight: 700 }}>
              SYNC TO MONTHLY
            </button>
          </div>
        )}
        {synced && <span style={{ fontFamily: P.mono, fontSize: 10, color: P.green, fontWeight: 600 }}><Check size={12} /> Synced</span>}
      </div>
      {expanded && hasChanges && (
        <div style={{ borderTop: `1px solid ${P.border}`, background: "white", padding: "8px" }}>
          {preview.map((row: any) => (
            <div key={row.lineId} style={{ display: "flex", justifyContent: "space-between", padding: "4px 16px", fontSize: 10, fontFamily: P.mono }}>
              <span>{row.lineLabel}</span>
              <span style={{ color: P.textSm }}>{fmtShort(row.totalBefore, sym)} → <strong style={{ color: P.text }}>{fmtShort(row.totalAfter, sym)}</strong></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Resources Tab ────────────────────────────────────────────────────────

export default function ResourcesTab({
  resources, costLines, currency, readOnly, onChange, organisationId,
  monthlyData, fyConfig, timesheetEntries, onSyncMonthly,
}: any) {
  const sym = CURRENCY_SYMBOLS[currency as Currency] ?? "£";

  // Functional update helper to prevent state race conditions during async fetches
  const updateResource = useCallback((id: string, patch: Partial<Resource>) => {
    onChange((prev: Resource[]) => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  }, [onChange]);

  const addResource = () => {
    const nr: Resource = {
      id: uid(), name: "", type: "internal", rate_type: "day_rate",
      day_rate: "", planned_days: "", monthly_cost: "", planned_months: "",
      cost_line_id: null, notes: ""
    };
    onChange([...resources, nr]);
  };

  const removeResource = (id: string) => {
    onChange(resources.filter((r: Resource) => r.id !== id));
  };

  const approvedDaysByResource = useMemo(() => {
    const map: Record<string, number> = {};
    timesheetEntries?.forEach((e: TimesheetEntry) => {
      map[e.resource_id] = (map[e.resource_id] ?? 0) + e.approved_days;
    });
    return map;
  }, [timesheetEntries]);

  // Summaries for stat cards
  const totalPlanned = resources.reduce((s: number, r: Resource) => s + resourceTotal(r), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, fontFamily: P.sans }}>
      
      {/* Stat Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <div style={{ background: P.surface, border: `1px solid ${P.border}`, padding: "12px 16px" }}>
          <div style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm, textTransform: "uppercase", marginBottom: 4 }}>Total Resource Budget</div>
          <div style={{ fontFamily: P.mono, fontSize: 16, fontWeight: 700, color: P.navy }}>{fmt(totalPlanned, sym)}</div>
        </div>
        <div style={{ background: P.violetLt, border: `1px solid #C0B0E0`, padding: "12px 16px" }}>
          <div style={{ fontFamily: P.mono, fontSize: 9, color: P.violet, textTransform: "uppercase", marginBottom: 4 }}>Total Actuals (Approved)</div>
          <div style={{ fontFamily: P.mono, fontSize: 16, fontWeight: 700, color: P.violet }}>
            {fmt(resources.reduce((s: number, r: Resource) => {
               const days = approvedDaysByResource[r.id] ?? 0;
               const rate = r.rate_type === "day_rate" ? (Number(r.day_rate) || 0) : (Number(r.monthly_cost) || 0) / 20;
               return s + (days * rate);
            }, 0), sym)}
          </div>
        </div>
      </div>

      {!readOnly && (
        <ResourceSyncBar 
          resources={resources} costLines={costLines} monthlyData={monthlyData} 
          fyConfig={fyConfig} currency={currency} timesheetEntries={timesheetEntries} 
          onSync={onSyncMonthly} 
        />
      )}

      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, border: `1px solid #C0B0E0`, background: P.violetLt, padding: "8px 12px", fontSize: 11, color: P.violet }}>
        <Lock size={12} style={{ marginTop: 1 }} />
        <span><strong>People actuals are locked</strong> — computed from approved timesheet days × rate card rate. Unlinked costs or non-people lines are managed in the Breakdown tab.</span>
      </div>

      <div style={{ border: `1px solid ${P.borderMd}`, background: P.surface, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#F4F4F2", borderBottom: `1px solid ${P.borderMd}` }}>
              {["Person / Role", "Type", "Rate Method", "Rate", "Planned Qty", "Total", "Approved Days", "Actual Cost", "Links to", ""].map((h) => (
                <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontFamily: P.mono, fontSize: 8, fontWeight: 600, color: h.includes("Actual") ? P.violet : P.textSm, textTransform: "uppercase", whiteSpace: "nowrap" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {resources.length === 0 && (
              <tr><td colSpan={10} style={{ padding: "30px", textAlign: "center", color: P.textSm }}>No resources added yet.</td></tr>
            )}
            {resources.map((r: Resource, idx: number) => {
              const total = resourceTotal(r);
              const approvedDays = approvedDaysByResource[r.id] ?? 0;
              const effectiveRate = r.rate_type === "day_rate" ? (Number(r.day_rate) || 0) : (Number(r.monthly_cost) || 0) / 20;
              const actualCost = Math.round(approvedDays * effectiveRate);

              return (
                <tr key={r.id} style={{ borderBottom: `1px solid ${P.border}`, background: idx % 2 === 0 ? "white" : "#FAFAF8" }}>
                  <td style={{ padding: "4px 8px", width: 220 }}>
                    <ResourcePicker
                      organisationId={organisationId}
                      value={r.user_id ?? null}
                      disabled={readOnly}
                      onPick={async (person: PickedPerson) => {
                        // Immediate patch for the name
                        const basePatch = {
                          user_id: person.user_id || undefined,
                          name: person.full_name || person.name || person.email || r.name
                        };
                        updateResource(r.id, basePatch);

                        // Async fetch for rate card
                        if (person.user_id && organisationId) {
                          try {
                            const res = await fetch(`/api/org/rate-card?orgId=${encodeURIComponent(organisationId)}&userId=${encodeURIComponent(person.user_id)}`);
                            const d = await res.json();
                            if (d.ok && d.match) {
                              updateResource(r.id, {
                                rate_type: d.match.rate_type,
                                day_rate: d.match.rate_type === "day_rate" ? d.match.rate : r.day_rate,
                                monthly_cost: d.match.rate_type === "monthly_cost" ? d.match.rate : r.monthly_cost,
                                type: d.match.resource_type
                              });
                            }
                          } catch (e) { console.error("Rate lookup failed", e); }
                        }
                      }}
                    />
                    <input 
                      type="text" value={r.name} 
                      onChange={e => updateResource(r.id, { name: e.target.value })}
                      placeholder="Role name..."
                      style={{ width: "100%", border: "none", background: "transparent", fontSize: 10, padding: "2px 6px", color: P.textMd, outline: "none" }}
                    />
                  </td>
                  <td>
                    <select 
                      value={r.type} 
                      onChange={e => updateResource(r.id, { type: e.target.value as ResourceType })}
                      style={{ fontSize: 10, fontFamily: P.mono, background: P.bg, border: "none", padding: "4px" }}
                    >
                      <option value="internal">Internal</option>
                      <option value="contractor">Contractor</option>
                      <option value="vendor">Vendor</option>
                      <option value="consultant">Consultant</option>
                    </select>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 2, background: "#EDEDEB", padding: 2 }}>
                      {["day_rate", "monthly_cost"].map((m) => (
                        <button
                          key={m}
                          onClick={() => updateResource(r.id, { rate_type: m as any })}
                          style={{
                            fontSize: 8, padding: "4px 6px", border: "none", cursor: "pointer", fontFamily: P.mono, fontWeight: 700,
                            background: r.rate_type === m ? "white" : "transparent",
                            color: r.rate_type === m ? P.text : P.textSm
                          }}
                        >
                          {m === "day_rate" ? "DAY" : "MONTH"}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td>
                    <input
                      type="number"
                      value={r.rate_type === "day_rate" ? r.day_rate : r.monthly_cost}
                      onChange={e => updateResource(r.id, r.rate_type === "day_rate" ? { day_rate: Number(e.target.value) || "" } : { monthly_cost: Number(e.target.value) || "" })}
                      style={{ width: 80, textAlign: "right", fontFamily: P.mono, border: "none", background: "transparent" }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={r.rate_type === "day_rate" ? r.planned_days : r.planned_months}
                      onChange={e => updateResource(r.id, r.rate_type === "day_rate" ? { planned_days: Number(e.target.value) || "" } : { planned_months: Number(e.target.value) || "" })}
                      style={{ width: 50, textAlign: "right", fontFamily: P.mono, border: "none", background: "transparent" }}
                    />
                  </td>
                  <td style={{ textAlign: "right", paddingRight: 10, fontFamily: P.mono, fontWeight: 700 }}>
                    {fmt(total, sym)}
                  </td>
                  <td style={{ textAlign: "right", paddingRight: 10, fontFamily: P.mono, color: P.violet, background: P.violetLt, opacity: approvedDays > 0 ? 1 : 0.4 }}>
                    {approvedDays}
                  </td>
                  <td style={{ textAlign: "right", paddingRight: 10, fontFamily: P.mono, fontWeight: 700, color: P.violet, background: P.violetLt }}>
                    {fmt(actualCost, sym)}
                  </td>
                  <td>
                    <select
                      value={r.cost_line_id || ""}
                      onChange={e => updateResource(r.id, { cost_line_id: e.target.value || null })}
                      style={{ width: 150, fontSize: 10, border: "none", background: "transparent" }}
                    >
                      <option value="">Unlinked</option>
                      {costLines.map((cl: CostLine) => (
                        <option key={cl.id} value={cl.id}>{cl.description || cl.category}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    {!readOnly && (
                      <button onClick={() => removeResource(r.id)} style={{ color: P.textSm, border: "none", background: "none", cursor: "pointer" }}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!readOnly && (
          <button 
            onClick={addResource}
            style={{ width: "100%", padding: "12px", border: "none", background: "white", color: P.navy, fontSize: 10, fontFamily: P.mono, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
          >
            <Plus size={14} /> ADD RESOURCE
          </button>
        )}
      </div>
    </div>
  );
}