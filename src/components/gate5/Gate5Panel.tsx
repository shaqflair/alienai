"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import type { Gate5Result, Gate5Check } from "./gate5-actions";
import { toggleManualCheck, getAiGate5Guidance } from "./gate5-actions";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Circle,
  Loader2,
  Sparkles,
  Clock,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  RefreshCw,
} from "lucide-react";

/* ── Status helpers ── */

function statusIcon(status: Gate5Check["status"], size = 18) {
  const s = size;
  if (status === "pass" || status === "manual_done")
    return <CheckCircle2 size={s} style={{ color: "#16a34a", flexShrink: 0 }} />;
  if (status === "fail")
    return <XCircle size={s} style={{ color: "#dc2626", flexShrink: 0 }} />;
  if (status === "warn")
    return <AlertTriangle size={s} style={{ color: "#d97706", flexShrink: 0 }} />;
  return <Circle size={s} style={{ color: "#94a3b8", flexShrink: 0 }} />;
}

function statusColor(status: Gate5Check["status"]) {
  if (status === "pass" || status === "manual_done") return { bg: "#f0fdf4", border: "#bbf7d0", text: "#15803d" };
  if (status === "fail") return { bg: "#fef2f2", border: "#fecaca", text: "#b91c1c" };
  if (status === "warn") return { bg: "#fffbeb", border: "#fde68a", text: "#92400e" };
  return { bg: "#f8fafc", border: "#e2e8f0", text: "#475569" };
}

function statusLabel(status: Gate5Check["status"]) {
  if (status === "pass") return "Pass";
  if (status === "manual_done") return "Confirmed";
  if (status === "fail") return "Blocked";
  if (status === "warn") return "Review";
  return "Pending";
}

function riskColors(level: "green" | "amber" | "red") {
  if (level === "green") return { bg: "#dcfce7", text: "#15803d", label: "Ready to close" };
  if (level === "amber") return { bg: "#fef3c7", text: "#92400e", label: "Action needed" };
  return { bg: "#fee2e2", text: "#b91c1c", label: "High risk" };
}

function ProgressRing({ score, size = 80 }: { score: number; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 80 ? "#16a34a" : score >= 50 ? "#d97706" : "#dc2626";
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={6} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={6}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)" }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 18, fontWeight: 600, color, fontFamily: "'DM Mono', monospace" }}>{score}</span>
      </div>
    </div>
  );
}

/* ── Check item card ── */

