import "server-only";
import React from "react";
import Link from "next/link";
import { loadGate5Status } from "@/app/projects/[id]/gate5/gate5-actions";

export default async function Gate5BadgeServer({
  projectId,
  projectRef,
}: {
  projectId: string;
  projectRef: string;
}) {
  let data;
  try {
    data = await loadGate5Status(projectId);
  } catch {
    return null;
  }

  if (!data) return null;

  const { readinessScore, mandatoryBlocked, canClose, riskLevel, daysToEndDate, passedChecks } = data;

  const c =
    riskLevel === "green"
      ? { bg: "#f0fdf4", border: "#bbf7d0", text: "#15803d", accent: "#16a34a" }
      : riskLevel === "amber"
      ? { bg: "#fffbeb", border: "#fde68a", text: "#92400e", accent: "#d97706" }
      : { bg: "#fef2f2", border: "#fecaca", text: "#b91c1c", accent: "#dc2626" };

  const urgencyLabel =
    daysToEndDate !== null && daysToEndDate < 0
      ? `End date passed ${Math.abs(daysToEndDate)}d ago`
      : daysToEndDate !== null && daysToEndDate <= 30
      ? `${daysToEndDate}d to end date`
      : null;

  return (
    <div
      style={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 12,
        padding: "14px 18px",
        marginBottom: 14,
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
        fontFamily: "'Geist', -apple-system, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: c.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: "monospace" }}>G5</span>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: c.text }}>Gate 5 — Closure Readiness</div>
          <div style={{ fontSize: 11, color: c.text, opacity: 0.8, marginTop: 1 }}>
            {canClose
              ? "All mandatory checks passed — ready to close"
              : `${mandatoryBlocked} mandatory item${mandatoryBlocked > 1 ? "s" : ""} blocking closure`}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 180 }}>
        <div style={{ height: 5, background: "#e2e8f0", borderRadius: 99, overflow: "hidden", flex: 1 }}>
          <div style={{ height: "100%", width: `${readinessScore}%`, background: c.accent, borderRadius: 99 }} />
        </div>
        <span style={{ fontSize: 16, fontWeight: 700, color: c.text, fontFamily: "monospace", minWidth: 42, textAlign: "right" }}>
          {readinessScore}%
        </span>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20, background: "#dcfce7", color: "#15803d", border: "1px solid #bbf7d0" }}>
          {passedChecks} passed
        </span>
        {mandatoryBlocked > 0 && (
          <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20, background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca" }}>
            {mandatoryBlocked} blocked
          </span>
        )}
        {urgencyLabel && (
          <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20, background: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
            {urgencyLabel}
          </span>
        )}
      </div>

      <Link
        href={`/projects/${projectRef}/gate5`}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
          background: c.accent, color: "#fff", textDecoration: "none", flexShrink: 0,
        }}
      >
        {canClose ? "View Gate 5 ✓" : "View & resolve →"}
      </Link>
    </div>
  );
}
