"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type CriterionStatus = "pass" | "fail" | "warn";

type GateCriterion = {
  id: string;
  label: string;
  description: string;
  status: CriterionStatus;
  detail?: string | null;
  href?: string | null;
};

type Gate1Result = {
  ok: boolean;
  canProceed: boolean;
  passCount: number;
  failCount: number;
  warnCount: number;
  criteria: GateCriterion[];
  projectId: string;
  checkedAt: string;
};

type Props = {
  projectId: string;
  isAdmin: boolean;
  returnTo?: string;
};

const STATUS_CFG = {
  pass: {
    icon: "✓",
    iconStyle: { color: "#15803d", background: "#f0fdf4", border: "1px solid #bbf7d0" },
    labelStyle: { color: "#15803d" },
    rowStyle: { background: "#f0fdf4", border: "1px solid #bbf7d0" },
  },
  warn: {
    icon: "⚠",
    iconStyle: { color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a" },
    labelStyle: { color: "#b45309" },
    rowStyle: { background: "#fffbeb", border: "1px solid #fde68a" },
  },
  fail: {
    icon: "✗",
    iconStyle: { color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca" },
    labelStyle: { color: "#b91c1c" },
    rowStyle: { background: "#fef2f2", border: "1px solid #fecaca" },
  },
};

export default function Gate1Checker({ projectId, isAdmin, returnTo }: Props) {
  const router = useRouter();
  const [gate, setGate] = useState<Gate1Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOverride, setShowOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const fetchGate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/gate/check?gate=1`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "Gate check failed");
      setGate(j);
    } catch (e: any) {
      setError(e?.message || "Failed to load gate check");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchGate(); }, [fetchGate]);

  async function handleConvert(override = false) {
    if (override && !overrideReason.trim()) {
      setOverrideError("You must provide a reason to override the gate.");
      return;
    }

    setConverting(true);
    setError(null);
    setOverrideError(null);

    try {
      const body = new FormData();
      body.append("project_id", projectId);
      body.append("return_to", returnTo ?? `/projects/${projectId}`);
      if (override) {
        body.append("gate_override", "true");
        body.append("gate_override_reason", overrideReason.trim());
      }

      const r = await fetch("/api/projects/convert-to-confirmed", {
        method: "POST",
        body,
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.error || `Failed (${r.status})`);

      router.push(returnTo ?? `/projects/${projectId}`);
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Conversion failed");
      setConverting(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: "32px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 13, color: "#8b949e" }}>Running Gate 1 checks…</div>
        <div style={{ marginTop: 12, display: "flex", gap: 8, flexDirection: "column" }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ height: 52, borderRadius: 10, background: "#f6f8fa", animation: "pulse 1.5s ease infinite" }} />
          ))}
        </div>
      </div>
    );
  }

  if (error && !gate) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ padding: "10px 14px", borderRadius: 10, background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", fontSize: 13 }}>
          {error}
        </div>
        <button onClick={fetchGate} style={{ marginTop: 12, fontSize: 12, color: "#3b82f6", background: "none", border: "none", cursor: "pointer" }}>
          Retry
        </button>
      </div>
    );
  }

  if (!gate) return null;

  const allPass = gate.failCount === 0 && gate.warnCount === 0;
  const hasFailures = gate.failCount > 0;
  const hasWarnings = gate.warnCount > 0 && gate.failCount === 0;

  return (
    <div style={{ fontFamily: "'Geist', -apple-system, sans-serif" }}>
      {/* Header summary */}
      <div style={{
        padding: "16px 20px",
        borderBottom: "1px solid #e8ecf0",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: allPass ? "#f0fdf4" : hasWarnings ? "#fffbeb" : "#fef2f2",
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: allPass ? "#15803d" : hasWarnings ? "#b45309" : "#b91c1c" }}>
            {allPass ? "✓ Gate 1 — All criteria met" : hasWarnings ? "⚠ Gate 1 — Warnings present" : "✗ Gate 1 — Criteria not met"}
          </div>
          <div style={{ fontSize: 11, color: "#8b949e", marginTop: 2 }}>
            {gate.passCount} passed · {gate.warnCount} warnings · {gate.failCount} failed
          </div>
        </div>
        <button
          onClick={fetchGate}
          style={{ fontSize: 11, color: "#8b949e", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
        >
          ↻ Refresh
        </button>
      </div>

      {/* Criteria list */}
      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
        {gate.criteria.map((c) => {
          const cfg = STATUS_CFG[c.status];
          return (
            <div key={c.id} style={{ borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "flex-start", gap: 12, ...cfg.rowStyle }}>
              <div style={{
                width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0,
                ...cfg.iconStyle,
              }}>
                {cfg.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, ...cfg.labelStyle }}>{c.label}</span>
                  {c.href && c.status !== "pass" && (
                    <a
                      href={c.href}
                      style={{ fontSize: 11, color: "#3b82f6", textDecoration: "none", fontWeight: 600, whiteSpace: "nowrap" }}
                    >
                      Fix →
                    </a>
                  )}
                </div>
                {c.detail && (
                  <p style={{ fontSize: 11, color: "#57606a", margin: "3px 0 0", lineHeight: 1.5 }}>{c.detail}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Action section */}
      <div style={{ padding: "0 20px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
        {error && (
          <div style={{ padding: "8px 12px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", fontSize: 12, color: "#b91c1c" }}>
            {error}
          </div>
        )}

        {/* Primary action — available when all pass */}
        {allPass && (
          <button
            onClick={() => handleConvert(false)}
            disabled={converting}
            style={{
              width: "100%", padding: "11px 0", borderRadius: 10, border: "1px solid #15803d",
              background: converting ? "#8b949e" : "#15803d", color: "white",
              fontSize: 13, fontWeight: 700, cursor: converting ? "not-allowed" : "pointer",
              transition: "all 0.15s",
            }}
          >
            {converting ? "Converting…" : "✓ Convert to Active"}
          </button>
        )}

        {/* Warnings — allow proceed with confirmation */}
        {hasWarnings && !showOverride && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setShowOverride(true)}
              disabled={converting}
              style={{
                flex: 1, padding: "11px 0", borderRadius: 10, border: "1px solid #f59e0b",
                background: "#fffbeb", color: "#b45309",
                fontSize: 13, fontWeight: 700, cursor: "pointer",
              }}
            >
              ⚠ Proceed with warnings
            </button>
          </div>
        )}

        {/* Admin override — available when there are failures */}
        {hasFailures && isAdmin && !showOverride && (
          <button
            onClick={() => setShowOverride(true)}
            style={{
              width: "100%", padding: "9px 0", borderRadius: 10,
              border: "1px solid #e8ecf0", background: "#f6f8fa",
              color: "#57606a", fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}
          >
            Admin override — proceed with exceptions
          </button>
        )}

        {/* Override reason panel */}
        {showOverride && (
          <div style={{ borderRadius: 10, border: "1px solid #e8ecf0", padding: 14, background: "#fafbfc" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#0d1117", marginBottom: 8 }}>
              {hasFailures ? "Override reason (Admin)" : "Proceed with warnings — add note"}
            </div>
            <div style={{ fontSize: 11, color: "#57606a", marginBottom: 10, lineHeight: 1.5 }}>
              {hasFailures
                ? "This project is missing required Gate 1 criteria. As an admin you can override, but your reason will be recorded against the gate and visible in the project audit trail."
                : "Some criteria have warnings. Your note will be recorded in the gate audit trail."}
            </div>
            <textarea
              value={overrideReason}
              onChange={(e) => { setOverrideReason(e.target.value); setOverrideError(null); }}
              placeholder={hasFailures
                ? "e.g. Charter is in review with sponsor, approved verbally — formal sign-off to follow within 48 hours."
                : "e.g. WBS is in progress, delivery team has verbal agreement on scope."}
              rows={3}
              style={{
                width: "100%", borderRadius: 8, border: `1px solid ${overrideError ? "#fecaca" : "#e8ecf0"}`,
                padding: "8px 10px", fontSize: 12, color: "#0d1117", fontFamily: "inherit",
                outline: "none", resize: "vertical", lineHeight: 1.5, boxSizing: "border-box",
              }}
            />
            {overrideError && (
              <p style={{ fontSize: 11, color: "#b91c1c", margin: "4px 0 0" }}>{overrideError}</p>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button
                onClick={() => { setShowOverride(false); setOverrideReason(""); setOverrideError(null); }}
                style={{
                  flex: 1, padding: "9px 0", borderRadius: 8, border: "1px solid #e8ecf0",
                  background: "white", color: "#57606a", fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleConvert(true)}
                disabled={converting}
                style={{
                  flex: 2, padding: "9px 0", borderRadius: 8,
                  border: `1px solid ${hasFailures ? "#7c3aed" : "#f59e0b"}`,
                  background: hasFailures ? "#7c3aed" : "#f59e0b",
                  color: "white", fontSize: 12, fontWeight: 700,
                  cursor: converting ? "not-allowed" : "pointer",
                  opacity: converting ? 0.6 : 1,
                }}
              >
                {converting ? "Converting…" : hasFailures ? "Override & Convert" : "Confirm & Convert"}
              </button>
            </div>
          </div>
        )}

        {/* Non-admin blocked message */}
        {hasFailures && !isAdmin && (
          <div style={{ padding: "10px 14px", borderRadius: 10, background: "#f6f8fa", border: "1px solid #e8ecf0", fontSize: 12, color: "#57606a", textAlign: "center" }}>
            Complete all required criteria above before converting to active.<br />
            <span style={{ fontSize: 11, color: "#8b949e" }}>Contact an org admin if you need to override.</span>
          </div>
        )}
      </div>
    </div>
  );
}
