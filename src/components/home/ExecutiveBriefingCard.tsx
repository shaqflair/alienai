"use client";
// src/components/home/ExecutiveBriefingCard.tsx
// Render-only version.
// Receives aggregated briefing data from the server/homepage payload.
// No client-side AI fetches here.

import React, { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  RefreshCw,
  ChevronRight,
  AlertTriangle,
  AlertCircle,
  Activity,
  Shield,
  Truck,
  DollarSign,
  Copy,
  Check,
  ClipboardList,
  ArrowUpRight,
  Target,
} from "lucide-react";
import type { BriefingData } from "@/lib/server/home/loadExecutiveBriefing";

/* -------------------------------------------------------------------------- */
/* Error boundary                                                              */
/* -------------------------------------------------------------------------- */

type EBState = { crashed: boolean };

class CardErrorBoundary extends React.Component<{ children: React.ReactNode }, EBState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { crashed: false };
  }

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(err: unknown) {
    console.error("[ExecutiveBriefingCard]", err);
  }

  render() {
    return this.state.crashed ? null : this.props.children;
  }
}

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

type Sentiment = "green" | "amber" | "red" | "neutral";
type SectionId = "health" | "risk" | "delivery" | "finance";

type NarrativeSection = {
  id: SectionId;
  title: string;
  body: string;
  sentiment: Sentiment;
};

type Gap = {
  severity: "high" | "medium" | "low";
  type: string;
  detail: string;
  project?: string;
  href?: string;
};

type ExecutiveDecision = {
  posture?: "on_track" | "watch" | "action_required";
  confidence?: "high" | "medium" | "low";
  trend?: "improving" | "stable" | "declining";
  primary_risk?: string;
  impact?: string;
  recommendation?: string;
};

type FocusProject = {
  name?: string;
  href?: string;
  issue?: string;
  consequence?: string;
  action?: string;
  sentiment?: Sentiment;
};

export type RagLiveCounts = { g: number; a: number; r: number };

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function safeStr(x: unknown): string {
  if (typeof x === "string") return x;
  if (x == null) return "";
  return String(x);
}

function timeAgo(iso: string): string {
  try {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (!Number.isFinite(diff) || diff < 0) return "";
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  } catch {
    return "";
  }
}

const SENTIMENT_STYLES: Record<
  Sentiment,
  { bar: string; bg: string; border: string; text: string; badge: string }
> = {
  green: {
    bar: "#22c55e",
    bg: "bg-green-50",
    border: "border-green-100",
    text: "text-green-700",
    badge: "bg-green-100 text-green-700",
  },
  amber: {
    bar: "#f59e0b",
    bg: "bg-amber-50",
    border: "border-amber-100",
    text: "text-amber-700",
    badge: "bg-amber-100 text-amber-700",
  },
  red: {
    bar: "#ef4444",
    bg: "bg-red-50",
    border: "border-red-100",
    text: "text-red-700",
    badge: "bg-red-100 text-red-700",
  },
  neutral: {
    bar: "#6b7280",
    bg: "bg-gray-50",
    border: "border-gray-100",
    text: "text-gray-700",
    badge: "bg-gray-100 text-gray-600",
  },
};

const GAP_STYLES: Record<Gap["severity"], { dot: string; text: string; bg: string }> = {
  high: {
    dot: "bg-red-500",
    text: "text-red-700",
    bg: "bg-red-50 border-red-100",
  },
  medium: {
    dot: "bg-amber-500",
    text: "text-amber-700",
    bg: "bg-amber-50 border-amber-100",
  },
  low: {
    dot: "bg-blue-400",
    text: "text-blue-700",
    bg: "bg-blue-50 border-blue-100",
  },
};

function getOverall(sections: NarrativeSection[]): Sentiment {
  if (!sections.length) return "neutral";
  if (sections.some((s) => s.sentiment === "red")) return "red";
  if (sections.some((s) => s.sentiment === "amber")) return "amber";
  if (sections.every((s) => s.sentiment === "green")) return "green";
  return "neutral";
}

function getOverallLabel(sentiment: Sentiment): string {
  if (sentiment === "red") return "Action required";
  if (sentiment === "amber") return "Monitor";
  if (sentiment === "green") return "On track";
  return "Neutral";
}

function getPostureLabel(posture?: ExecutiveDecision["posture"]): string | null {
  if (posture === "action_required") return "Action required";
  if (posture === "watch") return "Watch";
  if (posture === "on_track") return "On track";
  return null;
}

