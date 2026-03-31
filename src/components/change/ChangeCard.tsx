// src/components/change/ChangeCard.tsx
"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import type { ChangeItem, ChangeStatus } from "@/lib/change/types";
import { CHANGE_COLUMNS } from "@/lib/change/columns";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}
function safeNum(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}
function moneyGBP(n: number) {
  const v = safeNum(n, 0);
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(v);
  } catch {
    return `Â£${v}`;
  }
}

function laneIndex(lane: ChangeStatus) {
  return CHANGE_COLUMNS.findIndex((c) => c.key === lane);
}

type RiskLevel = "None" | "Low" | "Medium" | "High";

function normalizeRiskLevel(x: unknown): RiskLevel {
  const t = safeStr(x).trim().toLowerCase();
  if (!t) return "None";
  if (t === "none" || t === "no risk") return "None";
  if (t === "low") return "Low";
  if (t === "medium" || t === "moderate") return "Medium";
  if (t === "high" || t === "critical") return "High";
  return "None";
}

function riskLevelFromText(risk: unknown): RiskLevel {
  const t0 = safeStr(risk).trim();
  const t = t0.toLowerCase();
  if (!t) return "None";
  if (/\bno risk\b|\bnone identified\b|\bnone\b|\bn\/a\b|\bna\b/.test(t)) return "None";
  if (/\bcritical\b|\bsevere\b/.test(t)) return "High";
  if (/\bhigh\b/.test(t)) return "High";
  if (/\bmedium\b|\bmoderate\b|\bamber\b/.test(t)) return "Medium";
  if (/\blow\b|\bminor\b|\bnegligible\b|\bgreen\b/.test(t)) return "Low";
  const highWords =
    /\bhalt\b|\bhalted\b|\bhalting\b|\bstopp?age\b|\bshutdown\b|\boutage\b|\bservice down\b|\bdown\b|\bbreach\b|\bsecurity\b|\bdata loss\b|\bprivacy\b|\bregulatory\b|\bfine\b|\bpenalt(y|ies)\b|\bmajor\b|\bsev[ -]?(1|2)\b|\bcritical path\b|\brollback fails?\b|\bcatastrophic\b/;
  const medWords =
    /\bdelay\b|\bslip(page)?\b|\bdegrad(e|ation)\b|\bperformance\b|\bcapacity\b|\bvendor\b|\bdependency\b|\bblocked\b|\brework\b|\btesting\b|\bintegration\b|\bapproval\b|\bcab\b|\bchange window\b|\breschedule\b/;
  const lowWords = /\bcosmetic\b|\bdocs?\b|\bcopy\b|\blabel\b|\bminor\b|\blimited\b|\blow impact\b/;
  if (highWords.test(t)) return "High";
  if (medWords.test(t)) return "Medium";
  if (lowWords.test(t)) return "Low";
  return "Medium";
}

function riskConfig(level: RiskLevel) {
  if (level === "High") return { dot: "#ef4444", bg: "rgba(239,68,68,0.08)", text: "#dc2626", border: "rgba(239,68,68,0.2)" };
  if (level === "Medium") return { dot: "#f59e0b", bg: "rgba(245,158,11,0.08)", text: "#d97706", border: "rgba(245,158,11,0.2)" };
  if (level === "Low") return { dot: "#3b82f6", bg: "rgba(59,130,246,0.08)", text: "#2563eb", border: "rgba(59,130,246,0.2)" };
  return { dot: "#94a3b8", bg: "rgba(148,163,184,0.08)", text: "#64748b", border: "rgba(148,163,184,0.2)" };
}

function priorityConfig(p: string) {
  const v = p.toLowerCase();
  if (v === "critical") return { color: "#dc2626", bg: "rgba(220,38,38,0.08)", border: "rgba(220,38,38,0.2)" };
  if (v === "high") return { color: "#ea580c", bg: "rgba(234,88,12,0.08)", border: "rgba(234,88,12,0.2)" };
  if (v === "low") return { color: "#64748b", bg: "rgba(100,116,139,0.08)", border: "rgba(100,116,139,0.2)" };
  return { color: "#6366f1", bg: "rgba(99,102,241,0.08)", border: "rgba(99,102,241,0.2)" };
}

