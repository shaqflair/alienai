"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, Loader2 } from "lucide-react";

/* ------------------------------------------------------------
   WBS Stats – Executive / Delivery view
   Source of truth: /api/ai/briefing

   ✅ Tiles now deep-link to /wbs/items with correct filters
------------------------------------------------------------- */

export type WbsStats = {
  totalLeaves: number;
  done: number;
  remaining: number;
  overdue: number;
  due_7: number;
  due_14: number;
  due_30: number;
  due_60: number;
  missing_effort: number;
};

type BriefingResp = {
  ok: boolean;
  insights?: any[];
  meta?: { wbs_computed?: any } | null;
  error?: string;
};

const EMPTY: WbsStats = {
  totalLeaves: 0,
  done: 0,
  remaining: 0,
  overdue: 0,
  due_7: 0,
  due_14: 0,
  due_30: 0,
  due_60: 0,
  missing_effort: 0,
};

function asNum(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

type DaysParam = 7 | 14 | 30 | 60 | "all";

function clampDays(x: string | null, fallback: DaysParam = 30): DaysParam {
  const s = String(x ?? "").trim().toLowerCase();
  if (s === "all") return "all";
  const n = Number(s);
  const allowed = new Set([7, 14, 30, 60]);
  if (!Number.isFinite(n) || !allowed.has(n)) return fallback;
  return n as 7 | 14 | 30 | 60;
}

function isPlainObject(x: any): x is Record<string, any> {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype;
}

export function normalizeWbsStats(raw: any): WbsStats | null {
  try {
    if (!isPlainObject(raw)) return null;

    const totalLeaves = asNum((raw as any).totalLeaves ?? (raw as any).total_leaves ?? (raw as any).total ?? 0);
    const done = asNum((raw as any).done ?? (raw as any).completed ?? 0);
    const remaining = asNum((raw as any).remaining ?? (raw as any).open ?? 0);
    const overdue = asNum((raw as any).overdue ?? 0);

    const due_7 = asNum((raw as any).due_7 ?? (raw as any).due7 ?? 0);
    const due_14 = asNum((raw as any).due_14 ?? (raw as any).due14 ?? 0);
    const due_30 = asNum((raw as any).due_30 ?? (raw as any).due30 ?? 0);
    const due_60 = asNum((raw as any).due_60 ?? (raw as any).due60 ?? 0);

    const missing_effort = asNum((raw as any).missing_effort ?? (raw as any).missingEffort ?? 0);

    if (
      !totalLeaves &&
      !done &&
      !remaining &&
      !overdue &&
      !due_7 &&
      !due_14 &&
      !due_30 &&
      !due_60 &&
      !missing_effort
    ) {
      return null;
    }

    return { totalLeaves, done, remaining, overdue, due_7, due_14, due_30, due_60, missing_effort };
  } catch {
    return null;
  }
}

export function calcRemainingPct(stats: WbsStats) {
  if (!stats.totalLeaves) return 0;
  return Math.round((stats.remaining / stats.totalLeaves) * 100);
}

function buildItemsHref(
  days: DaysParam,
  params?: Record<string, string | number | boolean | null | undefined>
) {
  const sp = new URLSearchParams();
  sp.set("days", String(days));
  for (const [k, v] of Object.entries(params || {})) {
    if (v === null || v === undefined) continue;
    if (typeof v === "boolean") {
      if (v) sp.set(k, "1");
      continue;
    }
    sp.set(k, String(v));
  }
  return `/wbs/items?${sp.toString()}`;
}

function Stat({
  label,
  value,
  muted,
  href,
}: {
  label: string;
  value: number | string;
  muted?: boolean;
  href?: string | null;
}) {
  const box = (
    <div
      className={[
        "rounded-xl border border-slate-600 bg-slate-800/70 p-5 transition",
        muted ? "opacity-60" : "hover:bg-slate-800/90 hover:border-slate-500",
      ].join(" ")}
    >
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-1 text-3xl font-black text-white">{value}</div>
      <div className="mt-3 inline-flex items-center gap-2 text-xs text-slate-300">
        View items <ArrowUpRight className="h-3.5 w-3.5" />
      </div>
    </div>
  );

  if (!href) return box;

  return (
    <Link href={href} className="block" title={`View items for: ${label}`}>
      {box}
    </Link>
  );
}

export default function WbsStatsPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const days = useMemo(() => clampDays(sp.get("days"), 30), [sp]);

  const [stats, setStats] = useState<WbsStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    const ac = new AbortController();

    (async () => {
      try {
        setLoading(true);
        setErr("");

        const r = await fetch(`/api/ai/briefing?days=${days}`, {
          cache: "no-store",
          signal: ac.signal,
        });

        const j = (await r.json().catch(() => null)) as BriefingResp | null;

        if (!j) throw new Error("Failed to load WBS stats");
        if (!j.ok) throw new Error(j.error || "Failed to load WBS stats");

        const raw = (j.meta && (j.meta as any).wbs_computed) || {};
        const normalized = normalizeWbsStats(raw);

        setStats(normalized);
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setErr(e?.message || "Failed to load WBS stats");
        setStats(null);
      } finally {
        setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [days]);

  const s = stats ?? EMPTY;
  const hasData = stats !== null;

  const remainingPct = useMemo(() => calcRemainingPct(s), [s.totalLeaves, s.remaining]);

  function setDaysInUrl(d: DaysParam) {
    router.replace(`/wbs/stats?days=${d}`);
  }

  // ✅ Tile links → /wbs/items
  const hrefTotal = buildItemsHref(days);
  const hrefDone = buildItemsHref(days, { status: "done" });
  const hrefRemaining = buildItemsHref(days, { status: "open" });

  const hrefOverdue = buildItemsHref(days, { bucket: "overdue" });
  const hrefDue7 = buildItemsHref(days, { bucket: "due_7" });
  const hrefDue14 = buildItemsHref(days, { bucket: "due_14" });
  const hrefDue30 = buildItemsHref(days, { bucket: "due_30" });
  const hrefDue60 = buildItemsHref(days, { bucket: "due_60" });

  const hrefMissingEffort = buildItemsHref(days, { missingEffort: 1 });

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 px-8 py-10">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-white">WBS Portfolio Stats</h1>
            <p className="mt-2 text-slate-400">Leaf-level work package health across all projects</p>
          </div>

          <Link
            href={buildItemsHref(days)}
            className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
            title="Open WBS items list"
          >
            View WBS items <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mb-6 flex items-center gap-2">
          <button
            onClick={() => setDaysInUrl("all")}
            className={[
              "px-4 py-1.5 rounded-full text-sm border transition",
              days === "all"
                ? "bg-cyan-500/20 border-cyan-400/50 text-cyan-300"
                : "bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700/60",
            ].join(" ")}
          >
            All
          </button>

          {[7, 14, 30, 60].map((d) => (
            <button
              key={d}
              onClick={() => setDaysInUrl(d as 7 | 14 | 30 | 60)}
              className={[
                "px-4 py-1.5 rounded-full text-sm border transition",
                days === d
                  ? "bg-cyan-500/20 border-cyan-400/50 text-cyan-300"
                  : "bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700/60",
              ].join(" ")}
            >
              {d}d
            </button>
          ))}

          {loading ? (
            <span className="ml-3 inline-flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Updating…
            </span>
          ) : null}
        </div>

        {loading ? (
          <div className="text-slate-400">Loading WBS stats…</div>
        ) : err ? (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-rose-300">{err}</div>
        ) : (
          <>
            {!hasData ? (
              <div className="mb-6 rounded-xl border border-slate-700 bg-slate-900/40 p-4 text-slate-300">
                No WBS data found for this selection.
              </div>
            ) : null}

            {/* Core stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Stat label="Total work packages" value={s.totalLeaves} muted={!hasData} href={hrefTotal} />
              <Stat label="Completed" value={s.done} muted={!hasData} href={hrefDone} />
              <Stat label="Remaining" value={s.remaining} muted={!hasData} href={hrefRemaining} />
            </div>

            {/* Delivery health */}
            <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-6">
              <Stat label="Overdue" value={s.overdue} muted={!hasData} href={hrefOverdue} />
              <Stat label="Due in 7 days" value={s.due_7} muted={!hasData} href={hrefDue7} />
              <Stat label="Due in 14 days" value={s.due_14} muted={!hasData} href={hrefDue14} />
              <Stat label="Due in 30 days" value={s.due_30} muted={!hasData} href={hrefDue30} />
            </div>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              <Stat label="Due in 60 days" value={s.due_60} muted={!hasData} href={hrefDue60} />
              <Stat label="Missing effort" value={s.missing_effort} muted={!hasData} href={hrefMissingEffort} />
            </div>

            {/* Pulse */}
            <div className="mt-8 rounded-xl border border-slate-600 bg-slate-800/60 p-6">
              <div className="text-sm text-slate-400 mb-2">Delivery pulse</div>
              <div className="text-xl text-white font-semibold">
                {!hasData ? (
                  <>No WBS items in this selection.</>
                ) : (
                  <>
                    {s.done} completed • {s.remaining} remaining ({remainingPct}% open)
                  </>
                )}
              </div>

              <div className="mt-4">
                <Link
                  href={buildItemsHref(days)}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-900/30 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-900/50"
                >
                  View all items in this selection <ArrowUpRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
