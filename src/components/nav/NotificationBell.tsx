"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  CheckCheck,
  AlertTriangle,
  Sparkles,
  ShieldCheck,
  Clock3,
  Trophy,
  CircleDot,
  X,
} from "lucide-react";

/**
 * ✅ Aligned to DB schema:
 * notifications:
 * id, user_id, project_id, artifact_id, type, title, body, link, is_read, created_at, actor_user_id, metadata,
 * source_type, source_id, due_date, bucket
 */

type Severity = "high" | "medium" | "info" | "success";

type NotifType =
  | "approval_required"
  | "approval_pending"
  | "ai_warning"
  | "risk_raised"
  | "issue_raised"
  | "milestone_due"
  | "milestone_slip"
  | "action_assigned"
  | "action_overdue"
  | "mention"
  | "portfolio_signal"
  | "success_signal"
  | "system"
  | string;

type NotificationRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  artifact_id: string | null;
  type: NotifType;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean | null;
  created_at: string;
  actor_user_id: string | null;
  metadata: any;
  source_type?: string | null;
  source_id?: string | null;
  due_date?: string | null; // DATE in Postgres often comes back as "YYYY-MM-DD"
  bucket?: string | null;
};

type ApiResp =
  | { ok: false; error: string; meta?: any }
  | { ok: true; unreadCount: number; items: NotificationRow[]; meta?: any };

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function parseYmdAsUtc(ymd: string) {
  // ymd: YYYY-MM-DD (treat as UTC midnight)
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  if (!Number.isFinite(yyyy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;
  return new Date(Date.UTC(yyyy, mm - 1, dd, 0, 0, 0));
}

function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
}

function isOverdue(n: NotificationRow) {
  // bucket wins if you set it
  const b = safeStr(n.bucket).trim().toLowerCase();
  if (b === "overdue") return true;

  // fallback: due_date is authoritative
  const due = safeStr((n as any)?.due_date).trim();
  if (!due) return false;

  const d = parseYmdAsUtc(due) ?? new Date(due);
  if (Number.isNaN(d.getTime())) return false;

  return d.getTime() < startOfTodayUtc().getTime();
}

function fmtUkYmd(ymd: string | null | undefined) {
  const v = safeStr(ymd).trim();
  if (!v) return "";
  const d = parseYmdAsUtc(v);
  if (!d) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "UTC" }).format(
    d
  );
}

