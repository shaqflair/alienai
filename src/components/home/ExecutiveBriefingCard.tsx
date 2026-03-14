"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { m, AnimatePresence } from "framer-motion";
import {
  Sparkles, RefreshCw, ChevronRight, AlertTriangle, CheckCircle2,
  AlertCircle, Activity, Shield, Truck, DollarSign, X, Copy, Check,
  ClipboardList,
} from "lucide-react";

/* -- Types -------------------------------------------------------------- */

type Sentiment = "green" | "amber" | "red" | "neutral";

type NarrativeSection = {
  id: "health" | "risk" | "delivery" | "finance";
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

type BriefingData = {
  ok: boolean;
  executive_summary: string;
  sections: NarrativeSection[];
  talking_points: string[];
  gaps: Gap[];
  signals_summary: {
    project_count: number;
    rag: { g: number; a: number; r: number; unscored: number };
    avg_health: number | null;
    pending_approvals?: number;
    overdue_approvals?: number;
    open_raid?: number;
    high_raid?: number;
    milestones_due?: number;
    overdue_milestones?: number;
  };
  generated_at: string;
  error?: string;
};

/* -- Helpers ------------------------------------------------------------ */

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function sentimentColor(s: Sentiment) {
  return {
    green:   { bar: "#22c55e", bg: "bg-green-50",  border: "border-green-100", text: "text-green-700",  badge: "bg-green-100 text-green-700"  },
    amber:   { bar: "#f59e0b", bg: "bg-amber-50",  border: "border-amber-100", text: "text-amber-700",  badge: "bg-amber-100 text-amber-700"  },
    red:     { bar: "#ef4444", bg: "bg-red-50",    border: "border-red-100",   text: "text-red-700",    badge: "bg-red-100 text-red-700"      },
    neutral: { bar: "#6b7280", bg: "bg-gray-50",   border: "border-gray-100",  text: "text-gray-700",   badge: "bg-gray-100 text-gray-600"    },
  }[s];
}

function sectionIcon(id: NarrativeSection["id"]) {
  return {
    health:   <Activity className="h-4 w-4" />,
    risk:     <AlertTriangle className="h-4 w-4" />,
    delivery: <Truck className="h-4 w-4" />,
    finance:  <DollarSign className="h-4 w-4" />,
  }[id];
}

function gapSeverityStyle(s: Gap["severity"]) {
  return {
    high:   { dot: "bg-red-500",   text: "text-red-700",   bg: "bg-red-50 border-red-100"     },
    medium: { dot: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50 border-amber-100" },
    low:    { dot: "bg-blue-400",  text: "text-blue-700",  bg: "bg-blue-50 border-blue-100"   },
  }[s];
}

function overallSentiment(sections: NarrativeSection[]): Sentiment {
  if (sections.some((s) => s.sentiment === "red")) return "red";
  if (sections.some((s) => s.sentiment === "amber")) return "amber";
  if (sections.every((s) => s.sentiment === "green")) return "green";
  return "neutral";
}

export default function ExecutiveBriefingCard() {
  const router = useRouter();
  const [data, setData] = useState<BriefingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showGaps, setShowGaps] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/portfolio-narrative", { cache: "no-store" });
      const json: BriefingData = await res.json().catch(() => ({ ok: false, error: "Bad response" } as any));
      if (!json?.ok) throw new Error(json?.error || `Request failed (${res.status})`);
      setData(json);
      setLastRefreshed(new Date().toISOString());
    } catch (e: any) {
      setError(e?.message || "Failed to load briefing");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const copyTalkingPoints = useCallback(() => {
    if (!data?.talking_points?.length) return;
    const text = data.talking_points.map((t, i) => `${i + 1}. ${t}`).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [data]);

  if (!loading && !error && !data) return null;

  const overall = data ? overallSentiment(data.sections) : "neutral";
  const overallStyle = sentimentColor(overall);
  const highGaps = data?.gaps?.filter((g) => g.severity === "high") ?? [];
  const otherGaps = data?.gaps?.filter((g) => g.severity !== "high") ?? [];

  return (
    <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-50">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
            <Sparkles className="h-4 w-4 text-indigo-600" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-900">Executive Briefing</h3>
              {data && !loading && (
                <span className={["text-[10px] font-bold px-2 py-0.5 rounded-full", overallStyle.badge].join(" ")}>
                  {overall === "red" ? "Action required" : overall === "amber" ? "Monitor" : overall === "green" ? "On track" : "Neutral"}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              AI-generated portfolio narrative · {lastRefreshed ? `Updated ${timeAgo(lastRefreshed)}` : "Loading…"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {data?.talking_points?.length ? (
            <button
              type="button" onClick={copyTalkingPoints}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy points"}
            </button>
          ) : null}
          <button
            type="button" onClick={load} disabled={loading}
            className="h-8 w-8 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className={["h-3.5 w-3.5", loading ? "animate-spin" : ""].join(" ")} />
          </button>
          <button
            type="button" onClick={() => setCollapsed((v) => !v)}
            className="h-8 w-8 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors"
          >
            <ChevronRight className={["h-3.5 w-3.5 transition-transform duration-200", collapsed ? "" : "rotate-90"].join(" ")} />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <m.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: "hidden" }}
          >
            {loading && !data && (
              <div className="p-6 space-y-4 animate-pulse">
                <div className="h-4 bg-gray-100 rounded w-3/4" />
                <div className="h-4 bg-gray-100 rounded w-full" />
                <div className="grid grid-cols-2 gap-3 mt-4">
                  {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-gray-50 rounded-xl" />)}
                </div>
              </div>
            )}

            {error && !loading && (
              <div className="p-6">
                <div className="rounded-xl border border-red-100 bg-red-50 p-4 flex items-start gap-3">
                  <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-sm font-semibold text-red-800">Briefing unavailable</div>
                    <div className="text-xs text-red-700 mt-0.5">{error}</div>
                  </div>
                </div>
              </div>
            )}

            {data && !error && (
              <div className="p-6 space-y-5">
                <div className="h-1 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: overall === "green" ? "95%" : overall === "amber" ? "65%" : overall === "red" ? "35%" : "50%",
                      background: overallStyle.bar,
                    }} />
                </div>

                {data.executive_summary && (
                  <div className={["rounded-xl border p-4", overallStyle.bg, overallStyle.border].join(" ")}>
                    <p className={["text-sm font-medium leading-relaxed", overallStyle.text].join(" ")}>
                      {data.executive_summary}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {data.sections.map((s, i) => {
                    const style = sentimentColor(s.sentiment);
                    return (
                      <m.div key={s.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
                        className={["rounded-xl border p-4", style.bg, style.border].join(" ")}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={style.text}>{sectionIcon(s.id)}</span>
                          <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">{s.title}</span>
                          <span className={["ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full", style.badge].join(" ")}>
                            {s.sentiment.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-xs text-gray-700 leading-relaxed">{s.body}</p>
                      </m.div>
                    );
                  })}
                </div>

                {data.gaps?.length > 0 && (
                  <div>
                    <button type="button" onClick={() => setShowGaps(!showGaps)}
                      className="w-full flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left hover:bg-gray-100 transition-colors">
                      <div className="flex items-center gap-2.5">
                        <Shield className="h-4 w-4 text-gray-500 shrink-0" />
                        <span className="text-sm font-semibold text-gray-800">Governance gaps</span>
                        <span className="inline-flex items-center justify-center h-5 px-1.5 rounded-full bg-red-500 text-[10px] font-bold text-white">
                          {data.gaps.length}
                        </span>
                      </div>
                      <ChevronRight className={["h-4 w-4 text-gray-400 transition-transform", showGaps ? "rotate-90" : ""].join(" ")} />
                    </button>
                    {showGaps && (
                      <div className="mt-2 space-y-1.5">
                        {data.gaps.map((g, i) => {
                          const s = gapSeverityStyle(g.severity);
                          return (
                            <div key={i} className={["flex items-center justify-between rounded-xl border px-4 py-2", s.bg].join(" ")}>
                              <div className="flex items-center gap-3">
                                <div className={["h-2 w-2 rounded-full", s.dot].join(" ")} />
                                <span className={["text-xs font-medium", s.text].join(" ")}>{g.detail}</span>
                              </div>
                              {g.href && <button onClick={() => router.push(g.href!)} className="text-[10px] font-bold text-gray-400 hover:text-gray-600">FIX</button>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
