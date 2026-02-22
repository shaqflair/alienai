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
    return `£${v}`;
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

/* ── Delete confirmation mini-overlay ── */
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
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 10,
        borderRadius: 12,
        background: "rgba(10,11,18,0.92)",
        backdropFilter: "blur(6px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px 14px",
        gap: 10,
        textAlign: "center",
      }}
    >
      {/* Danger icon */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          background: "rgba(248,113,113,0.15)",
          border: "1px solid rgba(248,113,113,0.35)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
          <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
        </svg>
      </div>

      <div>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "#f1f3fc", marginBottom: 3 }}>
          Delete draft CR?
        </div>
        <div
          style={{
            fontSize: 10.5,
            color: "#7880a0",
            lineHeight: 1.5,
            maxWidth: 200,
            margin: "0 auto",
          }}
        >
          "{title}" will be permanently removed.
        </div>
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          style={{
            padding: "5px 14px",
            borderRadius: 7,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "transparent",
            color: "#9ba3c4",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          style={{
            padding: "5px 14px",
            borderRadius: 7,
            border: "1px solid rgba(248,113,113,0.4)",
            background: "rgba(248,113,113,0.15)",
            color: "#f87171",
            fontSize: 11,
            fontWeight: 700,
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Deleting…" : "Yes, delete"}
        </button>
      </div>
    </div>
  );
}

export default function ChangeCard({
  item,
  projectId,
  onMove,
  onDeleted,
  isApprover,
  compact,
  returnTo,
}: {
  item: ChangeItem;
  projectId: string;
  onMove: (idOrDbId: string, nextLane: ChangeStatus) => void;
  /** Called after a successful delete so the board can remove the card */
  onDeleted?: (id: string) => void;
  isApprover?: boolean;
  compact?: boolean;
  returnTo?: string;
}) {
  const dbId = safeStr((item as any)?.dbId).trim();
  const rawId = safeStr((item as any)?.id).trim();
  const navId = dbId || rawId;

  const displayId = crHumanId(item);
  const status = (item.status || "new") as ChangeStatus;

  const decisionStatus = safeStr((item as any)?.decision_status ?? (item as any)?.decisionStatus ?? "")
    .trim()
    .toLowerCase();
  const lockReview = status === "review";

  const idx = laneIndex(status);
  const prevLane = idx > 0 ? (CHANGE_COLUMNS[idx - 1].key as ChangeStatus) : null;
  const nextLane = idx >= 0 && idx < CHANGE_COLUMNS.length - 1 ? (CHANGE_COLUMNS[idx + 1].key as ChangeStatus) : null;

  const canArrowPrev = Boolean(prevLane && navId) && !lockReview;
  const canArrowNext = Boolean(nextLane && navId) && !lockReview && !(status === "analysis" && nextLane === "review");

  const href = useMemo(() => {
    const pid = safeStr(projectId).trim();
    if (!pid || !navId) return "#";
    const base = `/projects/${pid}/change/${encodeURIComponent(navId)}`;
    const rt = returnTo || `/projects/${pid}/change`;
    return `${base}?returnTo=${encodeURIComponent(rt)}`;
  }, [projectId, navId, returnTo]);

  const hrefWithPanel = usePanelHref(href);

  const ai = (item as any)?.aiImpact ?? {};
  const aiDays = safeNum(ai?.days, 0);
  const aiCost = safeNum(ai?.cost, 0);

  const aiRiskRaw = safeStr(ai?.risk).trim();
  const structured = normalizeRiskLevel(ai?.risk_level ?? ai?.riskLevel);
  const level: RiskLevel = structured !== "None" || !aiRiskRaw ? structured : riskLevelFromText(aiRiskRaw);

  const riskLabel = level === "None" ? "No risk" : `${level} risk`;
  const riskTitle = aiRiskRaw ? `AI risk: ${aiRiskRaw}` : "No risk described";

  const priorityRaw = safeStr((item as any)?.priority).trim();
  const priorityLabel = priorityRaw ? priorityRaw : "";

  const links = (item as any)?.links ?? {};
  const wbsCount = safeNum(links?.wbs ?? links?.WBS, 0);
  const schCount = safeNum(links?.schedule ?? links?.sch ?? links?.SCH, 0);
  const riskCount = safeNum(links?.risk ?? links?.risks ?? links?.RISK, 0);
  const aiCount = safeNum(links?.ai ?? links?.AI, 0);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  // Delete state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const canSubmitForApproval = status === "analysis" && !!projectId && !!navId;

  // Only show delete for draft lanes (intake=new, analysis) and only if we have a real DB id
  const canDelete = isDraftStatus(status) && !!navId && !!onDeleted;

  async function submitForApproval() {
    if (!canSubmitForApproval || busy) return;
    setBusy(true);
    setErr("");
    try {
      await patchJson("/api/change", { projectId, changeId: navId, action: "submit_for_approval" });
      try {
        await postJson("/api/ai/events", {
          projectId,
          artifactId: null,
          eventType: "change_submitted_for_approval",
          severity: "info",
          source: "change_card",
          payload: {
            changeId: navId,
            publicId: safeStr((item as any)?.publicId ?? (item as any)?.public_id),
            title: safeStr(item.title),
          },
        });
      } catch {}
      window.location.reload();
    } catch (e: any) {
      setErr(safeStr(e?.message) || "Submit failed");
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (!navId || deleting) return;
    setDeleting(true);
    setErr("");
    try {
      await deleteJson(`/api/change/${encodeURIComponent(navId)}`);
      setShowDeleteConfirm(false);
      if (onDeleted) onDeleted(navId);
    } catch (e: any) {
      setErr(safeStr(e?.message) || "Delete failed");
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  const lockedMsg = lockReview
    ? "Awaiting approval"
    : decisionStatus === "approved"
    ? "Approved"
    : decisionStatus === "rejected"
    ? "Rejected"
    : "";

  const requester = safeStr((item as any)?.requester).trim() || "Unknown requester";
  const risk = riskConfig(level);
  const priority = priorityLabel ? priorityConfig(priorityLabel) : null;

  return (
    <>
      <style>{`
        .kc-card {
          background: #ffffff;
          border-radius: 12px;
          border: 1px solid #e8eaf0;
          box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06);
          transition: box-shadow 0.15s ease, transform 0.15s ease, border-color 0.15s ease;
          cursor: grab;
          position: relative;
          overflow: hidden;
        }
        .kc-card:hover {
          box-shadow: 0 4px 16px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.06);
          border-color: #d0d5e8;
          transform: translateY(-1px);
        }
        .kc-card.kc-locked {
          opacity: 0.65;
          cursor: default;
        }
        .kc-card.kc-dragging {
          box-shadow: 0 16px 40px rgba(0,0,0,0.16);
          transform: rotate(1.5deg) scale(1.02);
          z-index: 999;
        }
        .kc-accent-bar {
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 3px;
          border-radius: 12px 12px 0 0;
        }
        .kc-body { padding: 14px 14px 12px; }
        .kc-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 10px;
        }
        .kc-id {
          font-family: 'DM Mono', 'Fira Code', 'Courier New', monospace;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.06em;
          color: #8b91a7;
          background: #f4f5f9;
          padding: 3px 8px;
          border-radius: 6px;
          border: 1px solid #e8eaf0;
        }
        .kc-nav {
          display: flex;
          align-items: center;
          gap: 2px;
        }
        .kc-nav-btn {
          width: 26px; height: 26px;
          display: flex; align-items: center; justify-content: center;
          border: none;
          background: transparent;
          color: #b0b7cc;
          border-radius: 6px;
          cursor: pointer;
          transition: background 0.1s, color 0.1s;
        }
        .kc-nav-btn:hover:not(:disabled) {
          background: #f0f1f7;
          color: #4f5882;
        }
        .kc-nav-btn:disabled { opacity: 0.28; cursor: not-allowed; }
        .kc-title {
          font-size: 13px;
          font-weight: 600;
          color: #1e2235;
          line-height: 1.45;
          margin-bottom: 6px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          text-decoration: none;
          transition: color 0.12s;
        }
        .kc-title:hover { color: #4f46e5; }
        .kc-requester {
          font-size: 11px;
          color: #9ba3ba;
          margin-bottom: 10px;
          display: flex;
          align-items: center;
          gap: 5px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .kc-requester-icon {
          width: 16px; height: 16px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          border-radius: 50%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 8px;
          color: white;
          font-weight: 700;
          flex-shrink: 0;
        }
        .kc-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
          margin-bottom: 10px;
        }
        .kc-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 10.5px;
          font-weight: 600;
          padding: 3px 8px;
          border-radius: 20px;
          border: 1px solid;
          letter-spacing: 0.01em;
        }
        .kc-badge-dot {
          width: 5px; height: 5px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .kc-impact {
          background: #f8f9fc;
          border: 1px solid #eceef5;
          border-radius: 8px;
          padding: 9px 11px;
          margin-bottom: 10px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .kc-impact-label {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #9ba3ba;
          margin-bottom: 6px;
        }
        .kc-impact-values {
          display: flex;
          gap: 16px;
        }
        .kc-impact-item {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 12px;
          font-weight: 600;
          color: #3a3f5c;
        }
        .kc-impact-icon { color: #b0b7cc; }
        .kc-err {
          margin-bottom: 8px;
          padding: 8px 10px;
          background: rgba(239,68,68,0.06);
          border: 1px solid rgba(239,68,68,0.18);
          border-radius: 7px;
          font-size: 11px;
          color: #dc2626;
        }
        .kc-submit-btn {
          width: 100%;
          margin-bottom: 10px;
          padding: 8px 12px;
          background: linear-gradient(135deg, #4f46e5, #6366f1);
          color: white;
          font-size: 11.5px;
          font-weight: 600;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.1s;
          letter-spacing: 0.02em;
        }
        .kc-submit-btn:hover:not(:disabled) {
          opacity: 0.9;
          transform: translateY(-1px);
        }
        .kc-submit-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .kc-kpis {
          display: flex;
          gap: 6px;
          margin-bottom: 10px;
          flex-wrap: wrap;
        }
        .kc-kpi {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          background: #f4f5f9;
          border-radius: 6px;
          font-size: 11px;
          color: #5a6080;
          border: 1px solid transparent;
          transition: border-color 0.12s, background 0.12s;
        }
        .kc-kpi:hover { background: #eceef5; border-color: #dde0ee; }
        .kc-kpi-label { font-weight: 500; color: #9ba3ba; }
        .kc-kpi-val { font-weight: 700; color: #1e2235; }
        .kc-divider {
          height: 1px;
          background: #f0f1f7;
          margin: 10px 0;
        }
        .kc-actions {
          display: flex;
          gap: 5px;
          flex-wrap: wrap;
        }
        .kc-action-link {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 5px 9px;
          font-size: 11px;
          font-weight: 500;
          color: #6b7280;
          background: #f8f9fc;
          border: 1px solid #eceef5;
          border-radius: 7px;
          text-decoration: none;
          transition: background 0.12s, color 0.12s, border-color 0.12s;
          cursor: pointer;
        }
        .kc-action-link:hover {
          background: #eceef5;
          color: #1e2235;
          border-color: #dde0ee;
        }
        .kc-action-delete {
          color: #dc2626;
          background: rgba(220,38,38,0.06);
          border-color: rgba(220,38,38,0.18);
        }
        .kc-action-delete:hover {
          background: rgba(220,38,38,0.12);
          color: #b91c1c;
          border-color: rgba(220,38,38,0.35);
        }
        .kc-locked-pill {
          margin-top: 10px;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 7px 10px;
          background: rgba(245,158,11,0.07);
          border: 1px solid rgba(245,158,11,0.2);
          border-radius: 7px;
          font-size: 11px;
          font-weight: 500;
          color: #b45309;
        }
        .kc-ai-pill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 8px;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          background: linear-gradient(135deg, rgba(99,102,241,0.1), rgba(139,92,246,0.1));
          border: 1px solid rgba(99,102,241,0.2);
          border-radius: 20px;
          color: #6366f1;
        }
      `}</style>

      <div
        className={`kc-card ${lockReview ? "kc-locked" : ""} ${isDragging ? "kc-dragging" : ""}`}
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
        {/* Accent bar */}
        <div
          className="kc-accent-bar"
          style={{
            background:
              status === "new" ? "linear-gradient(90deg,#94a3b8,#cbd5e1)" :
              status === "analysis" ? "linear-gradient(90deg,#f59e0b,#fbbf24)" :
              status === "review" ? "linear-gradient(90deg,#6366f1,#8b5cf6)" :
              status === "in_progress" ? "linear-gradient(90deg,#3b82f6,#60a5fa)" :
              status === "implemented" ? "linear-gradient(90deg,#10b981,#34d399)" :
              "linear-gradient(90deg,#64748b,#94a3b8)",
          }}
        />

        {/* Delete confirmation overlay */}
        {showDeleteConfirm && (
          <DeleteConfirm
            title={safeStr(item.title) || displayId}
            onConfirm={doDelete}
            onCancel={() => setShowDeleteConfirm(false)}
            busy={deleting}
          />
        )}

        <div className="kc-body">
          {/* Header */}
          <div className="kc-header">
            <span className="kc-id">{displayId}</span>
            <div className="kc-nav">
              <button
                type="button"
                className="kc-nav-btn"
                disabled={!canArrowPrev}
                title={!canArrowPrev ? (lockReview ? "Review locked" : "Locked") : `Move to ${prevLane}`}
                onClick={() => prevLane && navId && canArrowPrev && onMove(navId, prevLane)}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                type="button"
                className="kc-nav-btn"
                disabled={!canArrowNext}
                title={
                  status === "analysis" && nextLane === "review"
                    ? "Use Submit for approval"
                    : !canArrowNext ? (lockReview ? "Review locked" : "Locked") : `Move to ${nextLane}`
                }
                onClick={() => nextLane && navId && canArrowNext && onMove(navId, nextLane)}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>

          {/* Title */}
          <Link href={href} className="kc-title" title={safeStr(item.title)}>
            {safeStr(item.title) || "Untitled change"}
          </Link>

          {!compact && (
            <>
              {/* Requester */}
              <div className="kc-requester">
                <span className="kc-requester-icon">{requester.charAt(0).toUpperCase()}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{requester}</span>
              </div>

              {/* Badges */}
              <div className="kc-badges">
                {priorityLabel && priority && (
                  <span className="kc-badge" style={{ color: priority.color, background: priority.bg, borderColor: priority.border }}>
                    <span className="kc-badge-dot" style={{ background: priority.color }} />
                    {priorityLabel}
                  </span>
                )}
                <span className="kc-badge" title={riskTitle} style={{ color: risk.text, background: risk.bg, borderColor: risk.border }}>
                  <span className="kc-badge-dot" style={{ background: risk.dot }} />
                  {riskLabel}
                </span>
                {(aiDays > 0 || aiCost > 0) && (
                  <span className="kc-ai-pill">
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                    AI
                  </span>
                )}
              </div>

              {/* AI Impact block */}
              <div className="kc-impact">
                <div>
                  <div className="kc-impact-label">AI Impact</div>
                  <div className="kc-impact-values">
                    <div className="kc-impact-item">
                      <svg className="kc-impact-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                      </svg>
                      {aiDays ? `+${aiDays}d` : "—"}
                    </div>
                    <div className="kc-impact-item">
                      <svg className="kc-impact-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                      </svg>
                      {aiCost ? moneyGBP(aiCost) : "—"}
                    </div>
                  </div>
                </div>
                <div style={{
                  width: 36, height: 36, borderRadius: "50%",
                  background: risk.bg, border: `1.5px solid ${risk.border}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={risk.dot} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                </div>
              </div>

              {/* Error */}
              {err && <div className="kc-err">{err}</div>}

              {/* Submit button */}
              {canSubmitForApproval && (
                <button type="button" onClick={submitForApproval} disabled={busy} className="kc-submit-btn">
                  {busy ? "Submitting…" : "Submit for approval →"}
                </button>
              )}

              {/* KPIs */}
              <div className="kc-kpis">
                <MiniKpi label="WBS" value={wbsCount} />
                <MiniKpi label="Sch" value={schCount} />
                <MiniKpi label="Risk" value={riskCount} />
                <MiniKpi label="AI" value={aiCount} />
              </div>

              <div className="kc-divider" />

              {/* Action links */}
              <div className="kc-actions">
                <Link href={hrefWithPanel("comment")} className="kc-action-link">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                  </svg>
                  Comment
                </Link>
                <Link href={hrefWithPanel("attach")} className="kc-action-link">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
                  </svg>
                  Attach
                </Link>
                <Link href={hrefWithPanel("timeline")} className="kc-action-link">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                  Timeline
                </Link>
                <Link href={hrefWithPanel("ai")} className="kc-action-link" style={{ color: "#6366f1" }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                  </svg>
                  AI
                </Link>

                {/* Delete — only for draft lanes */}
                {canDelete && (
                  <button
                    type="button"
                    className="kc-action-link kc-action-delete"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowDeleteConfirm(true);
                    }}
                    disabled={busy || deleting}
                    title="Delete this draft change request"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                      <path d="M10 11v6M14 11v6"/>
                      <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                    </svg>
                    Delete
                  </button>
                )}
              </div>

              {/* Locked message */}
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