function crHumanId(item: any) {
  const seq = Number((item as any)?.seq);
  if (Number.isFinite(seq) && seq > 0) return `CR${seq}`;
  const display = safeStr((item as any)?.crDisplayId).trim();
  if (display) return display.toUpperCase();
  const pub = safeStr((item as any)?.publicId ?? (item as any)?.public_id ?? "").trim();
  if (pub) {
    const m = pub.match(/cr[-_\s]*(\d+)/i);
    if (m?.[1]) return `CR${m[1]}`;
    if (/^cr\d+$/i.test(pub)) return pub.toUpperCase();
    return pub.toUpperCase();
  }
  const id = safeStr((item as any)?.dbId ?? item?.id).trim();
  if (!id) return "CR";
  return id.length > 10 ? `CR-${id.slice(0, 6).toUpperCase()}` : id.toUpperCase();
}

/** Only intake (new) and analysis are deletable drafts */
function isDraftStatus(s: ChangeStatus) {
  return s === "new" || s === "analysis";
}

async function patchJson(url: string, body: any) {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json as any)?.ok === false) throw new Error(safeStr((json as any)?.error) || `HTTP ${res.status}`);
  return json;
}

async function postJson(url: string, body: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(safeStr((json as any)?.error) || `HTTP ${res.status}`);
  return json;
}

async function deleteJson(url: string) {
  const res = await fetch(url, { method: "DELETE" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json as any)?.ok === false) throw new Error(safeStr((json as any)?.error) || `HTTP ${res.status}`);
  return json;
}

type Panel = "attach" | "comment" | "timeline" | "ai";

function usePanelHref(baseHref: string) {
  return (panel: Panel) => {
    if (!baseHref || baseHref === "#") return "#";
    const u = new URL(baseHref, "http://x");
    u.searchParams.set("panel", panel);
    return u.pathname + (u.search ? u.search : "");
  };
}

