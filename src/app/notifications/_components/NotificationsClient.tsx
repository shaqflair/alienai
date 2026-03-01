"use client";

import { useState, useMemo } from "react";
import type { Alert, AlertSeverity, AlertType } from "../_lib/notifications-engine";

/* =============================================================================
   HELPERS & CONSTANTS
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
  over_allocation:   "🔴",
  under_utilisation: "🟡",
  upcoming_leave:    "📅",
  pipeline_starting: "⚡",
  project_ending:    "🏁",
  budget_exhausted:  "💸",
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
      <span style={{ fontSize: "18px", flexShrink: 0, marginTop: "1px" }}>{TYPE_EMOJI[alert.type]}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" }}>
          <span style={{
            fontSize: "10px", fontWeight: 800, color: colour,
            textTransform: "uppercase", letterSpacing: "0.06em",
            background: `${colour}15`, padding: "1px 6px", borderRadius: "4px",
          }}>{TYPE_LABEL[alert.type]}</span>
        </div>
        <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a", marginBottom: "3px" }}>{alert.title}</div>
        <div style={{ fontSize: "13px", color: "#475569", marginBottom: "8px" }}>{alert.body}</div>
        <a href={alert.href} style={{
          display: "inline-flex", alignItems: "center", gap: "4px",
          fontSize: "12px", fontWeight: 700, color: colour,
          textDecoration: "none", padding: "4px 10px", borderRadius: "6px",
          border: `1.5px solid ${colour}30`, background: `${colour}08`, transition: "all 0.15s",
        }}>View details →</a>
      </div>
      <button type="button" onClick={() => onDismiss(alert.id)} style={{
        flexShrink: 0, background: "none", border: "none", color: "#cbd5e1", cursor: "pointer", fontSize: "14px"
      }}>✕</button>
    </div>
  );
}

/* =============================================================================
   MAIN COMPONENT
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
  const [genAt,        setGenAt]       = useState(generatedAt);

  async function refresh() {
    setLoading(true);
    try {
      const res  = await fetch("/api/notifications", { cache: "no-store" });
      const json = await res.json();
      setAlerts(json.alerts ?? []);
      setGenAt(json.generatedAt);
      setDismissed(new Set());
    } catch {}
    finally { setLoading(false); }
  }

  function dismiss(id: string) { setDismissed(d => new Set([...d, id])); }
  function dismissAll() { setDismissed(new Set(alerts.map(a => a.id))); }

  const filtered = useMemo(() => alerts.filter(a => {
    if (dismissed.has(a.id))         return false;
    if (filterSev  !== "all" && a.severity !== filterSev)  return false;
    if (filterType !== "all" && a.type     !== filterType) return false;
    return true;
  }), [alerts, dismissed, filterSev, filterType]);

  const stats = [
    { l: "Critical",  v: filtered.filter(a => a.severity === "critical").length, c: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
    { l: "Warnings",  v: filtered.filter(a => a.severity === "warning").length,  c: "#d97706", bg: "#fffbeb", border: "#fde68a" },
    { l: "Info",      v: filtered.filter(a => a.severity === "info").length,     c: "#0891b2", bg: "#f0f9ff", border: "#bae6fd" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: "36px 28px" }}>
      <style>{`@keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }`}</style>
      <div style={{ maxWidth: "860px", margin: "0 auto" }}>
        
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "24px" }}>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: 0 }}>Notifications</h1>
            <p style={{ fontSize: "13px", color: "#94a3b8" }}>Last computed {new Date(genAt).toLocaleTimeString()} · {alerts.length - dismissed.size} active</p>
          </div>
          <button onClick={refresh} disabled={loading} style={{ padding: "8px 18px", borderRadius: "8px", background: "#0e7490", color: "white", border: "none", cursor: "pointer" }}>
            {loading ? "Checking..." : "↻ Check now"}
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "20px" }}>
          {stats.map(s => (
            <button key={s.l} onClick={() => setFilterSev(filterSev === s.l.toLowerCase() as any ? "all" : s.l.toLowerCase() as any)}
              style={{ background: filterSev === s.l.toLowerCase() ? s.bg : "white", border: `1.5px solid ${s.border}`, borderRadius: "10px", padding: "12px", cursor: "pointer", textAlign: "left" }}>
              <div style={{ fontSize: "22px", fontWeight: 800, color: s.c }}>{s.v}</div>
              <div style={{ fontSize: "10px", color: "#94a3b8", textTransform: "uppercase" }}>{s.l}</div>
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "48px", textAlign: "center", background: "white", borderRadius: "14px", border: "1.5px solid #e2e8f0" }}>All clear!</div>
          ) : (
            filtered.map(a => <AlertCard key={a.id} alert={a} dismissed={false} onDismiss={dismiss} />)
          )}
        </div>
      </div>
    </div>
  );
}
