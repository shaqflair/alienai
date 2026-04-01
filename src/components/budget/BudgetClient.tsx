"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";

// Lazy-load the phasing component — it's heavy and not needed on initial render
const PortfolioMonthlyPhasing = dynamic(
  () => import("@/components/portfolio/PortfolioMonthlyPhasing"),
  { ssr: false, loading: () => <div style={{ padding: 64, textAlign: "center", color: "#a8a29e", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>LOADING PHASING DATA…</div> }
);

const FONT_URL =
  "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=IBM+Plex+Mono:wght@300;400;500;600&family=Source+Serif+4:opsz,wght@8..60,300;400;600&display=swap";

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
type Filter = "all" | "over" | "watch" | "ok" | "no-plan";
type Tab = "overview" | "phasing";

const T = {
  bg: "#f9f7f4",
  surface: "#ffffff",
  hr: "#e7e5e4",
  ink: "#1c1917",
  ink2: "#44403c",
  ink3: "#78716c",
  ink4: "#a8a29e",
  ink5: "#d6d3d1",
  mono: "'IBM Plex Mono', monospace",
  serif: "'Playfair Display', Georgia, serif",
  body: "'Source Serif 4', Georgia, serif",
};

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "--";
  const abs = Math.abs(n);
  if (abs >= 1000000) return "\u00A3" + (n / 1000000).toFixed(1) + "M";
  if (abs >= 1000) return "\u00A3" + (n / 1000).toFixed(0) + "K";
  return "\u00A3" + n.toFixed(0);
}

function signedFmt(n: number): string {
  return `${n > 0 ? "+" : ""}${fmt(n)}`;
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
  return (
    <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.13em", textTransform: "uppercase" as const, color: T.ink4 }}>
      {children}
    </span>
  );
}

function Mono({ children, size = 11, color, weight = 400 }: { children: React.ReactNode; size?: number; color?: string; weight?: number }) {
  return (
    <span style={{ fontFamily: T.mono, fontSize: size, color: color ?? T.ink3, fontWeight: weight }}>
      {children}
    </span>
  );
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
    <button
      onClick={onClick}
      style={{
        padding: "4px 12px",
        fontFamily: T.mono,
        fontSize: 10,
        fontWeight: active ? 600 : 400,
        letterSpacing: "0.07em",
        textTransform: "uppercase" as const,
        background: active ? T.ink : "transparent",
        color: active ? "#fff" : T.ink3,
        border: `1px solid ${active ? T.ink : T.hr}`,
        borderRadius: 2,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function KpiCell({ label, value, color, note }: { label: string; value: string; color?: string; note?: string }) {
  return (
    <div style={{ padding: "22px 28px", borderRight: `1px solid ${T.hr}` }}>
      <Cap>{label}</Cap>
      <div style={{ fontFamily: T.serif, fontSize: 32, fontWeight: 700, lineHeight: 1, marginTop: 10, marginBottom: 6, color: color ?? T.ink }}>
        {value}
      </div>
      {note ? <Mono size={10} color={T.ink5}>{note}</Mono> : null}
    </div>
  );
}

function nowUK() {
  return new Date()
    .toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    .replace(",", "");
}

/* ─── Tab button ───────────────────────────────────────────────── */
function TabBtn({ label, active, onClick, badge }: { label: string; active: boolean; onClick: () => void; badge?: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "10px 20px",
        fontFamily: T.mono,
        fontSize: 10,
        fontWeight: active ? 600 : 400,
        letterSpacing: "0.1em",
        textTransform: "uppercase" as const,
        background: "transparent",
        color: active ? T.ink : T.ink4,
        border: "none",
        borderBottom: active ? `2px solid ${T.ink}` : "2px solid transparent",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginBottom: -1,
      }}
    >
      {label}
      {badge && (
        <span style={{
          padding: "1px 6px",
          background: active ? T.ink : T.hr,
          color: active ? "#fff" : T.ink4,
          borderRadius: 10,
          fontSize: 9,
          fontWeight: 600,
        }}>
          {badge}
        </span>
      )}
    </button>
  );
}

/* ─── Main component ───────────────────────────────────────────── */
export default function BudgetClient() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoad] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<SortKey>("variance");
  const [search, setSearch] = useState("");
  const [mounted, setMount] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  useEffect(() => { setMount(true); }, []);

  const load = useCallback(async () => {
    setLoad(true);
    try {
      const r = await fetch("/api/portfolio/financial-plan-summary", { cache: "no-store" });
      const j = await r.json();
      setData(j);
    } catch (e: any) {
      setData({ ok: false, error: e?.message, portfolio: { totalBudget: 0, totalForecast: 0, totalActual: 0, totalVariance: 0, projectCount: 0, withPlanCount: 0 }, projects: [] });
    } finally {
      setLoad(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const projects = (data?.projects ?? []).filter(
    (p) => String((p as any).status ?? "").toLowerCase() !== "pipeline"
  );
  const port = data?.portfolio;
  const totalVar = port?.totalVariance ?? ((port?.totalForecast ?? 0) - (port?.totalBudget ?? 0));

  const overCount = projects.filter((p) => p.hasFinancialPlan && varRag(p.totals.variance, p.totals.budget) === "R").length;
  const watchCount = projects.filter((p) => p.hasFinancialPlan && varRag(p.totals.variance, p.totals.budget) === "A").length;
  const okCount = projects.filter((p) => p.hasFinancialPlan && varRag(p.totals.variance, p.totals.budget) === "G").length;
  const noPlanCount = projects.filter((p) => !p.hasFinancialPlan).length;

  const filtered = useMemo(() => {
    let list = [...projects];
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((p) => p.title.toLowerCase().includes(q) || (p.projectCodeLabel ?? "").toLowerCase().includes(q));
    if (filter === "over") list = list.filter((p) => p.hasFinancialPlan && varRag(p.totals.variance, p.totals.budget) === "R");
    else if (filter === "watch") list = list.filter((p) => p.hasFinancialPlan && varRag(p.totals.variance, p.totals.budget) === "A");
    else if (filter === "ok") list = list.filter((p) => p.hasFinancialPlan && varRag(p.totals.variance, p.totals.budget) === "G");
    else if (filter === "no-plan") list = list.filter((p) => !p.hasFinancialPlan);
    list.sort((a, b) => {
      if (sort === "variance") return b.totals.variance - a.totals.variance;
      if (sort === "burn") return b.totals.burnPct - a.totals.burnPct;
      if (sort === "budget") return b.totals.budget - a.totals.budget;
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
        @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .brow:hover { background: #f9f7f4 !important; }
        input:focus { outline: none; }
      `}</style>

      <div style={{ minHeight: "100vh", background: T.bg, fontFamily: T.mono, opacity: mounted ? 1 : 0, transition: "opacity 0.35s" }}>
        <div style={{ maxWidth: 1360, margin: "0 auto", padding: "40px 40px 100px" }}>

          {/* ── Header ── */}
          <div style={{ borderBottom: `2px solid ${T.ink}`, paddingBottom: 22, marginBottom: 0, animation: "fadeUp 0.4s ease both" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Link href="/home" style={{ fontFamily: T.mono, fontSize: 10, color: T.ink4, textDecoration: "none", letterSpacing: "0.08em" }}>
                  {"<- PORTFOLIO INTELLIGENCE"}
                </Link>
                <span style={{ color: T.ink5 }}>{" · "}</span>
                <Cap>BUDGET REGISTER</Cap>
              </div>
              <Mono size={10} color={T.ink5}>{nowUK()}</Mono>
            </div>

            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 32 }}>
              <div>
                <h1 style={{ fontFamily: T.serif, fontSize: 42, fontWeight: 700, margin: 0, letterSpacing: "-0.02em", lineHeight: 1.05, color: T.ink }}>
                  Budget Intelligence
                </h1>
                <p style={{ fontFamily: T.body, fontSize: 14, color: T.ink3, marginTop: 8, fontWeight: 300, lineHeight: 1.5, maxWidth: 560 }}>
                  Financial health across all active projects -- forecast variance, burn rate and delivery exposure.
                </p>
              </div>
              {!loading && port && (
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <Mono size={10} color={T.ink4}>
                    {projects.length} projects -- {projects.filter(p => p.hasFinancialPlan).length} with plan
                  </Mono>
                  <div style={{ marginTop: 4 }}>
                    <Mono size={10} color={T.ink5}>Org scope -- live</Mono>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Tab bar ── */}
          <div style={{ display: "flex", borderBottom: `1px solid ${T.hr}`, marginBottom: 24, gap: 0 }}>
            <TabBtn label="Overview" active={activeTab === "overview"} onClick={() => setActiveTab("overview")} badge={String(projects.length)} />
            <TabBtn label="Monthly Phasing" active={activeTab === "phasing"} onClick={() => setActiveTab("phasing")} />
          </div>

          {/* ── OVERVIEW TAB ── */}
          {activeTab === "overview" && (
            <>
              {!loading && port && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", border: `1px solid ${T.hr}`, background: T.surface, marginBottom: 24, animation: "fadeUp 0.4s 0.08s ease both" }}>
                  <KpiCell label="Total Budget" value={fmt(port.totalBudget)} />
                  <KpiCell label="Forecast" value={fmt(port.totalForecast)} />
                  <KpiCell label="Actual Spend" value={fmt(port.totalActual)} />
                  <KpiCell label="Forecast Variance" value={signedFmt(totalVar)} color={totalVar > 0 ? RC.R.fg : RC.G.fg} note="Forecast minus budget" />
                  <KpiCell label="Over Budget" value={String(overCount)} color={overCount > 0 ? RC.R.fg : T.ink} />
                </div>
              )}

              <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: "14px 18px", marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                <div style={{ display: "flex", gap: 3 }}>
                  {(["all", "over", "watch", "ok", "no-plan"] as Filter[]).map((f) => {
                    const counts: Record<Filter, number> = { all: projects.length, over: overCount, watch: watchCount, ok: okCount, "no-plan": noPlanCount };
                    const labels: Record<Filter, string> = { all: "All", over: "Over Budget", watch: "Watch", ok: "On Track", "no-plan": "No Plan" };
                    return <Pill key={f} label={`${labels[f]} ${counts[f]}`} active={filter === f} onClick={() => setFilter(f)} />;
                  })}
                </div>

                <div style={{ width: 1, height: 20, background: T.hr }} />

                <div style={{ display: "flex", gap: 3 }}>
                  {(["variance", "burn", "budget", "title"] as SortKey[]).map((s) => {
                    const l: Record<SortKey, string> = { variance: "Forecast Variance", burn: "Burn", budget: "Budget", title: "A-Z" };
                    return <Pill key={s} label={l[s]} active={sort === s} onClick={() => setSort(s)} />;
                  })}
                </div>

                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search projects..."
                  style={{ marginLeft: "auto", padding: "6px 12px", fontFamily: T.mono, fontSize: 11, background: T.bg, border: `1px solid ${T.hr}`, borderRadius: 2, color: T.ink, width: 220 }}
                />
              </div>

              {loading ? (
                <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: 64, textAlign: "center" }}>
                  <Mono size={11} color={T.ink5}>RETRIEVING FINANCIAL DATA...</Mono>
                </div>
              ) : !data?.ok ? (
                <div style={{ background: RC.R.bg, border: `1px solid ${T.hr}`, borderLeft: `3px solid ${RC.R.fg}`, padding: "18px 24px" }}>
                  <Cap>Error</Cap>
                  <p style={{ fontFamily: T.body, fontSize: 13, color: RC.R.fg, margin: "8px 0 0" }}>{data?.error}</p>
                </div>
              ) : (
                <div style={{ background: T.surface, border: `1px solid ${T.hr}`, overflow: "hidden" }}>
                  {filtered.length === 0 ? (
                    <div style={{ padding: 64, textAlign: "center" }}>
                      <Mono size={12} color={T.ink5}>No projects match the current filters.</Mono>
                    </div>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                        <thead>
                          <tr>
                            <th style={{ ...TH, width: 3, padding: 0 }} />
                            <th style={{ ...TH, minWidth: 260 }}>Project</th>
                            <th style={{ ...TH, width: 120 }}>Budget</th>
                            <th style={{ ...TH, width: 120 }}>Forecast</th>
                            <th style={{ ...TH, width: 120 }}>Actual</th>
                            <th style={{ ...TH, width: 150 }}>Forecast Variance</th>
                            <th style={{ ...TH, width: 160 }}>Burn Rate</th>
                            <th style={{ ...TH, width: 120 }}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((p) => {
                            const rag = p.hasFinancialPlan ? varRag(p.totals.variance, p.totals.budget) : "N";
                            const brag = burnRag(p.totals.burnPct);
                            const rc = RC[rag];
                            return (
                              <tr key={p.projectId} className="brow" style={{ background: T.surface }}>
                                <td style={{ width: 3, padding: 0 }}>
                                  <div style={{ width: 3, minHeight: 54, background: rag === "N" ? "transparent" : rc.fg, opacity: rag === "G" ? 0.4 : 1 }} />
                                </td>
                                <td style={{ ...TD, minWidth: 260 }}>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                    <Link href={`/projects/${p.projectId}`} style={{ fontFamily: T.body, fontSize: 13.5, color: T.ink2, textDecoration: "none" }}>
                                      {p.title}
                                    </Link>
                                    {p.projectCodeLabel && <Mono size={10} color={T.ink5}>{p.projectCodeLabel}</Mono>}
                                  </div>
                                </td>
                                <td style={TD}><Mono size={12} color={T.ink3} weight={500}>{p.hasFinancialPlan ? fmt(p.totals.budget) : "--"}</Mono></td>
                                <td style={TD}><Mono size={12} color={T.ink3} weight={500}>{p.hasFinancialPlan ? fmt(p.totals.forecast) : "--"}</Mono></td>
                                <td style={TD}><Mono size={12} color={T.ink3} weight={500}>{p.hasFinancialPlan ? fmt(p.totals.actual) : "--"}</Mono></td>
                                <td style={TD}>
                                  {p.hasFinancialPlan ? (
                                    <Mono size={12} color={p.totals.variance > 0 ? RC.R.fg : RC.G.fg} weight={600}>{signedFmt(p.totals.variance)}</Mono>
                                  ) : (
                                    <Mono size={11} color={T.ink5}>No plan</Mono>
                                  )}
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
                    Org scope -- active projects only -- {projects.length} projects -- {filtered.length} shown
                  </Mono>
                  <Mono size={10} color={T.ink5}>{nowUK()}</Mono>
                </div>
              )}
            </>
          )}

          {/* ── MONTHLY PHASING TAB ── */}
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