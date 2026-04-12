"use client";
// src/components/projects/ProjectHoldPanel.tsx
import React, { useCallback, useEffect, useState } from "react";

type HoldHistory = {
  id: string; reason: string; action_plan: string | null;
  started_at: string; lifted_at: string | null; hold_weeks: number | null;
};

type CR = { id: string; title: string; status: string };

function weeksFrom(started: string | null): number {
  if (!started) return 0;
  return Math.floor((Date.now() - new Date(started).getTime()) / (7 * 24 * 3600000));
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ── Inline modal (avoids fixed positioning issues) ────────────────────────────
function HoldModal({ projectId, crs, onDone, onClose }: {
  projectId: string; crs: CR[]; onDone: () => void; onClose: () => void;
}) {
  const [crId,       setCrId]       = useState(crs[0]?.id ?? "");
  const [reason,     setReason]     = useState("");
  const [actionPlan, setActionPlan] = useState("");
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  async function submit() {
    if (!reason.trim())     { setError("Reason is required"); return; }
    if (!actionPlan.trim()) { setError("Action plan is required"); return; }
    setSaving(true); setError(null);
    try {
      const res  = await fetch(`/api/projects/${projectId}/hold`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "hold", cr_id: crId || null, reason: reason.trim(), action_plan: actionPlan.trim() }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      onDone();
    } catch (e: any) { setError(e?.message ?? "Failed"); }
    finally { setSaving(false); }
  }

  const INP: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "10px 14px",
    fontSize: 14, fontFamily: "inherit", color: "#111827",
    background: "#fff", border: "1.5px solid #d1d5db",
    borderRadius: 8, outline: "none", lineHeight: 1.5,
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20,
    }}
    onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: "#ffffff", width: "100%", maxWidth: 560,
        borderRadius: 16, boxShadow: "0 25px 60px rgba(0,0,0,0.35)",
        overflow: "hidden", maxHeight: "90vh", display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{ padding: "22px 28px 18px", background: "#fffbeb", borderBottom: "2px solid #fcd34d", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "#d97706", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 20 }}>⏸</span>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#92400e" }}>Put project on hold</div>
              <div style={{ fontSize: 13, color: "#b45309", marginTop: 2 }}>This will pause active delivery tracking</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: "#9ca3af", lineHeight: 1, padding: "0 4px" }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 18, overflowY: "auto", flex: 1 }}>

          {crs.length > 0 ? (
            <div>
              <label style={{ display: "block", marginBottom: 8, fontSize: 13, fontWeight: 600, color: "#374151" }}>
                Linked change request <span style={{ color: "#6b7280", fontWeight: 400 }}>(recommended)</span>
              </label>
              <select value={crId} onChange={e => setCrId(e.target.value)} style={INP}>
                <option value="">— No CR linked —</option>
                {crs.map(c => <option key={c.id} value={c.id}>{c.title} · {c.status}</option>)}
              </select>
            </div>
          ) : (
            <div style={{ padding: "12px 16px", background: "#fef9c3", border: "1.5px solid #fde047", borderRadius: 10, fontSize: 13, color: "#713f12", display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>💡</span>
              <div>No open change requests found. You can still place the project on hold — add the reason and action plan below. Raise a CR on the Change Board to formally track this.</div>
            </div>
          )}

          <div>
            <label style={{ display: "block", marginBottom: 8, fontSize: 13, fontWeight: 600, color: "#374151" }}>
              Reason for hold <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Why is this project being paused? (e.g. waiting for budget approval, key resource unavailable, external dependency blocked)"
              rows={3}
              style={{ ...INP, resize: "vertical" }}
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 8, fontSize: 13, fontWeight: 600, color: "#374151" }}>
              Action plan to lift hold <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>Be specific — what needs to happen, by whom, and by when?</div>
            <textarea
              value={actionPlan}
              onChange={e => setActionPlan(e.target.value)}
              placeholder="e.g. Finance team to approve revised budget by 30 April. Once approved, PM to raise lift-hold CR and resume sprint planning."
              rows={4}
              style={{ ...INP, resize: "vertical" }}
            />
          </div>

          {error && (
            <div style={{ padding: "12px 16px", background: "#fef2f2", border: "1.5px solid #fca5a5", borderRadius: 8, fontSize: 13, color: "#991b1b", fontWeight: 500 }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 28px 24px", borderTop: "1px solid #f3f4f6", display: "flex", justifyContent: "flex-end", gap: 12, background: "#fafafa" }}>
          <button onClick={onClose} style={{ padding: "10px 22px", fontSize: 14, fontWeight: 500, background: "#fff", color: "#374151", border: "1.5px solid #d1d5db", borderRadius: 10, cursor: "pointer", fontFamily: "inherit" }}>
            Cancel
          </button>
          <button onClick={submit} disabled={saving} style={{
            padding: "10px 24px", fontSize: 14, fontWeight: 700,
            background: saving ? "#9ca3af" : "#d97706",
            color: "#fff", border: "none", borderRadius: 10,
            cursor: saving ? "default" : "pointer", fontFamily: "inherit",
            boxShadow: saving ? "none" : "0 2px 8px rgba(217,119,6,0.4)",
          }}>
            {saving ? "Placing on hold…" : "⏸ Confirm — place on hold"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ProjectHoldPanel({
  projectId,
  canEdit = false,
}: {
  projectId: string;
  canEdit?: boolean;
}) {
  const [onHold,      setOnHold]      = useState(false);
  const [holdData,    setHoldData]    = useState<any>(null);
  const [history,     setHistory]     = useState<HoldHistory[]>([]);
  const [totalWeeks,  setTotalWeeks]  = useState(0);
  const [liveWeeks,   setLiveWeeks]   = useState(0);
  const [crs,         setCrs]         = useState<CR[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [showModal,   setShowModal]   = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [lifting,     setLifting]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [holdRes, crRes] = await Promise.allSettled([
      fetch(`/api/projects/${projectId}/hold`).then(r => r.json()),
      fetch(`/api/projects/${projectId}/change-requests`).then(r => r.json()).catch(() => ({ ok: false })),
    ]);
    if (holdRes.status === "fulfilled" && holdRes.value?.ok) {
      const d = holdRes.value;
      setOnHold(d.project?.on_hold ?? false);
      setHoldData(d.project);
      setHistory(d.history ?? []);
      setTotalWeeks(d.project?.total_hold_weeks ?? 0);
      setLiveWeeks(weeksFrom(d.project?.hold_started_at));
    }
    if (crRes.status === "fulfilled" && crRes.value?.ok) {
      const items = crRes.value.items ?? crRes.value.data ?? [];
      setCrs(items.filter((c: any) => ["open","submitted","pending","under_review"].includes(String(c.status).toLowerCase())));
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // Tick live counter every minute
  useEffect(() => {
    if (!onHold || !holdData?.hold_started_at) return;
    const id = setInterval(() => setLiveWeeks(weeksFrom(holdData.hold_started_at)), 60000);
    return () => clearInterval(id);
  }, [onHold, holdData]);

  async function liftHold() {
    if (!confirm("Lift the hold and resume this project?")) return;
    setLifting(true);
    try {
      const res  = await fetch(`/api/projects/${projectId}/hold`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "lift" }),
      });
      const json = await res.json();
      if (json.ok) { await load(); window.location.reload(); }
    } finally { setLifting(false); }
  }

  if (loading) return null;

  return (
    <>
      {/* ── On-hold banner ── */}
      {onHold && (
        <div style={{
          background: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)",
          border: "2px solid #f59e0b",
          borderLeft: "6px solid #d97706",
          borderRadius: 12,
          padding: "20px 24px",
          marginBottom: 16,
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: "#d97706", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 24 }}>
                ⏸
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#92400e", marginBottom: 4 }}>
                  Project on hold
                  <span style={{ marginLeft: 12, fontSize: 13, fontWeight: 700, padding: "3px 10px", background: liveWeeks >= 4 ? "#fef2f2" : "#fef3c7", border: `1px solid ${liveWeeks >= 4 ? "#fca5a5" : "#fcd34d"}`, color: liveWeeks >= 4 ? "#991b1b" : "#92400e", borderRadius: 20 }}>
                    ⏱ {liveWeeks === 0 ? "< 1 week" : `${liveWeeks} week${liveWeeks !== 1 ? "s" : ""}`}
                    {liveWeeks >= 4 && " · ESCALATE"}
                  </span>
                </div>
                {holdData?.hold_reason && (
                  <div style={{ fontSize: 14, color: "#78350f", marginBottom: 10 }}>
                    <strong>Reason:</strong> {holdData.hold_reason}
                  </div>
                )}
                {holdData?.hold_action_plan && (
                  <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: "12px 16px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#b45309", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                      ✅ Action plan to lift hold
                    </div>
                    <div style={{ fontSize: 14, color: "#78350f", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                      {holdData.hold_action_plan}
                    </div>
                  </div>
                )}
              </div>
            </div>
            {canEdit && (
              <button
                onClick={liftHold}
                disabled={lifting}
                style={{
                  flexShrink: 0, display: "flex", alignItems: "center", gap: 8,
                  padding: "10px 20px", fontSize: 14, fontWeight: 700,
                  background: lifting ? "#9ca3af" : "#16a34a",
                  color: "#fff", border: "none", borderRadius: 10,
                  cursor: lifting ? "default" : "pointer", fontFamily: "inherit",
                  boxShadow: lifting ? "none" : "0 2px 8px rgba(22,163,74,0.35)",
                }}
              >
                ▶ {lifting ? "Lifting…" : "Lift hold"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Hold / history controls (when NOT on hold) ── */}
      {!onHold && canEdit && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <button
            onClick={() => setShowModal(true)}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 18px", fontSize: 13, fontWeight: 600,
              background: "#fff", color: "#d97706",
              border: "1.5px solid #fcd34d", borderRadius: 10,
              cursor: "pointer", fontFamily: "inherit",
              transition: "all 0.15s",
            }}
          >
            ⏸ Put on hold
          </button>
          {history.length > 0 && (
            <button
              onClick={() => setShowHistory(v => !v)}
              style={{ fontSize: 12, color: "#6b7280", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: "4px 8px" }}
            >
              {showHistory ? "▲" : "▼"} Hold history ({history.length}) · Total: {totalWeeks}w
            </button>
          )}
        </div>
      )}

      {/* ── Hold history ── */}
      {showHistory && history.length > 0 && (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
          {history.map((h, i) => (
            <div key={h.id} style={{ padding: "14px 20px", borderBottom: i < history.length - 1 ? "1px solid #f3f4f6" : "none", display: "flex", gap: 16, alignItems: "flex-start", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
              <div style={{ flexShrink: 0, width: 52, textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#374151" }}>{h.hold_weeks ?? "—"}w</div>
                <div style={{ fontSize: 10, color: "#9ca3af" }}>held</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
                  {fmtDate(h.started_at)}{h.lifted_at ? ` → ${fmtDate(h.lifted_at)}` : " → ongoing"}
                </div>
                <div style={{ fontSize: 13, color: "#111827", marginBottom: h.action_plan ? 4 : 0 }}>{h.reason}</div>
                {h.action_plan && <div style={{ fontSize: 12, color: "#6b7280", fontStyle: "italic" }}>{h.action_plan}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Modal ── */}
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