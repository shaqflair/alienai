"use client";

import React, { useEffect, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import {
  getOrGenerateBriefing,
  regenerateBriefing,
} from "@/app/projects/[id]/briefing-actions";
import type { BriefingSection, ProjectBriefing } from "@/app/projects/[id]/briefing-actions";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  projectId:         string;
  initialBriefing?:  ProjectBriefing | null;  // Optional SSR-provided cached briefing
  canRegenerate?:    boolean;                  // Owners/editors only
}

// ── Dismiss key — resets each calendar day ────────────────────────────────────

function getDismissKey(projectId: string): string {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  return `briefing_dismissed_${projectId}_${today}`;
}

function isDismissed(projectId: string): boolean {
  try {
    return localStorage.getItem(getDismissKey(projectId)) === "1";
  } catch {
    return false;
  }
}

function setDismissed(projectId: string) {
  try {
    localStorage.setItem(getDismissKey(projectId), "1");
  } catch {}
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function BriefingSkeleton() {
  return (
    <div className="animate-pulse space-y-3 py-1">
      <div className="h-4 bg-gray-200 rounded-full w-3/4" />
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <div className="h-3 bg-gray-200 rounded-full w-1/2" />
          <div className="h-3 bg-gray-100 rounded-full" />
          <div className="h-3 bg-gray-100 rounded-full w-5/6" />
        </div>
        <div className="space-y-2">
          <div className="h-3 bg-gray-200 rounded-full w-1/2" />
          <div className="h-3 bg-gray-100 rounded-full" />
          <div className="h-3 bg-gray-100 rounded-full w-4/5" />
        </div>
        <div className="space-y-2">
          <div className="h-3 bg-gray-200 rounded-full w-1/2" />
          <div className="h-3 bg-gray-100 rounded-full" />
          <div className="h-3 bg-gray-100 rounded-full w-2/3" />
        </div>
      </div>
    </div>
  );
}

// ── Priority badge ─────────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: "high" | "medium" }) {
  return priority === "high" ? (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-50 border border-red-200 text-red-700">
      <Zap className="w-2.5 h-2.5" />
      High
    </span>
  ) : (
    <span className="inline-flex items-center text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700">
      Med
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ProjectDailyBriefing({
  projectId,
  initialBriefing,
  canRegenerate = false,
}: Props) {
  const [briefing, setBriefing]     = useState<ProjectBriefing | null>(initialBriefing ?? null);
  const [loading, setLoading]       = useState(!initialBriefing);
  const [error, setError]           = useState<string | null>(null);
  const [collapsed, setCollapsed]   = useState(false);
  const [dismissed, setDismissedState] = useState(false);
  const [isPending, startTransition] = useTransition();
  const hasFetched = useRef(false);

  useEffect(() => {
    if (isDismissed(projectId)) {
      setDismissedState(true);
    }
  }, [projectId]);

  useEffect(() => {
    if (hasFetched.current) return;
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
          if (e) {
            setError(e);
          } else {
            setBriefing(b);
          }
        } catch (err: any) {
          setError(err?.message ?? "Failed to load briefing.");
        } finally {
          setLoading(false);
        }
      })();
    });
  }, [projectId]);

  function handleDismiss() {
    setDismissed(projectId);
    setDismissedState(true);
  }

  function handleRegenerate() {
    setLoading(true);
    setError(null);
    startTransition(() => {
      void (async () => {
        try {
          const { briefing: b, error: e } = await regenerateBriefing(projectId);
          if (e) {
            setError(e);
          } else {
            setBriefing(b);
          }
        } catch (err: any) {
          setError(err?.message ?? "Regeneration failed.");
        } finally {
          setLoading(false);
        }
      })();
    });
  }

  if (dismissed) return null;

  const content = briefing?.content as BriefingSection | undefined;
  const generatedAt = briefing?.generated_at
    ? new Date(briefing.generated_at).toLocaleTimeString("en-GB", {
        hour: "2-digit", minute: "2-digit",
      })
    : null;

  return (
    <div
      className="w-full border-b border-gray-200 bg-gradient-to-r from-indigo-50/60 via-white to-purple-50/40"
      style={{ borderTop: "2px solid #6366f1" }}
    >
      <div className="flex items-center justify-between px-6 py-2.5 gap-3">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-2 text-left flex-1 min-w-0 group"
        >
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-100">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
            </div>
            <span className="text-sm font-semibold text-gray-900">
              AI Daily Briefing
            </span>
          </div>

          {content?.summary && !collapsed && (
            <span className="text-sm text-gray-500 truncate hidden sm:block">
              — {content.summary}
            </span>
          )}

          <span className="ml-auto shrink-0 text-gray-400 group-hover:text-gray-600 transition-colors">
            {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </span>
        </button>

        <div className="flex items-center gap-2 shrink-0">
          {generatedAt && !loading && (
            <span className="text-xs text-gray-400 hidden md:block">
              Generated {generatedAt}
            </span>
          )}

          {canRegenerate && !loading && (
            <button
              onClick={handleRegenerate}
              disabled={isPending || loading}
              className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-indigo-600 px-2 py-1 rounded-lg hover:bg-indigo-50 transition-colors disabled:opacity-40"
              title="Regenerate briefing"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isPending || loading ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Regenerate</span>
            </button>
          )}

          <button
            onClick={handleDismiss}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title="Dismiss for today"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="px-6 pb-5 pt-1">
          {loading && <BriefingSkeleton />}

          {!loading && error && (
            <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <span className="font-medium">Briefing unavailable: </span>
                {error}
                {canRegenerate && (
                  <button onClick={handleRegenerate} className="ml-2 underline underline-offset-2 hover:no-underline">
                    Try again
                  </button>
                )}
              </div>
            </div>
          )}

          {!loading && !error && content && (
            <div className="space-y-4">
              {content.summary && (
                <p className="text-sm text-gray-700 leading-relaxed border-l-2 border-indigo-300 pl-3 italic">
                  {content.summary}
                </p>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* On track */}
                <div className="rounded-xl bg-green-50 border border-green-200 p-4 space-y-2">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-green-800">On track</span>
                  </div>
                  <ul className="space-y-1.5">
                    {content.on_track?.map((item, i) => (
                      <li key={i} className="text-xs text-green-900 flex gap-2">
                        <span className="text-green-400 mt-0.5 shrink-0">✓</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Needs attention */}
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 space-y-2">
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-amber-800">Needs attention</span>
                  </div>
                  <ul className="space-y-2">
                    {content.needs_attention?.map((item, i) => (
                      <li key={i} className="text-xs text-amber-900 flex flex-col gap-1">
                        <div className="flex items-start gap-2">
                          <span className="text-amber-400 mt-0.5 shrink-0">!</span>
                          <span className="flex-1">{item.item}</span>
                        </div>
                        <div className="pl-4">
                          <PriorityBadge priority={item.priority} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Biggest risk */}
                <div className="rounded-xl bg-red-50 border border-red-200 p-4 space-y-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                      <span className="text-xs font-semibold uppercase tracking-wider text-red-800">Biggest risk</span>
                    </div>
                    <p className="text-xs text-red-900 leading-relaxed pl-1">{content.biggest_risk}</p>
                  </div>

                  <div className="space-y-1.5 border-t border-red-200 pt-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-red-800">Actions for today</span>
                    <ol className="space-y-1.5">
                      {content.recommended_actions?.map((action, i) => (
                        <li key={i} className="text-xs text-red-900 flex gap-2">
                          <span className="font-semibold text-red-400 shrink-0">{i + 1}.</span>
                          <span>{action}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