function CheckCard({
  check,
  projectId,
  onToggle,
}: {
  check: Gate5Check;
  projectId: string;
  onToggle: (key: string, done: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(check.status === "fail" || check.status === "warn");
  const [isPending, startTransition] = useTransition();
  const [notesDraft, setNotesDraft] = useState(check.notes || "");
  const c = statusColor(check.status);
  const isDone = check.status === "pass" || check.status === "manual_done";

  return (
    <div
      style={{
        border: `1px solid ${c.border}`,
        borderRadius: 10,
        background: c.bg,
        overflow: "hidden",
        transition: "all 0.2s ease",
      }}
    >
      {/* Header row */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {statusIcon(check.status)}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: "#0f172a", fontFamily: "'DM Sans', sans-serif" }}>
              {check.title}
            </span>
            {!check.mandatory && (
              <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4, background: "#f1f5f9", color: "#64748b", fontFamily: "'DM Sans', sans-serif", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Optional
              </span>
            )}
            <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: isDone ? "#dcfce7" : c.bg, color: c.text, border: `1px solid ${c.border}`, fontFamily: "'DM Sans', sans-serif" }}>
              {statusLabel(check.status)}
            </span>
          </div>
          {!expanded && (
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b", fontFamily: "'DM Sans', sans-serif" }}>
              {check.description}
            </p>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {check.actionHref && !isDone && (
            <Link
              href={check.actionHref}
              onClick={(e) => e.stopPropagation()}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "5px 10px", borderRadius: 8, fontSize: 12, fontWeight: 500,
                background: "#0f172a", color: "#fff", textDecoration: "none",
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              {check.actionLabel}
              <ExternalLink size={11} />
            </Link>
          )}
          {expanded ? <ChevronDown size={16} style={{ color: "#94a3b8" }} /> : <ChevronRight size={16} style={{ color: "#94a3b8" }} />}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ padding: "0 16px 14px", borderTop: `1px solid ${c.border}` }}>
          <p style={{ margin: "12px 0 8px", fontSize: 13, color: "#374151", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.6 }}>
            {check.detail || check.description}
          </p>

          {check.completedBy && (
            <p style={{ margin: "4px 0", fontSize: 12, color: "#64748b", fontFamily: "'DM Mono', monospace" }}>
              Confirmed by {check.completedBy}
              {check.completedAt && ` · ${new Date(check.completedAt).toLocaleDateString("en-GB")}`}
            </p>
          )}

          {/* Manual toggle */}
          {check.category === "manual" && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                rows={2}
                placeholder="Optional notes (e.g. invoice ref, handover contact)..."
                style={{
                  width: "100%", fontSize: 12, padding: "8px 10px",
                  borderRadius: 8, border: "1px solid #d1d5db",
                  fontFamily: "'DM Sans', sans-serif", resize: "vertical",
                  boxSizing: "border-box", background: "rgba(255,255,255,0.8)",
                  color: "#0f172a",
                }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  disabled={isPending || isDone}
                  onClick={() => {
                    startTransition(async () => {
                      await toggleManualCheck(projectId, check.key, true, notesDraft);
                      onToggle(check.key, true);
                    });
                  }}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500,
                    background: isDone ? "#e2e8f0" : "#16a34a", color: isDone ? "#94a3b8" : "#fff",
                    border: "none", cursor: isDone ? "not-allowed" : "pointer",
                    fontFamily: "'DM Sans', sans-serif", opacity: isPending ? 0.6 : 1,
                  }}
                >
                  {isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  {isDone ? "Confirmed" : "Confirm completed"}
                </button>
                {isDone && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => {
                      startTransition(async () => {
                        await toggleManualCheck(projectId, check.key, false);
                        onToggle(check.key, false);
                      });
                    }}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500,
                      background: "transparent", color: "#64748b",
                      border: "1px solid #d1d5db", cursor: "pointer",
                      fontFamily: "'DM Sans', sans-serif",
                    }}
                  >
                    <RefreshCw size={13} /> Undo
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── AI Guidance Panel ── */

