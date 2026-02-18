"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Clock3, ArrowUpRight, AlertTriangle } from "lucide-react";

type Item = {
  id: string;
  project_id: string;
  project_title: string;
  milestone_name: string;
  due_date: string | null;
  status: string;
  risk_score: number;
  ai_delay_prob: number;
  last_risk_reason: string;
  baseline_end: string | null;
  slip_days: number | null;

  // ✅ new (optional) fields from API fix
  slip_known?: boolean;
  slip_label?: string;

  open_href?: string | null;
  source_artifact_id?: string | null;
};

type Scope = "window" | "overdue" | "all";
type StatusFilter = "" | "planned" | "at_risk" | "overdue" | "completed" | "in_progress";

function clampDays(x: string | null, fallback = 30): 7 | 14 | 30 | 60 {
  const n = Number(x);
  const allowed = new Set([7, 14, 30, 60]);
  if (!Number.isFinite(n) || !allowed.has(n)) return fallback as any;
  return n as any;
}

function safeScope(x: string | null): Scope {
  const v = String(x || "").toLowerCase();
  if (v === "overdue" || v === "all" || v === "window") return v as Scope;
  return "window";
}

function safeStatus(x: string | null): StatusFilter {
  const v = String(x || "").trim().toLowerCase().replace(/\s+/g, "_");
  if (v === "planned") return "planned";
  if (v === "at_risk") return "at_risk";
  if (v === "overdue") return "overdue";
  if (v === "completed" || v === "done") return "completed";
  if (v === "in_progress") return "in_progress";
  return "";
}

function normStatus(x: any) {
  return String(x ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

function isDoneStatus(st: any) {
  return new Set(["done", "completed", "closed", "cancelled", "canceled"]).has(normStatus(st));
}

function toMs(d: string | null): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : null;
}

function fmtUkDate(d: string | null) {
  if (!d) return "—";
  const ms = toMs(d);
  if (ms == null) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(ms));
}

function slipDisplay(it: Item): string {
  // ✅ prefer server-provided label if present
  const s = String(it?.slip_label || "").trim();
  if (s) return s;

  const n = Number(it?.slip_days);
  return Number.isFinite(n) ? `${n}d` : "—";
}