function formatTimeAgo(iso: string) {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function deriveSeverity(n: NotificationRow): Severity {
  const t = safeStr(n.type).toLowerCase();
  const b = safeStr(n.bucket).toLowerCase();

  // explicit metadata override (optional)
  const metaSev = safeStr(n?.metadata?.severity || n?.metadata?.sev).toLowerCase();
  if (metaSev === "high" || metaSev === "medium" || metaSev === "info" || metaSev === "success") {
    return metaSev as Severity;
  }

  if (b === "overdue" || t.includes("overdue") || isOverdue(n)) return "high";
  if (t.includes("risk") || t.includes("issue") || t.includes("slip")) return "high";
  if (t.includes("approval") || b.includes("approval")) return "medium";
  if (t.includes("ai")) return "medium";
  if (t.includes("success")) return "success";
  return "info";
}

function iconFor(n: NotificationRow) {
  const t = safeStr(n.type).toLowerCase();
  const b = safeStr(n.bucket).toLowerCase();

  if (t.includes("approval") || b.includes("approval")) return <ShieldCheck className="h-4 w-4" />;
  if (t.includes("ai") || t.includes("slip")) return <Sparkles className="h-4 w-4" />;
  if (t.includes("overdue") || b === "overdue" || isOverdue(n)) return <Clock3 className="h-4 w-4" />;
  if (t.includes("success")) return <Trophy className="h-4 w-4" />;
  if (deriveSeverity(n) === "high") return <AlertTriangle className="h-4 w-4" />;
  return <CircleDot className="h-4 w-4" />;
}

function severityChip(sev: Severity) {
  const base = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-none";
  if (sev === "high") return `${base} border-red-500/40 text-red-200 bg-red-500/10`;
  if (sev === "medium") return `${base} border-amber-500/40 text-amber-200 bg-amber-500/10`;
  if (sev === "success") return `${base} border-emerald-500/40 text-emerald-200 bg-emerald-500/10`;
  return `${base} border-white/15 text-white/70 bg-white/5`;
}

type Tab = "all" | "action" | "ai" | "approvals";

function tabPredicate(tab: Tab, n: NotificationRow) {
  if (tab === "all") return true;

  const t = safeStr(n.type).toLowerCase();
  const b = safeStr(n.bucket).toLowerCase();

  if (tab === "approvals") return t.includes("approval") || b.includes("approval");
  if (tab === "ai") return t.includes("ai") || t.includes("slip");

  if (tab === "action") {
    return (
      t.includes("approval") ||
      b.includes("approval") ||
      t.includes("ai") ||
      t.includes("slip") ||
      t.includes("action") ||
      t.includes("overdue") ||
      b === "overdue" ||
      t.includes("risk") ||
      t.includes("issue") ||
      t.includes("milestone") ||
      t.includes("portfolio")
    );
  }

  return true;
}

function groupLabel(n: NotificationRow) {
  const ageH = (Date.now() - new Date(n.created_at).getTime()) / 36e5;
  if (ageH < 24) return "Today";
  if (ageH < 24 * 7) return "This week";
  return "Earlier";
}

function normalizeHref(href: string | null | undefined) {
  const raw = safeStr(href).trim();
  if (!raw) return null;

  // keep relative paths; avoid accidental double slashes
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;

  // lower-case known route segments (defensive)
  const qIdx = raw.indexOf("?");
  const hIdx = raw.indexOf("#");
  const cutIdx = qIdx >= 0 && hIdx >= 0 ? Math.min(qIdx, hIdx) : qIdx >= 0 ? qIdx : hIdx >= 0 ? hIdx : -1;

  const path = cutIdx >= 0 ? raw.slice(0, cutIdx) : raw;
  const tail = cutIdx >= 0 ? raw.slice(cutIdx) : "";

  const fixedPath = path
    .replace(/\/RAID(\/|$)/g, "/raid$1")
    .replace(/\/WBS(\/|$)/g, "/wbs$1")
    .replace(/\/SCHEDULE(\/|$)/g, "/schedule$1")
    .replace(/\/CHANGE(\/|$)/g, "/change$1")
    .replace(/\/CHANGES(\/|$)/g, "/changes$1")
    .replace(/\/ARTIFACTS(\/|$)/g, "/artifacts$1");

  return `${fixedPath}${tail}`;
}

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const [loading, setLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const timerRef = useRef<any>(null);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch(`/api/notifications?limit=30`, { cache: "no-store", credentials: "include" });
      const json: ApiResp = await res.json();
      if (!json.ok) throw new Error(json.error);

      setUnreadCount(json.unreadCount ?? 0);
      setItems(Array.isArray(json.items) ? json.items : []);
    } catch {
      // silent UI
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    refresh();
    timerRef.current = setInterval(refresh, 15000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => items.filter((n) => tabPredicate(tab, n)), [items, tab]);

  const grouped = useMemo(() => {
    const map = new Map<string, NotificationRow[]>();
    for (const n of filtered) {
      const k = groupLabel(n);
      const arr = map.get(k) ?? [];
      arr.push(n);
      map.set(k, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  async function markRead(id: string) {
    const wasUnread = items.some((n) => n.id === id && n.is_read !== true);

    // optimistic
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    if (wasUnread) setUnreadCount((c) => Math.max(0, c - 1));

    try {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
        cache: "no-store",
        credentials: "include",
        body: JSON.stringify({ id }),
      });
    } catch {
      // best effort
    }
  }

  async function markAllRead() {
    const unread = items.filter((n) => n.is_read !== true).length;

    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);

    try {
      await fetch("/api/notifications/read-all", {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: { "Cache-Control": "no-cache" },
      });
    } catch {
      if (unread > 0) refresh();
    }
  }

  function onClickItem(n: NotificationRow) {
    if (n.is_read !== true) markRead(n.id);
    setOpen(false);

    const href = normalizeHref(n.link);
    if (href) router.push(href);
  }

  return (
    <div className="relative">
      <Button
        variant="ghost"
        className="relative h-10 w-10 rounded-full border border-white/10 bg-white/5 hover:bg-white/10"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5 text-white/80" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white shadow">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.16 }}
              className="absolute right-0 z-50 mt-3 w-[420px] overflow-hidden rounded-2xl border border-white/10 bg-[#071021]/95 shadow-2xl backdrop-blur"
            >
              {/* header */}
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold text-white">Notifications</div>
                  {loading ? (
                    <span className="text-xs text-white/50">Updating…</span>
                  ) : (
                    <span className="text-xs text-white/50">{unreadCount} unread</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    className="h-8 rounded-full border border-white/10 bg-white/5 px-3 text-xs text-white/80 hover:bg-white/10"
                    onClick={markAllRead}
                  >
                    <CheckCheck className="mr-1 h-4 w-4" />
                    Mark all read
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-8 w-8 rounded-full border border-white/10 bg-white/5 p-0 hover:bg-white/10"
                    onClick={() => setOpen(false)}
                    aria-label="Close"
                  >
                    <X className="h-4 w-4 text-white/70" />
                  </Button>
                </div>
              </div>

              {/* tabs */}
              <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2">
                {(
                  [
                    ["all", "All"],
                    ["action", "Action"],
                    ["ai", "AI"],
                    ["approvals", "Approvals"],
                  ] as [Tab, string][]
                ).map(([k, label]) => {
                  const active = tab === k;
                  return (
                    <button
                      key={k}
                      onClick={() => setTab(k)}
                      className={[
                        "rounded-full px-3 py-1 text-xs transition",
                        active
                          ? "bg-white/10 text-white border border-white/15"
                          : "bg-transparent text-white/60 hover:text-white/80",
                      ].join(" ")}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* list */}
              <div className="max-h-[520px] overflow-auto">
                {grouped.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-white/60">
                    No notifications.
                    <div className="mt-1 text-xs text-white/40">You’re all caught up.</div>
                  </div>
                ) : (
                  grouped.map(([label, rows]) => (
                    <div key={label}>
                      <div className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide text-white/40">
                        {label}
                      </div>

                      <div className="px-2 pb-3">
                        {rows.map((n) => {
                          const unread = n.is_read !== true;
                          const sev = deriveSeverity(n);
                          const t = safeStr(n.type).toLowerCase();
                          const overdue = isOverdue(n);
                          const dueUk = n.due_date ? fmtUkYmd(n.due_date) : "";

                          return (
                            <button
                              key={n.id}
                              onClick={() => onClickItem(n)}
                              className={[
                                "mt-2 w-full rounded-2xl border px-3 py-3 text-left transition",
                                overdue
                                  ? "border-red-500/25 bg-red-500/10 hover:bg-red-500/15"
                                  : unread
                                  ? "border-white/15 bg-white/5 hover:bg-white/8"
                                  : "border-white/10 bg-white/3 hover:bg-white/6",
                              ].join(" ")}
                            >
                              <div className="flex items-start gap-3">
                                <div className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80">
                                  {iconFor(n)}
                                </div>

                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="truncate text-sm font-semibold text-white">{n.title}</div>
                                    <div className="shrink-0 text-[11px] text-white/45">{formatTimeAgo(n.created_at)}</div>
                                  </div>

                                  {n.body && <div className="mt-1 line-clamp-2 text-xs text-white/70">{n.body}</div>}

                                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                                    <span className={severityChip(sev)}>{sev.toUpperCase()}</span>

                                    {unread && (
                                      <Badge className="bg-cyan-500/15 text-cyan-200 border border-cyan-500/30">
                                        Unread
                                      </Badge>
                                    )}

                                    {overdue && (
                                      <Badge className="bg-red-500/15 text-red-200 border border-red-500/30">
                                        Overdue
                                      </Badge>
                                    )}

                                    {dueUk && (
                                      <Badge className="bg-white/5 text-white/70 border border-white/10">
                                        Due {dueUk}
                                      </Badge>
                                    )}

                                    {(t.includes("approval") || safeStr(n.bucket).toLowerCase().includes("approval")) && (
                                      <Badge className="bg-violet-500/15 text-violet-200 border border-violet-500/30">
                                        Approval
                                      </Badge>
                                    )}

                                    {(t.includes("ai") || t.includes("slip")) && (
                                      <Badge className="bg-fuchsia-500/15 text-fuchsia-200 border border-fuchsia-500/30">
                                        AI
                                      </Badge>
                                    )}
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

              {/* footer */}
              <div className="border-t border-white/10 px-4 py-3">
                <Link
                  href="/notifications"
                  className="text-xs text-white/70 hover:text-white underline-offset-4 hover:underline"
                  onClick={() => setOpen(false)}
                >
                  View all notifications
                </Link>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
