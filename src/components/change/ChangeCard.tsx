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
    /\bhalt\b|\bhalted\b|\bhalting\b|\bstopp?age\b|\bshutdown\b|\bproject will be halted\b|\boutage\b|\bservice down\b|\bdown\b|\bbreach\b|\bsecurity\b|\bdata loss\b|\bprivacy\b|\bregulatory\b|\bfine\b|\bpenalt(y|ies)\b|\bmajor\b|\bsev[ -]?(1|2)\b|\bcritical path\b|\brollback fails?\b|\bcatastrophic\b/;

  const medWords =
    /\bdelay\b|\bslip(page)?\b|\bdegrad(e|ation)\b|\bperformance\b|\bcapacity\b|\bvendor\b|\bdependency\b|\bblocked\b|\brework\b|\btesting\b|\bintegration\b|\bapproval\b|\bcab\b|\bchange window\b|\breschedule\b/;

  const lowWords = /\bcosmetic\b|\bdocs?\b|\bcopy\b|\blabel\b|\bminor\b|\blimited\b|\blow impact\b/;

  if (highWords.test(t)) return "High";
  if (medWords.test(t)) return "Medium";
  if (lowWords.test(t)) return "Low";

  return "Medium";
}

function riskBadgeClass(level: RiskLevel): string {
  if (level === "High") return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
  if (level === "Medium") return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
  if (level === "Low") return "bg-blue-50 text-blue-700 ring-1 ring-blue-200";
  return "bg-gray-50 text-gray-600 ring-1 ring-gray-200";
}

function priorityBadgeClass(p: string): string {
  const v = p.toLowerCase();
  if (v === "critical") return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
  if (v === "high") return "bg-orange-50 text-orange-700 ring-1 ring-orange-200";
  if (v === "low") return "bg-slate-50 text-slate-600 ring-1 ring-slate-200";
  return "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200";
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

type Panel = "attach" | "comment" | "timeline" | "ai";

function usePanelHref(baseHref: string) {
  return (panel: Panel) => {
    if (!baseHref || baseHref === "#") return "#";
    const u = new URL(baseHref, "http://x");
    u.searchParams.set("panel", panel);
    return u.pathname + (u.search ? u.search : "");
  };
}

export default function ChangeCard({
  item,
  projectId,
  onMove,
  isApprover,
  compact,
  returnTo,
}: {
  item: ChangeItem;
  projectId: string;
  onMove: (idOrDbId: string, nextLane: ChangeStatus) => void;
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

  const canSubmitForApproval = status === "analysis" && !!projectId && !!navId;

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

  const lockedMsg = lockReview
    ? "Locked in Review — awaiting approval"
    : decisionStatus === "approved"
    ? "Approved"
    : decisionStatus === "rejected"
    ? "Rejected"
    : "";

  const requester = safeStr((item as any)?.requester).trim() || "Unknown requester";

  return (
    <div
      className={`bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all ${
        lockReview ? "opacity-75" : ""
      }`}
      draggable={!lockReview}
      onDragStart={(e) => {
        if (lockReview) return;
        e.dataTransfer.setData("text/change-id", navId);
        e.dataTransfer.setData("text/change-from", status);
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <div className="p-4">
        {/* Header: ID and Move Controls */}
        <div className="flex items-center justify-between mb-3">
          <span className="inline-flex items-center px-2 py-1 rounded-md bg-gray-100 text-gray-700 text-xs font-mono font-medium">
            {displayId}
          </span>

          <div className="flex items-center gap-1">
            <button
              type="button"
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              disabled={!canArrowPrev}
              title={!canArrowPrev ? (lockReview ? "Review locked" : "Locked") : `Move to ${prevLane}`}
              onClick={() => prevLane && navId && canArrowPrev && onMove(navId, prevLane)}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              type="button"
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              disabled={!canArrowNext}
              title={
                status === "analysis" && nextLane === "review"
                  ? "Use Submit for approval"
                  : !canArrowNext
                  ? lockReview
                    ? "Review locked"
                    : "Locked"
                  : `Move to ${nextLane}`
              }
              onClick={() => nextLane && navId && canArrowNext && onMove(navId, nextLane)}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Title */}
        <Link 
          href={href} 
          className="block text-sm font-semibold text-gray-900 hover:text-indigo-600 transition-colors mb-2 line-clamp-2"
          title={safeStr(item.title)}
        >
          {safeStr(item.title) || "Untitled change"}
        </Link>

        {!compact && (
          <>
            {/* Requester */}
            <div className="text-xs text-gray-500 mb-3 truncate" title={requester}>
              {requester}
            </div>

            {/* Badges */}
            <div className="flex flex-wrap gap-2 mb-3">
              {priorityLabel && (
                <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${priorityBadgeClass(priorityLabel)}`}>
                  {priorityLabel}
                </span>
              )}
              <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${riskBadgeClass(level)}`} title={riskTitle}>
                {riskLabel}
              </span>
            </div>

            {/* AI Impact */}
            <div className="bg-gray-50 rounded-lg p-3 mb-3">
              <div className="text-xs font-semibold text-gray-700 mb-2">AI Impact</div>
              <div className="flex gap-4 text-xs text-gray-600">
                <div className="flex items-center gap-1">
                  <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {aiDays ? `+${aiDays} days` : "—"}
                </div>
                <div className="flex items-center gap-1">
                  <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {aiCost ? moneyGBP(aiCost) : "—"}
                </div>
              </div>
            </div>

            {/* Error Message */}
            {err && (
              <div className="mb-3 p-2 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
                {err}
              </div>
            )}

            {/* Submit Button */}
            {canSubmitForApproval && (
              <button
                type="button"
                onClick={submitForApproval}
                disabled={busy}
                className="w-full mb-3 px-3 py-2 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {busy ? "Submitting…" : "Submit for approval"}
              </button>
            )}

            {/* KPIs */}
            <div className="flex flex-wrap gap-2 mb-3">
              <MiniKpi label="WBS" value={wbsCount} />
              <MiniKpi label="Sch" value={schCount} />
              <MiniKpi label="Risk" value={riskCount} />
              <MiniKpi label="AI" value={aiCount} />
            </div>

            {/* Action Links */}
            <div className="flex flex-wrap gap-2">
              <Link 
                href={hrefWithPanel("comment")} 
                className="px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-gray-900 transition-colors"
              >
                Comment
              </Link>
              <Link 
                href={hrefWithPanel("attach")} 
                className="px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-gray-900 transition-colors"
              >
                Attach
              </Link>
              <Link 
                href={hrefWithPanel("timeline")} 
                className="px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-gray-900 transition-colors"
              >
                Timeline
              </Link>
              <Link 
                href={hrefWithPanel("ai")} 
                className="px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-gray-900 transition-colors"
              >
                AI
              </Link>
            </div>

            {/* Status Messages */}
            {lockedMsg && (
              <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {lockedMsg}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MiniKpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-100 rounded-full text-xs font-medium text-gray-700">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900">{value}</span>
    </div>
  );
}
