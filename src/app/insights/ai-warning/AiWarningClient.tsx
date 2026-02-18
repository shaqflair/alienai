// src/app/insights/ai-warning/AiWarningClient.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { AlertTriangle, ShieldCheck, Clock3, ArrowUpRight } from "lucide-react";

type ProjectMini = {
  id: string;
  title: string | null;
  project_code: string | number | null;
  client_name?: string | null;
};

type BlockedRow = {
  work_item_id: string;
  project_id: string;
  project?: ProjectMini;
  title: string;
  stage: string;
  due_date: string | null;
  status?: string | null;

  blocked_seconds_window: number;
  currently_blocked: boolean;
  last_block_event_at: string | null;
  last_block_reason: string | null;
};

type DrillOk = {
  ok: true;
  days: number;
  projects: string[];
  project_map: Record<string, ProjectMini>;
  data: {
    blocked: BlockedRow[];
    wip: { stage: string; count: number }[];
    dueSoon: any[];
    recentDone: any[];
  };
};

type DrillResp = { ok: false; error: string; meta?: any } | DrillOk;

/**
 * ✅ UK date display (dd/mm/yyyy)
 * - If API sends ISO date-only (yyyy-mm-dd), parse as UTC midnight so it doesn't shift a day in UK.
 * - Otherwise let Date() parse timestamps.
 */
