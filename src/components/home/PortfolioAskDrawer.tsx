"use client";
// Ask Aliena drawer for the portfolio homepage.
// Calls /api/ai/portfolio-advisor with the user's question and renders
// a structured answer with priority actions and recommended routes.

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  X,
  Sparkles,
  Loader2,
  AlertCircle,
  ChevronRight,
  ExternalLink,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Flame,
} from "lucide-react";

/* ── Types ────────────────────────────────────────────────────────────── */

type AdvisorResult = {
  answer: string;
  priority_actions: Array<{
    priority: number;
    action: string;
    project?: string;
    why: string;
  }>;
  risk_summary: string;
  recommended_routes: Array<{ label: string; href: string }>;
  confidence: number;
};

/* ── Utils ────────────────────────────────────────────────────────────── */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function fmtPct(n: number) {
  return `${Math.round(Math.max(0, Math.min(1, n)) * 100)}%`;
}

/* ── Suggested questions — context-aware ─────────────────────────────── */

const DEFAULT_SUGGESTIONS = [
  "Which projects need my attention today and why?",
  "What is the biggest delivery risk across the portfolio right now?",
  "Where are approvals stuck and for how long?",
  "Which projects are trending from Green to Amber or Red?",
  "What is our financial exposure this quarter?",
  "Which PMs are overloaded or have the most overdue items?",
  "Give me a board-ready portfolio summary for today.",
  "What should I escalate this week?",
];

/* ── Component ────────────────────────────────────────────────────────── */

