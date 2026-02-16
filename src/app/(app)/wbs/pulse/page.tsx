"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type PulseStats = {
  total: number;
  done: number;
  remaining: number;
  overdue: number;

  // always computed relative to "today"
  due_7: number;
  due_14: number;
  due_30: number;
  due_60: number;

  // data quality
  missing_effort: number;
};

type ApiResp =
  | { ok: false; error: string; meta?: any }
  | { ok: true; stats: PulseStats | null; meta?: any };

function safeNum(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

type DaysParam = 7 | 14 | 30 | 60 | "all";

function clampDaysParam(x: string | null): DaysParam {
  const s = String(x ?? "").trim().toLowerCase();
  if (s === "all") return "all";
  const n = Number(s);
  const allowed = new Set([7, 14, 30, 60]);
  if (!Number.isFinite(n) || !allowed.has(n)) return 7;
  return n as 7 | 14 | 30 | 60;
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

function StatCard({
  title,
  value,
  hint,
  href,
}: {
  title: string;
  value: string;
  hint?: string;
  href?: string | null;
}) {
  const card = (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition hover:shadow-md">
      <div className="text-sm font-semibold text-gray-700">{title}</div>
      <div className="mt-2 text-3xl font-bold tracking-tight text-gray-900">{value}</div>
      {hint ? <div className="mt-2 text-sm text-gray-500">{hint}</div> : null}

      {href ? (
        <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-gray-700">
          View items <ArrowUpRight className="h-4 w-4" />
        </div>
      ) : null}
    </div>
  );

  if (!href) return card;

  return (
    <Link href={href} className="block" title={`View items for: ${title}`}>
      {card}
    </Link>
  );
}

export default function WbsPulsePage() {
  const sp = useSearchParams();

  const days = useMemo(() => clampDaysParam(sp.get("days")), [sp]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<PulseStats | null>(null);

  async function load() {
    setLoading(true);
    setError("");

    try {
      const url = days === "all" ? "/api/wbs/pulse?days=all" : `/api/wbs/pulse?days=${days}`;
      const r = await fetch(url, { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as ApiResp | null;

      if (!r.ok) throw new Error((j as any)?.error || `Request failed (${r.status})`);
      if (!j || (j as any).ok !== true) throw new Error((j as any)?.error || "Invalid response");

      setStats((j as any).stats ?? null);
    } catch (e: any) {
      setStats(null);
      setError(e?.message || "Failed to load WBS stats");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const total = safeNum(stats?.total);
  const done = safeNum(stats?.done);
  const remaining = safeNum(stats?.remaining);
  const overdue = safeNum(stats?.overdue);

  const due7 = safeNum(stats?.due_7);
  const due14 = safeNum(stats?.due_14);
  const due30 = safeNum(stats?.due_30);
  const due60 = safeNum(stats?.due_60);

  const missingEffort = safeNum(stats?.missing_effort);

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
    <div className="min-h-[calc(100vh-64px)] bg-white text-gray-900 font-['Inter','system-ui',sans-serif]">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">WBS pulse</h1>
            <p className="mt-3 text-lg text-gray-600">
              Executive overview of delivery workload, completion and due-date pressure.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="border-gray-300 text-gray-700 hover:bg-gray-50"
              onClick={load}
              disabled={loading}
            >
              Refresh
            </Button>

            <Link
              href={`/wbs/items?days=${encodeURIComponent(String(days))}`}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              title="Open WBS items list"
            >
              WBS items <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <div className="font-semibold text-gray-900">Window:</div>

            <Link
              href={`/wbs/pulse?days=all`}
              className={[
                "rounded-full border px-3 py-1.5 transition",
                days === "all"
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
              ].join(" ")}
            >
              All
            </Link>

            {[7, 14, 30, 60].map((d) => (
              <Link
                key={d}
                href={`/wbs/pulse?days=${d}`}
                className={[
                  "rounded-full border px-3 py-1.5 transition",
                  days === d
                    ? "border-gray-900 bg-gray-900 text-white"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
                ].join(" ")}
              >
                {d} days
              </Link>
            ))}

            <div className="ml-auto text-sm text-gray-500">
              Window filters “overdue / remaining / completed” by due-date range. Due buckets show 7/14/30/60-day pressure from today.
            </div>
          </div>
        </div>

        <div className="mt-8">
          {loading ? (
            <div className="rounded-xl border border-gray-200 bg-white p-10 text-gray-600 text-center">
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading WBS stats…
              </span>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-800">{error}</div>
          ) : !stats ? (
            <div className="rounded-xl border border-gray-200 bg-white p-10 text-gray-600 text-center">
              No WBS data found in your projects.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <StatCard title="Total work packages" value={String(total)} href={hrefTotal} />
                <StatCard title="Completed" value={String(done)} href={hrefDone} />
                <StatCard title="Remaining" value={String(remaining)} href={hrefRemaining} />
                <StatCard
                  title="Overdue"
                  value={String(overdue)}
                  hint={overdue > 0 ? "Past due date and not marked done." : "No overdue work right now."}
                  href={hrefOverdue}
                />
              </div>

              <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-6">
                <StatCard title="Due in 7 days" value={String(due7)} href={hrefDue7} />
                <StatCard title="Due in 14 days" value={String(due14)} href={hrefDue14} />
                <StatCard title="Due in 30 days" value={String(due30)} href={hrefDue30} />
                <StatCard title="Due in 60 days" value={String(due60)} href={hrefDue60} />
              </div>

              <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                <div className="flex items-start justify-between gap-6">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">Data quality</div>
                    <div className="mt-2 text-sm text-gray-700">
                      Missing estimated effort: <span className="font-semibold">{missingEffort}</span>
                    </div>
                    <div className="mt-1 text-sm text-gray-500">
                      Use this to spot WBS items that can’t be reliably capacity-planned.
                    </div>
                  </div>

                  {missingEffort > 0 ? (
                    <Link
                      href={hrefMissingEffort}
                      className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100"
                    >
                      View effort gaps <ArrowUpRight className="h-4 w-4" />
                    </Link>
                  ) : (
                    <span className="mt-1 text-sm text-gray-500">All leaf work packages have effort estimates.</span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
