"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowUpRight, ShieldAlert, Activity, Clock3, CirclePoundSterling } from "lucide-react";

type RiskItem = {
  id: string;
  project_id: string;

  project_title: string;
  project_human_id?: string | null;
  project_code?: string | number | null;

  type: "Risk" | "Issue" | "Assumption" | "Dependency";
  title: string;
  description: string;
  status: string;
  priority: string | null;
  probability: number | null;
  severity: number | null;

  score: number | null;
  score_source?: "ai" | "basic";
  score_components?: any | null;
  score_tooltip?: string | null;

  sla_breach_probability?: number | null;
  sla_days_to_breach?: number | null;
  sla_confidence?: number | null;
  sla_drivers?: any | null;

  currency?: string | null;
  currency_symbol?: string | null;

  est_cost_impact?: number | null;
  est_revenue_at_risk?: number | null;
  est_penalties?: number | null;
  est_schedule_days?: number | null;

  due_date: string | null;
  due_date_uk?: string | null;

  owner_label: string;
  ai_rollup: string;
};

function clampDays(x: string | null, fallback = 30): 7 | 14 | 30 | 60 {
  const n = Number(x);
  const allowed = new Set([7, 14, 30, 60]);
  if (!Number.isFinite(n) || !allowed.has(n)) return fallback as any;
  return n as any;
}

function safeScope(x: string | null): "window" | "overdue" | "all" {
  const v = String(x || "").toLowerCase();
  if (v === "window" || v === "overdue" || v === "all") return v as any;
  return "all";
}

function safeStatusUi(x: string | null): "all" | "open" | "in_progress" | "mitigated" | "closed" | "invalid" {
  const v = String(x || "").toLowerCase();
  const ok = new Set(["all", "open", "in_progress", "mitigated", "closed", "invalid"]);
  return (ok.has(v) ? v : "all") as any;
}

function safeTypeUi(x: string | null): "all" | "Risk" | "Issue" | "Assumption" | "Dependency" {
  const v = String(x || "");
  const ok = new Set(["all", "Risk", "Issue", "Assumption", "Dependency"]);
  return (ok.has(v) ? v : "all") as any;
}

function fmtIsoDate(d: string | null) {
  if (!d) return null;
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return String(d).slice(0, 10);
  }
}

function fmtUkDate(d: string | null) {
  if (!d) return "—";
  const iso = fmtIsoDate(d);
  if (!iso || iso.length !== 10) return String(d);
  const [yyyy, mm, dd] = iso.split("-");
  return `${dd}/${mm}/${yyyy}`;
}

function pill(kind: "neutral" | "warn" | "danger") {
  if (kind === "danger") return "border-rose-600/40 bg-rose-50 text-rose-800";
  if (kind === "warn") return "border-amber-600/40 bg-amber-50 text-amber-800";
  return "border-gray-300 bg-gray-50 text-gray-700";
}

function standoutPill(type: "score" | "sla" | "exposure") {
  if (type === "score") return "bg-emerald-600 text-white border-emerald-700 shadow-sm";
  if (type === "sla") return "bg-blue-600 text-white border-blue-700 shadow-sm";
  if (type === "exposure") return "bg-orange-600 text-white border-orange-700 shadow-sm";
  return "bg-gray-100 text-gray-800 border-gray-300";
}

function n(x: any, fallback: number | null = null) {
  const v = Number(x);
  return Number.isFinite(v) ? v : fallback;
}

function symbolForCurrency(currency: string | null | undefined, serverSymbol?: string | null) {
  if (serverSymbol && String(serverSymbol).trim()) return String(serverSymbol);
  const cur = (currency || "GBP").toUpperCase();
  if (cur === "GBP" || cur === "UKP") return "£";
  if (cur === "EUR") return "€";
  if (cur === "USD") return "$";
  return "£";
}

function money(currency: string | null | undefined, value: any, serverSymbol?: string | null) {
  const v = Number(value);
  if (!Number.isFinite(v) || v === 0) return "—";
  const sym = symbolForCurrency(currency, serverSymbol);
  return sym + Math.round(v).toLocaleString();
}

