"use client";
// src/components/projects/AutoGovernanceCard.tsx
import React, { useCallback, useEffect, useState } from "react";
import { Shield, AlertTriangle, CheckCircle, Clock, RefreshCw, ChevronDown, ChevronUp, Zap } from "lucide-react";

type ActionType = "escalate_approval" | "nudge_raid_owner" | "request_status_update" | "route_change_request" | "flag_false_green" | "request_artifact_approval";
type Priority    = "critical" | "high" | "medium";
type Status      = "pending" | "sent" | "acknowledged" | "resolved" | "escalated" | "dismissed";

type GovernanceAction = {
  id:                string;
  action_type:       ActionType;
  title:             string;
  detail:            string;
  owner_label:       string;
  target_ref_type:   string | null;
  priority:          Priority;
  status:            Status;
  escalation_hours: number;
  due_by:            string | null;
  created_at:        string;
};

const P = {
  navy:    "#1B3652", navyLt:  "#EBF0F5",
  red:     "#B83A2E", redLt:   "#FDF2F1",
  amber:   "#8A5B1A", amberLt: "#FDF6EC",
  green:   "#2A6E47", greenLt: "#F0F7F3",
  text:    "#0D0D0B", textMd:  "#4A4A46", textSm: "#8A8A84",
  border:  "#E3E3DF", borderMd:"#C8C8C4",
  surface: "#FFFFFF", bg:      "#F7F7F5",
  mono:    "'DM Mono','Courier New',monospace",
  sans:    "'DM Sans',system-ui,sans-serif",
};

const ACTION_CFG: Record<ActionType, { label: string; icon: string }> = {
  escalate_approval:       { label: "Approval escalation",    icon: "⚡" },
  nudge_raid_owner:        { label: "RAID owner nudge",       icon: "📋" },
  request_status_update:   { label: "Status update request",  icon: "📊" },
  route_change_request:    { label: "CR routing",              icon: "🔀" },
  flag_false_green:        { label: "Truth Layer alert",       icon: "⚠" },
  request_artifact_approval: { label: "Artifact approval",     icon: "📄" },
};

const PRIORITY_CFG: Record<Priority, { bg: string; color: string; border: string; label: string }> = {
  critical: { bg: "#FDF2F1", color: "#B83A2E", border: "#F0B0AA", label: "Critical" },
  high:     { bg: "#FDF6EC", color: "#8A5B1A", border: "#E0C080", label: "High"     },
  medium:   { bg: "#EBF0F5", color: "#1B3652", border: "#A0BAD0", label: "Medium"   },
};

function timeAgo(iso: string): string {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1)  return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function dueLabel(iso: string | null): string {
  if (!iso) return "";
  const h = Math.round((new Date(iso).getTime() - Date.now()) / 3600000);
  if (h < 0)  return "overdue";
  if (h < 24) return `due in ${h}h`;
  return `due in ${Math.round(h / 24)}d`;
}

