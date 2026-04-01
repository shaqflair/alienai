"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";

const PortfolioMonthlyPhasing = dynamic(
  () => import("@/components/portfolio/PortfolioMonthlyPhasing"),
  { ssr: false, loading: () => <div style={{ padding: 64, textAlign: "center", color: "#a8a29e", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>LOADING PHASING DATA…</div> }
);

const FONT_URL = "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=IBM+Plex+Mono:wght@300;400;500;600&family=Source+Serif+4:opsz,wght@8..60,300;400;600&display=swap";

type ProjectSummary = {
  projectId: string;
  projectCode: string | null;
  projectCodeLabel: string | null;
  title: string;
  colour: string;
  hasFinancialPlan: boolean;
  artifactId: string | null;
  totals: {
    budget: number;
    forecast: number;
    actual: number;
    variance: number;
    burnPct: number;
    variancePct?: number | null;
  };
};

type Portfolio = {
  totalBudget: number;
  totalForecast: number;
  totalActual: number;
  totalVariance?: number;
  projectCount: number;
  withPlanCount: number;
  variancePct?: number | null;
  rag?: "G" | "A" | "R";
};

type ApiResponse = {
  ok: boolean;
  portfolio: Portfolio;
  projects: ProjectSummary[];
  error?: string;
};

type SortKey = "variance" | "burn" | "budget" | "title";
type Filter  = "all" | "over" | "watch" | "ok" | "no-plan";
type Tab     = "overview" | "phasing";
type ViewMode = "live" | "fy";

const T = {
  bg: "#f9f7f4", surface: "#ffffff", hr: "#e7e5e4",
  ink: "#1c1917", ink2: "#44403c", ink3: "#78716c", ink4: "#a8a29e", ink5: "#d6d3d1",
  mono: "'IBM Plex Mono', monospace",
  serif: "'Playfair Display', Georgia, serif",
  body: "'Source Serif 4', Georgia, serif",
};

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "--";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return "\u00A3" + (n / 1_000_000).toFixed(1) + "M";
  if (abs >= 1000) return "\u00A3" + (n / 1000).toFixed(0) + "K";
  return "\u00A3" + n.toFixed(0);
}

function fmtPct(n: number): string {
  return (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
}

function varRag(v: number, b: number): "G" | "A" | "R" | "N" {
  if (b === 0) return "N";
  const p = (v / b) * 100;
  if (p > 5) return "R";
  if (p > 0) return "A";
  return "G";
}

function burnRag(p: number): "G" | "A" | "R" {
  return p > 90 ? "R" : p > 75 ? "A" : "G";
}

const RC: Record<string, { fg: string; bg: string; label: string }> = {
  G: { fg: "#14532d", bg: "#f0fdf4", label: "On Track" },
  A: { fg: "#78350f", bg: "#fffbeb", label: "Watch" },
  R: { fg: "#7f1d1d", bg: "#fef2f2", label: "Over Budget" },
  N: { fg: "#57534e", bg: "#fafaf9", label: "No Data" },
};

function Cap({ children }: { children: React.ReactNode }) {
  return <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.13em", textTransform: "uppercase" as const, color: T.ink4 }}>{children}</span>;
}

function Mono({ children, size = 11, color, weight = 400 }: { children: React.ReactNode; size?: number; color?: string; weight?: number }) {
  return <span style={{ fontFamily: T.mono, fontSize: size, color: color ?? T.ink3, fontWeight: weight }}>{children}</span>;
}

function BurnBar({ pct, rag }: { pct: number; rag: "G" | "A" | "R" }) {
  const c = rag === "R" ? "#991b1b" : rag === "A" ? "#92400e" : "#14532d";
  return (
    <div style={{ width: "100%", height: 3, background: T.hr, borderRadius: 2, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, background: c, borderRadius: 2 }} />
    </div>
  );
}

function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ padding: "4px 12px", fontFamily: T.mono, fontSize: 10, fontWeight: active ? 600 : 400, letterSpacing: "0.07em", textTransform: "uppercase" as const, background: active ? T.ink : "transparent", color: active ? "#fff" : T.ink3, border: `1px solid ${active ? T.ink : T.hr}`, borderRadius: 2, cursor: "pointer" }}>
      {label}
    </button>
  );
}

