"use client";

import React, { useEffect, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  X,
  Zap,
  ChevronRight,
} from "lucide-react";
import {
  getOrGenerateBriefing,
  regenerateBriefing,
} from "@/app/projects/[id]/briefing-actions";
import type { BriefingSection, ProjectBriefing } from "@/app/projects/[id]/briefing-actions";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  projectId:        string;
  initialBriefing?: ProjectBriefing | null;
  canRegenerate?:   boolean;
}

// ── Persist open/closed state per project in localStorage ─────────────────────

function getPanelKey(projectId: string) {
  return `briefing_panel_open_${projectId}`;
}
function getPanelOpen(projectId: string): boolean {
  try { return localStorage.getItem(getPanelKey(projectId)) !== "false"; }
  catch { return true; }
}
function setPanelOpen(projectId: string, open: boolean) {
  try { localStorage.setItem(getPanelKey(projectId), String(open)); }
  catch {}
}

function getDismissKey(projectId: string) {
  const today = new Date().toISOString().split("T")[0];
  return `briefing_dismissed_${projectId}_${today}`;
}
function isDismissed(projectId: string): boolean {
  try { return localStorage.getItem(getDismissKey(projectId)) === "1"; }
  catch { return false; }
}
function setDismissed(projectId: string) {
  try { localStorage.setItem(getDismissKey(projectId), "1"); }
  catch {}
}

