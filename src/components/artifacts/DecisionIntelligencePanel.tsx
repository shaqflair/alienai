"use client";

// src/components/artifacts/DecisionIntelligencePanel.tsx
import { useState, useCallback } from "react";
import {
  Decision,
  DecisionSignal,
  DecisionIntelligenceResult,
  RAGStatus,
} from "@/lib/decision-intelligence";

// ─── Icons ────────────────────────────────────────────────────────────────────

const IconGavel = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
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

const IconAlert = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
  </svg>
);

const IconCheck = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

// ─── RAG badge ────────────────────────────────────────────────────────────────

const RAG_CONFIG: Record<RAGStatus, { bg: string; text: string; label: string }> = {
  green: { bg: "bg-emerald-100 border-emerald-300", text: "text-emerald-800", label: "On Track" },
  amber: { bg: "bg-amber-100 border-amber-300",     text: "text-amber-800",   label: "At Risk"  },
  red:   { bg: "bg-red-100 border-red-300",         text: "text-red-800",     label: "Critical" },
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

// ─── Signal badge (exported for DecisionEditor) ───────────────────────────────

const SIGNAL_SEVERITY_STYLES = {
  critical: "bg-red-50 border-red-200 text-red-700",
  warning:  "bg-amber-50 border-amber-200 text-amber-700",
  info:     "bg-blue-50 border-blue-200 text-blue-700",
};

export function SignalBadge({ signal }: { signal: DecisionSignal }) {
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

// ─── Rationale score bar ──────────────────────────────────────────────────────

export function RationaleScoreBar({ score }: { score: number }) {
  const color =
    score >= 4 ? "bg-emerald-500" :
    score >= 3 ? "bg-blue-500" :
    score >= 2 ? "bg-amber-500" : "bg-red-400";
  const label =
    score >= 4 ? "Strong" :
    score >= 3 ? "Adequate" :
    score >= 2 ? "Weak" : "Poor";
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <div
            key={n}
            className={`w-3 h-2 rounded-sm ${n <= score ? color : "bg-slate-100"}`}
          />
        ))}
      </div>
      <span className={`text-xs font-medium ${score >= 4 ? "text-emerald-600" : score >= 3 ? "text-blue-600" : score >= 2 ? "text-amber-600" : "text-red-500"}`}>
        {label}
      </span>
    </div>
  );
}

// ─── Urgency pill ─────────────────────────────────────────────────────────────

const URGENCY_STYLES: Record<string, string> = {
  immediate:   "bg-red-100 text-red-700",
  this_week:   "bg-orange-100 text-orange-700",
  this_sprint: "bg-amber-100 text-amber-700",
  monitor:     "bg-slate-100 text-slate-600",
};
const URGENCY_LABELS: Record<string, string> = {
  immediate:   "Immediate",
  this_week:   "This week",
  this_sprint: "This sprint",
  monitor:     "Monitor",
};

// ─── Main panel ───────────────────────────────────────────────────────────────

interface Props {
  decisions: Decision[];
  signals: DecisionSignal[];
  projectName?: string;
  projectContext?: string;
  className?: string;
}

