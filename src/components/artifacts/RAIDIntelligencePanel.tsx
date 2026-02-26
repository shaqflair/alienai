"use client";

import { useState, useCallback } from "react";
import {
  RAIDItem,
  RAIDSignal,
  RAIDIntelligenceResult,
  RAGStatus,
} from "@/lib/raid-intelligence";

// ─── Icons (inline SVG to avoid icon-lib dependency) ───────────────────────

const IconBrain = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.347.416A7.5 7.5 0 0112 19.5a7.5 7.5 0 01-4.09-1.184l-.347-.416z" />
  </svg>
);

const IconSpinner = () => (
  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

const IconChevron = ({ open }: { open: boolean }) => (
  <svg className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
  </svg>
);

const IconWarning = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
  </svg>
);

const IconCheck = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

const IconAlert = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
  </svg>
);

// ─── RAG badge ──────────────────────────────────────────────────────────────

const RAG_CONFIG: Record<RAGStatus, { bg: string; text: string; label: string }> = {
  green: { bg: "bg-emerald-100 border-emerald-300", text: "text-emerald-800", label: "On Track" },
  amber: { bg: "bg-amber-100 border-amber-300", text: "text-amber-800", label: "At Risk" },
  red: { bg: "bg-red-100 border-red-300", text: "text-red-800", label: "Critical" },
};

function RAGBadge({ status }: { status: RAGStatus }) {
  const c = RAG_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${c.bg} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === "green" ? "bg-emerald-500" : status === "amber" ? "bg-amber-500" : "bg-red-500"}`} />
      {c.label}
    </span>
  );
}

// ─── Signal badge ────────────────────────────────────────────────────────────

const SIGNAL_SEVERITY_STYLES = {
  critical: "bg-red-50 border-red-200 text-red-700",
  warning: "bg-amber-50 border-amber-200 text-amber-700",
  info: "bg-blue-50 border-blue-200 text-blue-700",
};

export function SignalBadge({ signal }: { signal: RAIDSignal }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium border ${SIGNAL_SEVERITY_STYLES[signal.severity]}`}
      title={signal.detail}
    >
      {signal.severity === "critical" ? <IconAlert /> : <IconWarning />}
      {signal.label}
    </span>
  );
}

// ─── Urgency pill ────────────────────────────────────────────────────────────

const URGENCY_STYLES: Record<string, string> = {
  immediate: "bg-red-100 text-red-700",
  this_week: "bg-orange-100 text-orange-700",
  this_sprint: "bg-amber-100 text-amber-700",
  monitor: "bg-slate-100 text-slate-600",
};

const URGENCY_LABELS: Record<string, string> = {
  immediate: "Immediate",
  this_week: "This week",
  this_sprint: "This sprint",
  monitor: "Monitor",
};

// ─── Main component ──────────────────────────────────────────────────────────

interface Props {
  items: RAIDItem[];
  signals: RAIDSignal[];
  projectName?: string;
  projectContext?: string;
  className?: string;
}

