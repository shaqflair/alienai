"use client";
// FILE: src/app/notifications/_components/NotificationsClient.tsx

import { useState, useMemo } from "react";
import type { Alert, AlertSeverity, AlertType } from "../_lib/notifications-engine";

/* =============================================================================
   HELPERS
============================================================================= */

const SEVERITY_COLOUR: Record<AlertSeverity, string> = {
  critical: "#dc2626",
  warning:  "#d97706",
  info:      "#0891b2",
};

const SEVERITY_BG: Record<AlertSeverity, string> = {
  critical: "#fef2f2",
  warning:  "#fffbeb",
  info:      "#f0f9ff",
};

const SEVERITY_BORDER: Record<AlertSeverity, string> = {
  critical: "#fecaca",
  warning:  "#fde68a",
  info:      "#bae6fd",
};

const TYPE_EMOJI: Record<AlertType, string> = {
  over_allocation:   "⚠️",
  under_utilisation: "📉",
  upcoming_leave:    "📅",
  pipeline_starting: "🚀",
  project_ending:    "🏁",
  budget_exhausted:  "💰",
};

const TYPE_LABEL: Record<AlertType, string> = {
  over_allocation:   "Over-allocated",
  under_utilisation: "Under-utilised",
  upcoming_leave:    "Upcoming leave",
  pipeline_starting: "Pipeline risk",
  project_ending:    "Project ending",
  budget_exhausted:  "Budget alert",
};

const TYPE_DESC: Record<AlertType, string> = {
  over_allocation:   "Person allocated > 100% capacity in a future week",
  under_utilisation: "Person below 40% utilisation for 2+ consecutive weeks",
  upcoming_leave:    "Capacity exception logged for this week or next",
  pipeline_starting: "Pipeline project starting within 4 weeks with unfilled roles",
  project_ending:    "Confirmed project ending within 2 weeks with active allocations",
  budget_exhausted:  "Project budget > 90% consumed",
};

const ALL_TYPES: AlertType[] = [
  "over_allocation", "budget_exhausted", "pipeline_starting",
  "project_ending", "upcoming_leave", "under_utilisation",
];

/* =============================================================================
   ALERT CARD
============================================================================= */

function AlertCard({ alert, dismissed, onDismiss }: {
  alert: Alert;
  dismissed: boolean;
  onDismiss: (id: string) => void;
}) {
  const colour = SEVERITY_COLOUR[alert.severity];
  const bg     = SEVERITY_BG[alert.severity];
  const border = SEVERITY_BORDER[alert.severity];

  if (dismissed) return null;

  return (
    <div style={{
      background: bg, border: `1.5px solid ${border}`,
      borderLeft: `4px solid ${colour}`,
      borderRadius: "10px", padding: "14px 16px",
      display: "flex", gap: "12px", alignItems: "flex-start",
      animation: "fadeIn 0.2s ease",
    }}>
      <span style={{ fontSize: "18px", flexShrink: 0, marginTop: "1px" }}>
        {TYPE_EMOJI[alert.type]}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" }}>
          <span style={{
            fontSize: "10px", fontWeight: 800, color: colour,
            textTransform: "uppercase", letterSpacing: "0.06em",
            background: `${colour}15`, padding: "1px 6px", borderRadius: "4px",
          }}>{TYPE_LABEL[alert.type]}</span>
        </div>

        <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a", marginBottom: "3px" }}>
          {alert.title}
        </div>
        <div style={{ fontSize: "13px", color: "#475569", marginBottom: "8px" }}>
          {alert.body}
        </div>

        <a href={alert.href} style={{
          display: "inline-flex", alignItems: "center", gap: "4px",
          fontSize: "12px", fontWeight: 700, color: colour,
          textDecoration: "none",
          padding: "4px 10px", borderRadius: "6px",
          border: `1.5px solid ${colour}30`,
          background: `${colour}08`,
          transition: "all 0.15s",
        }}>
          View details {'->'}
        </a>
      </div>

      <button type="button" onClick={() => onDismiss(alert.id)} style={{
        flexShrink: 0, background: "none", border: "none",
        color: "#cbd5e1", cursor: "pointer", fontSize: "14px",
        lineHeight: 1, padding: "2px",
        transition: "color 0.15s",
      }}
        onMouseEnter={e => (e.currentTarget.style.color = "#94a3b8")}
        onMouseLeave={e => (e.currentTarget.style.color = "#cbd5e1")}
        title="Dismiss"
      >x</button>
    </div>
  );
}

/* =============================================================================
   MAIN
============================================================================= */