export default function DecisionIntelligencePanel({
  decisions,
  signals,
  projectName,
  projectContext,
  className = "",
}: Props) {
  const [result, setResult] = useState<DecisionIntelligenceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    keyDecisions: true,
    pendingRisks: true,
    actions: false,
    warnings: false,
  });

  const toggle = (k: string) => setExpanded((p) => ({ ...p, [k]: !p[k] }));

  const explain = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/decision-intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions, projectName, projectContext }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResult(data.result);
    } catch (e: any) {
      setError(e.message || "Failed to fetch intelligence");
    } finally {
      setLoading(false);
    }
  }, [decisions, projectName, projectContext]);

  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-teal-100 flex items-center justify-center text-teal-600">
            <IconGavel />
          </div>
          <span className="text-sm font-semibold text-slate-800">Decision Intelligence</span>
          {result?.fallback && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">Rule-based</span>
          )}
        </div>
        <button
          onClick={explain}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? <IconSpinner /> : <IconGavel />}
          {loading ? "Analysing…" : result ? "Re-analyse" : "Explain with AI"}
        </button>
      </div>

      {/* Signals */}
      {signals.length > 0 && (
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
          <p className="text-xs font-medium text-slate-500 mb-2">Active Signals</p>
          <div className="flex flex-wrap gap-1.5">
            {signals.map((s, i) => <SignalBadge key={i} signal={s} />)}
          </div>
        </div>
      )}

      {/* Empty / error */}
      {!result && !loading && (
        <div className="px-4 py-8 text-center">
          {error
            ? <p className="text-sm text-red-500">{error}</p>
            : <p className="text-sm text-slate-400">
                {signals.length > 0
                  ? `${signals.length} signal${signals.length > 1 ? "s" : ""} detected — click "Explain with AI" for full analysis`
                  : `Click "Explain with AI" for an AI-generated decision assessment`}
              </p>
          }
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="px-4 py-6 space-y-3 animate-pulse">
          {[1, 2, 3].map((n) => <div key={n} className="h-3 bg-slate-100 rounded" style={{ width: `${90 - n * 10}%` }} />)}
        </div>
      )}

      {/* Result */}
      {result && !loading && (
        <div className="divide-y divide-slate-100">
          {/* Headline */}
          <div className="px-4 py-4">
            <div className="flex items-start gap-3">
              <RAGBadge status={result.rag} />
              <p className="text-sm font-medium text-slate-800 leading-snug">{result.headline}</p>
            </div>
            {result.narrative && (
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">{result.narrative}</p>
            )}
          </div>

          {/* Key decisions */}
          {result.keyDecisions?.length > 0 && (
            <div>
              <button className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors" onClick={() => toggle("keyDecisions")}>
                <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Key Decisions ({result.keyDecisions.length})</span>
                <IconChevron open={expanded.keyDecisions} />
              </button>
              {expanded.keyDecisions && (
                <div className="px-4 pb-3 space-y-2">
                  {result.keyDecisions.map((d, i) => (
                    <div key={i} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-mono font-semibold text-slate-500">{d.ref}</span>
                        <span className="text-xs font-medium text-slate-800 truncate flex-1">{d.title}</span>
                        <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${URGENCY_STYLES[d.urgency]}`}>
                          {URGENCY_LABELS[d.urgency]}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs text-slate-500">Rationale:</span>
                        <RationaleScoreBar score={d.rationaleScore} />
                      </div>
                      <p className="text-xs text-slate-500 mb-1">{d.rationaleAssessment}</p>
                      <p className="text-xs text-slate-600 font-medium">{d.impactAssessment}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Pending risks */}
          {result.pendingRisks?.length > 0 && (
            <div>
              <button className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors" onClick={() => toggle("pendingRisks")}>
                <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Pending Risks ({result.pendingRisks.length})</span>
                <IconChevron open={expanded.pendingRisks} />
              </button>
              {expanded.pendingRisks && (
                <div className="px-4 pb-3 space-y-2">
                  {result.pendingRisks.map((r, i) => (
                    <div key={i} className="flex gap-3 rounded-lg bg-amber-50 border border-amber-100 p-3">
                      <span className="shrink-0 mt-0.5 text-amber-500"><IconAlert /></span>
                      <div>
                        <p className="text-xs font-semibold text-slate-800">{r.ref} — {r.risk}</p>
                        <p className="text-xs text-slate-600 mt-0.5">{r.recommendation}</p>
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
              <button className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors" onClick={() => toggle("actions")}>
                <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">PM Actions ({result.pmActions.length})</span>
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
                      <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${a.priority === "high" ? "bg-red-100 text-red-700" : a.priority === "medium" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
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
              <button className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors" onClick={() => toggle("warnings")}>
                <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Early Warnings ({result.earlyWarnings.length})</span>
                <IconChevron open={expanded.warnings} />
              </button>
              {expanded.warnings && (
                <div className="px-4 pb-4 space-y-1.5">
                  {result.earlyWarnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 border border-amber-100">
                      <IconWarning /><span>{w}</span>
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
