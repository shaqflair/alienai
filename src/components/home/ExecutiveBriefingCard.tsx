"use client";
// src/components/home/ExecutiveBriefingCard.tsx
// No framer-motion dependency -- uses plain CSS transitions only.

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles, RefreshCw, ChevronRight, AlertTriangle,
  AlertCircle, Activity, Shield, Truck, DollarSign, Copy, Check,
  ClipboardList,
} from "lucide-react";

/* -- Types ---------------------------------------------------------------- */

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
    overdue_approvals?: number;
    high_raid?: number;
  };
  generated_at: string;
  error?: string;
};

/* -- Helpers -------------------------------------------------------------- */

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  return Math.floor(diff / 3600) + "h ago";
}

const SENTIMENT: Record<Sentiment, { bar: string; bg: string; border: string; text: string; badge: string }> = {
  green:   { bar: "#22c55e", bg: "bg-green-50",  border: "border-green-100",  text: "text-green-700",  badge: "bg-green-100 text-green-700"  },
  amber:   { bar: "#f59e0b", bg: "bg-amber-50",  border: "border-amber-100",  text: "text-amber-700",  badge: "bg-amber-100 text-amber-700"  },
  red:     { bar: "#ef4444", bg: "bg-red-50",    border: "border-red-100",    text: "text-red-700",    badge: "bg-red-100 text-red-700"      },
  neutral: { bar: "#6b7280", bg: "bg-gray-50",   border: "border-gray-100",   text: "text-gray-700",   badge: "bg-gray-100 text-gray-600"    },
};

