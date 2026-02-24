"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ShieldAlert,
  Timer,
  Layers,
  Users,
  Sparkles,
  RefreshCw,
} from "lucide-react";

type HeatmapItem = {
  project_id: string;
  project_code: string | null;
  project_title: string | null;
  open_approvals: number;
  breached: number;
  at_risk: number;
  ok: number;
  rag: "R" | "A" | "G";
  computed_at: string;
};

type SlaItem = {
  project_id: string;
  project_code: string | null;
  project_title: string | null;
  artifact_type: string | null;
  artifact_title: string | null;
  stage_key: string | null;
  step_title: string | null;
  approver_label: string | null;
  due_at: string | null;
  sla_status: string;
  hours_to_due: number | null;
  hours_overdue: number | null;
};

type Bottleneck = {
  approver_label: string;
  open_steps: number;
  breached_steps: number;
  at_risk_steps: number;
  blocker_score: number;
  computed_at: string;
};

type RiskSignal = {
  project_id: string | null;
  project_code: string | null;
  signal_key: string;
  severity: "low" | "medium" | "high" | "critical" | string;
  title: string;
  summary: string;
  computed_at: string;
};

type PendingApprovalsResp =
  | { ok: false; error: string; meta?: any }
  | {
      ok: true;
      scope: "org_exec" | "project_member";
      orgId?: string;
      radar: { overdue: number; warn: number; ok: number };
      items: any[];
    };

function pillClass(rag: "R" | "A" | "G") {
  if (rag === "R") return "bg-red-500/15 text-red-700 border-red-500/30";
  if (rag === "A") return "bg-amber-500/15 text-amber-700 border-amber-500/30";
  return "bg-emerald-500/15 text-emerald-700 border-emerald-500/30";
}