function TabBtn({ label, active, onClick, badge }: { label: string; active: boolean; onClick: () => void; badge?: string }) {
  return (
    <button onClick={onClick} style={{ padding: "10px 20px", fontFamily: T.mono, fontSize: 10, fontWeight: active ? 600 : 400, letterSpacing: "0.1em", textTransform: "uppercase" as const, background: "transparent", color: active ? T.ink : T.ink4, border: "none", borderBottom: active ? `2px solid ${T.ink}` : "2px solid transparent", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, marginBottom: -1 }}>
      {label}
      {badge && <span style={{ padding: "1px 6px", background: active ? T.ink : T.hr, color: active ? "#fff" : T.ink4, borderRadius: 10, fontSize: 9, fontWeight: 600 }}>{badge}</span>}
    </button>
  );
}

function nowUK() {
  return new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", "");
}

/* ── Executive KPI card ── */
function KpiCard({ label, value, sub, color, note, highlight }: {
  label: string; value: string; sub?: string; color?: string; note?: string; highlight?: boolean;
}) {
  return (
    <div style={{ padding: "20px 24px", borderRight: `1px solid ${T.hr}`, background: highlight ? "#fafaf9" : T.surface }}>
      <Cap>{label}</Cap>
      <div style={{ fontFamily: T.serif, fontSize: 30, fontWeight: 700, lineHeight: 1, marginTop: 8, marginBottom: 4, color: color ?? T.ink }}>{value}</div>
      {sub  && <div style={{ fontFamily: T.mono, fontSize: 10, color: T.ink4, marginTop: 2 }}>{sub}</div>}
      {note && <div style={{ fontFamily: T.mono, fontSize: 9, color: T.ink5, marginTop: 4 }}>{note}</div>}
    </div>
  );
}

/* ── Context banner ── */
function ContextBanner({ viewMode, projectCount, withPlanCount, fyLabel }: {
  viewMode: ViewMode; projectCount: number; withPlanCount: number; fyLabel: string;
}) {
  const isLive = viewMode === "live";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", background: isLive ? "#fefce8" : "#f0fdf4", border: `1px solid ${isLive ? "#fde68a" : "#bbf7d0"}`, borderRadius: 6, fontSize: 12, fontFamily: T.mono, color: isLive ? "#78350f" : "#14532d" }}>
      <span style={{ fontWeight: 700 }}>{isLive ? "LIVE SNAPSHOT" : `FY VIEW \u2014 ${fyLabel}`}</span>
      <span style={{ opacity: 0.7 }}>{isLive ? "Active projects only. Closed and archived projects are excluded." : "Includes all projects active or closed within this financial year."}</span>
      <span style={{ marginLeft: "auto", fontWeight: 600 }}>{withPlanCount}/{projectCount} projects with financial plan</span>
    </div>
  );
}

