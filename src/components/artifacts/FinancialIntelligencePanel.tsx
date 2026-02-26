//src/components/artifact/FinancialIntelligencePanel.tsx
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  AlertTriangle, RefreshCw, ChevronDown, ChevronRight,
  Info, Sparkles, ArrowRight, AlertCircle,
} from "lucide-react";
import {
  analyseFinancialPlan,
  SEVERITY_STYLE,
  type Signal,
  type FinancialAIAnalysis,
  type AIDriver,
} from "@/lib/financial-intelligence";
import type { FinancialPlanContent } from "./FinancialPlanEditor";
import type { MonthlyData, FYConfig } from "./FinancialPlanMonthlyView";

// ── Types ─────────────────────────────────────────────────────────────────────

type Props = {
  content: FinancialPlanContent;
  monthlyData: MonthlyData;
  fyConfig: FYConfig;
  lastUpdatedAt?: string;
  raidItems?: Array<{ type: string; title: string; severity: string; status: string }>;
  approvalDelays?: Array<{ title: string; daysPending: number; cost_impact?: number }>;
  onSignalsChange?: (signals: Signal[]) => void;
  /** Pass true when navigating from Budget Health card (?panel=intelligence) */
  autoOpen?: boolean;
};

// ── RAG dot ───────────────────────────────────────────────────────────────────

function RagDot({ rag, size = "md" }: { rag: "red" | "amber" | "green"; size?: "sm" | "md" | "lg" }) {
  const sz = { sm: "w-2 h-2", md: "w-3 h-3", lg: "w-4 h-4" }[size];
  const col = {
    red:   "bg-red-500 shadow-red-300",
    amber: "bg-amber-400 shadow-amber-200",
    green: "bg-emerald-500 shadow-emerald-200",
  }[rag];
  return <span className={`inline-block rounded-full ${sz} ${col} shadow-md ring-2 ring-white`} />;
}

// ── Signal card ───────────────────────────────────────────────────────────────

function SignalCard({ signal }: { signal: Signal }) {
  const [expanded, setExpanded] = useState(false);
  const style = SEVERITY_STYLE[signal.severity];
  const Icon = signal.severity === "critical" ? AlertTriangle
    : signal.severity === "warning" ? AlertCircle : Info;
  return (
    <div className={`rounded-xl border ${style.bg} ${style.border} overflow-hidden`}>
      <button onClick={() => setExpanded(e => !e)} className="w-full flex items-start gap-3 px-4 py-3 text-left">
        <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${style.text}`} />
        <div className="flex-1 min-w-0">
          <span className={`text-sm font-semibold ${style.text}`}>{signal.title}</span>
          {!expanded && <p className={`text-xs mt-0.5 ${style.text} opacity-80 line-clamp-1`}>{signal.detail}</p>}
        </div>
        {expanded
          ? <ChevronDown className={`w-4 h-4 flex-shrink-0 ${style.text}`} />
          : <ChevronRight className={`w-4 h-4 flex-shrink-0 ${style.text}`} />}
      </button>
      {expanded && (
        <div className={`px-4 pb-3 pt-0 border-t ${style.border}`}>
          <p className={`text-xs ${style.text} leading-relaxed mt-2`}>{signal.detail}</p>
        </div>
      )}
    </div>
  );
}

// ── Skeletons ─────────────────────────────────────────────────────────────────

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className}`} />;
}

function AILoadingSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-3 w-full" />
      <div className="flex flex-col gap-2 mt-2">
        {[1, 2].map(i => (
          <div key={i} className="flex flex-col gap-1.5 p-3 bg-gray-50 rounded-lg">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Driver card ───────────────────────────────────────────────────────────────

function DriverCard({ d }: { d: AIDriver }) {
  const style = SEVERITY_STYLE[d.severity];
  const Icon = d.severity === "critical" ? AlertTriangle
    : d.severity === "warning" ? AlertCircle : Info;
  return (
    <div className={`rounded-xl border ${style.bg} ${style.border} p-4 flex flex-col gap-2`}>
      <div className="flex items-start gap-2">
        <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${style.text}`} />
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-bold ${style.text}`}>{d.title}</span>
            {d.quarter && (
              <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-white/60 text-gray-600">{d.quarter}</span>
            )}
          </div>
          <p className={`text-xs mt-1 ${style.text} leading-relaxed`}>{d.explanation}</p>
        </div>
      </div>
      {d.recommended_action && (
        <div className="flex items-start gap-2 pt-2 border-t border-current/10">
          <ArrowRight className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-gray-500" />
          <p className="text-xs text-gray-700 font-medium leading-relaxed">{d.recommended_action}</p>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FinancialIntelligencePanel({
  content, monthlyData, fyConfig, lastUpdatedAt,
  raidItems, approvalDelays, onSignalsChange, autoOpen = false,
}: Props) {
  const panelRef       = useRef<HTMLDivElement>(null);
  const [signals, setSignals]       = useState<Signal[]>([]);
  const [aiAnalysis, setAiAnalysis] = useState<FinancialAIAnalysis | null>(null);
  const [aiLoading, setAiLoading]   = useState(false);
  const [aiError, setAiError]       = useState<string | null>(null);
  const [activeTab, setActiveTab]   = useState<"signals" | "ai">("signals");

  // ── Compute signals whenever content changes ───────────────────────────────
  useEffect(() => {
    const sigs = analyseFinancialPlan(content, monthlyData, fyConfig, { lastUpdatedAt });
    setSignals(sigs);
    onSignalsChange?.(sigs);
  }, [content, monthlyData, fyConfig, lastUpdatedAt, onSignalsChange]);

  // ── Auto-open + scroll when autoOpen prop is set ─────────────────────────
  useEffect(() => {
    if (autoOpen) {
      setTimeout(() => {
        panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 300);
      triggerAI();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);

  const triggerAI = useCallback(async () => {
    setAiLoading(true);
    setAiError(null);
    setActiveTab("ai");
    try {
      const res = await fetch("/api/ai/financial-intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, monthlyData, fyConfig, lastUpdatedAt, raidItems, approvalDelays }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setAiAnalysis(data.analysis);
    } catch (e: any) {
      setAiError(e?.message ?? "AI analysis failed.");
    } finally {
      setAiLoading(false);
    }
  }, [content, monthlyData, fyConfig, lastUpdatedAt, raidItems, approvalDelays]);

  const criticals = signals.filter(s => s.severity === "critical");
  const warnings  = signals.filter(s => s.severity === "warning");
  const infos     = signals.filter(s => s.severity === "info");
  const planRag: "red" | "amber" | "green" =
    criticals.length > 0 ? "red" : warnings.length > 0 ? "amber" : "green";

  return (
    <div
      ref={panelRef}
      id="financial-intelligence-panel"
      className="flex flex-col rounded-2xl border border-gray-200 overflow-hidden shadow-sm bg-white"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 bg-gray-900">
        <div className="flex items-center gap-3">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-bold text-white tracking-wide">Financial Intelligence</span>
          <RagDot rag={planRag} size="sm" />
        </div>
        <button
          onClick={triggerAI}
          disabled={aiLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-gray-900 text-xs font-bold transition-colors disabled:opacity-50"
        >
          {aiLoading
            ? <RefreshCw className="w-3 h-3 animate-spin" />
            : <Sparkles className="w-3 h-3" />}
          {aiLoading ? "Analysing…" : "Explain"}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 bg-gray-50">
        {(["signals", "ai"] as const).map(id => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`px-5 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === id ? "border-amber-500 text-gray-900" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {id === "signals" ? `Signals (${signals.length})` : "AI Briefing"}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="p-4 overflow-y-auto max-h-[500px]">
        {activeTab === "signals" ? (
          <div className="flex flex-col gap-3">
            {signals.length === 0 && (
              <p className="text-center text-gray-400 py-8 text-sm">No signals detected — budget looks healthy.</p>
            )}
            {criticals.map(s => <SignalCard key={s.code + s.scopeKey} signal={s} />)}
            {warnings.map(s  => <SignalCard key={s.code + s.scopeKey} signal={s} />)}
            {infos.map(s     => <SignalCard key={s.code + s.scopeKey} signal={s} />)}
          </div>
        ) : (
          <div>
            {aiLoading && <AILoadingSkeleton />}
            {aiError && (
              <div className="text-red-500 text-sm p-4 bg-red-50 rounded-xl border border-red-200">
                {aiError}
              </div>
            )}
            {!aiLoading && !aiAnalysis && !aiError && (
              <div className="text-center py-8 text-gray-400 text-sm">
                <Sparkles className="w-6 h-6 mx-auto mb-2 opacity-40" />
                <p>Press <strong className="text-gray-600">Explain</strong> for an AI briefing on this financial plan</p>
              </div>
            )}
            {aiAnalysis && !aiLoading && (
              <div className="flex flex-col gap-4">
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <p className="text-sm font-bold text-gray-900">{aiAnalysis.headline}</p>
                  <p className="text-xs text-gray-600 mt-1 leading-relaxed">{aiAnalysis.narrative}</p>
                </div>
                {aiAnalysis.drivers.map((d, i) => <DriverCard key={i} d={d} />)}
                {aiAnalysis.pm_actions?.length > 0 && (
                  <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                    <p className="text-xs font-bold text-blue-800 uppercase tracking-wide mb-2">Recommended Actions</p>
                    <ul className="flex flex-col gap-1.5">
                      {aiAnalysis.pm_actions.map((a, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-blue-900">
                          <span className="mt-0.5 w-4 h-4 rounded-full bg-blue-200 text-blue-800 flex items-center justify-center text-[10px] font-bold flex-shrink-0">{i + 1}</span>
                          {a}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}