const GAP_STYLE: Record<Gap["severity"], { dot: string; text: string; bg: string }> = {
  high:   { dot: "bg-red-500",   text: "text-red-700",   bg: "bg-red-50 border-red-100"     },
  medium: { dot: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50 border-amber-100" },
  low:    { dot: "bg-blue-400",  text: "text-blue-700",  bg: "bg-blue-50 border-blue-100"   },
};

function SectionIcon({ id }: { id: NarrativeSection["id"] }) {
  if (id === "health")   return <Activity className="h-4 w-4" />;
  if (id === "risk")     return <AlertTriangle className="h-4 w-4" />;
  if (id === "delivery") return <Truck className="h-4 w-4" />;
  if (id === "finance")  return <DollarSign className="h-4 w-4" />;
  return null;
}

function overallSentiment(sections: NarrativeSection[]): Sentiment {
  if (sections.some((s) => s.sentiment === "red"))    return "red";
  if (sections.some((s) => s.sentiment === "amber"))  return "amber";
  if (sections.every((s) => s.sentiment === "green")) return "green";
  return "neutral";
}

/* -- Component ------------------------------------------------------------ */

export default function ExecutiveBriefingCard() {
  const router = useRouter();
  const [data, setData]           = useState<BriefingData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [copied, setCopied]       = useState(false);
  const [showGaps, setShowGaps]   = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch("/api/ai/portfolio-narrative", { cache: "no-store" });
      const json = (await res.json().catch(() => ({ ok: false, error: "Bad response" }))) as BriefingData;
      if (!json?.ok) throw new Error(json?.error || "Request failed (" + res.status + ")");
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
    const text = data.talking_points.map((t, i) => (i + 1) + ". " + t).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [data]);

  const overall      = data ? overallSentiment(data.sections) : "neutral";
  const oStyle       = SENTIMENT[overall];
  const highGaps     = data?.gaps?.filter((g) => g.severity === "high")  ?? [];
  const otherGaps    = data?.gaps?.filter((g) => g.severity !== "high")  ?? [];
  const overallLabel = overall === "red" ? "Action required" : overall === "amber" ? "Monitor" : overall === "green" ? "On track" : "Neutral";
  const barWidth     = overall === "green" ? "90%" : overall === "amber" ? "60%" : overall === "red" ? "30%" : "50%";

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
                <span className={"text-[10px] font-bold px-2 py-0.5 rounded-full " + oStyle.badge}>
                  {overallLabel}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              AI-generated portfolio narrative &middot; {lastRefreshed ? "Updated " + timeAgo(lastRefreshed) : "Loading..."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {data?.talking_points?.length ? (
            <button type="button" onClick={copyTalkingPoints}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
              {copied ? <><Check className="h-3.5 w-3.5 text-green-500" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy points</>}
            </button>
          ) : null}
          <button type="button" onClick={load} disabled={loading}
            className="h-8 w-8 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-40 transition-colors">
            <RefreshCw className={"h-3.5 w-3.5" + (loading ? " animate-spin" : "")} />
          </button>
          <button type="button" onClick={() => setCollapsed((v) => !v)}
            className="h-8 w-8 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors">
            <ChevronRight className={"h-3.5 w-3.5 transition-transform duration-200" + (collapsed ? "" : " rotate-90")} />
          </button>
        </div>
      </div>

      {/* Body -- plain CSS show/hide, no framer-motion */}
      {!collapsed && (
        <div>
          {/* Loading skeleton */}
          {loading && !data && (
            <div className="p-6 space-y-4 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-3/4" />
              <div className="h-4 bg-gray-100 rounded w-full" />
              <div className="h-4 bg-gray-100 rounded w-5/6" />
              <div className="grid grid-cols-2 gap-3 mt-4">
                {[0,1,2,3].map((i) => <div key={i} className="h-24 bg-gray-50 rounded-xl" />)}
              </div>
            </div>
          )}

          {/* Error */}
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

          {/* Content */}
          {data && !error && (
            <div className="p-6 space-y-5">

              {/* Sentiment bar */}
              <div className="h-1 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: barWidth, background: oStyle.bar }} />
              </div>

              {/* Executive summary */}
              {data.executive_summary && (
                <div className={"rounded-xl border p-4 " + oStyle.bg + " " + oStyle.border}>
                  <p className={"text-sm font-medium leading-relaxed " + oStyle.text}>{data.executive_summary}</p>
                </div>
              )}

              {/* Signal pills */}
              {data.signals_summary && (
                <div className="flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700">
                    <Activity className="h-3 w-3 text-gray-400" />{data.signals_summary.project_count} projects
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">{data.signals_summary.rag.g} Green</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">{data.signals_summary.rag.a} Amber</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">{data.signals_summary.rag.r} Red</span>
                  {data.signals_summary.avg_health != null && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600">
                      Avg health {data.signals_summary.avg_health}%
                    </span>
                  )}
                  {(data.signals_summary.overdue_approvals ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
                      <AlertTriangle className="h-3 w-3" />{data.signals_summary.overdue_approvals} overdue approvals
                    </span>
                  )}
                  {(data.signals_summary.high_raid ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                      {data.signals_summary.high_raid} high-severity RAID
                    </span>
                  )}
                </div>
              )}

              {/* 4 narrative sections */}
              {data.sections?.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {data.sections.map((s) => {
                    const st = SENTIMENT[s.sentiment] ?? SENTIMENT.neutral;
                    return (
                      <div key={s.id} className={"rounded-xl border p-4 " + st.bg + " " + st.border}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={st.text}><SectionIcon id={s.id} /></span>
                          <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">{s.title}</span>
                          <span className={"ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full " + st.badge}>
                            {s.sentiment.charAt(0).toUpperCase() + s.sentiment.slice(1)}
                          </span>
                        </div>
                        <p className="text-xs text-gray-700 leading-relaxed">{s.body}</p>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Flagged gaps */}
              {data.gaps?.length > 0 && (
                <div>
                  <button type="button" onClick={() => setShowGaps((v) => !v)}
                    className="w-full flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left hover:bg-gray-100 transition-colors">
                    <div className="flex items-center gap-2.5">
                      <Shield className="h-4 w-4 text-gray-500 shrink-0" />
                      <span className="text-sm font-semibold text-gray-800">Governance gaps</span>
                      {highGaps.length > 0 && (
                        <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-red-500 text-[10px] font-bold text-white">
                          {highGaps.length}
                        </span>
                      )}
                      {otherGaps.length > 0 && (
                        <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-gray-300 text-[10px] font-bold text-gray-700">
                          {otherGaps.length}
                        </span>
                      )}
                    </div>
                    <ChevronRight className={"h-4 w-4 text-gray-400 transition-transform duration-200" + (showGaps ? " rotate-90" : "")} />
                  </button>

                  {showGaps && (
                    <div className="mt-2 space-y-1.5">
                      {data.gaps.map((g, i) => {
                        const gs = GAP_STYLE[g.severity];
                        return (
                          <div key={i} className={"flex items-start gap-3 rounded-xl border px-4 py-3 " + gs.bg}>
                            <div className={"h-2 w-2 rounded-full mt-1.5 shrink-0 " + gs.dot} />
                            <div className="min-w-0 flex-1">
                              {g.project && (
                                <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">{g.project}</div>
                              )}
                              <div className={"text-xs font-medium " + gs.text}>{g.detail}</div>
                            </div>
                            {g.href && (
                              <button type="button" onClick={() => router.push(g.href!)}
                                className="shrink-0 text-xs text-gray-400 hover:text-gray-700 font-medium flex items-center gap-0.5 transition-colors">
                                Fix <ChevronRight className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Board talking points */}
              {data.talking_points?.length > 0 && (
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <ClipboardList className="h-4 w-4 text-indigo-500 shrink-0" />
                      <span className="text-xs font-bold text-indigo-700 uppercase tracking-wider">Board talking points</span>
                    </div>
                    <button type="button" onClick={copyTalkingPoints}
                      className="text-xs text-indigo-500 hover:text-indigo-700 font-medium flex items-center gap-1 transition-colors">
                      {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy all</>}
                    </button>
                  </div>
                  <ol className="space-y-2">
                    {data.talking_points.map((tp, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <span className="h-5 w-5 rounded-full bg-indigo-100 border border-indigo-200 flex items-center justify-center text-[10px] font-bold text-indigo-600 shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <span className="text-xs text-gray-700 leading-relaxed">{tp}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between pt-1">
                <p className="text-[11px] text-gray-400">
                  {data.generated_at ? "Generated " + new Date(data.generated_at).toLocaleString() : ""}
                  {" \u00b7 AI-assisted -- verify before presenting"}
                </p>
                <button type="button" onClick={load} disabled={loading}
                  className="text-xs text-gray-400 hover:text-gray-600 font-medium flex items-center gap-1 transition-colors disabled:opacity-40">
                  <RefreshCw className={"h-3 w-3" + (loading ? " animate-spin" : "")} /> Refresh
                </button>
              </div>

            </div>
          )}
        </div>
      )}
    </div>
  );
}