function getToneLabel(confidence?: ExecutiveDecision["confidence"]): string | null {
  if (confidence === "high") return "Confident";
  if (confidence === "medium") return "Balanced";
  if (confidence === "low") return "Cautious";
  return null;
}

function getBarWidth(sentiment: Sentiment): string {
  if (sentiment === "green") return "90%";
  if (sentiment === "amber") return "60%";
  if (sentiment === "red") return "30%";
  return "50%";
}

function normalizeSentiment(input: unknown): Sentiment {
  const s = safeStr(input).trim().toLowerCase();
  if (s === "green" || s === "amber" || s === "red" || s === "neutral") return s;
  return "neutral";
}

const SectionIcon = React.memo(function SectionIcon({ id }: { id: SectionId }) {
  if (id === "health") return <Activity className="h-4 w-4" />;
  if (id === "risk") return <AlertTriangle className="h-4 w-4" />;
  if (id === "delivery") return <Truck className="h-4 w-4" />;
  if (id === "finance") return <DollarSign className="h-4 w-4" />;
  return null;
});

/* -------------------------------------------------------------------------- */
/* Small memo blocks                                                           */
/* -------------------------------------------------------------------------- */

const MetricPills = React.memo(function MetricPills({
  projectCount,
  rag,
  avgHealth,
  overdueApprovals,
  highRaid,
}: {
  projectCount: number;
  rag?: { g: number; a: number; r: number } | null;
  avgHealth?: number | null;
  overdueApprovals?: number | null;
  highRaid?: number | null;
}) {
  if (!rag && projectCount <= 0 && avgHealth == null && !overdueApprovals && !highRaid) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200/80 bg-white px-3 py-1 text-xs font-medium text-gray-700">
        <Activity className="h-3 w-3 text-gray-400" />
        {projectCount} projects
      </span>

      <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
        {rag?.g ?? 0} Green
      </span>

      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
        {rag?.a ?? 0} Amber
      </span>

      <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
        {rag?.r ?? 0} Red
      </span>

      {avgHealth != null && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200/80 bg-white px-3 py-1 text-xs font-medium text-gray-600">
          Avg health {avgHealth}%
        </span>
      )}

      {(overdueApprovals ?? 0) > 0 && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
          <AlertTriangle className="h-3 w-3" />
          {overdueApprovals} overdue approvals
        </span>
      )}

      {(highRaid ?? 0) > 0 && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
          {highRaid} high-severity RAID
        </span>
      )}
    </div>
  );
});