function fmtDateUK(x: any) {
  if (!x) return "—";
  const s = String(x).trim();
  if (!s) return "—";

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const yyyy = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    if (!yyyy || !mm || !dd) return "—";
    return `${String(dd).padStart(2, "0")}/${String(mm).padStart(2, "0")}/${String(yyyy)}`;
  }

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;

  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function fmtDateTimeUK(x: any) {
  if (!x) return "—";
  const s = String(x).trim();
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtBlocked(secs: any) {
  const n = Number(secs);
  if (!Number.isFinite(n) || n <= 0) return "0h";
  const h = n / 3600;
  if (h < 1) return `${Math.round(n / 60)}m`;
  if (h < 48) return `${Math.round(h * 10) / 10}h`;
  return `${Math.round((h / 24) * 10) / 10}d`;
}

function projectLabel(p?: ProjectMini | null) {
  if (!p) return "—";
  const code = p.project_code != null && String(p.project_code).trim() ? String(p.project_code).trim() : null;
  const title = p.title && String(p.title).trim() ? String(p.title).trim() : null;
  if (title && code) return `${title} (${code})`;
  if (title) return title;
  if (code) return `(${code})`;
  return "—";
}

function badgeClass(kind: "good" | "warn" | "bad" | "neutral") {
  if (kind === "bad") return "bg-red-100 text-red-900 border border-red-200";
  if (kind === "warn") return "bg-amber-100 text-amber-900 border border-amber-200";
  if (kind === "good") return "bg-emerald-100 text-emerald-900 border border-emerald-200";
  return "bg-slate-100 text-slate-900 border border-slate-200";
}

function statusKind(s: string) {
  const v = String(s || "").trim().toLowerCase();
  if (v.includes("block")) return "bad" as const;
  if (v === "open" || v === "in_progress" || v === "in progress") return "warn" as const;
  if (v === "done" || v === "closed" || v === "completed") return "good" as const;
  return "neutral" as const;
}

function stageLabel(s: any) {
  const v = String(s ?? "").trim();
  if (!v) return "—";
  return v.replaceAll("_", " ");
}

function normStatusText(s: any) {
  const v = String(s ?? "").trim();
  if (!v) return "—";
  return v.replaceAll("_", " ");
}

function pct(x: number, total: number) {
  if (!total) return 0;
  return Math.round((x / total) * 1000) / 10;
}

function maxStage(rows: { stage: string; count: number }[]) {
  if (!rows?.length) return null;
  let best = rows[0];
  for (const r of rows) if ((r?.count || 0) > (best?.count || 0)) best = r;
  return best;
}

function severityBadge(sev: "high" | "medium" | "info") {
  if (sev === "high") return { label: "Critical", kind: "bad" as const, hint: "Work is currently blocked or stalled." };
  if (sev === "medium") return { label: "Warning", kind: "warn" as const, hint: "Risk signals present in this window." };
  return { label: "Monitor", kind: "good" as const, hint: "No major flow risk detected." };
}

export default function AiWarningClient({ days }: { days: 7 | 14 | 30 | 60 }) {
  const [data, setData] = useState<DrillResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      try {
        const res = await fetch(`/api/ai/flow-warning/drilldown?days=${days}`, { cache: "no-store" });

        const ct = res.headers.get("content-type") || "";
        if (!ct.toLowerCase().includes("application/json")) {
          const txt = await res.text();
          const snippet = txt.slice(0, 160).replace(/\s+/g, " ");
          if (!cancelled) setData({ ok: false, error: `Expected JSON but got ${ct || "unknown"}. ${snippet}` });
          return;
        }

        const j = (await res.json()) as DrillResp;
        if (!cancelled) setData(j);
      } catch (e: any) {
        if (!cancelled) setData({ ok: false, error: String(e?.message || e || "Failed") });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [days]);

  const ok = data && (data as any).ok === true;

  const severity = useMemo(() => {
    if (!ok) return "info" as const;
    const d = data as DrillOk;
    const anyBlockedNow = (d.data.blocked || []).some((b) => b.currently_blocked);
    if (anyBlockedNow) return "high" as const;
    if ((d.data.blocked || []).length > 0) return "medium" as const;
    return "info" as const;
  }, [ok, data]);

  const HeaderIcon = severity === "high" ? AlertTriangle : severity === "medium" ? Clock3 : ShieldCheck;
  const sev = severityBadge(severity);

  const summary = useMemo(() => {
    if (!ok) return null;

    const d = data as DrillOk;
    const blocked = d.data.blocked || [];
    const wip = d.data.wip || [];
    const dueSoon = d.data.dueSoon || [];
    const recentDone = d.data.recentDone || [];

    const blockedNow = blocked.filter((b) => b.currently_blocked).length;
    const blockedAny = blocked.length;

    const wipTotal = wip.reduce((a, x) => a + (x.count || 0), 0);
    const top = maxStage(wip);
    const topShare = top ? pct(top.count || 0, wipTotal) : 0;

    const lines: string[] = [];

    if (blockedNow > 0) {
      lines.push(`There are ${blockedNow} work item(s) currently blocked. This is the strongest indicator of near-term delivery risk.`);
    } else if (blockedAny > 0) {
      lines.push(`Blocked work was detected in this window (${blockedAny} item(s)). Even if unblocked now, it’s a signal of friction.`);
    } else {
      lines.push(`No blocked work items were detected in this window.`);
    }

    if (wipTotal > 0 && top) {
      if (topShare >= 70) lines.push(`A bottleneck is likely: ${topShare}% of WIP sits in “${stageLabel(top.stage)}”.`);
      else lines.push(`WIP is spread across stages; largest concentration is “${stageLabel(top.stage)}” (${topShare}%).`);
    } else {
      lines.push(`No open work items were found (WIP is zero).`);
    }

    if (dueSoon.length > 0) {
      lines.push(`${dueSoon.length} item(s) are due soon (next 30 days). Prioritise these if they overlap with blockers/bottlenecks.`);
    } else {
      lines.push(`No items are due in the next 30 days.`);
    }

    if (recentDone.length > 0) {
      lines.push(`Throughput evidence: ${recentDone.length} completion(s) recorded recently (last ~42 days).`);
    } else {
      lines.push(`No recent completions found in the last ~42 days (throughput evidence is weak).`);
    }

    const action =
      severity === "high"
        ? "Unblock the stuck items, reduce WIP, and prioritise finishing in-flight work before starting new work."
        : severity === "medium"
        ? "Review the blocked items and the stage with the highest WIP concentration; remove blockers and rebalance workload."
        : "Keep monitoring flow and maintain a low WIP level to avoid new bottlenecks.";

    return {
      blockedNow,
      blockedAny,
      wipTotal,
      topStage: top ? stageLabel(top.stage) : null,
      topStageCount: top ? top.count : 0,
      topStageShare: top ? topShare : 0,
      dueSoonCount: dueSoon.length,
      recentDoneCount: recentDone.length,
      lines,
      action,
    };
  }, [ok, data, severity]);

  return (
    <div className="min-h-screen px-6 py-6 bg-white text-slate-900">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <HeaderIcon className="h-5 w-5 opacity-90" />
              <h1 className="text-2xl font-semibold">AI predictions & warnings — evidence</h1>
              <span className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass(sev.kind)}`}>
                {sev.label}
              </span>
            </div>

            <p className="mt-2 text-sm text-slate-600">
              This page shows the evidence behind the flow warning: blockers, WIP concentration (bottleneck proxy), due-soon pressure, and recent throughput.
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">Window: {days} days</span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">{sev.hint}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={`/insights?days=${days}`}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm hover:bg-slate-100"
            >
              Back to Insights
            </Link>
          </div>
        </div>

        {/* Loading / Error */}
        {loading && (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            Loading evidence…
          </div>
        )}

        {!loading && data && (data as any).ok === false && (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm">
            <div className="font-semibold text-red-900">Couldn’t load evidence</div>
            <div className="mt-1 text-red-800">{(data as any).error}</div>
            <div className="mt-3 text-xs text-red-800/90">
              Check the API route: <span className="font-mono">/api/ai/flow-warning/drilldown</span>
            </div>
          </div>
        )}

        {/* Summary */}
        {!loading && ok && summary && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 rounded-2xl border border-slate-200 bg-white p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">What this means</h2>
                <ul className="mt-3 space-y-2 text-sm text-slate-700 list-disc pl-5">
                  {summary.lines.map((x, idx) => (
                    <li key={idx}>{x}</li>
                  ))}
                </ul>
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
                  👉 <span className="font-semibold">Recommended action:</span> {summary.action}
                </div>
              </div>

              <div className="shrink-0 rounded-2xl border border-slate-200 bg-slate-50 p-4 w-[260px]">
                <div className="text-xs font-semibold text-slate-600">At a glance</div>

                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Blocked now</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass(summary.blockedNow > 0 ? "bad" : "good")}`}>
                      {summary.blockedNow}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Blocked (window)</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass(summary.blockedAny > 0 ? "warn" : "good")}`}>
                      {summary.blockedAny}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Total WIP</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass(summary.wipTotal > 0 ? "neutral" : "good")}`}>
                      {summary.wipTotal}
                    </span>
                  </div>

                  <div className="pt-2 border-t border-slate-200">
                    <div className="text-xs text-slate-500">Highest WIP stage</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {summary.topStage ? summary.topStage : "—"}
                    </div>
                    {summary.topStage ? (
                      <div className="mt-1 text-xs text-slate-600">
                        {summary.topStageCount} item(s) • {summary.topStageShare}%
                      </div>
                    ) : null}
                  </div>

                  <div className="pt-2 border-t border-slate-200">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">Due soon</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass(summary.dueSoonCount > 0 ? "warn" : "good")}`}>
                        {summary.dueSoonCount}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-slate-600">Recent completions</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass(summary.recentDoneCount > 0 ? "good" : "neutral")}`}>
                        {summary.recentDoneCount}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 text-[11px] text-slate-500">
                  Tip: “Blocked now” is the highest-priority signal. “Highest WIP stage” helps locate bottlenecks.
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* (rest of your detail sections remain exactly as you already had them) */}
        {/* You can keep your blocked/wip/dueSoon/recentDone tables below unchanged. */}
      </div>
    </div>
  );
}