export default function NotificationsClient({
  initialAlerts,
  generatedAt,
}: {
  initialAlerts: Alert[];
  generatedAt:   string;
}) {
  const [alerts,      setAlerts]      = useState(initialAlerts);
  const [dismissed,   setDismissed]   = useState<Set<string>>(new Set());
  const [loading,      setLoading]     = useState(false);
  const [filterSev,   setFilterSev]   = useState<AlertSeverity | "all">("all");
  const [filterType,  setFilterType]  = useState<AlertType | "all">("all");
  const [genAt,       setGenAt]       = useState(generatedAt);

  async function refresh() {
    setLoading(true);
    try {
      const res  = await fetch("/api/notifications", { cache: "no-store" });
      const json = await res.json();
      setAlerts(json.alerts ?? []);
      setGenAt(json.generatedAt);
      setDismissed(new Set()); // clear dismissed on refresh
    } catch {}
    finally { setLoading(false); }
  }

  function dismiss(id: string) {
    setDismissed(d => new Set([...d, id]));
  }

  function dismissAll() {
    setDismissed(new Set(alerts.map(a => a.id)));
  }

  const filtered = useMemo(() => alerts.filter(a => {
    if (dismissed.has(a.id))         return false;
    if (filterSev  !== "all" && a.severity !== filterSev)  return false;
    if (filterType !== "all" && a.type     !== filterType) return false;
    return true;
  }), [alerts, dismissed, filterSev, filterType]);

  const critCount = filtered.filter(a => a.severity === "critical").length;
  const warnCount = filtered.filter(a => a.severity === "warning").length;
  const infoCount = filtered.filter(a => a.severity === "info").length;

  const grouped = {
    critical: filtered.filter(a => a.severity === "critical"),
    warning:  filtered.filter(a => a.severity === "warning"),
    info:      filtered.filter(a => a.severity === "info"),
  };

  const genTime = new Date(genAt).toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit",
  });

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      <div style={{
        fontFamily: "'DM Sans', sans-serif",
        minHeight: "100vh", background: "#f8fafc", padding: "36px 28px",
      }}>
        <div style={{ maxWidth: "860px", margin: "0 auto" }}>

          {/* Header */}
          <div style={{
            display: "flex", alignItems: "flex-start",
            justifyContent: "space-between", marginBottom: "24px",
            flexWrap: "wrap", gap: "12px",
          }}>
            <div>
              <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a",
                           margin: 0, marginBottom: "4px" }}>Notifications</h1>
              <p style={{ fontSize: "13px", color: "#94a3b8", margin: 0 }}>
                Last computed {genTime} . {alerts.length - dismissed.size} active alerts
              </p>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              {filtered.length > 0 && (
                <button type="button" onClick={dismissAll} style={{
                  padding: "8px 14px", borderRadius: "8px",
                  border: "1.5px solid #e2e8f0", background: "white",
                  color: "#64748b", fontSize: "12px", fontWeight: 600, cursor: "pointer",
                }}>Dismiss all</button>
              )}
              <button type="button" onClick={refresh} disabled={loading} style={{
                padding: "8px 18px", borderRadius: "8px", border: "none",
                background: loading ? "#94a3b8" : "#0e7490", color: "white",
                fontSize: "12px", fontWeight: 700, cursor: loading ? "not-allowed" : "pointer",
                boxShadow: "0 2px 10px rgba(14,116,144,0.25)",
              }}>
                {loading ? "Checking..." : " Check now"}
              </button>
            </div>
          </div>

          {/* KPI strip */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
            gap: "12px", marginBottom: "20px",
          }}>
            {[
              { l: "Critical",  v: critCount, c: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
              { l: "Warnings",  v: warnCount, c: "#d97706", bg: "#fffbeb", border: "#fde68a" },
              { l: "Info",      v: infoCount, c: "#0891b2", bg: "#f0f9ff", border: "#bae6fd" },
            ].map(s => (
              <button key={s.l} type="button"
                onClick={() => setFilterSev(filterSev === s.l.toLowerCase() as AlertSeverity ? "all" : s.l.toLowerCase() as AlertSeverity)}
                style={{
                  background: filterSev === s.l.toLowerCase() ? s.bg : "white",
                  border: `1.5px solid ${filterSev === s.l.toLowerCase() ? s.border : "#e2e8f0"}`,
                  borderRadius: "10px", padding: "12px 16px",
                  cursor: "pointer", textAlign: "left",
                  transition: "all 0.15s",
                }}>
                <div style={{ fontSize: "22px", fontWeight: 800,
                              color: s.c, fontFamily: "monospace" }}>{s.v}</div>
                <div style={{ fontSize: "10px", color: "#94a3b8",
                              textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.l}</div>
              </button>
            ))}
          </div>

          {/* Type filter pills */}
          <div style={{ display: "flex", gap: "6px", marginBottom: "20px", flexWrap: "wrap" }}>
            <button type="button" onClick={() => setFilterType("all")} style={{
              padding: "5px 12px", borderRadius: "20px",
              border: "1.5px solid",
              borderColor: filterType === "all" ? "#0e7490" : "#e2e8f0",
              background: filterType === "all" ? "rgba(14,116,144,0.08)" : "white",
              color: filterType === "all" ? "#0e7490" : "#64748b",
              fontSize: "12px", fontWeight: 600, cursor: "pointer",
            }}>All types</button>
            {ALL_TYPES.map(t => {
              const count = alerts.filter(a => a.type === t && !dismissed.has(a.id)).length;
              if (count === 0) return null;
              return (
                <button key={t} type="button" onClick={() => setFilterType(filterType === t ? "all" : t)} style={{
                  padding: "5px 12px", borderRadius: "20px",
                  border: "1.5px solid",
                  borderColor: filterType === t ? "#0e7490" : "#e2e8f0",
                  background: filterType === t ? "rgba(14,116,144,0.08)" : "white",
                  color: filterType === t ? "#0e7490" : "#64748b",
                  fontSize: "12px", fontWeight: 600, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: "5px",
                }}>
                  <span>{TYPE_EMOJI[t]}</span>
                  <span>{TYPE_LABEL[t]}</span>
                  <span style={{
                    background: "#e2e8f0", color: "#64748b",
                    borderRadius: "10px", padding: "0 5px",
                    fontSize: "10px", fontWeight: 800,
                  }}>{count}</span>
                </button>
              );
            })}
          </div>

          {/* Alert groups */}
          {filtered.length === 0 ? (
            <div style={{
              background: "white", borderRadius: "14px",
              border: "1.5px solid #e2e8f0",
              padding: "48px 0", textAlign: "center",
            }}>
              <div style={{ fontSize: "32px", marginBottom: "10px" }}>✅</div>
              <div style={{ fontSize: "15px", fontWeight: 700, color: "#0f172a" }}>
                {dismissed.size > 0 ? "All alerts dismissed" : "No active alerts"}
              </div>
              <div style={{ fontSize: "13px", color: "#94a3b8", marginTop: "4px" }}>
                {dismissed.size > 0
                  ? <button type="button" onClick={() => setDismissed(new Set())} style={{
                      background: "none", border: "none", color: "#0891b2",
                      cursor: "pointer", fontSize: "13px", fontWeight: 600,
                    }}>Restore dismissed alerts</button>
                  : "Everything looks healthy across your organisation"
                }
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {(["critical", "warning", "info"] as AlertSeverity[]).map(sev => {
                const group = grouped[sev];
                if (!group.length) return null;
                const label = sev.charAt(0).toUpperCase() + sev.slice(1);
                const colour = SEVERITY_COLOUR[sev];
                return (
                  <div key={sev}>
                    <div style={{
                      fontSize: "11px", fontWeight: 800, color: colour,
                      textTransform: "uppercase", letterSpacing: "0.08em",
                      marginBottom: "8px",
                      display: "flex", alignItems: "center", gap: "8px",
                    }}>
                      <span>{label}</span>
                      <span style={{
                        background: `${colour}15`, color: colour,
                        borderRadius: "10px", padding: "1px 7px", fontSize: "11px",
                      }}>{group.length}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {group.map(alert => (
                        <AlertCard
                          key={alert.id}
                          alert={alert}
                          dismissed={dismissed.has(alert.id)}
                          onDismiss={dismiss}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Alert type legend */}
          <div style={{
            marginTop: "24px", padding: "16px 20px",
            background: "white", borderRadius: "12px",
            border: "1.5px solid #e2e8f0",
          }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#475569", marginBottom: "10px" }}>
              Alert definitions
            </div>
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr",
              gap: "8px",
            }}>
              {ALL_TYPES.map(t => (
                <div key={t} style={{ display: "flex", gap: "8px", fontSize: "12px" }}>
                  <span style={{ flexShrink: 0 }}>{TYPE_EMOJI[t]}</span>
                  <div>
                    <span style={{ fontWeight: 700, color: "#334155" }}>{TYPE_LABEL[t]}</span>
                    <span style={{ color: "#94a3b8", marginLeft: "5px" }}>-- {TYPE_DESC[t]}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
