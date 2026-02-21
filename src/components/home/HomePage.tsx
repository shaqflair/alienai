// src/components/home/HomePage.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

import { LazyMotion, domAnimation, m, AnimatePresence, useSpring, useMotionValue, useTransform } from "framer-motion";

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
   🖤 OBSIDIAN NOIR THEME
   - Dark as deep space, accented with electric cyan
   - Premium glass morphism
   - Surgical precision typography
───────────────────────────────────────────────────────────── */

const THEME = {
  pageBg: "bg-[#080B12] text-gray-100",
  pageGrad: "from-[#080B12] via-[#0D1220] to-[#080B12]",

  accent: "#00D8FF",
  accentDim: "rgba(0,216,255,0.15)",
  gold: "#F5C842",
  goldDim: "rgba(245,200,66,0.12)",

  textPrimary: "text-white",
  textSecondary: "text-gray-400",
  textTertiary: "text-gray-600",
  textMuted: "text-gray-500",

  cardBg: "bg-[rgba(255,255,255,0.03)]",
  cardBorder: "border-[rgba(255,255,255,0.07)]",
  cardBorderHover: "hover:border-[rgba(0,216,255,0.3)]",
  cardShadow: "shadow-[0_1px_0_rgba(255,255,255,0.05)]",

  success: "text-emerald-400 bg-emerald-950/50 border-emerald-800/50",
  warning: "text-amber-400 bg-amber-950/50 border-amber-800/50",
  danger: "text-rose-400 bg-rose-950/50 border-rose-800/50",
  info: "text-cyan-400 bg-cyan-950/50 border-cyan-800/50",

  buttonGhost: "hover:bg-white/5 text-gray-400 hover:text-white",
  buttonPrimary: "bg-cyan-500 hover:bg-cyan-400 text-black font-semibold shadow-lg shadow-cyan-500/20",
} as const;

type WindowDays = 7 | 14 | 30 | 60 | "all";

