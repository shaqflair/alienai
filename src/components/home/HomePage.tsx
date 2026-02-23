// src/components/home/HomePage.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LazyMotion, domAnimation, m, AnimatePresence } from "framer-motion";
import {
  Bell,
  Sparkles,
  AlertTriangle,
  ShieldCheck,
  Clock3,
  Trophy,
  CheckCircle2,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Plus,
  CheckCheck,
  X,
  CircleDot,
  ChevronRight,
  Activity,
  Layers,
  Zap,
  TrendingUp,
  MoreHorizontal,
  Brain,
  Flame,
  Target,
  Eye,
  Shield,
} from "lucide-react";

type WindowDays = 7 | 14 | 30 | 60 | "all";

type NotifRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  artifact_id: string | null;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean | null;
  created_at: string;
  actor_user_id: string | null;
  metadata: any;
};
type NotifApiResp =
  | { ok: false; error: string }
  | { ok: true; unreadCount?: number; items: NotifRow[] };
type BellTab = "all" | "action" | "ai" | "approvals";
type DueItemType = "artifact" | "milestone" | "work_item" | "raid" | "change";
type DueDigestItem = {
  itemType: DueItemType;
  title: string;
  dueDate: string | null;
  status?: string | null;
  ownerLabel?: string | null;
  ownerEmail?: string | null;
  link?: string | null;
  meta?: any;
};
type ArtifactDueAi = {
  summary: string;
  windowDays: number;
  counts: {
    total: number;
    milestone: number;
    work_item: number;
    raid: number;
    artifact: number;
    change: number;
  };
  dueSoon: DueDigestItem[];
  recommendedMessage?: string;
};
type ArtifactDueResp =
  | { ok: false; error: string; meta?: any }
  | {
      ok: true;
      eventType: "artifact_due";
      scope?: "project" | "org";
      project_id?: string;
      project_human_id?: string | null;
      project_code?: string | null;
      project_name?: string | null;
      model?: string;
      ai: ArtifactDueAi;
      stats?: any;
    };

type Insight = {
  id: string;
  severity: "high" | "medium" | "info";
  title: string;
  body: string;
  href?: string | null;
};

type HomeData =
  | { ok: false; error: string }
  | {
      ok: true;
      user: { id: string; email?: string | null };
      isExec: boolean;
      roles: string[];
      projects: {
        id: string;
        title: string;
        client_name?: string | null;
        project_code?: any;
        status?: string | null;
        lifecycle_state?: string | null;
        state?: string | null;
        phase?: string | null;
        is_active?: boolean | null;
        active?: boolean | null;
        deleted_at?: string | null;
        deletedAt?: string | null;
        is_deleted?: boolean | null;
        deleted?: boolean | null;
        is_archived?: boolean | null;
        archived?: boolean | null;
        archived_at?: string | null;
        cancelled_at?: string | null;
        closed_at?: string | null;
      }[];
      kpis: {
        portfolioHealth: number;
        openRisks: number;
        highRisks: number;
        forecastVariance: number;
        milestonesDue: number;
        openLessons: number;
      };
      approvals: { count: number; items: any[] };
      rag: { project_id: string; title: string; rag: "G" | "A" | "R"; health: number }[];
    };

type MilestonesPanel = {
  days: number;
  due_count: number;
  overdue_count: number;
  on_track_count?: number;
  ai_high_risk_count?: number;
  status_breakdown?: {
    planned?: number;
    in_progress?: number;
    at_risk?: number;
    completed?: number;
    overdue?: number;
  };
  slippage?: { avg_slip_days?: number; max_slip_days?: number };
};

type RaidPanel = {
  days: number;
  due_total: number;
  overdue_total: number;
  risk_due?: number;
  issue_due?: number;
  dependency_due?: number;
  assumption_due?: number;
  risk_overdue?: number;
  issue_overdue?: number;
  dependency_overdue?: number;
  assumption_overdue?: number;
  risk_hi?: number;
  issue_hi?: number;
  dependency_hi?: number;
  assumption_hi?: number;
  overdue_hi?: number;
};

type SuccessStoryTop = {
  id: string;
  category?: string | null;
  title: string;
  summary: string;
  happened_at?: string | null;
  project_id?: string | null;
  project_title?: string | null;
  href?: string | null;
};

type SuccessStoriesBreakdown = {
  milestones_done?: number;
  wbs_done?: number;
  raid_resolved?: number;
  changes_delivered?: number;
  lessons_positive?: number;
};

type SuccessStoriesSummary =
  | { ok: false; error: string }
  | {
      ok: true;
      days: number;
      score: number;
      prev_score: number;
      delta: number;
      count: number;
      breakdown?: SuccessStoriesBreakdown;
      top?: SuccessStoryTop[];
      summary?: {
        score?: number;
        points?: number;
        breakdown?: SuccessStoriesBreakdown;
        top_wins?: SuccessStoryTop[];
      };
      meta?: any;
    };

type PortfolioHealthDriver = { key: string; label: string; score: number; detail?: string | null };
type PortfolioHealthApi =
  | { ok: false; error: string; meta?: any }
  | {
      ok: true;
      portfolio_health: number;
      days: 7 | 14 | 30 | 60 | "all";
      windowDays?: number;
      projectCount: number;
      parts: { schedule: number; raid: number; flow: number; approvals: number; activity: number };
      drivers: PortfolioHealthDriver[];
      schedule?: any;
      meta?: any;
    };

type RagLetter = "G" | "A" | "R";

function safeStr(x: any) {
  return typeof x === "string" ? x : "";
}
function num(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}
function clamp01to100(x: any) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
function timeAgo(iso: string) {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - t;
  if (!Number.isFinite(t) || diffMs < 0) return "just now";
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m2 = Math.floor(s / 60);
  if (m2 < 60) return `${m2}m ago`;
  const h = Math.floor(m2 / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function groupLabel(iso: string) {
  const h = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (h < 24) return "Today";
  if (h < 168) return "This week";
  return "Earlier";
}
function typeLooksApproval(t: string) {
  const s = t.toLowerCase();
  return s.includes("approval") || s.includes("approve") || s.includes("decision");
}
function typeLooksAI(t: string) {
  const s = t.toLowerCase();
  return s.includes("ai") || s.includes("warning") || s.includes("predict") || s.includes("slip");
}
function typeLooksAction(t: string) {
  const s = t.toLowerCase();
  return (
    typeLooksApproval(s) ||
    typeLooksAI(s) ||
    s.includes("overdue") ||
    s.includes("assigned") ||
    s.includes("risk") ||
    s.includes("issue") ||
    s.includes("milestone") ||
    s.includes("portfolio")
  );
}
function severityFromNotif(n: NotifRow): "high" | "medium" | "info" | "success" {
  const metaSev = safeStr(n?.metadata?.severity).toLowerCase();
  if (["high", "medium", "info", "success"].includes(metaSev)) return metaSev as any;
  const t = safeStr(n.type).toLowerCase();
  if (t.includes("success") || t.includes("completed") || t.includes("delivered")) return "success";
  if (t.includes("high") || t.includes("critical") || t.includes("breach")) return "high";
  if (
    t.includes("warning") ||
    t.includes("overdue") ||
    t.includes("at_risk") ||
    t.includes("risk") ||
    t.includes("issue")
  )
    return "medium";
  return "info";
}
function notifIcon(n: NotifRow) {
  const t = safeStr(n.type).toLowerCase();
  const sev = severityFromNotif(n);
  if (typeLooksApproval(t)) return <ShieldCheck className="h-4 w-4" />;
  if (typeLooksAI(t)) return <Sparkles className="h-4 w-4" />;
  if (t.includes("overdue")) return <Clock3 className="h-4 w-4" />;
  if (t.includes("success") || t.includes("trophy")) return <Trophy className="h-4 w-4" />;
  if (sev === "high") return <AlertTriangle className="h-4 w-4" />;
  return <CircleDot className="h-4 w-4" />;
}
function severityChip(sev: "high" | "medium" | "info" | "success") {
  const base =
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide";
  if (sev === "high") return `${base} text-rose-700 bg-rose-50 border-rose-200`;
  if (sev === "medium") return `${base} text-amber-700 bg-amber-50 border-amber-200`;
  if (sev === "success") return `${base} text-emerald-700 bg-emerald-50 border-emerald-200`;
  return `${base} text-indigo-700 bg-indigo-50 border-indigo-200`;
}
function tabMatch(tab: BellTab, n: NotifRow) {
  if (tab === "all") return true;
  if (tab === "approvals") return typeLooksApproval(n.type);
  if (tab === "ai") return typeLooksAI(n.type);
  if (tab === "action") return typeLooksAction(n.type);
  return true;
}
function runIdle(fn: () => void) {
  if (typeof window !== "undefined" && typeof (window as any).requestIdleCallback === "function")
    return (window as any).requestIdleCallback(fn, { timeout: 1200 });
  return window.setTimeout(fn, 0);
}
async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const r = await fetch(url, init);
    if (!r.ok) return null;
    return (await r.json().catch(() => null)) as T | null;
  } catch {
    return null;
  }
}
function scoreToRag(score: number): RagLetter {
  const s = clamp01to100(score);
  if (s >= 70) return "G";
  if (s >= 55) return "A";
  return "R";
}
function ragLabel(r: RagLetter) {
  return r === "G" ? "Green" : r === "A" ? "Amber" : "Red";
}
function ragBadgeClasses(r: RagLetter) {
  if (r === "G") return "border-emerald-300 bg-emerald-50 text-emerald-700";
  if (r === "A") return "border-amber-300 bg-amber-50 text-amber-700";
  return "border-rose-300 bg-rose-50 text-rose-700";
}
function ragStrokeColor(r: RagLetter) {
  if (r === "G") return "#10b981";
  if (r === "A") return "#f59e0b";
  return "#f43f5e";
}
function trendIcon(delta: number | null | undefined) {
  const d = Number(delta);
  if (!Number.isFinite(d) || d === 0) return <Minus className="h-4 w-4" />;
  return d > 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />;
}
function fmtDelta(delta: number | null | undefined, suffix = "pts") {
  const d = Number(delta);
  if (!Number.isFinite(d) || d === 0) return "No change";
  return `${d > 0 ? "+" : ""}${Math.round(d)} ${suffix}`;
}
function pickCategoryTone(cat?: string | null): "emerald" | "indigo" | "amber" | "rose" {
  const c = String(cat || "").toLowerCase();
  if (c.includes("milestone")) return "emerald";
  if (c.includes("raid") || c.includes("risk") || c.includes("issue") || c.includes("dependency")) return "amber";
  if (c.includes("change")) return "indigo";
  if (c.includes("lesson")) return "emerald";
  if (c.includes("wbs")) return "indigo";
  return "emerald";
}
function fixInsightHref(x: Insight, days?: WindowDays): string | undefined {
  const title = safeStr(x?.title).toLowerCase();
  const body = safeStr(x?.body).toLowerCase();
  const href = safeStr(x?.href).trim();
  const isWbs = title.includes("wbs") || body.includes("wbs") || href.includes("/wbs") || href.includes("type=wbs");
  const isWbsEffortGaps =
    title.includes("wbs effort gaps") ||
    title.includes("effort gaps") ||
    (title.includes("wbs") && body.includes("missing") && body.includes("effort")) ||
    (body.includes("wbs") && body.includes("missing") && body.includes("effort"));
  if (isWbs) {
    const sp = new URLSearchParams();
    if (typeof days === "number" && Number.isFinite(days)) sp.set("days", String(days));
    if (isWbsEffortGaps) sp.set("focus", "effort");
    const qs = sp.toString();
    return qs ? `/wbs/stats?${qs}` : "/wbs/stats";
  }
  return href || undefined;
}
function orderBriefingInsights(xs: Insight[]) {
  const arr = Array.isArray(xs) ? [...xs] : [];
  arr.sort((a, b) => {
    const aIs = a?.id === "ai-warning" ? 0 : 1;
    const bIs = b?.id === "ai-warning" ? 0 : 1;
    if (aIs !== bIs) return aIs - bIs;
    return 0;
  });
  return arr;
}
function calcRagAgg(
  rag: { project_id?: string; rag: "G" | "A" | "R"; health: number }[] | null | undefined,
  projects: { id: string }[] | null | undefined
) {
  const proj = Array.isArray(projects) ? projects : [];
  const list = Array.isArray(rag) ? rag : [];
  const byPid = new Map<string, { rag: "G" | "A" | "R"; health: number }>();
  for (const it of list) {
    const pid = String(it?.project_id || "").trim();
    const letter = String(it?.rag || "").toUpperCase() as "G" | "A" | "R";
    if (!pid || !["G", "A", "R"].includes(letter)) continue;
    byPid.set(pid, { rag: letter, health: Number(it?.health) });
  }
  let g = 0, a = 0, r = 0, scored = 0;
  const vals: number[] = [];
  for (const p of proj) {
    const pid = String((p as any)?.id || "").trim();
    if (!pid) continue;
    const hit = byPid.get(pid);
    if (!hit) continue;
    scored++;
    if (hit.rag === "G") g++;
    else if (hit.rag === "A") a++;
    else if (hit.rag === "R") r++;
    const h = Number(hit.health);
    vals.push(Number.isFinite(h) ? clamp01to100(h) : hit.rag === "G" ? 90 : hit.rag === "A" ? 65 : 35);
  }
  const projectsTotal = proj.length;
  const unscored = Math.max(0, projectsTotal - scored);
  const avg = vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : 0;
  return { avgHealth: clamp01to100(avg), g, a, r, scored, unscored, projectsTotal };
}
function healthNarrative(score: number) {
  if (score >= 85) return "Strong control across the portfolio.";
  if (score >= 70) return "Mostly healthy — watch the amber signals.";
  if (score >= 55) return "Mixed health — prioritise red hotspots.";
  return "Portfolio at risk — focus on recovery actions.";
}
function portfolioThresholdsTooltip() {
  return [
    "Portfolio Health thresholds:",
    "• Strong: 85–100",
    "• Healthy: 70–84",
    "• Mixed: 55–69",
    "• At Risk: 0–54",
    "",
    "Overall RAG from score:",
    "• Green: ≥70",
    "• Amber: 55–69",
    "• Red: <55",
  ].join("\n");
}
function prevWindowDays(cur: 7 | 14 | 30 | 60): 7 | 14 | 30 | 60 {
  if (cur === 7) return 14;
  if (cur === 14) return 30;
  if (cur === 30) return 60;
  return 60;
}
function projectCodeLabel(project_code: any): string {
  if (typeof project_code === "string") return project_code.trim();
  if (typeof project_code === "number" && Number.isFinite(project_code)) return String(project_code);
  if (project_code && typeof project_code === "object") {
    const v =
      safeStr((project_code as any).project_code) ||
      safeStr((project_code as any).code) ||
      safeStr((project_code as any).value) ||
      safeStr((project_code as any).id);
    return v.trim();
  }
  return "";
}
function dueDateLabel(iso: string | null | undefined) {
  const s = safeStr(iso).trim();
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}
function dueChipTone(itemType: DueItemType) {
  if (itemType === "milestone") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (itemType === "work_item") return "border-indigo-200 bg-indigo-50 text-indigo-700";
  if (itemType === "raid") return "border-rose-200 bg-rose-50 text-rose-700";
  if (itemType === "change") return "border-violet-200 bg-violet-50 text-violet-700";
  return "border-gray-200 bg-gray-50 text-gray-600";
}
function dueTypeLabel(itemType: DueItemType) {
  if (itemType === "milestone") return "Milestone";
  if (itemType === "work_item") return "WBS";
  if (itemType === "raid") return "RAID";
  if (itemType === "change") return "Change";
  return "Artifact";
}
function isOverdue(iso: string | null | undefined) {
  const s = safeStr(iso).trim();
  if (!s) return false;
  const t = new Date(s).getTime();
  if (!Number.isFinite(t)) return false;
  return t < Date.now() - 30 * 1000;
}

