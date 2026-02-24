"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
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

async function apiGet(path: string) {
  const res = await fetch(path, { cache: "no-store" });
  const json = await res.json();
  if (!json?.ok) throw new Error(json?.error || "Request failed");
  return json;
}

export default function ExecutiveCockpitClient() {
  const [loading, setLoading] = useState(true);
  const [heatmap, setHeatmap] = useState<HeatmapItem[]>([]);
  const [sla, setSla] = useState<{ headline: string; counts: any; items: SlaItem[] } | null>(null);
  const [bottlenecks, setBottlenecks] = useState<Bottleneck[]>([]);
  const [signals, setSignals] = useState<RiskSignal[]>([]);
  const [blocking, setBlocking] = useState<{ narrative: string; top: Bottleneck[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    setLoading(true);
    try {
      const [h, s, b, r, w] = await Promise.all([
        apiGet("/api/executive/portfolio-approvals"),
        apiGet("/api/executive/sla-radar"),
        apiGet("/api/executive/bottlenecks"),
        apiGet("/api/executive/risk-signals"),
        apiGet("/api/executive/who-blocking"),
      ]);
      setHeatmap(h.items || []);
      setSla(s);
      setBottlenecks(b.items || []);
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
          <div className="text-xs uppercase tracking-wider text-slate-500">Executive Cockpit</div>
          <h1 className="text-2xl font-semibold text-slate-900">Approval Intelligence</h1>
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
            <div className="text-sm font-semibold text-slate-900">SLA Breach Radar</div>
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
            <div className="text-sm font-semibold text-slate-900">Who is blocking delivery</div>
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
            <div className="text-sm font-semibold text-slate-900">Executive risk signals</div>
          </div>
          <div className="mt-2 text-sm text-slate-600">
            {signals.length ? `${signals.length} active signal(s)` : loading ? "Loading…" : "No active signals"}
          </div>
          <div className="mt-3 space-y-2">
            {signals.slice(0, 3).map((s, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm text-slate-900">{s.title}</div>
                  <div className="truncate text-xs text-slate-500">{s.project_code ?? "Portfolio"}</div>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-1 text-xs ${severityClass(s.severity)}`}>
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
          <div className="text-sm font-semibold text-slate-900">Portfolio approval heatmap</div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {heatmap.map((p) => (
            <div key={p.project_id} className="rounded-2xl border border-slate-200 p-3 shadow-sm hover:border-slate-300 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">
                    {p.project_code ?? "—"} <span className="font-normal text-slate-400">·</span>{" "}
                    <span className="font-normal text-slate-700">{p.project_title ?? "Untitled"}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Open: {p.open_approvals} · Breached: {p.breached}
                  </div>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-1 text-xs font-medium ${pillClass(p.rag)}`}>
                  {p.rag === "R" ? "Red" : p.rag === "A" ? "Amber" : "Green"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-slate-700" />
          <div className="text-sm font-semibold text-slate-900">Cross-project congestion</div>
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
                <tr key={idx} className="border-b border-slate-100 last:border-0">
                  <td className="py-3 pr-4 font-medium text-slate-900">{b.approver_label}</td>
                  <td className="py-3 pr-4 text-slate-600">{b.open_steps}</td>
                  <td className="py-3 pr-4 text-center font-bold text-slate-900">{b.blocker_score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
