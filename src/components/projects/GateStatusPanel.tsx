"use client";

import React, { useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";

const Gate1Checker = dynamic(() => import("./Gate1Checker"), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 32, textAlign: "center", color: "#8b949e", fontSize: 13 }}>
      Running gate checks…
    </div>
  ),
});

type GateRecord = {
  id: string;
  gate_number: number;
  gate_name: string;
  status: "passed" | "passed_with_override" | "failed";
  passed_at: string | null;
  passed_by: string | null;
  override: boolean;
  override_reason: string | null;
  pass_count: number;
  warn_count: number;
  fail_count: number;
  criteria_snapshot: any[] | null;
  passer_name?: string | null;
};

type Props = {
  projectId: string;
  projectTitle: string;
  isAdmin: boolean;
  gateRecord: GateRecord | null; // null = never gated (created directly as active)
  returnTo?: string;
};

function fmtDateTime(iso: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function CriteriaSnapshot({ criteria }: { criteria: any[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
      {criteria.map((c: any) => {
        const cfg = {
          pass: { icon: "✓", color: "#15803d", bg: "#f0fdf4", border: "#bbf7d0" },
          warn: { icon: "⚠", color: "#b45309", bg: "#fffbeb", border: "#fde68a" },
          fail: { icon: "✗", color: "#b91c1c", bg: "#fef2f2", border: "#fecaca" },
        }[c.status as "pass" | "warn" | "fail"] ?? { icon: "?", color: "#8b949e", bg: "#f6f8fa", border: "#e8ecf0" };

        return (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 8, background: cfg.bg, border: `1px solid ${cfg.border}` }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: cfg.color, width: 14, textAlign: "center" }}>{cfg.icon}</span>
            <span style={{ fontSize: 12, color: "#0d1117", fontWeight: 500, flex: 1 }}>{c.label}</span>
            {c.detail && <span style={{ fontSize: 11, color: "#8b949e" }}>{c.detail}</span>}
          </div>
        );
      })}
    </div>
  );
}

function GateRecordView({ gate, onViewSnapshot, showSnapshot, onClose }: {
  gate: GateRecord;
  onViewSnapshot: () => void;
  showSnapshot: boolean;
  onClose: () => void;
}) {
  const isPassed   = gate.status === "passed";
  const isOverride = gate.status === "passed_with_override";

  const statusCfg = isPassed
    ? { bg: "#f0fdf4", border: "#bbf7d0", color: "#15803d", icon: "✓", label: "Gate 1 — Passed" }
    : isOverride
      ? { bg: "#fffbeb", border: "#fde68a", color: "#b45309", icon: "⚠", label: "Gate 1 — Passed with override" }
      : { bg: "#fef2f2", border: "#fecaca", color: "#b91c1c", icon: "✗", label: "Gate 1 — Not passed" };

  return (
    <div style={{ borderRadius: 12, border: `1px solid ${statusCfg.border}`, background: statusCfg.bg, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 26, height: 26, borderRadius: "50%", background: "white", border: `1px solid ${statusCfg.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: statusCfg.color, flexShrink: 0 }}>
            {statusCfg.icon}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: statusCfg.color }}>{statusCfg.label}</div>
            <div style={{ fontSize: 11, color: "#8b949e", marginTop: 1 }}>
              {gate.pass_count} passed · {gate.warn_count} warnings · {gate.fail_count} failed
              {gate.passed_at && ` · ${fmtDateTime(gate.passed_at)}`}
            </div>
          </div>
        </div>
        <button
          onClick={onViewSnapshot}
          style={{ fontSize: 11, color: "#3b82f6", background: "none", border: "none", cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}
        >
          {showSnapshot ? "Hide detail" : "View detail"}
        </button>
      </div>

      {/* Override reason */}
      {isOverride && gate.override_reason && (
        <div style={{ padding: "10px 16px", borderTop: `1px solid ${statusCfg.border}`, background: "rgba(255,255,255,0.5)" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#b45309", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>
            Override reason
          </div>
          <p style={{ fontSize: 12, color: "#57606a", margin: 0, lineHeight: 1.5 }}>
            {gate.override_reason}
          </p>
          {gate.passer_name && (
            <p style={{ fontSize: 11, color: "#8b949e", margin: "4px 0 0" }}>
              Recorded by {gate.passer_name}
            </p>
          )}
        </div>
      )}

      {/* Snapshot */}
      {showSnapshot && gate.criteria_snapshot && Array.isArray(gate.criteria_snapshot) && (
        <div style={{ padding: "0 16px 16px", borderTop: `1px solid ${statusCfg.border}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 12, marginBottom: 4 }}>
            Criteria at baseline
          </div>
          <CriteriaSnapshot criteria={gate.criteria_snapshot} />
        </div>
      )}
    </div>
  );
}

function RecordBaselineModal({ projectId, isAdmin, returnTo, onClose }: {
  projectId: string;
  isAdmin: boolean;
  returnTo?: string;
  onClose: () => void;
}) {
  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(10,10,10,0.35)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{ background: "#ffffff", borderRadius: 16, width: "100%", maxWidth: 560, boxShadow: "0 24px 60px rgba(0,0,0,0.18)", border: "1px solid #e8ecf0", maxHeight: "90vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid #e8ecf0" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8b949e", marginBottom: 4 }}>
            Governance Gate
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h2 style={{ fontSize: 17, fontWeight: 750, color: "#0d1117", margin: 0, letterSpacing: "-0.02em" }}>
                Gate 1 — Record Baseline
              </h2>
              <p style={{ fontSize: 12, color: "#57606a", margin: "4px 0 0", lineHeight: 1.5 }}>
                This project was created as active. Run the Gate 1 check now to record a retrospective baseline.
              </p>
            </div>
            <button
              onClick={onClose}
              style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid #e8ecf0", background: "#f6f8fa", cursor: "pointer", fontSize: 14, color: "#57606a", flexShrink: 0 }}
            >
              ✕
            </button>
          </div>
        </div>
        <Gate1Checker
          projectId={projectId}
          isAdmin={isAdmin}
          returnTo={returnTo}
          mode="record-baseline"
        />
      </div>
    </div>,
    document.body,
  );
}

export default function GateStatusPanel({ projectId, projectTitle, isAdmin, gateRecord, returnTo }: Props) {
  const [showSnapshot, setShowSnapshot] = useState(false);
  const [showModal, setShowModal] = useState(false);

  // Project was gated — show the record
  if (gateRecord) {
    return (
      <div style={{ marginBottom: 16 }}>
        <GateRecordView
          gate={gateRecord}
          onViewSnapshot={() => setShowSnapshot((v) => !v)}
          showSnapshot={showSnapshot}
          onClose={() => setShowSnapshot(false)}
        />
      </div>
    );
  }

  // Project was never gated (created directly as active)
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ borderRadius: 12, border: "1px solid #e8ecf0", background: "#f6f8fa", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#e8ecf0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#8b949e", flexShrink: 0 }}>
            ?
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0d1117" }}>Gate 1 — No baseline recorded</div>
            <div style={{ fontSize: 11, color: "#8b949e", marginTop: 1 }}>
              This project was created directly as active and has no Gate 1 record.
            </div>
          </div>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowModal(true)}
            style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #7c3aed", background: "#ede9fe", color: "#7c3aed", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            Record baseline
          </button>
        )}
      </div>
      {showModal && (
        <RecordBaselineModal
          projectId={projectId}
          isAdmin={isAdmin}
          returnTo={returnTo}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
