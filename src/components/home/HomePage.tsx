// src/components/home/HomePage.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// ✅ Perf: LazyMotion reduces framer-motion feature bundle
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
} from "lucide-react";

/* ─────────────────────────────────────────────────────────────
   ☁️ LIGHT THEME SYSTEM
   - Palette: Cloud White & Slate
   - Elevation: Clean shadows, subtle borders
   - Accent: Indigo (Professional)
───────────────────────────────────────────────────────────── */

const THEME = {
  // Background (Clean Light)
  pageBg: "bg-gray-50 text-gray-900",
  pageGrad: "from-white via-gray-50 to-gray-100",

  // Accent (Indigo)
  accent: "#4f46e5", // Indigo 600
  accentLight: "#e0e7ff", // Indigo 100

  // ✅ Neon (requested)
  neon: "#00B8DB",

  // Text Hierarchy
  textPrimary: "text-gray-900",
  textSecondary: "text-gray-600",
  textTertiary: "text-gray-400",
  textMuted: "text-gray-500",

  // Surfaces (Clean Cards)
  cardBg: "bg-white",
  cardBorder: "border-gray-200",
  cardBorderHover: "hover:border-indigo-300",
  cardShadow: "shadow-sm shadow-gray-200/50",
  cardShadowHover: "hover:shadow-md hover:shadow-gray-200/50",

  // Status Colors (Refined for Light)
  success: "text-emerald-700 bg-emerald-50 border-emerald-200",
  warning: "text-amber-700 bg-amber-50 border-amber-200",
  danger: "text-rose-700 bg-rose-50 border-rose-200",
  info: "text-indigo-700 bg-indigo-50 border-indigo-200",

  // Interactive
  buttonGhost: "hover:bg-gray-100 text-gray-600 hover:text-gray-900",
  buttonPrimary: "bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm shadow-indigo-200",
} as const;

type WindowDays = 7 | 14 | 30 | 60 | "all";

/* ─────────────────────────────────────────────────────────────
   Types & Interfaces
───────────────────────────────────────────────────────────── */
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

/* ─────────────────────────────────────────────────────────────
   Utility Functions
───────────────────────────────────────────────────────────── */
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

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function timeAgo(iso: string) {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - t;

  if (!Number.isFinite(t) || diffMs < 0) return `just now`;

  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m2 = Math.floor(s / 60);
  if (m2 < 60) return `${m2}m ago`;
  const h = Math.floor(m2 / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function groupLabel(createdAtIso: string) {
  const ageH = (Date.now() - new Date(createdAtIso).getTime()) / 36e5;
  if (ageH < 24) return "Today";
  if (ageH < 24 * 7) return "This week";
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
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide";
  if (sev === "high") return `${base} ${THEME.danger}`;
  if (sev === "medium") return `${base} ${THEME.warning}`;
  if (sev === "success") return `${base} ${THEME.success}`;
  return `${base} ${THEME.info}`;
}

function tabMatch(tab: BellTab, n: NotifRow) {
  if (tab === "all") return true;
  if (tab === "approvals") return typeLooksApproval(n.type);
  if (tab === "ai") return typeLooksAI(n.type);
  if (tab === "action") return typeLooksAction(n.type);
  return true;
}

function runIdle(fn: () => void) {
  // @ts-ignore
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    // @ts-ignore
    return window.requestIdleCallback(fn, { timeout: 1200 });
  }
  return window.setTimeout(fn, 0);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const r = await fetch(url, init);
    if (!r.ok) return null;
    const j = (await r.json().catch(() => null)) as T | null;
    return j;
  } catch {
    return null;
  }
}

/* ─────────────────────────────────────────────────────────────
   RAG helpers
───────────────────────────────────────────────────────────── */
type RagLetter = "G" | "A" | "R";

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
  if (r === "G") return "#10b981"; // emerald-500
  if (r === "A") return "#f59e0b"; // amber-500
  return "#f43f5e"; // rose-500
}

