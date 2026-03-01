"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import type { Alert, AlertSeverity, AlertType } from "@/app/notifications/_lib/notifications-engine";

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

const REFRESH_MS = 60_000;

function BellIcon({ hasUnread }: { hasUnread: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
         stroke={hasUnread ? "#dc2626" : "currentColor"} strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function AlertItem({ alert, onClick }: { alert: Alert; onClick: () => void }) {
  const colour = SEVERITY_COLOUR[alert.severity];
  const bg     = SEVERITY_BG[alert.severity];

  return (
    <a href={alert.href} onClick={onClick}
      style={{
        display: "block", padding: "10px 14px", background: bg,
        borderLeft: `3px solid ${colour}`, textDecoration: "none", transition: "opacity 0.15s",
      }}
      onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
      onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
        <span style={{ fontSize: "13px", flexShrink: 0, marginTop: "1px" }}>{TYPE_EMOJI[alert.type]}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {alert.title}
          </div>
          <div style={{ fontSize: "11px", color: "#64748b", marginTop: "1px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {alert.body}
          </div>
        </div>
        <span style={{ fontSize: "10px", color: "#94a3b8", flexShrink: 0 }}>{TYPE_LABEL[alert.type]}</span>
      </div>
    </a>
  );
}

export default function NotificationBell() {
  const [alerts,  setAlerts]  = useState<Alert[]>([]);
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(true);
  const [seen,    setSeen]    = useState<Set<string>>(new Set());
  const panelRef  = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const fetchAlerts = useCallback(async () => {
    try {
      const res  = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      setAlerts(json.alerts ?? []);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const iv = setInterval(fetchAlerts, REFRESH_MS);
    return () => clearInterval(iv);
  }, [fetchAlerts]);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node) &&
          buttonRef.current && !buttonRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const unseenAlerts = alerts.filter(a => !seen.has(a.id));
  const criticalCount = unseenAlerts.filter(a => a.severity === "critical").length;
  const warningCount  = unseenAlerts.filter(a => a.severity === "warning").length;
  const unreadCount   = unseenAlerts.length;

  function handleOpen() {
    setOpen(o => !o);
    if (!open) setSeen(new Set(alerts.map(a => a.id)));
  }

  const grouped = {
    critical: alerts.filter(a => a.severity === "critical"),
    warning:  alerts.filter(a => a.severity === "warning"),
    info:     alerts.filter(a => a.severity === "info"),
  };

  return (
    <div style={{ position: "relative" }}>
      <button ref={buttonRef} type="button" onClick={handleOpen}
        style={{
          position: "relative", display: "flex", alignItems: "center", justifyContent: "center",
          width: "34px", height: "34px", borderRadius: "8px",
          border: open ? "1.5px solid rgba(255,255,255,0.2)" : "1.5px solid transparent",
          background: open ? "rgba(255,255,255,0.08)" : "transparent",
          color: "rgba(255,255,255,0.7)", cursor: "pointer", transition: "all 0.15s",
        }}
      >
        <BellIcon hasUnread={unreadCount > 0} />
        {unreadCount > 0 && (
          <div style={{
            position: "absolute", top: "2px", right: "2px", minWidth: "16px", height: "16px",
            background: criticalCount > 0 ? "#dc2626" : "#d97706",
            borderRadius: "8px", border: "1.5px solid #0a0d14",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "9px", fontWeight: 900, color: "white", padding: "0 3px",
          }}>
            {unreadCount > 9 ? "9+" : unreadCount}
          </div>
        )}
      </button>

      {open && (
        <div ref={panelRef} style={{
            position: "absolute", top: "calc(100% + 8px)", right: 0, width: "380px",
            background: "white", borderRadius: "14px", border: "1.5px solid #e2e8f0",
            boxShadow: "0 16px 48px rgba(0,0,0,0.16)", overflow: "hidden", zIndex: 1000,
            animation: "bellDrop 0.18s ease",
          }}>
          <style>{`@keyframes bellDrop { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
          <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: "14px", fontWeight: 800, color: "#0f172a" }}>Notifications</div>
            <a href="/notifications" style={{ fontSize: "11px", color: "#0891b2", fontWeight: 700, textDecoration: "none" }} onClick={() => setOpen(false)}>See all →</a>
          </div>

          <div style={{ maxHeight: "420px", overflowY: "auto" }}>
            {loading ? (
              <div style={{ padding: "24px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>Loading…</div>
            ) : alerts.length === 0 ? (
              <div style={{ padding: "28px", textAlign: "center" }}>
                <div style={{ fontSize: "24px", marginBottom: "8px" }}>✅</div>
                <div style={{ fontSize: "13px", color: "#64748b", fontWeight: 600 }}>All clear</div>
              </div>
            ) : (
              Object.entries(grouped).map(([sev, list]) => list.length > 0 && (
                <div key={sev}>
                  <div style={{ padding: "8px 14px 4px", fontSize: "10px", fontWeight: 800, textTransform: "uppercase", color: SEVERITY_COLOUR[sev as AlertSeverity], background: SEVERITY_BG[sev as AlertSeverity] }}>{sev}</div>
                  {list.map(a => <AlertItem key={a.id} alert={a} onClick={() => setOpen(false)} />)}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
