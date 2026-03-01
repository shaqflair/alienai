"use client";
// FILE: src/app/(dashboard)/_components/DashboardClient.tsx

import { useState, useEffect, useCallback, useRef } from "react";
import type { DashboardData } from "../_lib/dashboard-data";

/* =============================================================================
   CONSTANTS + HELPERS
============================================================================= */

const REASON_EMOJI: Record<string, string> = {
  annual_leave:   "",
  public_holiday: "",
  training:       "",
  sick_leave:     "",
  parental_leave: "",
  other:          "[clipboard]",
};

function utilColour(pct: number) {
  if (pct > 110) return "#7c3aed";
  if (pct > 100) return "#ef4444";
  if (pct >= 75)  return "#f59e0b";
  if (pct > 0)    return "#10b981";
  return "#94a3b8";
}

function utilBg(pct: number) {
  if (pct > 110) return "rgba(124,58,237,0.09)";
  if (pct > 100) return "rgba(239,68,68,0.09)";
  if (pct >= 75)  return "rgba(245,158,11,0.09)";
  if (pct > 0)    return "rgba(16,185,129,0.09)";
  return "#f8fafc";
}

function initials(name: string) {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

const AVATAR_COLS = ["#00b8db","#3b82f6","#8b5cf6","#ec4899","#f59e0b","#10b981"];
function avatarCol(name: string) {
  return AVATAR_COLS[name.charCodeAt(0) % AVATAR_COLS.length];
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hrs   = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 2)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hrs  < 24) return `${hrs}h ago`;
  return `${days}d ago`;
}

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric", month: "short",
  });
}

/* =============================================================================
   SHARED COMPONENTS
============================================================================= */

function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: avatarCol(name), color: "#fff", flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.34, fontWeight: 800,
    }}>
      {initials(name)}
    </div>
  );
}

function Card({
  children, title, subtitle, action, accent,
}: {
  children:  React.ReactNode;
  title:     string;
  subtitle?: string;
  action?:   React.ReactNode;
  accent?:   string;
}) {
  return (
    <div style={{
      background: "white", borderRadius: "14px",
      border: "1.5px solid #e2e8f0",
      boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
      overflow: "hidden",
    }}>
      <div style={{
        padding: "16px 18px 12px",
        borderBottom: "1px solid #f1f5f9",
        background: accent ? `linear-gradient(135deg, ${accent}08 0%, transparent 60%)` : undefined,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: "14px", fontWeight: 800, color: "#0f172a" }}>{title}</div>
          {subtitle && (
            <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "1px" }}>{subtitle}</div>
          )}
        </div>
        {action}
      </div>
      <div style={{ padding: "16px 18px" }}>{children}</div>
    </div>
  );
}

