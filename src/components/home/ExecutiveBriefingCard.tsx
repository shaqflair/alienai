"use client";
// src/components/home/ExecutiveBriefingCard.tsx

import React, { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles, RefreshCw, ChevronRight, AlertTriangle, AlertCircle,
  Activity, Shield, Truck, DollarSign, Copy, Check, ClipboardList,
  TrendingUp, TrendingDown, Minus, Clock, Target, BarChart2,
  Lightbulb, AlertOctagon, ThumbsUp, CheckSquare,
} from "lucide-react";
import type { BriefingData } from "@/lib/server/home/loadExecutiveBriefing";

/* ─────────────────────────────────────────────────────────────────────────── */
/* Error boundary                                                               */
/* ─────────────────────────────────────────────────────────────────────────── */

class CardErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { crashed: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { crashed: false };
  }
  static getDerivedStateFromError() { return { crashed: true }; }
  componentDidCatch(err: unknown) { console.error("[ExecutiveBriefingCard]", err); }
  render() { return this.state.crashed ? null : this.props.children; }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Local types                                                                  */
/* ─────────────────────────────────────────────────────────────────────────── */

type Sentiment       = "green" | "amber" | "red" | "neutral";
type Trend           = "improving" | "deteriorating" | "stable";
type Confidence      = "high" | "medium" | "low";
type DecisionPosture = "act_now" | "monitor" | "hold" | "approve";

type Section = {
  id: string;
  title: string;
  body: string;
  sentiment: Sentiment;
  trend?: Trend;
  confidence?: Confidence;
  days_in_state?: number;
  next_step?: string;
  business_impact?: string;
  leadership_recommendation?: string;
  decision_posture?: DecisionPosture;
};

type PortfolioPosture = {
  posture: DecisionPosture;
  rationale: string;
  confidence?: Confidence;
};

type Gap = {
  severity: "high" | "medium" | "low";
  type: string;
  detail: string;
  project?: string;
  href?: string;
};

export type RagLiveCounts = { g: number; a: number; r: number };

/* ─────────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                      */
/* ─────────────────────────────────────────────────────────────────────────── */

function safeStr(x: unknown): string {
  if (typeof x === "string") return x;
  if (x == null) return "";
  return String(x);
}

function timeAgo(iso: string): string {
  try {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (!Number.isFinite(diff) || diff < 0) return "";
    if (diff < 60)    return "just now";
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  } catch { return ""; }
}