/* â”€â”€ Delete confirmation mini-overlay â”€â”€ */
function DeleteConfirm({
  title,
  onConfirm,
  onCancel,
  busy,
}: {
  title: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <>
      <style>{\
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Syne:wght@600;700;800&display=swap');

        .kc-card {
          background: #ffffff;
          border-radius: 14px;
          border: 1px solid #e4e7f0;
          box-shadow: 0 1px 4px rgba(15,20,50,0.04), 0 2px 8px rgba(15,20,50,0.03);
          transition: box-shadow 0.18s ease, transform 0.18s ease, border-color 0.18s ease;
          cursor: grab;
          position: relative;
          overflow: hidden;
          font-family: 'Syne', system-ui, sans-serif;
        }
        .kc-card:hover {
          box-shadow: 0 4px 20px rgba(15,20,50,0.09), 0 2px 8px rgba(15,20,50,0.05);
          border-color: #c8cde0;
          transform: translateY(-2px);
        }
        .kc-card.kc-locked { opacity: 0.72; cursor: default; }
        .kc-card.kc-dragging { box-shadow: 0 20px 50px rgba(0,0,0,0.18); transform: rotate(1.2deg) scale(1.02); z-index: 999; }
        .kc-rail { position: absolute; top: 0; left: 0; bottom: 0; width: 3px; border-radius: 14px 0 0 14px; }
        .kc-body { padding: 14px 14px 12px 18px; }
        .kc-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 9px; }
        .kc-id { font-family: 'IBM Plex Mono', monospace; font-size: 9.5px; font-weight: 600; letter-spacing: 0.08em; color: #7c85a2; background: #f3f4f8; padding: 3px 7px; border-radius: 5px; border: 1px solid #e4e7f0; }
        .kc-nav { display: flex; align-items: center; gap: 2px; }
        .kc-nav-btn { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border: none; background: transparent; color: #b8c0d4; border-radius: 6px; cursor: pointer; transition: background 0.1s, color 0.1s; }
        .kc-nav-btn:hover:not(:disabled) { background: #f0f1f8; color: #4a5080; }
        .kc-nav-btn:disabled { opacity: 0.25; cursor: not-allowed; }
        .kc-title { font-size: 13px; font-weight: 700; color: #111827; line-height: 1.4; margin-bottom: 8px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-decoration: none; letter-spacing: -0.01em; transition: color 0.12s; }
        .kc-title:hover { color: #4f46e5; }
        .kc-requester { font-size: 11px; color: #9ba3ba; margin-bottom: 11px; display: flex; align-items: center; gap: 6px; overflow: hidden; }
        .kc-requester-icon { width: 18px; height: 18px; background: linear-gradient(135deg, #6366f1, #8b5cf6); border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 8px; color: white; font-weight: 700; flex-shrink: 0; font-family: 'IBM Plex Mono', monospace; }
        .kc-signals { display: flex; gap: 6px; margin-bottom: 11px; flex-wrap: wrap; }
        .kc-signal { display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; font-weight: 600; padding: 4px 9px 4px 7px; border-radius: 7px; border: 1px solid; letter-spacing: 0.01em; }
        .kc-signal-label { font-size: 9px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; opacity: 0.55; margin-right: 1px; font-family: 'IBM Plex Mono', monospace; }
        .kc-impact { background: #f8f9fc; border: 1px solid #eceef5; border-radius: 9px; padding: 9px 12px; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .kc-impact-label { font-size: 9px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #9ba3ba; margin-bottom: 5px; font-family: 'IBM Plex Mono', monospace; }
        .kc-impact-values { display: flex; align-items: center; gap: 14px; }
        .kc-impact-item { display: flex; align-items: center; gap: 4px; font-size: 12.5px; font-weight: 700; color: #1e2235; font-family: 'IBM Plex Mono', monospace; }
        .kc-impact-icon { color: #9ba3ba; flex-shrink: 0; }
        .kc-risk-orb { width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .kc-kpis { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
        .kc-kpi { display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 36px; padding: 4px 7px; background: #f8f9fc; border: 1px solid #eceef5; border-radius: 7px; gap: 1px; }
        .kc-kpi-label { font-size: 8.5px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #9ba3ba; font-family: 'IBM Plex Mono', monospace; }
        .kc-kpi-val { font-size: 13px; font-weight: 800; color: #1e2235; line-height: 1; }
        .kc-divider { height: 1px; background: #f0f1f7; margin: 9px 0; }
        .kc-actions { display: flex; flex-wrap: wrap; gap: 5px; }
        .kc-action-link { display: inline-flex; align-items: center; gap: 4px; padding: 5px 9px; font-size: 11px; font-weight: 600; color: #6b7280; background: #f8f9fc; border: 1px solid #eceef5; border-radius: 7px; text-decoration: none; transition: background 0.12s, color 0.12s, border-color 0.12s; cursor: pointer; font-family: 'Syne', system-ui, sans-serif; }
        .kc-action-link:hover { background: #eceef5; color: #1e2235; border-color: #dde0ee; }
        .kc-action-delete { color: #dc2626; background: rgba(220,38,38,0.05); border-color: rgba(220,38,38,0.16); }
        .kc-action-delete:hover { background: rgba(220,38,38,0.1); color: #b91c1c; border-color: rgba(220,38,38,0.3); }
        .kc-action-ai { color: #6366f1; background: rgba(99,102,241,0.06); border-color: rgba(99,102,241,0.18); }
        .kc-action-ai:hover { background: rgba(99,102,241,0.12); border-color: rgba(99,102,241,0.3); }
        .kc-submit-btn { width: 100%; margin-top: 8px; padding: 8px 12px; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; border: none; border-radius: 9px; font-size: 11.5px; font-weight: 700; cursor: pointer; transition: opacity 0.15s, transform 0.15s; letter-spacing: 0.01em; font-family: 'Syne', system-ui, sans-serif; box-shadow: 0 2px 10px rgba(99,102,241,0.28); }
        .kc-submit-btn:hover:not(:disabled) { opacity: 0.92; transform: translateY(-1px); }
        .kc-submit-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .kc-locked-pill { margin-top: 10px; display: flex; align-items: center; gap: 6px; padding: 7px 10px; background: rgba(245,158,11,0.07); border: 1px solid rgba(245,158,11,0.2); border-radius: 8px; font-size: 11px; font-weight: 600; color: #b45309; }
        .kc-err { margin-top: 7px; padding: 6px 10px; background: rgba(239,68,68,0.07); border: 1px solid rgba(239,68,68,0.18); border-radius: 7px; font-size: 11px; color: #dc2626; }
      \}</style>

      <div
        className={\kc-card \ \\}
        draggable={!lockReview && !showDeleteConfirm}
        onDragStart={(e) => {
          if (lockReview || showDeleteConfirm) return;
          setIsDragging(true);
          e.dataTransfer.setData("text/change-id", navId);
          e.dataTransfer.setData("text/change-from", status);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => setIsDragging(false)}
      >
        <div
          className="kc-rail"
          style={{
            background:
              status === "new"         ? "linear-gradient(180deg,#94a3b8,#cbd5e1)" :
              status === "analysis"    ? "linear-gradient(180deg,#f59e0b,#fbbf24)" :
              status === "review"      ? "linear-gradient(180deg,#6366f1,#8b5cf6)" :
              status === "in_progress" ? "linear-gradient(180deg,#3b82f6,#60a5fa)" :
              status === "implemented" ? "linear-gradient(180deg,#10b981,#34d399)" :
              "linear-gradient(180deg,#64748b,#94a3b8)",
          }}
        />

        {showDeleteConfirm && (
          <DeleteConfirm
            title={safeStr(item.title) || displayId}
            onConfirm={doDelete}
            onCancel={() => setShowDeleteConfirm(false)}
            busy={deleting}
          />
        )}

        <div className="kc-body">
          <div className="kc-header">
            <span className="kc-id">{displayId}</span>
            <div className="kc-nav">
              <button type="button" className="kc-nav-btn" disabled={!canArrowPrev}
                title={!canArrowPrev ? (lockReview ? "Review locked" : "Locked") : \Move to \\}
                onClick={() => prevLane && navId && canArrowPrev && onMove(navId, prevLane)}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 19l-7-7 7-7"/></svg>
              </button>
              <button type="button" className="kc-nav-btn" disabled={!canArrowNext}
                title={status === "analysis" && nextLane === "review" ? "Use Submit for approval" : !canArrowNext ? (lockReview ? "Review locked" : "Locked") : \Move to \\}
                onClick={() => nextLane && navId && canArrowNext && onMove(navId, nextLane)}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7"/></svg>
              </button>
            </div>
          </div>

          <Link href={href} className="kc-title" title={safeStr(item.title)}>
            {safeStr(item.title) || "Untitled change"}
          </Link>

          {!compact && (
            <>
              <div className="kc-requester">
                <span className="kc-requester-icon">{requester.charAt(0).toUpperCase()}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{requester}</span>
              </div>

              <div className="kc-signals">
                {priorityLabel && priority && (
                  <span className="kc-signal" style={{ color: priority.color, background: priority.bg, borderColor: priority.border }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
                    </svg>
                    <span className="kc-signal-label">Priority</span>
                    {priorityLabel}
                  </span>
                )}
                <span className="kc-signal" title={riskTitle} style={{ color: risk.text, background: risk.bg, borderColor: risk.border }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  </svg>
                  <span className="kc-signal-label">Risk</span>
                  {riskLabel}
                </span>
              </div>

              <div className="kc-impact">
                <div>
                  <div className="kc-impact-label">AI Impact</div>
                  <div className="kc-impact-values">
                    <div className="kc-impact-item">
                      <svg className="kc-impact-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                      </svg>
                      {aiDays ? \+\d\ : "—"}
                    </div>
                    <div className="kc-impact-item">
                      <svg className="kc-impact-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                      </svg>
                      {aiCost ? moneyGBP(aiCost) : "—"}
                    </div>
                  </div>
                </div>
                <div className="kc-risk-orb" style={{ background: risk.bg, border: \1.5px solid \\ }} title={riskTitle}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={risk.dot} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  </svg>
                </div>
              </div>

              {err && <div className="kc-err">{err}</div>}

              {canSubmitForApproval && (
                <button type="button" onClick={submitForApproval} disabled={busy} className="kc-submit-btn">
                  {busy ? "Submitting…" : "Submit for approval →"}
                </button>
              )}

              <div className="kc-kpis">
                <MiniKpi label="WBS" value={wbsCount} />
                <MiniKpi label="Sch" value={schCount} />
                <MiniKpi label="Risk" value={riskCount} />
                <MiniKpi label="AI" value={aiCount} />
              </div>

              <div className="kc-divider" />

              <div className="kc-actions">
                <Link href={hrefWithPanel("timeline")} className="kc-action-link">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                  Timeline
                </Link>
                <Link href={hrefWithPanel("attach")} className="kc-action-link">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
                  </svg>
                  Attach
                </Link>
                <Link href={hrefWithPanel("ai")} className="kc-action-link kc-action-ai">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M13 10V3L4 14h7v7l9-11h-7z"/>
                  </svg>
                  AI Review
                </Link>
                {canDelete && (
                  <button type="button" className="kc-action-link kc-action-delete"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowDeleteConfirm(true); }}
                    disabled={busy || deleting} title="Delete this draft change request">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                      <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                    </svg>
                    Delete
                  </button>
                )}
              </div>

              {lockedMsg && (
                <div className="kc-locked-pill">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
                  </svg>
                  {lockedMsg}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function MiniKpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="kc-kpi">
      <span className="kc-kpi-label">{label}</span>
      <span className="kc-kpi-val">{value}</span>
    </div>
  );
}