export default function RAIDIntelligencePanel({
  items,
  signals,
  projectName,
  projectContext,
  className = "",
}: Props) {
  const [result, setResult] = useState<RAIDIntelligenceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    topRisks: true,
    escalations: true,
    actions: false,
    warnings: false,
  });

  const toggle = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const explain = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/raid-intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, projectName, projectContext }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResult(data.result);
    } catch (e: any) {
      setError(e.message || "Failed to fetch intelligence");
    } finally {
      setLoading(false);
    }
  }, [items, projectName, projectContext]);

  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center text-violet-600">
            <IconBrain />
          </div>
          <span className="text-sm font-semibold text-slate-800">RAID Intelligence</span>
          {result?.fallback && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
              Rule-based
            </span>
          )}
        </div>
        <button
          onClick={explain}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? <IconSpinner /> : <IconBrain />}
          {loading ? "Analysing…" : result ? "Re-analyse" : "Explain with AI"}
        </button>
      </div>

      {/* Signals summary (always visible) */}
      {signals.length > 0 && (
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
          <p className="text-xs font-medium text-slate-500 mb-2">Active Signals</p>
          <div className="flex flex-wrap gap-1.5">
            {signals.map((s, i) => (
              <SignalBadge key={i} signal={s} />
            ))}
          </div>
        </div>
      )}

      {/* Empty / error state */}
      {!result && !loading && (
        <div className="px-4 py-8 text-center">
          {error ? (
            <p className="text-sm text-red-500">{error}</p>
          ) : (
            <p className="text-sm text-slate-400">
              {signals.length > 0
                ? `${signals.length} signal${signals.length > 1 ? "s" : ""} detected — click "Explain with AI" for full analysis`
                : "Click \"Explain with AI\" for an AI-generated RAID assessment"}
            </p>
          )}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="px-4 py-6 space-y-3 animate-pulse">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-3 bg-slate-100 rounded w-full" style={{ width: `${90 - n * 10}%` }} />
          ))}
        </div>
      )}

      {/* Result panel */}
      {result && !loading && (
        <div className="divide-y divide-slate-100">
          {/* Headline + RAG */}
          <div className="px-4 py-4">
            <div className="flex items-start gap-3">
              <RAGBadge status={result.rag} />
              <p className="text-sm font-medium text-slate-800 leading-snug">{result.headline}</p>
            </div>
            {result.narrative && (
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">{result.narrative}</p>
            )}
          </div>

          {/* Top risks */}
          {result.topRisks?.length > 0 && (
            <div>
              <button
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                onClick={() => toggle("topRisks")}
              >
                <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                  Top Risks ({result.topRisks.length})
                </span>
                <IconChevron open={expanded.topRisks} />
              </button>
              {expanded.topRisks && (
                <div className="px-4 pb-3 space-y-2">
                  {result.topRisks.map((r, i) => (
                    <div key={i} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono font-semibold text-slate-500">{r.ref}</span>
                        <span className="text-xs font-medium text-slate-800 truncate">{r.title}</span>
                        <span className={`ml-auto shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${URGENCY_STYLES[r.urgency]}`}>
                          {URGENCY_LABELS[r.urgency]}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed">{r.rationale}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Escalations */}
          {result.escalations?.length > 0 && (
            <div>
              <button
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                onClick={() => toggle("escalations")}
              >
                <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                  Escalations ({result.escalations.length})
                </span>
                <IconChevron open={expanded.escalations} />
              </button>
              {expanded.escalations && (
                <div className="px-4 pb-3 space-y-2">
                  {result.escalations.map((e, i) => (
                    <div key={i} className="flex gap-3 rounded-lg bg-red-50 border border-red-100 p-3">
                      <span className="shrink-0 mt-0.5 text-red-500"><IconAlert /></span>
                      <div>
                        <p className="text-xs font-semibold text-slate-800">
                          {e.ref} — {e.reason}
                        </p>
                        <p className="text-xs text-slate-600 mt-0.5">{e.recommendedAction}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* PM Actions */}
          {result.pmActions?.length > 0 && (
            <div>
              <button
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                onClick={() => toggle("actions")}
              >
                <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                  PM Actions ({result.pmActions.length})
                </span>
                <IconChevron open={expanded.actions} />
              </button>
              {expanded.actions && (
                <div className="px-4 pb-3 space-y-1.5">
                  {result.pmActions.map((a, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <span className="shrink-0 mt-0.5 text-emerald-500"><IconCheck /></span>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs text-slate-700">{a.action}</span>
                        <span className="ml-2 text-xs text-slate-400">{a.timeframe}</span>
                      </div>
                      <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                        a.priority === "high"
                          ? "bg-red-100 text-red-700"
                          : a.priority === "medium"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-slate-100 text-slate-500"
                      }`}>
                        {a.priority}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Early warnings */}
          {result.earlyWarnings?.length > 0 && (
            <div>
              <button
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                onClick={() => toggle("warnings")}
              >
                <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                  Early Warnings ({result.earlyWarnings.length})
                </span>
                <IconChevron open={expanded.warnings} />
              </button>
              {expanded.warnings && (
                <div className="px-4 pb-4 space-y-1.5">
                  {result.earlyWarnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 border border-amber-100">
                      <IconWarning />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