function overallSentiment(sections: Section[]): Sentiment {
  if (!sections.length) return "neutral";
  if (sections.some(s => s.sentiment === "red"))   return "red";
  if (sections.some(s => s.sentiment === "amber"))  return "amber";
  if (sections.every(s => s.sentiment === "green")) return "green";
  return "neutral";
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Design tokens                                                                */
/* ─────────────────────────────────────────────────────────────────────────── */

const SEN: Record<Sentiment, {
  bar: string; bg: string; border: string; text: string; badge: string; softBg: string;
}> = {
  green:   { bar:"#16a34a", bg:"bg-emerald-50", border:"border-emerald-200", text:"text-emerald-800", badge:"bg-emerald-100 text-emerald-800", softBg:"bg-emerald-50/60" },
  amber:   { bar:"#d97706", bg:"bg-amber-50",   border:"border-amber-200",   text:"text-amber-800",   badge:"bg-amber-100 text-amber-800",     softBg:"bg-amber-50/60"   },
  red:     { bar:"#dc2626", bg:"bg-red-50",     border:"border-red-200",     text:"text-red-900",     badge:"bg-red-100 text-red-800",         softBg:"bg-red-50/60"     },
  neutral: { bar:"#6b7280", bg:"bg-slate-50",   border:"border-slate-200",   text:"text-slate-700",   badge:"bg-slate-100 text-slate-600",     softBg:"bg-slate-50/60"   },
};

const GAP_ST: Record<string, { dot: string; text: string; bg: string }> = {
  high:   { dot:"bg-red-500",   text:"text-red-700",   bg:"bg-red-50 border-red-100"     },
  medium: { dot:"bg-amber-500", text:"text-amber-700", bg:"bg-amber-50 border-amber-100" },
  low:    { dot:"bg-sky-400",   text:"text-sky-700",   bg:"bg-sky-50 border-sky-100"     },
};

const POSTURE: Record<DecisionPosture, {
  label: string; bg: string; text: string; border: string; iconBg: string;
}> = {
  act_now: { label:"Act Now",         bg:"bg-red-600",    text:"text-white", border:"border-red-700",    iconBg:"bg-red-700"    },
  monitor: { label:"Monitor Closely", bg:"bg-amber-500",  text:"text-white", border:"border-amber-600",  iconBg:"bg-amber-600"  },
  hold:    { label:"Hold Position",   bg:"bg-slate-600",  text:"text-white", border:"border-slate-700",  iconBg:"bg-slate-700"  },
  approve: { label:"Approval Needed", bg:"bg-indigo-600", text:"text-white", border:"border-indigo-700", iconBg:"bg-indigo-700" },
};

const TREND_CFG: Record<Trend, { icon: React.ReactNode; label: string; color: string }> = {
  improving:     { icon:<TrendingUp   className="h-3.5 w-3.5"/>, label:"Improving",     color:"text-emerald-600" },
  deteriorating: { icon:<TrendingDown className="h-3.5 w-3.5"/>, label:"Deteriorating", color:"text-red-600"     },
  stable:        { icon:<Minus        className="h-3.5 w-3.5"/>, label:"Stable",        color:"text-slate-400"   },
};

const CONF: Record<Confidence, { dots: number; color: string; label: string }> = {
  high:   { dots:3, color:"bg-emerald-500", label:"High confidence"   },
  medium: { dots:2, color:"bg-amber-400",   label:"Medium confidence" },
  low:    { dots:1, color:"bg-red-400",     label:"Low confidence"    },
};

/* ─────────────────────────────────────────────────────────────────────────── */
/* Atoms                                                                        */
/* ─────────────────────────────────────────────────────────────────────────── */

const ConfidenceDots = ({ confidence }: { confidence?: Confidence }) => {
  if (!confidence) return null;
  const c = CONF[confidence];
  return (
    <span className="flex items-center gap-0.5" title={c.label}>
      {[1,2,3].map(n => (
        <span key={n} className={`h-1.5 w-1.5 rounded-full ${n <= c.dots ? c.color : "bg-gray-200"}`} />
      ))}
    </span>
  );
};

const SectionIcon = ({ id }: { id: string }) => {
  if (id === "health")   return <Activity      className="h-4 w-4"/>;
  if (id === "risk")     return <AlertTriangle className="h-4 w-4"/>;
  if (id === "delivery") return <Truck         className="h-4 w-4"/>;
  if (id === "finance")  return <DollarSign    className="h-4 w-4"/>;
  return null;
};

/* ─────────────────────────────────────────────────────────────────────────── */
/* Posture Banner                                                               */
/* ─────────────────────────────────────────────────────────────────────────── */

const PostureBanner = ({ posture }: { posture: PortfolioPosture }) => {
  const cfg = POSTURE[posture.posture];

  const PostureIcon = () => {
    if (posture.posture === "act_now") return <AlertOctagon className="h-5 w-5 text-white"/>;
    if (posture.posture === "monitor") return <BarChart2    className="h-5 w-5 text-white"/>;
    if (posture.posture === "approve") return <CheckSquare  className="h-5 w-5 text-white"/>;
    return <ThumbsUp className="h-5 w-5 text-white"/>;
  };

  return (
    <div
      className={`relative overflow-hidden rounded-xl border ${cfg.border} ${cfg.bg} px-5 py-4`}
      style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.12)" }}
    >
      <div className="absolute left-0 top-0 h-full w-1 rounded-l-xl bg-white/30"/>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
        <div className="flex shrink-0 items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${cfg.iconBg}`}>
            <PostureIcon/>
          </div>
          <div>
            <div className={`text-[10px] font-bold uppercase tracking-widest ${cfg.text} opacity-70`}>
              Executive posture
            </div>
            <div className={`text-lg font-black leading-tight ${cfg.text}`}>
              {cfg.label}
            </div>
          </div>
        </div>
        <div className="hidden h-10 w-px bg-white/30 sm:block"/>
        <div className="flex flex-1 flex-col gap-1">
          <p className={`text-sm font-semibold leading-snug ${cfg.text}`}>
            {safeStr(posture.rationale)}
          </p>
          {posture.confidence && (
            <div className={`flex items-center gap-1.5 text-[11px] font-semibold ${cfg.text} opacity-70`}>
              <ConfidenceDots confidence={posture.confidence}/>
              {CONF[posture.confidence].label}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────────────── */
/* Risk Narrative                                                               */
/* ─────────────────────────────────────────────────────────────────────────── */

const RiskNarrative = ({ text, overall }: { text: string; overall: Sentiment }) => {
  const st = SEN[overall];
  return (
    <div className={`rounded-xl border ${st.border} ${st.bg} px-4 py-3`}>
      <div className="mb-1.5 flex items-center gap-2">
        <AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${st.text}`}/>
        <span className={`text-[10px] font-black uppercase tracking-widest ${st.text}`}>Risk narrative</span>
      </div>
      <p className={`text-sm font-medium leading-relaxed ${st.text}`}>{text}</p>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────────────── */
/* Metric Pills                                                                 */
/* ─────────────────────────────────────────────────────────────────────────── */

const MetricPills = ({ projectCount, rag, avgHealth, overdueApprovals, highRaid }: {
  projectCount: number;
  rag?: { g: number; a: number; r: number } | null;
  avgHealth?: number | null;
  overdueApprovals?: number | null;
  highRaid?: number | null;
}) => {
  if (!rag && projectCount <= 0 && avgHealth == null && !overdueApprovals && !highRaid) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
        <Activity className="h-3 w-3 text-slate-400"/>{projectCount} projects
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
        {rag?.g ?? 0} Green
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
        {rag?.a ?? 0} Amber
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-bold text-red-700">
        {rag?.r ?? 0} Red
      </span>
      {avgHealth != null && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-500">
          Avg {avgHealth}% health
        </span>
      )}
      {(overdueApprovals ?? 0) > 0 && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-bold text-red-700">
          <AlertTriangle className="h-3 w-3"/>{overdueApprovals} overdue approvals
        </span>
      )}
      {(highRaid ?? 0) > 0 && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
          {highRaid} high RAID
        </span>
      )}
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────────────── */
/* Section Cards                                                                */
/* ─────────────────────────────────────────────────────────────────────────── */

const SectionsGrid = ({ sections }: { sections: Section[] }) => {
  if (!sections.length) return null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {sections.map((sec, i) => {
        const st       = SEN[sec.sentiment] ?? SEN.neutral;
        const trendCfg = sec.trend ? TREND_CFG[sec.trend] : null;
        const postCfg  = sec.decision_posture ? POSTURE[sec.decision_posture] : null;
        const days     = sec.days_in_state ?? 0;
        const longEsc  = days > 21 && sec.sentiment !== "green";
        const hasEsc   = days >  7 && sec.sentiment !== "green";

        return (
          <div
            key={sec.id ?? i}
            className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white"
            style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
          >
            {/* Colour stripe */}
            <div className="h-1 w-full" style={{ background: st.bar }}/>

            <div className="flex flex-1 flex-col gap-3 p-4">
              {/* Header */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`shrink-0 ${st.text}`}><SectionIcon id={sec.id}/></span>
                <span className="text-xs font-black uppercase tracking-wider text-slate-700">
                  {safeStr(sec.title)}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${st.badge}`}>
                  {sec.sentiment.charAt(0).toUpperCase() + sec.sentiment.slice(1)}
                </span>
                {postCfg && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${postCfg.bg} ${postCfg.text}`}>
                    {postCfg.label}
                  </span>
                )}
              </div>

              {/* Trend · Confidence · Escalation */}
              {(trendCfg || sec.confidence || days > 0) && (
                <div className="flex flex-wrap items-center gap-3">
                  {trendCfg && (
                    <span className={`flex items-center gap-1 text-[11px] font-semibold ${trendCfg.color}`}>
                      {trendCfg.icon}{trendCfg.label}
                    </span>
                  )}
                  {sec.confidence && (
                    <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
                      <ConfidenceDots confidence={sec.confidence}/>
                      {CONF[sec.confidence].label}
                    </span>
                  )}
                  {days > 0 && sec.sentiment !== "green" && (
                    <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      longEsc ? "bg-red-100 text-red-700" :
                      hasEsc  ? "bg-amber-100 text-amber-700" :
                                "bg-slate-100 text-slate-500"
                    }`}>
                      <Clock className="h-2.5 w-2.5"/>{days}d in {sec.sentiment}
                    </span>
                  )}
                </div>
              )}

              {/* Body */}
              <p className="text-xs leading-relaxed text-slate-600">{safeStr(sec.body)}</p>

              {/* Business impact */}
              {sec.business_impact && (
                <div className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <BarChart2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400"/>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Business impact</div>
                    <div className="text-xs font-semibold text-slate-700">{safeStr(sec.business_impact)}</div>
                  </div>
                </div>
              )}

              {/* Leadership recommendation */}
              {sec.leadership_recommendation && (
                <div className={`flex items-start gap-2 rounded-lg border ${st.border} ${st.softBg} px-3 py-2`}>
                  <Lightbulb className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${st.text}`}/>
                  <div>
                    <div className={`text-[10px] font-bold uppercase tracking-wider ${st.text} opacity-70`}>Leadership recommendation</div>
                    <div className={`text-xs font-semibold ${st.text}`}>{safeStr(sec.leadership_recommendation)}</div>
                  </div>
                </div>
              )}

              {/* Next step */}
              {sec.next_step && (
                <div className="mt-auto flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2">
                  <Target className="h-3.5 w-3.5 shrink-0 text-indigo-500"/>
                  <span className="text-[11px] font-bold text-indigo-700">Next: {safeStr(sec.next_step)}</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────────────── */
/* Governance Gaps                                                              */
/* ─────────────────────────────────────────────────────────────────────────── */

const GapsPanel = ({ gaps, showGaps, onToggle, onNavigate }: {
  gaps: Gap[]; showGaps: boolean; onToggle: () => void; onNavigate: (href: string) => void;
}) => {
  if (!gaps.length) return null;
  const highG  = gaps.filter(g => g?.severity === "high");
  const otherG = gaps.filter(g => g?.severity !== "high");
  return (
    <div>
      <button type="button" onClick={onToggle}
        className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-100"
      >
        <div className="flex items-center gap-2.5">
          <Shield className="h-4 w-4 shrink-0 text-slate-500"/>
          <span className="text-sm font-bold text-slate-800">Governance gaps</span>
          {highG.length > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
              {highG.length}
            </span>
          )}
          {otherG.length > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-300 px-1.5 text-[10px] font-bold text-slate-700">
              {otherG.length}
            </span>
          )}
        </div>
        <ChevronRight className={`h-4 w-4 text-slate-400 transition-transform duration-200${showGaps ? " rotate-90" : ""}`}/>
      </button>
      {showGaps && (
        <div className="mt-2 space-y-1.5">
          {gaps.map((g, i) => {
            const gs = GAP_ST[g?.severity] ?? GAP_ST.medium;
            return (
              <div key={i} className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${gs.bg}`}>
                <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${gs.dot}`}/>
                <div className="min-w-0 flex-1">
                  {g?.project && (
                    <div className="mb-0.5 text-[10px] font-black uppercase tracking-wider text-slate-400">
                      {safeStr(g.project)}
                    </div>
                  )}
                  <div className={`text-xs font-semibold ${gs.text}`}>{safeStr(g?.detail)}</div>
                </div>
                {g?.href && (
                  <button type="button" onClick={() => onNavigate(g.href!)}
                    className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-slate-400 hover:text-slate-700"
                  >
                    Fix <ChevronRight className="h-3 w-3"/>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────────────── */
/* Talking Points                                                               */
/* ─────────────────────────────────────────────────────────────────────────── */

const TalkingPoints = ({ points, copied, onCopy }: {
  points: string[]; copied: boolean; onCopy: () => void;
}) => {
  if (!points.length) return null;
  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 shrink-0 text-indigo-500"/>
          <span className="text-xs font-black uppercase tracking-wider text-indigo-700">Board talking points</span>
        </div>
        <button type="button" onClick={onCopy}
          className="flex items-center gap-1 text-xs font-semibold text-indigo-400 hover:text-indigo-700"
        >
          {copied ? <><Check className="h-3 w-3"/><span>Copied</span></> : <><Copy className="h-3 w-3"/><span>Copy all</span></>}
        </button>
      </div>
      <ol className="space-y-2">
        {points.map((tp, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-indigo-200 bg-indigo-100 text-[10px] font-black text-indigo-600">
              {i + 1}
            </span>
            <span className="text-xs leading-relaxed text-slate-700">{safeStr(tp)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────────────── */
/* Main inner component                                                         */
/* ─────────────────────────────────────────────────────────────────────────── */

function BriefingInner({
  data, liveRagCounts,
}: {
  data?: (BriefingData & {
    portfolio_posture?: PortfolioPosture | null;
    risk_narrative?: string | null;
    sections?: Section[];
  }) | null;
  liveRagCounts?: RagLiveCounts;
}) {
  const router = useRouter();
  const [copied,    setCopied]    = useState(false);
  const [showGaps,  setShowGaps]  = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const copyTimer = useRef<number | null>(null);

  const loading  = !data;
  const fetchErr = data && !data.ok ? safeStr(data.error) || "Failed to load briefing" : null;

  const sections = useMemo<Section[]>(
    () => Array.isArray(data?.sections) ? (data!.sections as Section[]) : [],
    [data?.sections],
  );
  const gaps = useMemo<Gap[]>(
    () => Array.isArray(data?.gaps) ? (data!.gaps as Gap[]) : [],
    [data?.gaps],
  );
  const points = useMemo<string[]>(
    () => Array.isArray(data?.talking_points) ? data!.talking_points.map(safeStr) : [],
    [data?.talking_points],
  );

  const sig              = data?.signals_summary ?? null;
  const portfolioPosture = data?.portfolio_posture ?? null;
  const riskNarrative    = safeStr(data?.risk_narrative ?? "");

  const displayRag = useMemo(() => {
    if (liveRagCounts && data?.ok) return liveRagCounts;
    return sig?.rag ?? null;
  }, [liveRagCounts, data?.ok, sig]);

  const overall   = useMemo(() => overallSentiment(sections), [sections]);
  const overallSt = SEN[overall];

  const headerBadge    = portfolioPosture ? POSTURE[portfolioPosture.posture].label
    : overall === "red" ? "Action required" : overall === "amber" ? "Monitor closely"
    : overall === "green" ? "On track" : "Neutral";
  const headerBadgeCls = portfolioPosture
    ? `${POSTURE[portfolioPosture.posture].bg} ${POSTURE[portfolioPosture.posture].text}`
    : overallSt.badge;

  const onRefresh         = useCallback(() => router.refresh(), [router]);
  const onToggleCollapsed = useCallback(() => setCollapsed(v => !v), []);
  const onToggleGaps      = useCallback(() => setShowGaps(v => !v), []);
  const onNavigate        = useCallback((href: string) => { try { router.push(href); } catch {} }, [router]);

  const copy = useCallback(() => {
    if (!points.length || !navigator?.clipboard?.writeText) return;
    navigator.clipboard
      .writeText(points.map((t, i) => `${i + 1}. ${t}`).join("\n"))
      .then(() => {
        setCopied(true);
        if (copyTimer.current) window.clearTimeout(copyTimer.current);
        copyTimer.current = window.setTimeout(() => { setCopied(false); copyTimer.current = null; }, 2000);
      })
      .catch(() => {});
  }, [points]);

  return (
    <div
      className="overflow-hidden rounded-2xl border border-slate-100 bg-white"
      style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-100">
            <Sparkles className="h-4 w-4 text-indigo-600"/>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-black text-slate-900" style={{ letterSpacing: "-0.01em" }}>
                Executive Briefing
              </h3>
              {data?.ok && !loading && (
                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide ${headerBadgeCls}`}>
                  {headerBadge}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              AI-generated portfolio narrative ·{" "}
              {data?.generated_at ? `Updated ${timeAgo(data.generated_at)}` : loading ? "Loading…" : "Ready"}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {points.length > 0 && (
            <button type="button" onClick={copy}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              {copied
                ? <><Check className="h-3.5 w-3.5 text-emerald-500"/><span>Copied</span></>
                : <><Copy  className="h-3.5 w-3.5"/><span>Copy points</span></>}
            </button>
          )}
          <button type="button" onClick={onRefresh} aria-label="Refresh"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5"/>
          </button>
          <button type="button" onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand briefing" : "Collapse briefing"}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
          >
            <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-200${collapsed ? "" : " rotate-90"}`}/>
          </button>
        </div>
      </div>

      {!collapsed && (
        <div>
          {/* Skeleton */}
          {loading && (
            <div className="animate-pulse space-y-4 p-6">
              <div className="h-16 w-full rounded-xl bg-slate-100"/>
              <div className="h-4 w-3/4 rounded bg-slate-100"/>
              <div className="h-4 w-full rounded bg-slate-100"/>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {[0,1,2,3].map(n => <div key={n} className="h-40 rounded-xl bg-slate-50"/>)}
              </div>
            </div>
          )}

          {/* Error */}
          {fetchErr && !loading && (
            <div className="p-6">
              <div className="flex items-start gap-3 rounded-xl border border-red-100 bg-red-50 p-4">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500"/>
                <div>
                  <div className="text-sm font-bold text-red-800">Briefing unavailable</div>
                  <div className="mt-0.5 text-xs text-red-700">{fetchErr}</div>
                  <button type="button" onClick={onRefresh}
                    className="mt-2 text-xs font-semibold text-red-600 underline hover:text-red-800"
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
              {portfolioPosture && <PostureBanner posture={portfolioPosture}/>}

              <div className="h-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: overall === "green" ? "90%" : overall === "amber" ? "60%" : overall === "red" ? "30%" : "50%",
                    background: overallSt.bar,
                  }}
                />
              </div>

              {safeStr(data.executive_summary) && (
                <div className={`rounded-xl border px-4 py-3 ${overallSt.border} ${overallSt.bg}`}>
                  <p className={`text-sm font-semibold leading-relaxed ${overallSt.text}`}>
                    {safeStr(data.executive_summary)}
                  </p>
                </div>
              )}

              {riskNarrative && <RiskNarrative text={riskNarrative} overall={overall}/>}

              <MetricPills
                projectCount={sig?.project_count ?? 0}
                rag={displayRag}
                avgHealth={sig?.avg_health ?? null}
                overdueApprovals={sig?.overdue_approvals ?? 0}
                highRaid={sig?.high_raid ?? 0}
              />

              <SectionsGrid sections={sections}/>

              <GapsPanel gaps={gaps} showGaps={showGaps} onToggle={onToggleGaps} onNavigate={onNavigate}/>

              <TalkingPoints points={points} copied={copied} onCopy={copy}/>

              <div className="flex items-center justify-between border-t border-slate-50 pt-3">
                <p className="text-[11px] text-slate-400">
                  {data.generated_at ? `Generated ${new Date(data.generated_at).toLocaleString()}` : ""}
                  {" · AI-assisted — verify before presenting"}
                </p>
                <button type="button" onClick={onRefresh}
                  className="flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-slate-600"
                >
                  <RefreshCw className="h-3 w-3"/><span>Refresh</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Export                                                                       */
/* ─────────────────────────────────────────────────────────────────────────── */

function ExecutiveBriefingCard({
  data, liveRagCounts,
}: {
  data?: BriefingData | null;
  liveRagCounts?: RagLiveCounts;
}) {
  return (
    <CardErrorBoundary>
      <BriefingInner data={data as any} liveRagCounts={liveRagCounts}/>
    </CardErrorBoundary>
  );
}

export default React.memo(ExecutiveBriefingCard);