const SectionsGrid = React.memo(function SectionsGrid({
  sections,
}: {
  sections: NarrativeSection[];
}) {
  if (!sections.length) return null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {sections.map((sec, i) => {
        const sentiment = sec?.sentiment ?? "neutral";
        const st = SENTIMENT_STYLES[sentiment] ?? SENTIMENT_STYLES.neutral;
        const sentLabel = safeStr(sentiment);

        return (
          <div
            key={sec?.id ?? i}
            className={`rounded-2xl border p-4 ${st.bg} ${st.border}`}
          >
            <div className="mb-2 flex items-center gap-2">
              <span className={st.text}>
                <SectionIcon id={sec?.id as SectionId} />
              </span>
              <span className="text-xs font-bold uppercase tracking-wider text-gray-700">
                {safeStr(sec?.title)}
              </span>
              <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${st.badge}`}>
                {sentLabel.charAt(0).toUpperCase() + sentLabel.slice(1)}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-gray-700">{safeStr(sec?.body)}</p>
          </div>
        );
      })}
    </div>
  );
});

const FocusProjectPanel = React.memo(function FocusProjectPanel({
  focusProject,
  onNavigate,
}: {
  focusProject: FocusProject | null;
  onNavigate: (href: string) => void;
}) {
  if (!focusProject?.name && !focusProject?.issue && !focusProject?.consequence && !focusProject?.action) {
    return null;
  }

  const sentiment = normalizeSentiment(focusProject?.sentiment || "amber");
  const st = SENTIMENT_STYLES[sentiment];

  return (
    <div className={`rounded-2xl border p-4 ${st.bg} ${st.border}`}>
      <div className="mb-3 flex items-center gap-2">
        <Target className={`h-4 w-4 ${st.text}`} />
        <span className="text-xs font-bold uppercase tracking-wider text-gray-700">
          Focus project
        </span>
        {focusProject?.name && (
          <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${st.badge}`}>
            {focusProject.name}
          </span>
        )}
      </div>

      <div className="space-y-2">
        {focusProject?.issue && (
          <div className="text-xs leading-relaxed text-gray-700">
            <span className="font-semibold text-gray-900">Issue: </span>
            {focusProject.issue}
          </div>
        )}

        {focusProject?.consequence && (
          <div className="text-xs leading-relaxed text-gray-700">
            <span className="font-semibold text-gray-900">Impact: </span>
            {focusProject.consequence}
          </div>
        )}

        {focusProject?.action && (
          <div className="text-xs leading-relaxed text-indigo-700">
            <span className="font-semibold">Recommended action: </span>
            {focusProject.action}
          </div>
        )}
      </div>

      {focusProject?.href && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => onNavigate(focusProject.href!)}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200/80 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            View project
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
});

const GapsPanel = React.memo(function GapsPanel({
  gaps,
  showGaps,
  onToggle,
  onNavigate,
}: {
  gaps: Gap[];
  showGaps: boolean;
  onToggle: () => void;
  onNavigate: (href: string) => void;
}) {
  if (!gaps.length) return null;

  const highG = gaps.filter((g) => g?.severity === "high");
  const otherG = gaps.filter((g) => g?.severity !== "high");

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between rounded-2xl border border-gray-200/80 bg-gray-50/80 px-4 py-3 text-left transition-colors hover:bg-gray-100/80"
      >
        <div className="flex items-center gap-2.5">
          <Shield className="h-4 w-4 shrink-0 text-gray-500" />
          <span className="text-sm font-semibold text-gray-800">Governance gaps</span>

          {highG.length > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
              {highG.length}
            </span>
          )}

          {otherG.length > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gray-300 px-1.5 text-[10px] font-bold text-gray-700">
              {otherG.length}
            </span>
          )}
        </div>

        <ChevronRight
          className={`h-4 w-4 text-gray-400 transition-transform duration-200${showGaps ? " rotate-90" : ""}`}
        />
      </button>

      {showGaps && (
        <div className="mt-2 space-y-1.5">
          {gaps.map((g, i) => {
            const gs = GAP_STYLES[g?.severity] ?? GAP_STYLES.medium;

            return (
              <div
                key={i}
                className={`flex items-start gap-3 rounded-2xl border px-4 py-3 ${gs.bg}`}
              >
                <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${gs.dot}`} />

                <div className="min-w-0 flex-1">
                  {g?.project && (
                    <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                      {safeStr(g.project)}
                    </div>
                  )}
                  <div className={`text-xs font-medium ${gs.text}`}>{safeStr(g?.detail)}</div>
                </div>

                {g?.href && (
                  <button
                    type="button"
                    onClick={() => onNavigate(g.href!)}
                    className="flex shrink-0 items-center gap-0.5 text-xs font-medium text-gray-400 transition-colors hover:text-gray-700"
                  >
                    Fix <ChevronRight className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

const TalkingPoints = React.memo(function TalkingPoints({
  points,
  copied,
  onCopy,
}: {
  points: string[];
  copied: boolean;
  onCopy: () => void;
}) {
  if (!points.length) return null;

  return (
    <div className="rounded-2xl border border-indigo-100/80 bg-indigo-50/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 shrink-0 text-indigo-500" />
          <span className="text-xs font-bold uppercase tracking-wider text-indigo-700">
            Board talking points
          </span>
        </div>

        <button
          type="button"
          onClick={onCopy}
          className="flex items-center gap-1 text-xs font-medium text-indigo-500 transition-colors hover:text-indigo-700"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy all</span>
            </>
          )}
        </button>
      </div>

      <ol className="space-y-2">
        {points.map((tp, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-700">
              {i + 1}
            </span>
            <span className="text-xs leading-relaxed text-gray-700">{safeStr(tp)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
});

/* -------------------------------------------------------------------------- */
/* Main inner                                                                  */
/* -------------------------------------------------------------------------- */

function BriefingInner({
  data,
  liveRagCounts,
}: {
  data?: BriefingData | null;
  liveRagCounts?: RagLiveCounts;
}) {
  const router = useRouter();

  const [copied, setCopied] = useState(false);
  const [showGaps, setShowGaps] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const copyTimeoutRef = useRef<number | null>(null);

  const loading = !data;
  const fetchErr = data && !data.ok ? safeStr((data as any).error) || "Failed to load briefing" : null;
  const refreshed = data?.generated_at ?? "";

  const sections = useMemo<NarrativeSection[]>(
    () => (Array.isArray((data as any)?.sections) ? ((data as any).sections as NarrativeSection[]) : []),
    [data]
  );

  const gaps = useMemo<Gap[]>(
    () => (Array.isArray((data as any)?.gaps) ? ((data as any).gaps as Gap[]) : []),
    [data]
  );

  const points = useMemo<string[]>(
    () =>
      Array.isArray((data as any)?.talking_points)
        ? ((data as any).talking_points as unknown[])
            .map((x) => safeStr(x).trim())
            .filter(Boolean)
            .map((t) => (t.startsWith("•") ? t : t))
        : [],
    [data]
  );

  const sig = ((data as any)?.signals_summary ?? null) as
    | {
        rag?: { g: number; a: number; r: number } | null;
        project_count?: number | null;
        avg_health?: number | null;
        overdue_approvals?: number | null;
        high_raid?: number | null;
      }
    | null;

  const decision = (((data as any)?.decision ?? null) as ExecutiveDecision | null) ?? null;
  const focusProject = (((data as any)?.focus_project ?? null) as FocusProject | null) ?? null;

  const displayRag = useMemo(() => {
    if (liveRagCounts && data?.ok) {
      return {
        g: liveRagCounts.g,
        a: liveRagCounts.a,
        r: liveRagCounts.r,
      };
    }
    return sig?.rag ?? null;
  }, [liveRagCounts, data?.ok, sig]);

  const overall = useMemo(() => getOverall(sections), [sections]);
  const overallStyle = SENTIMENT_STYLES[overall] ?? SENTIMENT_STYLES.neutral;
  const overallLabel = useMemo(() => getOverallLabel(overall), [overall]);
  const postureLabel = useMemo(
    () => getPostureLabel(decision?.posture) ?? overallLabel,
    [decision?.posture, overallLabel]
  );
  const toneLabel = useMemo(() => getToneLabel(decision?.confidence), [decision?.confidence]);
  const barWidth = useMemo(() => getBarWidth(overall), [overall]);

  const onRefresh = useCallback(() => {
    router.refresh();
  }, [router]);

  const onToggleCollapsed = useCallback(() => {
    setCollapsed((v) => !v);
  }, []);

  const onToggleGaps = useCallback(() => {
    setShowGaps((v) => !v);
  }, []);

  const onNavigate = useCallback(
    (href: string) => {
      try {
        router.push(href);
      } catch {
        // no-op
      }
    },
    [router]
  );

  const copy = useCallback(() => {
    if (!points.length || typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return;
    }

    const text = points.map((t, i) => `${i + 1}. ${safeStr(t)}`).join("\n");

    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);

        if (copyTimeoutRef.current) {
          window.clearTimeout(copyTimeoutRef.current);
        }

        copyTimeoutRef.current = window.setTimeout(() => {
          setCopied(false);
          copyTimeoutRef.current = null;
        }, 2000);
      })
      .catch(() => {});
  }, [points]);

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-gray-200/70 bg-white shadow-sm"
      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}
    >
      <div
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: overallStyle.bar }}
        aria-hidden="true"
      />

      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-100">
            <Sparkles className="h-4 w-4 text-indigo-600" />
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-gray-900">Executive Briefing</h3>

              {data?.ok && !loading && (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${overallStyle.badge}`}>
                  {postureLabel}
                </span>
              )}
            </div>

            <p className="mt-0.5 text-xs text-gray-400">
              {"AI-generated portfolio narrative · "}
              {refreshed ? `Updated ${timeAgo(refreshed)}` : loading ? "Loading..." : "Ready"}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {points.length > 0 && (
            <button
              type="button"
              onClick={copy}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-green-500" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy points</span>
                </>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={onRefresh}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-50"
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={onToggleCollapsed}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-50"
            aria-label={collapsed ? "Expand briefing" : "Collapse briefing"}
          >
            <ChevronRight
              className={`h-3.5 w-3.5 transition-transform duration-200${collapsed ? "" : " rotate-90"}`}
            />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div>
          {/* Skeleton */}
          {loading && (
            <div className="animate-pulse space-y-4 p-6">
              <div className="h-4 w-3/4 rounded bg-gray-100" />
              <div className="h-4 w-full rounded bg-gray-100" />
              <div className="h-4 w-5/6 rounded bg-gray-100" />
              <div className="mt-4 grid grid-cols-2 gap-3">
                {[0, 1, 2, 3].map((n) => (
                  <div key={n} className="h-24 rounded-2xl bg-gray-50" />
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {fetchErr && !loading && (
            <div className="p-6">
              <div className="flex items-start gap-3 rounded-2xl border border-red-100 bg-red-50 p-4">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                <div>
                  <div className="text-sm font-semibold text-red-800">Briefing unavailable</div>
                  <div className="mt-0.5 text-xs text-red-700">{fetchErr}</div>
                  <button
                    type="button"
                    onClick={onRefresh}
                    className="mt-2 text-xs font-medium text-red-600 underline hover:text-red-800"
                  >
                    Refresh page
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Content */}
          {data?.ok && !fetchErr && !loading && (
            <div className="space-y-5 p-6">
              {/* Health bar */}
              <div className="h-1 overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: barWidth, background: overallStyle.bar }}
                />
              </div>

              {/* Summary */}
              {safeStr((data as any).executive_summary) && (
                <div className="rounded-2xl border border-gray-200/70 bg-gray-50/70 p-4">
                  <div className="space-y-3">
                    <p className="text-sm font-medium leading-6 text-gray-800">
                      {safeStr((data as any).executive_summary)}
                    </p>

                    {(decision?.trend || decision?.confidence || decision?.primary_risk) && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        {decision?.trend && (
                          <div className="rounded-xl border border-gray-200/70 bg-white px-3 py-2">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                              Trend
                            </div>
                            <div className="mt-0.5 text-xs font-semibold capitalize text-gray-800">
                              {decision.trend}
                            </div>
                          </div>
                        )}

                        {decision?.confidence && (
                          <div className="rounded-xl border border-gray-200/70 bg-white px-3 py-2">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                              Confidence
                            </div>
                            <div className="mt-0.5 text-xs font-semibold capitalize text-gray-800">
                              {decision.confidence}
                            </div>
                          </div>
                        )}

                        {decision?.primary_risk && (
                          <div className="rounded-xl border border-gray-200/70 bg-white px-3 py-2">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                              Primary risk
                            </div>
                            <div className="mt-0.5 text-xs font-semibold text-gray-800">
                              {decision.primary_risk}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {(toneLabel || decision?.impact || decision?.recommendation) && (
                      <div className="space-y-2">
                        {toneLabel && (
                          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                            AI tone: {toneLabel}
                          </div>
                        )}

                        {decision?.impact && (
                          <div className="text-xs leading-relaxed text-gray-600">
                            <span className="font-semibold text-gray-800">Impact: </span>
                            {decision.impact}
                          </div>
                        )}

                        {decision?.recommendation && (
                          <div className="text-xs font-medium leading-relaxed text-indigo-700">
                            Recommendation: {decision.recommendation}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Pills */}
              <MetricPills
                projectCount={sig?.project_count ?? 0}
                rag={displayRag}
                avgHealth={sig?.avg_health ?? null}
                overdueApprovals={sig?.overdue_approvals ?? 0}
                highRaid={sig?.high_raid ?? 0}
              />

              {/* Focus project */}
              <FocusProjectPanel focusProject={focusProject} onNavigate={onNavigate} />

              {/* Sections */}
              <SectionsGrid sections={sections} />

              {/* Gaps */}
              <GapsPanel
                gaps={gaps}
                showGaps={showGaps}
                onToggle={onToggleGaps}
                onNavigate={onNavigate}
              />

              {/* Talking points */}
              <TalkingPoints points={points} copied={copied} onCopy={copy} />

              {/* Footer */}
              <div className="flex items-center justify-between pt-1">
                <p className="text-[11px] text-gray-400">
                  {(data as any).generated_at
                    ? `Generated ${new Date((data as any).generated_at).toLocaleString()}`
                    : ""}
                  {" · AI-assisted -- verify before presenting"}
                </p>

                <button
                  type="button"
                  onClick={onRefresh}
                  className="flex items-center gap-1 text-xs font-medium text-gray-400 transition-colors hover:text-gray-600"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>Refresh</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Export                                                                      */
/* -------------------------------------------------------------------------- */

function ExecutiveBriefingCard({
  data,
  liveRagCounts,
}: {
  data?: BriefingData | null;
  liveRagCounts?: RagLiveCounts;
}) {
  return (
    <CardErrorBoundary>
      <BriefingInner data={data} liveRagCounts={liveRagCounts} />
    </CardErrorBoundary>
  );
}

export default React.memo(ExecutiveBriefingCard);