function sumSuccessBreakdown(b?: SuccessStoriesBreakdown) {
  if (!b) return 0;
  return (
    num(b.milestones_done) +
    num(b.wbs_done) +
    num(b.raid_resolved) +
    num(b.changes_delivered) +
    num(b.lessons_positive)
  );
}
function normalizeSuccessSummary(raw: any, days: number, prevScore: number): SuccessStoriesSummary {
  const v1Score = Number(raw?.score);
  const v1Ok = raw?.ok === true && Number.isFinite(v1Score);
  const v2Score = Number(raw?.summary?.score);
  const v2Ok = raw?.ok === true && Number.isFinite(v2Score);
  const score = v1Ok ? clamp01to100(v1Score) : v2Ok ? clamp01to100(v2Score) : 0;
  const breakdown: SuccessStoriesBreakdown | undefined = (v1Ok ? raw?.breakdown : raw?.summary?.breakdown) || undefined;
  const topCandidate = v1Ok ? raw?.top : raw?.summary?.top_wins;
  const top: SuccessStoryTop[] = Array.isArray(topCandidate) ? (topCandidate as SuccessStoryTop[]) : [];
  const countFromBreakdown = sumSuccessBreakdown(breakdown);
  const countFromMeta = num(raw?.meta?.total_wins);
  const countFromV1 = num(raw?.count);
  const count = countFromBreakdown > 0 ? countFromBreakdown : countFromMeta > 0 ? countFromMeta : countFromV1;
  const prev_score = clamp01to100(prevScore);
  const delta = score - prev_score;
  return { ok: true, days, score, prev_score, delta, count, breakdown, top, summary: raw?.summary, meta: raw?.meta };
}