export default function MilestonesClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const [days, setDays] = useState<7 | 14 | 30 | 60>(clampDays(sp.get("days"), 30));
  const [scope, setScope] = useState<Scope>(safeScope(sp.get("scope")));
  const [status, setStatus] = useState<StatusFilter>(safeStatus(sp.get("status")));

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // ✅ keep URL in sync (days/scope/status)
  useEffect(() => {
    const qs = new URLSearchParams();
    qs.set("days", String(days));
    qs.set("scope", scope);
    if (status) qs.set("status", status);
    router.replace(`/milestones?${qs.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, scope, status]);

  // ✅ fetch data whenever filters change
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setErr("");

        const qs = new URLSearchParams();
        qs.set("days", String(days));
        qs.set("scope", scope);
        if (status) qs.set("status", status);

        const r = await fetch(`/api/milestones/list?${qs.toString()}`, { cache: "no-store" });
        const j = await r.json();
        if (!j?.ok) throw new Error(j?.error || "Failed to load milestones");

        if (!cancelled) setItems(Array.isArray(j?.items) ? j.items : []);
      } catch (e: any) {
        if (!cancelled) {
          setErr(e?.message || "Failed to load milestones");
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [days, scope, status]);

  const todayMs = useMemo(() => {
    const now = new Date();
    // compare against "today" local midnight for UI stability
    const mid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return mid.getTime();
  }, []);

  // ✅ stats computed from returned items (works even when filtered)
  const stats = useMemo(() => {
    let overdue = 0,
      atRisk = 0,
      planned = 0,
      done = 0;

    for (const it of items) {
      const st = normStatus(it.status);
      if (st === "at_risk") atRisk++;
      if (st === "planned") planned++;
      if (isDoneStatus(st)) done++;

      const dueMs = toMs(it.due_date);
      if (dueMs != null && dueMs < todayMs && !isDoneStatus(st)) overdue++;
    }

    return { overdue, atRisk, planned, done };
  }, [items, todayMs]);

  function badgeClass(kind: "ok" | "warn" | "danger") {
    if (kind === "danger") return "border-rose-600/40 bg-rose-50 text-rose-800 font-medium";
    if (kind === "warn") return "border-amber-600/40 bg-amber-50 text-amber-800 font-medium";
    return "border-gray-300 bg-gray-50 text-gray-700 font-medium";
  }

  function chipBase(active: boolean) {
    return [
      "rounded-full border px-3 py-1.5 text-sm font-medium transition cursor-pointer select-none",
      active ? "border-indigo-600 bg-indigo-50 text-indigo-700 shadow-sm" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
    ].join(" ");
  }

  function openItem(it: Item) {
    const href = String(it.open_href || "").trim();
    if (href) {
      router.push(href);
      return;
    }
    router.push(`/projects/${it.project_id}`);
  }

  return (
    <div className="min-h-screen bg-white text-gray-900 font-['Inter','system-ui',sans-serif]">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex items-start justify-between gap-6 mb-10">
          <div>
            <div className="flex items-center gap-3">
              <Clock3 className="h-8 w-8 text-indigo-600" />
              <h1 className="text-4xl font-bold tracking-tight">Milestones</h1>
            </div>
            <p className="mt-3 text-lg text-gray-600">Portfolio drill-down • due window • overdue • risk overlay • slippage</p>
          </div>
          <button
            className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition"
            onClick={() => router.push("/")}
          >
            Back to Dashboard
          </button>
        </div>

        {/* Filters */}
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="text-sm font-medium text-gray-600">Milestones window</div>
            {[7, 14, 30, 60].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d as any)}
                className={[
                  "px-4 py-2 rounded-lg text-sm border transition-all font-medium",
                  days === d ? "border-indigo-600 bg-indigo-50 text-indigo-700 shadow-sm" : "border-gray-300 text-gray-700 hover:bg-gray-50",
                ].join(" ")}
              >
                {d}d
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            {(["window", "overdue", "all"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className={[
                  "px-4 py-2 rounded-lg text-sm border transition-all font-medium capitalize",
                  scope === s ? "border-indigo-600 bg-indigo-50 text-indigo-700 shadow-sm" : "border-gray-300 text-gray-700 hover:bg-gray-50",
                ].join(" ")}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* ✅ Quick filter chips */}
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" className={chipBase(status === "")} onClick={() => setStatus("")} title="Clear status filter">
            All
          </button>

          <button type="button" className={chipBase(status === "planned")} onClick={() => setStatus("planned")}>
            Planned: {stats.planned}
          </button>

          <button type="button" className={chipBase(status === "at_risk")} onClick={() => setStatus("at_risk")}>
            <span className={`rounded-full border px-2 py-0.5 mr-2 ${badgeClass(stats.atRisk ? "warn" : "ok")}`}>At risk</span>
            {stats.atRisk}
          </button>

          <button type="button" className={chipBase(status === "overdue")} onClick={() => setStatus("overdue")}>
            <span className={`rounded-full border px-2 py-0.5 mr-2 ${badgeClass(stats.overdue ? "danger" : "ok")}`}>Overdue</span>
            {stats.overdue}
          </button>

          <button type="button" className={chipBase(status === "completed")} onClick={() => setStatus("completed")}>
            Done: {stats.done}
          </button>
        </div>

        {/* Table */}
        <div className="mt-8 rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
            <div className="font-semibold text-lg text-gray-900">Milestone List</div>
            {loading ? <div className="text-sm text-gray-500">Loading…</div> : <div className="text-sm text-gray-500">{items.length} items</div>}
          </div>

          {err ? (
            <div className="p-8 text-rose-700 flex items-center gap-3 text-lg bg-rose-50">
              <AlertTriangle className="h-6 w-6" />
              <span>{err}</span>
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="w-full text-sm text-gray-700">
                <thead className="text-gray-600 bg-gray-50">
                  <tr className="border-b border-gray-200">
                    <th className="text-left font-semibold px-6 py-4">Project</th>
                    <th className="text-left font-semibold px-6 py-4">Milestone</th>
                    <th className="text-left font-semibold px-6 py-4">Due</th>
                    <th className="text-left font-semibold px-6 py-4">Status</th>
                    <th className="text-left font-semibold px-6 py-4">AI</th>
                    <th className="text-left font-semibold px-6 py-4">Slip</th>
                    <th className="text-right font-semibold px-6 py-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td className="px-6 py-12 text-gray-500 text-center" colSpan={7}>
                        Loading milestones…
                      </td>
                    </tr>
                  ) : items.length ? (
                    items.map((it) => {
                      const st = normStatus(it.status);
                      const dueMs = toMs(it.due_date);
                      const isOverdue = dueMs != null && dueMs < todayMs && !isDoneStatus(st);

                      const ai = Math.round(Number(it.ai_delay_prob || 0));

                      return (
                        <tr
                          key={it.id}
                          className={["border-b border-gray-100 hover:bg-gray-50 transition", isOverdue ? "bg-rose-50" : ""].join(" ")}
                        >
                          <td className="px-6 py-4 font-medium text-gray-900">{it.project_title}</td>
                          <td className="px-6 py-4 min-w-[360px]">
                            <div className="font-medium text-gray-900">{it.milestone_name}</div>
                            {it.last_risk_reason ? <div className="text-sm text-gray-600 mt-1 line-clamp-2">{it.last_risk_reason}</div> : null}
                          </td>
                          <td className="px-6 py-4">
                            <span className={isOverdue ? "text-rose-600 font-medium" : ""}>{fmtUkDate(it.due_date)}</span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap capitalize">
                            <span
                              className={[
                                "inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium",
                                st === "at_risk"
                                  ? "border-amber-600/40 bg-amber-50 text-amber-800"
                                  : isOverdue
                                  ? "border-rose-600/40 bg-rose-50 text-rose-800"
                                  : "border-gray-300 bg-gray-50 text-gray-700",
                              ].join(" ")}
                            >
                              {st || "planned"}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={[
                                "inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium",
                                ai >= 70 ? "border-amber-600/40 bg-amber-50 text-amber-800" : "border-gray-300 bg-gray-50 text-gray-700",
                              ].join(" ")}
                              title="AI delay probability"
                            >
                              {ai}%
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-gray-900 font-medium">{slipDisplay(it)}</span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button
                              type="button"
                              className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 transition font-medium"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                openItem(it);
                              }}
                              title={it.open_href ? "Open schedule artifact" : "Open"}
                            >
                              Open <ArrowUpRight className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td className="px-6 py-12 text-gray-500 text-center" colSpan={7}>
                        No milestones found for this filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="h-16" />
      </div>
    </div>
  );
}
