"use client";

import { useState, useCallback } from "react";
import {
  Milestone,
  ScheduleSignal,
  ScheduleIntelligenceResult,
  RAGStatus,
} from "@/lib/schedule-intelligence";

// --- Icons ---
const IconClock = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
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

// --- RAG badge ---
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

const SIGNAL_SEVERITY_STYLES = {
  critical: "bg-red-50 border-red-200 text-red-700",
  warning: "bg-amber-50 border-amber-200 text-amber-700",
  info: "bg-blue-50 border-blue-200 text-blue-700",
};

export function SignalBadge({ signal }: { signal: ScheduleSignal }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium border ${SIGNAL_SEVERITY_STYLES[signal.severity]}`} title={signal.detail}>
      <IconWarning />
      {signal.label}
    </span>
  );
}

const URGENCY_STYLES: Record<string, string> = {
  immediate: "bg-red-100 text-red-700",
  this_week: "bg-orange-100 text-orange-700",
  this_sprint: "bg-amber-100 text-amber-700",
  monitor: "bg-slate-100 text-slate-600",
};

const CONFIDENCE_STYLES: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-red-100 text-red-700",
};

interface Props {
  milestones: Milestone[];
  signals: ScheduleSignal[];
  projectName?: string;
  projectContext?: string;
  className?: string;
}

export default function ScheduleIntelligencePanel({ milestones, signals, projectName, projectContext, className = "" }: Props) {
  const [result, setResult] = useState<ScheduleIntelligenceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    criticalMilestones: true,
    forecast: true,
    actions: false,
    warnings: false,
  });

  const toggle = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const explain = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/schedule-intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ milestones, projectName, projectContext }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResult(data.result);
    } catch (e: any) {
      setError(e.message || "Failed to fetch intelligence");
    } finally {
      setLoading(false);
    }
  }, [milestones, projectName, projectContext]);

  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600"><IconClock /></div>
          <span className="text-sm font-semibold text-slate-800">Schedule Intelligence</span>
        </div>
        <button onClick={explain} disabled={loading} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors">
          {loading ? <IconSpinner /> : <IconClock />}
          {loading ? "Analysing..." : "Explain with AI"}
        </button>
      </div>

      {signals.length > 0 && (
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
          <div className="flex flex-wrap gap-1.5">{signals.map((s, i) => (<SignalBadge key={i} signal={s} />))}</div>
        </div>
      )}

      {result && !loading && (
        <div className="divide-y divide-slate-100">
          <div className="px-4 py-4">
            <div className="flex items-start gap-3">
              <RAGBadge status={result.rag} />
              <p className="text-sm font-medium text-slate-800">{result.headline}</p>
            </div>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">{result.narrative}</p>
          </div>

          <div>
            <button className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50" onClick={() => toggle("forecast")}>
              <span className="text-xs font-semibold text-slate-700 uppercase">Forecast</span>
              <IconChevron open={expanded.forecast} />
            </button>
            {expanded.forecast && (
              <div className="px-4 pb-3 grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-slate-50 p-2 text-center border border-slate-100">
                  <p className="text-[10px] uppercase text-slate-400">Slip</p>
                  <p className="text-sm font-bold text-red-600">+{result.scheduleForecast.overallSlipDays}d</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-2 text-center border border-slate-100">
                  <p className="text-[10px] uppercase text-slate-400">End Date</p>
                  <p className="text-[11px] font-semibold">{result.scheduleForecast.projectedCompletionDate}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-2 text-center border border-slate-100">
                  <p className="text-[10px] uppercase text-slate-400">Confidence</p>
                  <p className={`text-[10px] font-bold ${CONFIDENCE_STYLES[result.scheduleForecast.confidenceLevel]}`}>{result.scheduleForecast.confidenceLevel}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