// ── AI Signal Pill ──
function AiSignalPill({ text, tone }: { text: string; tone: "rose" | "amber" | "cyan" | "emerald" | "indigo" }) {
  const styles = {
    rose: "bg-rose-50/80 border-rose-200/60 text-rose-700",
    amber: "bg-amber-50/80 border-amber-200/60 text-amber-700",
    cyan: "bg-cyan-50/80 border-cyan-200/60 text-cyan-700",
    emerald: "bg-emerald-50/80 border-emerald-200/60 text-emerald-700",
    indigo: "bg-indigo-50/80 border-indigo-200/60 text-indigo-700",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${styles}`}>
      <span className="h-1 w-1 rounded-full bg-current opacity-70" />
      {text}
    </span>
  );
}

// ── AI Summary Panel for Milestones ──
function MilestonesAiSummary({
  loading,
  panel,
  windowDays,
}: {
  loading: boolean;
  panel: MilestonesPanel | null;
  windowDays: number;
}) {
  const due = num(panel?.due_count);
  const overdue = num(panel?.overdue_count);
  const atRisk = num(panel?.status_breakdown?.at_risk);
  const avgSlip = num(panel?.slippage?.avg_slip_days);
  const maxSlip = num(panel?.slippage?.max_slip_days);
  const onTrack = num(panel?.on_track_count);

  const urgencyScore = overdue * 3 + atRisk * 2 + (due > 0 ? 1 : 0);
  const urgencyLevel = urgencyScore >= 9 ? "critical" : urgencyScore >= 5 ? "elevated" : urgencyScore >= 2 ? "moderate" : "clear";

  const signals: { text: string; tone: "rose" | "amber" | "cyan" | "emerald" | "indigo" }[] = [];
  if (overdue > 0) signals.push({ text: `${overdue} overdue`, tone: "rose" });
  if (atRisk > 0) signals.push({ text: `${atRisk} at risk`, tone: "amber" });
  if (avgSlip > 3) signals.push({ text: `Avg slip ${avgSlip}d`, tone: "amber" });
  if (onTrack > 0) signals.push({ text: `${onTrack} on track`, tone: "emerald" });

  const narrative = loading
    ? "Analysing milestone health…"
    : !panel
    ? "No milestone data available for this window."
    : urgencyLevel === "critical"
    ? `${overdue} milestones are overdue and ${atRisk} flagged at-risk. Immediate attention required — average slip is ${avgSlip} days across affected items.`
    : urgencyLevel === "elevated"
    ? `${due} milestones due in ${windowDays}d. With ${overdue} overdue and ${atRisk} at-risk, proactive escalation is recommended now.`
    : urgencyLevel === "moderate"
    ? `${due} milestones approaching in ${windowDays}d. ${onTrack > 0 ? `${onTrack} are on track.` : ""} Monitor ${atRisk > 0 ? `${atRisk} at-risk items` : "progress"} closely.`
    : due > 0
    ? `${due} milestones due in ${windowDays}d — all trending on track. Delivery confidence is high.`
    : `No milestones due in the next ${windowDays} days. Schedule looks clear.`;

  const urgencyConfig = {
    critical: { bg: "from-rose-50/60 to-red-50/40", border: "border-rose-200/50", dot: "bg-rose-500", label: "Critical", labelCls: "text-rose-700 bg-rose-100 border-rose-200" },
    elevated: { bg: "from-amber-50/60 to-orange-50/40", border: "border-amber-200/50", dot: "bg-amber-500", label: "Elevated", labelCls: "text-amber-700 bg-amber-100 border-amber-200" },
    moderate: { bg: "from-cyan-50/40 to-blue-50/30", border: "border-cyan-200/50", dot: "bg-cyan-500", label: "Moderate", labelCls: "text-cyan-700 bg-cyan-100 border-cyan-200" },
    clear: { bg: "from-emerald-50/40 to-teal-50/30", border: "border-emerald-200/50", dot: "bg-emerald-500", label: "On Track", labelCls: "text-emerald-700 bg-emerald-100 border-emerald-200" },
  }[urgencyLevel];

  return (
    <div className={`relative mt-4 rounded-2xl border bg-gradient-to-br ${urgencyConfig.bg} ${urgencyConfig.border} overflow-hidden`}
      style={{ backdropFilter: "blur(12px)" }}>
      {/* Crystal gloss overlay */}
      <div className="absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.8), transparent)" }} />
      <div className="absolute inset-x-0 top-0 h-8 rounded-t-2xl" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.4), transparent)" }} />
      <div className="relative p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="relative flex h-6 w-6 items-center justify-center rounded-lg bg-white/80 border border-white/60 shadow-sm">
              <Brain className="h-3.5 w-3.5 text-slate-600" />
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border border-white" style={{ background: urgencyConfig.dot === "bg-rose-500" ? "#f43f5e" : urgencyConfig.dot === "bg-amber-500" ? "#f59e0b" : urgencyConfig.dot === "bg-cyan-500" ? "#06b6d4" : "#10b981" }} />
            </div>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">AI Outlook</span>
          </div>
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${urgencyConfig.labelCls}`}>
            {urgencyConfig.label}
          </span>
        </div>
        <p className="text-xs text-slate-600 leading-relaxed mb-3">
          {loading ? (
            <span className="inline-flex gap-1 items-center">
              <span className="h-1 w-1 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="h-1 w-1 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="h-1 w-1 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "300ms" }} />
            </span>
          ) : narrative}
        </p>
        {signals.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {signals.map((s, i) => <AiSignalPill key={i} text={s.text} tone={s.tone} />)}
          </div>
        )}
        {maxSlip > 0 && (
          <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-400">
            <Zap className="h-3 w-3" />
            <span>Max slip detected: <span className="font-semibold text-slate-600">{maxSlip} days</span></span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── AI Summary Panel for RAID ──
function RaidAiSummary({
  loading,
  panel,
  windowDays,
}: {
  loading: boolean;
  panel: RaidPanel | null;
  windowDays: number;
}) {
  const riskDue = num(panel?.risk_due);
  const issueDue = num(panel?.issue_due);
  const depDue = num(panel?.dependency_due);
  const assDue = num(panel?.assumption_due);
  const overdue = num(panel?.overdue_total);
  const riskHi = num(panel?.risk_hi);
  const issueHi = num(panel?.issue_hi);

  const highSeverityTotal = riskHi + issueHi;
  const urgencyScore = overdue * 3 + highSeverityTotal * 2 + riskDue + issueDue;
  const urgencyLevel = urgencyScore >= 12 ? "critical" : urgencyScore >= 6 ? "elevated" : urgencyScore >= 2 ? "moderate" : "clear";

  const dominantType =
    riskDue >= issueDue && riskDue >= depDue ? "risks"
    : issueDue >= depDue ? "issues"
    : "dependencies";

  const signals: { text: string; tone: "rose" | "amber" | "cyan" | "emerald" | "indigo" }[] = [];
  if (overdue > 0) signals.push({ text: `${overdue} overdue`, tone: "rose" });
  if (highSeverityTotal > 0) signals.push({ text: `${highSeverityTotal} high severity`, tone: "rose" });
  if (riskDue > 0) signals.push({ text: `${riskDue} risks`, tone: "amber" });
  if (issueDue > 0) signals.push({ text: `${issueDue} issues`, tone: "amber" });
  if (depDue > 0) signals.push({ text: `${depDue} deps`, tone: "indigo" });

  const narrative = loading
    ? "Scanning RAID register…"
    : !panel
    ? "No RAID data available for this window."
    : urgencyLevel === "critical"
    ? `${overdue} RAID items are overdue${highSeverityTotal > 0 ? ` and ${highSeverityTotal} are high-severity` : ""}. Escalation warranted — focus on ${dominantType} first.`
    : urgencyLevel === "elevated"
    ? `${riskDue + issueDue + depDue + assDue} RAID items due in ${windowDays}d. ${overdue > 0 ? `${overdue} already overdue.` : ""} ${dominantType.charAt(0).toUpperCase() + dominantType.slice(1)} are the primary concern.`
    : urgencyLevel === "moderate"
    ? `${riskDue + issueDue + depDue + assDue} items in the ${windowDays}d window. Review ${dominantType} and confirm ownership before deadlines arrive.`
    : `RAID register looks clear for ${windowDays}d window. Maintain regular reviews to keep the register current.`;

  const urgencyConfig = {
    critical: { bg: "from-rose-50/60 to-red-50/40", border: "border-rose-200/50", dot: "#f43f5e", label: "Critical", labelCls: "text-rose-700 bg-rose-100 border-rose-200" },
    elevated: { bg: "from-amber-50/60 to-orange-50/40", border: "border-amber-200/50", dot: "#f59e0b", label: "Elevated", labelCls: "text-amber-700 bg-amber-100 border-amber-200" },
    moderate: { bg: "from-violet-50/40 to-indigo-50/30", border: "border-violet-200/50", dot: "#8b5cf6", label: "Moderate", labelCls: "text-violet-700 bg-violet-100 border-violet-200" },
    clear: { bg: "from-emerald-50/40 to-teal-50/30", border: "border-emerald-200/50", dot: "#10b981", label: "Clear", labelCls: "text-emerald-700 bg-emerald-100 border-emerald-200" },
  }[urgencyLevel];

  return (
    <div className={`relative mt-4 rounded-2xl border bg-gradient-to-br ${urgencyConfig.bg} ${urgencyConfig.border} overflow-hidden`}
      style={{ backdropFilter: "blur(12px)" }}>
      <div className="absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.8), transparent)" }} />
      <div className="absolute inset-x-0 top-0 h-8 rounded-t-2xl" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.4), transparent)" }} />
      <div className="relative p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="relative flex h-6 w-6 items-center justify-center rounded-lg bg-white/80 border border-white/60 shadow-sm">
              <Shield className="h-3.5 w-3.5 text-slate-600" />
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border border-white" style={{ background: urgencyConfig.dot }} />
            </div>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">AI Risk Outlook</span>
          </div>
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${urgencyConfig.labelCls}`}>
            {urgencyConfig.label}
          </span>
        </div>
        <p className="text-xs text-slate-600 leading-relaxed mb-3">
          {loading ? (
            <span className="inline-flex gap-1 items-center">
              <span className="h-1 w-1 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="h-1 w-1 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="h-1 w-1 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "300ms" }} />
            </span>
          ) : narrative}
        </p>
        {signals.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {signals.map((s, i) => <AiSignalPill key={i} text={s.text} tone={s.tone} />)}
          </div>
        )}
        {highSeverityTotal > 0 && (
          <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-400">
            <Flame className="h-3 w-3 text-rose-400" />
            <span><span className="font-semibold text-rose-600">{highSeverityTotal} high-severity</span> items require owner review</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* Bell */
function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<BellTab>("all");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<NotifRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const r = await fetch("/api/notifications?limit=30", { cache: "no-store" });
      const j: NotifApiResp = await r.json().catch(() => ({ ok: false, error: "Bad JSON" }));
      if (!j || !j.ok) throw new Error((j as any)?.error || "Failed");
      const list = Array.isArray(j.items) ? j.items : [];
      setItems(list);
      const unread =
        typeof j.unreadCount === "number" ? j.unreadCount : list.filter((x) => x.is_read !== true).length;
      setUnreadCount(Math.max(0, unread));
    } catch (err) {
      console.error("Notifications refresh failed:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const id = runIdle(() => refresh());
    return () => {
      if (typeof window !== "undefined" && typeof (window as any).cancelIdleCallback === "function")
        (window as any).cancelIdleCallback(id);
      else window.clearTimeout(id);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    refresh();
    pollRef.current = setInterval(refresh, 15000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [open]);

  const filtered = useMemo(() => items.filter((n) => tabMatch(tab, n)), [items, tab]);
  const grouped = useMemo(() => {
    const map = new Map<string, NotifRow[]>();
    for (const n of filtered) {
      const k = groupLabel(n.created_at);
      const arr = map.get(k) ?? [];
      arr.push(n);
      map.set(k, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  async function markRead(id: string) {
    const wasUnread = items.some((n) => n.id === id && n.is_read !== true);
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    if (wasUnread) setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {
      refresh();
    }
  }

  async function markAllRead() {
    const unread = items.filter((n) => n.is_read !== true).length;
    if (unread <= 0) return;
    setItems((prev) => prev.map((n) => (n.is_read === true ? n : { ...n, is_read: true })));
    setUnreadCount(0);
    try {
      await fetch("/api/notifications/read-all", { method: "POST" });
    } catch {
      refresh();
    }
  }

  function onClickItem(n: NotifRow) {
    if (n.is_read !== true) markRead(n.id);
    setOpen(false);
    const href = safeStr(n.link || n.metadata?.href || "").trim();
    if (href) router.push(href);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative group rounded-xl border border-slate-200/80 bg-white/90 p-2.5 transition-all hover:border-indigo-300 hover:bg-indigo-50/60 active:scale-95"
        style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px rgba(255,255,255,0.8) inset" }}
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5 text-slate-500 group-hover:text-indigo-600 transition-colors" />
        {unreadCount > 0 && (
          <m.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white ring-2 ring-white"
            style={{ boxShadow: "0 2px 8px rgba(99,102,241,0.4)" }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </m.span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <m.div
              initial={{ opacity: 0, y: -10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.96 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="absolute right-0 top-full z-50 mt-3 w-[420px] overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95"
              style={{
                backdropFilter: "blur(24px)",
                boxShadow: "0 4px 6px -1px rgba(0,0,0,0.06), 0 20px 60px -10px rgba(0,0,0,0.14), 0 0 0 1px rgba(255,255,255,0.9) inset",
              }}
            >
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600" style={{ boxShadow: "0 4px 12px rgba(99,102,241,0.35)" }}>
                    <Bell className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-900">Notifications</div>
                    <div className="text-xs text-slate-400">{loading ? "Syncing…" : `${unreadCount} unread`}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={markAllRead}
                    className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-all"
                    style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}
                  >
                    <CheckCheck className="mr-1.5 inline h-3.5 w-3.5" />
                    Mark all read
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="h-8 w-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-all inline-flex items-center justify-center"
                    style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}
                  >
                    <X className="h-4 w-4 text-slate-400" />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-1 border-b border-slate-100 px-3 py-2.5 bg-slate-50/50">
                {(["all", "action", "ai", "approvals"] as BellTab[]).map((k) => {
                  const label = k === "all" ? "All" : k === "action" ? "Action" : k === "ai" ? "AI" : "Approvals";
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setTab(k)}
                      className={[
                        "rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                        tab === k ? "bg-indigo-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-700 hover:bg-slate-100",
                      ].join(" ")}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className="max-h-[480px] overflow-auto">
                {grouped.length === 0 ? (
                  <div className="px-4 py-14 text-center">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 border border-slate-200">
                      <CheckCheck className="h-6 w-6 text-slate-400" />
                    </div>
                    <div className="text-sm font-semibold text-slate-700">All caught up</div>
                    <div className="mt-1.5 text-xs text-slate-400">No new notifications.</div>
                  </div>
                ) : (
                  grouped.map(([label, rows]) => (
                    <div key={label}>
                      <div className="px-5 pt-4 pb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        {label}
                      </div>
                      <div className="px-3 pb-2 space-y-1">
                        {rows.map((n) => {
                          const unread = n.is_read !== true;
                          const sev = severityFromNotif(n);
                          return (
                            <button
                              key={n.id}
                              type="button"
                              onClick={() => onClickItem(n)}
                              className={[
                                "w-full rounded-xl px-3 py-3 text-left transition-all group",
                                unread
                                  ? "bg-white border border-slate-200 hover:border-indigo-200 hover:bg-indigo-50/30 shadow-sm"
                                  : "hover:bg-slate-50 border border-transparent",
                              ].join(" ")}
                            >
                              <div className="flex items-start gap-3">
                                <div
                                  className={[
                                    "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
                                    sev === "high" ? "border-rose-200 bg-rose-50 text-rose-600"
                                      : sev === "medium" ? "border-amber-200 bg-amber-50 text-amber-600"
                                      : sev === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-600"
                                      : "border-indigo-200 bg-indigo-50 text-indigo-600",
                                  ].join(" ")}
                                >
                                  {notifIcon(n)}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="truncate text-sm font-semibold text-slate-800">{n.title}</div>
                                    <div className="shrink-0 text-[11px] text-slate-400">{timeAgo(n.created_at)}</div>
                                  </div>
                                  {n.body && (
                                    <div className="mt-1 line-clamp-2 text-xs text-slate-500 leading-relaxed">{n.body}</div>
                                  )}
                                  <div className="mt-2 flex items-center gap-2">
                                    <span className={severityChip(sev)}>{sev}</span>
                                    {unread && <span className="inline-flex h-1.5 w-1.5 rounded-full bg-indigo-500" />}
                                  </div>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="border-t border-slate-100 px-5 py-3.5 bg-white/50">
                <button
                  type="button"
                  onClick={() => { setOpen(false); router.push("/notifications"); }}
                  className="text-xs text-slate-500 hover:text-indigo-600 transition-colors flex items-center gap-1.5 font-semibold"
                >
                  View all notifications <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            </m.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Skeleton ── */
function SkeletonAlert() {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-xl bg-slate-200 shrink-0" />
        <div className="flex-1 space-y-2.5 pt-1">
          <div className="h-3.5 bg-slate-200 rounded w-2/5" />
          <div className="h-3 bg-slate-100 rounded w-full" />
          <div className="h-3 bg-slate-100 rounded w-3/4" />
        </div>
      </div>
    </div>
  );
}

/* ── CRYSTAL SurfaceCard ── */
function SurfaceCard({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <m.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.16, 1, 0.3, 1] }}
      className={`relative overflow-hidden rounded-2xl p-6 transition-all ${className}`}
      style={{
        background: "linear-gradient(145deg, rgba(255,255,255,0.98) 0%, rgba(248,250,255,0.96) 60%, rgba(243,246,255,0.94) 100%)",
        border: "1px solid rgba(255,255,255,0.9)",
        boxShadow: "0 1px 1px rgba(0,0,0,0.02), 0 4px 8px rgba(0,0,0,0.03), 0 12px 32px rgba(99,102,241,0.06), 0 32px 64px rgba(99,102,241,0.04), 0 0 0 1px rgba(226,232,240,0.6), 0 1px 0 rgba(255,255,255,1) inset",
        backdropFilter: "blur(24px) saturate(1.8)",
      }}
    >
      {/* Triple-layer gloss */}
      <div className="absolute inset-0 rounded-2xl pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.6) 0%, transparent 50%, rgba(255,255,255,0.1) 100%)" }} />
      <div className="absolute top-0 inset-x-0 h-[1px] rounded-t-2xl" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,1) 30%, rgba(255,255,255,1) 70%, transparent)" }} />
      <div className="absolute top-0 inset-x-0 h-16 rounded-t-2xl pointer-events-none" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.7) 0%, transparent 100%)" }} />
      <div className="absolute top-1 left-4 right-4 h-4 rounded-full pointer-events-none" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.9) 40%, rgba(255,255,255,0.95) 60%, transparent)", filter: "blur(4px)" }} />
      <div className="relative">{children}</div>
    </m.div>
  );
}

/* ── CRYSTAL KpiCard ── */
function KpiCard({
  label, value, sub, icon, tone, onClick, extra, tooltip,
  metaLine, metaIcon, aiLine, rightVisual, badge, cardClassName, delay = 0,
}: {
  label: string; value: string; sub?: string; icon: React.ReactNode; tone: string;
  onClick?: () => void; extra?: React.ReactNode; tooltip?: string; metaLine?: string;
  metaIcon?: React.ReactNode; aiLine?: string; rightVisual?: React.ReactNode;
  badge?: React.ReactNode; cardClassName?: string; delay?: number;
}) {
  const clickable = typeof onClick === "function";

  const accentColors: Record<string, { bar: string; glow: string; tint: string; iconBg: string; iconGlow: string }> = {
    indigo: { bar: "#6366f1", glow: "rgba(99,102,241,0.15)", tint: "rgba(99,102,241,0.025)", iconBg: "linear-gradient(135deg,#6366f1,#4f46e5)", iconGlow: "rgba(99,102,241,0.4)" },
    amber:  { bar: "#f59e0b", glow: "rgba(245,158,11,0.15)", tint: "rgba(245,158,11,0.025)", iconBg: "linear-gradient(135deg,#f59e0b,#d97706)", iconGlow: "rgba(245,158,11,0.4)" },
    emerald:{ bar: "#10b981", glow: "rgba(16,185,129,0.15)", tint: "rgba(16,185,129,0.025)", iconBg: "linear-gradient(135deg,#10b981,#059669)", iconGlow: "rgba(16,185,129,0.4)" },
    rose:   { bar: "#f43f5e", glow: "rgba(244,63,94,0.15)",  tint: "rgba(244,63,94,0.025)",  iconBg: "linear-gradient(135deg,#f43f5e,#e11d48)", iconGlow: "rgba(244,63,94,0.4)" },
    cyan:   { bar: "#06b6d4", glow: "rgba(6,182,212,0.15)",  tint: "rgba(6,182,212,0.025)",  iconBg: "linear-gradient(135deg,#06b6d4,#0891b2)", iconGlow: "rgba(6,182,212,0.4)" },
    slate:  { bar: "#64748b", glow: "rgba(100,116,139,0.12)",tint: "rgba(100,116,139,0.02)", iconBg: "linear-gradient(135deg,#64748b,#475569)", iconGlow: "rgba(100,116,139,0.35)" },
    gold:   { bar: "#f59e0b", glow: "rgba(245,158,11,0.15)", tint: "rgba(245,158,11,0.025)", iconBg: "linear-gradient(135deg,#fbbf24,#f59e0b)", iconGlow: "rgba(245,158,11,0.4)" },
  };
  const acc = accentColors[tone] || accentColors.indigo;

  return (
    <m.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.16, 1, 0.3, 1] }}
      className={[
        "relative overflow-hidden rounded-2xl p-6 transition-all duration-300",
        clickable ? "cursor-pointer group" : "",
        cardClassName || "",
      ].join(" ")}
      style={{
        background: `linear-gradient(145deg, rgba(255,255,255,0.99) 0%, rgba(250,252,255,0.97) 50%, rgba(248,250,255,0.95) 100%)`,
        border: "1px solid rgba(255,255,255,0.95)",
        boxShadow: `0 1px 1px rgba(0,0,0,0.02), 0 4px 12px rgba(0,0,0,0.04), 0 16px 40px ${acc.glow}, 0 40px 80px ${acc.tint}, 0 0 0 1px rgba(226,232,240,0.7), 0 1px 0 rgba(255,255,255,1) inset`,
        backdropFilter: "blur(24px) saturate(1.8)",
      }}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => { if (!clickable) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } }}
      title={tooltip || (clickable ? "Click to view details" : undefined)}
    >
      {/* Crystal layering */}
      <div className="absolute inset-0 rounded-2xl pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.65) 0%, transparent 60%)" }} />
      <div className="absolute top-0 inset-x-0 h-[1px] rounded-t-2xl" style={{ background: `linear-gradient(90deg, transparent, rgba(255,255,255,1) 20%, rgba(255,255,255,1) 80%, transparent)` }} />
      <div className="absolute top-0 inset-x-0 h-20 rounded-t-2xl pointer-events-none" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.8) 0%, transparent 100%)" }} />
      <div className="absolute top-1 left-5 right-5 h-5 rounded-full pointer-events-none" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.95) 35%, rgba(255,255,255,1) 65%, transparent)", filter: "blur(5px)" }} />
      {/* Hover shimmer */}
      {clickable && (
        <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
          style={{ background: `linear-gradient(135deg, ${acc.tint.replace("0.025", "0.06")} 0%, transparent 60%)` }} />
      )}
      {/* Accent bar */}
      <div className="absolute left-0 top-6 bottom-6 w-[3px] rounded-r-full"
        style={{ background: acc.bar, boxShadow: `0 0 12px ${acc.glow}, 0 0 24px ${acc.tint}` }} />

      <div className="relative pl-4 flex flex-col h-full">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-2.5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.16em]">{label}</p>
              {badge}
              {tooltip && (
                <span className="text-[9px] text-slate-400 border border-slate-200 px-1.5 py-0.5 rounded font-mono cursor-help" title={tooltip}>i</span>
              )}
            </div>
            <p className="text-[42px] font-bold text-slate-950 tracking-tight leading-none" style={{ fontFamily: "var(--font-mono, 'DM Mono', monospace)", letterSpacing: "-0.02em" }}>
              {value}
            </p>
            {sub && <p className="text-xs text-slate-400 mt-2 line-clamp-2 font-medium leading-relaxed">{sub}</p>}
            {metaLine && (
              <div className="mt-3.5 inline-flex items-center gap-2 text-xs text-slate-500 bg-white/70 border border-slate-200/70 px-2.5 py-1.5 rounded-lg"
                style={{ backdropFilter: "blur(8px)", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                {metaIcon && <span className="text-slate-400">{metaIcon}</span>}
                <span className="truncate">{metaLine}</span>
              </div>
            )}
            {aiLine && <p className="mt-3 text-xs text-slate-500 line-clamp-2 leading-relaxed">{aiLine}</p>}
          </div>
          {rightVisual ? (
            <div className="shrink-0">{rightVisual}</div>
          ) : (
            <div className="shrink-0 flex items-center justify-center w-12 h-12 rounded-xl text-white transition-transform duration-300 group-hover:scale-110"
              style={{ background: acc.iconBg, boxShadow: `0 4px 12px ${acc.iconGlow}, 0 1px 0 rgba(255,255,255,0.2) inset` }}>
              {icon}
            </div>
          )}
        </div>
        {extra && <div className="mt-auto">{extra}</div>}
      </div>
    </m.div>
  );
}

/* ── CRYSTAL Portfolio Health Ring ── */
function PortfolioHealthRing({ score, rag }: { score: number; rag: RagLetter }) {
  const s = clamp01to100(score);
  const r = 22;
  const c = 2 * Math.PI * r;
  const dash = (s / 100) * c;
  const color = ragStrokeColor(rag);
  const glowColor = rag === "G" ? "rgba(16,185,129,0.3)" : rag === "A" ? "rgba(245,158,11,0.3)" : "rgba(244,63,94,0.3)";
  return (
    <div className="shrink-0 relative">
      <div className="h-16 w-16 relative">
        <div className="absolute inset-0 rounded-full" style={{ boxShadow: `0 0 20px ${glowColor}` }} />
        <svg viewBox="0 0 56 56" className="h-full w-full -rotate-90">
          <circle cx="28" cy="28" r={r} stroke="#e7e5e4" strokeWidth="4.5" fill="none" opacity="0.6" />
          <circle cx="28" cy="28" r={r} stroke="rgba(255,255,255,0.4)" strokeWidth="1" fill="none" />
          <m.circle
            cx="28" cy="28" r={r}
            stroke={color} strokeWidth="4.5" fill="none" strokeLinecap="round"
            initial={{ strokeDasharray: `0 ${c}` }}
            animate={{ strokeDasharray: `${dash} ${c}` }}
            transition={{ duration: 1.4, ease: [0.34, 1.56, 0.64, 1] }}
            style={{ filter: `drop-shadow(0 0 6px ${color})` }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold text-slate-800" style={{ fontFamily: "var(--font-mono, monospace)" }}>{s}%</span>
        </div>
      </div>
    </div>
  );
}

/* ── Portfolio Health Drivers ── */
function PortfolioHealthDrivers({ parts, drivers }: {
  parts: { schedule: number; raid: number; flow: number; approvals: number; activity: number };
  drivers: PortfolioHealthDriver[];
}) {
  const partPill = (label: string, v: number) => {
    const score = clamp01to100(v);
    const [bg, bar] = score >= 85 ? ["bg-emerald-50 border-emerald-200 text-emerald-700", "#10b981"]
      : score >= 70 ? ["bg-indigo-50 border-indigo-200 text-indigo-700", "#6366f1"]
      : score >= 55 ? ["bg-amber-50 border-amber-200 text-amber-700", "#f59e0b"]
      : ["bg-rose-50 border-rose-200 text-rose-700", "#f43f5e"];
    return (
      <div className={`relative overflow-hidden flex items-center justify-between rounded-xl border px-3 py-2.5 text-xs ${bg}`}
        style={{ backdropFilter: "blur(8px)" }}>
        <div className="absolute bottom-0 left-0 h-0.5 rounded-full" style={{ width: `${score}%`, background: bar, boxShadow: `0 0 4px ${bar}` }} />
        <span className="font-semibold relative">{label}</span>
        <span className="font-bold relative" style={{ fontFamily: "var(--font-mono, monospace)" }}>{score}</span>
      </div>
    );
  };
  return (
    <div className="space-y-2 mt-4 pt-4 border-t border-slate-100/80">
      <div className="text-[10px] font-bold text-slate-400 mb-3 uppercase tracking-widest">Health Drivers</div>
      <div className="grid grid-cols-2 gap-2">
        {partPill("Schedule", num(parts?.schedule))}
        {partPill("RAID", num(parts?.raid))}
        {partPill("Flow", num(parts?.flow))}
        {partPill("Approvals", num(parts?.approvals))}
      </div>
    </div>
  );
}

/* ── Success Story Meta ── */
function SuccessStoryMeta({ meta, loading, displayTotal }: {
  meta: { milestones_completed?: number; raid_closed?: number; changes_implemented?: number; wbs_done?: number; lessons_published?: number };
  loading: boolean; displayTotal: number;
}) {
  const milestones = num(meta.milestones_completed);
  const raid = num(meta.raid_closed);
  const changes = num(meta.changes_implemented);
  const wbs = num(meta.wbs_done);
  const lessons = num(meta.lessons_published);
  const knownSum = milestones + raid + changes + wbs + lessons;
  const other = Math.max(0, num(displayTotal) - knownSum);
  const stats = [
    { label: "Milestones", value: milestones },
    { label: "RAID", value: raid },
    { label: "Changes", value: changes },
    { label: "WBS", value: wbs },
    { label: "Lessons", value: lessons },
    { label: "Other", value: other },
  ];
  return (
    <div className="border-t border-slate-100/80 pt-4">
      <div className="grid grid-cols-3 gap-2">
        {stats.map((stat) => (
          <div key={stat.label} className="text-center p-2 rounded-xl bg-white/60 border border-slate-100"
            style={{ backdropFilter: "blur(8px)", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
            <div className="text-lg font-bold text-slate-800" style={{ fontFamily: "var(--font-mono, monospace)" }}>
              {loading ? "…" : stat.value}
            </div>
            <div className="text-[9px] uppercase tracking-widest text-slate-400 mt-0.5 font-bold">{stat.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── CRYSTAL AI Alert ── */
function AiAlert({ severity, title, body, href }: { severity: "high" | "medium" | "info"; title: string; body: string; href?: string }) {
  const cfg = {
    high: {
      wrap: "border-rose-200/70 hover:border-rose-300",
      bg: "linear-gradient(135deg, rgba(255,241,242,0.9) 0%, rgba(255,228,230,0.7) 100%)",
      icon: "bg-rose-100/80 border-rose-200/60 text-rose-600",
      pill: "bg-rose-100 border-rose-200 text-rose-700",
      label: "Critical",
      glow: "rgba(244,63,94,0.08)",
    },
    medium: {
      wrap: "border-amber-200/70 hover:border-amber-300",
      bg: "linear-gradient(135deg, rgba(255,251,235,0.9) 0%, rgba(254,243,199,0.7) 100%)",
      icon: "bg-amber-100/80 border-amber-200/60 text-amber-600",
      pill: "bg-amber-100 border-amber-200 text-amber-700",
      label: "Warning",
      glow: "rgba(245,158,11,0.08)",
    },
    info: {
      wrap: "border-indigo-100/80 hover:border-indigo-200",
      bg: "linear-gradient(135deg, rgba(238,242,255,0.85) 0%, rgba(224,231,255,0.65) 100%)",
      icon: "bg-indigo-100/80 border-indigo-200/60 text-indigo-600",
      pill: "bg-indigo-100 border-indigo-200 text-indigo-700",
      label: "Info",
      glow: "rgba(99,102,241,0.06)",
    },
  }[severity];
  const Icon = severity === "info" ? Sparkles : AlertTriangle;
  return (
    <div className={`group relative overflow-hidden rounded-xl border p-4 transition-all`}
      style={{ background: cfg.bg, borderColor: severity === "high" ? "rgba(254,202,202,0.8)" : severity === "medium" ? "rgba(253,230,138,0.8)" : "rgba(199,210,254,0.8)", boxShadow: `0 2px 8px ${cfg.glow}, 0 1px 0 rgba(255,255,255,0.8) inset`, backdropFilter: "blur(12px)" }}>
      <div className="absolute top-0 inset-x-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)" }} />
      <div className="flex items-start gap-3">
        <div className={`shrink-0 flex h-9 w-9 items-center justify-center rounded-xl border ${cfg.icon}`}
          style={{ boxShadow: "0 2px 6px rgba(0,0,0,0.06), 0 1px 0 rgba(255,255,255,0.8) inset" }}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3 mb-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest ${cfg.pill}`}>
                {cfg.label}
              </span>
              <h4 className="font-semibold text-sm text-slate-800">{title}</h4>
            </div>
            {href && (
              <a href={href} className="shrink-0 text-[11px] text-indigo-600 hover:text-indigo-700 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all font-semibold">
                View <ArrowUpRight className="h-3 w-3" />
              </a>
            )}
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">{body}</p>
        </div>
      </div>
    </div>
  );
}