export default function PortfolioAskDrawer() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AdvisorResult | null>(null);
  const lastReq = useRef<number>(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canAsk = question.trim().length >= 4;

  // Escape to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Lock scroll when open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Focus textarea when opening
  useEffect(() => {
    if (open) setTimeout(() => textareaRef.current?.focus(), 150);
  }, [open]);

  const ask = useCallback(async (q?: string) => {
    const text = (q ?? question).trim();
    if (text.length < 4 || loading) return;

    const reqId = Date.now();
    lastReq.current = reqId;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/ai/portfolio-advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ question: text }),
      });

      const json = await res.json().catch(() => null);
      if (lastReq.current !== reqId) return;

      if (!res.ok || !json?.ok) {
        setError(safeStr(json?.error) || `Request failed (${res.status})`);
        setResult(null);
      } else {
        setResult(json as AdvisorResult);
        if (q) setQuestion(q);
      }
    } catch (e: any) {
      if (lastReq.current !== reqId) return;
      setError(safeStr(e?.message) || "Request failed");
      setResult(null);
    } finally {
      if (lastReq.current === reqId) setLoading(false);
    }
  }, [question, loading]);

  const clear = useCallback(() => {
    setQuestion("");
    setResult(null);
    setError(null);
    textareaRef.current?.focus();
  }, []);

  return (
    <>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative flex items-center gap-2 h-9 rounded-xl border border-purple-200 bg-purple-50 px-4 text-sm font-semibold text-purple-700 hover:bg-purple-100 hover:border-purple-300 transition-all"
        title="Ask Aliena — AI portfolio analysis"
      >
        <Sparkles className="h-4 w-4 text-purple-500" />
        Ask Aliena
        <span className="hidden sm:inline text-purple-400 font-normal text-xs">— AI analysis</span>
      </button>

      {/* Overlay */}
      <div
        className={[
          "fixed inset-0 z-[80] transition-opacity duration-200",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        ].join(" ")}
        aria-hidden={!open}
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
          onClick={() => setOpen(false)}
        />

        {/* Drawer */}
        <div className="absolute right-0 top-0 h-full w-full max-w-[580px] flex flex-col border-l border-gray-200 bg-white shadow-2xl">

          {/* Header */}
          <div className="shrink-0 border-b border-gray-100 bg-white px-6 py-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 mb-1">
                  <div className="h-8 w-8 rounded-xl bg-purple-100 flex items-center justify-center shrink-0">
                    <Sparkles className="h-4 w-4 text-purple-600" />
                  </div>
                  <div>
                    <div className="text-base font-bold text-gray-900">Ask Aliena</div>
                    <div className="text-xs text-gray-500">Live portfolio analysis · powered by AI</div>
                  </div>
                </div>

                {result && (
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-2.5 py-0.5 text-[11px] font-semibold text-purple-700">
                      <CheckCircle2 className="h-3 w-3" />
                      Confidence {fmtPct(result.confidence)}
                    </span>
                    {result.risk_summary && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">
                        <AlertTriangle className="h-3 w-3" />
                        {result.risk_summary}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="shrink-0 h-8 w-8 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Question input */}
            <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 overflow-hidden">
              <textarea
                ref={textareaRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && canAsk) {
                    e.preventDefault();
                    ask();
                  }
                }}
                rows={3}
                className="w-full resize-none px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 bg-transparent outline-none"
                placeholder="Ask anything about your portfolio..."
              />
              <div className="flex items-center justify-between border-t border-gray-200 px-4 py-2.5 bg-white">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={clear}
                    disabled={loading}
                    className="text-xs text-gray-400 hover:text-gray-600 font-medium transition-colors disabled:opacity-40"
                  >
                    Clear
                  </button>
                  <span className="text-gray-200">·</span>
                  <span className="text-xs text-gray-400">Shift+Enter for new line</span>
                </div>
                <button
                  type="button"
                  onClick={() => ask()}
                  disabled={!canAsk || loading}
                  className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-xs font-bold text-white hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {loading
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analysing...</>
                    : <><Sparkles className="h-3.5 w-3.5" /> Ask Aliena</>
                  }
                </button>
              </div>
            </div>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-red-800">Something went wrong</div>
                  <div className="mt-0.5 text-sm text-red-700">{error}</div>
                </div>
              </div>
            )}

            {loading && !result && (
              <div className="space-y-3 animate-pulse">
                <div className="h-4 bg-gray-100 rounded w-3/4" />
                <div className="h-4 bg-gray-100 rounded w-full" />
                <div className="h-4 bg-gray-100 rounded w-5/6" />
                <div className="h-4 bg-gray-100 rounded w-2/3" />
              </div>
            )}

            {result && !error && (
              <>
                <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="h-6 w-6 rounded-lg bg-purple-100 flex items-center justify-center shrink-0">
                      <Sparkles className="h-3.5 w-3.5 text-purple-600" />
                    </div>
                    <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">Answer</div>
                  </div>
                  <p className="text-sm text-gray-900 leading-relaxed whitespace-pre-wrap">{result.answer}</p>
                </div>

                {result.priority_actions?.length > 0 && (
                  <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <Flame className="h-4 w-4 text-amber-500 shrink-0" />
                      <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">Priority Actions</div>
                    </div>
                    <div className="space-y-3">
                      {result.priority_actions
                        .sort((a, b) => a.priority - b.priority)
                        .map((a, i) => (
                          <div key={i} className="flex items-start gap-3 rounded-lg bg-gray-50 border border-gray-100 p-3.5">
                            <div className="shrink-0 h-5 w-5 rounded-full bg-amber-100 border border-amber-200 flex items-center justify-center mt-0.5">
                              <span className="text-[10px] font-bold text-amber-700">{a.priority}</span>
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-semibold text-gray-900">
                                {a.action}
                                {a.project && (
                                  <span className="ml-2 text-xs font-medium text-gray-500 bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5">
                                    {a.project}
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 text-xs text-gray-500">{a.why}</div>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {result.recommended_routes?.length > 0 && (
                  <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Quick links</div>
                    <div className="flex flex-wrap gap-2">
                      {result.recommended_routes.map((r, i) => (
                        <Link
                          key={i}
                          href={safeStr(r.href)}
                          onClick={() => setOpen(false)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                          {safeStr(r.label)}
                          <ExternalLink className="h-3 w-3 text-gray-400" />
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {!result && !loading && !error && (
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Suggested questions</div>
                <div className="space-y-2">
                  {DEFAULT_SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => ask(s)}
                      className="w-full text-left rounded-xl border border-gray-100 bg-white px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 hover:border-gray-200 transition-all flex items-center justify-between gap-3 group"
                    >
                      <span>{s}</span>
                      <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-gray-500 shrink-0 transition-colors" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-gray-100 px-6 py-3 bg-gray-50">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-gray-400">
                Answers are grounded in live portfolio data. Always verify before escalating.
              </p>
              {result && (
                <button
                  type="button"
                  onClick={() => ask()}
                  disabled={loading || !canAsk}
                  className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 font-medium transition-colors disabled:opacity-40"
                >
                  <RefreshCw className="h-3 w-3" /> Refresh
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}