export default function AutoGovernanceCard({ projectId }: { projectId: string }) {
  const [actions,   setActions]   = useState<GovernanceAction[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [running,   setRunning]   = useState(false);
  const [expanded,  setExpanded]  = useState<string | null>(null);
  const [lastRun,   setLastRun]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/ai/governance?projectId=${projectId}&status=pending,sent,acknowledged`);
      const json = await res.json();
      if (json.ok) setActions(json.actions ?? []);
    } finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function runGovernance() {
    setRunning(true);
    try {
      const res  = await fetch("/api/ai/governance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId }) });
      const json = await res.json();
      if (json.ok) { setLastRun(new Date().toLocaleTimeString("en-GB")); await load(); }
    } finally { setRunning(false); }
  }

  async function updateStatus(actionId: string, status: "acknowledged" | "resolved" | "dismissed") {
    await fetch("/api/ai/governance", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actionId, status }) });
    setActions(prev => prev.map(a => a.id === actionId ? { ...a, status } : a));
  }

  const critical = actions.filter(a => a.priority === "critical" && a.status !== "dismissed");
  const high     = actions.filter(a => a.priority === "high"     && a.status !== "dismissed");
  const medium   = actions.filter(a => a.priority === "medium"   && a.status !== "dismissed");
  const active   = [...critical, ...high, ...medium];

  return (
    <div style={{ border: `1px solid ${P.border}`, borderRadius: 16, background: P.surface, overflow: "hidden", fontFamily: P.sans }}>

      {/* Header */}
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${P.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: active.length > 0 ? (critical.length > 0 ? "#FDF2F1" : "#FDF6EC") : P.greenLt, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {active.length > 0 ? <Shield size={16} color={critical.length > 0 ? P.red : P.amber} /> : <CheckCircle size={16} color={P.green} />}
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: P.navy, marginBottom: 1 }}>Auto-Governance</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: P.text }}>
              {active.length === 0 ? "No open governance actions" : `${active.length} open action${active.length !== 1 ? "s" : ""}`}
              {critical.length > 0 && <span style={{ marginLeft: 6, fontSize: 9, fontFamily: P.mono, fontWeight: 700, padding: "1px 6px", background: "#FDF2F1", border: "1px solid #F0B0AA", color: P.red, borderRadius: 20 }}>{critical.length} critical</span>}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {lastRun && <span style={{ fontSize: 9, color: P.textSm, fontFamily: P.mono }}>last run {lastRun}</span>}
          <button onClick={runGovernance} disabled={running} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", background: P.navy, color: "#fff", border: "none", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: running ? "default" : "pointer", opacity: running ? 0.7 : 1 }}>
            <Zap size={11} /> {running ? "Running…" : "Run now"}
          </button>
        </div>
      </div>

      {/* Actions list */}
      {loading ? (
        <div style={{ padding: "24px", textAlign: "center", color: P.textSm, fontSize: 12 }}>Loading…</div>
      ) : active.length === 0 ? (
        <div style={{ padding: "24px 20px", display: "flex", alignItems: "center", gap: 10, color: P.green, fontSize: 13 }}>
          <CheckCircle size={16} />
          <span>Aliena has not detected any governance gaps on this project.</span>
        </div>
      ) : (
        <div>
          {active.map((action, idx) => {
            const pcfg   = PRIORITY_CFG[action.priority];
            const acfg   = ACTION_CFG[action.action_type];
            const isOpen = expanded === action.id;
            const due    = dueLabel(action.due_by);

            return (
              <div key={action.id} style={{ borderBottom: idx < active.length - 1 ? `1px solid ${P.border}` : "none" }}>
                <div
                  onClick={() => setExpanded(isOpen ? null : action.id)}
                  style={{ padding: "12px 20px", cursor: "pointer", display: "flex", alignItems: "flex-start", gap: 12, background: action.status === "acknowledged" ? "#FAFAF8" : P.surface }}
                >
                  <div style={{ flexShrink: 0, marginTop: 3, width: 8, height: 8, borderRadius: "50%", background: pcfg.color }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
                      <span style={{ fontSize: 9, fontFamily: P.mono, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", padding: "1px 7px", background: pcfg.bg, border: `1px solid ${pcfg.border}`, color: pcfg.color, borderRadius: 20 }}>{pcfg.label}</span>
                      <span style={{ fontSize: 10, color: P.textSm }}>{acfg.label}</span>
                      {action.status === "acknowledged" && <span style={{ fontSize: 9, fontFamily: P.mono, color: P.textSm }}>acknowledged</span>}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: P.text, lineHeight: 1.4 }}>{action.title}</div>
                    <div style={{ fontSize: 11, color: P.textSm, marginTop: 3 }}>
                      Owner: {action.owner_label} · {timeAgo(action.created_at)}
                      {due && <span style={{ marginLeft: 8, color: due === "overdue" ? P.red : P.textSm }}>· {due}</span>}
                    </div>
                  </div>
                  {isOpen ? <ChevronUp size={14} color={P.textSm} style={{ flexShrink: 0, marginTop: 2 }} /> : <ChevronDown size={14} color={P.textSm} style={{ flexShrink: 0, marginTop: 2 }} />}
                </div>
                {isOpen && (
                  <div style={{ padding: "12px 20px 16px 40px", background: "#FAFAF8", borderTop: `1px solid ${P.border}` }}>
                    <p style={{ margin: "0 0 12px", fontSize: 13, color: P.textMd, lineHeight: 1.6 }}>{action.detail}</p>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {action.status === "pending" && (
                        <button onClick={() => updateStatus(action.id, "acknowledged")} style={{ padding: "5px 14px", fontSize: 11, fontWeight: 600, fontFamily: P.sans, background: P.navyLt, border: `1px solid #A0BAD0`, color: P.navy, borderRadius: 8, cursor: "pointer" }}>
                          Acknowledge
                        </button>
                      )}
                      <button onClick={() => updateStatus(action.id, "resolved")} style={{ padding: "5px 14px", fontSize: 11, fontWeight: 600, fontFamily: P.sans, background: P.greenLt, border: "1px solid #A0D0B8", color: P.green, borderRadius: 8, cursor: "pointer" }}>
                        Mark resolved
                      </button>
                      <button onClick={() => updateStatus(action.id, "dismissed")} style={{ padding: "5px 14px", fontSize: 11, fontWeight: 600, fontFamily: P.sans, background: P.bg, border: `1px solid ${P.border}`, color: P.textSm, borderRadius: 8, cursor: "pointer" }}>
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ padding: "8px 20px", borderTop: `1px solid ${P.border}`, background: P.bg, fontSize: 9, fontFamily: P.mono, color: P.textSm }}>
        Auto-Governance · detects gaps · escalates automatically
      </div>
    </div>
  );
}