function AiGuidancePanel({
  blockedChecks,
}: {
  blockedChecks: Array<{ key: string; title: string; detail: string }>;
}) {
  const [guidance, setGuidance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchGuidance() {
    setLoading(true);
    setError(null);
    try {
      const text = await getAiGate5Guidance("", blockedChecks);
      setGuidance(text);
    } catch (e: any) {
      setError("AI guidance unavailable. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (blockedChecks.length === 0) {
    return (
      <div style={{ padding: "16px 20px", borderRadius: 12, background: "#f0fdf4", border: "1px solid #bbf7d0", display: "flex", alignItems: "center", gap: 12 }}>
        <CheckCircle2 size={20} style={{ color: "#16a34a", flexShrink: 0 }} />
        <div>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: "#15803d", fontFamily: "'DM Sans', sans-serif" }}>All checks passing — ready to close</p>
          <p style={{ margin: "2px 0 0", fontSize: 13, color: "#166534", fontFamily: "'DM Sans', sans-serif" }}>
            Submit the Project Closure Report for final approval to complete Gate 5.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ borderRadius: 12, border: "1px solid #e0e7ff", background: "linear-gradient(135deg, #eef2ff 0%, #f5f3ff 100%)", overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Sparkles size={18} style={{ color: "#fff" }} />
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: "#312e81", fontFamily: "'DM Sans', sans-serif" }}>
            AI Closure Assistant
          </p>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "#4338ca", fontFamily: "'DM Sans', sans-serif" }}>
            {blockedChecks.length} item{blockedChecks.length > 1 ? "s" : ""} blocked — get a tailored action plan
          </p>
        </div>
        {!guidance && (
          <button
            type="button"
            onClick={fetchGuidance}
            disabled={loading}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 500,
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff",
              border: "none", cursor: loading ? "not-allowed" : "pointer",
              fontFamily: "'DM Sans', sans-serif", opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {loading ? "Thinking..." : "Get action plan"}
          </button>
        )}
      </div>

      {(guidance || error) && (
        <div style={{ padding: "0 20px 16px" }}>
          <div style={{ borderTop: "1px solid #c7d2fe", paddingTop: 14 }}>
            {error ? (
              <p style={{ margin: 0, fontSize: 13, color: "#b91c1c", fontFamily: "'DM Sans', sans-serif" }}>{error}</p>
            ) : (
              <div style={{ fontSize: 13, color: "#1e1b4b", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                {guidance}
              </div>
            )}
            <button
              type="button"
              onClick={fetchGuidance}
              disabled={loading}
              style={{
                marginTop: 12, display: "inline-flex", alignItems: "center", gap: 5,
                padding: "5px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                background: "transparent", color: "#4338ca",
                border: "1px solid #c7d2fe", cursor: "pointer",
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Countdown banner ── */

function CountdownBanner({ daysToEndDate, riskLevel }: { daysToEndDate: number | null; riskLevel: "green" | "amber" | "red" }) {
  if (daysToEndDate === null) return null;
  const rc = riskColors(riskLevel);
  const label =
    daysToEndDate < 0
      ? `Project end date was ${Math.abs(daysToEndDate)} day${Math.abs(daysToEndDate) === 1 ? "" : "s"} ago`
      : daysToEndDate === 0
      ? "Project end date is today"
      : `${daysToEndDate} day${daysToEndDate === 1 ? "" : "s"} until project end date`;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderRadius: 10, background: rc.bg, border: `1px solid ${rc.text}30` }}>
      <Clock size={16} style={{ color: rc.text, flexShrink: 0 }} />
      <span style={{ fontSize: 13, fontWeight: 500, color: rc.text, fontFamily: "'DM Sans', sans-serif" }}>{label}</span>
      <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: rc.bg, color: rc.text, border: `1px solid ${rc.text}40`, fontFamily: "'DM Sans', sans-serif" }}>
        {rc.label}
      </span>
    </div>
  );
}

/* ── Main Panel ── */

export default function Gate5Panel({
  projectId,
  initialData,
}: {
  projectId: string;
  initialData: Gate5Result;
}) {
  const [data, setData] = useState<Gate5Result>(initialData);
  const [activeTab, setActiveTab] = useState<"all" | "blocked" | "passed">("all");

  function handleToggle(key: string, done: boolean) {
    setData((prev) => {
      const checks = prev.checks.map((c) =>
        c.key === key ? { ...c, status: (done ? "manual_done" : "manual_pending") as any } : c
      );
      const passed = checks.filter((c) => c.status === "pass" || c.status === "manual_done").length;
      const mandatoryBlocked = checks.filter((c) => c.mandatory && c.status !== "pass" && c.status !== "manual_done").length;
      const readinessScore = Math.round((passed / checks.length) * 100);
      const canClose = mandatoryBlocked === 0;
      return { ...prev, checks, passedChecks: passed, mandatoryBlocked, readinessScore, canClose };
    });
  }

  const filtered =
    activeTab === "blocked"
      ? data.checks.filter((c) => c.status !== "pass" && c.status !== "manual_done")
      : activeTab === "passed"
      ? data.checks.filter((c) => c.status === "pass" || c.status === "manual_done")
      : data.checks;

  const blockedForAI = data.checks
    .filter((c) => c.status !== "pass" && c.status !== "manual_done" && c.mandatory)
    .map((c) => ({ key: c.key, title: c.title, detail: c.detail || c.description }));

  const autoChecks = data.checks.filter((c) => c.category === "auto");
  const manualChecks = data.checks.filter((c) => c.category === "manual");

  return (
    <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", maxWidth: 900, margin: "0 auto", padding: "0 0 40px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');
        .g5-tab { transition: all 0.15s ease; }
        .g5-tab:hover { background: #f1f5f9 !important; }
        .g5-tab.active { background: #0f172a !important; color: #fff !important; }
        @keyframes g5-spin { to { transform: rotate(360deg); } }
        .animate-spin { animation: g5-spin 1s linear infinite; }
      `}</style>

      {/* Summary header */}
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 24, alignItems: "center", padding: "20px 0 24px" }}>
        <ProgressRing score={data.readinessScore} size={88} />

        <div>
          <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 500, color: "#0f172a" }}>
            Gate 5 — Closure Readiness
          </h2>
          <p style={{ margin: 0, fontSize: 14, color: "#64748b" }}>
            {data.passedChecks} of {data.totalChecks} checks complete
            {data.mandatoryBlocked > 0 && (
              <span style={{ marginLeft: 8, color: "#b91c1c", fontWeight: 500 }}>
                · {data.mandatoryBlocked} mandatory item{data.mandatoryBlocked > 1 ? "s" : ""} blocking
              </span>
            )}
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          {data.canClose ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, background: "#16a34a", color: "#fff", fontSize: 13, fontWeight: 500 }}>
              <CheckCircle2 size={16} /> Ready to close
            </span>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, background: "#fef2f2", color: "#b91c1c", fontSize: 13, fontWeight: 500, border: "1px solid #fecaca" }}>
              <XCircle size={16} /> Not ready
            </span>
          )}
        </div>
      </div>

      {/* Countdown */}
      <CountdownBanner daysToEndDate={data.daysToEndDate} riskLevel={data.riskLevel} />

      {/* AI Panel */}
      <div style={{ margin: "16px 0" }}>
        <AiGuidancePanel blockedChecks={blockedForAI} />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, margin: "20px 0 14px" }}>
        {(["all", "blocked", "passed"] as const).map((tab) => {
          const count =
            tab === "all" ? data.totalChecks :
            tab === "blocked" ? data.totalChecks - data.passedChecks :
            data.passedChecks;
          return (
            <button
              key={tab}
              type="button"
              className={`g5-tab${activeTab === tab ? " active" : ""}`}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "6px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500,
                border: "1px solid #e2e8f0", cursor: "pointer",
                background: activeTab === tab ? "#0f172a" : "#fff",
                color: activeTab === tab ? "#fff" : "#374151",
              }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)} ({count})
            </button>
          );
        })}
      </div>

      {/* Auto-checks section */}
      {(activeTab === "all" || filtered.some((c) => c.category === "auto")) && (
        <>
          {activeTab === "all" && (
            <p style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#94a3b8" }}>
              Automated checks — computed live from your project data
            </p>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(activeTab === "all" ? autoChecks : filtered.filter((c) => c.category === "auto")).map((check) => (
              <CheckCard key={check.key} check={check} projectId={projectId} onToggle={handleToggle} />
            ))}
          </div>
        </>
      )}

      {/* Manual checks section */}
      {(activeTab === "all" || filtered.some((c) => c.category === "manual")) && (
        <>
          <p style={{ margin: "20px 0 10px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#94a3b8" }}>
            Manual confirmations — tick off when complete
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(activeTab === "all" ? manualChecks : filtered.filter((c) => c.category === "manual")).map((check) => (
              <CheckCard key={check.key} check={check} projectId={projectId} onToggle={handleToggle} />
            ))}
          </div>
        </>
      )}

      {filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "#94a3b8", fontSize: 14 }}>
          No items in this view.
        </div>
      )}
    </div>
  );
}