/* ── Main component ── */
export default function BudgetClient() {
  const [data,      setData]      = useState<ApiResponse | null>(null);
  const [loading,   setLoad]      = useState(true);
  const [filter,    setFilter]    = useState<Filter>("all");
  const [sort,      setSort]      = useState<SortKey>("variance");
  const [search,    setSearch]    = useState("");
  const [mounted,   setMount]     = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [viewMode,  setViewMode]  = useState<ViewMode>("live");
  const [overviewFyYear,  setOverviewFyYear]  = useState(() => { const now = new Date(); return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1; });
  const [overviewFyStart, setOverviewFyStart] = useState(4);

  useEffect(() => { setMount(true); }, []);

  const load = useCallback(async () => {
    setLoad(true);
    try {
      const scope = viewMode === "fy" ? "all" : "active";

      if (viewMode === "fy") {
        // FY mode: fetch from phasing API which is FY-aware, derive KPIs from monthly totals
        const [summaryRes, phasingRes] = await Promise.all([
          fetch(`/api/portfolio/financial-plan-summary?scope=${scope}`, { cache: "no-store" }),
          fetch(`/api/portfolio/budget-phasing?fyStart=${overviewFyStart}&fyYear=${overviewFyYear}&fyMonths=12&scope=${scope}`, { cache: "no-store" }),
        ]);
        const summary = await summaryRes.json();
        const phasing = await phasingRes.json();

        // Budget = sum of total_approved_budget from financial plans (governance ceiling)
        // Forecast & Actual = summed from monthly phasing for the selected FY only
        let fyBudget = 0, fyForecast = 0, fyActual = 0;
        const hasPhasing = phasing.ok && phasing.projectsWithPlan > 0;

        // Always use total_approved_budget for the Budget KPI
        if (phasing.ok && typeof phasing.totalApprovedBudget === "number") {
          fyBudget = phasing.totalApprovedBudget;
        }

        // Forecast & Actual come from monthly phasing data for the selected FY
        if (phasing.ok && phasing.aggregatedLines?.length > 0) {
          for (const line of phasing.aggregatedLines) {
            const lineData = phasing.monthlyData?.[line.id] ?? {};
            for (const entry of Object.values(lineData) as any[]) {
              fyForecast += Number(entry?.forecast || 0);
              fyActual   += Number(entry?.actual   || 0);
            }
          }
        }

        // projectsInFyCount = projects with actual phasing data in this specific FY
        const projectsInFy = phasing.projectsInFyCount ?? 0;
        setData({
          ...summary,
          ok: true,
          portfolio: {
            ...(summary.portfolio ?? {}),
            totalBudget:   fyBudget,   // approved budget for projects active in this FY
            totalForecast: fyForecast, // forecast from monthly phasing for this FY
            totalActual:   fyActual,   // actual from monthly phasing for this FY
            totalVariance: fyForecast - fyBudget,
            projectCount:  phasing.projectCount ?? summary.portfolio?.projectCount ?? 0,
            withPlanCount: projectsInFy,
          },
          projects: hasPhasing ? (summary.projects ?? []) : [],
          _noFyData: !hasPhasing,
        });
      } else {
        // Live mode: use summary API directly (all-time totals for active projects)
        const r = await fetch(`/api/portfolio/financial-plan-summary?scope=${scope}`, { cache: "no-store" });
        const j = await r.json();
        setData(j);
      }
    } catch (e: any) {
      setData({ ok: false, error: e?.message, portfolio: { totalBudget: 0, totalForecast: 0, totalActual: 0, totalVariance: 0, projectCount: 0, withPlanCount: 0 }, projects: [] });
    } finally { setLoad(false); }
  }, [viewMode, overviewFyYear, overviewFyStart]);

  useEffect(() => { load(); }, [load]);

  const projects = (data?.projects ?? []).filter(p => String((p as any).status ?? "").toLowerCase() !== "pipeline");
  const port = data?.portfolio;
  const totalVar = port?.totalVariance ?? ((port?.totalForecast ?? 0) - (port?.totalBudget ?? 0));
  const utilisationPct = port?.totalBudget ? Math.round(((port?.totalActual ?? 0) / port.totalBudget) * 100) : null;
  const forecastPct    = port?.totalBudget ? Math.round(((port?.totalForecast ?? 0) / port.totalBudget) * 100) : null;

  const overCount   = projects.filter(p => p.hasFinancialPlan && varRag(p.totals.variance, p.totals.budget) === "R").length;
  const watchCount  = projects.filter(p => p.hasFinancialPlan && varRag(p.totals.variance, p.totals.budget) === "A").length;
  const okCount     = projects.filter(p => p.hasFinancialPlan && varRag(p.totals.variance, p.totals.budget) === "G").length;
  const noPlanCount = projects.filter(p => !p.hasFinancialPlan).length;
  const atRiskCount = overCount + watchCount;

  // Variance direction interpretation
  const varIsOver = totalVar > 0;
  const varIsUnder = totalVar < 0;
  const varLabel = varIsOver ? "Over budget" : varIsUnder ? "Under forecast" : "On budget";
  const varColor = varIsOver ? "#7f1d1d" : varIsUnder ? "#14532d" : T.ink;
  const varNote  = varIsUnder ? "Forecast below budget — verify scope is intact" : varIsOver ? "Requires executive attention" : "";

  const fyLabel = overviewFyStart === 1 ? String(overviewFyYear) : `${overviewFyYear}/${String(overviewFyYear + 1).slice(2)}`;

  const filtered = useMemo(() => {
    let list = [...projects];
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(p => p.title.toLowerCase().includes(q) || (p.projectCodeLabel ?? "").toLowerCase().includes(q));
    if (filter === "over") list = list.filter(p => p.hasFinancialPlan && varRag(p.totals.variance, p.totals.budget) === "R");
    else if (filter === "watch") list = list.filter(p => p.hasFinancialPlan && varRag(p.totals.variance, p.totals.budget) === "A");
    else if (filter === "ok") list = list.filter(p => p.hasFinancialPlan && varRag(p.totals.variance, p.totals.budget) === "G");
    else if (filter === "no-plan") list = list.filter(p => !p.hasFinancialPlan);
    list.sort((a, b) => {
      if (sort === "variance") return b.totals.variance - a.totals.variance;
      if (sort === "burn")     return b.totals.burnPct - a.totals.burnPct;
      if (sort === "budget")   return b.totals.budget - a.totals.budget;
      return a.title.localeCompare(b.title);
    });
    return list;
  }, [projects, filter, sort, search]);

  const TH: React.CSSProperties = { padding: "9px 16px", fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: T.ink4, textAlign: "left", borderBottom: `1px solid ${T.hr}`, background: "#f5f3f0", whiteSpace: "nowrap" };
  const TD: React.CSSProperties = { padding: "14px 16px", verticalAlign: "middle", borderBottom: `1px solid ${T.hr}` };

  return (
    <>
      <style>{`
        @import url("${FONT_URL}");
        @keyframes fadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        .brow:hover { background: #f9f7f4 !important; }
        input:focus { outline: none; }
      `}</style>

      <div style={{ minHeight: "100vh", background: T.bg, fontFamily: T.mono, opacity: mounted ? 1 : 0, transition: "opacity 0.35s" }}>
        <div style={{ maxWidth: 1360, margin: "0 auto", padding: "40px 40px 100px" }}>

          {/* Header */}
          <div style={{ borderBottom: `2px solid ${T.ink}`, paddingBottom: 22, marginBottom: 0, animation: "fadeUp 0.4s ease both" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Link href="/home" style={{ fontFamily: T.mono, fontSize: 10, color: T.ink4, textDecoration: "none", letterSpacing: "0.08em" }}>{"<- PORTFOLIO INTELLIGENCE"}</Link>
                <span style={{ color: T.ink5 }}>{" · "}</span>
                <Cap>BUDGET REGISTER</Cap>
              </div>
              <Mono size={10} color={T.ink5}>{nowUK()}</Mono>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 32 }}>
              <div>
                <h1 style={{ fontFamily: T.serif, fontSize: 42, fontWeight: 700, margin: 0, letterSpacing: "-0.02em", lineHeight: 1.05, color: T.ink }}>Budget Intelligence</h1>
                <p style={{ fontFamily: T.body, fontSize: 14, color: T.ink3, marginTop: 8, fontWeight: 300, lineHeight: 1.5, maxWidth: 560 }}>
                  Financial health across the portfolio — forecast variance, burn rate and delivery exposure.
                </p>
              </div>
              {/* View mode + FY selector */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                <Mono size={9} color={T.ink5}>Portfolio view</Mono>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ display: "flex", border: `1px solid ${T.hr}`, background: T.surface }}>
                    {([["live", "Live snapshot"], ["fy", "Financial year"]] as const).map(([m, l]) => (
                      <button key={m} onClick={() => setViewMode(m)} style={{ padding: "7px 16px", fontFamily: T.mono, fontSize: 10, fontWeight: viewMode === m ? 600 : 400, letterSpacing: "0.07em", textTransform: "uppercase", cursor: "pointer", background: viewMode === m ? T.ink : "transparent", color: viewMode === m ? "#fff" : T.ink3, border: "none" }}>
                        {l}
                      </button>
                    ))}
                  </div>
                  <select value={overviewFyStart} onChange={e => setOverviewFyStart(Number(e.target.value))} style={{ padding: "6px 8px", fontFamily: T.mono, fontSize: 10, border: `1px solid ${T.hr}`, background: T.surface, color: T.ink, cursor: "pointer" }}>
                    <option value={4}>Apr – Mar</option>
                    <option value={1}>Jan – Dec</option>
                    <option value={7}>Jul – Jun</option>
                    <option value={10}>Oct – Sep</option>
                  </select>
                  <select value={overviewFyYear} onChange={e => setOverviewFyYear(Number(e.target.value))} style={{ padding: "6px 8px", fontFamily: T.mono, fontSize: 10, border: `1px solid ${T.hr}`, background: T.surface, color: T.ink, cursor: "pointer" }}>
                    {(() => { const now = new Date(); const cur = now.getMonth() + 1 >= overviewFyStart ? now.getFullYear() : now.getFullYear() - 1; return [cur+1, cur, cur-1, cur-2].map(y => <option key={y} value={y}>FY {overviewFyStart === 1 ? y : `${y}/${String(y+1).slice(2)}`}</option>); })()}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Tab bar */}
          <div style={{ display: "flex", borderBottom: `1px solid ${T.hr}`, marginBottom: 20, gap: 0 }}>
            <TabBtn label="Overview" active={activeTab === "overview"} onClick={() => setActiveTab("overview")} badge={String(projects.length)} />
            <TabBtn label="Monthly Phasing" active={activeTab === "phasing"} onClick={() => setActiveTab("phasing")} />
          </div>

          {/* OVERVIEW TAB */}
          {activeTab === "overview" && (
            <>
              {/* Context banner */}
              {!loading && port && (
                <div style={{ marginBottom: 16 }}>
                  <ContextBanner viewMode={viewMode} projectCount={port.projectCount} withPlanCount={port.withPlanCount} fyLabel={fyLabel} />
                </div>
              )}

              {/* KPI grid */}
              {!loading && port && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", border: `1px solid ${T.hr}`, background: T.surface, marginBottom: 16, animation: "fadeUp 0.4s 0.08s ease both" }}>
                  <KpiCard
                    label="Total Budget"
                    value={fmt(port.totalBudget)}
                    sub={`${port.withPlanCount} of ${port.projectCount} projects with plan`}
                  />
                  <KpiCard
                    label="Total Forecast"
                    value={fmt(port.totalForecast)}
                    sub={forecastPct != null ? `${forecastPct}% of approved budget` : undefined}
                    color={varIsOver ? "#7f1d1d" : T.ink}
                  />
                  <KpiCard
                    label="Actual Spend"
                    value={fmt(port.totalActual)}
                    sub={utilisationPct != null ? `${utilisationPct}% budget utilised` : "Awaiting actuals"}
                    color="#0e7490"
                  />
                  <KpiCard
                    label={varLabel}
                    value={(totalVar > 0 ? "+" : "") + fmt(Math.abs(totalVar))}
                    sub={varNote}
                    color={varColor}
                    note="Forecast vs approved budget"
                  />
                  <KpiCard
                    label="Projects at risk"
                    value={`${atRiskCount} / ${projects.filter(p => p.hasFinancialPlan).length}`}
                    sub={atRiskCount > 0 ? `${overCount} over budget · ${watchCount} watch` : "All projects on track"}
                    color={atRiskCount > 0 ? "#7f1d1d" : "#14532d"}
                  />
                  <KpiCard
                    label="Budget headroom"
                    value={fmt(Math.abs(port.totalBudget - port.totalForecast))}
                    sub={varIsOver ? "Forecast exceeds budget" : "Remaining forecast capacity"}
                    color={varIsOver ? "#7f1d1d" : "#14532d"}
                    highlight={varIsOver}
                  />
                </div>
              )}

              {/* Interpretation strip — context for executives */}
              {!loading && port && (port.totalBudget > 0) && (
                <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
                  {varIsUnder && (
                    <div style={{ flex: 1, padding: "10px 14px", background: "#fefce8", border: "1px solid #fde68a", borderRadius: 6, fontFamily: T.mono, fontSize: 11, color: "#78350f" }}>
                      <strong>Under-forecast by {fmt(Math.abs(totalVar))}</strong> — Forecast is below approved budget. Verify project scope is intact and phasing is up to date.
                    </div>
                  )}
                  {varIsOver && (
                    <div style={{ flex: 1, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, fontFamily: T.mono, fontSize: 11, color: "#7f1d1d" }}>
                      <strong>Over budget by {fmt(Math.abs(totalVar))}</strong> — Forecast exceeds approved budget. Escalation or budget revision may be required.
                    </div>
                  )}
                  {utilisationPct !== null && utilisationPct < 10 && port.totalBudget > 0 && (
                    <div style={{ flex: 1, padding: "10px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, fontFamily: T.mono, fontSize: 11, color: "#14532d" }}>
                      <strong>Low burn rate ({utilisationPct}%)</strong> — Only {fmt(port.totalActual)} of {fmt(port.totalBudget)} budget has been spent. Projects may be early stage or spend not yet recorded.
                    </div>
                  )}
                  {viewMode === "live" && (
                    <div style={{ flex: 1, padding: "10px 14px", background: T.surface, border: `1px solid ${T.hr}`, borderRadius: 6, fontFamily: T.mono, fontSize: 11, color: T.ink4 }}>
                      Switch to <strong style={{ color: T.ink }}>Financial Year view</strong> to include closed projects and see full-year committed spend.
                    </div>
                  )}
                </div>
              )}

              {/* Filter + sort bar */}
              <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: "14px 18px", marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                <div style={{ display: "flex", gap: 3 }}>
                  {(["all", "over", "watch", "ok", "no-plan"] as Filter[]).map(f => {
                    const counts: Record<Filter, number> = { all: projects.length, over: overCount, watch: watchCount, ok: okCount, "no-plan": noPlanCount };
                    const labels: Record<Filter, string> = { all: "All", over: "Over Budget", watch: "Watch", ok: "On Track", "no-plan": "No Plan" };
                    return <Pill key={f} label={`${labels[f]} ${counts[f]}`} active={filter === f} onClick={() => setFilter(f)} />;
                  })}
                </div>
                <div style={{ width: 1, height: 20, background: T.hr }} />
                <div style={{ display: "flex", gap: 3 }}>
                  {(["variance", "burn", "budget", "title"] as SortKey[]).map(s => {
                    const l: Record<SortKey, string> = { variance: "Forecast Variance", burn: "Burn", budget: "Budget", title: "A-Z" };
                    return <Pill key={s} label={l[s]} active={sort === s} onClick={() => setSort(s)} />;
                  })}
                </div>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects..." style={{ marginLeft: "auto", padding: "6px 12px", fontFamily: T.mono, fontSize: 11, background: T.bg, border: `1px solid ${T.hr}`, borderRadius: 2, color: T.ink, width: 220 }} />
              </div>

              {/* Table */}
              {loading ? (
                <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: 64, textAlign: "center" }}>
                  <Mono size={11} color={T.ink5}>RETRIEVING FINANCIAL DATA...</Mono>
                </div>
              ) : !data?.ok ? (
                <div style={{ background: "#fef2f2", border: `1px solid ${T.hr}`, borderLeft: "3px solid #7f1d1d", padding: "18px 24px" }}>
                  <Cap>Error</Cap>
                  <p style={{ fontFamily: T.body, fontSize: 13, color: "#7f1d1d", margin: "8px 0 0" }}>{data?.error}</p>
                </div>
              ) : (
                <div style={{ background: T.surface, border: `1px solid ${T.hr}`, overflow: "hidden" }}>
                  {(data as any)?._noFyData ? (
                    <div style={{ padding: 64, textAlign: "center" }}>
                      <Mono size={12} color={T.ink5}>No financial plan phasing data for FY {fyLabel}.</Mono>
                      <div style={{ marginTop: 8, fontFamily: T.mono, fontSize: 10, color: T.ink5 }}>Add monthly phasing data to project financial plans to see FY-specific figures.</div>
                    </div>
                  ) : filtered.length === 0 ? (
                    <div style={{ padding: 64, textAlign: "center" }}><Mono size={12} color={T.ink5}>No projects match the current filters.</Mono></div>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
                        <thead>
                          <tr>
                            <th style={{ ...TH, width: 3, padding: 0 }} />
                            <th style={{ ...TH, minWidth: 260 }}>Project</th>
                            <th style={{ ...TH, width: 120 }}>Budget</th>
                            <th style={{ ...TH, width: 120 }}>Forecast</th>
                            <th style={{ ...TH, width: 120 }}>Actual</th>
                            <th style={{ ...TH, width: 80 }}>Utilised</th>
                            <th style={{ ...TH, width: 160 }}>Forecast vs Budget</th>
                            <th style={{ ...TH, width: 160 }}>Burn Rate</th>
                            <th style={{ ...TH, width: 120 }}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map(p => {
                            const rag   = p.hasFinancialPlan ? varRag(p.totals.variance, p.totals.budget) : "N";
                            const brag  = burnRag(p.totals.burnPct);
                            const rc    = RC[rag];
                            const utilPct = p.totals.budget > 0 ? Math.round((p.totals.actual / p.totals.budget) * 100) : null;
                            const varPct  = p.totals.budget > 0 ? ((p.totals.variance / p.totals.budget) * 100) : null;
                            const isOver  = p.totals.variance > 0;
                            const isUnder = p.totals.variance < 0;

                            return (
                              <tr key={p.projectId} className="brow" style={{ background: T.surface }}>
                                <td style={{ width: 3, padding: 0 }}>
                                  <div style={{ width: 3, minHeight: 54, background: rag === "N" ? "transparent" : rc.fg, opacity: rag === "G" ? 0.4 : 1 }} />
                                </td>
                                <td style={{ ...TD, minWidth: 260 }}>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                    <Link href={`/projects/${p.projectId}`} style={{ fontFamily: T.body, fontSize: 13.5, color: T.ink2, textDecoration: "none" }}>{p.title}</Link>
                                    {p.projectCodeLabel && <Mono size={10} color={T.ink5}>{p.projectCodeLabel}</Mono>}
                                  </div>
                                </td>
                                <td style={TD}><Mono size={12} color={T.ink3} weight={500}>{p.hasFinancialPlan ? fmt(p.totals.budget) : "--"}</Mono></td>
                                <td style={TD}><Mono size={12} color={T.ink3} weight={500}>{p.hasFinancialPlan ? fmt(p.totals.forecast) : "--"}</Mono></td>
                                <td style={TD}>
                                  {p.hasFinancialPlan ? (
                                    <div>
                                      <Mono size={12} color="#0e7490" weight={500}>{fmt(p.totals.actual)}</Mono>
                                      {viewMode === "fy" && <div style={{ fontFamily: T.mono, fontSize: 9, color: T.ink5, marginTop: 2 }}>all-time</div>}
                                    </div>
                                  ) : <Mono size={12} color={T.ink4}>--</Mono>}
                                </td>
                                <td style={TD}>
                                  {utilPct !== null ? (
                                    <Mono size={11} color={utilPct > 90 ? "#7f1d1d" : utilPct > 75 ? "#78350f" : T.ink3} weight={600}>{utilPct}%</Mono>
                                  ) : <Mono size={10} color={T.ink5}>--</Mono>}
                                </td>
                                <td style={TD}>
                                  {p.hasFinancialPlan ? (
                                    <div>
                                      <Mono size={12} color={isOver ? "#7f1d1d" : isUnder ? "#14532d" : T.ink3} weight={600}>
                                        {p.totals.variance === 0 ? "On budget" : (isOver ? "+" : "-") + fmt(Math.abs(p.totals.variance))}
                                      </Mono>
                                      {varPct !== null && Math.abs(varPct) > 0.5 && (
                                        <div style={{ fontFamily: T.mono, fontSize: 9, color: isOver ? "#7f1d1d" : "#14532d", marginTop: 2 }}>
                                          {isOver ? "over" : "under"} by {Math.abs(varPct).toFixed(1)}%
                                        </div>
                                      )}
                                    </div>
                                  ) : <Mono size={11} color={T.ink5}>No plan</Mono>}
                                </td>
                                <td style={{ ...TD, minWidth: 160 }}>
                                  {p.hasFinancialPlan ? (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                                        <Mono size={10} color={T.ink4}>Burn</Mono>
                                        <Mono size={10} color={RC[brag].fg} weight={600}>{p.totals.burnPct}%</Mono>
                                      </div>
                                      <BurnBar pct={p.totals.burnPct} rag={brag} />
                                    </div>
                                  ) : <Mono size={10} color={T.ink5}>--</Mono>}
                                </td>
                                <td style={TD}>
                                  {p.hasFinancialPlan ? (
                                    p.artifactId ? (
                                      <Link href={`/projects/${p.projectId}/artifacts/${p.artifactId}?panel=intelligence`}
                                        style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", padding: "3px 10px", borderRadius: 2, background: rc.bg, color: rc.fg, textDecoration: "none", whiteSpace: "nowrap" }}>
                                        {rc.label}
                                      </Link>
                                    ) : (
                                      <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", padding: "3px 10px", borderRadius: 2, background: rc.bg, color: rc.fg }}>{rc.label}</span>
                                    )
                                  ) : (
                                    <Link href={`/projects/${p.projectId}/artifacts/new?type=FINANCIAL_PLAN`}
                                      style={{ fontFamily: T.mono, fontSize: 10, color: "#1d4ed8", textDecoration: "none", letterSpacing: "0.07em", borderBottom: "1px solid #bfdbfe", paddingBottom: 1 }}>
                                      + ADD PLAN
                                    </Link>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {!loading && data?.ok && (
                <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between", paddingTop: 16, borderTop: `1px solid ${T.hr}` }}>
                  <Mono size={10} color={T.ink5}>
                    {viewMode === "live" ? "Active projects only" : "All projects incl. closed"} · {projects.length} projects · {filtered.length} shown
                  </Mono>
                  <Mono size={10} color={T.ink5}>{nowUK()}</Mono>
                </div>
              )}
            </>
          )}

          {/* MONTHLY PHASING TAB */}
          {activeTab === "phasing" && (
            <div style={{ animation: "fadeUp 0.3s ease both" }}>
              <PortfolioMonthlyPhasing />
            </div>
          )}

        </div>
      </div>
    </>
  );
}