/* ─────────────────────────────────────────────────────────────
   🔔 Notification Bell (Light Mode)
───────────────────────────────────────────────────────────── */
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
      const r = await fetch(`/api/notifications?limit=30`, { cache: "no-store" });
      const j: NotifApiResp = await r.json().catch(() => ({ ok: false, error: "Bad JSON" }));
      if (!j || !j.ok) throw new Error((j as any)?.error || "Failed to load notifications");
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
      // @ts-ignore
      if (typeof window !== "undefined" && typeof window.cancelIdleCallback === "function")
        // @ts-ignore
        window.cancelIdleCallback(id);
      else window.clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return;
    refresh();
    pollRef.current = setInterval(refresh, 15000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        className="relative rounded-lg border border-gray-200 bg-white p-2.5 transition hover:bg-gray-50 hover:border-gray-300 active:scale-95 shadow-sm"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5 text-gray-600" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white shadow-sm ring-2 ring-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <m.div
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="absolute right-0 top-full z-50 mt-2 w-[400px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl shadow-gray-200/50"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 bg-gray-50/50">
                <div className="flex items-center gap-3">
                  <div className="text-sm font-semibold text-gray-900">Notifications</div>
                  <span className="text-xs text-gray-500">{loading ? "Updating…" : `${unreadCount} unread`}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={markAllRead}
                    className="h-8 rounded-md border border-gray-200 bg-white px-3 text-xs text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors shadow-sm"
                  >
                    <CheckCheck className="mr-1.5 inline h-3.5 w-3.5" />
                    Mark all read
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="h-8 w-8 rounded-md border border-gray-200 bg-white p-0 hover:bg-gray-50 transition-colors shadow-sm inline-flex items-center justify-center"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4 text-gray-500" />
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-1 border-b border-gray-100 px-2 py-2 bg-gray-50/30">
                {(["all", "action", "ai", "approvals"] as BellTab[]).map((k) => {
                  const label =
                    k === "all" ? "All" : k === "action" ? "Action" : k === "ai" ? "AI" : "Approvals";
                  const active = tab === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setTab(k)}
                      className={[
                        "rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                        active
                          ? "bg-indigo-600 text-white shadow-sm"
                          : "bg-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100",
                      ].join(" ")}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* Content */}
              <div className="max-h-[480px] overflow-auto">
                {grouped.length === 0 ? (
                  <div className="px-4 py-12 text-center">
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                      <CheckCheck className="h-5 w-5 text-gray-400" />
                    </div>
                    <div className="text-sm font-medium text-gray-700">All caught up</div>
                    <div className="mt-1 text-xs text-gray-500">No new notifications to display.</div>
                  </div>
                ) : (
                  grouped.map(([label, rows]) => (
                    <div key={label}>
                      <div className="px-4 pt-4 pb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                        {label}
                      </div>
                      <div className="px-2 pb-2">
                        {rows.map((n) => {
                          const unread = n.is_read !== true;
                          const sev = severityFromNotif(n);
                          return (
                            <button
                              key={n.id}
                              type="button"
                              onClick={() => onClickItem(n)}
                              className={[
                                "mt-1 w-full rounded-lg border px-3 py-3 text-left transition-all group",
                                unread
                                  ? "border-gray-200 bg-white shadow-sm hover:border-gray-300"
                                  : "border-transparent bg-transparent hover:bg-gray-50",
                              ].join(" ")}
                            >
                              <div className="flex items-start gap-3">
                                <div
                                  className={[
                                    "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
                                    sev === "high"
                                      ? "border-rose-200 bg-rose-50 text-rose-600"
                                      : sev === "medium"
                                      ? "border-amber-200 bg-amber-50 text-amber-600"
                                      : sev === "success"
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-600"
                                      : "border-indigo-200 bg-indigo-50 text-indigo-600",
                                  ].join(" ")}
                                >
                                  {notifIcon(n)}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="truncate text-sm font-medium text-gray-900">{n.title}</div>
                                    <div className="shrink-0 text-[11px] text-gray-400">{timeAgo(n.created_at)}</div>
                                  </div>
                                  {n.body && (
                                    <div className="mt-1 line-clamp-2 text-xs text-gray-500 leading-relaxed">
                                      {n.body}
                                    </div>
                                  )}
                                  <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                                    <span className={severityChip(sev)}>{sev}</span>
                                    {unread && <span className="inline-flex h-1.5 w-1.5 rounded-full bg-indigo-600" />}
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

              <div className="border-t border-gray-100 px-4 py-3 bg-gray-50/50">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    router.push("/notifications");
                  }}
                  className="text-xs text-gray-500 hover:text-indigo-600 transition-colors flex items-center gap-1"
                >
                  View all notifications
                  <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            </m.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Existing Home types & helpers
───────────────────────────────────────────────────────────── */
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
  slippage?: {
    avg_slip_days?: number;
    max_slip_days?: number;
  };
};

type RaidPanel = {
  days: number;

  // ✅ "Due (in window)" counts (NOT high-score counts)
  due_total: number;

  // ✅ Overdue counts (separate)
  overdue_total: number;

  // ✅ Optional: due-by-type
  risk_due?: number;
  issue_due?: number;
  dependency_due?: number;
  assumption_due?: number;

  // ✅ Optional: overdue-by-type (only used if API provides)
  risk_overdue?: number;
  issue_overdue?: number;
  dependency_overdue?: number;
  assumption_overdue?: number;

  // (Legacy / API may still send these — keep for safety)
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

type SuccessStoriesSummary =
  | { ok: false; error: string }
  | {
      ok: true;
      days: number;
      score: number;
      prev_score: number;
      delta: number;
      count: number;
      breakdown?: {
        milestones_done?: number;
        wbs_done?: number;
        raid_resolved?: number;
        changes_delivered?: number;
        lessons_positive?: number;
      };
      top?: SuccessStoryTop[];
    };

type PortfolioHealthDriver = {
  key: "schedule" | "raid" | "flow" | "approvals" | "activity" | (string & {});
  label: string;
  score: number;
  detail?: string | null;
};

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

function trendIcon(delta: number | null | undefined) {
  const d = Number(delta);
  if (!Number.isFinite(d) || d === 0) return <Minus className="h-4 w-4" />;
  return d > 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />;
}

function fmtDelta(delta: number | null | undefined, suffix = "pts") {
  const d = Number(delta);
  if (!Number.isFinite(d) || d === 0) return `No change`;
  const sign = d > 0 ? "+" : "";
  return `${sign}${Math.round(d)} ${suffix}`;
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

  let g = 0,
    a = 0,
    r = 0,
    scored = 0;
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

  return {
    avgHealth: clamp01to100(avg),
    g,
    a,
    r,
    scored,
    unscored,
    projectsTotal,
  };
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

/* ─────────────────────────────────────────────────────────────
   Due soon helpers (client)
───────────────────────────────────────────────────────────── */
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

/* ─────────────────────────────────────────────────────────────
   🏠 Home Page (Light Mode)
───────────────────────────────────────────────────────────── */
export default function HomePage({ data }: { data: HomeData }) {
  const router = useRouter();

  const ok = data?.ok === true;
  const isExec = ok ? data.isExec : false;
  const projects = ok ? data.projects : [];
  const kpis = ok
    ? data.kpis
    : {
        portfolioHealth: 0,
        openRisks: 0,
        highRisks: 0,
        forecastVariance: 0,
        milestonesDue: 0,
        openLessons: 0,
      };
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
  const [dueCounts, setDueCounts] = useState<{
    total: number;
    milestone: number;
    work_item: number;
    raid: number;
    artifact: number;
    change: number;
  }>({
    total: 0,
    milestone: 0,
    work_item: 0,
    raid: 0,
    artifact: 0,
    change: 0,
  });
  const [dueUpdatedAt, setDueUpdatedAt] = useState<string>("");

  useEffect(() => {
    setApprovalItems(Array.isArray(approvals.items) ? approvals.items : []);
  }, [ok, approvals.items]);

  useEffect(() => {
    setToday(
      new Date().toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    );
  }, []);

  useEffect(() => {
    setShowPhDetails(false);
  }, [windowDays]);

  // Portfolio health (exec)
  useEffect(() => {
    if (!ok || !isExec) return;
    let cancelled = false;
    runIdle(() => {
      (async () => {
        try {
          setPhLoading(true);
          setPhErr("");
          const j = await fetchJson<PortfolioHealthApi>(`/api/portfolio/health?days=${windowDays}`, { cache: "no-store" });
          if (!j || !j.ok) throw new Error((j as any)?.error || "Failed to load portfolio health");
          if (!cancelled) setPhData(j);
        } catch (e: any) {
          if (!cancelled) {
            setPhErr(e?.message || "Failed to load portfolio health");
            setPhData(null);
          }
        } finally {
          if (!cancelled) setPhLoading(false);
        }
      })();
    });
    return () => {
      cancelled = true;
    };
  }, [ok, isExec, windowDays]);

  // previous-window trend (exec)
  useEffect(() => {
    if (!ok || !isExec) return;
    const cur: 7 | 14 | 30 | 60 = numericWindowDays;
    const prev = prevWindowDays(cur);
    let cancelled = false;

    runIdle(() => {
      (async () => {
        try {
          setPhPrevLoading(true);
          setPhPrevErr("");
          const j = await fetchJson<PortfolioHealthApi>(`/api/portfolio/health?days=${prev}`, { cache: "no-store" });
          if (!j || !j.ok) throw new Error((j as any)?.error || "Failed to load previous-window health");
          const sc = clamp01to100((j as any).portfolio_health);
          if (!cancelled) setPhPrevScore(sc);
        } catch (e: any) {
          if (!cancelled) {
            setPhPrevErr(e?.message || "Prev health unavailable");
            setPhPrevScore(null);
          }
        } finally {
          if (!cancelled) setPhPrevLoading(false);
        }
      })();
    });

    return () => {
      cancelled = true;
    };
  }, [ok, isExec, numericWindowDays]);

  // AI briefing (non-blocking)
  useEffect(() => {
    let cancelled = false;
    runIdle(() => {
      (async () => {
        try {
          setInsightsLoading(true);
          setInsightsErr("");
          const j: any = await fetchJson(`/api/ai/briefing?days=${numericWindowDays}`, { cache: "no-store" });
          if (!j?.ok) throw new Error(j?.error || "Failed to load briefing");
          const list = Array.isArray(j?.insights) ? (j.insights as Insight[]) : [];
          if (!cancelled) setInsights(orderBriefingInsights(list));
        } catch (e: any) {
          if (!cancelled) {
            setInsightsErr(e?.message || "Failed to load briefing");
            setInsights([]);
          }
        } finally {
          if (!cancelled) setInsightsLoading(false);
        }
      })();
    });
    return () => {
      cancelled = true;
    };
  }, [numericWindowDays]);

  // Success Stories (exec, non-blocking)
  useEffect(() => {
    if (!ok || !isExec) return;
    let cancelled = false;
    runIdle(() => {
      (async () => {
        try {
          setSsLoading(true);
          setSsErr("");
          const j = await fetchJson<SuccessStoriesSummary>(`/api/success-stories/summary?days=${numericWindowDays}`, {
            cache: "no-store",
          });
          if (!j || !j.ok) throw new Error((j as any)?.error || "Failed to load Success Stories");
          if (!cancelled) setSsSummary(j);
        } catch (e: any) {
          if (!cancelled) {
            setSsErr(e?.message || "Failed to load Success Stories");
            setSsSummary(null);
          }
        } finally {
          if (!cancelled) setSsLoading(false);
        }
      })();
    });
    return () => {
      cancelled = true;
    };
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
      setPendingIds((p) => {
        const next = { ...p };
        delete next[taskId];
        return next;
      });
    }
  }

  function viewHref(item: any) {
    const projectRef =
      safeStr(item?.project_code) ||
      safeStr(item?.project_human_id) ||
      safeStr(item?.project?.project_code) ||
      safeStr(item?.project?.project_human_id) ||
      safeStr(item?.project_id || item?.change?.project_id);

    const changeId = safeStr(item?.change_id || item?.change?.id);
    if (projectRef && changeId)
      return `/projects/${encodeURIComponent(projectRef)}/change/${encodeURIComponent(changeId)}`;
    return "";
  }

  const projectIdsKey = useMemo(() => {
    const ids = (projects || [])
      .map((p) => String(p?.id || ""))
      .filter(Boolean)
      .sort();
    return ids.join("|");
  }, [projects]);

  function openMilestonesDrilldown() {
    const sp = new URLSearchParams();
    sp.set("days", String(numericWindowDays));
    router.push(`/milestones?${sp.toString()}`);
  }

  useEffect(() => {
    if (!ok || !isExec) return;
    if (!projectIdsKey) return;

    let cancelled = false;

    runIdle(() => {
      (async () => {
        try {
          setMilestonesDueLoading(true);

          const pj: any = await fetchJson(`/api/portfolio/milestones-due?days=${numericWindowDays}`, {
            cache: "no-store",
          });

          if (pj?.ok && typeof pj?.count === "number") {
            if (!cancelled) setMilestonesDueLive(Math.max(0, Number(pj.count)));
            return;
          }

          const ids = projectIdsKey.split("|").filter(Boolean);

          const results = await Promise.allSettled(
            ids.map(async (projectId) => {
              const j: any = await fetchJson(`/api/projects/${projectId}/milestones/due?days=${numericWindowDays}`, {
                cache: "no-store",
              });
              if (!j?.ok) return 0;
              const n2 = Number(j?.count ?? 0);
              return Number.isFinite(n2) ? n2 : 0;
            })
          );

          let sum = 0;
          for (const res of results) if (res.status === "fulfilled") sum += res.value;

          if (!cancelled) setMilestonesDueLive(sum);
        } catch {
          // keep last known
        } finally {
          if (!cancelled) setMilestonesDueLoading(false);
        }
      })();
    });

    return () => {
      cancelled = true;
    };
  }, [ok, isExec, projectIdsKey, numericWindowDays]);

  useEffect(() => {
    if (!ok || !isExec) return;
    if (!projectIdsKey) return;

    let cancelled = false;

    runIdle(() => {
      (async () => {
        try {
          setMilestonesPanelLoading(true);

          const pj: any = await fetchJson(`/api/portfolio/milestones/panel?days=${numericWindowDays}`, {
            cache: "no-store",
          });

          if (pj?.ok && pj?.panel) {
            if (!cancelled) setMilestonesPanel(pj.panel as MilestonesPanel);
            return;
          }

          const ids = projectIdsKey.split("|").filter(Boolean);

          const results = await Promise.allSettled(
            ids.map(async (projectId) => {
              const j: any = await fetchJson(`/api/projects/${projectId}/milestones/panel?days=${numericWindowDays}`, {
                cache: "no-store",
              });
              if (!j?.ok) return null;
              return (j.panel ?? null) as MilestonesPanel | null;
            })
          );

          let due = 0,
            overdue = 0,
            onTrack = 0,
            aiHigh = 0;

          let planned = 0,
            inProg = 0,
            atRisk = 0,
            completed = 0;

          let slipSum = 0,
            slipCount = 0,
            maxSlip = 0;

          for (const res of results) {
            if (res.status !== "fulfilled" || !res.value) continue;
            const p = res.value;

            due += num(p.due_count);
            overdue += num(p.overdue_count);
            onTrack += num(p.on_track_count);
            aiHigh += num(p.ai_high_risk_count);

            planned += num(p.status_breakdown?.planned);
            inProg += num(p.status_breakdown?.in_progress);
            atRisk += num(p.status_breakdown?.at_risk);
            completed += num(p.status_breakdown?.completed);

            const avg = p.slippage?.avg_slip_days;
            const mx = p.slippage?.max_slip_days;

            if (Number.isFinite(Number(avg))) {
              slipSum += Number(avg);
              slipCount += 1;
            }
            if (Number.isFinite(Number(mx))) maxSlip = Math.max(maxSlip, Number(mx));
          }

          const panelAgg: MilestonesPanel = {
            days: numericWindowDays,
            due_count: due,
            overdue_count: overdue,
            on_track_count: onTrack,
            ai_high_risk_count: aiHigh,
            status_breakdown: {
              planned,
              in_progress: inProg,
              at_risk: atRisk,
              completed,
              overdue,
            },
            slippage: {
              avg_slip_days: slipCount ? Math.round((slipSum / slipCount) * 10) / 10 : 0,
              max_slip_days: maxSlip,
            },
          };

          if (!cancelled) setMilestonesPanel(panelAgg);
        } catch {
          if (!cancelled) setMilestonesPanel(null);
        } finally {
          if (!cancelled) setMilestonesPanelLoading(false);
        }
      })();
    });

    return () => {
      cancelled = true;
    };
  }, [ok, isExec, projectIdsKey, numericWindowDays]);

  /* ─────────────────────────────────────────────────────────────
     ✅ RAID panel
     - Primary: API due-by-type keys if present
     - Fallback: derive from returned items list (if API includes items[])
     - Last resort: due_total
  ────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!ok || !isExec) return;

    let cancelled = false;

    const pickFirstFinite = (obj: any, keys: string[]) => {
      for (const k of keys) {
        const v = obj?.[k];
        if (Number.isFinite(Number(v))) return num(v);
      }
      return undefined;
    };

    const parseType = (t: any) => String(t || "").toLowerCase().trim();

    const parseDueIso = (row: any) =>
      safeStr(row?.due) ||
      safeStr(row?.due_date) ||
      safeStr(row?.dueDate) ||
      safeStr(row?.due_at) ||
      safeStr(row?.dueAt) ||
      safeStr(row?.target_date) ||
      safeStr(row?.targetDate) ||
      "";

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

          if (!p) {
            setRaidPanel(null);
            return;
          }

          // 1) Try to read due-by-type from API (support many possible key names)
          const risk_due =
            pickFirstFinite(p, ["risk_due", "risks_due", "due_risk", "due_risks", "riskDue", "risk_due_count"]) ??
            undefined;
          const issue_due =
            pickFirstFinite(p, ["issue_due", "issues_due", "due_issue", "due_issues", "issueDue", "issue_due_count"]) ??
            undefined;
          const dependency_due =
            pickFirstFinite(p, [
              "dependency_due",
              "dependencies_due",
              "dep_due",
              "deps_due",
              "due_dependency",
              "due_deps",
              "dependencyDue",
            ]) ?? undefined;
          const assumption_due =
            pickFirstFinite(p, ["assumption_due", "assumptions_due", "due_assumption", "due_assumptions"]) ??
            undefined;

          const overdue_total_api = num(p?.overdue_total);
          const due_total_api = num(p?.due_total);

          // 2) If API did NOT give due-by-type, try to derive from returned items (if present)
          let dRisk = 0,
            dIssue = 0,
            dDep = 0,
            dAss = 0,
            ovRisk = 0,
            ovIssue = 0,
            ovDep = 0,
            ovAss = 0;

          const items = Array.isArray(p?.items) ? p.items : Array.isArray(j?.items) ? j.items : null;

          const missingTyped =
            !Number.isFinite(Number(risk_due)) ||
            !Number.isFinite(Number(issue_due)) ||
            !Number.isFinite(Number(dependency_due)) ||
            !Number.isFinite(Number(assumption_due));

          if (missingTyped && Array.isArray(items) && items.length) {
            const now = Date.now();
            const windowEnd = now + numericWindowDays * 86400_000;

            for (const row of items) {
              if (isRowClosed(row)) continue;
              const type = parseType(row?.type || row?.item_type || row?.raid_type);
              const dueIso = parseDueIso(row);
              const dueT = dueIso ? new Date(dueIso).getTime() : NaN;
              if (!Number.isFinite(dueT)) continue;

              const isOv = dueT < now - 30_000;
              const inWindow = dueT <= windowEnd;

              // due in window (excluding overdue)
              if (inWindow && !isOv) {
                if (type.includes("risk")) dRisk++;
                else if (type.includes("issue")) dIssue++;
                else if (type.includes("depend")) dDep++;
                else if (type.includes("assump")) dAss++;
              }

              // overdue
              if (isOv) {
                if (type.includes("risk")) ovRisk++;
                else if (type.includes("issue")) ovIssue++;
                else if (type.includes("depend")) ovDep++;
                else if (type.includes("assump")) ovAss++;
              }
            }
          }

          // Final due-by-type values (API > derived > 0)
          const finalRiskDue = Number.isFinite(Number(risk_due)) ? num(risk_due) : dRisk;
          const finalIssueDue = Number.isFinite(Number(issue_due)) ? num(issue_due) : dIssue;
          const finalDepDue = Number.isFinite(Number(dependency_due)) ? num(dependency_due) : dDep;
          const finalAssDue = Number.isFinite(Number(assumption_due)) ? num(assumption_due) : dAss;

          const due_total_from_types = finalRiskDue + finalIssueDue + finalDepDue + finalAssDue;
          const due_total = due_total_from_types > 0 ? due_total_from_types : due_total_api;

          // Overdue: prefer API; else derived sum
          const overdue_total = overdue_total_api > 0 ? overdue_total_api : ovRisk + ovIssue + ovDep + ovAss;

          setRaidPanel({
            days: num(p.days, numericWindowDays),
            due_total,
            overdue_total,

            risk_due: finalRiskDue,
            issue_due: finalIssueDue,
            dependency_due: finalDepDue,
            assumption_due: finalAssDue,

            // optional overdue-by-type (derived only)
            risk_overdue: ovRisk || undefined,
            issue_overdue: ovIssue || undefined,
            dependency_overdue: ovDep || undefined,
            assumption_overdue: ovAss || undefined,

            // legacy (keep if present)
            risk_hi: num(p?.risk_hi),
            issue_hi: num(p?.issue_hi),
            dependency_hi: num(p?.dependency_hi),
            assumption_hi: num(p?.assumption_hi),
            overdue_hi: num(p?.overdue_hi),
          });
        } catch {
          // keep last
        } finally {
          if (!cancelled) setRaidLoading(false);
        }
      })();
    });

    return () => {
      cancelled = true;
    };
  }, [ok, isExec, numericWindowDays]);

  // ✅ Total shown on the card is ALWAYS the same sum used by the breakdown
  const raidDueTotal = useMemo(() => {
    const r = num(raidPanel?.risk_due);
    const i = num(raidPanel?.issue_due);
    const d = num(raidPanel?.dependency_due);
    const a = num(raidPanel?.assumption_due);
    const sum = r + i + d + a;

    // ✅ Only trust breakdown sum if we actually have a breakdown
    const hasBreakdown = sum > 0;
    return hasBreakdown ? sum : num(raidPanel?.due_total);
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

  const topStories: SuccessStoryTop[] = ssSummary && ssSummary.ok && Array.isArray(ssSummary.top) ? ssSummary.top : [];
  const active = topStories.length ? topStories[Math.min(ssIdx, topStories.length - 1)] : null;
  const ssTone = pickCategoryTone(active?.category ?? null);
  const ssScore = ssSummary && ssSummary.ok ? clamp01to100(ssSummary.score) : 0;
  const ssDelta = ssSummary && ssSummary.ok && Number.isFinite(Number(ssSummary.delta)) ? Number(ssSummary.delta) : null;

  // ✅ SINGLE source-of-truth count for UI
  const ssBreakdown = ssSummary && ssSummary.ok ? ssSummary.breakdown : undefined;
  const ssCountFromBreakdown = ssBreakdown
    ? num(ssBreakdown.milestones_done) +
      num(ssBreakdown.wbs_done) +
      num(ssBreakdown.raid_resolved) +
      num(ssBreakdown.changes_delivered) +
      num(ssBreakdown.lessons_positive)
    : 0;

  const ssDisplayCount = ssCountFromBreakdown > 0 ? ssCountFromBreakdown : ssSummary && ssSummary.ok ? num(ssSummary.count, 0) : 0;

  const ssValue = ssLoading ? "…" : ssErr ? "—" : `${ssDisplayCount}`;
  const ssSub = ssLoading
    ? "Loading stories…"
    : ssErr
    ? "Success stories unavailable"
    : active
    ? active.title
    : ssDisplayCount > 0
    ? `${ssDisplayCount} success stor${ssDisplayCount === 1 ? "y" : "ies"} in ${windowNarr}`
    : `No success stories in ${windowNarr}`;

  const ssMetaLine = ssLoading
    ? `Window: ${windowLabel}`
    : ssErr
    ? "Check /api/success-stories/summary"
    : ssDisplayCount > 0
    ? `— ${ssScore}% confidence • ${active?.project_title ? active.project_title : "Portfolio"}`
    : `Window: ${windowLabel}`;

  const ssAiLine = ssLoading
    ? "Analysing delivery artifacts (milestones, RAID, WBS, changes, lessons)…"
    : ssErr
    ? ssErr
    : active
    ? active.summary
    : "As milestones complete and risks close, Success Stories will appear automatically.";

  const ssTooltip =
    "Success Story is generated from delivery artifacts (Milestones, RAID, WBS, Change Requests, Lessons). Click to view all.";

  function openSuccessStories() {
    const sp = new URLSearchParams();
    sp.set("days", String(numericWindowDays));
    router.push(`/success-stories?${sp.toString()}`);
  }

  function openSuccessStoryItem() {
    openSuccessStories();
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
        st.includes("closed") ||
        st.includes("cancel") ||
        st.includes("cancell") ||
        st.includes("deleted") ||
        st.includes("archive") ||
        st.includes("inactive") ||
        st.includes("complete")
      );
    };

    return arr.filter((p: any) => !isInactive(p));
  }, [projects]);

  const sortedProjects = useMemo(() => {
    const arr = Array.isArray(activeProjects) ? [...activeProjects] : [];
    arr.sort((a: any, b: any) => {
      const ac = projectCodeLabel(a?.project_code);
      const bc = projectCodeLabel(b?.project_code);
      const an = Number(ac);
      const bn = Number(bc);
      const aIsNum = Number.isFinite(an) && ac !== "";
      const bIsNum = Number.isFinite(bn) && bc !== "";
      if (aIsNum && bIsNum && an !== bn) return an - bn;
      if (ac && bc && ac !== bc) return ac.localeCompare(bc);
      const at = safeStr(a?.title).toLowerCase();
      const bt = safeStr(b?.title).toLowerCase();
      return at.localeCompare(bt);
    });
    return arr;
  }, [activeProjects]);

  const ragAgg = useMemo(() => calcRagAgg(rag, activeProjects), [rag, activeProjects]);

  const uiActiveCount = activeProjects?.length || 0;
  const ragScoredCount = ragAgg.scored;

  const apiScore = phData?.ok ? clamp01to100(phData.portfolio_health) : null;
  const fallbackScore = ragScoredCount ? ragAgg.avgHealth : clamp01to100(kpis.portfolioHealth);
  const portfolioScore = phLoading ? null : apiScore ?? fallbackScore;

  const phDelta =
    portfolioScore != null &&
    phPrevScore != null &&
    Number.isFinite(Number(portfolioScore)) &&
    Number.isFinite(Number(phPrevScore))
      ? Number(portfolioScore) - Number(phPrevScore)
      : null;

  const phMetaLine =
    phPrevLoading ? `Trend: loading…` : phPrevErr ? `Trend: —` : phDelta == null ? `Trend: —` : `Trend: ${fmtDelta(phDelta)}`;

  const phTooltip = portfolioThresholdsTooltip() + "\n\nTrend arrow compares current window vs the next longer window.";

  const phScoreForUi = clamp01to100(portfolioScore ?? fallbackScore);
  const phRag = scoreToRag(phScoreForUi);

  // Due soon (AI events)
  useEffect(() => {
    if (!ok || !isExec) return;

    let cancelled = false;

    runIdle(() => {
      (async () => {
        try {
          setDueLoading(true);
          setDueErr("");

          const j = await fetchJson<ArtifactDueResp>(`/api/ai/events`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            body: JSON.stringify({
              eventType: "artifact_due",
              windowDays: dueWindowDays,
            }),
          });

          if (!j || !j.ok) throw new Error((j as any)?.error || "Failed to load due items");

          const ai = (j as any).ai as ArtifactDueAi;
          const list = Array.isArray(ai?.dueSoon) ? ai.dueSoon : [];

          const c = ai?.counts || ({} as any);
          const counts = {
            milestone: num(c.milestone),
            work_item: num(c.work_item),
            raid: num(c.raid),
            artifact: num(c.artifact),
            change: num(c.change),
            total: num(c.milestone) + num(c.work_item) + num(c.raid) + num(c.artifact) + num(c.change),
          };

          const merged = list
            .slice()
            .sort((a, b) => {
              const at = a?.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
              const bt = b?.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
              if (at !== bt) return at - bt;

              const ap = safeStr(a?.meta?.project_name);
              const bp = safeStr(b?.meta?.project_name);
              if (ap !== bp) return ap.localeCompare(bp);

              const ta = safeStr(a?.itemType);
              const tb = safeStr(b?.itemType);
              if (ta !== tb) return ta.localeCompare(tb);

              return safeStr(a?.title).localeCompare(safeStr(b?.title));
            })
            .slice(0, 30)
            .map((x) => ({
              ...x,
              title: safeStr(x?.title).trim() || "Untitled",
              link: safeStr(x?.link).trim() || null,
            }));

          if (!cancelled) {
            setDueItems(merged);
            setDueCounts(counts);
            setDueUpdatedAt(new Date().toISOString());
          }
        } catch (e: any) {
          if (!cancelled) {
            setDueErr(e?.message || "Failed to load due items");
            setDueItems([]);
            setDueCounts({ total: 0, milestone: 0, work_item: 0, raid: 0, artifact: 0, change: 0 });
          }
        } finally {
          if (!cancelled) setDueLoading(false);
        }
      })();
    });

    return () => {
      cancelled = true;
    };
  }, [ok, isExec, dueWindowDays]);

  function openDueItem(it: DueDigestItem) {
    const href = safeStr(it?.link).trim();
    if (href) router.push(href);
  }

  if (!ok) {
    return (
      <div className={`min-h-screen ${THEME.pageBg} grid place-items-center p-10`}>
        <div className="max-w-lg rounded-xl border border-gray-200 bg-white p-8 shadow-lg">
          <div className="text-2xl font-bold text-gray-900">Dashboard Error</div>
          <div className={`mt-3 text-gray-500`}>{(data as any).error}</div>
        </div>
      </div>
    );
  }

  const phBand =
    portfolioScore != null
      ? phScoreForUi >= 85
        ? "Strong"
        : phScoreForUi >= 70
        ? "Healthy"
        : phScoreForUi >= 55
        ? "Mixed"
        : "At Risk"
      : "Loading";

  // ✅ Fixed, equal height for all KPI cards so Success Stories always aligns
  const KPI_CARD_CLASS = "h-[420px] flex flex-col";

  return (
    <LazyMotion features={domAnimation}>
      <div className={`relative min-h-screen overflow-hidden ${THEME.pageBg} selection:bg-indigo-100 selection:text-indigo-900`}>
        {/* ☁️ Light Background */}
        <div className="absolute inset-0 pointer-events-none">
          <div className={`absolute inset-0 bg-gradient-to-b ${THEME.pageGrad}`} />
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-100/50 rounded-full blur-3xl opacity-30" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-violet-100/50 rounded-full blur-3xl opacity-30" />
        </div>

        <div className="relative mx-auto max-w-7xl px-6 py-8 z-10">
          {/* 🧭 Header */}
          <header className="mb-12 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 shadow-lg shadow-indigo-200">
                  <Layers className="h-5 w-5 text-white" />
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                   Λ L I Ξ N Λ <span className="text-gray-400 font-normal">PM Suite</span>
                </h1>
              </div>
              <p className="text-sm text-gray-500">{today}</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200">
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-xs text-emerald-700 font-medium">System Operational</span>
              </div>
              <NotificationBell />
            </div>
          </header>

          {/* EXEC COCKPIT */}
          {isExec ? (
            <>
              {/* 🎯 Control Bar */}
              <div className="mb-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                  <h2 className="text-3xl font-bold tracking-tight text-gray-900">Executive Cockpit</h2>
                  <p className="text-gray-500 mt-1">Real-time portfolio intelligence</p>
                </div>

                <div className="flex items-center gap-1 p-1 rounded-xl bg-white border border-gray-200 shadow-sm">
                  {[7, 14, 30, 60].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setWindowDays(d as WindowDays)}
                      className={[
                        "px-4 py-2 rounded-lg text-sm font-medium transition-all",
                        windowDays === d ? "bg-indigo-600 text-white shadow-md" : "text-gray-600 hover:text-gray-900 hover:bg-gray-50",
                      ].join(" ")}
                    >
                      {d}d
                    </button>
                  ))}
                  <div className="w-px h-6 bg-gray-200 mx-1" />
                  <button
                    type="button"
                    onClick={() => setWindowDays("all")}
                    className={[
                      "px-4 py-2 rounded-lg text-sm font-medium transition-all",
                      windowDays === "all"
                        ? "bg-indigo-600 text-white shadow-md"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-50",
                    ].join(" ")}
                  >
                    All Time
                  </button>
                </div>
              </div>

              {/* 📊 KPI Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
                <KpiCard
                  cardClassName={KPI_CARD_CLASS}
                  label="Portfolio Health"
                  value={phBand}
                  sub={`${ragAgg.g} Green • ${ragAgg.a} Amber • ${ragAgg.r} Red`}
                  icon={<Activity className="h-5 w-5" />}
                  tone="indigo"
                  tooltip={phTooltip}
                  metaLine={phMetaLine}
                  metaIcon={trendIcon(phDelta)}
                  aiLine={portfolioScore != null ? healthNarrative(portfolioScore) : "Loading..."}
                  rightVisual={<PortfolioHealthRing score={phScoreForUi} rag={phRag} />}
                  badge={
                    <span
                      className={[
                        "ml-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                        ragBadgeClasses(phRag),
                      ].join(" ")}
                    >
                      {ragLabel(phRag)}
                    </span>
                  }
                  extra={
                    <div className="space-y-3">
                      {phErr && (
                        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{phErr}</div>
                      )}
                      {phData?.ok && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowPhDetails((v) => !v);
                          }}
                          className="w-full h-9 rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition flex items-center justify-center gap-2"
                        >
                          {showPhDetails ? "Hide Details" : "View Drivers"}
                          <ChevronRight className={`h-3 w-3 transition-transform ${showPhDetails ? "rotate-90" : ""}`} />
                        </button>
                      )}
                      {showPhDetails && phData?.ok && <PortfolioHealthDrivers parts={phData.parts} drivers={phData.drivers} />}
                    </div>
                  }
                />

                <KpiCard
                  cardClassName={KPI_CARD_CLASS}
                  label="Success Stories"
                  value={ssValue}
                  sub={ssSub}
                  icon={<Trophy className="h-5 w-5" />}
                  tone={ssTone}
                  tooltip={ssTooltip}
                  metaLine={ssMetaLine}
                  metaIcon={trendIcon(ssDelta)}
                  aiLine={ssAiLine}
                  onClick={openSuccessStoryItem}
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

                      <div className="mt-4">
                        <Button
                          variant="outline"
                          className="w-full border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:text-gray-900"
                          onClick={(e) => {
                            e.stopPropagation();
                            openSuccessStories();
                          }}
                        >
                          View Summary <ArrowUpRight className="ml-2 h-4 w-4" />
                        </Button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openSuccessStories();
                          }}
                          className="mt-3 w-full text-center text-sm text-gray-500 hover:text-indigo-600 transition-colors"
                        >
                          View all success stories <ChevronRight className="inline h-4 w-4 -mt-0.5" />
                        </button>
                      </div>
                    </div>
                  }
                />

                <KpiCard
                  cardClassName={KPI_CARD_CLASS}
                  label="Milestones Due"
                  value={milestonesDueLoading ? "…" : `${milestonesDueLive}`}
                  sub={windowDays === "all" ? "Using last 60 days" : `Next ${windowDays} days`}
                  icon={<Clock3 className="h-5 w-5" />}
                  tone="indigo"
                  onClick={openMilestonesDrilldown}
                  extra={<MilestonesMeta loading={milestonesPanelLoading} panel={milestonesPanel} />}
                />

                <KpiCard
                  cardClassName={KPI_CARD_CLASS}
                  label="RAID (Due)"
                  value={raidLoading ? "…" : `${raidDueTotal}`}
                  sub={windowDays === "all" ? "Using last 60 days" : `Window ${windowDays}d`}
                  icon={<AlertTriangle className="h-5 w-5" />}
                  tone="rose"
                  onClick={openRaidDrilldown}
                  extra={<RaidMeta loading={raidLoading} panel={raidPanel} onClickType={openRaid} />}
                />
              </div>

              {/* 📋 Main Content Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* AI Briefing - Takes up 2 cols */}
                <div className="lg:col-span-2 space-y-6">
                  <GlassCard>
                    <div className="flex items-start justify-between mb-6">
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-12 rounded-xl bg-indigo-600 shadow-lg shadow-indigo-200 flex items-center justify-center">
                          <Sparkles className="h-6 w-6 text-white" />
                        </div>
                        <div>
                          <h3 className="text-xl font-bold text-gray-900">AI Daily Briefing</h3>
                          <p className="text-sm text-gray-500">Live governance signals</p>
                        </div>
                      </div>
                      <Button className={THEME.buttonPrimary} onClick={() => router.push("/insights")}>
                        View All
                      </Button>
                    </div>

                    <div className="space-y-3">
                      {insightsLoading ? (
                        <>
                          <AiAlert severity="info" title="Loading briefing…" body="Pulling signals from RAID, approvals and lessons." />
                          <AiAlert severity="info" title="Analysing trends…" body="Calculating risk deltas and SLA breaches." />
                        </>
                      ) : insightsErr ? (
                        <AiAlert severity="medium" title="Briefing unavailable" body={insightsErr} />
                      ) : (
                        insights
                          .slice(0, 4)
                          .map((x) => (
                            <AiAlert
                              key={`${x.id}-${x.title}`}
                              severity={x.severity}
                              title={x.title}
                              body={x.body}
                              href={fixInsightHref(x, windowDays)}
                            />
                          ))
                      )}
                    </div>
                  </GlassCard>

                  {/* Due Soon Section */}
                  <GlassCard>
                    <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-12 rounded-xl bg-amber-500 shadow-lg shadow-amber-200 flex items-center justify-center">
                          <Clock3 className="h-6 w-6 text-white" />
                        </div>
                        <div>
                          <h3 className="text-xl font-bold text-gray-900">Due Soon</h3>
                          <p className="text-sm text-gray-500">Next {dueWindowDays} days</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {[7, 14, 30].map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setDueWindowDays(d as any)}
                            className={[
                              "px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
                              dueWindowDays === d
                                ? "bg-amber-50 border-amber-200 text-amber-700"
                                : "bg-white border-gray-200 text-gray-600 hover:border-gray-300",
                            ].join(" ")}
                          >
                            {d}d
                          </button>
                        ))}
                      </div>
                    </div>

                    {dueCounts.total > 0 ? (
                      <div className="rounded-xl border border-gray-200 bg-gray-50/50 overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between text-xs text-gray-500 bg-white">
                          <span>Item</span>
                          <span>Due Date</span>
                        </div>
                        <div className="max-h-[320px] overflow-auto divide-y divide-gray-200">
                          {dueItems.slice(0, 8).map((it, idx) => {
                            const overdue = isOverdue(it?.dueDate);
                            const clickable = Boolean(safeStr(it?.link).trim());
                            return (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => clickable && openDueItem(it)}
                                className={[
                                  "w-full text-left px-4 py-3 flex items-center justify-between transition-colors bg-white",
                                  clickable ? "hover:bg-gray-50 cursor-pointer" : "cursor-default",
                                  overdue ? "bg-rose-50/50" : "",
                                ].join(" ")}
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <span
                                    className={[
                                      "shrink-0 inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wider font-medium",
                                      dueChipTone(it.itemType),
                                    ].join(" ")}
                                  >
                                    {dueTypeLabel(it.itemType)}
                                  </span>
                                  <span className="text-sm text-gray-700 truncate">{it.title}</span>
                                  {overdue && (
                                    <span className="shrink-0 text-[10px] font-medium text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded">
                                      Overdue
                                    </span>
                                  )}
                                </div>
                                <span className="text-xs text-gray-500 shrink-0 ml-4">{dueDateLabel(it.dueDate)}</span>
                              </button>
                            );
                          })}
                        </div>
                        {dueItems.length > 8 && (
                          <div className="px-4 py-2 text-center border-t border-gray-200 bg-gray-50">
                            <button
                              onClick={() => router.push(`/milestones?days=${dueWindowDays}`)}
                              className="text-xs text-indigo-600 hover:text-indigo-700 font-medium transition-colors"
                            >
                              View {dueItems.length - 8} more items
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-12 border border-dashed border-gray-200 rounded-xl bg-gray-50/50">
                        <CheckCircle2 className="h-8 w-8 text-gray-300 mx-auto mb-3" />
                        <p className="text-gray-600 font-medium">All caught up</p>
                        <p className="text-sm text-gray-400 mt-1">Nothing due in the next {dueWindowDays} days</p>
                      </div>
                    )}
                  </GlassCard>
                </div>

                {/* Sidebar - Takes up 1 col */}
                <div className="space-y-6">
                  {/* Approval Inbox */}
                  <GlassCard>
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-12 rounded-xl bg-emerald-500 shadow-lg shadow-emerald-200 flex items-center justify-center">
                          <CheckCircle2 className="h-6 w-6 text-white" />
                        </div>
                        <div>
                          <h3 className="text-xl font-bold text-gray-900">Approvals</h3>
                          <p className="text-sm text-gray-500">{approvalCount} pending</p>
                        </div>
                      </div>
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
                            <div
                              key={taskId}
                              className="group rounded-xl border border-gray-200 bg-gray-50/50 p-4 hover:border-gray-300 hover:shadow-sm transition-all"
                            >
                              <div className="flex items-start justify-between gap-3 mb-3">
                                <div className="min-w-0">
                                  <div className="font-medium text-sm text-gray-900 truncate">{title}</div>
                                  <div className="text-xs text-gray-500 mt-1">
                                    {createdAt ? new Date(createdAt).toISOString().slice(0, 10) : "—"}
                                  </div>
                                </div>
                                {href && (
                                  <a href={href} className="shrink-0 text-gray-400 hover:text-indigo-600 transition-colors">
                                    <ArrowUpRight className="h-4 w-4" />
                                  </a>
                                )}
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  className="flex-1 h-8 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs"
                                  disabled={isBusy}
                                  onClick={() => decide(taskId, "approve")}
                                >
                                  {isBusy ? "…" : "Approve"}
                                </Button>
                                <Button
                                  size="sm"
                                  className="flex-1 h-8 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs"
                                  disabled={isBusy}
                                  onClick={() => decide(taskId, "reject")}
                                >
                                  {isBusy ? "…" : "Reject"}
                                </Button>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-center py-8 border border-dashed border-gray-200 rounded-xl bg-gray-50/50">
                          <p className="text-sm text-gray-500">No approvals waiting</p>
                        </div>
                      )}
                    </div>
                  </GlassCard>

                  {/* Quick Stats */}
                  <GlassCard className="bg-gradient-to-br from-indigo-50/50 to-violet-50/50 border-indigo-100">
                    <h3 className="text-sm font-medium text-gray-500 mb-4 uppercase tracking-wider">Quick Stats</h3>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-700">Active Projects</span>
                        <span className="text-lg font-semibold text-gray-900">{uiActiveCount}</span>
                      </div>
                      <div className="h-px bg-indigo-100" />
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-700">Portfolio Score</span>
                        <span className={["text-sm font-semibold px-2.5 py-1 rounded-lg border-2 bg-white", ragBadgeClasses(phRag)].join(" ")}>
                          {phScoreForUi}%
                        </span>
                      </div>
                      <div className="h-px bg-indigo-100" />
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-700">Open Risks</span>
                        <span className="text-lg font-semibold text-gray-900">{kpis.openRisks}</span>
                      </div>
                    </div>
                  </GlassCard>
                </div>
              </div>

              {/* 🗂️ Projects Grid */}
              <div className="mt-12">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight text-gray-900">Project Overview</h2>
                    <p className="text-gray-500 mt-1">Active delivery areas</p>
                  </div>
                  <Button variant="outline" className="border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:text-gray-900">
                    View All Projects
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {sortedProjects.slice(0, 9).map((p: any) => {
                    const code = projectCodeLabel(p.project_code);
                    const id = String(p?.id || "").trim();
                    const projectRef = looksLikeUuid(id) ? id : id;

                    return (
                      <ProjectTile
                        key={String(p.id || projectRef)}
                        projectRef={projectRef}
                        title={p.title || "Project"}
                        projectCode={code}
                        clientName={safeStr(p.client_name)}
                      />
                    );
                  })}
                </div>

                {projects.length !== activeProjects.length && (
                  <div className="mt-4 text-xs text-gray-400 text-center">
                    Hidden {Math.max(0, projects.length - activeProjects.length)} closed/cancelled project
                    {projects.length - activeProjects.length === 1 ? "" : "s"} from overview.
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Non-Exec View */
            <>
              <div className="mb-8">
                <h2 className="text-3xl font-bold tracking-tight text-gray-900">My Day</h2>
                <p className="text-gray-500 mt-1">Focus and flow</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <KpiCard label="My Approvals" value={`${approvalCount}`} icon={<CheckCircle2 className="h-5 w-5" />} tone="emerald" />
                <KpiCard label="Open Lessons" value={`${kpis.openLessons}`} icon={<Sparkles className="h-5 w-5" />} tone="indigo" />
                <KpiCard
                  label="RAID (Due)"
                  value={raidLoading ? "…" : `${raidDueTotal || Number(kpis.openRisks || 0)}`}
                  sub={`Window ${numericWindowDays}d`}
                  icon={<AlertTriangle className="h-5 w-5" />}
                  tone="rose"
                  onClick={openRaidDrilldown}
                  extra={<RaidMeta loading={raidLoading} panel={raidPanel} onClickType={openRaid} />}
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

/* ──────────────────────────────────────────────────────────────────────────────
   🧩 Reusable Components (Light Mode)
───────────────────────────────────────────────────────────────────────────── */
function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const neonShadow =
    "shadow-[0_0_0_3px_rgba(0,184,219,0.75),0_12px_30px_rgba(15,23,42,0.10),0_0_60px_rgba(0,184,219,0.28)]";
  const neonShadowHover =
    "hover:shadow-[0_0_0_3px_rgba(0,184,219,0.95),0_18px_44px_rgba(15,23,42,0.12),0_0_90px_rgba(0,184,219,0.40)]";

  return (
    <m.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className={`
        relative overflow-hidden
        ${THEME.cardBg}
        border-2 border-[rgba(0,184,219,0.90)]
        rounded-2xl p-6
        ${neonShadow}
        ${neonShadowHover}
        transition-all duration-300
        ${className}
      `}
    >
      <div className="pointer-events-none absolute inset-0 opacity-[0.28]">
        <div
          className="absolute -inset-24 blur-3xl"
          style={{
            background: `radial-gradient(circle at 25% 20%, rgba(0,184,219,0.32), transparent 55%),
                         radial-gradient(circle at 80% 75%, rgba(0,184,219,0.18), transparent 55%)`,
          }}
        />
      </div>

      <div className="relative">{children}</div>
    </m.div>
  );
}

function PortfolioHealthRing({ score, rag }: { score: number; rag: RagLetter }) {
  const s = clamp01to100(score);
  const r = 24;
  const c = 2 * Math.PI * r;
  const dash = (s / 100) * c;

  const color = ragStrokeColor(rag);

  return (
    <div className="shrink-0 relative">
      <div className="h-16 w-16">
        <svg viewBox="0 0 60 60" className="h-full w-full -rotate-90">
          <circle cx="30" cy="30" r={r} className="stroke-gray-200" strokeWidth="6" fill="none" />
          <m.circle
            cx="30"
            cy="30"
            r={r}
            stroke={color}
            strokeWidth="6"
            fill="none"
            strokeLinecap="round"
            initial={{ strokeDasharray: `0 ${c}` }}
            animate={{ strokeDasharray: `${dash} ${c}` }}
            transition={{ duration: 1, ease: "easeOut" }}
            style={{
              filter: "drop-shadow(0 0 10px rgba(0,0,0,0.06)) drop-shadow(0 0 10px rgba(0,184,219,0.20))",
            }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-base font-bold text-gray-900">{s}%</span>
        </div>
      </div>
    </div>
  );
}

function PortfolioHealthDrivers({
  parts,
  drivers,
}: {
  parts: { schedule: number; raid: number; flow: number; approvals: number; activity: number };
  drivers: PortfolioHealthDriver[];
}) {
  const partPill = (label: string, v: number) => {
    const score = clamp01to100(v);
    const color =
      score >= 85
        ? "text-emerald-700 bg-emerald-50 border-emerald-200"
        : score >= 70
        ? "text-indigo-700 bg-indigo-50 border-indigo-200"
        : score >= 55
        ? "text-amber-700 bg-amber-50 border-amber-200"
        : "text-rose-700 bg-rose-50 border-rose-200";

    return (
      <div className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${color}`}>
        <span className="font-medium">{label}</span>
        <span className="font-bold">{score}</span>
      </div>
    );
  };

  return (
    <div className="space-y-2 mt-4 pt-4 border-t border-gray-200">
      <div className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Health Drivers</div>
      <div className="grid grid-cols-2 gap-2">
        {partPill("Schedule", num(parts?.schedule))}
        {partPill("RAID", num(parts?.raid))}
        {partPill("Flow", num(parts?.flow))}
        {partPill("Approvals", num(parts?.approvals))}
      </div>
    </div>
  );
}

function SuccessStoryMeta({
  meta,
  loading,
  displayTotal,
}: {
  meta: {
    milestones_completed?: number;
    raid_closed?: number;
    changes_implemented?: number;
    wbs_done?: number;
    lessons_published?: number;
  };
  loading: boolean;
  displayTotal: number;
}) {
  const milestones = num(meta.milestones_completed);
  const raid = num(meta.raid_closed);
  const changes = num(meta.changes_implemented);
  const wbs = num(meta.wbs_done);
  const lessons = num(meta.lessons_published);

  const knownSum = milestones + raid + changes + wbs + lessons;
  const other = Math.max(0, num(displayTotal) - knownSum);

  const stats = [
    { label: "Milestones", value: milestones, color: "text-gray-900" },
    { label: "RAID", value: raid, color: "text-gray-900" },
    { label: "Changes", value: changes, color: "text-gray-900" },
    { label: "WBS", value: wbs, color: "text-gray-900" },
    { label: "Lessons", value: lessons, color: "text-gray-900" },
    { label: "Other", value: other, color: "text-gray-900" },
  ];

  return (
    <div className="border-t border-gray-200 pt-4">
      <div className="grid grid-cols-3 gap-2">
        {stats.map((stat) => (
          <div key={stat.label} className="text-center p-2 rounded-lg bg-gray-50 border border-gray-100">
            <div className={`text-lg font-bold ${stat.color}`}>{loading ? "…" : stat.value}</div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  icon,
  tone,
  onClick,
  extra,
  tooltip,
  metaLine,
  metaIcon,
  aiLine,
  rightVisual,
  badge,
  cardClassName,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  tone: "emerald" | "indigo" | "amber" | "rose" | (string & {});
  onClick?: () => void;
  extra?: React.ReactNode;
  tooltip?: string;
  metaLine?: string;
  metaIcon?: React.ReactNode;
  aiLine?: string;
  rightVisual?: React.ReactNode;
  badge?: React.ReactNode;
  cardClassName?: string;
}) {
  const clickable = typeof onClick === "function";

  const toneColors = {
    emerald: "from-emerald-500 to-emerald-600 text-white",
    indigo: "from-indigo-500 to-indigo-600 text-white",
    amber: "from-amber-500 to-amber-600 text-white",
    rose: "from-rose-500 to-rose-600 text-white",
  };

  const colorClass = toneColors[tone as keyof typeof toneColors] || toneColors.indigo;

  return (
    <GlassCard className={[clickable ? "cursor-pointer group" : "", cardClassName || ""].join(" ")}>
      <div
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={onClick}
        onKeyDown={(e) => {
          if (!clickable) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick?.();
          }
        }}
        className={["outline-none", cardClassName?.includes("flex") ? "flex flex-col h-full" : ""].join(" ")}
        title={tooltip || (clickable ? "Click to view details" : undefined)}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-sm font-medium text-gray-500">{label}</p>
              {badge}
              {tooltip && (
                <span
                  className="text-[10px] text-gray-400 border border-gray-200 bg-gray-50 px-1.5 py-0.5 rounded"
                  title={tooltip}
                >
                  i
                </span>
              )}
            </div>

            <p className="text-3xl font-bold text-gray-900 tracking-tight">{value}</p>
            {sub && <p className="text-sm text-gray-500 mt-1 line-clamp-2">{sub}</p>}

            {metaLine && (
              <div className="mt-3 inline-flex items-center gap-2 text-xs text-gray-600 bg-gray-50 border border-gray-200 px-2.5 py-1 rounded-lg">
                {metaIcon && <span>{metaIcon}</span>}
                <span className="truncate">{metaLine}</span>
              </div>
            )}

            {aiLine && <p className="mt-3 text-sm text-gray-600 line-clamp-2 leading-relaxed">{aiLine}</p>}
          </div>

          {rightVisual ? (
            <div className="shrink-0">{rightVisual}</div>
          ) : (
            <div className={`shrink-0 flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br ${colorClass} shadow-lg`}>
              {icon}
            </div>
          )}
        </div>

        {extra && <div className="mt-auto">{extra}</div>}
      </div>
    </GlassCard>
  );
}

function AiAlert({
  severity,
  title,
  body,
  href,
}: {
  severity: "high" | "medium" | "info";
  title: string;
  body: string;
  href?: string;
}) {
  const colors = {
    high: "border-rose-200 bg-rose-50 hover:border-rose-300",
    medium: "border-amber-200 bg-amber-50 hover:border-amber-300",
    info: "border-indigo-200 bg-indigo-50 hover:border-indigo-300",
  } as const;

  const iconColors = {
    high: "text-rose-600",
    medium: "text-amber-600",
    info: "text-indigo-600",
  };

  const Icon = severity === "high" ? AlertTriangle : severity === "medium" ? AlertTriangle : Sparkles;

  return (
    <div className={`group rounded-xl border p-4 transition-all ${colors[severity]}`}>
      <div className="flex items-start gap-3">
        <div className={`shrink-0 mt-0.5 ${iconColors[severity]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h4 className="font-semibold text-gray-900">{title}</h4>
            {href && (
              <a
                href={href}
                className="shrink-0 text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity font-medium"
              >
                View <ArrowUpRight className="h-3 w-3" />
              </a>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-600 leading-relaxed">{body}</p>
        </div>
      </div>
    </div>
  );
}

function MilestonesMeta({ loading, panel }: { loading: boolean; panel: MilestonesPanel | null }) {
  const stats = [
    { label: "Planned", value: num(panel?.status_breakdown?.planned), color: "text-gray-600" },
    { label: "At Risk", value: num(panel?.status_breakdown?.at_risk), color: "text-amber-600" },
    { label: "Overdue", value: num(panel?.overdue_count), color: "text-rose-600" },
  ];

  return (
    <div className="mt-4 pt-4 border-t border-gray-200">
      <div className="flex items-center justify-between gap-2">
        {stats.map((stat) => (
          <div key={stat.label} className="text-center flex-1">
            <div className={`text-lg font-bold ${stat.color}`}>{loading ? "…" : stat.value}</div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   ✅ RAID meta (CLEANED)
   - Shows DUE-BY-TYPE (not “hi-score”)
   - Overdue uses SAME mini-stat style as Milestones tile
───────────────────────────────────────────────────────────── */
function RaidMeta({
  loading,
  panel,
  onClickType,
}: {
  loading: boolean;
  panel: RaidPanel | null;
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
    <div className="mt-4 pt-4 border-t border-gray-200">
      {!hasTypedBreakdown ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClickType(undefined, { hi: false });
          }}
          className="w-full rounded-lg border border-gray-200 bg-white/60 hover:bg-gray-50 transition-colors px-3 py-3 flex items-center justify-between"
          title="Click to view RAID items due in this window"
        >
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white border border-gray-200">
              <AlertTriangle className="h-4 w-4 text-rose-600" />
            </span>
            <div>
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Due in window</div>
              <div className="text-xs text-gray-600">Type breakdown unavailable</div>
            </div>
          </div>
          <div className="text-lg font-bold text-gray-900">{loading ? "…" : dueTotal}</div>
        </button>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Risks", value: riskVal, type: "Risk" as const, color: "text-rose-600" },
            { label: "Issues", value: issueVal, type: "Issue" as const, color: "text-amber-600" },
            { label: "Deps", value: depVal, type: "Dependency" as const, color: "text-indigo-600" },
            { label: "Assump.", value: assVal, type: "Assumption" as const, color: "text-gray-700" },
          ].map((item) => (
            <button
              key={item.label}
              onClick={(e) => {
                e.stopPropagation();
                onClickType(item.type, { hi: false });
              }}
              className="text-center p-2 rounded-lg bg-white/60 border border-gray-200 hover:bg-gray-50 transition-colors"
              title={`Click to view ${item.label.toLowerCase()} due items`}
            >
              <div className={`text-lg font-bold ${item.color}`}>{loading ? "…" : item.value}</div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mt-0.5">{item.label}</div>
            </button>
          ))}
        </div>
      )}

      {/* ✅ Overdue: same milestone-style row */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClickType(undefined, { overdue: true });
        }}
        className="mt-3 w-full rounded-lg border border-gray-200 bg-white/60 hover:bg-gray-50 transition-colors px-3 py-2 flex items-center justify-between"
        title="Click to view overdue RAID items"
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white border border-gray-200">
            <Clock3 className="h-4 w-4 text-rose-600" />
          </span>
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Overdue</div>
        </div>
        <div className="text-sm font-bold text-rose-700">{loading ? "…" : overdueVal}</div>
      </button>
    </div>
  );
}

function ProjectTile({
  projectRef,
  title,
  subtitle = "Open RAID • Changes • Lessons • Reporting",
  projectCode,
  clientName,
}: {
  projectRef: string;
  title: string;
  subtitle?: string;
  projectCode?: string;
  clientName?: string;
}) {
  const router = useRouter();

  function go() {
    if (!projectRef) return;
    router.push(`/projects/${encodeURIComponent(projectRef)}`);
  }

  const code = safeStr(projectCode).trim();
  const client = safeStr(clientName).trim();

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      }}
      className="group cursor-pointer rounded-xl border border-gray-200 bg-white p-5 hover:border-indigo-300 hover:shadow-md transition-all"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2">
            {code && (
              <span className="inline-flex items-center rounded-md bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                {code}
              </span>
            )}
            {client && (
              <span className="inline-flex items-center rounded-md bg-gray-100 border border-gray-200 px-2 py-0.5 text-[10px] text-gray-600">
                {client}
              </span>
            )}
          </div>

          <h3 className="text-base font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors truncate">{title}</h3>
          <p className="text-xs text-gray-500 mt-1">{subtitle}</p>
        </div>
        <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="h-8 w-8 rounded-lg bg-indigo-50 flex items-center justify-center">
            <ArrowUpRight className="h-4 w-4 text-indigo-600" />
          </div>
        </div>
      </div>
    </div>
  );
}
