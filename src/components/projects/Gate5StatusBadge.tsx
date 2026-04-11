import "server-only";
import React from "react";
import Link from "next/link";
import { loadGate5Status } from "@/app/projects/[id]/gate5/gate5-actions";

function statusColors(riskLevel: "green" | "amber" | "red", readinessScore: number) {
  if (riskLevel === "green") return { bg: "#f0fdf4", border: "#bbf7d0", text: "#15803d", accent: "#16a34a", dot: "#22c55e" };
  if (riskLevel === "amber") return { bg: "#fffbeb", border: "#fde68a", text: "#92400e", accent: "#d97706", dot: "#f59e0b" };
  return { bg: "#fef2f2", border: "#fecaca", text: "#b91c1c", accent: "#dc2626", dot: "#ef4444" };
}

function MiniProgressBar({ score, color }: { score: number; color: string }) {
  return (
    <div style={{ height: 5, background: "#e2e8f0", borderRadius: 99, overflow: "hidden", flex: 1 }}>
      <div style={{ height: "100%", width: `${score}%`, background: color, borderRadius: 99, transition: "width 0.6s ease" }} />
    </div>
  );
}

export default async function Gate5StatusBadge({
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

  const { readinessScore, mandatoryBlocked, canClose, riskLevel, daysToEndDate, passedChecks, totalChecks } = data;
  const c = statusColors(riskLevel, readinessScore);

  const urgencyLabel =
    daysToEndDate !== null && daysToEndDate < 0
      ? `End date passed ${Math.abs(daysToEndDate)}d ago`
      : daysToEndDate !== null && daysToEndDate <= 7
      ? `${daysToEndDate}d to end date`
      : daysToEndDate !== null && daysToEndDate <= 30
      ? `${daysToEndDate} days to end date`
      : daysToEndDate !== null
      ? `${daysToEndDate} days remaining`
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
      }}
    >
      {/* Gate label */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: c.accent,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <span style={{ color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: "'Geist Mono', monospace" }}>G5</span>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: c.text, fontFamily: "'Geist', sans-serif" }}>
            Gate 5 — Closure Readiness
          </div>
          <div style={{ fontSize: 11, color: c.text, opacity: 0.8, fontFamily: "'Geist', sans-serif", marginTop: 1 }}>
            {canClose
              ? "All mandatory checks passed — ready to close"
              : `${mandatoryBlocked} mandatory item${mandatoryBlocked > 1 ? "s" : ""} blocking closure`}
          </div>
        </div>
      </div>

      {/* Progress bar + score */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 180 }}>
        <MiniProgressBar score={readinessScore} color={c.accent} />
        <span
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: c.text,
            fontFamily: "'Geist Mono', monospace",
            flexShrink: 0,
            minWidth: 42,
            textAlign: "right",
          }}
        >
          {readinessScore}%
        </span>
      </div>

      {/* Checks summary */}
      <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: "3px 10px",
            borderRadius: 20,
            background: "#dcfce7",
            color: "#15803d",
            border: "1px solid #bbf7d0",
            fontFamily: "'Geist', sans-serif",
          }}
        >
          {passedChecks} passed
        </span>
        {mandatoryBlocked > 0 && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "3px 10px",
              borderRadius: 20,
              background: "#fef2f2",
              color: "#b91c1c",
              border: "1px solid #fecaca",
              fontFamily: "'Geist', sans-serif",
            }}
          >
            {mandatoryBlocked} blocked
          </span>
        )}
        {urgencyLabel && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "3px 10px",
              borderRadius: 20,
              background: riskLevel === "red" ? "#fef2f2" : riskLevel === "amber" ? "#fffbeb" : "#f0fdf4",
              color: c.text,
              border: `1px solid ${c.border}`,
              fontFamily: "'Geist', sans-serif",
            }}
          >
            {urgencyLabel}
          </span>
        )}
      </div>

      {/* CTA */}
      <Link
        href={`/projects/${projectRef}/gate5`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "7px 14px",
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 600,
          background: c.accent,
          color: "#fff",
          textDecoration: "none",
          fontFamily: "'Geist', sans-serif",
          flexShrink: 0,
          whiteSpace: "nowrap",
        }}
      >
        {canClose ? "View Gate 5 ✓" : "View & resolve →"}
      </Link>
    </div>
  );
}
