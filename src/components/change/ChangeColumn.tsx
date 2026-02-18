// src/components/change/ChangeColumn.tsx
"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import ChangeCard from "./ChangeCard";
import type { ChangeItem, ChangeStatus } from "@/lib/change/types";

function isInteractiveTarget(el: HTMLElement | null) {
  if (!el) return false;
  return Boolean(el.closest('button, a, input, textarea, select, [role="button"], [data-no-nav="true"]'));
}

function normalizeStatus(x: string): ChangeStatus | "" {
  const v = String(x || "").trim().toLowerCase();
  const ok = new Set(["new", "analysis", "review", "in_progress", "implemented", "closed"]);
  return ok.has(v) ? (v as ChangeStatus) : "";
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}

function safeNum(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
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

function isAllowed(from: ChangeStatus, to: ChangeStatus) {
  if (from === "review") return false;
  if (from === "analysis" && to === "review") return false;

  const allowedMoves: Record<ChangeStatus, ChangeStatus[]> = {
    new: ["new", "analysis"],
    analysis: ["analysis", "new"],
    review: [],
    in_progress: ["in_progress", "implemented"],
    implemented: ["implemented", "closed"],
    closed: ["closed"],
  };

  return (allowedMoves[from] || []).includes(to);
}

function readinessForSubmission(it: ChangeItem) {
  const titleOk = safeStr(it.title).trim().length >= 8;
  const summaryOk = safeStr(it.summary).trim().length >= 30;

  const ai = (it as any)?.aiImpact ?? {};
  const riskOk = safeStr(ai?.risk).trim().length >= 10 && !/none identified/i.test(safeStr(ai?.risk));
  const days = safeNum(ai?.days, 0);
  const cost = safeNum(ai?.cost, 0);
  const impactOk = riskOk || days > 0 || cost > 0;

  return {
    ready: titleOk && summaryOk && impactOk,
    checks: { titleOk, summaryOk, impactOk },
  };
}

export default function ChangeColumn({
  column,
  items,
  onMove,
  projectId,
  projectCode,
  isApprover,
}: {
  column: { key: ChangeStatus; title: string };
  items: ChangeItem[];
  onMove: (id: string, status: ChangeStatus) => void;
  projectId: string;
  // FIX: Made projectCode optional since ChangeCard doesn't use it
  projectCode?: string;
  isApprover: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const returnTo = useMemo(() => {
    const sp = searchParams?.toString();
    return `${pathname}${sp ? `?${sp}` : ""}`;
  }, [pathname, searchParams]);

  const [isOver, setIsOver] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [laneNote, setLaneNote] = useState<string>("");

  const colRef = useRef<HTMLDivElement | null>(null);

  const shake = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    node.classList.add("animate-shake");
    setTimeout(() => node.classList.remove("animate-shake"), 260);
  }, []);

  const scanLane = useCallback(async () => {
    if (!projectId || scanBusy) return;

    setScanBusy(true);
    setLaneNote("");

    try {
      const laneItems = Array.isArray(items) ? items : [];
      if (!laneItems.length) {
        setLaneNote("Nothing to scan in this lane.");
        return;
      }

      if (column.key === "analysis") {
        let ready = 0;
        let needsWork = 0;

        for (const it of laneItems) {
          const r = readinessForSubmission(it);
          if (r.ready) ready++;
          else needsWork++;
        }

        setLaneNote(`Checking readiness… Ready: ${ready} • Needs work: ${needsWork} • Scanning AI now…`);
      } else {
        setLaneNote(`Scanning ${laneItems.length} item(s)…`);
      }

      let okCount = 0;
      let failCount = 0;

      for (const it of laneItems) {
        const changeId = safeStr((it as any)?.dbId || (it as any)?.id).trim();
        if (!changeId) continue;

        try {
          await postJson("/api/ai/events", {
            projectId,
            artifactId: null,
            eventType: "change_ai_scan_requested",
            severity: "info",
            source: "change_lane_header",
            payload: {
              lane: column.key,
              changeId,
              title: safeStr(it.title),
              summary: safeStr(it.summary),
            },
          });
          okCount++;
        } catch {
          failCount++;
        }
      }

      if (column.key === "analysis") {
        let ready = 0;
        let needsWork = 0;
        for (const it of laneItems) {
          const r = readinessForSubmission(it);
          if (r.ready) ready++;
          else needsWork++;
        }

        setLaneNote(
          `Analysis readiness: Ready: ${ready} • Needs work: ${needsWork} • AI scanned: ${okCount}${
            failCount ? ` (failed: ${failCount})` : ""
          }`
        );
      } else {
        setLaneNote(`AI scanned: ${okCount}${failCount ? ` (failed: ${failCount})` : ""}`);
      }
    } catch (e) {
      console.error("[Run AI scan]", e);
      setLaneNote("AI scan failed. Check console/network.");
    } finally {
      setScanBusy(false);
      setTimeout(() => setLaneNote(""), 6000);
    }
  }, [projectId, scanBusy, items, column.key]);

  const showHeaderScan = column.key === "analysis";

  return (
    <div
      ref={colRef}
      className={`flex flex-col h-full rounded-xl border-2 transition-all duration-200 ${
        isOver 
          ? isBlocked 
            ? "border-rose-300 bg-rose-50/50" 
            : "border-indigo-400 bg-indigo-50/30"
          : "border-transparent bg-gray-100"
      }`}
      data-lane={column.key}
      onDragOver={(e) => {
        const types = Array.from(e.dataTransfer?.types ?? []);
        if (!types.includes("text/change-id")) return;

        const fromRaw = e.dataTransfer.getData("text/change-from");
        const from = normalizeStatus(fromRaw);
        const allowed = from ? isAllowed(from as ChangeStatus, column.key) : true;

        setIsOver(true);
        setIsBlocked(!allowed);

        if (allowed) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        } else {
          e.dataTransfer.dropEffect = "none";
        }
      }}
      onDragLeave={() => {
        setIsOver(false);
        setIsBlocked(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData("text/change-id");
        if (!id) return;

        const fromRaw = e.dataTransfer.getData("text/change-from");
        const from = normalizeStatus(fromRaw);

        if (from) {
          const allowed = isAllowed(from as ChangeStatus, column.key);
          if (!allowed) {
            setIsOver(true);
            setIsBlocked(true);
            shake(colRef.current);
            return;
          }
        }

        setIsOver(false);
        setIsBlocked(false);
        onMove(id, column.key);
      }}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white rounded-t-xl border-b border-gray-200">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-gray-900">{column.title}</h3>
          <span className="inline-flex items-center justify-center w-6 h-6 text-xs font-medium text-gray-600 bg-gray-100 rounded-full">
            {items.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {showHeaderScan && (
            <button
              type="button"
              onClick={scanLane}
              disabled={scanBusy || !projectId}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors disabled:opacity-50"
            >
              {scanBusy ? (
                <>
                  <div className="w-3 h-3 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                  Scanning…
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Run AI scan
                </>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title={collapsed ? "Expand cards" : "Collapse to title only"}
          >
            {collapsed ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Lane Note */}
      {laneNote && (
        <div className="mx-4 mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
          {laneNote}
        </div>
      )}

      {/* Cards Area */}
      <div className="flex-1 p-4 overflow-y-auto min-h-[200px]">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <div className="w-12 h-12 mb-3 text-gray-300">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <div className="text-sm font-medium text-gray-900 mb-1">All clear</div>
            <div className="text-xs text-gray-500 mb-3">No changes in this lane.</div>
            
            {column.key === "analysis" && (
              <button
                type="button"
                onClick={scanLane}
                disabled={scanBusy}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors"
              >
                {scanBusy ? "Scanning…" : "Run AI scan"}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((it) => {
              const dbId = safeStr((it as any)?.dbId).trim();
              const idFallback = safeStr((it as any)?.id).trim();
              const navId = dbId || idFallback;

              const baseHref = `/projects/${encodeURIComponent(projectId)}/change/${encodeURIComponent(navId)}`;
              const href = `${baseHref}?returnTo=${encodeURIComponent(returnTo)}`;

              return (
                <div
                  key={navId || it.id}
                  className="cursor-pointer"
                  role="link"
                  tabIndex={0}
                  onClick={(e) => {
                    const target = e.target as HTMLElement | null;
                    if (isInteractiveTarget(target)) return;
                    if (!navId) return;
                    router.push(href);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    const target = e.target as HTMLElement | null;
                    if (isInteractiveTarget(target)) return;
                    e.preventDefault();
                    if (!navId) return;
                    router.push(href);
                  }}
                >
                  <Link href={href} className="sr-only">
                    Open change request {it.title || ""}
                  </Link>

                  {/* FIX: Removed projectCode prop - ChangeCard doesn't accept it */}
                  <ChangeCard
                    item={it}
                    onMove={onMove}
                    projectId={projectId}
                    isApprover={isApprover}
                    compact={collapsed}
                    returnTo={returnTo}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Drop Indicator */}
      {isOver && (
        <div className={`mx-4 mb-4 p-3 rounded-lg text-center text-sm font-medium ${
          isBlocked 
            ? "bg-rose-100 text-rose-800 border border-rose-200" 
            : "bg-indigo-100 text-indigo-800 border border-indigo-200"
        }`}>
          {isBlocked 
            ? (column.key === "review" ? "Review locked (approval only)" : "Lane locked") 
            : "Drop to move here"}
        </div>
      )}
    </div>
  );
}