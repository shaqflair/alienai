"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ShieldCheck,
  Users,
  Layers,
  ArrowUpRight,
} from "lucide-react";

type Rag = "G" | "A" | "R";

type PendingApprovalsResp =
  | { ok: false; error: string }
  | {
      ok: true;
      scope: "org_exec" | "project_member";
      orgId?: string;
      radar: { overdue: number; warn: number; ok: number };
      items: any[];
    };

type UiProject = {
  project_id: string;
  project_code: string | null;
  project_title: string | null;
  rag: Rag;
  stage: string | null;
  approver_label: string | null;
  days_waiting: number;
  counts: { ok: number; warn: number; overdue: number; total: number };
};

type UiBottleneck = {
  kind: "user" | "email" | "unknown";
  label: string;
  pending_count: number;
  projects_affected: number;
  avg_wait_days: number;
  max_wait_days: number;
};

function ragBadge(r: Rag) {
  if (r === "G") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (r === "A") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function CrystalCard({
  title,
  icon,
  children,
  right,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-white/90 p-6"
      style={{
        background:
          "linear-gradient(145deg, rgba(255,255,255,0.98) 0%, rgba(248,250,255,0.96) 60%, rgba(243,246,255,0.94) 100%)",
        boxShadow:
          "0 1px 1px rgba(0,0,0,0.02), 0 4px 8px rgba(0,0,0,0.03), 0 12px 32px rgba(99,102,241,0.06), 0 0 0 1px rgba(226,232,240,0.6), 0 1px 0 rgba(255,255,255,1) inset",
        backdropFilter: "blur(24px) saturate(1.8)",
      }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.6) 0%, transparent 55%, rgba(255,255,255,0.12) 100%)",
        }}
      />
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(255,255,255,0.95), transparent)",
        }}
      />
      <div
        className="absolute inset-x-0 top-0 h-14"
        style={{
          background: "linear-gradient(180deg, rgba(255,255,255,0.75), transparent)",
        }}
      />

      <div className="relative flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl text-white"
            style={{
              background: "linear-gradient(135deg,#6366f1,#4f46e5)",
              boxShadow:
                "0 4px 14px rgba(99,102,241,0.28), 0 1px 0 rgba(255,255,255,0.15) inset",
            }}
          >
            {icon}
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] font-bold text-indigo-600">
              Governance Intelligence
            </div>
            <div className="text-lg font-bold text-slate-950">{title}</div>
          </div>
        </div>
        {right}
      </div>

      <div className="relative mt-6">{children}</div>
    </div>
  );
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

function deriveRag(overdue: number, warn: number): Rag {
  if (overdue > 0) return "R";
  if (warn > 0) return "A";
  return "G";
}