function severityClass(sev: string) {
  if (sev === "critical") return "bg-red-500/15 text-red-700 border-red-500/30";
  if (sev === "high") return "bg-amber-500/15 text-amber-700 border-amber-500/30";
  return "bg-slate-500/10 text-slate-700 border-slate-500/20";
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function safeNum(x: any): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function toDaysFromAgeHours(ageHours: any) {
  const h = safeNum(ageHours);
  return Math.max(0, Math.round(h / 24));
}
function pickApproverLabel(item: any) {
  return (
    safeStr(item?.pending_email) ||
    safeStr(item?.approver_ref) ||
    safeStr(item?.pending_user_id) ||
    "—"
  );
}

async function apiGet(path: string) {
  const res = await fetch(path, { cache: "no-store" });
  const json = await res.json();
  if (!json?.ok) throw new Error(json?.error || "Request failed");
  return json;
}

function computeHeatmapFromPending(items: any[]): HeatmapItem[] {
  const map = new Map<
    string,
    {
      project_id: string;
      project_code: string | null;
      project_title: string | null;
      open: number;
      overdue: number;
      warn: number;
      ok: number;
    }
  >();

  for (const it of items || []) {
    const pid = safeStr(it?.project_id);
    if (!pid) continue;

    const state = safeStr(it?.sla_state); // 'ok' | 'warn' | 'overdue'
    let row = map.get(pid);
    if (!row) {
      row = {
        project_id: pid,
        project_code: it?.project_code ?? null,
        project_title: it?.project_title ?? null,
        open: 0,
        overdue: 0,
        warn: 0,
        ok: 0,
      };
      map.set(pid, row);
    }

    row.open += 1;
    if (state === "overdue") row.overdue += 1;
    else if (state === "warn") row.warn += 1;
    else row.ok += 1;
  }

  const out: HeatmapItem[] = Array.from(map.values()).map((r) => {
    const rag: "R" | "A" | "G" =
      r.overdue > 0 ? "R" : r.warn > 0 ? "A" : "G";
    return {
      project_id: r.project_id,
      project_code: r.project_code,
      project_title: r.project_title,
      open_approvals: r.open,
      breached: r.overdue,
      at_risk: r.warn,
      ok: r.ok,
      rag,
      computed_at: new Date().toISOString(),
    };
  });

  out.sort((a, b) => {
    const aw = a.breached > 0 ? 2 : a.at_risk > 0 ? 1 : 0;
    const bw = b.breached > 0 ? 2 : b.at_risk > 0 ? 1 : 0;
    if (bw !== aw) return bw - aw;
    return (b.breached + b.at_risk + b.ok) - (a.breached + a.at_risk + a.ok);
  });

  return out;
}

function computeBottlenecksFromPending(items: any[]): Bottleneck[] {
  const map = new Map<
    string,
    {
      label: string;
      open: number;
      overdue: number;
      warn: number;
      maxDays: number;
      sumDays: number;
      n: number;
    }
  >();

  for (const it of items || []) {
    const label = pickApproverLabel(it);
    const key = label;

    const state = safeStr(it?.sla_state);
    const days = toDaysFromAgeHours(it?.age_hours);

    let row = map.get(key);
    if (!row) {
      row = {
        label,
        open: 0,
        overdue: 0,
        warn: 0,
        maxDays: 0,
        sumDays: 0,
        n: 0,
      };
      map.set(key, row);
    }

    row.open += 1;
    row.n += 1;
    row.sumDays += days;
    row.maxDays = Math.max(row.maxDays, days);

    if (state === "overdue") row.overdue += 1;
    else if (state === "warn") row.warn += 1;
  }

  const out: Bottleneck[] = Array.from(map.values()).map((r) => {
    // simple blocker score: overdue weighted heavily + warn + backlog + max wait
    const blocker_score =
      r.overdue * 6 + r.warn * 3 + r.open * 1 + r.maxDays * 0.25;

    return {
      approver_label: r.label,
      open_steps: r.open,
      breached_steps: r.overdue,
      at_risk_steps: r.warn,
      blocker_score: Math.round(blocker_score * 10) / 10,
      computed_at: new Date().toISOString(),
    };
  });

  out.sort((a, b) => b.blocker_score - a.blocker_score);
  return out.slice(0, 20);
}

function computeSlaHeadlineFromRadar(radar: { overdue: number; warn: number; ok: number }) {
  const overdue = safeNum(radar?.overdue);
  const warn = safeNum(radar?.warn);
  const ok = safeNum(radar?.ok);
  const total = overdue + warn + ok;
  if (!total) return "No pending approvals";
  return `${overdue} breached • ${warn} at-risk • ${ok} on-track • ${total} total`;
}

function computeTopSlaItemsFromPending(items: any[], max = 12): SlaItem[] {
  const out: SlaItem[] = (items || [])
    .slice()
    .sort((a, b) => safeNum(b?.age_hours) - safeNum(a?.age_hours))
    .slice(0, max)
    .map((it) => {
      const state = safeStr(it?.sla_state);
      const ageHours = safeNum(it?.age_hours);
      const slaHours = safeNum(it?.sla_hours);
      const warnHours = safeNum(it?.warn_hours);

      const dueHours = Math.max(0, slaHours - ageHours);
      const overdueHours = Math.max(0, ageHours - slaHours);

      return {
        project_id: safeStr(it?.project_id),
        project_code: it?.project_code ?? null,
        project_title: it?.project_title ?? null,
        artifact_type: it?.artifact_type ?? null,
        artifact_title: it?.artifact_title ?? null,
        stage_key: it?.stage_key ?? null,
        step_title: it?.step_name ?? null,
        approver_label: pickApproverLabel(it),
        due_at: it?.pending_since
          ? new Date(
              new Date(it.pending_since).getTime() + slaHours * 3600 * 1000
            ).toISOString()
          : null,
        sla_status: state,
        hours_to_due: state === "ok" ? Math.round(dueHours) : null,
        hours_overdue: state === "overdue" ? Math.round(overdueHours) : null,
      };
    });

  // If everything is ok, still show items by age
  return out;
}

export default function ExecutiveCockpitClient() {
  const [loading, setLoading] = useState(true);
  const [heatmap, setHeatmap] = useState<HeatmapItem[]>([]);
  const [sla, setSla] = useState<{
    headline: string;
    counts: any;
    items: SlaItem[];
  } | null>(null);
  const [bottlenecks, setBottlenecks] = useState<Bottleneck[]>([]);
  const [signals, setSignals] = useState<RiskSignal[]>([]);
  const [blocking, setBlocking] = useState<{
    narrative: string;
    top: Bottleneck[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    setLoading(true);

    try {
      // ✅ single source of truth for approvals + org scope
      const pending = (await fetch("/api/ai/pending-approvals?limit=200", {
        cache: "no-store",
      }).then((r) => r.json())) as PendingApprovalsResp;

      if (!pending?.ok) {
        throw new Error((pending as any)?.error || "Failed to load pending approvals");
      }

      const orgId = safeStr((pending as any).orgId || "");
      const items = ((pending as any).items || []) as any[];
      const radar = (pending as any).radar || { overdue: 0, warn: 0, ok: 0 };

      // ✅ compute the approval intelligence panels locally (no extra API required)
      setHeatmap(computeHeatmapFromPending(items));
      setBottlenecks(computeBottlenecksFromPending(items));
      setSla({
        headline: computeSlaHeadlineFromRadar(radar),
        counts: {
          at_risk: safeNum(radar.warn),
          breached: safeNum(radar.overdue),
          ok: safeNum(radar.ok),
          // keep backwards compat with old UI logic
          overdue_undecided: 0,
        },
        items: computeTopSlaItemsFromPending(items, 12),
      });

      // Optional: keep executive risk signals + narrative (use orgId if endpoint supports it)
      const qs = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";

      const [r, w] = await Promise.all([
        apiGet(`/api/executive/risk-signals${qs}`),
        apiGet(`/api/executive/who-blocking${qs}`),
      ]);

      setSignals(r.items || []);
      setBlocking(w);

    } catch (e: any) {
      setError(e?.message || "Failed to load executive cockpit");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const headline = useMemo(() => {
    const breached = heatmap.reduce((a, x) => a + (x.breached || 0), 0);
    const atRisk = heatmap.reduce((a, x) => a + (x.at_risk || 0), 0);
    return `${breached} breached • ${atRisk} at-risk • ${heatmap.length} projects`;
  }, [heatmap]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Executive Cockpit
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Approval Intelligence
          </h1>
          <div className="mt-1 text-sm text-slate-600">{headline}</div>
        </div>

        <button
          onClick={load}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm shadow-sm hover:bg-slate-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <Timer className="h-4 w-4 text-slate-700" />
            <div className="text-sm font-semibold text-slate-900">
              SLA Breach Radar
            </div>
          </div>
          <div className="mt-2 text-sm text-slate-600">
            {sla?.headline ?? (loading ? "Loading…" : "—")}
          </div>
          <div className="mt-3 flex gap-2 text-xs">
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-700">
              At risk: {sla?.counts?.at_risk ?? 0}
            </span>
            <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-1 text-red-700">
              Breached: {(sla?.counts?.breached ?? 0) + (sla?.counts?.overdue_undecided ?? 0)}
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-slate-700" />
            <div className="text-sm font-semibold text-slate-900">
              Who is blocking delivery
            </div>
          </div>
          <div className="mt-2 text-sm text-slate-700">
            {blocking?.narrative ?? (loading ? "Loading…" : "—")}
          </div>
          <div className="mt-3 text-xs text-slate-500">
            Data-driven ranking (backlog + at-risk + breached), not opinion.
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-slate-700" />
            <div className="text-sm font-semibold text-slate-900">
              Executive risk signals
            </div>
          </div>
          <div className="mt-2 text-sm text-slate-600">
            {signals.length
              ? `${signals.length} active signal(s)`
              : loading
              ? "Loading…"
              : "No active signals"}
          </div>
          <div className="mt-3 space-y-2">
            {signals.slice(0, 3).map((s, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm text-slate-900">{s.title}</div>
                  <div className="truncate text-xs text-slate-500">
                    {s.project_code ?? "Portfolio"}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2 py-1 text-xs ${severityClass(
                    s.severity
                  )}`}
                >
                  {s.severity}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-slate-700" />
          <div className="text-sm font-semibold text-slate-900">
            Portfolio approval heatmap
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {heatmap.map((p) => (
            <div
              key={p.project_id}
              className="rounded-2xl border border-slate-200 p-3 shadow-sm hover:border-slate-300 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">
                    {p.project_code ?? "—"}{" "}
                    <span className="font-normal text-slate-400">·</span>{" "}
                    <span className="font-normal text-slate-700">
                      {p.project_title ?? "Untitled"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Open: {p.open_approvals} · Breached: {p.breached}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2 py-1 text-xs font-medium ${pillClass(
                    p.rag
                  )}`}
                >
                  {p.rag === "R" ? "Red" : p.rag === "A" ? "Amber" : "Green"}
                </span>
              </div>
            </div>
          ))}
          {!heatmap.length && !loading ? (
            <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">
              No approvals currently pending.
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-slate-700" />
          <div className="text-sm font-semibold text-slate-900">
            Cross-project congestion
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="py-2 pr-4">Approver</th>
                <th className="py-2 pr-4">Open</th>
                <th className="py-2 pr-4 text-center">Score</th>
              </tr>
            </thead>
            <tbody>
              {bottlenecks.map((b, idx) => (
                <tr
                  key={idx}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="py-3 pr-4 font-medium text-slate-900">
                    {b.approver_label}
                  </td>
                  <td className="py-3 pr-4 text-slate-600">{b.open_steps}</td>
                  <td className="py-3 pr-4 text-center font-bold text-slate-900">
                    {b.blocker_score}
                  </td>
                </tr>
              ))}
              {!bottlenecks.length && !loading ? (
                <tr>
                  <td
                    colSpan={3}
                    className="py-8 text-center text-sm text-slate-500"
                  >
                    No congestion detected.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}