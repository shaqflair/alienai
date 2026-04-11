// src/components/projects/ProjectDateEditor.tsx
"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";

type Props = {
  projectId: string;
  projectTitle: string;
  startDate: string | null;
  finishDate: string | null;
  resourceStatus: string; // "pipeline" | "confirmed"
  canEdit: boolean;       // editor or above
};

function fmtDisplay(d: string | null | undefined) {
  if (!d) return "Not set";
  try {
    return new Date(d).toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch { return d; }
}

/* - Inline edit for Pipeline - */

function PipelineDateEdit({
  projectId, startDate, finishDate, onSaved,
}: {
  projectId: string;
  startDate: string | null;
  finishDate: string | null;
  onSaved: () => void;
}) {
  const [start, setStart] = useState(startDate ?? "");
  const [finish, setFinish] = useState(finishDate ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  async function save() {
    if (finish && start && finish < start) {
      setError("Finish date cannot be before start date.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/dates`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_date: start || null, finish_date: finish || null }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.error || `Failed (${r.status})`);
      setEditing(false);
      onSaved();
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, flex: 1 }}>
            <DateStatCell label="Start Date" value={fmtDisplay(startDate)} sub="Kickoff" />
            <DateStatCell label="End Date" value={fmtDisplay(finishDate)} sub="Deadline" />
          </div>
          <button
            onClick={() => setEditing(true)}
            style={{
              padding: "6px 12px", borderRadius: 8, border: "1px solid #e8ecf0",
              background: "#f6f8fa", color: "#57606a", fontSize: 12, fontWeight: 600,
              cursor: "pointer", whiteSpace: "nowrap", alignSelf: "center",
            }}
          >
            - Edit dates
          </button>
        </div>
        <div style={{ fontSize: 10, color: "#8b949e", marginTop: 2 }}>
          Pipeline project -- dates can be edited directly.
        </div>
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid #e8ecf0", borderRadius: 12, padding: 16, background: "#f6f8fa" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#0d1117", marginBottom: 12 }}>Edit project dates</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, color: "#8b949e", letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 4 }}>
            Start Date
          </label>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e8ecf0", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}
          />
        </div>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, color: "#8b949e", letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 4 }}>
            Finish Date
          </label>
          <input
            type="date"
            value={finish}
            onChange={(e) => setFinish(e.target.value)}
            style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e8ecf0", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}
          />
        </div>
      </div>
      {error && (
        <div style={{ padding: "8px 10px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", fontSize: 12, color: "#b91c1c", marginBottom: 10 }}>
          {error}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => { setEditing(false); setError(null); setStart(startDate ?? ""); setFinish(finishDate ?? ""); }}
          style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "1px solid #e8ecf0", background: "white", color: "#57606a", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving}
          style={{ flex: 2, padding: "8px 0", borderRadius: 8, border: "1px solid #0d1117", background: saving ? "#8b949e" : "#0d1117", color: "white", fontSize: 12, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}
        >
          {saving ? "Saving..." : "Save dates"}
        </button>
      </div>
    </div>
  );
}

/* - CR modal for Active projects - */

function DateChangeRequestModal({
  projectId, projectTitle, startDate, finishDate, onClose,
}: {
  projectId: string;
  projectTitle: string;
  startDate: string | null;
  finishDate: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [newStart, setNewStart]   = useState(startDate ?? "");
  const [newFinish, setNewFinish] = useState(finishDate ?? "");
  const [reason, setReason]       = useState("");
  const [impact, setImpact]       = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [done, setDone]           = useState(false);
  const [crId, setCrId]           = useState<string | null>(null);

  const startChanged  = newStart  !== (startDate  ?? "");
  const finishChanged = newFinish !== (finishDate ?? "");
  const hasChange     = startChanged || finishChanged;

  async function submit() {
    if (!hasChange) { setError("No date changes made."); return; }
    if (!reason.trim()) { setError("Please provide a reason for this date change."); return; }
    if (newFinish && newStart && newFinish < newStart) { setError("Finish date cannot be before start date."); return; }
    if (newStart && newStart < new Date().toISOString().slice(0, 10) && startChanged) {
      setError("Proposed start date cannot be in the past.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const r = await fetch(`/api/projects/${projectId}/dates/change-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_start_date:  startDate,
          current_finish_date: finishDate,
          proposed_start_date:  newStart  || null,
          proposed_finish_date: newFinish || null,
          reason:  reason.trim(),
          impact:  impact.trim(),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.error || `Failed (${r.status})`);
      setCrId(j.changeRequestId ?? null);
      setDone(true);
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(10,10,10,0.35)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{ background: "#ffffff", borderRadius: 16, width: "100%", maxWidth: 520, boxShadow: "0 24px 60px rgba(0,0,0,0.18)", border: "1px solid #e8ecf0", maxHeight: "90vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid #e8ecf0" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8b949e", marginBottom: 4 }}>
            Change Request
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 style={{ fontSize: 17, fontWeight: 750, color: "#0d1117", margin: 0, letterSpacing: "-0.02em" }}>
              Request Date Change
            </h2>
            <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid #e8ecf0", background: "#f6f8fa", cursor: "pointer", fontSize: 13, color: "#57606a" }}>-</button>
          </div>
          <p style={{ fontSize: 12, color: "#57606a", margin: "6px 0 0", lineHeight: 1.5 }}>
            Date changes on active projects require a change request. This will be sent for approval before any dates are updated.
          </p>
        </div>

        {done ? (
          <div style={{ padding: 24, textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>-</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0d1117", marginBottom: 6 }}>Change request submitted</div>
            <p style={{ fontSize: 13, color: "#57606a", marginBottom: 20, lineHeight: 1.6 }}>
              Your date change request has been raised and is pending approval. The project dates will only be updated once approved.
            </p>
            {crId && (
              <a
                href={`/projects/${projectId}/change`}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, background: "#0d1117", color: "white", fontSize: 12, fontWeight: 600, textDecoration: "none" }}
              >
                View change request -
              </a>
            )}
            <button onClick={onClose} style={{ display: "block", margin: "12px auto 0", fontSize: 12, color: "#8b949e", background: "none", border: "none", cursor: "pointer" }}>
              Close
            </button>
          </div>
        ) : (
          <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Current dates */}
            <div style={{ background: "#f6f8fa", borderRadius: 10, padding: "10px 14px", border: "1px solid #e8ecf0" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Current dates</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#8b949e" }}>Start</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#0d1117" }}>{fmtDisplay(startDate)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#8b949e" }}>Finish</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#0d1117" }}>{fmtDisplay(finishDate)}</div>
                </div>
              </div>
            </div>

            {/* Proposed dates */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Proposed dates</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: "#57606a", display: "block", marginBottom: 4 }}>Start Date</label>
                  <input
                    type="date"
                    value={newStart}
                    onChange={(e) => setNewStart(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${startChanged ? "#3b82f6" : "#e8ecf0"}`, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box", background: startChanged ? "#eff6ff" : "white", color: "#0d1117", colorScheme: "light" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "#57606a", display: "block", marginBottom: 4 }}>Finish Date</label>
                  <input
                    type="date"
                    value={newFinish}
                    onChange={(e) => setNewFinish(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${finishChanged ? "#3b82f6" : "#e8ecf0"}`, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box", background: finishChanged ? "#eff6ff" : "white", color: "#0d1117", colorScheme: "light" }}
                  />
                </div>
              </div>
              {(startChanged || finishChanged) && (
                <div style={{ fontSize: 11, color: "#3b82f6", marginTop: 6 }}>
                  {startChanged && finishChanged ? "Both dates changed" : startChanged ? "Start date changed" : "Finish date changed"}
                  {finishChanged && finishDate && newFinish > finishDate && (
                    <span style={{ color: "#b45309" }}> - Finish moved out by {Math.ceil((new Date(newFinish).getTime() - new Date(finishDate).getTime()) / 86400000)} days</span>
                  )}
                </div>
              )}
            </div>

            {/* Reason */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#0d1117", display: "block", marginBottom: 4 }}>
                Reason for change <span style={{ color: "#b91c1c" }}>*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => { setReason(e.target.value); setError(null); }}
                placeholder="e.g. Supplier delayed delivery of key component by 3 weeks. Baseline end date needs to move accordingly."
                rows={3}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e8ecf0", fontSize: 12, fontFamily: "inherit", outline: "none", resize: "vertical", lineHeight: 1.5, boxSizing: "border-box", color: "#0d1117", background: "white" }}
              />
            </div>

            {/* Impact */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#0d1117", display: "block", marginBottom: 4 }}>
                Schedule & delivery impact
              </label>
              <textarea
                value={impact}
                onChange={(e) => setImpact(e.target.value)}
                placeholder="e.g. No impact on budget. UAT phase compressed by 1 week. Go-live date maintained."
                rows={2}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e8ecf0", fontSize: 12, fontFamily: "inherit", outline: "none", resize: "vertical", lineHeight: 1.5, boxSizing: "border-box", color: "#0d1117", background: "white" }}
              />
            </div>

            {error && (
              <div style={{ padding: "8px 12px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", fontSize: 12, color: "#b91c1c" }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, paddingTop: 4 }}>
              <button onClick={onClose} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #e8ecf0", background: "white", color: "#57606a", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={submitting || !hasChange}
                style={{ flex: 2, padding: "10px 0", borderRadius: 8, border: "1px solid #0d1117", background: submitting || !hasChange ? "#8b949e" : "#0d1117", color: "white", fontSize: 12, fontWeight: 700, cursor: submitting || !hasChange ? "not-allowed" : "pointer" }}
              >
                {submitting ? "Submitting..." : "Submit change request"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* - Shared date stat cell - */

function DateStatCell({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div style={{ background: "#ffffff", border: "1px solid #e8ecf0", borderRadius: 12, padding: 20 }}>
      <div style={{ fontSize: 11, color: "#8b949e", fontWeight: 500, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: "#0d1117", lineHeight: 1.2 }}>{value}</div>
      <div style={{ fontSize: 12, color: "#8b949e", marginTop: 4 }}>{sub}</div>
    </div>
  );
}

/* - Main export - */

export default function ProjectDateEditor({
  projectId, projectTitle, startDate, finishDate, resourceStatus, canEdit,
}: Props) {
  const router = useRouter();
  const [showCrModal, setShowCrModal] = useState(false);
  const isPipeline = resourceStatus === "pipeline";

  // Read-only view for viewers
  if (!canEdit) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <DateStatCell label="Start Date" value={fmtDisplay(startDate)} sub="Kickoff" />
        <DateStatCell label="End Date" value={fmtDisplay(finishDate)} sub="Deadline" />
      </div>
    );
  }

  // Pipeline -- inline edit
  if (isPipeline) {
    return (
      <PipelineDateEdit
        projectId={projectId}
        startDate={startDate}
        finishDate={finishDate}
        onSaved={() => router.refresh()}
      />
    );
  }

  // Active -- show dates + CR button
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <DateStatCell label="Start Date" value={fmtDisplay(startDate)} sub="Kickoff" />
        <DateStatCell label="End Date" value={fmtDisplay(finishDate)} sub="Deadline" />
      </div>

      <button
        onClick={() => setShowCrModal(true)}
        style={{
          alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6,
          padding: "6px 12px", borderRadius: 8, border: "1px solid #e8ecf0",
          background: "#f6f8fa", color: "#57606a", fontSize: 11, fontWeight: 600,
          cursor: "pointer", transition: "all 0.15s",
        }}
      >
        - Request date change
      </button>

      <div style={{ fontSize: 10, color: "#8b949e" }}>
        Active project -- date changes require a change request and approval.
      </div>

      {showCrModal && (
        <DateChangeRequestModal
          projectId={projectId}
          projectTitle={projectTitle}
          startDate={startDate}
          finishDate={finishDate}
          onClose={() => setShowCrModal(false)}
        />
      )}
    </div>
  );
}