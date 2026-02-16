"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import {
  Bell,
  CheckCheck,
  CircleDot,
  AlertTriangle,
  Sparkles,
  ShieldCheck,
  Clock3,
  Trophy,
} from "lucide-react";

/**
 * ✅ ALIGNED TO DB SCHEMA:
 * notifications table columns:
 * id, user_id, project_id, artifact_id, type, title, body, link, is_read, created_at, actor_user_id, metadata,
 * source_type, source_id, due_date, bucket
 */
type NotificationRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  artifact_id: string | null;
  type: any;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean | null;
  created_at: string;
  actor_user_id: string | null;
  metadata: any;

  source_type?: string | null;
  source_id?: string | null;
  due_date?: string | null; // YYYY-MM-DD
  bucket?: string | null;
};

type ApiOk = { ok: true; unreadCount: number; items: NotificationRow[]; meta?: any };
type ApiErr = { ok: false; error: string; meta?: any };
type ApiResp = ApiOk | ApiErr;

type KpisResp =
  | {
      ok: true;
      days: number;
      kpis: {
        total: number;
        unread: number;
        overdueUnread: number;
        dueSoonUnread: number;
        approvalsUnread: number;
        aiUnread: number;
        risksIssuesUnread: number;
      };
      meta?: any;
    }
  | { ok: false; error: string; meta?: any };

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function shortId(x: any, n = 8) {
  const s = safeStr(x).trim();
  if (!s) return "";
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

function projectLabel(n: NotificationRow) {
  const code =
    safeStr(n?.metadata?.project_code || n?.metadata?.projectCode || n?.metadata?.project_code_text).trim();
  const name =
    safeStr(n?.metadata?.project_name || n?.metadata?.projectName || n?.metadata?.project_title).trim();

  if (code && name) return `${code} — ${name}`;
  if (code) return code;
  if (name) return name;

  // fallback
  const pid = safeStr(n.project_id).trim();
  return pid ? `Project — ${shortId(pid, 7)}` : "Project";
}

function timeAgo(iso: string) {
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

function formatUkDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function formatUkDateFromYmd(ymd: string | null | undefined) {
  const s = safeStr(ymd).trim();
  if (!s) return "";
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function groupLabel(createdAt: string) {
  const ageH = (Date.now() - new Date(createdAt).getTime()) / 36e5;
  if (ageH < 24) return "Today";
  if (ageH < 24 * 7) return "This week";
  return "Earlier";
}

function isOverdue(n: NotificationRow) {
  if (safeStr(n.bucket).toLowerCase() === "overdue") return true;

  const due = safeStr(n?.due_date).trim() || safeStr(n?.metadata?.dueDate || n?.metadata?.due_date).trim();
  if (!due) return false;

  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  const dueUtc = new Date(`${due.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(dueUtc.getTime())) return false;

  return dueUtc.getTime() < todayUtc.getTime();
}

function isDueSoon(n: NotificationRow) {
  return safeStr(n.bucket).toLowerCase() === "due_soon";
}

function iconFor(n: NotificationRow) {
  const t = String(n.type || "").toLowerCase();
  if (t.includes("approval")) return <ShieldCheck className="h-4 w-4" />;
  if (t.includes("ai") || t.includes("slip")) return <Sparkles className="h-4 w-4" />;
  if (isOverdue(n) || t.includes("overdue")) return <Clock3 className="h-4 w-4" />;
  if (t.includes("success")) return <Trophy className="h-4 w-4" />;
  if (t.includes("risk") || t.includes("issue")) return <AlertTriangle className="h-4 w-4" />;
  return <CircleDot className="h-4 w-4" />;
}

function badgeStyle(n: NotificationRow) {
  const t = String(n.type || "").toLowerCase();

  if (t.includes("approval"))
    return "border-violet-500 bg-violet-50 text-violet-700 shadow-[0_0_8px_rgba(139,92,246,0.4)]";
  if (t.includes("ai") || t.includes("slip"))
    return "border-fuchsia-500 bg-fuchsia-50 text-fuchsia-700 shadow-[0_0_8px_rgba(217,70,239,0.4)]";
  if (isOverdue(n) || t.includes("overdue"))
    return "border-rose-500 bg-rose-50 text-rose-700 shadow-[0_0_8px_rgba(244,63,94,0.4)]";
  if (isDueSoon(n))
    return "border-sky-500 bg-sky-50 text-sky-700 shadow-[0_0_8px_rgba(14,165,233,0.4)]";
  if (t.includes("success"))
    return "border-emerald-500 bg-emerald-50 text-emerald-700 shadow-[0_0_8px_rgba(16,185,129,0.4)]";
  if (t.includes("risk") || t.includes("issue"))
    return "border-amber-500 bg-amber-50 text-amber-700 shadow-[0_0_8px_rgba(245,158,11,0.4)]";

  return "border-slate-400 bg-slate-100 text-slate-700 shadow-[0_0_8px_rgba(148,163,184,0.3)]";
}

export default function NotificationsPage() {
  const router = useRouter();

  const WINDOW_DAYS: 7 | 14 | 30 | 60 = 14;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [tab, setTab] = useState<"all" | "unread">("all");

  const [subtab, setSubtab] = useState<"inbox" | "overdue" | "due_soon">("inbox");

  const [kpis, setKpis] = useState<{
    approvals: number;
    ai: number;
    overdue: number;
    risks: number;
    dueSoon: number;
  }>({ approvals: 0, ai: 0, overdue: 0, risks: 0, dueSoon: 0 });

  const [kpisLoaded, setKpisLoaded] = useState(false);

  const [debugMeta, setDebugMeta] = useState<any>(null);
  const [debugKpisMeta, setDebugKpisMeta] = useState<any>(null);

  const abortListRef = useRef<AbortController | null>(null);
  const abortKpisRef = useRef<AbortController | null>(null);
  const pollRef = useRef<any>(null);

  function computeKpisFromList(list: NotificationRow[]) {
    const approvals = list
      .filter((i) => String(i.type || "").toLowerCase().includes("approval"))
      .filter((i) => i.is_read !== true).length;

    const ai = list
      .filter((i) => {
        const t = String(i.type || "").toLowerCase();
        return t.includes("ai") || t.includes("slip");
      })
      .filter((i) => i.is_read !== true).length;

    const overdue = list.filter((i) => isOverdue(i)).filter((i) => i.is_read !== true).length;
    const dueSoon = list.filter((i) => isDueSoon(i)).filter((i) => i.is_read !== true).length;

    const risks = list
      .filter((i) => {
        const t = String(i.type || "").toLowerCase();
        return t.includes("risk") || t.includes("issue");
      })
      .filter((i) => i.is_read !== true).length;

    return { approvals, ai, overdue, risks, dueSoon };
  }

  async function fetchKpis(signal?: AbortSignal) {
    try {
      const r = await fetch(`/api/notifications/kpis?days=${WINDOW_DAYS}`, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        signal,
        headers: { "Cache-Control": "no-cache" },
      });

      const ct = r.headers.get("content-type") || "";
      const isJson = ct.toLowerCase().includes("application/json");
      const payload = (isJson ? await r.json().catch(() => null) : null) as KpisResp | null;

      if (!r.ok) throw new Error((payload as any)?.error || `HTTP ${r.status}`);
      if (!payload || (payload as any).ok !== true) throw new Error((payload as any)?.error || "Failed to load KPIs");

      const okp = payload as Extract<KpisResp, { ok: true }>;
      setKpis({
        approvals: Number(okp.kpis?.approvalsUnread ?? 0),
        ai: Number(okp.kpis?.aiUnread ?? 0),
        overdue: Number(okp.kpis?.overdueUnread ?? 0),
        risks: Number(okp.kpis?.risksIssuesUnread ?? 0),
        dueSoon: Number(okp.kpis?.dueSoonUnread ?? 0),
      });

      setUnreadCount(Number(okp.kpis?.unread ?? 0));
      setDebugKpisMeta(okp.meta ?? null);
      setKpisLoaded(true);
    } catch {
      setKpisLoaded(false);
    }
  }

  async function fetchList(signal?: AbortSignal) {
    const q = tab === "unread" ? "?limit=400&unread=1" : "?limit=400";

    const r = await fetch(`/api/notifications${q}`, {
      method: "GET",
      cache: "no-store",
      credentials: "include",
      signal,
      headers: { "Cache-Control": "no-cache" },
    });

    const ct = r.headers.get("content-type") || "";
    const isJson = ct.toLowerCase().includes("application/json");
    const payload = (isJson ? await r.json().catch(() => null) : null) as ApiResp | null;

    if (!r.ok) {
      const msg = payload && (payload as any).error ? String((payload as any).error) : `HTTP ${r.status}`;
      throw new Error(msg);
    }

    if (!payload || (payload as any).ok !== true) {
      throw new Error((payload as any)?.error || "Failed to load notifications");
    }

    const okPayload = payload as ApiOk;

    const serverItems = Array.isArray(okPayload.items) ? okPayload.items : [];
    const computedUnread = serverItems.filter((n) => n?.is_read !== true).length;

    setUnreadCount((prev) => {
      const fromServer = Number(okPayload.unreadCount ?? computedUnread) || 0;
      return prev > 0 ? prev : fromServer;
    });

    setItems(serverItems);
    setDebugMeta(okPayload.meta ?? null);

    if (!kpisLoaded) {
      setKpis(computeKpisFromList(serverItems));
    }
  }

  async function refresh() {
    abortListRef.current?.abort();
    abortKpisRef.current?.abort();

    const acList = new AbortController();
    const acKpis = new AbortController();
    abortListRef.current = acList;
    abortKpisRef.current = acKpis;

    setLoading(true);
    setErr("");
    setDebugMeta(null);
    setDebugKpisMeta(null);

    try {
      await Promise.allSettled([fetchKpis(acKpis.signal), fetchList(acList.signal)]);
    } catch (e: any) {
      if (String(e?.name || "").toLowerCase() === "aborterror") return;

      setErr(e?.message || "Failed to load notifications");
      setItems([]);
      setUnreadCount(0);
      setKpis({ approvals: 0, ai: 0, overdue: 0, risks: 0, dueSoon: 0 });
      setKpisLoaded(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    return () => {
      abortListRef.current?.abort();
      abortKpisRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    pollRef.current = setInterval(() => {
      fetchKpis().catch(() => {});
      fetchList().catch(() => {});
    }, 20000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const filteredItems = useMemo(() => {
    if (subtab === "overdue") return items.filter((n) => isOverdue(n));
    if (subtab === "due_soon") return items.filter((n) => isDueSoon(n));
    return items;
  }, [items, subtab]);

  const grouped = useMemo(() => {
    const map = new Map<string, NotificationRow[]>();
    for (const n of filteredItems) {
      const k = groupLabel(n.created_at);
      const arr = map.get(k) ?? [];
      arr.push(n);
      map.set(k, arr);
    }
    return Array.from(map.entries());
  }, [filteredItems]);

  const topOverdue = useMemo(() => items.filter((n) => isOverdue(n)).slice(0, 6), [items]);
  const topDueSoon = useMemo(() => items.filter((n) => isDueSoon(n)).slice(0, 6), [items]);

  async function markRead(id: string) {
    const wasUnread = items.some((n) => n.id === id && n.is_read !== true);

    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    if (wasUnread) setUnreadCount((c) => Math.max(0, c - 1));

    try {
      const r = await fetch("/api/notifications/read", {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
        body: JSON.stringify({ id }),
      });

      if (!r.ok) refresh();
      fetchKpis().catch(() => {});
    } catch {
      refresh();
    }
  }

  async function markAllRead() {
    const unread = items.filter((n) => n.is_read !== true).length;

    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
    setKpis({ approvals: 0, ai: 0, overdue: 0, risks: 0, dueSoon: 0 });

    try {
      const r = await fetch("/api/notifications/read-all", {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: { "Cache-Control": "no-cache" },
      });

      if (!r.ok && unread > 0) refresh();
      fetchKpis().catch(() => {});
    } catch {
      if (unread > 0) refresh();
    }
  }

  function openItem(n: NotificationRow) {
    if (n.is_read !== true) markRead(n.id);
    const href = safeStr(n.link).trim();
    if (href) router.push(href);
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-white text-slate-800 font-['Inter','system-ui',sans-serif]">
      {/* subtle light background with soft neon glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-slate-50 via-white to-slate-50" />
        <motion.div
          className="absolute inset-0 opacity-30"
          animate={{ rotate: 360 }}
          transition={{ duration: 180, repeat: Infinity, ease: "linear" }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_35%_65%,rgba(0,212,255,0.15),transparent_60%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_65%_35%,rgba(125,211,252,0.12),transparent_60%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_80%,rgba(34,211,238,0.10),transparent_70%)]" />
        </motion.div>
      </div>

      <div className="relative mx-auto max-w-4xl px-6 py-10 z-10">
        {/* header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border-2 border-cyan-400 bg-cyan-50 px-3 py-1 text-xs text-cyan-700 shadow-[0_0_12px_rgba(34,211,238,0.5)]">
              <Bell className="h-4 w-4 text-cyan-600" />
              Notifications
              <span className="text-cyan-400">•</span>
              <span className="text-cyan-700 font-semibold">{unreadCount} unread</span>
            </div>

            <h1 className="mt-4 text-4xl font-black text-slate-900 tracking-tight">Executive Inbox</h1>
            <p className="mt-2 text-slate-600">
              Overdue, due soon, approvals, AI warnings, actions and portfolio signals.
            </p>

            {!loading && !err && items.length === 0 && (debugMeta || debugKpisMeta) ? (
              <div className="mt-3 text-[11px] text-slate-400">
                Debug: tab={tab} • days={WINDOW_DAYS} • list.limit={String(debugMeta?.limit)} • kpi.projectCount=
                {String(debugKpisMeta?.projectCount ?? "n/a")}
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={markAllRead}
              className="bg-white hover:bg-slate-50 border-2 border-cyan-400 text-cyan-700 shadow-[0_0_12px_rgba(34,211,238,0.4)]"
            >
              <CheckCheck className="mr-2 h-4 w-4" />
              Mark all read
            </Button>
          </div>
        </div>

        {/* top tabs */}
        <div className="mt-6 flex items-center gap-2">
          {(["all", "unread"] as const).map((k) => {
            const active = tab === k;
            return (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={[
                  "px-4 py-2 rounded-full text-sm border-2 transition-all",
                  active
                    ? "bg-cyan-50 border-cyan-400 text-cyan-700 shadow-[0_0_12px_rgba(34,211,238,0.5)]"
                    : "bg-white border-slate-300 text-slate-600 hover:border-cyan-300 hover:shadow-[0_0_8px_rgba(34,211,238,0.3)]",
                ].join(" ")}
              >
                {k === "all" ? "All" : "Unread"}
              </button>
            );
          })}

          <Button
            variant="ghost"
            onClick={refresh}
            className="ml-auto rounded-full border-2 border-cyan-400 bg-white text-cyan-700 hover:bg-cyan-50 shadow-[0_0_12px_rgba(34,211,238,0.4)]"
          >
            Refresh
          </Button>
        </div>

        {/* executive KPI row */}
        {!loading && !err && (
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
            {[
              { label: "Approvals", count: kpis.approvals, color: "violet" },
              { label: "AI Signals", count: kpis.ai, color: "fuchsia" },
              { label: "Overdue", count: kpis.overdue, hot: true, color: "rose" },
              { label: "Due Soon", count: kpis.dueSoon, color: "sky" },
              { label: "Risks/Issues", count: kpis.risks, color: "amber" },
            ].map((x) => (
              <div
                key={x.label}
                className={[
                  "rounded-xl border-2 bg-white px-3 py-2 text-center shadow-[0_0_12px_rgba(0,0,0,0.05)]",
                  x.hot && x.count > 0
                    ? "border-rose-400 shadow-[0_0_16px_rgba(244,63,94,0.4)]"
                    : x.color === "violet"
                    ? "border-violet-400 shadow-[0_0_12px_rgba(139,92,246,0.3)]"
                    : x.color === "fuchsia"
                    ? "border-fuchsia-400 shadow-[0_0_12px_rgba(217,70,239,0.3)]"
                    : x.color === "sky"
                    ? "border-sky-400 shadow-[0_0_12px_rgba(14,165,233,0.3)]"
                    : x.color === "amber"
                    ? "border-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.3)]"
                    : "border-slate-300",
                ].join(" ")}
              >
                <div
                  className={[
                    "font-semibold",
                    x.hot && x.count > 0
                      ? "text-rose-600"
                      : x.color === "violet"
                      ? "text-violet-600"
                      : x.color === "fuchsia"
                      ? "text-fuchsia-600"
                      : x.color === "sky"
                      ? "text-sky-600"
                      : x.color === "amber"
                      ? "text-amber-600"
                      : "text-slate-700",
                  ].join(" ")}
                >
                  {x.count}
                </div>
                <div className="text-slate-500">{x.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* quick lanes: Overdue / Due Soon */}
        {!loading && !err && (topOverdue.length > 0 || topDueSoon.length > 0) ? (
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-2xl border-2 border-rose-400 bg-white p-4 shadow-[0_0_20px_rgba(244,63,94,0.3)]">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-rose-700">Overdue</div>
                <button
                  onClick={() => setSubtab("overdue")}
                  className="text-xs rounded-full border-2 border-rose-400 bg-rose-50 px-2 py-1 text-rose-700 hover:bg-rose-100 shadow-[0_0_8px_rgba(244,63,94,0.3)]"
                >
                  View all
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {topOverdue.length === 0 ? (
                  <div className="text-xs text-slate-500">None 🎉</div>
                ) : (
                  topOverdue.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => openItem(n)}
                      className="w-full text-left rounded-xl border-2 border-rose-300 bg-rose-50/50 hover:bg-rose-50 hover:border-rose-400 p-3 transition-all shadow-[0_0_8px_rgba(244,63,94,0.15)] hover:shadow-[0_0_12px_rgba(244,63,94,0.25)]"
                    >
                      <div className="text-[11px] font-semibold text-rose-700/90">
                        {projectLabel(n)}
                      </div>
                      <div className="mt-1 truncate text-sm text-slate-900 font-semibold">{n.title}</div>
                      <div className="mt-0.5 text-[11px] text-slate-600">
                        Due:{" "}
                        <span className="text-rose-600 font-medium">{formatUkDateFromYmd(n.due_date)}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border-2 border-sky-400 bg-white p-4 shadow-[0_0_20px_rgba(14,165,233,0.3)]">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-sky-700">Due soon</div>
                <button
                  onClick={() => setSubtab("due_soon")}
                  className="text-xs rounded-full border-2 border-sky-400 bg-sky-50 px-2 py-1 text-sky-700 hover:bg-sky-100 shadow-[0_0_8px_rgba(14,165,233,0.3)]"
                >
                  View all
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {topDueSoon.length === 0 ? (
                  <div className="text-xs text-slate-500">None</div>
                ) : (
                  topDueSoon.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => openItem(n)}
                      className="w-full text-left rounded-xl border-2 border-sky-300 bg-sky-50/50 hover:bg-sky-50 hover:border-sky-400 p-3 transition-all shadow-[0_0_8px_rgba(14,165,233,0.15)] hover:shadow-[0_0_12px_rgba(14,165,233,0.25)]"
                    >
                      <div className="text-[11px] font-semibold text-sky-700/90">
                        {projectLabel(n)}
                      </div>
                      <div className="mt-1 truncate text-sm text-slate-900 font-semibold">{n.title}</div>
                      <div className="mt-0.5 text-[11px] text-slate-600">
                        Due:{" "}
                        <span className="text-sky-600 font-medium">{formatUkDateFromYmd(n.due_date)}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : null}

        {/* filter chips */}
        {!loading && !err ? (
          <div className="mt-6 flex flex-wrap items-center gap-2">
            {[
              { key: "inbox" as const, label: "Inbox" },
              { key: "overdue" as const, label: "Overdue" },
              { key: "due_soon" as const, label: "Due soon" },
            ].map((x) => {
              const active = subtab === x.key;
              return (
                <button
                  key={x.key}
                  onClick={() => setSubtab(x.key)}
                  className={[
                    "px-4 py-2 rounded-full text-sm border-2 transition-all",
                    active
                      ? x.key === "overdue"
                        ? "bg-rose-50 border-rose-400 text-rose-700 shadow-[0_0_12px_rgba(244,63,94,0.4)]"
                        : x.key === "due_soon"
                        ? "bg-sky-50 border-sky-400 text-sky-700 shadow-[0_0_12px_rgba(14,165,233,0.4)]"
                        : "bg-cyan-50 border-cyan-400 text-cyan-700 shadow-[0_0_12px_rgba(34,211,238,0.4)]"
                      : "bg-white border-slate-300 text-slate-600 hover:border-cyan-300 hover:shadow-[0_0_8px_rgba(34,211,238,0.2)]",
                  ].join(" ")}
                >
                  {x.label}
                </button>
              );
            })}

            {subtab !== "inbox" ? (
              <button
                onClick={() => setSubtab("inbox")}
                className="ml-auto text-xs rounded-full border-2 border-slate-300 bg-white px-3 py-2 text-slate-600 hover:border-cyan-400 hover:text-cyan-700 hover:shadow-[0_0_8px_rgba(34,211,238,0.3)] transition-all"
              >
                Clear filter
              </button>
            ) : null}
          </div>
        ) : null}

        {/* content */}
        <div className="mt-8">
          {loading ? (
            <div className="rounded-2xl border-2 border-cyan-400 bg-white p-6 text-slate-600 shadow-[0_0_20px_rgba(34,211,238,0.3)]">
              Loading notifications…
            </div>
          ) : err ? (
            <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-6 text-amber-800 shadow-[0_0_20px_rgba(245,158,11,0.3)]">
              {err}
              <div className="mt-2 text-xs text-amber-700">
                Tip: open DevTools → Network → <span className="font-mono">/api/notifications</span> and check the JSON.
              </div>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="rounded-2xl border-2 border-cyan-400 bg-white p-10 text-center text-slate-600 shadow-[0_0_20px_rgba(34,211,238,0.3)]">
              {subtab === "overdue"
                ? "No overdue items 🎉"
                : subtab === "due_soon"
                ? "No due-soon items"
                : "No notifications 🎉"}
              <div className="mt-2 text-sm text-slate-500">You're all caught up.</div>
              <div className="mt-2 text-xs text-slate-400">
                If you expected items, run the generator again so metadata includes{" "}
                <span className="font-mono">project_code</span> / <span className="font-mono">project_name</span>.
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {grouped.map(([label, rows]) => (
                <div key={label}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>

                  <div className="mt-3 space-y-3">
                    {rows.map((n) => {
                      const unread = n.is_read !== true;
                      const overdue = isOverdue(n);
                      const dueSoon = isDueSoon(n);
                      const dueLabel = formatUkDateFromYmd(n.due_date);

                      return (
                        <button
                          key={n.id}
                          onClick={() => openItem(n)}
                          className={[
                            "w-full text-left rounded-2xl border-2 p-4 transition-all bg-white",
                            overdue
                              ? "border-rose-400 shadow-[0_0_16px_rgba(244,63,94,0.3)] hover:shadow-[0_0_24px_rgba(244,63,94,0.4)] hover:bg-rose-50/30"
                              : dueSoon
                              ? "border-sky-400 shadow-[0_0_16px_rgba(14,165,233,0.3)] hover:shadow-[0_0_24px_rgba(14,165,233,0.4)] hover:bg-sky-50/30"
                              : unread
                              ? "border-cyan-400 shadow-[0_0_16px_rgba(34,211,238,0.3)] hover:shadow-[0_0_24px_rgba(34,211,238,0.4)] hover:bg-cyan-50/30"
                              : "border-slate-300 shadow-[0_0_8px_rgba(0,0,0,0.05)] hover:border-cyan-400 hover:shadow-[0_0_16px_rgba(34,211,238,0.3)]",
                          ].join(" ")}
                        >
                          <div className="flex items-start gap-3">
                            <div
                              className={[
                                "mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full border-2",
                                overdue
                                  ? "border-rose-400 bg-rose-50 text-rose-600 shadow-[0_0_8px_rgba(244,63,94,0.4)]"
                                  : dueSoon
                                  ? "border-sky-400 bg-sky-50 text-sky-600 shadow-[0_0_8px_rgba(14,165,233,0.4)]"
                                  : unread
                                  ? "border-cyan-400 bg-cyan-50 text-cyan-600 shadow-[0_0_8px_rgba(34,211,238,0.4)]"
                                  : "border-slate-300 bg-slate-100 text-slate-600",
                              ].join(" ")}
                            >
                              {iconFor(n)}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-[11px] font-semibold text-slate-500 truncate">
                                    {projectLabel(n)}
                                  </div>
                                  <div className="truncate text-sm font-semibold text-slate-900">{n.title}</div>
                                </div>

                                <div className="shrink-0 text-xs text-slate-500 text-right">
                                  <div>{timeAgo(n.created_at)}</div>
                                  <div className="text-[10px] text-slate-400">{formatUkDate(n.created_at)}</div>
                                </div>
                              </div>

                              {n.body && <div className="mt-1 line-clamp-2 text-xs text-slate-600">{n.body}</div>}

                              {dueLabel ? (
                                <div className="mt-1 text-[11px] text-slate-500">
                                  Due:{" "}
                                  <span
                                    className={
                                      overdue
                                        ? "text-rose-600 font-medium"
                                        : dueSoon
                                        ? "text-sky-600 font-medium"
                                        : "text-slate-700"
                                    }
                                  >
                                    {dueLabel}
                                  </span>
                                </div>
                              ) : null}

                              <div className="mt-2 flex items-center gap-2 text-xs flex-wrap">
                                <span
                                  className={[
                                    "rounded-full border-2 px-2 py-1 text-xs font-medium",
                                    badgeStyle(n),
                                  ].join(" ")}
                                >
                                  {String(n.type || "info")}
                                </span>

                                {unread && (
                                  <span className="rounded-full border-2 border-cyan-400 bg-cyan-50 px-2 py-1 text-cyan-700 shadow-[0_0_8px_rgba(34,211,238,0.3)]">
                                    Unread
                                  </span>
                                )}

                                {overdue && (
                                  <span className="rounded-full border-2 border-rose-400 bg-rose-50 px-2 py-1 text-rose-700 shadow-[0_0_8px_rgba(244,63,94,0.3)]">
                                    Overdue
                                  </span>
                                )}

                                {!overdue && dueSoon && (
                                  <span className="rounded-full border-2 border-sky-400 bg-sky-50 px-2 py-1 text-sky-700 shadow-[0_0_8px_rgba(14,165,233,0.3)]">
                                    Due soon
                                  </span>
                                )}

                                {n.link && (
                                  <span className="rounded-full border-2 border-slate-300 bg-slate-100 px-2 py-1 text-slate-700 shadow-[0_0_4px_rgba(0,0,0,0.05)]">
                                    Open
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="h-16" />
      </div>
    </div>
  );
}