/* ─────────────────────────────────────────────────────────────
   Types & Interfaces (unchanged)
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
   Utility Functions (unchanged)
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
  if (t.includes("warning") || t.includes("overdue") || t.includes("at_risk") || t.includes("risk") || t.includes("issue")) return "medium";
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
  const base = "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide";
  if (sev === "high") return `${base} text-rose-400 bg-rose-950/50 border-rose-800/50`;
  if (sev === "medium") return `${base} text-amber-400 bg-amber-950/50 border-amber-800/50`;
  if (sev === "success") return `${base} text-emerald-400 bg-emerald-950/50 border-emerald-800/50`;
  return `${base} text-cyan-400 bg-cyan-950/50 border-cyan-800/50`;
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
   RAG helpers (unchanged)
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
  if (r === "G") return "border-emerald-700/50 bg-emerald-950/50 text-emerald-400";
  if (r === "A") return "border-amber-700/50 bg-amber-950/50 text-amber-400";
  return "border-rose-700/50 bg-rose-950/50 text-rose-400";
}

function ragStrokeColor(r: RagLetter) {
  if (r === "G") return "#10b981";
  if (r === "A") return "#f59e0b";
  return "#f43f5e";
}

/* ─────────────────────────────────────────────────────────────
   ✨ Animated Counter Component
───────────────────────────────────────────────────────────── */
function AnimatedNumber({ value, duration = 1.2 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const startRef = useRef(0);
  const startTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const start = display;
    const end = value;
    const diff = end - start;
    if (diff === 0) return;

    startTimeRef.current = null;

    const animate = (ts: number) => {
      if (!startTimeRef.current) startTimeRef.current = ts;
      const elapsed = (ts - startTimeRef.current) / (duration * 1000);
      const progress = Math.min(elapsed, 1);
      // Ease out expo
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setDisplay(Math.round(start + diff * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <>{display}</>;
}

/* ─────────────────────────────────────────────────────────────
   🔔 Notification Bell (Dark Mode)
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
      if (!j || !j.ok) throw new Error((j as any)?.error || "Failed");
      const list = Array.isArray(j.items) ? j.items : [];
      setItems(list);
      const unread = typeof j.unreadCount === "number" ? j.unreadCount : list.filter((x) => x.is_read !== true).length;
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
    return () => { if (pollRef.current) clearInterval(pollRef.current); pollRef.current = null; };
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
    } catch { refresh(); }
  }

  async function markAllRead() {
    const unread = items.filter((n) => n.is_read !== true).length;
    if (unread <= 0) return;
    setItems((prev) => prev.map((n) => (n.is_read === true ? n : { ...n, is_read: true })));
    setUnreadCount(0);
    try {
      await fetch("/api/notifications/read-all", { method: "POST" });
    } catch { refresh(); }
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
        className="relative group rounded-xl border border-white/10 bg-white/5 p-2.5 transition-all duration-200 hover:bg-white/10 hover:border-cyan-500/40 active:scale-95 backdrop-blur-sm"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5 text-gray-400 group-hover:text-cyan-400 transition-colors" />
        {unreadCount > 0 && (
          <m.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-cyan-500 text-[10px] font-bold text-black shadow-lg shadow-cyan-500/40 ring-2 ring-[#080B12]"
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
              initial={{ opacity: 0, y: -12, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.95 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="absolute right-0 top-full z-50 mt-3 w-[420px] overflow-hidden rounded-2xl border border-white/10 bg-[#0D1220]/95 shadow-2xl shadow-black/60 backdrop-blur-xl"
              style={{ boxShadow: "0 0 0 1px rgba(0,216,255,0.1), 0 25px 60px rgba(0,0,0,0.6)" }}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                    <Bell className="h-4 w-4 text-cyan-400" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">Notifications</div>
                    <div className="text-xs text-gray-500">{loading ? "Syncing…" : `${unreadCount} unread`}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={markAllRead}
                    className="h-8 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 text-xs text-gray-400 hover:text-white hover:bg-white/[0.08] transition-all"
                  >
                    <CheckCheck className="mr-1.5 inline h-3.5 w-3.5" />
                    Mark all read
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="h-8 w-8 rounded-lg border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.08] transition-all inline-flex items-center justify-center"
                  >
                    <X className="h-4 w-4 text-gray-400 hover:text-white" />
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-1 border-b border-white/[0.06] px-3 py-2.5">
                {(["all", "action", "ai", "approvals"] as BellTab[]).map((k) => {
                  const label = k === "all" ? "All" : k === "action" ? "Action" : k === "ai" ? "AI" : "Approvals";
                  const active = tab === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setTab(k)}
                      className={[
                        "rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150",
                        active
                          ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/25"
                          : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.05]",
                      ].join(" ")}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* Content */}
              <div className="max-h-[480px] overflow-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                {grouped.length === 0 ? (
                  <div className="px-4 py-14 text-center">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.04] border border-white/[0.06]">
                      <CheckCheck className="h-6 w-6 text-gray-600" />
                    </div>
                    <div className="text-sm font-medium text-gray-300">All caught up</div>
                    <div className="mt-1.5 text-xs text-gray-600">No new notifications.</div>
                  </div>
                ) : (
                  grouped.map(([label, rows]) => (
                    <div key={label}>
                      <div className="px-5 pt-4 pb-2 text-[10px] font-bold uppercase tracking-widest text-gray-600">
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
                                  ? "bg-white/[0.04] border border-white/[0.08] hover:border-cyan-500/20 hover:bg-white/[0.06]"
                                  : "hover:bg-white/[0.03] border border-transparent",
                              ].join(" ")}
                            >
                              <div className="flex items-start gap-3">
                                <div
                                  className={[
                                    "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
                                    sev === "high" ? "border-rose-800/50 bg-rose-950/50 text-rose-400"
                                      : sev === "medium" ? "border-amber-800/50 bg-amber-950/50 text-amber-400"
                                      : sev === "success" ? "border-emerald-800/50 bg-emerald-950/50 text-emerald-400"
                                      : "border-cyan-800/50 bg-cyan-950/50 text-cyan-400",
                                  ].join(" ")}
                                >
                                  {notifIcon(n)}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="truncate text-sm font-medium text-gray-200">{n.title}</div>
                                    <div className="shrink-0 text-[11px] text-gray-600">{timeAgo(n.created_at)}</div>
                                  </div>
                                  {n.body && (
                                    <div className="mt-1 line-clamp-2 text-xs text-gray-500 leading-relaxed">{n.body}</div>
                                  )}
                                  <div className="mt-2 flex items-center gap-2">
                                    <span className={severityChip(sev)}>{sev}</span>
                                    {unread && <span className="inline-flex h-1.5 w-1.5 rounded-full bg-cyan-400" />}
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

              <div className="border-t border-white/[0.06] px-5 py-3.5">
                <button
                  type="button"
                  onClick={() => { setOpen(false); router.push("/notifications"); }}
                  className="text-xs text-gray-500 hover:text-cyan-400 transition-colors flex items-center gap-1.5"
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
   Existing Home types (unchanged)
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

/* ─────────────────────────────────────────────────────────────
   Helpers (unchanged logic)
───────────────────────────────────────────────────────────── */
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

/* ─────────────────────────────────────────────────────────────
   Due soon helpers (unchanged)
───────────────────────────────────────────────────────────── */
function dueDateLabel(iso: string | null | undefined) {
  const s = safeStr(iso).trim();
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function dueChipTone(itemType: DueItemType) {
  if (itemType === "milestone") return "border-emerald-800/60 bg-emerald-950/60 text-emerald-400";
  if (itemType === "work_item") return "border-cyan-800/60 bg-cyan-950/60 text-cyan-400";
  if (itemType === "raid") return "border-rose-800/60 bg-rose-950/60 text-rose-400";
  if (itemType === "change") return "border-violet-800/60 bg-violet-950/60 text-violet-400";
  return "border-white/10 bg-white/5 text-gray-400";
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
   🏠 Home Page (Dark Noir Mode)
───────────────────────────────────────────────────────────── */
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
  const [dueCounts, setDueCounts] = useState<{
    total: number;
    milestone: number;
    work_item: number;
    raid: number;
    artifact: number;
    change: number;
  }>({ total: 0, milestone: 0, work_item: 0, raid: 0, artifact: 0, change: 0 });
  const [dueUpdatedAt, setDueUpdatedAt] = useState<string>("");

  useEffect(() => { setApprovalItems(Array.isArray(approvals.items) ? approvals.items : []); }, [ok, approvals.items]);
  useEffect(() => {
    setToday(new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }));
  }, []);
  useEffect(() => { setShowPhDetails(false); }, [windowDays]);

  // Portfolio health (exec)
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
        } finally { if (!cancelled) setPhLoading(false); }
      })();
    });
    return () => { cancelled = true; };
  }, [ok, isExec, windowDays]);

  // Previous window trend
  useEffect(() => {
    if (!ok || !isExec) return;
    const cur: 7 | 14 | 30 | 60 = numericWindowDays;
    const prev = prevWindowDays(cur);
    let cancelled = false;
    runIdle(() => {
      (async () => {
        try {
          setPhPrevLoading(true); setPhPrevErr("");
          const j = await fetchJson<PortfolioHealthApi>(`/api/portfolio/health?days=${prev}`, { cache: "no-store" });
          if (!j || !j.ok) throw new Error((j as any)?.error || "Failed");
          const sc = clamp01to100((j as any).portfolio_health);
          if (!cancelled) setPhPrevScore(sc);
        } catch (e: any) {
          if (!cancelled) { setPhPrevErr(e?.message || "Prev unavailable"); setPhPrevScore(null); }
        } finally { if (!cancelled) setPhPrevLoading(false); }
      })();
    });
    return () => { cancelled = true; };
  }, [ok, isExec, numericWindowDays]);

  // AI briefing
  useEffect(() => {
    let cancelled = false;
    runIdle(() => {
      (async () => {
        try {
          setInsightsLoading(true); setInsightsErr("");
          const j: any = await fetchJson(`/api/ai/briefing?days=${numericWindowDays}`, { cache: "no-store" });
          if (!j?.ok) throw new Error(j?.error || "Failed");
          const list = Array.isArray(j?.insights) ? (j.insights as Insight[]) : [];
          if (!cancelled) setInsights(orderBriefingInsights(list));
        } catch (e: any) {
          if (!cancelled) { setInsightsErr(e?.message || "Failed"); setInsights([]); }
        } finally { if (!cancelled) setInsightsLoading(false); }
      })();
    });
    return () => { cancelled = true; };
  }, [numericWindowDays]);

  // Success Stories
  useEffect(() => {
    if (!ok || !isExec) return;
    let cancelled = false;
    runIdle(() => {
      (async () => {
        try {
          setSsLoading(true); setSsErr("");
          const j = await fetchJson<SuccessStoriesSummary>(`/api/success-stories/summary?days=${numericWindowDays}`, { cache: "no-store" });
          if (!j || !j.ok) throw new Error((j as any)?.error || "Failed");
          if (!cancelled) setSsSummary(j);
        } catch (e: any) {
          if (!cancelled) { setSsErr(e?.message || "Failed"); setSsSummary(null); }
        } finally { if (!cancelled) setSsLoading(false); }
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
    if (projectRef && changeId)
      return `/projects/${encodeURIComponent(projectRef)}/change/${encodeURIComponent(changeId)}`;
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
          if (pj?.ok && typeof pj?.count === "number") { if (!cancelled) setMilestonesDueLive(Math.max(0, Number(pj.count))); return; }
          const ids = projectIdsKey.split("|").filter(Boolean);
          const results = await Promise.allSettled(ids.map(async (projectId) => {
            const j: any = await fetchJson(`/api/projects/${projectId}/milestones/due?days=${numericWindowDays}`, { cache: "no-store" });
            if (!j?.ok) return 0;
            const n2 = Number(j?.count ?? 0);
            return Number.isFinite(n2) ? n2 : 0;
          }));
          let sum = 0;
          for (const res of results) if (res.status === "fulfilled") sum += res.value;
          if (!cancelled) setMilestonesDueLive(sum);
        } catch {} finally { if (!cancelled) setMilestonesDueLoading(false); }
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
          if (pj?.ok && pj?.panel) { if (!cancelled) setMilestonesPanel(pj.panel as MilestonesPanel); return; }
          const ids = projectIdsKey.split("|").filter(Boolean);
          const results = await Promise.allSettled(ids.map(async (projectId) => {
            const j: any = await fetchJson(`/api/projects/${projectId}/milestones/panel?days=${numericWindowDays}`, { cache: "no-store" });
            if (!j?.ok) return null;
            return (j.panel ?? null) as MilestonesPanel | null;
          }));
          let due = 0, overdue = 0, onTrack = 0, aiHigh = 0;
          let planned = 0, inProg = 0, atRisk = 0, completed = 0;
          let slipSum = 0, slipCount = 0, maxSlip = 0;
          for (const res of results) {
            if (res.status !== "fulfilled" || !res.value) continue;
            const p = res.value;
            due += num(p.due_count); overdue += num(p.overdue_count); onTrack += num(p.on_track_count); aiHigh += num(p.ai_high_risk_count);
            planned += num(p.status_breakdown?.planned); inProg += num(p.status_breakdown?.in_progress);
            atRisk += num(p.status_breakdown?.at_risk); completed += num(p.status_breakdown?.completed);
            const avg = p.slippage?.avg_slip_days; const mx = p.slippage?.max_slip_days;
            if (Number.isFinite(Number(avg))) { slipSum += Number(avg); slipCount += 1; }
            if (Number.isFinite(Number(mx))) maxSlip = Math.max(maxSlip, Number(mx));
          }
          const panelAgg: MilestonesPanel = {
            days: numericWindowDays, due_count: due, overdue_count: overdue, on_track_count: onTrack, ai_high_risk_count: aiHigh,
            status_breakdown: { planned, in_progress: inProg, at_risk: atRisk, completed, overdue },
            slippage: { avg_slip_days: slipCount ? Math.round((slipSum / slipCount) * 10) / 10 : 0, max_slip_days: maxSlip },
          };
          if (!cancelled) setMilestonesPanel(panelAgg);
        } catch { if (!cancelled) setMilestonesPanel(null); }
        finally { if (!cancelled) setMilestonesPanelLoading(false); }
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
      safeStr(row?.due_at) || safeStr(row?.dueAt) || safeStr(row?.target_date) ||
      safeStr(row?.targetDate) || "";
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
          const missingTyped = !Number.isFinite(Number(risk_due)) || !Number.isFinite(Number(issue_due)) || !Number.isFinite(Number(dependency_due)) || !Number.isFinite(Number(assumption_due));
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
            risk_overdue: ovRisk || undefined, issue_overdue: ovIssue || undefined, dependency_overdue: ovDep || undefined, assumption_overdue: ovAss || undefined,
            risk_hi: num(p?.risk_hi), issue_hi: num(p?.issue_hi), dependency_hi: num(p?.dependency_hi), assumption_hi: num(p?.assumption_hi), overdue_hi: num(p?.overdue_hi),
          });
        } catch {} finally { if (!cancelled) setRaidLoading(false); }
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

  const topStories: SuccessStoryTop[] = ssSummary && ssSummary.ok && Array.isArray(ssSummary.top) ? ssSummary.top : [];
  const active = topStories.length ? topStories[Math.min(ssIdx, topStories.length - 1)] : null;
  const ssTone = pickCategoryTone(active?.category ?? null);
  const ssScore = ssSummary && ssSummary.ok ? clamp01to100(ssSummary.score) : 0;
  const ssDelta = ssSummary && ssSummary.ok && Number.isFinite(Number(ssSummary.delta)) ? Number(ssSummary.delta) : null;
  const ssBreakdown = ssSummary && ssSummary.ok ? ssSummary.breakdown : undefined;
  const ssCountFromBreakdown = ssBreakdown
    ? num(ssBreakdown.milestones_done) + num(ssBreakdown.wbs_done) + num(ssBreakdown.raid_resolved) + num(ssBreakdown.changes_delivered) + num(ssBreakdown.lessons_positive)
    : 0;
  const ssDisplayCount = ssCountFromBreakdown > 0 ? ssCountFromBreakdown : ssSummary && ssSummary.ok ? num(ssSummary.count, 0) : 0;
  const ssValue = ssLoading ? "…" : ssErr ? "—" : `${ssDisplayCount}`;
  const ssSub = ssLoading ? "Loading stories…" : ssErr ? "Success stories unavailable" : active ? active.title : ssDisplayCount > 0 ? `${ssDisplayCount} success stor${ssDisplayCount === 1 ? "y" : "ies"} in ${windowNarr}` : `No success stories in ${windowNarr}`;
  const ssMetaLine = ssLoading ? `Window: ${windowLabel}` : ssErr ? "Check /api/success-stories/summary" : ssDisplayCount > 0 ? `— ${ssScore}% confidence • ${active?.project_title ? active.project_title : "Portfolio"}` : `Window: ${windowLabel}`;
  const ssAiLine = ssLoading ? "Analysing delivery artifacts…" : ssErr ? ssErr : active ? active.summary : "As milestones complete and risks close, Success Stories will appear automatically.";
  const ssTooltip = "Success Story is generated from delivery artifacts. Click to view all.";

  function openSuccessStories() {
    const sp = new URLSearchParams();
    sp.set("days", String(numericWindowDays));
    router.push(`/success-stories?${sp.toString()}`);
  }

  // Due soon
  useEffect(() => {
    if (!ok || !isExec) return;
    let cancelled = false;
    runIdle(() => {
      (async () => {
        try {
          setDueLoading(true); setDueErr("");
          const j = await fetchJson<ArtifactDueResp>(`/api/ai/events`, {
            method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
            body: JSON.stringify({ eventType: "artifact_due", windowDays: dueWindowDays }),
          });
          if (!j || !j.ok) throw new Error((j as any)?.error || "Failed");
          const ai = (j as any).ai as ArtifactDueAi;
          const list = Array.isArray(ai?.dueSoon) ? ai.dueSoon : [];
          const c = ai?.counts || ({} as any);
          const counts = { milestone: num(c.milestone), work_item: num(c.work_item), raid: num(c.raid), artifact: num(c.artifact), change: num(c.change), total: num(c.milestone) + num(c.work_item) + num(c.raid) + num(c.artifact) + num(c.change) };
          const merged = list.slice().sort((a, b) => {
            const at = a?.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
            const bt = b?.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
            if (at !== bt) return at - bt;
            return safeStr(a?.title).localeCompare(safeStr(b?.title));
          }).slice(0, 30).map((x) => ({ ...x, title: safeStr(x?.title).trim() || "Untitled", link: safeStr(x?.link).trim() || null }));
          if (!cancelled) { setDueItems(merged); setDueCounts(counts); setDueUpdatedAt(new Date().toISOString()); }
        } catch (e: any) {
          if (!cancelled) { setDueErr(e?.message || "Failed"); setDueItems([]); setDueCounts({ total: 0, milestone: 0, work_item: 0, raid: 0, artifact: 0, change: 0 }); }
        } finally { if (!cancelled) setDueLoading(false); }
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
      return st.includes("closed") || st.includes("cancel") || st.includes("cancell") || st.includes("deleted") || st.includes("archive") || st.includes("inactive") || st.includes("complete");
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
  const ragScoredCount = ragAgg.scored;

  const apiScore = phData?.ok ? clamp01to100(phData.portfolio_health) : null;
  const fallbackScore = ragScoredCount ? ragAgg.avgHealth : clamp01to100(kpis.portfolioHealth);
  const portfolioScore = phLoading ? null : apiScore ?? fallbackScore;

  const phDelta = portfolioScore != null && phPrevScore != null && Number.isFinite(Number(portfolioScore)) && Number.isFinite(Number(phPrevScore))
    ? Number(portfolioScore) - Number(phPrevScore) : null;

  const phMetaLine = phPrevLoading ? `Trend: loading…` : phPrevErr ? `Trend: —` : phDelta == null ? `Trend: —` : `Trend: ${fmtDelta(phDelta)}`;
  const phTooltip = portfolioThresholdsTooltip() + "\n\nTrend arrow compares current window vs the next longer window.";
  const phScoreForUi = clamp01to100(portfolioScore ?? fallbackScore);
  const phRag = scoreToRag(phScoreForUi);

  if (!ok) {
    return (
      <div className={`min-h-screen ${THEME.pageBg} grid place-items-center p-10`}>
        <div className="max-w-lg rounded-2xl border border-white/10 bg-white/5 p-10 backdrop-blur-xl shadow-2xl">
          <div className="text-2xl font-bold text-white">Dashboard Error</div>
          <div className="mt-3 text-gray-400">{(data as any).error}</div>
        </div>
      </div>
    );
  }

  const phBand = portfolioScore != null
    ? phScoreForUi >= 85 ? "Strong" : phScoreForUi >= 70 ? "Healthy" : phScoreForUi >= 55 ? "Mixed" : "At Risk"
    : "Loading";

  const KPI_CARD_CLASS = "h-[420px] flex flex-col";

  return (
    <LazyMotion features={domAnimation}>
      {/* Global font injection */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap');
        :root { --font-body: 'Outfit', sans-serif; --font-mono: 'Space Mono', monospace; --cyan: #00D8FF; --gold: #F5C842; }
        body { font-family: var(--font-body) !important; }
        .font-mono { font-family: var(--font-mono) !important; }
        .scanline-overlay::after {
          content: '';
          position: absolute; inset: 0;
          background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px);
          pointer-events: none; border-radius: inherit;
        }
        .glow-cyan { text-shadow: 0 0 20px rgba(0,216,255,0.6); }
        .glow-gold { text-shadow: 0 0 20px rgba(245,200,66,0.6); }
        @keyframes pulse-ring { 0%,100% { opacity:0.4; transform: scale(1); } 50% { opacity:0.8; transform: scale(1.05); } }
        .pulse-ring { animation: pulse-ring 3s ease-in-out infinite; }
        @keyframes data-stream { 0% { background-position: 0% 50%; } 100% { background-position: 100% 50%; } }
        .data-stream {
          background: linear-gradient(90deg, transparent 0%, rgba(0,216,255,0.08) 50%, transparent 100%);
          background-size: 200% 100%;
          animation: data-stream 2s linear infinite;
        }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(0,216,255,0.3); }
      `}</style>

      <div className={`relative min-h-screen overflow-hidden ${THEME.pageBg} selection:bg-cyan-500/20 selection:text-cyan-300`} style={{ fontFamily: "'Outfit', sans-serif" }}>

        {/* 🌌 Background Atmosphere */}
        <div className="fixed inset-0 pointer-events-none z-0">
          {/* Base gradient */}
          <div className="absolute inset-0 bg-[#080B12]" />

          {/* Radial glows */}
          <div className="absolute top-0 left-1/3 w-[800px] h-[500px] rounded-full opacity-[0.07]"
            style={{ background: "radial-gradient(ellipse, #00D8FF 0%, transparent 70%)", filter: "blur(60px)" }} />
          <div className="absolute bottom-1/4 right-1/4 w-[600px] h-[400px] rounded-full opacity-[0.05]"
            style={{ background: "radial-gradient(ellipse, #7C3AED 0%, transparent 70%)", filter: "blur(80px)" }} />
          <div className="absolute top-1/2 left-0 w-[400px] h-[400px] rounded-full opacity-[0.04]"
            style={{ background: "radial-gradient(ellipse, #F5C842 0%, transparent 70%)", filter: "blur(100px)" }} />

          {/* Subtle grid */}
          <div className="absolute inset-0 opacity-[0.015]"
            style={{ backgroundImage: "linear-gradient(rgba(0,216,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(0,216,255,0.5) 1px, transparent 1px)", backgroundSize: "80px 80px" }} />

          {/* Corner accent lines */}
          <div className="absolute top-0 left-0 w-64 h-px bg-gradient-to-r from-cyan-500/40 to-transparent" />
          <div className="absolute top-0 left-0 w-px h-64 bg-gradient-to-b from-cyan-500/40 to-transparent" />
          <div className="absolute top-0 right-0 w-64 h-px bg-gradient-to-l from-cyan-500/20 to-transparent" />
        </div>

        <div className="relative mx-auto max-w-7xl px-6 py-8 z-10">

          {/* 🧭 Header */}
          <header className="mb-12">
            <div className="flex items-center justify-between">
              <m.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="flex items-center gap-4 mb-2">
                  {/* Logo mark */}
                  <div className="relative">
                    <div className="absolute inset-0 rounded-xl bg-cyan-500/20 blur-md pulse-ring" />
                    <div className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-500/30 bg-[#080B12]">
                      <Layers className="h-5 w-5 text-cyan-400" />
                    </div>
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold tracking-[0.15em] text-white uppercase" style={{ fontFamily: "'Space Mono', monospace" }}>
                      <span className="text-cyan-400 glow-cyan">ΛLIΞNΛ</span>
                      <span className="text-gray-600 text-base font-normal ml-3 tracking-normal" style={{ fontFamily: "'Outfit', sans-serif" }}>PM Suite</span>
                    </h1>
                  </div>
                </div>
                <div className="flex items-center gap-3 ml-[60px]">
                  <div className="h-px w-4 bg-cyan-500/40" />
                  <p className="text-xs text-gray-600 tracking-widest uppercase">{today}</p>
                </div>
              </m.div>

              <m.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="flex items-center gap-3"
              >
                {/* System status */}
                <div className="hidden md:flex items-center gap-2.5 px-4 py-2 rounded-full border border-emerald-500/20 bg-emerald-950/30">
                  <div className="relative flex items-center">
                    <div className="h-2 w-2 rounded-full bg-emerald-400" />
                    <div className="absolute h-2 w-2 rounded-full bg-emerald-400 animate-ping opacity-60" />
                  </div>
                  <span className="text-xs text-emerald-400 font-medium tracking-wide">All Systems Operational</span>
                </div>
                <NotificationBell />
              </m.div>
            </div>

            {/* Thin separator */}
            <m.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 1, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="mt-8 h-px origin-left"
              style={{ background: "linear-gradient(90deg, rgba(0,216,255,0.4) 0%, rgba(0,216,255,0.1) 40%, transparent 100%)" }}
            />
          </header>

          {/* EXEC COCKPIT */}
          {isExec ? (
            <>
              {/* 🎯 Control Bar */}
              <m.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6"
              >
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <div className="h-px w-6 bg-cyan-500/60" />
                    <span className="text-[10px] text-cyan-500 uppercase tracking-[0.2em] font-semibold">Executive Command Centre</span>
                  </div>
                  <h2 className="text-4xl font-bold tracking-tight text-white">Portfolio Overview</h2>
                  <p className="text-gray-500 mt-1.5 text-sm">Real-time intelligence • Live data</p>
                </div>

                {/* Window selector */}
                <div className="flex items-center gap-1 p-1 rounded-xl border border-white/[0.07] bg-white/[0.02] backdrop-blur-sm">
                  {[7, 14, 30, 60].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setWindowDays(d as WindowDays)}
                      className={[
                        "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                        windowDays === d
                          ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 shadow-[0_0_12px_rgba(0,216,255,0.15)]"
                          : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.04]",
                      ].join(" ")}
                    >
                      {d}d
                    </button>
                  ))}
                  <div className="w-px h-5 bg-white/10 mx-1" />
                  <button
                    type="button"
                    onClick={() => setWindowDays("all")}
                    className={[
                      "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                      windowDays === "all"
                        ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 shadow-[0_0_12px_rgba(0,216,255,0.15)]"
                        : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.04]",
                    ].join(" ")}
                  >
                    All Time
                  </button>
                </div>
              </m.div>

              {/* 📊 KPI Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
                {[
                  // Portfolio Health
                  <KpiCard
                    key="ph"
                    cardClassName={KPI_CARD_CLASS}
                    label="Portfolio Health"
                    value={phBand}
                    sub={`${ragAgg.g} Green • ${ragAgg.a} Amber • ${ragAgg.r} Red`}
                    icon={<Activity className="h-5 w-5" />}
                    tone="cyan"
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
                        {phErr && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-800/40 rounded-lg px-3 py-2">{phErr}</div>}
                        {phData?.ok && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setShowPhDetails((v) => !v); }}
                            className="w-full h-9 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs text-gray-400 hover:bg-white/[0.06] hover:text-gray-200 hover:border-cyan-500/20 transition-all flex items-center justify-center gap-2"
                          >
                            {showPhDetails ? "Hide Details" : "View Drivers"}
                            <ChevronRight className={`h-3 w-3 transition-transform ${showPhDetails ? "rotate-90" : ""}`} />
                          </button>
                        )}
                        {showPhDetails && phData?.ok && <PortfolioHealthDrivers parts={phData.parts} drivers={phData.drivers} />}
                      </div>
                    }
                    delay={0}
                  />,
                  // Success Stories
                  <KpiCard
                    key="ss"
                    cardClassName={KPI_CARD_CLASS}
                    label="Success Stories"
                    value={ssValue}
                    sub={ssSub}
                    icon={<Trophy className="h-5 w-5" />}
                    tone="gold"
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
                        <div className="mt-4">
                          <Button
                            variant="outline"
                            className="w-full border-white/[0.08] bg-white/[0.03] text-gray-300 hover:bg-white/[0.07] hover:text-white hover:border-white/[0.12] transition-all"
                            onClick={(e) => { e.stopPropagation(); openSuccessStories(); }}
                          >
                            View Summary <ArrowUpRight className="ml-2 h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    }
                    delay={0.05}
                  />,
                  // Milestones
                  <KpiCard
                    key="ms"
                    cardClassName={KPI_CARD_CLASS}
                    label="Milestones Due"
                    value={milestonesDueLoading ? "…" : `${milestonesDueLive}`}
                    sub={windowDays === "all" ? "Using last 60 days" : `Next ${windowDays} days`}
                    icon={<Clock3 className="h-5 w-5" />}
                    tone="cyan"
                    onClick={openMilestonesDrilldown}
                    extra={<MilestonesMeta loading={milestonesPanelLoading} panel={milestonesPanel} />}
                    delay={0.1}
                  />,
                  // RAID
                  <KpiCard
                    key="raid"
                    cardClassName={KPI_CARD_CLASS}
                    label="RAID — Due"
                    value={raidLoading ? "…" : `${raidDueTotal}`}
                    sub={windowDays === "all" ? "Using last 60 days" : `Window ${windowDays}d`}
                    icon={<AlertTriangle className="h-5 w-5" />}
                    tone="rose"
                    onClick={openRaidDrilldown}
                    extra={<RaidMeta loading={raidLoading} panel={raidPanel} onClickType={openRaid} />}
                    delay={0.15}
                  />,
                ]}
              </div>

              {/* 📋 Main Content Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* AI Briefing */}
                <div className="lg:col-span-2 space-y-6">
                  <GlassCard delay={0.2}>
                    <div className="flex items-start justify-between mb-6">
                      <div className="flex items-center gap-4">
                        <div className="relative">
                          <div className="absolute inset-0 rounded-xl bg-cyan-500/20 blur-sm" />
                          <div className="relative flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-500/25 bg-[#080B12]">
                            <Sparkles className="h-5 w-5 text-cyan-400" />
                          </div>
                        </div>
                        <div>
                          <h3 className="text-lg font-bold text-white">AI Daily Briefing</h3>
                          <p className="text-sm text-gray-600">Live governance signals</p>
                        </div>
                      </div>
                      <Button
                        className="bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 hover:border-cyan-500/30 transition-all"
                        onClick={() => router.push("/insights")}
                      >
                        View All
                      </Button>
                    </div>

                    <div className="space-y-3">
                      {insightsLoading ? (
                        <>
                          <SkeletonAlert />
                          <SkeletonAlert />
                          <SkeletonAlert />
                        </>
                      ) : insightsErr ? (
                        <AiAlert severity="medium" title="Briefing unavailable" body={insightsErr} />
                      ) : (
                        insights.slice(0, 4).map((x, i) => (
                          <m.div
                            key={`${x.id}-${x.title}`}
                            initial={{ opacity: 0, x: -16 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.4, delay: i * 0.08 }}
                          >
                            <AiAlert severity={x.severity} title={x.title} body={x.body} href={fixInsightHref(x, windowDays)} />
                          </m.div>
                        ))
                      )}
                    </div>
                  </GlassCard>

                  {/* Due Soon */}
                  <GlassCard delay={0.25}>
                    <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
                      <div className="flex items-center gap-4">
                        <div className="relative">
                          <div className="absolute inset-0 rounded-xl bg-amber-500/20 blur-sm" />
                          <div className="relative flex h-12 w-12 items-center justify-center rounded-xl border border-amber-500/25 bg-[#080B12]">
                            <Clock3 className="h-5 w-5 text-amber-400" />
                          </div>
                        </div>
                        <div>
                          <h3 className="text-lg font-bold text-white">Due Soon</h3>
                          <p className="text-sm text-gray-600">Next {dueWindowDays} days</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {[7, 14, 30].map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setDueWindowDays(d as any)}
                            className={[
                              "px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
                              dueWindowDays === d
                                ? "bg-amber-500/10 border-amber-500/25 text-amber-400"
                                : "border-white/[0.07] bg-white/[0.02] text-gray-500 hover:text-gray-300 hover:border-white/[0.12]",
                            ].join(" ")}
                          >
                            {d}d
                          </button>
                        ))}
                      </div>
                    </div>

                    {dueCounts.total > 0 ? (
                      <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                        <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between text-[10px] text-gray-600 uppercase tracking-widest bg-white/[0.01]">
                          <span>Item</span>
                          <span>Due Date</span>
                        </div>
                        <div className="max-h-[320px] overflow-auto divide-y divide-white/[0.04]">
                          {dueItems.slice(0, 8).map((it, idx) => {
                            const overdue = isOverdue(it?.dueDate);
                            const clickable = Boolean(safeStr(it?.link).trim());
                            return (
                              <m.button
                                key={idx}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: idx * 0.05 }}
                                type="button"
                                onClick={() => clickable && openDueItem(it)}
                                className={[
                                  "w-full text-left px-4 py-3 flex items-center justify-between transition-all group",
                                  clickable ? "hover:bg-white/[0.03] cursor-pointer" : "cursor-default",
                                  overdue ? "bg-rose-950/20" : "",
                                ].join(" ")}
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <span className={["shrink-0 inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wider font-medium", dueChipTone(it.itemType)].join(" ")}>
                                    {dueTypeLabel(it.itemType)}
                                  </span>
                                  <span className="text-sm text-gray-300 truncate group-hover:text-white transition-colors">{it.title}</span>
                                  {overdue && (
                                    <span className="shrink-0 text-[10px] font-bold text-rose-400 bg-rose-950/60 border border-rose-800/40 px-1.5 py-0.5 rounded uppercase tracking-wide">
                                      Overdue
                                    </span>
                                  )}
                                </div>
                                <span className="text-xs text-gray-600 shrink-0 ml-4 group-hover:text-gray-400 transition-colors font-mono">{dueDateLabel(it.dueDate)}</span>
                              </m.button>
                            );
                          })}
                        </div>
                        {dueItems.length > 8 && (
                          <div className="px-4 py-2.5 text-center border-t border-white/[0.06] bg-white/[0.01]">
                            <button
                              onClick={() => router.push(`/milestones?days=${dueWindowDays}`)}
                              className="text-xs text-cyan-500 hover:text-cyan-400 font-medium transition-colors"
                            >
                              View {dueItems.length - 8} more items →
                            </button>
                          </div>
                        )}
                      </div>
                    ) : dueLoading ? (
                      <div className="data-stream rounded-xl border border-white/[0.06] px-4 py-12 text-center">
                        <div className="text-sm text-gray-600">Scanning artifacts…</div>
                      </div>
                    ) : (
                      <div className="text-center py-12 border border-dashed border-white/[0.06] rounded-xl">
                        <CheckCircle2 className="h-8 w-8 text-gray-700 mx-auto mb-3" />
                        <p className="text-gray-400 font-medium">All caught up</p>
                        <p className="text-sm text-gray-700 mt-1">Nothing due in the next {dueWindowDays} days</p>
                      </div>
                    )}
                  </GlassCard>
                </div>

                {/* Sidebar */}
                <div className="space-y-6">
                  {/* Approvals */}
                  <GlassCard delay={0.3}>
                    <div className="flex items-center justify-between mb-5">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className="absolute inset-0 rounded-xl bg-emerald-500/15 blur-sm" />
                          <div className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-500/20 bg-[#080B12]">
                            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                          </div>
                        </div>
                        <div>
                          <h3 className="text-base font-bold text-white">Approvals</h3>
                          <p className="text-xs text-gray-600">{approvalCount} pending</p>
                        </div>
                      </div>
                      {approvalCount > 0 && (
                        <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-emerald-500/15 border border-emerald-500/20 text-xs font-bold text-emerald-400">
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
                              initial={{ opacity: 0, y: 8 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, x: -20, transition: { duration: 0.2 } }}
                              className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 hover:border-white/[0.12] hover:bg-white/[0.04] transition-all"
                            >
                              <div className="flex items-start justify-between gap-3 mb-3">
                                <div className="min-w-0">
                                  <div className="font-medium text-sm text-gray-200 truncate">{title}</div>
                                  <div className="text-xs text-gray-600 mt-1 font-mono">
                                    {createdAt ? new Date(createdAt).toISOString().slice(0, 10) : "—"}
                                  </div>
                                </div>
                                {href && (
                                  <a href={href} className="shrink-0 text-gray-600 hover:text-cyan-400 transition-colors">
                                    <ArrowUpRight className="h-4 w-4" />
                                  </a>
                                )}
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  className="flex-1 h-8 bg-emerald-950/50 hover:bg-emerald-950/80 text-emerald-400 border border-emerald-800/50 hover:border-emerald-600/50 text-xs transition-all"
                                  disabled={isBusy}
                                  onClick={() => decide(taskId, "approve")}
                                >
                                  {isBusy ? "…" : "Approve"}
                                </Button>
                                <Button
                                  size="sm"
                                  className="flex-1 h-8 bg-rose-950/50 hover:bg-rose-950/80 text-rose-400 border border-rose-800/50 hover:border-rose-600/50 text-xs transition-all"
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
                        <div className="text-center py-8 border border-dashed border-white/[0.06] rounded-xl">
                          <CheckCheck className="h-6 w-6 text-gray-700 mx-auto mb-2" />
                          <p className="text-sm text-gray-600">No approvals waiting</p>
                        </div>
                      )}
                    </div>
                  </GlassCard>

                  {/* Quick Stats */}
                  <GlassCard delay={0.35} className="border-cyan-500/10">
                    <div className="flex items-center gap-2 mb-5">
                      <div className="h-px flex-1 bg-white/[0.06]" />
                      <span className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold">Quick Stats</span>
                      <div className="h-px flex-1 bg-white/[0.06]" />
                    </div>
                    <div className="space-y-4">
                      {[
                        { label: "Active Projects", value: uiActiveCount, format: "number" },
                        { label: "Portfolio Score", value: phScoreForUi, format: "percent", rag: phRag },
                        { label: "Open Risks", value: kpis.openRisks, format: "number" },
                      ].map((stat, i) => (
                        <m.div
                          key={stat.label}
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.4 + i * 0.05 }}
                          className="flex items-center justify-between"
                        >
                          <span className="text-sm text-gray-500">{stat.label}</span>
                          {stat.format === "percent" ? (
                            <span className={["text-sm font-bold px-2.5 py-1 rounded-lg border", ragBadgeClasses((stat as any).rag)].join(" ")}>
                              {stat.value}%
                            </span>
                          ) : (
                            <span className="text-xl font-bold text-white" style={{ fontFamily: "'Space Mono', monospace" }}>
                              {stat.value}
                            </span>
                          )}
                        </m.div>
                      ))}
                    </div>
                  </GlassCard>
                </div>
              </div>

              {/* 🗂️ Projects Grid */}
              <m.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.4 }}
                className="mt-12"
              >
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <div className="h-px w-5 bg-cyan-500/40" />
                      <span className="text-[10px] text-cyan-500 uppercase tracking-[0.2em] font-semibold">Active Engagements</span>
                    </div>
                    <h2 className="text-2xl font-bold text-white">Project Overview</h2>
                  </div>
                  <Button
                    variant="outline"
                    className="border-white/[0.08] bg-white/[0.03] text-gray-400 hover:bg-white/[0.06] hover:text-white hover:border-white/[0.15] transition-all"
                  >
                    View All Projects
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {sortedProjects.slice(0, 9).map((p: any, i) => {
                    const code = projectCodeLabel(p.project_code);
                    const id = String(p?.id || "").trim();
                    return (
                      <m.div
                        key={String(p.id || id)}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, delay: 0.5 + i * 0.04 }}
                      >
                        <ProjectTile
                          projectRef={id}
                          title={p.title || "Project"}
                          projectCode={code}
                          clientName={safeStr(p.client_name)}
                        />
                      </m.div>
                    );
                  })}
                </div>

                {projects.length !== activeProjects.length && (
                  <div className="mt-5 text-xs text-gray-700 text-center">
                    {Math.max(0, projects.length - activeProjects.length)} closed/cancelled project{projects.length - activeProjects.length === 1 ? "" : "s"} hidden from view
                  </div>
                )}
              </m.div>
            </>
          ) : (
            /* Non-Exec View */
            <>
              <m.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
                <div className="flex items-center gap-3 mb-2">
                  <div className="h-px w-5 bg-cyan-500/40" />
                  <span className="text-[10px] text-cyan-500 uppercase tracking-[0.2em] font-semibold">Personal Command</span>
                </div>
                <h2 className="text-3xl font-bold text-white">My Day</h2>
                <p className="text-gray-600 mt-1">Focus and flow</p>
              </m.div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <KpiCard label="My Approvals" value={`${approvalCount}`} icon={<CheckCircle2 className="h-5 w-5" />} tone="emerald" delay={0} />
                <KpiCard label="Open Lessons" value={`${kpis.openLessons}`} icon={<Sparkles className="h-5 w-5" />} tone="cyan" delay={0.05} />
                <KpiCard
                  label="RAID (Due)"
                  value={raidLoading ? "…" : `${raidDueTotal || Number(kpis.openRisks || 0)}`}
                  sub={`Window ${numericWindowDays}d`}
                  icon={<AlertTriangle className="h-5 w-5" />}
                  tone="rose"
                  onClick={openRaidDrilldown}
                  extra={<RaidMeta loading={raidLoading} panel={raidPanel} onClickType={openRaid} />}
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

/* ──────────────────────────────────────────────────────────────────────────────
   🧩 Components
───────────────────────────────────────────────────────────────────────────── */

function SkeletonAlert() {
  return (
    <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-4 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 rounded-lg bg-white/[0.04] shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-3.5 bg-white/[0.04] rounded w-2/5" />
          <div className="h-3 bg-white/[0.03] rounded w-full" />
          <div className="h-3 bg-white/[0.03] rounded w-3/4" />
        </div>
      </div>
    </div>
  );
}

function GlassCard({
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
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
      className={`
        relative overflow-hidden scanline-overlay
        bg-[rgba(255,255,255,0.02)]
        border border-white/[0.07]
        hover:border-cyan-500/20
        rounded-2xl p-6
        transition-all duration-300
        ${className}
      `}
      style={{
        boxShadow: "0 1px 0 rgba(255,255,255,0.04) inset, 0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(0,0,0,0.5)",
        backdropFilter: "blur(12px)",
      }}
    >
      {/* Top edge highlight */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="relative z-10">{children}</div>
    </m.div>
  );
}

function PortfolioHealthRing({ score, rag }: { score: number; rag: RagLetter }) {
  const s = clamp01to100(score);
  const r = 22;
  const c = 2 * Math.PI * r;
  const dash = (s / 100) * c;
  const color = ragStrokeColor(rag);
  const glowColor = rag === "G" ? "rgba(16,185,129,0.4)" : rag === "A" ? "rgba(245,158,11,0.4)" : "rgba(244,63,94,0.4)";

  return (
    <div className="shrink-0 relative">
      <div className="h-16 w-16">
        <svg viewBox="0 0 56 56" className="h-full w-full -rotate-90">
          {/* Track */}
          <circle cx="28" cy="28" r={r} stroke="rgba(255,255,255,0.06)" strokeWidth="5" fill="none" />
          {/* Progress */}
          <m.circle
            cx="28" cy="28" r={r}
            stroke={color}
            strokeWidth="5"
            fill="none"
            strokeLinecap="round"
            initial={{ strokeDasharray: `0 ${c}` }}
            animate={{ strokeDasharray: `${dash} ${c}` }}
            transition={{ duration: 1.2, ease: "easeOut" }}
            style={{ filter: `drop-shadow(0 0 6px ${glowColor})` }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold text-white" style={{ fontFamily: "'Space Mono', monospace" }}>{s}%</span>
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
    const color = score >= 85
      ? "text-emerald-400 bg-emerald-950/40 border-emerald-800/40"
      : score >= 70 ? "text-cyan-400 bg-cyan-950/40 border-cyan-800/40"
      : score >= 55 ? "text-amber-400 bg-amber-950/40 border-amber-800/40"
      : "text-rose-400 bg-rose-950/40 border-rose-800/40";
    return (
      <div className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${color}`}>
        <span className="font-medium text-gray-400">{label}</span>
        <span className="font-bold" style={{ fontFamily: "'Space Mono', monospace" }}>{score}</span>
      </div>
    );
  };
  return (
    <div className="space-y-2 mt-4 pt-4 border-t border-white/[0.06]">
      <div className="text-[10px] font-semibold text-gray-600 mb-3 uppercase tracking-widest">Health Drivers</div>
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
  meta, loading, displayTotal,
}: {
  meta: { milestones_completed?: number; raid_closed?: number; changes_implemented?: number; wbs_done?: number; lessons_published?: number; };
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
    { label: "Milestones", value: milestones },
    { label: "RAID", value: raid },
    { label: "Changes", value: changes },
    { label: "WBS", value: wbs },
    { label: "Lessons", value: lessons },
    { label: "Other", value: other },
  ];
  return (
    <div className="border-t border-white/[0.06] pt-4">
      <div className="grid grid-cols-3 gap-2">
        {stats.map((stat) => (
          <div key={stat.label} className="text-center p-2 rounded-lg bg-white/[0.03] border border-white/[0.05]">
            <div className="text-lg font-bold text-white" style={{ fontFamily: "'Space Mono', monospace" }}>
              {loading ? "…" : stat.value}
            </div>
            <div className="text-[9px] uppercase tracking-widest text-gray-600 mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KpiCard({
  label, value, sub, icon, tone, onClick, extra, tooltip, metaLine, metaIcon, aiLine, rightVisual, badge, cardClassName, delay = 0,
}: {
  label: string; value: string; sub?: string; icon: React.ReactNode; tone: string;
  onClick?: () => void; extra?: React.ReactNode; tooltip?: string; metaLine?: string;
  metaIcon?: React.ReactNode; aiLine?: string; rightVisual?: React.ReactNode; badge?: React.ReactNode;
  cardClassName?: string; delay?: number;
}) {
  const clickable = typeof onClick === "function";

  const toneConfig: Record<string, { iconBg: string; iconBorder: string; iconColor: string; glow: string }> = {
    cyan:    { iconBg: "bg-cyan-950/50", iconBorder: "border-cyan-800/50", iconColor: "text-cyan-400", glow: "rgba(0,216,255,0.15)" },
    gold:    { iconBg: "bg-amber-950/50", iconBorder: "border-amber-800/50", iconColor: "text-amber-400", glow: "rgba(245,200,66,0.15)" },
    emerald: { iconBg: "bg-emerald-950/50", iconBorder: "border-emerald-800/50", iconColor: "text-emerald-400", glow: "rgba(16,185,129,0.15)" },
    rose:    { iconBg: "bg-rose-950/50", iconBorder: "border-rose-800/50", iconColor: "text-rose-400", glow: "rgba(244,63,94,0.15)" },
    indigo:  { iconBg: "bg-violet-950/50", iconBorder: "border-violet-800/50", iconColor: "text-violet-400", glow: "rgba(124,58,237,0.15)" },
  };

  const tc = toneConfig[tone] || toneConfig.cyan;

  return (
    <GlassCard delay={delay} className={[clickable ? "cursor-pointer group" : "", cardClassName || ""].join(" ")}>
      <div
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={onClick}
        onKeyDown={(e) => { if (!clickable) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } }}
        className={["outline-none", cardClassName?.includes("flex") ? "flex flex-col h-full" : ""].join(" ")}
        title={tooltip || (clickable ? "Click to view details" : undefined)}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-2">
              <p className="text-xs text-gray-600 uppercase tracking-widest font-semibold">{label}</p>
              {badge}
              {tooltip && (
                <span className="text-[9px] text-gray-700 border border-white/[0.06] px-1.5 py-0.5 rounded font-mono cursor-help" title={tooltip}>i</span>
              )}
            </div>

            <p className="text-4xl font-bold text-white tracking-tight" style={{ fontFamily: "'Space Mono', monospace" }}>
              {value}
            </p>
            {sub && <p className="text-xs text-gray-600 mt-2 line-clamp-2">{sub}</p>}

            {metaLine && (
              <div className="mt-3 inline-flex items-center gap-2 text-xs text-gray-500 bg-white/[0.03] border border-white/[0.06] px-2.5 py-1.5 rounded-lg">
                {metaIcon && <span className="text-gray-600">{metaIcon}</span>}
                <span className="truncate">{metaLine}</span>
              </div>
            )}

            {aiLine && <p className="mt-3 text-xs text-gray-600 line-clamp-2 leading-relaxed">{aiLine}</p>}
          </div>

          {rightVisual ? (
            <div className="shrink-0">{rightVisual}</div>
          ) : (
            <div className={`shrink-0 flex items-center justify-center w-11 h-11 rounded-xl border ${tc.iconBg} ${tc.iconBorder} ${tc.iconColor} transition-all group-hover:scale-110 group-hover:shadow-lg`}
              style={{ boxShadow: `0 0 0 0 ${tc.glow}`, transition: "box-shadow 0.3s ease" }}
            >
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
  severity, title, body, href,
}: {
  severity: "high" | "medium" | "info"; title: string; body: string; href?: string;
}) {
  const config = {
    high: {
      border: "border-rose-800/40",
      bg: "bg-rose-950/20 hover:bg-rose-950/30",
      iconBg: "bg-rose-950/40 border-rose-800/40",
      iconColor: "text-rose-400",
      pill: "bg-rose-950/50 border-rose-800/40 text-rose-400",
      label: "Critical",
    },
    medium: {
      border: "border-amber-800/30",
      bg: "bg-amber-950/15 hover:bg-amber-950/25",
      iconBg: "bg-amber-950/40 border-amber-800/40",
      iconColor: "text-amber-400",
      pill: "bg-amber-950/50 border-amber-800/40 text-amber-400",
      label: "Warning",
    },
    info: {
      border: "border-cyan-800/20",
      bg: "bg-cyan-950/10 hover:bg-cyan-950/20",
      iconBg: "bg-cyan-950/40 border-cyan-800/40",
      iconColor: "text-cyan-500",
      pill: "bg-cyan-950/50 border-cyan-800/40 text-cyan-400",
      label: "Info",
    },
  }[severity];

  const Icon = severity === "high" ? AlertTriangle : severity === "medium" ? AlertTriangle : Sparkles;

  return (
    <div className={`group rounded-xl border p-4 transition-all duration-200 ${config.border} ${config.bg}`}>
      <div className="flex items-start gap-3">
        <div className={`shrink-0 flex h-8 w-8 items-center justify-center rounded-lg border ${config.iconBg} ${config.iconColor}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3 mb-1">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest ${config.pill}`}>
                {config.label}
              </span>
              <h4 className="font-semibold text-sm text-gray-200">{title}</h4>
            </div>
            {href && (
              <a href={href} className="shrink-0 text-[11px] text-gray-600 hover:text-cyan-400 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all font-medium">
                View <ArrowUpRight className="h-3 w-3" />
              </a>
            )}
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">{body}</p>
        </div>
      </div>
    </div>
  );
}

function MilestonesMeta({ loading, panel }: { loading: boolean; panel: MilestonesPanel | null }) {
  const stats = [
    { label: "Planned", value: num(panel?.status_breakdown?.planned), color: "text-gray-400" },
    { label: "At Risk", value: num(panel?.status_breakdown?.at_risk), color: "text-amber-400" },
    { label: "Overdue", value: num(panel?.overdue_count), color: "text-rose-400" },
  ];
  return (
    <div className="mt-4 pt-4 border-t border-white/[0.06]">
      <div className="flex items-center justify-between gap-2">
        {stats.map((stat) => (
          <div key={stat.label} className="text-center flex-1 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
            <div className={`text-xl font-bold ${stat.color}`} style={{ fontFamily: "'Space Mono', monospace" }}>
              {loading ? "…" : stat.value}
            </div>
            <div className="text-[9px] uppercase tracking-widest text-gray-700 mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RaidMeta({
  loading, panel, onClickType,
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
    <div className="mt-4 pt-4 border-t border-white/[0.06]">
      {!hasTypedBreakdown ? (
        <button
          onClick={(e) => { e.stopPropagation(); onClickType(undefined, { hi: false }); }}
          className="w-full rounded-xl border border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.12] transition-all px-3 py-3 flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-rose-950/40 border border-rose-800/40">
              <AlertTriangle className="h-4 w-4 text-rose-400" />
            </span>
            <div className="text-left">
              <div className="text-[9px] font-bold text-gray-600 uppercase tracking-widest">Due in window</div>
              <div className="text-xs text-gray-500">Type breakdown unavailable</div>
            </div>
          </div>
          <div className="text-xl font-bold text-white" style={{ fontFamily: "'Space Mono', monospace" }}>{loading ? "…" : dueTotal}</div>
        </button>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Risk", value: riskVal, type: "Risk" as const, color: "text-rose-400" },
            { label: "Issue", value: issueVal, type: "Issue" as const, color: "text-amber-400" },
            { label: "Dep", value: depVal, type: "Dependency" as const, color: "text-cyan-400" },
            { label: "Assum", value: assVal, type: "Assumption" as const, color: "text-gray-400" },
          ].map((item) => (
            <button
              key={item.label}
              onClick={(e) => { e.stopPropagation(); onClickType(item.type, { hi: false }); }}
              className="text-center p-2 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.05] hover:border-white/[0.12] transition-all"
            >
              <div className={`text-lg font-bold ${item.color}`} style={{ fontFamily: "'Space Mono', monospace" }}>
                {loading ? "…" : item.value}
              </div>
              <div className="text-[9px] uppercase tracking-widest text-gray-600 mt-0.5">{item.label}</div>
            </button>
          ))}
        </div>
      )}

      <button
        onClick={(e) => { e.stopPropagation(); onClickType(undefined, { overdue: true }); }}
        className="mt-2 w-full rounded-xl border border-rose-900/20 bg-rose-950/10 hover:bg-rose-950/20 hover:border-rose-800/30 transition-all px-3 py-2.5 flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <Clock3 className="h-3.5 w-3.5 text-rose-500" />
          <div className="text-[9px] font-bold text-rose-700 uppercase tracking-widest">Overdue Items</div>
        </div>
        <div className="text-sm font-bold text-rose-400" style={{ fontFamily: "'Space Mono', monospace" }}>
          {loading ? "…" : overdueVal}
        </div>
      </button>
    </div>
  );
}

function ProjectTile({
  projectRef, title, subtitle = "RAID • Changes • Lessons • Reporting", projectCode, clientName,
}: {
  projectRef: string; title: string; subtitle?: string; projectCode?: string; clientName?: string;
}) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);

  function go() {
    if (!projectRef) return;
    router.push(`/projects/${encodeURIComponent(projectRef)}`);
  }

  const code = safeStr(projectCode).trim();
  const client = safeStr(clientName).trim();

  return (
    <m.div
      role="link"
      tabIndex={0}
      onClick={go}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
      className="cursor-pointer rounded-xl border border-white/[0.07] bg-white/[0.02] p-5 hover:border-cyan-500/20 hover:bg-white/[0.04] transition-colors relative overflow-hidden group"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.03) inset" }}
    >
      {/* Hover glow */}
      <AnimatePresence>
        {hovered && (
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 rounded-xl pointer-events-none"
            style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(0,216,255,0.05) 0%, transparent 70%)" }}
          />
        )}
      </AnimatePresence>

      <div className="relative z-10">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-2.5 flex-wrap">
              {code && (
                <span className="inline-flex items-center rounded-md bg-cyan-950/50 border border-cyan-800/40 px-2 py-0.5 text-[10px] font-bold text-cyan-400 uppercase tracking-wider" style={{ fontFamily: "'Space Mono', monospace" }}>
                  {code}
                </span>
              )}
              {client && (
                <span className="inline-flex items-center rounded-md bg-white/[0.03] border border-white/[0.07] px-2 py-0.5 text-[10px] text-gray-500">
                  {client}
                </span>
              )}
            </div>
            <h3 className="text-sm font-semibold text-gray-200 group-hover:text-white transition-colors truncate leading-snug">{title}</h3>
            <p className="text-[11px] text-gray-700 mt-1.5">{subtitle}</p>
          </div>
          <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-200">
            <div className="h-7 w-7 rounded-lg bg-cyan-950/50 border border-cyan-800/40 flex items-center justify-center">
              <ArrowUpRight className="h-3.5 w-3.5 text-cyan-400" />
            </div>
          </div>
        </div>

        {/* Bottom line accent */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/0 to-transparent group-hover:via-cyan-500/20 transition-all duration-300" />
      </div>
    </m.div>
  );
}