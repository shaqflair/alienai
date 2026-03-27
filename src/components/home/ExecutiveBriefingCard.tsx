"use client";

// src/components/home/ExecutiveBriefingCard.tsx

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
} from "lucide-react";
import type { BriefingData } from "@/lib/server/home/loadExecutiveBriefing";

/* -------------------------------------------------------------------------- */
/* NEW: Decision Layer                                                         */
/* -------------------------------------------------------------------------- */

type ExecutiveDecision = {
  posture: "on_track" | "watch" | "action_required";
  confidence: "high" | "medium" | "low";
  trend: "improving" | "stable" | "declining";
  primary_risk?: string;
  impact?: string;
  recommendation?: string;
};

/* -------------------------------------------------------------------------- */
/* EXISTING TYPES                                                              */
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

const SENTIMENT_STYLES = {
  green: { bar: "#22c55e", bg: "bg-green-50", border: "border-green-100", text: "text-green-700", badge: "bg-green-100 text-green-700" },
  amber: { bar: "#f59e0b", bg: "bg-amber-50", border: "border-amber-100", text: "text-amber-700", badge: "bg-amber-100 text-amber-700" },
  red: { bar: "#ef4444", bg: "bg-red-50", border: "border-red-100", text: "text-red-700", badge: "bg-red-100 text-red-700" },
  neutral: { bar: "#6b7280", bg: "bg-gray-50", border: "border-gray-100", text: "text-gray-700", badge: "bg-gray-100 text-gray-600" },
};

function getOverall(sections: NarrativeSection[]): Sentiment {
  if (!sections.length) return "neutral";
  if (sections.some((s) => s.sentiment === "red")) return "red";
  if (sections.some((s) => s.sentiment === "amber")) return "amber";
  if (sections.every((s) => s.sentiment === "green")) return "green";
  return "neutral";
}

function getBarWidth(sentiment: Sentiment): string {
  if (sentiment === "green") return "90%";
  if (sentiment === "amber") return "60%";
  if (sentiment === "red") return "30%";
  return "50%";
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

function ExecutiveBriefingCard({
  data,
  liveRagCounts,
}: {
  data?: BriefingData | null;
  liveRagCounts?: RagLiveCounts;
}) {
  const router = useRouter();

  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);

  const decision = (data as any)?.decision as ExecutiveDecision | null;

  const sections = useMemo(
    () => (Array.isArray(data?.sections) ? data.sections : []),
    [data?.sections]
  );

  const points = useMemo(() => {
    return Array.isArray(data?.talking_points)
      ? data.talking_points.map((x) => {
          const t = safeStr(x);
          return t.startsWith("•") ? t : `• ${t}`;
        })
      : [];
  }, [data?.talking_points]);

  const overall = getOverall(sections);
  const overallStyle = SENTIMENT_STYLES[overall];
  const barWidth = getBarWidth(overall);

  const copy = useCallback(() => {
    if (!points.length) return;
    navigator.clipboard.writeText(points.join("\n")).then(() => {
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
    });
  }, [points]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-gray-100 bg-white">

      {/* Accent bar */}
      <div
        className="absolute top-0 left-0 h-full w-1"
        style={{ background: overallStyle.bar }}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div className="flex items-center gap-3">
          <Sparkles className="h-4 w-4 text-indigo-500" />
          <h3 className="font-semibold">Executive Briefing</h3>

          <span className={`px-2 py-0.5 text-xs rounded-full ${overallStyle.badge}`}>
            {decision?.posture === "on_track" && "On track"}
            {decision?.posture === "watch" && "Watch"}
            {decision?.posture === "action_required" && "Action required"}
            {!decision?.posture && "Neutral"}
          </span>
        </div>

        <button onClick={() => router.refresh()}>
          <RefreshCw className="h-4 w-4 text-gray-400" />
        </button>
      </div>

      <div className="p-6 space-y-5">

        {/* Health bar */}
        <div className="h-1 bg-gray-100 rounded-full">
          <div
            className="h-full rounded-full"
            style={{ width: barWidth, background: overallStyle.bar }}
          />
        </div>

        {/* Executive Summary (UPGRADED) */}
        {safeStr(data?.executive_summary) && (
          <div className={`rounded-xl border p-4 space-y-3 ${overallStyle.bg}`}>
            
            <p className={`text-sm font-semibold ${overallStyle.text}`}>
              {safeStr(data?.executive_summary)}
            </p>

            {decision?.confidence && (
              <div className="text-[10px] uppercase text-gray-400">
                AI tone: {decision.confidence}
              </div>
            )}

            {decision && (
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <div className="text-gray-400">Trend</div>
                  <div className="font-semibold">{decision.trend}</div>
                </div>
                <div>
                  <div className="text-gray-400">Confidence</div>
                  <div className="font-semibold">{decision.confidence}</div>
                </div>
                <div>
                  <div className="text-gray-400">Risk</div>
                  <div className="font-semibold">{decision.primary_risk}</div>
                </div>
              </div>
            )}

            {decision?.impact && (
              <div className="text-xs text-gray-600">
                <strong>Impact:</strong> {decision.impact}
              </div>
            )}

            {decision?.recommendation && (
              <div className="text-xs text-indigo-700 font-medium">
                Recommendation: {decision.recommendation}
              </div>
            )}
          </div>
        )}

        {/* Sections */}
        <div className="grid grid-cols-2 gap-3">
          {sections.map((s, i) => (
            <div key={i} className="p-3 border rounded-xl bg-gray-50">
              <div className="text-xs font-bold mb-1">{s.title}</div>
              <div className="text-xs text-gray-600">{s.body}</div>
            </div>
          ))}
        </div>

        {/* Talking Points */}
        {points.length > 0 && (
          <div className="p-4 bg-indigo-50 rounded-xl border">
            <div className="flex justify-between mb-2">
              <span className="text-xs font-bold">Board talking points</span>
              <button onClick={copy} className="text-xs">
                {copied ? "Copied" : "Copy"}
              </button>
            </div>

            <ul className="text-xs space-y-1">
              {points.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(ExecutiveBriefingCard);