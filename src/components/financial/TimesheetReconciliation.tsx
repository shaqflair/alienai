"use client";
// src/components/financial/TimesheetReconciliation.tsx
import { useEffect, useState, useCallback } from "react";
import { Lock, RefreshCw } from "lucide-react";

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
  mono:     "'DM Mono', 'Courier New', monospace",
  sans:     "'DM Sans', system-ui, sans-serif",
} as const;

type MonthData = {
  planned_days: number; approved_days: number; forecast_days: number;
  planned_cost: number; actual_cost: number;   forecast_cost: number;
  variance_cost: number; variance_pct: number | null; flag: "over" | "under" | "ok";
};

type Person = {
  user_id: string; name: string; email: string | null; role: string; rate_per_day: number;
  months: Record<string, MonthData>;
  totals: { planned_days: number; approved_days: number; planned_cost: number; actual_cost: number; forecast_cost: number; variance_cost: number; variance_pct: number | null; flag: "over" | "under" | "ok" };
};

type ReconcData = { ok: boolean; project_id: string; months: string[]; people: Person[]; generated_at: string; note?: string };

function formatCost(n: number, sym = "£"): string { if (!n && n !== 0) return "—"; return `${sym}${Math.abs(n).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`; }
function fmtD(n: number): string { if (!n && n !== 0) return "—"; return `${n.toFixed(1)}d`; }
function shortMo(mk: string): string { try { return new Date(mk + "-01").toLocaleDateString("en-GB", { month: "short", year: "2-digit" }); } catch { return mk; } }
function flagOk(f: string): boolean { return f === "ok"; }