function Pill({ value, label, colour }: { value: string | number; label: string; colour?: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{
        fontSize: "24px", fontWeight: 800, color: colour || "#0f172a",
        fontFamily: "'DM Mono', monospace", lineHeight: 1,
      }}>{value}</div>
      <div style={{ fontSize: "10px", color: "#94a3b8", marginTop: "3px",
                    textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
    </div>
  );
}

function Bar({ pct, colour, height = 6 }: { pct: number; colour: string; height?: number }) {
  return (
    <div style={{ height, background: "#f1f5f9", borderRadius: height / 2, overflow: "hidden" }}>
      <div style={{
        height: "100%", borderRadius: height / 2,
        width: `${Math.min(pct, 100)}%`,
        background: colour, transition: "width 0.5s ease",
      }} />
    </div>
  );
}

/* =============================================================================
   SECTION 1: UTILISATION OVERVIEW
============================================================================= */

function UtilisationSection({ data }: { data: DashboardData["utilisation"] }) {
  return (
    <Card
      title="Utilisation"
      subtitle="Last 4 weeks . active people"
      accent="#00b8db"
    >
      {/* KPI row */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
        gap: "12px", marginBottom: "16px",
        padding: "12px", background: "#f8fafc",
        borderRadius: "10px", border: "1px solid #f1f5f9",
      }}>
        <Pill value={`${data.avgPct}%`}       label="Avg util"       colour={utilColour(data.avgPct)} />
        <Pill value={`${data.peakPct}%`}      label="Peak util"      colour={utilColour(data.peakPct)} />
        <Pill value={data.overAllocCount}      label="Over-allocated" colour={data.overAllocCount > 0 ? "#ef4444" : "#94a3b8"} />
        <Pill value={data.underutilCount}      label="Under 50%"      colour={data.underutilCount > 0 ? "#f59e0b" : "#94a3b8"} />
      </div>

      {/* Per-person bars */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {data.byPerson.length === 0 ? (
          <div style={{ color: "#94a3b8", fontSize: "13px", textAlign: "center", padding: "12px 0" }}>
            No allocation data yet.
          </div>
        ) : data.byPerson.map(p => (
          <div key={p.personId} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Avatar name={p.fullName} size={22} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                display: "flex", justifyContent: "space-between",
                fontSize: "12px", marginBottom: "3px",
              }}>
                <span style={{
                  fontWeight: 600, color: "#334155",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  maxWidth: "140px",
                }}>
                  {p.fullName.split(" ")[0]}
                </span>
                <span style={{
                  fontWeight: 800, color: utilColour(p.utilPct),
                  fontFamily: "'DM Mono', monospace", fontSize: "11px",
                }}>
                  {p.utilPct}%
                </span>
              </div>
              <Bar pct={p.utilPct} colour={utilColour(p.utilPct)} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* =============================================================================
   SECTION 2: THIS WEEK
============================================================================= */

const REASON_COLOUR: Record<string, string> = {
  annual_leave:   "#3b82f6",
  public_holiday: "#8b5cf6",
  training:       "#f59e0b",
  sick_leave:     "#ef4444",
  parental_leave: "#ec4899",
  other:          "#64748b",
};

function ThisWeekSection({ data }: { data: DashboardData["thisWeek"] }) {
  const freeCapPct = data.totalCapacity > 0
    ? Math.round((data.freeCapacity / data.totalCapacity) * 100)
    : 0;

  return (
    <Card
      title="This Week"
      subtitle={`w/c ${formatDate(data.weekStart)}`}
      accent="#10b981"
    >
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
        gap: "10px", marginBottom: "14px",
      }}>
        <Pill value={data.leaveCount}        label="On leave"      colour="#3b82f6" />
        <Pill value={`${data.capacityLost}d`} label="Capacity lost" colour="#ef4444" />
        <Pill value={`${data.freeCapacity}d`} label="Available cap" colour="#10b981" />
      </div>

      {/* Free capacity bar */}
      <div style={{ marginBottom: "14px" }}>
        <div style={{
          display: "flex", justifyContent: "space-between",
          fontSize: "11px", color: "#94a3b8", marginBottom: "4px",
        }}>
          <span>Available capacity this week</span>
          <span style={{ color: "#10b981", fontWeight: 700 }}>{freeCapPct}%</span>
        </div>
        <Bar pct={freeCapPct} colour="#10b981" height={8} />
      </div>

      {/* Leave people */}
      {data.leavePeople.length === 0 ? (
        <div style={{ color: "#94a3b8", fontSize: "12px", textAlign: "center" }}>
          [check] No leave logged this week
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {data.leavePeople.map(p => (
            <div key={p.personId} style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: "7px 10px", borderRadius: "8px",
              background: `${REASON_COLOUR[p.reason] || "#64748b"}08`,
              border: `1px solid ${REASON_COLOUR[p.reason] || "#64748b"}20`,
            }}>
              <span style={{ fontSize: "14px" }}>{REASON_EMOJI[p.reason] || "[clipboard]"}</span>
              <Avatar name={p.fullName} size={22} />
              <span style={{ fontSize: "12px", fontWeight: 600, color: "#334155", flex: 1 }}>
                {p.fullName.split(" ")[0]}
              </span>
              <span style={{
                fontSize: "11px", fontWeight: 700,
                color: REASON_COLOUR[p.reason] || "#64748b",
                fontFamily: "'DM Mono', monospace",
              }}>
                {p.availableDays === 0 ? "Off" : `${p.availableDays}d`}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* =============================================================================
   SECTION 3: PIPELINE AT RISK
============================================================================= */

function PipelineSection({ data }: { data: DashboardData["pipeline"] }) {
  return (
    <Card
      title="Pipeline at risk"
      subtitle="Unfilled roles on live pipeline"
      accent="#7c3aed"
      action={
        <a href="/heatmap" style={{
          fontSize: "11px", color: "#7c3aed", fontWeight: 700,
          textDecoration: "none",
        }}>View heatmap  {'->'}</a>
      }
    >
      {data.length === 0 ? (
        <div style={{ color: "#94a3b8", fontSize: "13px", textAlign: "center", padding: "8px 0" }}>
          [check] No unfilled pipeline roles
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {data.map(p => (
            <div key={p.projectId} style={{
              display: "flex", alignItems: "center", gap: "10px",
              padding: "10px 12px", borderRadius: "9px",
              background: `${p.colour}08`,
              border: `1.5px solid ${p.colour}25`,
            }}>
              <div style={{
                width: "3px", height: "32px", borderRadius: "2px",
                background: p.colour, flexShrink: 0,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>
                  {p.title}
                </div>
                <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "1px" }}>
                  {p.startDate ? formatDate(p.startDate) : "TBD"} .{" "}
                  {p.unfilledRoles}/{p.totalRoles} roles unfilled
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{
                  fontSize: "13px", fontWeight: 800,
                  color: "#ef4444", fontFamily: "'DM Mono', monospace",
                }}>
                  {p.unfilledDays}d
                </div>
                <div style={{
                  fontSize: "10px", color: "#94a3b8",
                  background: `${p.colour}15`,
                  borderRadius: "4px", padding: "1px 5px",
                  fontWeight: 600,
                }}>
                  {p.winProbability}% win
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* =============================================================================
   SECTION 4: RECENT ACTIVITY
============================================================================= */

function ActivitySection({ data }: { data: DashboardData["recentActivity"] }) {
  return (
    <Card
      title="Recent activity"
      subtitle="Latest allocation changes"
      action={
        <a href="/allocations/new" style={{
          fontSize: "11px", color: "#00b8db", fontWeight: 700,
          textDecoration: "none",
        }}>+ Allocate  {'->'}</a>
      }
    >
      {data.length === 0 ? (
        <div style={{ color: "#94a3b8", fontSize: "13px", textAlign: "center", padding: "8px 0" }}>
          No recent allocations.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
          {data.slice(0, 8).map((a, i) => (
            <div key={a.id} style={{
              display: "flex", alignItems: "center", gap: "10px",
              padding: "9px 0",
              borderBottom: i < 7 ? "1px solid #f8fafc" : "none",
            }}>
              <Avatar name={a.personName} size={26} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "12px", fontWeight: 600, color: "#334155" }}>
                  {a.personName.split(" ")[0]}
                  <span style={{ color: "#94a3b8", fontWeight: 400 }}>  {'->'}</span>
                  <span style={{ color: a.colour }}>{a.projectCode || a.projectTitle}</span>
                </div>
                <div style={{ fontSize: "11px", color: "#94a3b8" }}>
                  {a.daysAllocated}d/wk . w/c {formatDate(a.weekStart)}
                  {a.allocType === "soft" && (
                    <span style={{ color: "#f59e0b", marginLeft: "4px" }}>(soft)</span>
                  )}
                </div>
              </div>
              <div style={{ fontSize: "11px", color: "#cbd5e1", flexShrink: 0 }}>
                {timeAgo(a.createdAt)}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* =============================================================================
   SECTION 5: BUDGET BURN
============================================================================= */

function BudgetSection({ data }: { data: DashboardData["budgetBurn"] }) {
  return (
    <Card
      title="Budget burn"
      subtitle="Allocated days vs budget . confirmed projects"
      accent="#f59e0b"
    >
      {data.length === 0 ? (
        <div style={{ color: "#94a3b8", fontSize: "13px", textAlign: "center", padding: "8px 0" }}>
          No active project allocations.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {data.map(p => {
            const pct = p.burnPct ?? 0;
            return (
              <div key={p.projectId}>
                <div style={{
                  display: "flex", justifyContent: "space-between",
                  alignItems: "center", marginBottom: "5px",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                    <div style={{
                      width: "8px", height: "8px", borderRadius: "50%",
                      background: p.colour, flexShrink: 0,
                    }} />
                    <span style={{
                      fontSize: "12px", fontWeight: 700, color: "#334155",
                    }}>
                      {p.projectCode || p.title}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <span style={{
                      fontSize: "11px", color: "#94a3b8",
                      fontFamily: "'DM Mono', monospace",
                    }}>
                      {p.allocatedDays}d
                      {p.budgetDays ? ` / ${p.budgetDays}d` : ""}
                    </span>
                    {p.burnPct != null && (
                      <span style={{
                        fontSize: "11px", fontWeight: 800,
                        color: utilColour(pct),
                        fontFamily: "'DM Mono', monospace",
                      }}>
                        {pct}%
                      </span>
                    )}
                  </div>
                </div>
                {p.budgetDays ? (
                  <Bar pct={pct} colour={utilColour(pct)} height={5} />
                ) : (
                  <div style={{
                    height: "5px", background: `${p.colour}30`,
                    borderRadius: "3px", overflow: "hidden",
                  }}>
                    <div style={{
                      height: "100%", width: "100%",
                      background: `repeating-linear-gradient(
                        90deg, ${p.colour}40 0px, ${p.colour}40 4px, transparent 4px, transparent 8px
                      )`,
                    }} />
                  </div>
                )}
                {p.burnPct != null && p.burnPct > 90 && (
                  <div style={{ fontSize: "10px", color: "#ef4444", marginTop: "3px", fontWeight: 600 }}>
                    (!) {pct > 100 ? `${pct - 100}% over budget` : "Near budget limit"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/* =============================================================================
   SECTION 6: HEADCOUNT BY DEPT
============================================================================= */

function HeadcountSection({ data }: { data: DashboardData["headcount"] }) {
  const maxTotal = Math.max(...data.map(d => d.total), 1);

  return (
    <Card
      title="Headcount"
      subtitle="By department . active people"
      action={
        <a href="/people" style={{
          fontSize: "11px", color: "#00b8db", fontWeight: 700,
          textDecoration: "none",
        }}>Manage  {'->'}</a>
      }
    >
      {data.length === 0 ? (
        <div style={{ color: "#94a3b8", fontSize: "13px", textAlign: "center", padding: "8px 0" }}>
          No department data.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {data.map(d => (
            <div key={d.department}>
              <div style={{
                display: "flex", justifyContent: "space-between",
                fontSize: "12px", marginBottom: "4px",
              }}>
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  <span style={{ fontWeight: 700, color: "#334155" }}>{d.department}</span>
                  {d.contractors > 0 && (
                    <span style={{
                      fontSize: "10px", color: "#7c3aed", fontWeight: 700,
                      background: "rgba(124,58,237,0.08)", borderRadius: "4px",
                      padding: "1px 5px",
                    }}>{d.contractors} ctr</span>
                  )}
                </div>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  <span style={{
                    fontSize: "11px", color: utilColour(d.avgUtil), fontWeight: 700,
                    fontFamily: "'DM Mono', monospace",
                  }}>
                    {d.avgUtil > 0 ? `${d.avgUtil}%` : "--"}
                  </span>
                  <span style={{
                    fontSize: "12px", fontWeight: 800,
                    color: "#0f172a", fontFamily: "'DM Mono', monospace",
                  }}>
                    {d.total}
                  </span>
                </div>
              </div>
              <div style={{ height: "6px", background: "#f1f5f9", borderRadius: "3px", overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: "3px",
                  width: `${(d.total / maxTotal) * 100}%`,
                  background: d.avgUtil > 0 ? utilColour(d.avgUtil) : "#cbd5e1",
                  transition: "width 0.4s",
                }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* =============================================================================
   MAIN DASHBOARD
============================================================================= */

const REFRESH_MS = 30_000;

export default function DashboardClient({
  initialData,
}: {
  initialData: DashboardData;
}) {
  const [data,        setData]       = useState(initialData);
  const [loading,     setLoading]    = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date(initialData.fetchedAt));
  const [countdown,   setCountdown]  = useState(REFRESH_MS / 1000);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch("/api/dashboard", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setLastRefresh(new Date(json.fetchedAt));
      setCountdown(REFRESH_MS / 1000);
    } catch (err) {
      console.error("[dashboard] refresh failed", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Auto-refresh every 30s
    intervalRef.current  = setInterval(refresh, REFRESH_MS);
    // Countdown ticker
    countdownRef.current = setInterval(() => {
      setCountdown(c => c > 0 ? c - 1 : REFRESH_MS / 1000);
    }, 1000);

    return () => {
      if (intervalRef.current)  clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [refresh]);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>

      <div style={{
        fontFamily: "'DM Sans', sans-serif",
        minHeight: "100vh", background: "#f8fafc",
        padding: "36px 28px",
      }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto" }}>

          {/* -- Header -- */}
          <div style={{
            display: "flex", alignItems: "center",
            justifyContent: "space-between", marginBottom: "28px",
            flexWrap: "wrap", gap: "12px",
          }}>
            <div>
              <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a",
                           margin: 0, marginBottom: "4px" }}>Dashboard</h1>
              <p style={{ fontSize: "13px", color: "#94a3b8", margin: 0 }}>
                {data.utilisation.totalPeople} people .{" "}
                Last updated {lastRefresh.toLocaleTimeString("en-GB", {
                  hour: "2-digit", minute: "2-digit",
                })}
              </p>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              {/* Countdown ring */}
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <div style={{
                  width: "8px", height: "8px", borderRadius: "50%",
                  background: loading ? "#f59e0b" : "#10b981",
                  animation: loading ? "pulse 0.8s infinite" : "none",
                }} />
                <span style={{ fontSize: "12px", color: "#94a3b8" }}>
                  {loading ? "Refreshing..." : `Next refresh in ${countdown}s`}
                </span>
              </div>
              <button type="button" onClick={refresh} disabled={loading} style={{
                padding: "7px 14px", borderRadius: "8px",
                border: "1.5px solid #e2e8f0", background: "white",
                color: "#475569", fontSize: "12px", fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
              }}>
                 Refresh
              </button>
              <a href="/heatmap" style={{
                padding: "7px 14px", borderRadius: "8px",
                border: "none", background: "#00b8db", color: "white",
                fontSize: "12px", fontWeight: 700, textDecoration: "none",
              }}>
                # Heatmap
              </a>
            </div>
          </div>

          {/* -- Top KPI strip -- */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(5, 1fr)",
            gap: "12px", marginBottom: "20px",
          }}>
            {[
              { l: "People",        v: data.utilisation.totalPeople,                    c: "#0f172a" },
              { l: "Avg util",      v: `${data.utilisation.avgPct}%`,                  c: utilColour(data.utilisation.avgPct) },
              { l: "Over-alloc",    v: data.utilisation.overAllocCount,                 c: data.utilisation.overAllocCount > 0 ? "#ef4444" : "#10b981" },
              { l: "On leave",      v: data.thisWeek.leaveCount,                        c: "#3b82f6" },
              { l: "Pipeline gaps", v: data.pipeline.length,                            c: data.pipeline.length > 0 ? "#7c3aed" : "#10b981" },
            ].map(s => (
              <div key={s.l} style={{
                background: "white", borderRadius: "12px",
                border: "1.5px solid #e2e8f0", padding: "14px 16px",
                boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
              }}>
                <div style={{ fontSize: "10px", color: "#94a3b8", textTransform: "uppercase",
                              letterSpacing: "0.06em", marginBottom: "5px" }}>{s.l}</div>
                <div style={{ fontSize: "22px", fontWeight: 800,
                              color: s.c, fontFamily: "'DM Mono', monospace" }}>{s.v}</div>
              </div>
            ))}
          </div>

          {/* -- Main grid -- */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gridTemplateRows: "auto auto",
            gap: "16px",
          }}>
            {/* Row 1 */}
            <UtilisationSection data={data.utilisation} />
            <ThisWeekSection    data={data.thisWeek}    />
            <PipelineSection    data={data.pipeline}    />

            {/* Row 2 */}
            <ActivitySection    data={data.recentActivity} />
            <BudgetSection      data={data.budgetBurn}     />
            <HeadcountSection   data={data.headcount}      />
          </div>

        </div>
      </div>
    </>
  );
}