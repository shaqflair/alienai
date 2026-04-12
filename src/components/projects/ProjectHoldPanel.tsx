"use client";
// src/components/projects/ProjectHoldPanel.tsx
// Shows hold status, week counter, action plan, and hold/lift controls
import React, { useCallback, useEffect, useState } from "react";
import { PauseCircle, PlayCircle, AlertTriangle, Clock, X, ChevronDown, ChevronUp } from "lucide-react";

type HoldHistory = {
  id: string; reason: string; action_plan: string | null;
  started_at: string; lifted_at: string | null; hold_weeks: number | null;
};

type HoldData = {
  project: {
    on_hold: boolean; hold_started_at: string | null;
    hold_reason: string | null; hold_action_plan: string | null;
    total_hold_weeks: number;
  } | null;
  history: HoldHistory[];
  current_hold_weeks: number;
};

type CR = { id: string; title: string; status: string };

function safeWeeks(started: string | null): number {
  if (!started) return 0;
  return Math.floor((Date.now() - new Date(started).getTime()) / (7 * 24 * 3600000));
}

function HoldModal({ projectId, crs, onDone, onClose }: {
  projectId: string; crs: CR[]; onDone: () => void; onClose: () => void;
}) {
  const [crId,       setCrId]       = useState(crs[0]?.id ?? "");
  const [reason,      setReason]      = useState("");
  const [actionPlan, setActionPlan] = useState("");
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  const INP: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 13, fontFamily: "inherit", color: "var(--color-text-primary)", background: "var(--color-background-primary)", border: "1px solid var(--color-border-secondary)", borderRadius: 6, outline: "none" };
  const LBL: React.CSSProperties = { display: "block", marginBottom: 5, fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)" };

  async function submit() {
    if (!reason.trim()) { setError("Reason is required"); return; }
    if (!actionPlan.trim()) { setError("Action plan is required"); return; }
    setSaving(true); setError(null);
    try {
      const res  = await fetch(`/api/projects/${projectId}/hold`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "hold", cr_id: crId || null, reason: reason.trim(), action_plan: actionPlan.trim() }) });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      onDone();
    } catch (e: any) { setError(e?.message ?? "Failed"); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "var(--color-background-primary)", width: "100%", maxWidth: 500, borderRadius: 12, border: "1px solid var(--color-border-secondary)", boxShadow: "0 24px 80px rgba(0,0,0,0.2)", overflow: "hidden" }}>
        <div style={{ padding: "18px 22px 14px", borderBottom: "1px solid var(--color-border-tertiary)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <PauseCircle size={18} color="#d97706" />
            <span style={{ fontSize: 16, fontWeight: 500, color: "var(--color-text-primary)" }}>Put project on hold</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-tertiary)" }}><X size={16} /></button>
        </div>
        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ padding: "10px 14px", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, fontSize: 12, color: "#92400e" }}>
            A Change Request is required to put a project on hold. The action plan documents exactly what must happen to lift the hold.
          </div>
          {crs.length > 0 && (
            <div><label style={LBL}>Linked change request</label>
              <select value={crId} onChange={e => setCrId(e.target.value)} style={INP}>
                <option value="">— None selected —</option>
                {crs.map(c => <option key={c.id} value={c.id}>{c.title} ({c.status})</option>)}
              </select>
            </div>
          )}
          {crs.length === 0 && (
            <div style={{ padding: "8px 12px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, fontSize: 12, color: "#991b1b" }}>
              No open change requests found. Raise a CR on the Change Board first, then put the project on hold.
            </div>
          )}
          <div><label style={LBL}>Reason for hold *</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Describe why this project is being paused…" rows={3} style={{ ...INP, resize: "vertical" }} />
          </div>
          <div><label style={LBL}>Action plan to lift hold *</label>
            <textarea value={actionPlan} onChange={e => setActionPlan(e.target.value)} placeholder="What specifically needs to happen before this project can resume?" rows={4} style={{ ...INP, resize: "vertical" }} />
          </div>
          {error && <div style={{ fontSize: 12, color: "#991b1b", padding: "8px 12px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6 }}>{error}</div>}
        </div>
        <div style={{ padding: "12px 22px 18px", borderTop: "1px solid var(--color-border-tertiary)", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} style={{ padding: "7px 18px", fontSize: 12, fontWeight: 500, background: "transparent", color: "var(--color-text-secondary)", border: "1px solid var(--color-border-secondary)", borderRadius: 8, cursor: "pointer" }}>Cancel</button>
          <button onClick={submit} disabled={saving || crs.length === 0} style={{ padding: "7px 18px", fontSize: 12, fontWeight: 500, background: saving || crs.length === 0 ? "#9ca3af" : "#d97706", color: "#fff", border: "none", borderRadius: 8, cursor: saving || crs.length === 0 ? "default" : "pointer" }}>
            {saving ? "Placing on hold…" : "Confirm — place on hold"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProjectHoldPanel({ projectId, canEdit = false }: { projectId: string; canEdit?: boolean }) {
  const [data,      setData]      = useState<HoldData | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [crs,       setCrs]       = useState<CR[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [lifting,   setLifting]   = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [liveWeeks, setLiveWeeks]    = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const [holdRes, crRes] = await Promise.allSettled([
      fetch(`/api/projects/${projectId}/hold`).then(r => r.json()),
      fetch(`/api/projects/${projectId}/change-requests?status=open,submitted,pending`).then(r => r.json()).catch(() => ({ items: [] })),
    ]);
    if (holdRes.status === "fulfilled" && holdRes.value?.ok) setData(holdRes.value);
    if (crRes.status === "fulfilled") setCrs((crRes.value as any)?.items ?? (crRes.value as any)?.data ?? []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!data?.project?.on_hold || !data.project.hold_started_at) return;
    const update = () => setLiveWeeks(safeWeeks(data.project!.hold_started_at));
    update();
    const id = setInterval(update, 60000);
    return () => clearInterval(id);
  }, [data]);

  async function liftHold() {
    setLifting(true);
    try {
      const res  = await fetch(`/api/projects/${projectId}/hold`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "lift" }) });
      const json = await res.json();
      if (json.ok) { await load(); window.location.reload(); }
    } finally { setLifting(false); }
  }

  if (loading) return null;

  const proj    = data?.project;
  const onHold  = proj?.on_hold ?? false;
  const history = data?.history ?? [];

  if (!onHold && !canEdit && history.length === 0) return null;

  return (
    <>
      {onHold && (
        <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderLeft: "4px solid #d97706", borderRadius: 10, padding: "16px 20px", marginBottom: 16, display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <PauseCircle size={20} color="#d97706" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#92400e" }}>Project on hold</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                <Clock size={11} color="#d97706" />
                <span style={{ fontSize: 12, color: "#b45309", fontWeight: 600 }}>
                  {liveWeeks === 0 ? "Less than 1 week" : `${liveWeeks} week${liveWeeks !== 1 ? "s" : ""}`}
                </span>
              </div>
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 200 }}>
            {proj?.hold_reason && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#b45309", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Reason</div>
                <div style={{ fontSize: 13, color: "#78350f" }}>{proj.hold_reason}</div>
              </div>
            )}
            {proj?.hold_action_plan && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#b45309", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Action plan to lift hold</div>
                <div style={{ fontSize: 13, color: "#78350f", whiteSpace: "pre-wrap" }}>{proj.hold_action_plan}</div>
              </div>
            )}
          </div>

          {canEdit && (
            <button onClick={liftHold} disabled={lifting} style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", fontSize: 12, fontWeight: 600, background: "#d97706", color: "#fff", border: "none", borderRadius: 8, cursor: lifting ? "default" : "pointer", opacity: lifting ? 0.6 : 1, fontFamily: "inherit" }}>
              <PlayCircle size={14} /> {lifting ? "Lifting…" : "Lift hold"}
            </button>
          )}
        </div>
      )}

      {!onHold && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          {canEdit && (
            <button onClick={() => setShowModal(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", fontSize: 12, fontWeight: 500, background: "transparent", color: "#d97706", border: "1px solid #fcd34d", borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}>
              <PauseCircle size={13} /> Put on hold
            </button>
          )}
          {history.length > 0 && (
            <button onClick={() => setShowHistory(v => !v)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", fontSize: 11, fontWeight: 500, background: "transparent", color: "var(--color-text-tertiary)", border: "1px solid var(--color-border-tertiary)", borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}>
              Hold history ({history.length})
            </button>
          )}
        </div>
      )}

      {showHistory && history.length > 0 && (
        <div style={{ border: "1px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
          {history.map((h, i) => (
            <div key={h.id} style={{ padding: "12px 16px", borderBottom: i < history.length - 1 ? "1px solid var(--color-border-tertiary)" : "none", display: "flex", gap: 16, alignItems: "flex-start" }}>
              <div style={{ flexShrink: 0, width: 60, textAlign: "right" }}>
                {h.hold_weeks != null ? <span style={{ fontSize: 18, fontWeight: 600 }}>{h.hold_weeks}w</span> : <span style={{ fontSize: 11 }}>ongoing</span>}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4 }}>
                  {new Date(h.started_at).toLocaleDateString("en-GB")}
                </div>
                <div style={{ fontSize: 13 }}>{h.reason}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <HoldModal
          projectId={projectId}
          crs={crs}
          onClose={() => setShowModal(false)}
          onDone={() => { setShowModal(false); load(); window.location.reload(); }}
        />
      )}
    </>
  );
}