// ── Priority badge ─────────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: "high" | "medium" }) {
  return priority === "high" ? (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
      padding: "2px 6px", borderRadius: 4,
      background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#dc2626",
      textTransform: "uppercase",
    }}>
      <Zap style={{ width: 9, height: 9 }} />
      High
    </span>
  ) : (
    <span style={{
      display: "inline-flex", alignItems: "center",
      fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
      padding: "2px 6px", borderRadius: 4,
      background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", color: "#b45309",
      textTransform: "uppercase",
    }}>
      Med
    </span>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div style={{ padding: "20px 0", display: "flex", flexDirection: "column", gap: 12 }}>
      {[1,2,3].map(i => (
        <div key={i} style={{ background: "#f0f0f0", borderRadius: 8, height: 14, width: `${60 + i * 10}%`, animation: "pulse 1.5s ease-in-out infinite" }} />
      ))}
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ProjectDailyBriefing({
  projectId,
  initialBriefing,
  canRegenerate = false,
}: Props) {
  const [briefing, setBriefing]       = useState<ProjectBriefing | null>(initialBriefing ?? null);
  const [loading, setLoading]         = useState(!initialBriefing);
  const [error, setError]             = useState<string | null>(null);
  const [open, setOpen]               = useState(false);   // start closed; read from localStorage on mount
  const [dismissed, setDismissedState]= useState(false);
  const [isPending, startTransition]  = useTransition();
  const hasFetched = useRef(false);
  const panelRef   = useRef<HTMLDivElement>(null);

  // ── Mount: read persisted state ─────────────────────────────────────────────
  useEffect(() => {
    if (isDismissed(projectId)) { setDismissedState(true); return; }
    setOpen(getPanelOpen(projectId));
  }, [projectId]);

  // ── Close on Escape ─────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) handleClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // ── Click outside to close ──────────────────────────────────────────────────
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (open && panelRef.current && !panelRef.current.contains(e.target as Node)) {
        const toggle = document.getElementById("briefing-toggle-btn");
        if (toggle && toggle.contains(e.target as Node)) return;
        handleClose();
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // ── Fetch briefing on open ──────────────────────────────────────────────────
  useEffect(() => {
    if (!open || hasFetched.current) return;
    hasFetched.current = true;

    if (initialBriefing && !initialBriefing.is_stale) {
      setLoading(false);
      return;
    }

    setLoading(true);
    startTransition(() => {
      void (async () => {
        try {
          const { briefing: b, error: e } = await getOrGenerateBriefing(projectId);
          if (e) setError(e);
          else setBriefing(b);
        } catch (err: any) {
          setError(err?.message ?? "Failed to load briefing.");
        } finally {
          setLoading(false);
        }
      })();
    });
  }, [open, projectId, initialBriefing]);

  function handleOpen() {
    setOpen(true);
    setPanelOpen(projectId, true);
  }
  function handleClose() {
    setOpen(false);
    setPanelOpen(projectId, false);
  }
  function handleDismiss() {
    setDismissed(projectId);
    setDismissedState(true);
    setOpen(false);
  }
  function handleRegenerate() {
    setLoading(true);
    setError(null);
    startTransition(() => {
      void (async () => {
        try {
          const { briefing: b, error: e } = await regenerateBriefing(projectId);
          if (e) setError(e);
          else setBriefing(b);
        } catch (err: any) {
          setError(err?.message ?? "Regeneration failed.");
        } finally {
          setLoading(false);
        }
      })();
    });
  }

  if (dismissed) return null;

  const content      = briefing?.content as BriefingSection | undefined;
  const generatedAt  = briefing?.generated_at
    ? new Date(briefing.generated_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <>
      <style>{`
        .briefing-panel {
          position: fixed;
          top: 0;
          right: 0;
          height: 100vh;
          width: 420px;
          max-width: 92vw;
          background: #ffffff;
          border-left: 1px solid #e8ecf0;
          box-shadow: -4px 0 32px rgba(0,0,0,0.1);
          z-index: 400;
          display: flex;
          flex-direction: column;
          transform: translateX(100%);
          transition: transform 0.28s cubic-bezier(0.16,1,0.3,1);
          overflow: hidden;
          font-family: 'Geist', -apple-system, sans-serif;
        }
        .briefing-panel.open {
          transform: translateX(0);
        }
        .briefing-toggle {
          position: fixed;
          right: 0;
          top: 50%;
          transform: translateY(-50%);
          z-index: 399;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 10px 8px 10px 10px;
          background: #ffffff;
          border: 1px solid #e8ecf0;
          border-right: none;
          border-radius: 10px 0 0 10px;
          cursor: pointer;
          box-shadow: -2px 0 12px rgba(0,0,0,0.08);
          transition: background 0.15s, box-shadow 0.15s;
          writing-mode: vertical-rl;
          font-family: 'Geist', -apple-system, sans-serif;
        }
        .briefing-toggle:hover {
          background: #f6f8fa;
          box-shadow: -2px 0 16px rgba(0,0,0,0.12);
        }
        .briefing-toggle.panel-open {
          display: none;
        }
        .briefing-panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 18px;
          border-bottom: 1px solid #e8ecf0;
          background: linear-gradient(135deg, #eef2ff 0%, #f8faff 100%);
          flex-shrink: 0;
        }
        .briefing-panel-body {
          flex: 1;
          overflow-y: auto;
          padding: 16px 18px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .briefing-panel-footer {
          padding: 10px 18px;
          border-top: 1px solid #e8ecf0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-shrink: 0;
          background: #fafafa;
        }
        .briefing-section {
          border-radius: 10px;
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .briefing-section-title {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .briefing-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 12px;
          line-height: 1.5;
        }
        .briefing-item-row {
          display: flex;
          gap: 6px;
          align-items: flex-start;
        }
        .briefing-dismiss-btn {
          font-size: 11px;
          color: #8b949e;
          background: none;
          border: none;
          cursor: pointer;
          padding: 2px 6px;
          border-radius: 4px;
          font-family: inherit;
          transition: color 0.15s, background 0.15s;
        }
        .briefing-dismiss-btn:hover {
          color: #57606a;
          background: #f0f0f0;
        }
        @media (max-width: 480px) {
          .briefing-panel { width: 100vw; max-width: 100vw; }
        }
      `}</style>

      {/* ── Toggle tab (visible when panel is closed) ── */}
      <button
        id="briefing-toggle-btn"
        className={`briefing-toggle${open ? " panel-open" : ""}`}
        onClick={handleOpen}
        title="Open AI Daily Briefing"
        aria-label="Open AI Daily Briefing"
      >
        <Sparkles style={{ width: 14, height: 14, color: "#6366f1", flexShrink: 0, transform: "rotate(90deg)", writingMode: "horizontal-tb" }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: "#374151", letterSpacing: "0.05em" }}>
          AI Briefing
        </span>
        <ChevronRight style={{ width: 12, height: 12, color: "#9ca3af", flexShrink: 0, transform: "rotate(90deg)", writingMode: "horizontal-tb" }} />
      </button>

      {/* ── Side panel ── */}
      <div
        ref={panelRef}
        className={`briefing-panel${open ? " open" : ""}`}
        aria-label="AI Daily Briefing panel"
      >
        {/* Header */}
        <div className="briefing-panel-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: "#e0e7ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Sparkles style={{ width: 14, height: 14, color: "#6366f1" }} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0d1117" }}>AI Daily Briefing</div>
              {generatedAt && !loading && (
                <div style={{ fontSize: 11, color: "#8b949e" }}>Generated {generatedAt}</div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {canRegenerate && !loading && (
              <button
                onClick={handleRegenerate}
                disabled={isPending || loading}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "4px 8px", borderRadius: 6, border: "1px solid #e8ecf0",
                  background: "#ffffff", cursor: "pointer", fontSize: 11, fontWeight: 600,
                  color: "#57606a", fontFamily: "inherit",
                  opacity: (isPending || loading) ? 0.4 : 1,
                  transition: "all 0.15s",
                }}
                title="Regenerate briefing"
              >
                <RefreshCw style={{ width: 11, height: 11, animation: (isPending || loading) ? "spin 1s linear infinite" : "none" }} />
                Refresh
              </button>
            )}
            <button
              onClick={handleClose}
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 28, height: 28, borderRadius: 6,
                border: "1px solid #e8ecf0", background: "#ffffff",
                cursor: "pointer", color: "#8b949e", transition: "all 0.15s",
              }}
              aria-label="Close panel"
            >
              <X style={{ width: 14, height: 14 }} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="briefing-panel-body">

          {loading && <Skeleton />}

          {!loading && error && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 8,
              padding: "12px 14px", borderRadius: 10,
              background: "#fef2f2", border: "1px solid #fecaca",
              fontSize: 12, color: "#dc2626",
            }}>
              <AlertTriangle style={{ width: 14, height: 14, flexShrink: 0, marginTop: 1 }} />
              <div>
                <span style={{ fontWeight: 600 }}>Briefing unavailable: </span>{error}
                {canRegenerate && (
                  <button
                    onClick={handleRegenerate}
                    style={{ marginLeft: 6, background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontWeight: 600, fontSize: 12, fontFamily: "inherit", textDecoration: "underline" }}
                  >
                    Try again
                  </button>
                )}
              </div>
            </div>
          )}

          {!loading && !error && content && (
            <>
              {/* Summary */}
              {content.summary && (
                <p style={{
                  fontSize: 13, color: "#57606a", lineHeight: 1.6, margin: 0,
                  paddingLeft: 10, borderLeft: "2px solid #6366f1",
                  fontStyle: "italic",
                }}>
                  {content.summary}
                </p>
              )}

              {/* On track */}
              {content.on_track?.length > 0 && (
                <div className="briefing-section" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
                  <div className="briefing-section-title" style={{ color: "#15803d" }}>
                    <CheckCircle2 style={{ width: 12, height: 12 }} />
                    On track
                  </div>
                  {content.on_track.map((item, i) => (
                    <div key={i} className="briefing-item">
                      <div className="briefing-item-row">
                        <span style={{ color: "#86efac", marginTop: 1, flexShrink: 0 }}>✓</span>
                        <span style={{ color: "#166534" }}>{item}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Needs attention */}
              {content.needs_attention?.length > 0 && (
                <div className="briefing-section" style={{ background: "#fffbeb", border: "1px solid #fde68a" }}>
                  <div className="briefing-section-title" style={{ color: "#b45309" }}>
                    <AlertTriangle style={{ width: 12, height: 12 }} />
                    Needs attention
                  </div>
                  {content.needs_attention.map((item, i) => (
                    <div key={i} className="briefing-item">
                      <div className="briefing-item-row">
                        <span style={{ color: "#fbbf24", flexShrink: 0, marginTop: 1 }}>!</span>
                        <span style={{ color: "#78350f", flex: 1 }}>{item.item}</span>
                      </div>
                      <div style={{ paddingLeft: 14 }}>
                        <PriorityBadge priority={item.priority} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Biggest risk */}
              {content.biggest_risk && (
                <div className="briefing-section" style={{ background: "#fff5f5", border: "1px solid #fecaca" }}>
                  <div className="briefing-section-title" style={{ color: "#b91c1c" }}>
                    <AlertTriangle style={{ width: 12, height: 12 }} />
                    Biggest risk
                  </div>
                  <p style={{ fontSize: 12, color: "#7f1d1d", lineHeight: 1.5, margin: 0 }}>
                    {content.biggest_risk}
                  </p>
                </div>
              )}

              {/* Actions for today */}
              {content.recommended_actions?.length > 0 && (
                <div className="briefing-section" style={{ background: "#f8faff", border: "1px solid #c7d2fe" }}>
                  <div className="briefing-section-title" style={{ color: "#4338ca" }}>
                    Actions for today
                  </div>
                  <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
                    {content.recommended_actions.map((action, i) => (
                      <li key={i} style={{ fontSize: 12, color: "#1e1b4b", lineHeight: 1.5 }}>
                        {action}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Stale notice */}
              {briefing?.is_stale && (
                <p style={{ fontSize: 11, color: "#8b949e", textAlign: "right", margin: 0 }}>
                  From a previous session.{" "}
                  {canRegenerate && (
                    <button onClick={handleRegenerate} style={{ background: "none", border: "none", cursor: "pointer", color: "#6366f1", fontSize: 11, fontFamily: "inherit", textDecoration: "underline" }}>
                      Regenerate now
                    </button>
                  )}
                </p>
              )}
            </>
          )}

          {!loading && !error && !content && (
            <div style={{ fontSize: 13, color: "#8b949e", paddingTop: 8 }}>
              No briefing available yet.{" "}
              {canRegenerate && (
                <button onClick={handleRegenerate} style={{ background: "none", border: "none", cursor: "pointer", color: "#6366f1", fontSize: 13, fontFamily: "inherit", textDecoration: "underline" }}>
                  Generate now
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="briefing-panel-footer">
          <span style={{ fontSize: 11, color: "#8b949e" }}>
            Refreshes daily · dismiss to hide for today
          </span>
          <button className="briefing-dismiss-btn" onClick={handleDismiss}>
            Dismiss for today
          </button>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}