/* ── Milestones Meta ── */
function MilestonesMeta({ loading, panel }: { loading: boolean; panel: MilestonesPanel | null }) {
  const stats = [
    { label: "Planned", value: num(panel?.status_breakdown?.planned), cls: "text-slate-700" },
    { label: "At Risk", value: num(panel?.status_breakdown?.at_risk), cls: "text-amber-600" },
    { label: "Overdue", value: num(panel?.overdue_count), cls: "text-rose-600" },
  ];
  return (
    <div className="mt-4 pt-4 border-t border-slate-100/80">
      <div className="flex items-center justify-between gap-2">
        {stats.map((stat) => (
          <div key={stat.label} className="text-center flex-1 py-2.5 rounded-xl bg-white/60 border border-slate-100"
            style={{ backdropFilter: "blur(8px)", boxShadow: "0 1px 3px rgba(0,0,0,0.03), 0 1px 0 rgba(255,255,255,0.9) inset" }}>
            <div className={`text-xl font-bold ${stat.cls}`} style={{ fontFamily: "var(--font-mono, monospace)" }}>
              {loading ? "…" : stat.value}
            </div>
            <div className="text-[9px] uppercase tracking-widest text-slate-400 mt-0.5 font-bold">{stat.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── RAID Meta ── */
function RaidMeta({ loading, panel, onClickType }: {
  loading: boolean; panel: RaidPanel | null;
  onClickType: (type?: "Risk" | "Issue" | "Dependency" | "Assumption", extra?: { overdue?: boolean; hi?: boolean }) => void;
}) {
  const riskVal = num(panel?.risk_due);
  const issueVal = num(panel?.issue_due);
  const depVal = num(panel?.dependency_due);
  const assVal = num(panel?.assumption_due);
  const dueTotal = num(panel?.due_total);
  const overdueVal = num(panel?.overdue_total);
  const typedSum = riskVal + issueVal + depVal + assVal;
  const hasTypedBreakdown = typedSum > 0;
  return (
    <div className="mt-4 pt-4 border-t border-slate-100/80">
      {!hasTypedBreakdown ? (
        <button
          onClick={(e) => { e.stopPropagation(); onClickType(undefined, { hi: false }); }}
          className="w-full rounded-xl border border-slate-200/80 bg-white/60 hover:bg-white/90 transition-all px-3 py-3 flex items-center justify-between"
          style={{ backdropFilter: "blur(8px)", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
        >
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-rose-50/80 border border-rose-200/60">
              <AlertTriangle className="h-4 w-4 text-rose-600" />
            </span>
            <div className="text-left">
              <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Due in window</div>
              <div className="text-xs text-slate-400">Type breakdown unavailable</div>
            </div>
          </div>
          <div className="text-xl font-bold text-slate-800" style={{ fontFamily: "var(--font-mono, monospace)" }}>
            {loading ? "…" : dueTotal}
          </div>
        </button>
      ) : (
        <div className="grid grid-cols-4 gap-1.5">
          {[
            { label: "Risk", value: riskVal, type: "Risk" as const, accent: "#f43f5e", bg: "rgba(254,242,242,0.8)" },
            { label: "Issue", value: issueVal, type: "Issue" as const, accent: "#f59e0b", bg: "rgba(255,251,235,0.8)" },
            { label: "Dep", value: depVal, type: "Dependency" as const, accent: "#6366f1", bg: "rgba(238,242,255,0.8)" },
            { label: "Assum", value: assVal, type: "Assumption" as const, accent: "#64748b", bg: "rgba(248,250,252,0.8)" },
          ].map((item) => (
            <button
              key={item.label}
              onClick={(e) => { e.stopPropagation(); onClickType(item.type, { hi: false }); }}
              className="text-center p-2.5 rounded-xl border border-slate-200/70 hover:border-slate-300 transition-all"
              style={{ background: item.bg, backdropFilter: "blur(8px)", boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 1px 0 rgba(255,255,255,0.9) inset" }}
            >
              <div className="text-lg font-bold" style={{ color: item.accent, fontFamily: "var(--font-mono, monospace)" }}>
                {loading ? "…" : item.value}
              </div>
              <div className="text-[9px] uppercase tracking-widest text-slate-400 mt-0.5 font-bold">{item.label}</div>
            </button>
          ))}
        </div>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onClickType(undefined, { overdue: true }); }}
        className="mt-2 w-full rounded-xl border border-rose-200/70 hover:border-rose-300 transition-all px-3 py-2.5 flex items-center justify-between"
        style={{ background: "linear-gradient(135deg, rgba(255,241,242,0.9), rgba(255,228,230,0.7))", backdropFilter: "blur(8px)", boxShadow: "0 1px 3px rgba(244,63,94,0.08), 0 1px 0 rgba(255,255,255,0.8) inset" }}
      >
        <div className="flex items-center gap-2">
          <Clock3 className="h-3.5 w-3.5 text-rose-500" />
          <div className="text-[9px] font-bold text-rose-600 uppercase tracking-widest">Overdue Items</div>
        </div>
        <div className="text-sm font-bold text-rose-700" style={{ fontFamily: "var(--font-mono, monospace)" }}>
          {loading ? "…" : overdueVal}
        </div>
      </button>
    </div>
  );
}

/* ── CRYSTAL Project Tile ── */
function ProjectTile({ projectRef, title, subtitle = "RAID · Changes · Lessons · Reporting", projectCode, clientName }: {
  projectRef: string; title: string; subtitle?: string; projectCode?: string; clientName?: string;
}) {
  const router = useRouter();
  function go() { if (!projectRef) return; router.push(`/projects/${encodeURIComponent(projectRef)}`); }
  const code = safeStr(projectCode).trim();
  const client = safeStr(clientName).trim();
  return (
    <m.div
      role="link" tabIndex={0}
      onClick={go}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } }}
      whileHover={{ y: -3, transition: { duration: 0.2 } }}
      className="cursor-pointer rounded-xl p-5 transition-all duration-300 relative overflow-hidden group"
      style={{
        background: "linear-gradient(145deg, rgba(255,255,255,0.99) 0%, rgba(248,250,255,0.97) 100%)",
        border: "1px solid rgba(226,232,240,0.8)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.03), 0 4px 16px rgba(99,102,241,0.06), 0 1px 0 rgba(255,255,255,1) inset",
        backdropFilter: "blur(16px)",
      }}
    >
      <div className="absolute top-0 inset-x-0 h-px rounded-t-xl" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.95) 30%, rgba(255,255,255,1) 70%, transparent)" }} />
      <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
        style={{ background: "linear-gradient(135deg, rgba(238,242,255,0.5) 0%, rgba(224,231,255,0.3) 100%)", boxShadow: "0 4px 24px rgba(99,102,241,0.1)" }} />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-2.5 flex-wrap">
              {code && (
                <span className="inline-flex items-center rounded-md bg-indigo-50/80 border border-indigo-200/60 px-2 py-0.5 text-[10px] font-bold text-indigo-700 uppercase tracking-wider"
                  style={{ fontFamily: "var(--font-mono, monospace)", backdropFilter: "blur(4px)" }}>
                  {code}
                </span>
              )}
              {client && (
                <span className="inline-flex items-center rounded-md bg-slate-100/70 border border-slate-200/60 px-2 py-0.5 text-[10px] text-slate-500 font-medium">
                  {client}
                </span>
              )}
            </div>
            <h3 className="text-sm font-bold text-slate-800 group-hover:text-indigo-700 transition-colors truncate">{title}</h3>
            <p className="text-[11px] text-slate-400 mt-1.5 font-medium">{subtitle}</p>
          </div>
          <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-200">
            <div className="h-7 w-7 rounded-lg bg-indigo-50/80 border border-indigo-200/60 flex items-center justify-center"
              style={{ backdropFilter: "blur(4px)" }}>
              <ArrowUpRight className="h-3.5 w-3.5 text-indigo-600" />
            </div>
          </div>
        </div>
      </div>
    </m.div>
  );
}

/* ── MAIN EXPORT ── */
export default function HomePage({ data }: { data: HomeData }) {
  const router = useRouter();
  const ok = data?.ok === true;
  const isExec = ok ? data.isExec : false;
  const projects = ok ? data.projects : [];
  const kpis = ok ? data.kpis : { portfolioHealth: 0, openRisks: 0, highRisks: 0, forecastVariance: 0, milestonesDue: 0, openLessons: 0 };
  const approvals = ok ? data.approvals : { count: 0, items: [] };
  const rag = ok ? data.rag || [] : [];

  const [today, setToday] = useState<string>("");
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const numericWindowDays = useMemo<7 | 14 | 30 | 60>(() => (windowDays === "all" ? 60 : windowDays), [windowDays]);
  const windowLabel = windowDays === "all" ? "Overall" : `${windowDays}d`;
  const windowNarr = windowDays === "all" ? "Overall (all time)" : `Last ${windowDays} days`;

  const [showPhDetails, setShowPhDetails] = useState(false);
  const [phLoading, setPhLoading] = useState(false);
  const [phErr, setPhErr] = useState("");
  const [phData, setPhData] = useState<PortfolioHealthApi | null>(null);
  const [phPrevLoading, setPhPrevLoading] = useState(false);
  const [phPrevErr, setPhPrevErr] = useState("");
  const [phPrevScore, setPhPrevScore] = useState<number | null>(null);

  const [insights, setInsights] = useState<Insight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState<boolean>(true);
  const [insightsErr, setInsightsErr] = useState<string>("");

  const [ssLoading, setSsLoading] = useState(false);
  const [ssErr, setSsErr] = useState("");
  const [ssSummary, setSsSummary] = useState<SuccessStoriesSummary | null>(null);
  const [ssIdx, setSsIdx] = useState(0);

  const [approvalItems, setApprovalItems] = useState<any[]>(Array.isArray(approvals.items) ? approvals.items : []);
  const [pendingIds, setPendingIds] = useState<Record<string, true>>({});

  const [milestonesDueLive, setMilestonesDueLive] = useState<number>(Number(kpis.milestonesDue || 0));
  const [milestonesDueLoading, setMilestonesDueLoading] = useState<boolean>(false);
  const [milestonesPanel, setMilestonesPanel] = useState<MilestonesPanel | null>(null);
  const [milestonesPanelLoading, setMilestonesPanelLoading] = useState<boolean>(false);

  const [raidPanel, setRaidPanel] = useState<RaidPanel | null>(null);
  const [raidLoading, setRaidLoading] = useState(false);

  const [dueWindowDays, setDueWindowDays] = useState<7 | 14 | 30>(14);
  const [dueLoading, setDueLoading] = useState(false);
  const [dueErr, setDueErr] = useState("");
  const [dueItems, setDueItems] = useState<DueDigestItem[]>([]);
  const [dueCounts, setDueCounts] = useState<{ total: number; milestone: number; work_item: number; raid: number; artifact: number; change: number }>({
    total: 0, milestone: 0, work_item: 0, raid: 0, artifact: 0, change: 0,
  });
  const [dueUpdatedAt, setDueUpdatedAt] = useState<string>("");

  useEffect(() => { setApprovalItems(Array.isArray(approvals.items) ? approvals.items : []); }, [ok, approvals.items]);
  useEffect(() => { setToday(new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })); }, []);
  useEffect(() => { setShowPhDetails(false); }, [windowDays]);

  useEffect(() => {
    if (!ok || !isExec) return;
    let cancelled = false;
    runIdle(() => {
      (async () => {
        try {
          setPhLoading(true); setPhErr("");
          const j = await fetchJson<PortfolioHealthApi>(`/api/portfolio/health?days=${windowDays}`, { cache: "no-store" });
          if (!j || !j.ok) throw new Error((j as any)?.error || "Failed");
          if (!cancelled) setPhData(j);
        } catch (e: any) {
          if (!cancelled) { setPhErr(e?.message || "Failed"); setPhData(null); }
        } finally {
          if (!cancelled) setPhLoading(false);
        }
      })();
    });
    return () => { cancelled = true; };
  }, [ok, isExec, windowDays]);

  useEffect(() => {
    if (!ok || !isExec) return;
    const prev = prevWindowDays(numericWindowDays);
    let cancelled = false;
    runIdle(() => {
      (async () => {
        try {
          setPhPrevLoading(true); setPhPrevErr("");
          const j = await fetchJson<PortfolioHealthApi>(`/api/portfolio/health?days=${prev}`, { cache: "no-store" });
          if (!j || !j.ok) throw new Error((j as any)?.error || "Failed");
          if (!cancelled) setPhPrevScore(clamp01to100((j as any).portfolio_health));
        } catch (e: any) {
          if (!cancelled) { setPhPrevErr(e?.message || "Unavail"); setPhPrevScore(null); }
        } finally {
          if (!cancelled) setPhPrevLoading(false);
        }
      })();
    });
    return () => { cancelled = true; };
  }, [ok, isExec, numericWindowDays]);

  useEffect(() => {
    let cancelled = false;
    runIdle(() => {
      (async () => {
        try {
          setInsightsLoading(true); setInsightsErr("");
          const j: any = await fetchJson(`/api/ai/briefing?days=${numericWindowDays}`, { cache: "no-store" });
          if (!j?.ok) throw new Error(j?.error || "Failed");
          if (!cancelled) setInsights(orderBriefingInsights(Array.isArray(j?.insights) ? (j.insights as Insight[]) : []));
        } catch (e: any) {
          if (!cancelled) { setInsightsErr(e?.message || "Failed"); setInsights([]); }
        } finally {
          if (!cancelled) setInsightsLoading(false);
        }
      })();
    });
    return () => { cancelled = true; };
  }, [numericWindowDays]);

  useEffect(() => {
    if (!ok || !isExec) return;
    let cancelled = false;
    const curDays = numericWindowDays;
    const prevDays = prevWindowDays(curDays);
    runIdle(() => {
      (async () => {
        try {
          setSsLoading(true); setSsErr("");
          const [curRaw, prevRaw] = await Promise.all([
            fetchJson<any>(`/api/success-stories/summary?days=${curDays}`, { cache: "no-store" }),
            fetchJson<any>(`/api/success-stories/summary?days=${prevDays}`, { cache: "no-store" }),
          ]);
          if (!curRaw || curRaw?.ok !== true) throw new Error(curRaw?.error || "Failed");
          const prevScore = prevRaw?.ok === true ? clamp01to100(Number(prevRaw?.score ?? prevRaw?.summary?.score ?? 0)) : 0;
          const normalized = normalizeSuccessSummary(curRaw, curDays, prevScore);
          if (!cancelled) setSsSummary(normalized);
        } catch (e: any) {
          if (!cancelled) { setSsErr(e?.message || "Failed"); setSsSummary(null); }
        } finally {
          if (!cancelled) setSsLoading(false);
        }
      })();
    });
    return () => { cancelled = true; };
  }, [ok, isExec, numericWindowDays]);

  useEffect(() => setSsIdx(0), [numericWindowDays]);
  useEffect(() => {
    if (!ok || !isExec) return;
    const list = ssSummary && ssSummary.ok && Array.isArray(ssSummary.top) ? ssSummary.top : [];
    if (list.length <= 1) return;
    const id = window.setInterval(() => setSsIdx((i) => (i + 1) % list.length), 6500);
    return () => window.clearInterval(id);
  }, [ok, isExec, ssSummary]);

  const approvalCount = approvalItems.length;
  const byId = useMemo(() => {
    const m2 = new Map<string, any>();
    for (const it of approvalItems) m2.set(String(it?.id || ""), it);
    return m2;
  }, [approvalItems]);

  async function decide(taskId: string, decision: "approve" | "reject") {
    const item = byId.get(taskId);
    if (!item) return;
    const comment = decision === "reject" ? (prompt("Reason for rejection (optional):", "") ?? "") : "";
    setPendingIds((p) => ({ ...p, [taskId]: true }));
    setApprovalItems((items) => items.filter((x) => String(x?.id || "") !== taskId));
    try {
      const r = await fetch("/api/approvals/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approval_task_id: taskId, decision, comment }),
      });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "Decision failed");
    } catch (e: any) {
      setApprovalItems((items) => {
        const exists = items.some((x) => String(x?.id || "") === taskId);
        if (exists) return items;
        return [item, ...items];
      });
      alert(e?.message || "Decision failed");
    } finally {
      setPendingIds((p) => { const next = { ...p }; delete next[taskId]; return next; });
    }
  }

  function viewHref(item: any) {
    const projectRef =
      safeStr(item?.project_code) || safeStr(item?.project_human_id) ||
      safeStr(item?.project?.project_code) || safeStr(item?.project?.project_human_id) ||
      safeStr(item?.project_id || item?.change?.project_id);
    const changeId = safeStr(item?.change_id || item?.change?.id);
    if (projectRef && changeId) return `/projects/${encodeURIComponent(projectRef)}/change/${encodeURIComponent(changeId)}`;
    return "";
  }

  const projectIdsKey = useMemo(() => {
    const ids = (projects || []).map((p) => String(p?.id || "")).filter(Boolean).sort();
    return ids.join("|");
  }, [projects]);

  function openMilestonesDrilldown() {
    const sp = new URLSearchParams();
    sp.set("days", String(numericWindowDays));
    router.push(`/milestones?${sp.toString()}`);
  }

  useEffect(() => {
    if (!ok || !isExec || !projectIdsKey) return;
    let cancelled = false;
    runIdle(() => {
      (async () => {
        try {
          setMilestonesDueLoading(true);
          const pj: any = await fetchJson(`/api/portfolio/milestones-due?days=${numericWindowDays}`, { cache: "no-store" });
          if (pj?.ok && typeof pj?.count === "number") {
            if (!cancelled) setMilestonesDueLive(Math.max(0, Number(pj.count)));
            return;
          }
          const ids = projectIdsKey.split("|").filter(Boolean);
          const results = await Promise.allSettled(
            ids.map(async (projectId) => {
              const j: any = await fetchJson(`/api/projects/${projectId}/milestones/due?days=${numericWindowDays}`, { cache: "no-store" });
              if (!j?.ok) return 0;
              const n2 = Number(j?.count ?? 0);
              return Number.isFinite(n2) ? n2 : 0;
            })
          );
          let sum = 0;
          for (const res of results) if (res.status === "fulfilled") sum += res.value;
          if (!cancelled) setMilestonesDueLive(sum);
        } catch {
        } finally {
          if (!cancelled) setMilestonesDueLoading(false);
        }
      })();
    });
    return () => { cancelled = true; };
  }, [ok, isExec, projectIdsKey, numericWindowDays]);

  useEffect(() => {
    if (!ok || !isExec || !projectIdsKey) return;
    let cancelled = false;
    runIdle(() => {
      (async () => {
        try {
          setMilestonesPanelLoading(true);
          const pj: any = await fetchJson(`/api/portfolio/milestones/panel?days=${numericWindowDays}`, { cache: "no-store" });
          if (pj?.ok && pj?.panel) {
            if (!cancelled) setMilestonesPanel(pj.panel as MilestonesPanel);
            return;
          }
          const ids = projectIdsKey.split("|").filter(Boolean);
          const results = await Promise.allSettled(
            ids.map(async (projectId) => {
              const j: any = await fetchJson(`/api/projects/${projectId}/milestones/panel?days=${numericWindowDays}`, { cache: "no-store" });
              if (!j?.ok) return null;
              return (j.panel ?? null) as MilestonesPanel | null;
            })
          );
          let due = 0, overdue = 0, onTrack = 0, aiHigh = 0, planned = 0, inProg = 0, atRisk = 0, completed = 0, slipSum = 0, slipCount = 0, maxSlip = 0;
          for (const res of results) {
            if (res.status !== "fulfilled" || !res.value) continue;
            const p = res.value;
            due += num(p.due_count); overdue += num(p.overdue_count); onTrack += num(p.on_track_count);
            aiHigh += num(p.ai_high_risk_count); planned += num(p.status_breakdown?.planned);
            inProg += num(p.status_breakdown?.in_progress); atRisk += num(p.status_breakdown?.at_risk);
            completed += num(p.status_breakdown?.completed);
            const avg = p.slippage?.avg_slip_days; const mx = p.slippage?.max_slip_days;
            if (Number.isFinite(Number(avg))) { slipSum += Number(avg); slipCount += 1; }
            if (Number.isFinite(Number(mx))) maxSlip = Math.max(maxSlip, Number(mx));
          }
          if (!cancelled)
            setMilestonesPanel({
              days: numericWindowDays, due_count: due, overdue_count: overdue, on_track_count: onTrack,
              ai_high_risk_count: aiHigh,
              status_breakdown: { planned, in_progress: inProg, at_risk: atRisk, completed, overdue },
              slippage: { avg_slip_days: slipCount ? Math.round((slipSum / slipCount) * 10) / 10 : 0, max_slip_days: maxSlip },
            });
        } catch {
          if (!cancelled) setMilestonesPanel(null);
        } finally {
          if (!cancelled) setMilestonesPanelLoading(false);
        }
      })();
    });
    return () => { cancelled = true; };
  }, [ok, isExec, projectIdsKey, numericWindowDays]);

  useEffect(() => {
    if (!ok || !isExec) return;
    let cancelled = false;
    const pickFirstFinite = (obj: any, keys: string[]) => {
      for (const k of keys) { const v = obj?.[k]; if (Number.isFinite(Number(v))) return num(v); }
      return undefined;
    };
    const parseType = (t: any) => String(t || "").toLowerCase().trim();
    const parseDueIso = (row: any) =>
      safeStr(row?.due) || safeStr(row?.due_date) || safeStr(row?.dueDate) ||
      safeStr(row?.due_at) || safeStr(row?.dueAt) || safeStr(row?.target_date) || safeStr(row?.targetDate) || "";
    const isRowClosed = (row: any) => {
      const s = String(row?.status || row?.state || "").toLowerCase();
      return s.includes("closed") || s.includes("resolved") || s.includes("done") || s.includes("complete");
    };
    runIdle(() => {
      (async () => {
        try {
          setRaidLoading(true);
          const j: any = await fetchJson(`/api/portfolio/raid-panel?days=${numericWindowDays}`, { cache: "no-store" });
          if (!j?.ok) return;
          const p = j?.panel ?? null;
          if (cancelled) return;
          if (!p) { setRaidPanel(null); return; }
          const risk_due = pickFirstFinite(p, ["risk_due", "risks_due", "due_risk", "due_risks", "riskDue", "risk_due_count"]) ?? undefined;
          const issue_due = pickFirstFinite(p, ["issue_due", "issues_due", "due_issue", "due_issues", "issueDue", "issue_due_count"]) ?? undefined;
          const dependency_due = pickFirstFinite(p, ["dependency_due", "dependencies_due", "dep_due", "deps_due", "due_dependency", "due_deps", "dependencyDue"]) ?? undefined;
          const assumption_due = pickFirstFinite(p, ["assumption_due", "assumptions_due", "due_assumption", "due_assumptions"]) ?? undefined;
          const overdue_total_api = num(p?.overdue_total);
          const due_total_api = num(p?.due_total);
          let dRisk = 0, dIssue = 0, dDep = 0, dAss = 0, ovRisk = 0, ovIssue = 0, ovDep = 0, ovAss = 0;
          const items = Array.isArray(p?.items) ? p.items : Array.isArray(j?.items) ? j.items : null;
          const missingTyped =
            !Number.isFinite(Number(risk_due)) || !Number.isFinite(Number(issue_due)) ||
            !Number.isFinite(Number(dependency_due)) || !Number.isFinite(Number(assumption_due));
          if (missingTyped && Array.isArray(items) && items.length) {
            const now = Date.now();
            const windowEnd = now + numericWindowDays * 86400_000;
            for (const row of items) {
              if (isRowClosed(row)) continue;
              const type = parseType(row?.type || row?.item_type || row?.raid_type);
              const dueIso = parseDueIso(row);
              const dueT = dueIso ? new Date(dueIso).getTime() : NaN;
              if (!Number.isFinite(dueT)) continue;
              const isOv = dueT < Date.now() - 30_000;
              const inWindow = dueT <= windowEnd;
              if (inWindow && !isOv) {
                if (type.includes("risk")) dRisk++;
                else if (type.includes("issue")) dIssue++;
                else if (type.includes("depend")) dDep++;
                else if (type.includes("assump")) dAss++;
              }
              if (isOv) {
                if (type.includes("risk")) ovRisk++;
                else if (type.includes("issue")) ovIssue++;
                else if (type.includes("depend")) ovDep++;
                else if (type.includes("assump")) ovAss++;
              }
            }
          }
          const finalRiskDue = Number.isFinite(Number(risk_due)) ? num(risk_due) : dRisk;
          const finalIssueDue = Number.isFinite(Number(issue_due)) ? num(issue_due) : dIssue;
          const finalDepDue = Number.isFinite(Number(dependency_due)) ? num(dependency_due) : dDep;
          const finalAssDue = Number.isFinite(Number(assumption_due)) ? num(assumption_due) : dAss;
          const due_total_from_types = finalRiskDue + finalIssueDue + finalDepDue + finalAssDue;
          const due_total = due_total_from_types > 0 ? due_total_from_types : due_total_api;
          const overdue_total = overdue_total_api > 0 ? overdue_total_api : ovRisk + ovIssue + ovDep + ovAss;
          setRaidPanel({
            days: num(p.days, numericWindowDays), due_total, overdue_total,
            risk_due: finalRiskDue, issue_due: finalIssueDue, dependency_due: finalDepDue, assumption_due: finalAssDue,
            risk_overdue: ovRisk || undefined, issue_overdue: ovIssue || undefined,
            dependency_overdue: ovDep || undefined, assumption_overdue: ovAss || undefined,
            risk_hi: num(p?.risk_hi), issue_hi: num(p?.issue_hi),
            dependency_hi: num(p?.dependency_hi), assumption_hi: num(p?.assumption_hi),
            overdue_hi: num(p?.overdue_hi),
          });
        } catch {
        } finally {
          if (!cancelled) setRaidLoading(false);
        }
      })();
    });
    return () => { cancelled = true; };
  }, [ok, isExec, numericWindowDays]);

  const raidDueTotal = useMemo(() => {
    const r = num(raidPanel?.risk_due);
    const i = num(raidPanel?.issue_due);
    const d = num(raidPanel?.dependency_due);
    const a = num(raidPanel?.assumption_due);
    const sum = r + i + d + a;
    return sum > 0 ? sum : num(raidPanel?.due_total);
  }, [raidPanel]);

  function openRaidDrilldown() {
    const sp = new URLSearchParams();
    sp.set("days", String(numericWindowDays));
    sp.set("scope", "due");
    router.push(`/risks?${sp.toString()}`);
  }
  function openRaid(type?: "Risk" | "Issue" | "Dependency" | "Assumption", extra?: { overdue?: boolean; hi?: boolean }) {
    const sp = new URLSearchParams();
    sp.set("days", String(numericWindowDays));
    if (type) sp.set("type", type);
    if (extra?.overdue) sp.set("overdue", "1");
    if (extra?.hi) sp.set("severity", "hi");
    router.push(`/risks?${sp.toString()}`);
  }

  useEffect(() => {
    if (!ok || !isExec) return;
    let cancelled = false;
    runIdle(() => {
      (async () => {
        try {
          setDueLoading(true); setDueErr("");
          const j = await fetchJson<ArtifactDueResp>("/api/ai/events", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            body: JSON.stringify({ eventType: "artifact_due", windowDays: dueWindowDays }),
          });
          if (!j || !j.ok) throw new Error((j as any)?.error || "Failed");
          const ai = (j as any).ai as ArtifactDueAi;
          const list = Array.isArray(ai?.dueSoon) ? ai.dueSoon : [];
          const c = ai?.counts || ({} as any);
          const counts = {
            milestone: num(c.milestone), work_item: num(c.work_item), raid: num(c.raid),
            artifact: num(c.artifact), change: num(c.change),
            total: num(c.milestone) + num(c.work_item) + num(c.raid) + num(c.artifact) + num(c.change),
          };
          const merged = list.slice().sort((a, b) => {
            const at = a?.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
            const bt = b?.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
            if (at !== bt) return at - bt;
            return safeStr(a?.title).localeCompare(safeStr(b?.title));
          }).slice(0, 30).map((x) => ({ ...x, title: safeStr(x?.title).trim() || "Untitled", link: safeStr(x?.link).trim() || null }));
          if (!cancelled) { setDueItems(merged); setDueCounts(counts); setDueUpdatedAt(new Date().toISOString()); }
        } catch (e: any) {
          if (!cancelled) {
            setDueErr(e?.message || "Failed");
            setDueItems([]);
            setDueCounts({ total: 0, milestone: 0, work_item: 0, raid: 0, artifact: 0, change: 0 });
          }
        } finally {
          if (!cancelled) setDueLoading(false);
        }
      })();
    });
    return () => { cancelled = true; };
  }, [ok, isExec, dueWindowDays]);

  function openDueItem(it: DueDigestItem) {
    const href = safeStr(it?.link).trim();
    if (href) router.push(href);
  }

  const activeProjects = useMemo(() => {
    const arr = Array.isArray(projects) ? [...projects] : [];
    const norm = (v: any) => String(v ?? "").toLowerCase().trim();
    const truthy = (v: any) => v === true || v === "true" || v === 1 || v === "1";
    const isInactive = (p: any) => {
      if (p?.deleted_at || p?.deletedAt) return true;
      if (truthy(p?.is_deleted) || truthy(p?.deleted)) return true;
      if (truthy(p?.is_archived) || truthy(p?.archived)) return true;
      if (p?.archived_at) return true;
      if (p?.is_active === false) return true;
      if (p?.active === false) return true;
      const st = [p?.status, p?.lifecycle_state, p?.state, p?.phase].map(norm).find(Boolean) || "";
      if (!st) return false;
      return (
        st.includes("closed") || st.includes("cancel") || st.includes("cancell") ||
        st.includes("deleted") || st.includes("archive") || st.includes("inactive") || st.includes("complete")
      );
    };
    return arr.filter((p: any) => !isInactive(p));
  }, [projects]);

  const sortedProjects = useMemo(() => {
    const arr = Array.isArray(activeProjects) ? [...activeProjects] : [];
    arr.sort((a: any, b: any) => {
      const ac = projectCodeLabel(a?.project_code);
      const bc = projectCodeLabel(b?.project_code);
      const an = Number(ac); const bn = Number(bc);
      const aIsNum = Number.isFinite(an) && ac !== "";
      const bIsNum = Number.isFinite(bn) && bc !== "";
      if (aIsNum && bIsNum && an !== bn) return an - bn;
      if (ac && bc && ac !== bc) return ac.localeCompare(bc);
      return safeStr(a?.title).toLowerCase().localeCompare(safeStr(b?.title).toLowerCase());
    });
    return arr;
  }, [activeProjects]);

  const ragAgg = useMemo(() => calcRagAgg(rag, activeProjects), [rag, activeProjects]);
  const uiActiveCount = activeProjects?.length || 0;
  const apiScore = phData?.ok ? clamp01to100(phData.portfolio_health) : null;
  const fallbackScore = ragAgg.scored ? ragAgg.avgHealth : clamp01to100(kpis.portfolioHealth);
  const portfolioScore = phLoading ? null : apiScore ?? fallbackScore;
  const phDelta = portfolioScore != null && phPrevScore != null && Number.isFinite(Number(portfolioScore)) && Number.isFinite(Number(phPrevScore))
    ? Number(portfolioScore) - Number(phPrevScore) : null;
  const phMetaLine = phPrevLoading ? "Trend: loading…" : phPrevErr ? "Trend: —" : phDelta == null ? "Trend: —" : `Trend: ${fmtDelta(phDelta)}`;
  const phTooltip = portfolioThresholdsTooltip() + "\n\nTrend arrow compares current window vs the next longer window.";
  const phScoreForUi = clamp01to100(portfolioScore ?? fallbackScore);
  const phRag = scoreToRag(phScoreForUi);

  const topStories: SuccessStoryTop[] = ssSummary && ssSummary.ok && Array.isArray(ssSummary.top) ? ssSummary.top : [];
  const active = topStories.length ? topStories[Math.min(ssIdx, topStories.length - 1)] : null;
  const ssScore = ssSummary && ssSummary.ok ? clamp01to100(ssSummary.score) : 0;
  const ssDelta = ssSummary && ssSummary.ok && Number.isFinite(Number(ssSummary.delta)) ? Number(ssSummary.delta) : null;
  const ssBreakdown = ssSummary && ssSummary.ok ? ssSummary.breakdown : undefined;
  const ssCountFromBreakdown = ssBreakdown ? sumSuccessBreakdown(ssBreakdown) : 0;
  const ssDisplayCount = ssCountFromBreakdown > 0 ? ssCountFromBreakdown : ssSummary && ssSummary.ok ? num(ssSummary.count, 0) : 0;
  const ssValue = ssLoading ? "…" : ssErr ? "—" : `${ssDisplayCount}`;
  const ssSub = ssLoading ? "Loading stories…" : ssErr ? "Success stories unavailable" : active ? active.title : ssDisplayCount > 0 ? `${ssDisplayCount} success stor${ssDisplayCount === 1 ? "y" : "ies"} in ${windowNarr}` : `No success stories in ${windowNarr}`;
  const ssMetaLine = ssLoading ? `Window: ${windowLabel}` : ssErr ? "Check /api/success-stories/summary" : ssDisplayCount > 0 ? `— ${ssScore}% confidence · ${active?.project_title || "Portfolio"}` : `Window: ${windowLabel}`;
  const ssAiLine = ssLoading ? "Analysing delivery artifacts…" : ssErr ? ssErr : active ? active.summary : "As milestones complete and risks close, Success Stories will appear automatically.";
  const ssTooltip = "Generated from delivery artifacts. Click to view all.";
  function openSuccessStories() {
    const sp = new URLSearchParams();
    sp.set("days", String(numericWindowDays));
    router.push(`/success-stories?${sp.toString()}`);
  }

  if (!ok) {
    return (
      <div className="min-h-screen bg-[#F8FAFF] grid place-items-center p-10">
        <div className="max-w-lg rounded-2xl border border-slate-200 bg-white p-10" style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}>
          <div className="text-2xl font-bold text-slate-950">Dashboard Error</div>
          <div className="mt-3 text-slate-500">{(data as any).error}</div>
        </div>
      </div>
    );
  }

  const phBand = portfolioScore != null
    ? phScoreForUi >= 85 ? "Strong" : phScoreForUi >= 70 ? "Healthy" : phScoreForUi >= 55 ? "Mixed" : "At Risk"
    : "Loading";

  const KPI_CARD_CLASS = "h-[460px] flex flex-col";

  return (
    <LazyMotion features={domAnimation}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wdth,wght@0,75..100,400..700;1,75..100,400..700&family=DM+Mono:wght@400;500&display=swap');
        * { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
        :root { --font-body: 'Instrument Sans', sans-serif; --font-mono: 'DM Mono', monospace; }
        html, body { font-family: var(--font-body) !important; }
        .font-mono, .mono { font-family: var(--font-mono) !important; }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        .sk { background: linear-gradient(90deg, #f1f5f9 25%, #e8edf4 50%, #f1f5f9 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; }
        @keyframes float-slow { 0%, 100% { transform: translateY(0px) scale(1); } 50% { transform: translateY(-8px) scale(1.01); } }
        @keyframes pulse-glow { 0%, 100% { opacity: 0.5; } 50% { opacity: 0.9; } }
        ::-webkit-scrollbar { width: 4px; } 
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
      `}</style>

      <div
        className="relative min-h-screen text-slate-900 selection:bg-indigo-100 selection:text-indigo-900"
        style={{ background: "#F6F8FF", fontFamily: "var(--font-body, 'Instrument Sans', sans-serif)" }}
      >
        {/* ── Background ── */}
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
          <div className="absolute inset-0" style={{ background: "linear-gradient(160deg, #F0F4FF 0%, #F8F9FE 40%, #F5F7FF 100%)" }} />
          {/* Soft orbs */}
          <div className="absolute -top-32 -right-32 w-[700px] h-[700px] rounded-full opacity-40"
            style={{ background: "radial-gradient(ellipse, rgba(199,210,254,0.6) 0%, transparent 65%)", animation: "float-slow 12s ease-in-out infinite" }} />
          <div className="absolute bottom-0 -left-32 w-[550px] h-[550px] rounded-full opacity-35"
            style={{ background: "radial-gradient(ellipse, rgba(167,243,208,0.5) 0%, transparent 65%)", animation: "float-slow 15s ease-in-out infinite reverse" }} />
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[400px] h-[400px] rounded-full opacity-20"
            style={{ background: "radial-gradient(ellipse, rgba(251,207,232,0.4) 0%, transparent 65%)" }} />
          {/* Dot grid */}
          <div className="absolute inset-0 opacity-[0.18]"
            style={{ backgroundImage: "radial-gradient(circle, rgba(99,102,241,0.35) 1px, transparent 1px)", backgroundSize: "32px 32px" }} />
          {/* Horizontal lines */}
          <div className="absolute inset-0 opacity-[0.04]"
            style={{ backgroundImage: "linear-gradient(0deg, transparent calc(100% - 1px), rgba(99,102,241,0.5) calc(100% - 1px))", backgroundSize: "100% 80px" }} />
        </div>

        <div className="relative mx-auto max-w-7xl px-6 py-8 z-10">
          {/* ── Header ── */}
          <header className="mb-12">
            <m.div
              initial={{ opacity: 0, y: -14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
              className="flex items-center justify-between"
            >
              <div className="flex items-center gap-4">
                <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl overflow-hidden"
                  style={{ background: "linear-gradient(135deg, #6366f1, #4f46e5)", boxShadow: "0 4px 16px rgba(99,102,241,0.35), 0 1px 0 rgba(255,255,255,0.15) inset" }}>
                  <Layers className="h-5.5 w-5.5 text-white relative z-10" style={{ width: 22, height: 22 }} />
                  <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.15) 0%, transparent 60%)" }} />
                </div>
                <div>
                  <h1 className="text-xl font-bold tracking-tight text-slate-900 leading-none flex items-center gap-2.5">
                    <span className="text-indigo-600 font-bold" style={{ letterSpacing: "-0.02em" }}>ΛLIΞNΛ</span>
                    <span className="h-4 w-px bg-slate-200" />
                    <span className="text-slate-400 font-medium text-base">PM Suite</span>
                  </h1>
                  <p className="text-xs text-slate-400 mt-1 font-medium tracking-wide">{today}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <NotificationBell />
              </div>
            </m.div>
            <m.div
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 1 }}
              transition={{ duration: 0.9, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="mt-8 origin-left h-px"
              style={{ background: "linear-gradient(90deg, #6366f1 0%, #a5b4fc 40%, rgba(199,210,254,0.4) 80%, transparent 100%)" }}
            />
          </header>

          {isExec ? (
            <>
              {/* Section header + window toggle */}
              <m.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6"
              >
                <div>
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className="h-5 w-0.5 rounded-full bg-indigo-500" style={{ boxShadow: "0 0 8px rgba(99,102,241,0.5)" }} />
                    <span className="text-[11px] text-indigo-600 uppercase tracking-[0.2em] font-bold">Executive Command</span>
                  </div>
                  <h2 className="text-3xl font-bold text-slate-950 tracking-tight">Portfolio Overview</h2>
                  <p className="text-slate-400 mt-1 text-sm font-medium">Real-time portfolio intelligence</p>
                </div>
                <div className="flex items-center gap-1 p-1 rounded-xl bg-white/80 border border-white/90"
                  style={{ backdropFilter: "blur(16px)", boxShadow: "0 2px 8px rgba(0,0,0,0.05), 0 1px 0 rgba(255,255,255,1) inset" }}>
                  {[7, 14, 30, 60].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setWindowDays(d as WindowDays)}
                      className={["px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200",
                        windowDays === d
                          ? "bg-indigo-600 text-white shadow-sm"
                          : "text-slate-500 hover:text-slate-800 hover:bg-slate-50/80",
                      ].join(" ")}
                      style={windowDays === d ? { boxShadow: "0 2px 8px rgba(99,102,241,0.3)" } : {}}
                    >
                      {d}d
                    </button>
                  ))}
                  <div className="w-px h-5 bg-slate-200 mx-1" />
                  <button
                    type="button"
                    onClick={() => setWindowDays("all")}
                    className={["px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200",
                      windowDays === "all" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-800 hover:bg-slate-50/80",
                    ].join(" ")}
                    style={windowDays === "all" ? { boxShadow: "0 2px 8px rgba(99,102,241,0.3)" } : {}}
                  >
                    All Time
                  </button>
                </div>
              </m.div>

              {/* ── KPI Cards ── */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
                {/* Portfolio Health */}
                <KpiCard
                  cardClassName={KPI_CARD_CLASS}
                  label="Portfolio Health"
                  value={phBand}
                  sub={`${ragAgg.g} Green · ${ragAgg.a} Amber · ${ragAgg.r} Red`}
                  icon={<Activity className="h-5 w-5" />}
                  tone="indigo"
                  tooltip={phTooltip}
                  metaLine={phMetaLine}
                  metaIcon={trendIcon(phDelta)}
                  aiLine={portfolioScore != null ? healthNarrative(portfolioScore) : "Loading..."}
                  rightVisual={<PortfolioHealthRing score={phScoreForUi} rag={phRag} />}
                  badge={
                    <span className={["ml-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest", ragBadgeClasses(phRag)].join(" ")}>
                      {ragLabel(phRag)}
                    </span>
                  }
                  extra={
                    <div className="space-y-3">
                      {phErr && <div className="text-xs text-rose-700 bg-rose-50/80 border border-rose-200/60 rounded-xl px-3 py-2">{phErr}</div>}
                      {phData?.ok && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setShowPhDetails((v) => !v); }}
                          className="w-full h-9 rounded-xl border border-slate-200/80 bg-white/60 text-xs text-slate-600 hover:bg-white/90 hover:text-slate-900 transition-all flex items-center justify-center gap-2"
                          style={{ backdropFilter: "blur(8px)", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
                        >
                          {showPhDetails ? "Hide Details" : "View Drivers"}
                          <ChevronRight className={`h-3 w-3 transition-transform ${showPhDetails ? "rotate-90" : ""}`} />
                        </button>
                      )}
                      {showPhDetails && phData?.ok && <PortfolioHealthDrivers parts={phData.parts} drivers={phData.drivers} />}
                    </div>
                  }
                  delay={0}
                />

                {/* Success Stories */}
                <KpiCard
                  cardClassName={KPI_CARD_CLASS}
                  label="Success Stories"
                  value={ssValue}
                  sub={ssSub}
                  icon={<Trophy className="h-5 w-5" />}
                  tone="amber"
                  tooltip={ssTooltip}
                  metaLine={ssMetaLine}
                  metaIcon={trendIcon(ssDelta)}
                  aiLine={ssAiLine}
                  onClick={() => openSuccessStories()}
                  extra={
                    <div className="mt-auto pt-4">
                      {ssSummary && ssSummary.ok ? (
                        <SuccessStoryMeta
                          loading={ssLoading}
                          displayTotal={ssDisplayCount}
                          meta={{
                            milestones_completed: num(ssSummary.breakdown?.milestones_done),
                            raid_closed: num(ssSummary.breakdown?.raid_resolved),
                            changes_implemented: num(ssSummary.breakdown?.changes_delivered),
                            wbs_done: num(ssSummary.breakdown?.wbs_done),
                            lessons_published: num(ssSummary.breakdown?.lessons_positive),
                          }}
                        />
                      ) : null}
                      <div className="mt-4 space-y-2">
                        <Button
                          variant="outline"
                          className="w-full border-slate-200/80 bg-white/60 text-slate-700 hover:bg-white/90 hover:text-slate-900 rounded-xl"
                          style={{ backdropFilter: "blur(8px)", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
                          onClick={(e) => { e.stopPropagation(); openSuccessStories(); }}
                        >
                          View Summary <ArrowUpRight className="ml-2 h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  }
                  delay={0.05}
                />

                {/* Milestones Due — with AI Summary Panel */}
                <KpiCard
                  cardClassName={KPI_CARD_CLASS}
                  label="Milestones Due"
                  value={milestonesDueLoading ? "…" : `${milestonesDueLive}`}
                  sub={windowDays === "all" ? "Using last 60 days" : `Next ${windowDays} days`}
                  icon={<Clock3 className="h-5 w-5" />}
                  tone="cyan"
                  onClick={openMilestonesDrilldown}
                  extra={
                    <div>
                      <MilestonesMeta loading={milestonesPanelLoading} panel={milestonesPanel} />
                      <MilestonesAiSummary
                        loading={milestonesPanelLoading}
                        panel={milestonesPanel}
                        windowDays={numericWindowDays}
                      />
                    </div>
                  }
                  delay={0.1}
                />

                {/* RAID — with AI Summary Panel */}
                <KpiCard
                  cardClassName={KPI_CARD_CLASS}
                  label="RAID — Due"
                  value={raidLoading ? "…" : `${raidDueTotal}`}
                  sub={windowDays === "all" ? "Using last 60 days" : `Window ${windowDays}d`}
                  icon={<AlertTriangle className="h-5 w-5" />}
                  tone="rose"
                  onClick={openRaidDrilldown}
                  extra={
                    <div>
                      <RaidMeta loading={raidLoading} panel={raidPanel} onClickType={openRaid} />
                      <RaidAiSummary
                        loading={raidLoading}
                        panel={raidPanel}
                        windowDays={numericWindowDays}
                      />
                    </div>
                  }
                  delay={0.15}
                />
              </div>

              {/* ── Bottom Section ── */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                  {/* AI Briefing */}
                  <SurfaceCard delay={0.2}>
                    <div className="flex items-start justify-between mb-6">
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl text-white"
                          style={{ background: "linear-gradient(135deg,#6366f1,#4f46e5)", boxShadow: "0 4px 14px rgba(99,102,241,0.3), 0 1px 0 rgba(255,255,255,0.15) inset" }}>
                          <Sparkles className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="text-lg font-bold text-slate-900">AI Daily Briefing</h3>
                          <p className="text-sm text-slate-400 font-medium">Live governance signals</p>
                        </div>
                      </div>
                      <Button
                        className="text-white text-sm rounded-xl"
                        style={{ background: "linear-gradient(135deg,#6366f1,#4f46e5)", boxShadow: "0 2px 10px rgba(99,102,241,0.3)" }}
                        onClick={() => router.push("/insights")}
                      >
                        View All
                      </Button>
                    </div>
                    <div className="space-y-3">
                      {insightsLoading ? (
                        <><SkeletonAlert /><SkeletonAlert /><SkeletonAlert /></>
                      ) : insightsErr ? (
                        <AiAlert severity="medium" title="Briefing unavailable" body={insightsErr} />
                      ) : (
                        insights.slice(0, 4).map((x, i) => (
                          <m.div key={`${x.id}-${x.title}`} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, delay: i * 0.07 }}>
                            <AiAlert severity={x.severity} title={x.title} body={x.body} href={fixInsightHref(x, windowDays)} />
                          </m.div>
                        ))
                      )}
                    </div>
                  </SurfaceCard>

                  {/* Due Soon */}
                  <SurfaceCard delay={0.25}>
                    <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl text-white"
                          style={{ background: "linear-gradient(135deg,#f59e0b,#d97706)", boxShadow: "0 4px 14px rgba(245,158,11,0.3), 0 1px 0 rgba(255,255,255,0.15) inset" }}>
                          <Clock3 className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="text-lg font-bold text-slate-900">Due Soon</h3>
                          <p className="text-sm text-slate-400 font-medium">Next {dueWindowDays} days</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 p-1 rounded-xl bg-white/70 border border-slate-200/60"
                        style={{ backdropFilter: "blur(8px)", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                        {[7, 14, 30].map((d) => (
                          <button key={d} type="button" onClick={() => setDueWindowDays(d as any)}
                            className={["px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                              dueWindowDays === d ? "bg-amber-500 text-white shadow-sm" : "text-slate-500 hover:text-slate-700 hover:bg-slate-50/80",
                            ].join(" ")}
                            style={dueWindowDays === d ? { boxShadow: "0 2px 6px rgba(245,158,11,0.3)" } : {}}
                          >
                            {d}d
                          </button>
                        ))}
                      </div>
                    </div>
                    {dueCounts.total > 0 ? (
                      <div className="rounded-2xl border border-slate-200/70 overflow-hidden bg-white/60"
                        style={{ backdropFilter: "blur(12px)", boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 1px 0 rgba(255,255,255,0.9) inset" }}>
                        <div className="px-4 py-2.5 border-b border-slate-100/80 flex items-center justify-between text-[10px] text-slate-400 uppercase tracking-widest font-bold bg-slate-50/60">
                          <span>Item</span>
                          <span>Due Date</span>
                        </div>
                        <div className="max-h-[320px] overflow-auto divide-y divide-slate-100/60">
                          {dueItems.slice(0, 8).map((it, idx) => {
                            const overdue = isOverdue(it?.dueDate);
                            const clickable = Boolean(safeStr(it?.link).trim());
                            return (
                              <m.button
                                key={idx}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: idx * 0.04 }}
                                type="button"
                                onClick={() => clickable && openDueItem(it)}
                                className={["w-full text-left px-4 py-3 flex items-center justify-between transition-all group",
                                  clickable ? "hover:bg-indigo-50/40 cursor-pointer" : "cursor-default",
                                  overdue ? "bg-rose-50/40" : "",
                                ].join(" ")}
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <span className={["shrink-0 inline-flex items-center rounded-lg border px-2 py-0.5 text-[10px] uppercase tracking-wider font-bold", dueChipTone(it.itemType)].join(" ")}>
                                    {dueTypeLabel(it.itemType)}
                                  </span>
                                  <span className="text-sm text-slate-700 truncate group-hover:text-slate-900 transition-colors font-medium">{it.title}</span>
                                  {overdue && (
                                    <span className="shrink-0 text-[10px] font-bold text-rose-700 bg-rose-50/80 border border-rose-200/60 px-1.5 py-0.5 rounded-lg uppercase tracking-wide">
                                      Overdue
                                    </span>
                                  )}
                                </div>
                                <span className="text-xs text-slate-400 shrink-0 ml-4 mono">{dueDateLabel(it.dueDate)}</span>
                              </m.button>
                            );
                          })}
                        </div>
                        {dueItems.length > 8 && (
                          <div className="px-4 py-2.5 text-center border-t border-slate-100/80 bg-white/50">
                            <button onClick={() => router.push(`/milestones?days=${dueWindowDays}`)}
                              className="text-xs text-indigo-600 hover:text-indigo-700 font-bold transition-colors">
                              View {dueItems.length - 8} more items →
                            </button>
                          </div>
                        )}
                      </div>
                    ) : dueLoading ? (
                      <div className="rounded-2xl border border-slate-200/60 bg-slate-50/60 px-4 py-12 text-center">
                        <div className="text-sm text-slate-400 font-medium">Scanning artifacts…</div>
                      </div>
                    ) : (
                      <div className="text-center py-12 border border-dashed border-slate-200/70 rounded-2xl bg-white/40">
                        <CheckCircle2 className="h-8 w-8 text-slate-300 mx-auto mb-3" />
                        <p className="text-slate-600 font-semibold">All caught up</p>
                        <p className="text-sm text-slate-400 mt-1 font-medium">Nothing due in the next {dueWindowDays} days</p>
                      </div>
                    )}
                  </SurfaceCard>
                </div>

                {/* Right column */}
                <div className="space-y-6">
                  {/* Approvals */}
                  <SurfaceCard delay={0.3}>
                    <div className="flex items-center justify-between mb-5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl text-white"
                          style={{ background: "linear-gradient(135deg,#10b981,#059669)", boxShadow: "0 4px 14px rgba(16,185,129,0.3), 0 1px 0 rgba(255,255,255,0.15) inset" }}>
                          <CheckCircle2 className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="text-base font-bold text-slate-900">Approvals</h3>
                          <p className="text-xs text-slate-400 font-medium">{approvalCount} pending</p>
                        </div>
                      </div>
                      {approvalCount > 0 && (
                        <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-emerald-100/80 border border-emerald-200/60 text-xs font-bold text-emerald-700">
                          {approvalCount}
                        </span>
                      )}
                    </div>
                    <div className="space-y-3">
                      {approvalItems?.length ? (
                        approvalItems.slice(0, 4).map((t: any) => {
                          const taskId = String(t?.id || "");
                          const isBusy = Boolean(pendingIds[taskId]);
                          const title = t?.change?.title || "Change request";
                          const createdAt = t?.change?.created_at || t?.created_at;
                          const href = viewHref(t);
                          return (
                            <m.div
                              key={taskId}
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="rounded-xl border border-slate-200/70 bg-white/50 p-4 hover:border-slate-300 hover:bg-white/80 transition-all"
                              style={{ backdropFilter: "blur(8px)", boxShadow: "0 1px 3px rgba(0,0,0,0.03), 0 1px 0 rgba(255,255,255,0.9) inset" }}
                            >
                              <div className="flex items-start justify-between gap-3 mb-3">
                                <div className="min-w-0">
                                  <div className="font-semibold text-sm text-slate-800 truncate">{title}</div>
                                  <div className="text-xs text-slate-400 mt-1 mono font-medium">
                                    {createdAt ? new Date(createdAt).toISOString().slice(0, 10) : "—"}
                                  </div>
                                </div>
                                {href && (
                                  <a href={href} className="shrink-0 text-slate-400 hover:text-indigo-600 transition-colors">
                                    <ArrowUpRight className="h-4 w-4" />
                                  </a>
                                )}
                              </div>
                              <div className="flex gap-2">
                                <Button size="sm"
                                  className="flex-1 h-8 rounded-xl border text-xs font-semibold transition-all"
                                  style={{ background: "linear-gradient(135deg, rgba(236,253,245,0.9), rgba(209,250,229,0.7))", borderColor: "rgba(167,243,208,0.8)", color: "#065f46", boxShadow: "0 1px 3px rgba(16,185,129,0.1)" }}
                                  disabled={isBusy}
                                  onClick={() => decide(taskId, "approve")}
                                >
                                  {isBusy ? "…" : "Approve"}
                                </Button>
                                <Button size="sm"
                                  className="flex-1 h-8 rounded-xl border text-xs font-semibold transition-all"
                                  style={{ background: "linear-gradient(135deg, rgba(255,241,242,0.9), rgba(254,226,226,0.7))", borderColor: "rgba(254,202,202,0.8)", color: "#9f1239", boxShadow: "0 1px 3px rgba(244,63,94,0.1)" }}
                                  disabled={isBusy}
                                  onClick={() => decide(taskId, "reject")}
                                >
                                  {isBusy ? "…" : "Reject"}
                                </Button>
                              </div>
                            </m.div>
                          );
                        })
                      ) : (
                        <div className="text-center py-8 border border-dashed border-slate-200/70 rounded-xl bg-white/40">
                          <CheckCheck className="h-6 w-6 text-slate-300 mx-auto mb-2" />
                          <p className="text-sm text-slate-500 font-semibold">No approvals waiting</p>
                        </div>
                      )}
                    </div>
                  </SurfaceCard>

                  {/* Quick Stats */}
                  <SurfaceCard delay={0.35}>
                    <div className="flex items-center gap-2 mb-5">
                      <div className="h-px flex-1 bg-gradient-to-r from-transparent to-indigo-200/60" />
                      <span className="text-[10px] text-indigo-500 uppercase tracking-[0.18em] font-bold">Quick Stats</span>
                      <div className="h-px flex-1 bg-gradient-to-l from-transparent to-indigo-200/60" />
                    </div>
                    <div className="space-y-4">
                      {[
                        {
                          label: "Active Projects",
                          node: (
                            <span className="text-2xl font-bold text-slate-950" style={{ fontFamily: "var(--font-mono, monospace)" }}>
                              {uiActiveCount}
                            </span>
                          )
                        },
                        {
                          label: "Portfolio Score",
                          node: (
                            <span className={["text-sm font-bold px-2.5 py-1 rounded-xl border-2", ragBadgeClasses(phRag)].join(" ")}>
                              {phScoreForUi}%
                            </span>
                          )
                        },
                        {
                          label: "Open Risks",
                          node: (
                            <span className="text-2xl font-bold text-slate-950" style={{ fontFamily: "var(--font-mono, monospace)" }}>
                              {kpis.openRisks}
                            </span>
                          )
                        },
                      ].map((stat, i) => (
                        <m.div key={stat.label} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.4 + i * 0.05 }}
                          className="flex items-center justify-between p-3 rounded-xl bg-white/50 border border-slate-100/80"
                          style={{ backdropFilter: "blur(8px)", boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }}>
                          <span className="text-sm text-slate-500 font-medium">{stat.label}</span>
                          {stat.node}
                        </m.div>
                      ))}
                    </div>
                  </SurfaceCard>
                </div>
              </div>

              {/* ── Project Overview ── */}
              <m.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.4 }} className="mt-12">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <div className="flex items-center gap-2.5 mb-1.5">
                      <div className="h-4 w-0.5 rounded-full bg-indigo-400" style={{ boxShadow: "0 0 6px rgba(99,102,241,0.4)" }} />
                      <span className="text-[11px] text-indigo-500 uppercase tracking-[0.18em] font-bold">Active Engagements</span>
                    </div>
                    <h2 className="text-2xl font-bold text-slate-950">Project Overview</h2>
                  </div>
                  <Button variant="outline"
                    className="border-slate-200/80 bg-white/70 text-slate-600 hover:bg-white/90 hover:text-slate-900 rounded-xl"
                    style={{ backdropFilter: "blur(8px)", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
                    View All Projects
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {sortedProjects.slice(0, 9).map((p: any, i) => {
                    const code = projectCodeLabel(p.project_code);
                    const id = String(p?.id || "").trim();
                    return (
                      <m.div key={String(p.id || id)} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.45 + i * 0.04 }}>
                        <ProjectTile projectRef={id} title={p.title || "Project"} projectCode={code} clientName={safeStr(p.client_name)} />
                      </m.div>
                    );
                  })}
                </div>
                {projects.length !== activeProjects.length && (
                  <div className="mt-5 text-xs text-slate-400 text-center font-medium">
                    {Math.max(0, projects.length - activeProjects.length)} closed/cancelled project{projects.length - activeProjects.length === 1 ? "" : "s"} hidden from view
                  </div>
                )}
              </m.div>
            </>
          ) : (
            <>
              <m.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="h-4 w-0.5 rounded-full bg-indigo-400" />
                  <span className="text-[11px] text-indigo-500 uppercase tracking-[0.18em] font-bold">Personal</span>
                </div>
                <h2 className="text-3xl font-bold text-slate-900">My Day</h2>
                <p className="text-slate-400 mt-1 font-medium">Focus and flow</p>
              </m.div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <KpiCard label="My Approvals" value={`${approvalCount}`} icon={<CheckCircle2 className="h-5 w-5" />} tone="emerald" delay={0} />
                <KpiCard label="Open Lessons" value={`${kpis.openLessons}`} icon={<Sparkles className="h-5 w-5" />} tone="indigo" delay={0.05} />
                <KpiCard
                  label="RAID (Due)"
                  value={raidLoading ? "…" : `${raidDueTotal || Number(kpis.openRisks || 0)}`}
                  sub={`Window ${numericWindowDays}d`}
                  icon={<AlertTriangle className="h-5 w-5" />}
                  tone="rose"
                  onClick={openRaidDrilldown}
                  extra={
                    <div>
                      <RaidMeta loading={raidLoading} panel={raidPanel} onClickType={openRaid} />
                      <RaidAiSummary loading={raidLoading} panel={raidPanel} windowDays={numericWindowDays} />
                    </div>
                  }
                  delay={0.1}
                />
              </div>
            </>
          )}
          <div className="h-20" />
        </div>
      </div>
    </LazyMotion>
  );
}