export default function GovernanceIntelligence({ days = 30 }: { days?: 7 | 14 | 30 | 60 }) {
  const [resp, setResp] = useState<PendingApprovalsResp | null>(null);

  const loading = !resp;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // ✅ single source of truth; endpoint auto-resolves orgId
        const json = (await fetch(`/api/ai/pending-approvals?limit=200`, {
          cache: "no-store",
        }).then((r) => r.json())) as PendingApprovalsResp;

        if (cancelled) return;
        setResp(json);
      } catch {
        if (cancelled) return;
        setResp({ ok: false, error: "Failed to load approval intelligence" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [days]);

  const items = useMemo(() => {
    if (!resp || !(resp as any).ok) return [];
    return ((resp as any).items || []) as any[];
  }, [resp]);

  const counts = useMemo(() => {
    if (!resp || !(resp as any).ok) return { pending: 0, at_risk: 0, breached: 0, waiting: 0 };
    const r = (resp as any).radar || { overdue: 0, warn: 0, ok: 0 };
    return {
      waiting: safeNum(r.ok),
      at_risk: safeNum(r.warn),
      breached: safeNum(r.overdue),
      pending: safeNum(r.ok) + safeNum(r.warn) + safeNum(r.overdue),
    };
  }, [resp]);

  const projects: UiProject[] = useMemo(() => {
    const map = new Map<string, UiProject>();

    for (const it of items) {
      const pid = safeStr(it?.project_id);
      if (!pid) continue;

      const state = safeStr(it?.sla_state); // 'ok' | 'warn' | 'overdue'
      const ageDays = toDaysFromAgeHours(it?.age_hours);

      let p = map.get(pid);
      if (!p) {
        p = {
          project_id: pid,
          project_code: it?.project_code ?? null,
          project_title: it?.project_title ?? null,
          rag: "G",
          stage: it?.stage_key ?? it?.step_name ?? null,
          approver_label: pickApproverLabel(it),
          days_waiting: ageDays,
          counts: { ok: 0, warn: 0, overdue: 0, total: 0 },
        };
        map.set(pid, p);
      }

      p.counts.total += 1;
      if (state === "overdue") p.counts.overdue += 1;
      else if (state === "warn") p.counts.warn += 1;
      else p.counts.ok += 1;

      // prefer worst case for the project tile
      p.days_waiting = Math.max(p.days_waiting, ageDays);

      // keep a stable label if already set; otherwise fill
      if (!p.approver_label || p.approver_label === "—") {
        p.approver_label = pickApproverLabel(it);
      }
      if (!p.stage) {
        p.stage = it?.stage_key ?? it?.step_name ?? null;
      }
    }

    const list = Array.from(map.values()).map((p) => ({
      ...p,
      rag: deriveRag(p.counts.overdue, p.counts.warn),
    }));

    // order: worst first, then most waiting
    list.sort((a, b) => {
      const aw = a.counts.overdue > 0 ? 2 : a.counts.warn > 0 ? 1 : 0;
      const bw = b.counts.overdue > 0 ? 2 : b.counts.warn > 0 ? 1 : 0;
      if (bw !== aw) return bw - aw;
      return b.days_waiting - a.days_waiting;
    });

    return list;
  }, [items]);

  const bottlenecks: UiBottleneck[] = useMemo(() => {
    const map = new Map<string, { kind: UiBottleneck["kind"]; label: string; ages: number[]; projects: Set<string>; count: number }>();

    for (const it of items) {
      const label = pickApproverLabel(it);
      const kind: UiBottleneck["kind"] =
        it?.approver_type === "user" ? "user" : it?.approver_type === "email" ? "email" : "unknown";

      const key = `${kind}::${label}`;
      const ageDays = toDaysFromAgeHours(it?.age_hours);
      const pid = safeStr(it?.project_id);

      let b = map.get(key);
      if (!b) {
        b = { kind, label, ages: [], projects: new Set<string>(), count: 0 };
        map.set(key, b);
      }
      b.count += 1;
      b.ages.push(ageDays);
      if (pid) b.projects.add(pid);
    }

    const out: UiBottleneck[] = Array.from(map.values()).map((x) => {
      const max = x.ages.length ? Math.max(...x.ages) : 0;
      const avg = x.ages.length ? x.ages.reduce((a, n) => a + n, 0) / x.ages.length : 0;

      return {
        kind: x.kind,
        label: x.label,
        pending_count: x.count,
        projects_affected: x.projects.size,
        avg_wait_days: Math.round(avg * 10) / 10,
        max_wait_days: max,
      };
    });

    // sort by worst congestion: count desc then max wait desc
    out.sort((a, b) => {
      if (b.pending_count !== a.pending_count) return b.pending_count - a.pending_count;
      return b.max_wait_days - a.max_wait_days;
    });

    return out;
  }, [items]);

  const error =
    resp && (resp as any).ok === false ? (resp as any).error || "Failed to load approval intelligence" : null;

  return (
    <CrystalCard
      title="Approvals — Portfolio Control"
      icon={<ShieldCheck className="h-5 w-5" />}
      right={
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-600">
            {loading ? "Loading…" : `${counts.pending} waiting`}
          </span>
          <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
            {loading ? "…" : `${counts.at_risk} at risk`}
          </span>
          <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-bold text-rose-700">
            {loading ? "…" : `${counts.breached} breached`}
          </span>
        </div>
      }
    >
      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
            Portfolio approval heatmap
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {projects.slice(0, 8).map((x, idx) => (
              <div
                key={`${x.project_id}-${idx}`}
                className="rounded-2xl border border-slate-200/70 bg-white/60 p-4 hover:bg-white/85 transition-all"
                style={{
                  backdropFilter: "blur(10px)",
                  boxShadow:
                    "0 1px 3px rgba(0,0,0,0.04), 0 1px 0 rgba(255,255,255,0.9) inset",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${ragBadge(
                          x.rag
                        )}`}
                      >
                        {x.rag === "G" ? "GREEN" : x.rag === "A" ? "AMBER" : "RED"}
                      </span>

                      {x.project_code ? (
                        <span className="inline-flex items-center rounded-md bg-indigo-50/80 border border-indigo-200/60 px-2 py-0.5 text-[10px] font-bold text-indigo-700 uppercase tracking-wider">
                          {x.project_code}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-2 font-bold text-slate-900 truncate">
                      {x.project_title || "Project"}
                    </div>

                    <div className="mt-1 text-xs text-slate-500">
                      <span className="font-semibold text-slate-700">{x.stage || "Approval"}</span>{" "}
                      · <span className="text-slate-400 text-[10px]">by</span>{" "}
                      <span className="font-semibold text-slate-600">
                        {x.approver_label || "—"}
                      </span>
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <div className="text-[11px] font-bold text-slate-700">
                      {x.days_waiting}d
                    </div>
                    <div className="text-[10px] text-slate-400 uppercase font-medium">
                      wait
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {projects.length > 8 ? (
            <div className="mt-4 text-[11px] text-slate-400 font-medium italic">
              Showing 8 of {projects.length} stalled tracks
            </div>
          ) : null}
        </div>

        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
            Process Bottlenecks
          </div>

          <div className="space-y-2">
            {bottlenecks.slice(0, 6).map((x, idx) => (
              <div
                key={`${x.label}-${idx}`}
                className="rounded-2xl border border-slate-200/70 bg-white/60 px-4 py-3"
                style={{
                  backdropFilter: "blur(10px)",
                  boxShadow:
                    "0 1px 3px rgba(0,0,0,0.04), 0 1px 0 rgba(255,255,255,0.9) inset",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-slate-50 border border-slate-200 shadow-sm">
                        {x.kind === "user" ? (
                          <Users className="h-4 w-4 text-slate-600" />
                        ) : (
                          <Layers className="h-4 w-4 text-slate-600" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 truncate leading-tight">
                          {x.label}
                        </div>
                        <div className="text-[10px] text-slate-400 font-medium">
                          {x.pending_count} items · {x.projects_affected} projects
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <div className="text-[11px] font-bold text-indigo-600">
                      {x.avg_wait_days}d
                    </div>
                    <div className="text-[10px] text-slate-400 uppercase font-medium">
                      avg
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {!bottlenecks.length && !loading ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white/40 px-4 py-8 text-center">
                <AlertTriangle className="h-7 w-7 text-slate-300 mx-auto mb-2" />
                <div className="text-sm font-semibold text-slate-600">
                  No congestion
                </div>
                <div className="text-[10px] text-slate-400 mt-1 uppercase">
                  Approvals flow optimized
                </div>
              </div>
            ) : null}

            <a
              href="/approvals"
              className="group inline-flex items-center gap-2 text-[11px] font-bold text-indigo-600 hover:text-indigo-700 transition-colors mt-4 uppercase tracking-wider"
            >
              Control Center{" "}
              <ArrowUpRight className="h-3 w-3 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </a>
          </div>
        </div>
      </div>
    </CrystalCard>
  );
}