function Sparkline({ points }: { points: number[] }) {
  const w = 44;
  const h = 16;
  if (!points?.length) return <span className="text-gray-400">—</span>;
  const vals = points.map((x) => (Number.isFinite(Number(x)) ? Number(x) : 0));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const step = vals.length === 1 ? 0 : w / (vals.length - 1);
  const d = vals
    .map((v, i) => {
      const x = i * step;
      const y = h - (h * (v - min)) / span;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="opacity-90 text-blue-600">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function Tooltip({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <span className="relative group inline-flex">
      {children}
      <span
        className={[
          "pointer-events-none absolute z-20 hidden group-hover:block top-full mt-2 left-1/2 -translate-x-1/2",
          "w-[360px] max-w-[80vw] rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700 shadow-xl",
          "whitespace-pre-line break-words leading-5",
        ].join(" ")}
      >
        {title}
      </span>
    </span>
  );
}

async function readJsonSafe(res: Response) {
  const status = res.status;
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  if (!text || !text.trim()) {
    return { ok: false, __parse_error: true, status, contentType: ct, error: `Empty response body (HTTP ${status}).`, raw: "" };
  }
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, __parse_error: true, status, contentType: ct, error: `Non-JSON response (HTTP ${status}).`, raw: text.slice(0, 4000) };
  }
}

export default function RisksPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const [windowDays, setWindowDays] = useState<7 | 14 | 30 | 60>(clampDays(sp.get("window"), 30));
  const [scope, setScope] = useState<"window" | "overdue" | "all">(safeScope(sp.get("scope")));
  const [type, setType] = useState<"all" | "Risk" | "Issue" | "Assumption" | "Dependency">(safeTypeUi(sp.get("type") || "all"));
  const [status, setStatus] = useState<"all" | "open" | "in_progress" | "mitigated" | "closed" | "invalid">(safeStatusUi(sp.get("status") || "all"));

  const [items, setItems] = useState<RiskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [spark, setSpark] = useState<Record<string, number[]>>({});

  useEffect(() => {
    const qs = new URLSearchParams();
    qs.set("window", String(windowDays));
    qs.set("scope", scope);
    if (type !== "all") qs.set("type", type);
    if (status !== "all") qs.set("status", status);
    router.replace(`/risks?${qs.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowDays, scope, type, status]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setErr("");

        const qs = new URLSearchParams();
        qs.set("window", String(windowDays));
        qs.set("scope", scope);
        if (type !== "all") qs.set("type", type);
        if (status !== "all") qs.set("status", status);

        const r = await fetch(`/api/risks/list?${qs.toString()}`, { cache: "no-store" });
        const j: any = await readJsonSafe(r);

        if (!j?.ok) {
          const extra =
            j?.__parse_error && j?.raw ? `\n\nResponse preview:\n${String(j.raw)}` : j?.error ? `\n\n${String(j.error)}` : "";
          throw new Error((j?.error || `Failed to load risks (HTTP ${r.status})`) + extra);
        }

        if (cancelled) return;

        const nextItems = Array.isArray(j?.items) ? (j.items as RiskItem[]) : [];
        setItems(nextItems);

        const ids = nextItems.map((x) => x.id).filter(Boolean).slice(0, 200);
        if (!ids.length) {
          setSpark({});
          return;
        }

        const rr = await fetch(`/api/risks/score-history?points=4&ids=${encodeURIComponent(ids.join(","))}`, { cache: "no-store" });
        const jj: any = await readJsonSafe(rr);

        if (!cancelled) {
          if (jj?.ok && jj?.series) setSpark(jj.series as Record<string, number[]>);
          else setSpark({});
        }
      } catch (e: any) {
        if (!cancelled) {
          setErr(e?.message || "Failed to load risks");
          setItems([]);
          setSpark({});
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [windowDays, scope, type, status]);

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const stats = useMemo(() => {
    let overdue = 0;
    let high = 0;
    let open = 0;
    let slaHigh = 0;
    let finHigh = 0;

    for (const it of items) {
      const st = String(it.status || "").toLowerCase();
      if (st === "open") open++;

      const dueIso = fmtIsoDate(it.due_date);
      const isOverdue = !!dueIso && dueIso < todayIso && !["closed", "invalid"].includes(st);
      if (isOverdue) overdue++;

      const score = n(it.score, 0) || 0;
      if (score >= 70) high++;

      const bp = n(it.sla_breach_probability, null);
      if (bp != null && bp >= 70) slaHigh++;

      const cost = n(it.est_cost_impact, 0) || 0;
      const rev = n(it.est_revenue_at_risk, 0) || 0;
      const pen = n(it.est_penalties, 0) || 0;
      if (cost + rev + pen >= 100000) finHigh++;
    }

    return { overdue, high, open, slaHigh, finHigh };
  }, [items, todayIso]);

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex items-start justify-between gap-6 mb-10">
          <div>
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-8 w-8 text-rose-600" />
              <h1 className="text-4xl font-bold tracking-tight">Risks & RAID</h1>
            </div>
            <p className="mt-3 text-lg text-gray-600">
              Portfolio-wide overview • overdue highlights • filters • AI scoring & financial exposure
            </p>
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
            <div className="text-sm font-medium text-gray-600">Window</div>
            {[7, 14, 30, 60].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setWindowDays(d as any)}
                className={[
                  "px-4 py-2 rounded-lg text-sm border transition-all font-medium",
                  windowDays === d ? "border-blue-600 bg-blue-50 text-blue-700 shadow-sm" : "border-gray-300 text-gray-700 hover:bg-gray-50",
                ].join(" ")}
              >
                {d}d
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            {(["all", "window", "overdue"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s as any)}
                className={[
                  "px-4 py-2 rounded-lg text-sm border transition-all font-medium capitalize",
                  scope === s ? "border-blue-600 bg-blue-50 text-blue-700 shadow-sm" : "border-gray-300 text-gray-700 hover:bg-gray-50",
                ].join(" ")}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <select
              value={type}
              onChange={(e) => setType((e.target.value as any) || "all")}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            >
              <option value="all">All types</option>
              <option value="Risk">Risk</option>
              <option value="Issue">Issue</option>
              <option value="Assumption">Assumption</option>
              <option value="Dependency">Dependency</option>
            </select>

            <select
              value={status}
              onChange={(e) => setStatus((e.target.value as any) || "all")}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            >
              <option value="all">All statuses</option>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="mitigated">Mitigated</option>
              <option value="closed">Closed</option>
              <option value="invalid">Invalid</option>
            </select>
          </div>
        </div>

        {/* Quick stats */}
        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          <span className={`rounded-full border px-3 py-1.5 font-medium ${pill("neutral")}`}>Open: {stats.open}</span>
          <span className={`rounded-full border px-3 py-1.5 font-medium ${stats.high ? pill("warn") : pill("neutral")}`}>High score: {stats.high}</span>
          <span className={`rounded-full border px-3 py-1.5 font-medium ${stats.slaHigh ? pill("warn") : pill("neutral")}`}>SLA risk ≥70%: {stats.slaHigh}</span>
          <span className={`rounded-full border px-3 py-1.5 font-medium ${stats.finHigh ? pill("warn") : pill("neutral")}`}>Exposure ≥100k: {stats.finHigh}</span>
          <span className={`rounded-full border px-3 py-1.5 font-medium ${stats.overdue ? pill("danger") : pill("neutral")}`}>Overdue: {stats.overdue}</span>
        </div>

        {/* Table */}
        <div className="mt-8 rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
            <div className="font-semibold text-lg text-gray-900">RAID Items</div>
            {loading ? <div className="text-sm text-gray-500">Loading…</div> : <div className="text-sm text-gray-500">{items.length} items</div>}
          </div>

          {err ? (
            <div className="p-8 text-rose-700 flex items-start gap-3 text-base bg-rose-50">
              <AlertTriangle className="h-6 w-6 mt-0.5" />
              <div className="whitespace-pre-wrap break-words">{err}</div>
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="w-full text-sm text-gray-700">
                <thead className="text-gray-600 bg-gray-50">
                  <tr className="border-b border-gray-200">
                    {/* ✅ NEW: ID column */}
                    <th className="text-left font-semibold px-6 py-4 w-[110px]">ID</th>

                    <th className="text-left font-semibold px-6 py-4">Project</th>
                    <th className="text-left font-semibold px-6 py-4">Type</th>
                    <th className="text-left font-semibold px-6 py-4">Title</th>
                    <th className="text-left font-semibold px-6 py-4">Due</th>
                    <th className="text-left font-semibold px-6 py-4">Status</th>
                    <th className="text-left font-semibold px-6 py-4">Score</th>
                    <th className="text-left font-semibold px-6 py-4">Trend</th>
                    <th className="text-left font-semibold px-6 py-4">SLA</th>
                    <th className="text-left font-semibold px-6 py-4">Exposure</th>
                    <th className="text-left font-semibold px-6 py-4">Owner</th>
                    <th className="text-right font-semibold px-6 py-4"></th>
                  </tr>
                </thead>

                <tbody>
                  {loading ? (
                    <tr>
                      <td className="px-6 py-12 text-gray-500 text-center" colSpan={12}>
                        Loading…
                      </td>
                    </tr>
                  ) : items.length ? (
                    items.map((it) => {
                      const dueIso = fmtIsoDate(it.due_date);
                      const dueUk = it.due_date_uk || (it.due_date ? fmtUkDate(it.due_date) : "—");

                      const st = String(it.status || "").toLowerCase();
                      const isOverdue = !!dueIso && dueIso < todayIso && !["closed", "invalid"].includes(st);

                      const score = n(it.score, null);
                      const trend = spark[it.id] || [];

                      const slaProb = n(it.sla_breach_probability, null);
                      const slaDays = n(it.sla_days_to_breach, null);
                      const slaConf = n(it.sla_confidence, null);

                      const exposure =
                        (n(it.est_cost_impact, 0) || 0) + (n(it.est_revenue_at_risk, 0) || 0) + (n(it.est_penalties, 0) || 0);

                      const scoreTip =
                        (it.score_tooltip && String(it.score_tooltip)) ||
                        (it.score_source === "ai"
                          ? `AI score.\n\nComponents:\n${it.score_components ? JSON.stringify(it.score_components, null, 2) : "—"}`
                          : "Basic score = probability × severity");

                      const slaTip =
                        slaProb == null
                          ? "No SLA prediction yet."
                          : `Breach probability: ${slaProb}%\nDays to breach: ${slaDays ?? "—"}\nConfidence: ${slaConf ?? "—"}%\nDrivers: ${
                              it.sla_drivers ? JSON.stringify(it.sla_drivers, null, 2) : "—"
                            }`;

                      const exposureTip =
                        `Cost: ${money(it.currency, it.est_cost_impact, it.currency_symbol)}\n` +
                        `Revenue risk: ${money(it.currency, it.est_revenue_at_risk, it.currency_symbol)}\n` +
                        `Penalties: ${money(it.currency, it.est_penalties, it.currency_symbol)}\n` +
                        `Schedule: ${n(it.est_schedule_days, null) ?? "—"}d`;

                      return (
                        <tr key={it.id} className={["border-b border-gray-100 hover:bg-gray-50 transition", isOverdue ? "bg-rose-50" : ""].join(" ")}>
                          {/* ✅ ID column */}
                          <td className="px-6 py-4 font-semibold text-gray-900 tabular-nums">
                            {it.project_human_id ? String(it.project_human_id) : "—"}
                          </td>

                          {/* Project column now just the name */}
                          <td className="px-6 py-4 font-medium text-gray-900">{it.project_title}</td>

                          <td className="px-6 py-4">
                            <span className="rounded-full border border-gray-300 bg-gray-100 px-3 py-1 text-xs font-medium">{it.type}</span>
                          </td>

                          <td className="px-6 py-4 min-w-[380px]">
                            <div className="font-medium text-gray-900">{it.title}</div>
                            {it.ai_rollup && <div className="text-sm text-gray-600 mt-1 line-clamp-2">{it.ai_rollup}</div>}
                          </td>

                          <td className="px-6 py-4">
                            <span className={isOverdue ? "text-rose-600 font-medium" : ""}>{dueUk}</span>
                          </td>

                          <td className="px-6 py-4">{it.status}</td>

                          <td className="px-6 py-4">
                            <Tooltip title={scoreTip}>
                              <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium ${standoutPill("score")}`}>
                                <Activity className="h-4 w-4" />
                                {score == null ? "—" : score}
                                {it.score_source === "ai" && <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">AI</span>}
                              </span>
                            </Tooltip>
                          </td>

                          <td className="px-6 py-4">
                            <Sparkline points={trend} />
                          </td>

                          <td className="px-6 py-4">
                            <Tooltip title={slaTip}>
                              <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium ${standoutPill("sla")}`}>
                                <Clock3 className="h-4 w-4" />
                                {slaProb == null ? "—" : `${slaProb}%`}
                                {slaDays != null && <span className="opacity-80">({slaDays}d)</span>}
                                {slaConf != null && <span className="opacity-70">• {slaConf}%</span>}
                              </span>
                            </Tooltip>
                          </td>

                          <td className="px-6 py-4">
                            <Tooltip title={exposureTip}>
                              <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium ${standoutPill("exposure")}`}>
                                <CirclePoundSterling className="h-4 w-4" />
                                {exposure > 0 ? money(it.currency, exposure, it.currency_symbol) : "—"}
                              </span>
                            </Tooltip>
                          </td>

                          <td className="px-6 py-4">{it.owner_label || "—"}</td>

                          <td className="px-6 py-4 text-right">
                            <button
                              className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 transition font-medium"
                              onClick={() => router.push(`/projects/${it.project_id}/raid`)}
                              title="Open project RAID"
                            >
                              Open <ArrowUpRight className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td className="px-6 py-12 text-gray-500 text-center" colSpan={12}>
                        No items found for this filter.
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