export default function TimesheetReconciliation({ projectId }: { projectId: string }) {
  const [data,    setData]    = useState<ReconcData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [mode,    setMode]    = useState<"cost" | "days">("cost");
  const [filter,  setFilter]  = useState<"all" | "over" | "under" | "ok">("all");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`/api/projects/${projectId}/timesheet-reconciliation`, { cache: "no-store" });
      const json = await res.json();
      if (json.ok) setData(json); else setError(json.error ?? "Failed");
    } catch (e: any) { setError(String(e?.message ?? "Failed")); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const thB: React.CSSProperties   = { padding: "7px 10px", fontFamily: P.mono, fontSize: 8, fontWeight: 700, color: P.textSm, letterSpacing: "0.08em", textTransform: "uppercase", borderBottom: `1px solid ${P.borderMd}`, background: "#F4F4F2", whiteSpace: "nowrap", textAlign: "right" };
  const thV: React.CSSProperties   = { ...thB, background: P.violetLt, color: P.violet };
  const thN: React.CSSProperties   = { ...thB, background: P.navyLt,   color: P.navy   };

  if (loading) return <div style={{ padding: 32, display: "flex", alignItems: "center", gap: 10, color: P.textSm, fontFamily: P.sans, fontSize: 13 }}><RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} />Loading…<style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>;
  if (error)   return <div style={{ padding: 16, background: P.redLt, border: `1px solid #F0B0AA`, color: P.red, fontSize: 12, fontFamily: P.sans }}>{error}</div>;
  if (!data || !data.people.length) return <div style={{ padding: 32, textAlign: "center", color: P.textSm, fontSize: 13, fontFamily: P.sans }}>{data?.note ?? "No data found."}</div>;

  const months   = data.months;
  const filtered = data.people.filter(p => filter === "all" || p.totals.flag === filter);
  const counts   = { over: data.people.filter(p => p.totals.flag === "over").length, under: data.people.filter(p => p.totals.flag === "under").length, ok: data.people.filter(p => p.totals.flag === "ok").length };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, fontFamily: P.sans }}>

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: P.text }}>Timesheet Reconciliation</div>
          <div style={{ fontSize: 11, color: P.textSm, marginTop: 2 }}>Plan vs Actual vs Forecast</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", background: "#EDEDEB", padding: 2, gap: 2 }}>
            {(["cost", "days"] as const).map(m => (
              <button key={m} onClick={() => setMode(m)} style={{ padding: "4px 12px", fontFamily: P.mono, fontSize: 9, fontWeight: 700, cursor: "pointer", border: "none", letterSpacing: "0.06em", background: mode === m ? P.navy : "transparent", color: mode === m ? "#fff" : P.textSm }}>
                {m === "cost" ? "£ Cost" : "Days"}
              </button>
            ))}
          </div>
          <button onClick={load} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", border: `1px solid ${P.border}`, background: P.surface, color: P.navy, fontFamily: P.mono, fontSize: 9, fontWeight: 700, cursor: "pointer" }}>
            <RefreshCw size={10} /> Refresh
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div style={{ display: "flex", gap: 6 }}>
        {([
          { key: "all",   label: `all (${data.people.length})`, bg: P.navyLt,  color: P.navy,  border: "#A0BAD0" },
          { key: "over",  label: `over (${counts.over})`,        bg: P.redLt,   color: P.red,   border: "#F0B0AA" },
          { key: "under", label: `under (${counts.under})`,      bg: P.amberLt, color: P.amber, border: "#E0C080" },
          { key: "ok",    label: `ok (${counts.ok})`,            bg: P.greenLt, color: P.green, border: "#A0D0B8" },
        ] as const).map(({ key, label, bg, color, border }) => (
          <button key={key} onClick={() => setFilter(key as any)} style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", fontFamily: P.mono, fontSize: 9, fontWeight: 700, cursor: "pointer", border: `1px solid ${filter === key ? border : P.border}`, background: filter === key ? bg : P.surface, color: filter === key ? color : P.textSm, letterSpacing: "0.04em" }}>
            {label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{ border: `1px solid ${P.borderMd}`, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: 700 }}>
          <thead>
            <tr>
              <th style={{ ...thB, textAlign: "left", minWidth: 160, position: "sticky", left: 0, zIndex: 2 }}>Person</th>
              <th style={thN}>Plan</th>
              <th style={thV}>Actual</th>
              <th style={thB}>Forecast</th>
              <th style={thB}>Variance</th>
              {months.map(mk => (
                <th key={mk} style={{ ...thB, minWidth: 140, borderLeft: `1px solid ${P.border}` }} colSpan={2}>{shortMo(mk)}</th>
              ))}
            </tr>
            <tr>
              <th style={{ ...thB, textAlign: "left", position: "sticky", left: 0, zIndex: 2 }} />
              <th style={thN} /><th style={thV} /><th style={thB} /><th style={thB} />
              {months.map(mk => (<>
                <th key={`${mk}-lp`} style={{ ...thN, fontSize: 7, borderLeft: `1px solid ${P.border}` }}>Plan</th>
                <th key={`${mk}-la`} style={{ ...thV, fontSize: 7 }}>Actual</th>
              </>))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0
              ? <tr><td colSpan={5 + months.length * 2} style={{ padding: "24px", textAlign: "center", color: P.textSm, fontSize: 12 }}>No people match this filter.</td></tr>
              : filtered.map((person, idx) => {
                const rowBg       = idx % 2 === 0 ? P.surface : "#FAFAF8";
                const hasActuals  = person.totals.actual_cost > 0 || person.totals.approved_days > 0;
                const flagColor   = person.totals.flag === "over" ? P.red : person.totals.flag === "under" ? P.amber : P.green;
                const flagBg      = person.totals.flag === "over" ? P.redLt : person.totals.flag === "under" ? P.amberLt : P.greenLt;
                const initials    = person.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

                return (
                  <tr key={person.user_id} style={{ background: rowBg, borderBottom: `1px solid ${P.border}` }}>
                    {/* Name */}
                    <td style={{ padding: "10px 10px", background: rowBg, position: "sticky", left: 0, zIndex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 26, height: 26, borderRadius: "50%", background: P.navy, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, flexShrink: 0, fontFamily: P.mono }}>{initials}</div>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: P.text }}>{person.name}</div>
                          <div style={{ fontSize: 9, color: P.textSm, fontFamily: P.mono }}>{person.role || "Resource"}{person.rate_per_day > 0 ? ` · £${person.rate_per_day}/d` : ""}</div>
                        </div>
                      </div>
                    </td>

                    {/* Plan */}
                    <td style={{ padding: "10px 10px", textAlign: "right", background: P.navyLt }}>
                      <span style={{ fontFamily: P.mono, fontSize: 11, fontWeight: 700, color: P.navy }}>
                        {mode === "cost" ? formatCost(person.totals.planned_cost) : fmtD(person.totals.planned_days)}
                      </span>
                    </td>

                    {/* Actual */}
                    <td style={{ padding: "10px 10px", textAlign: "right", background: P.violetLt }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                        <Lock size={8} color={P.violet} />
                        <span style={{ fontFamily: P.mono, fontSize: 11, fontWeight: 700, color: hasActuals ? P.violet : P.textSm }}>
                          {mode === "cost" ? formatCost(person.totals.actual_cost) : fmtD(person.totals.approved_days)}
                        </span>
                      </div>
                      {!hasActuals && <div style={{ fontSize: 8, fontFamily: P.mono, color: P.textSm, textAlign: "right" }}>awaiting timesheets</div>}
                    </td>

                    {/* Forecast */}
                    <td style={{ padding: "10px 10px", textAlign: "right", background: rowBg }}>
                      <span style={{ fontFamily: P.mono, fontSize: 11, color: P.text }}>
                        {mode === "cost" ? formatCost(person.totals.forecast_cost) : fmtD(person.totals.approved_days)}
                      </span>
                    </td>

                    {/* Variance */}
                    <td style={{ padding: "10px 10px", textAlign: "right", background: hasActuals ? flagBg : rowBg }}>
                      {hasActuals
                        ? <div style={{ fontFamily: P.mono, fontSize: 11, fontWeight: 700, color: flagColor }}>
                            {mode === "cost"
                              ? `${person.totals.variance_cost > 0 ? "+" : ""}${formatCost(person.totals.variance_cost)}`
                              : `${(person.totals.approved_days - person.totals.planned_days) > 0 ? "+" : ""}${fmtD(person.totals.approved_days - person.totals.planned_days)}`}
                          </div>
                        : <span style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm }}>—</span>}
                    </td>

                    {/* Per month */}
                    {months.map(mk => {
                      const m        = person.months[mk];
                      const hasMonth = m && (m.actual_cost > 0 || m.approved_days > 0);
                      const isPast   = new Date(mk + "-01") < new Date();
                      return (<>
                        <td key={`${mk}-p`} style={{ padding: "8px 8px", textAlign: "right", background: P.navyLt, borderLeft: `1px solid ${P.border}` }}>
                          <span style={{ fontFamily: P.mono, fontSize: 10, color: (m?.planned_cost || m?.planned_days) ? P.navy : P.textSm }}>
                            {mode === "cost" ? (m?.planned_cost ? formatCost(m.planned_cost) : "—") : (m?.planned_days ? fmtD(m.planned_days) : "—")}
                          </span>
                        </td>
                        <td key={`${mk}-a`} style={{ padding: "8px 8px", textAlign: "right", background: hasMonth ? P.violetLt : (isPast ? "#F4F4F2" : rowBg) }}>
                          {hasMonth
                            ? <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3 }}>
                                <Lock size={7} color={P.violet} />
                                <span style={{ fontFamily: P.mono, fontSize: 10, fontWeight: 600, color: P.violet }}>
                                  {mode === "cost" ? formatCost(m.actual_cost) : fmtD(m.approved_days)}
                                </span>
                              </div>
                            : <span style={{ fontFamily: P.mono, fontSize: 9, color: P.border }}>—</span>}
                        </td>
                      </>);
                    })}
                  </tr>
                );
              })}
          </tbody>

          {filtered.length > 0 && (
            <tfoot>
              <tr style={{ background: "#F0F0ED", borderTop: `2px solid ${P.borderMd}` }}>
                <td style={{ padding: "8px 10px", fontFamily: P.mono, fontSize: 9, fontWeight: 700, color: P.textMd, position: "sticky", left: 0, background: "#F0F0ED" }}>
                  Total · {filtered.length} person{filtered.length !== 1 ? "s" : ""}
                </td>
                <td style={{ padding: "8px 10px", textAlign: "right", background: P.navyLt, fontFamily: P.mono, fontSize: 11, fontWeight: 700, color: P.navy }}>
                  {mode === "cost" ? formatCost(filtered.reduce((s, p) => s + p.totals.planned_cost,  0)) : fmtD(filtered.reduce((s, p) => s + p.totals.planned_days, 0))}
                </td>
                <td style={{ padding: "8px 10px", textAlign: "right", background: P.violetLt }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                    <Lock size={9} color={P.violet} />
                    <span style={{ fontFamily: P.mono, fontSize: 11, fontWeight: 700, color: P.violet }}>
                      {mode === "cost" ? formatCost(filtered.reduce((s, p) => s + p.totals.actual_cost, 0)) : fmtD(filtered.reduce((s, p) => s + p.totals.approved_days, 0))}
                    </span>
                  </div>
                </td>
                <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: P.mono, fontSize: 11, fontWeight: 700, color: P.text }}>
                  {mode === "cost" ? formatCost(filtered.reduce((s, p) => s + p.totals.forecast_cost, 0)) : fmtD(filtered.reduce((s, p) => s + p.totals.approved_days, 0))}
                </td>
                <td />
                {months.map(mk => (<>
                  <td key={`${mk}-fp`} style={{ padding: "8px 8px", textAlign: "right", background: P.navyLt, fontFamily: P.mono, fontSize: 10, fontWeight: 700, color: P.navy, borderLeft: `1px solid ${P.border}` }}>
                    {mode === "cost" ? formatCost(filtered.reduce((s, p) => s + (p.months[mk]?.planned_cost ?? 0), 0)) : fmtD(filtered.reduce((s, p) => s + (p.months[mk]?.planned_days ?? 0), 0))}
                  </td>
                  <td key={`${mk}-fa`} style={{ padding: "8px 8px", textAlign: "right", background: P.violetLt, fontFamily: P.mono, fontSize: 10, fontWeight: 700, color: P.violet }}>
                    {mode === "cost" ? formatCost(filtered.reduce((s, p) => s + (p.months[mk]?.actual_cost ?? 0), 0)) : fmtD(filtered.reduce((s, p) => s + (p.months[mk]?.approved_days ?? 0), 0))}
                  </td>
                </>))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 9, fontFamily: P.mono, color: P.textSm, flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Lock size={8} color={P.violet} />Actuals locked from approved timesheets</span>
        <span>·</span><span style={{ color: P.red }}>over &gt;10% above plan</span>
        <span>·</span><span style={{ color: P.amber }}>under &gt;10% below plan</span>
        <span>·</span><span style={{ color: P.green }}>ok within 10%</span>
      </div>
    </div>
  );
}