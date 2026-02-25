// src/components/executive/ExecutiveCockpitClient.tsx
// Rebuilt: signal-rich cockpit tiles with crystal design system.
// All tiles degrade gracefully to a count if structured data is not present.
//
// Fixes applied:
//   ✅ FIX-ECC1: URL paths corrected — three endpoints were missing /approvals/ prefix
//              /api/executive/who-blocking   → /api/executive/approvals/who-blocking
//              /api/executive/sla-radar      → /api/executive/approvals/sla-radar
//              /api/executive/risk-signals   → /api/executive/approvals/risk-signals
//   ✅ FIX-ECC2: SlaRadarBody reads item.breached / item.at_risk (route returns booleans, not sla_state)
//   ✅ FIX-ECC3: PendingApprovalsBody reads sla_status || sla_state (cache column is sla_status)
//   ✅ FIX-ECC4: MicroList age derived from submitted_at/created_at (age_hours doesn't exist on cache rows)

"use client";

import * as React from "react";
import {
  AlertTriangle, CheckCircle2, ArrowUpRight,
  Users, Layers, RefreshCw, ChevronRight,
  Target, BarChart2, CheckCheck, Flame, Clock3,
} from "lucide-react";
import { LazyMotion, domAnimation, m, AnimatePresence } from "framer-motion";

// --- TYPES --------------------------------------------------------------------

type ApiOk<T> = { ok?: boolean; orgId?: string; org_id?: string; scope?: string } & T;
type ApiErr = { ok?: boolean; error: string; message?: string };
type Payload = ApiOk<{
  items?: any[]; pending?: any[]; data?: any;
  blockers?: any[]; breaches?: any[]; signals?: any[];
}> | ApiErr;

function isErr(x: any): x is ApiErr {
  return !!x && typeof x === "object" && typeof x.error === "string";
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
    },
    signal,
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    throw new Error(
      (json && (json.message || json.error)) ||
      text.slice(0, 200) ||
      `Request failed (${res.status})`
    );
  }
  return json as T;
}

function errPayload(msg: string): ApiErr { return { error: msg }; }

function settledOrErr<T>(r: PromiseSettledResult<T>, fallbackMsg: string): T | ApiErr {
  if (r.status === "fulfilled") return r.value as any;
  return errPayload((r.reason?.message || String(r.reason)) || fallbackMsg);
}

function extractList(payload: any, preferredKeys: string[] = ["items"]): any[] {
  if (!payload || typeof payload !== "object") return [];
  for (const k of preferredKeys) {
    const v = (payload as any)[k];
    if (Array.isArray(v)) return v;
  }
  const candidates = ["items", "pending", "rows", "blockers", "breaches", "signals"];
  for (const k of candidates) {
    const v = (payload as any)[k];
    if (Array.isArray(v)) return v;
  }
  const data = (payload as any).data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const k of preferredKeys) { const v = (data as any)[k]; if (Array.isArray(v)) return v; }
    for (const k of candidates) { const v = (data as any)[k]; if (Array.isArray(v)) return v; }
  }
  return [];
}

function safeStr(x: any) { return typeof x === "string" ? x : x == null ? "" : String(x); }
function safeNum(x: any, fb = 0) { const n = Number(x); return Number.isFinite(n) ? n : fb; }

function timeAgo(iso: string) {
  if (!iso) return "";
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

// ✅ FIX-ECC4: derive display age from submitted_at or created_at
function ageFromItem(it: any): string {
  const ts = it?.submitted_at ?? it?.created_at ?? null;
  if (!ts) return "";
  return timeAgo(safeStr(ts));
}

// --- DESIGN SYSTEM -----------------------------------------------------------

type ToneKey = "indigo" | "amber" | "emerald" | "rose" | "cyan" | "slate";

const TONES: Record<ToneKey, {
  iconBg: string; iconGlow: string; orb: string;
  bar: string; glow: string; tint: string;
  badge: string; listDot: string;
}> = {
  indigo:  { iconBg: "linear-gradient(135deg,#6366f1,#4f46e5)", iconGlow: "rgba(99,102,241,0.42)",  orb: "rgba(99,102,241,0.06)",  bar: "#6366f1", glow: "rgba(99,102,241,0.18)",  tint: "rgba(99,102,241,0.03)",  badge: "bg-indigo-50 border-indigo-200 text-indigo-700",  listDot: "bg-indigo-400"  },
  amber:   { iconBg: "linear-gradient(135deg,#f59e0b,#d97706)", iconGlow: "rgba(245,158,11,0.42)",  orb: "rgba(245,158,11,0.07)",  bar: "#f59e0b", glow: "rgba(245,158,11,0.18)",  tint: "rgba(245,158,11,0.03)",  badge: "bg-amber-50 border-amber-200 text-amber-700",   listDot: "bg-amber-400"   },
  emerald: { iconBg: "linear-gradient(135deg,#10b981,#059669)", iconGlow: "rgba(16,185,129,0.42)",  orb: "rgba(16,185,129,0.07)",  bar: "#10b981", glow: "rgba(16,185,129,0.18)",  tint: "rgba(16,185,129,0.03)",  badge: "bg-emerald-50 border-emerald-200 text-emerald-700", listDot: "bg-emerald-400" },
  rose:    { iconBg: "linear-gradient(135deg,#f43f5e,#e11d48)", iconGlow: "rgba(244,63,94,0.42)",   orb: "rgba(244,63,94,0.06)",   bar: "#f43f5e", glow: "rgba(244,63,94,0.18)",   tint: "rgba(244,63,94,0.03)",   badge: "bg-rose-50 border-rose-200 text-rose-700",    listDot: "bg-rose-400"    },
  cyan:    { iconBg: "linear-gradient(135deg,#06b6d4,#0891b2)", iconGlow: "rgba(6,182,212,0.42)",   orb: "rgba(6,182,212,0.06)",   bar: "#06b6d4", glow: "rgba(6,182,212,0.18)",   tint: "rgba(6,182,212,0.03)",   badge: "bg-cyan-50 border-cyan-200 text-cyan-700",    listDot: "bg-cyan-400"    },
  slate:   { iconBg: "linear-gradient(135deg,#64748b,#475569)", iconGlow: "rgba(100,116,139,0.38)", orb: "rgba(100,116,139,0.05)", bar: "#64748b", glow: "rgba(100,116,139,0.14)", tint: "rgba(100,116,139,0.025)", badge: "bg-slate-50 border-slate-200 text-slate-700",  listDot: "bg-slate-400"   },
};

// --- SKELETON -----------------------------------------------------------------

function TileSkeleton({ delay = 0 }: { delay?: number }) {
  return (
    <m.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className="rounded-2xl border border-slate-100 bg-white/70 p-5 min-h-[168px] animate-pulse"
      style={{ backdropFilter: "blur(14px)" }}
    >
      <div className="flex items-start gap-3 mb-4">
        <div className="h-10 w-10 rounded-xl bg-slate-200/80 shrink-0" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-3 bg-slate-200/80 rounded w-1/3" />
          <div className="h-8 bg-slate-100/80 rounded w-1/2" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-2.5 bg-slate-100/70 rounded w-full" />
        <div className="h-2.5 bg-slate-100/70 rounded w-4/5" />
        <div className="h-2.5 bg-slate-100/70 rounded w-3/5" />
      </div>
    </m.div>
  );
}

// --- COCKPIT TILE -------------------------------------------------------------

function CockpitTile({
  label, count, icon, tone, error, children, href, delay = 0,
}: {
  label: string;
  count: number | null;
  icon: React.ReactNode;
  tone: ToneKey;
  error?: string | null;
  children?: React.ReactNode;
  href?: string;
  delay?: number;
}) {
  const acc = TONES[tone];
  const hasData = count !== null && !error;

  return (
    <m.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-2xl min-h-[168px] flex flex-col"
      style={{
        background: "linear-gradient(145deg, rgba(255,255,255,0.99) 0%, rgba(250,252,255,0.97) 50%, rgba(248,250,255,0.96) 100%)",
        border: "1px solid rgba(255,255,255,0.96)",
        boxShadow: `0 1px 1px rgba(0,0,0,0.02), 0 4px 12px rgba(0,0,0,0.04), 0 16px 44px ${acc.glow}, 0 44px 88px ${acc.tint}, 0 0 0 1px rgba(226,232,240,0.75), 0 1px 0 rgba(255,255,255,1) inset`,
        backdropFilter: "blur(28px) saturate(1.9)",
      }}
    >
      <div className="absolute inset-0 rounded-2xl pointer-events-none"
        style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.68) 0%, transparent 62%)" }} />
      <div className="absolute top-0 inset-x-0 h-[1px] rounded-t-2xl"
        style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,1) 20%, rgba(255,255,255,1) 80%, transparent)" }} />
      <div className="absolute top-0 inset-x-0 h-24 rounded-t-2xl pointer-events-none"
        style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.82) 0%, transparent 100%)" }} />
      <div className="absolute -bottom-12 -right-12 w-40 h-40 rounded-full pointer-events-none"
        style={{ background: `radial-gradient(ellipse, ${acc.orb} 0%, transparent 65%)`, filter: "blur(2px)" }} />
      <div className="absolute left-0 top-5 bottom-5 w-[3px] rounded-r-full"
        style={{ background: acc.bar, boxShadow: `0 0 14px ${acc.glow}` }} />

      <div className="relative pl-4 p-5 flex flex-col h-full">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.18em] mb-2">{label}</p>
            {error ? (
              <div className="rounded-xl border border-rose-200/70 bg-rose-50/70 px-3 py-2 text-xs text-rose-700 mt-1">
                <AlertTriangle className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5" />
                {error}
              </div>
            ) : (
              <div className="flex items-end gap-3">
                <p
                  className="text-[38px] font-bold text-slate-950 leading-none tracking-tight"
                  style={{ fontFamily: "var(--font-mono, 'DM Mono', monospace)", letterSpacing: "-0.025em" }}
                >
                  {count === null ? (
                    <span className="inline-flex gap-1 items-center pb-2">
                      {[0, 120, 240].map(d => (
                        <span key={d} className="h-1.5 w-1.5 rounded-full bg-slate-300 animate-bounce"
                          style={{ animationDelay: `${d}ms` }} />
                      ))}
                    </span>
                  ) : count}
                </p>
              </div>
            )}
          </div>
          <div
            className="shrink-0 flex items-center justify-center w-11 h-11 rounded-xl text-white"
            style={{ background: acc.iconBg, boxShadow: `0 4px 16px ${acc.iconGlow}, 0 1px 0 rgba(255,255,255,0.22) inset` }}
          >
            {icon}
          </div>
        </div>

        {hasData && children && <div className="mt-auto">{children}</div>}

        {href && hasData && (
          <a href={href}
            className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors"
            style={{ color: acc.bar }}>
            View details
            <ArrowUpRight className="h-3 w-3" />
          </a>
        )}
      </div>
    </m.div>
  );
}

// --- MICRO LIST ---------------------------------------------------------------

function MicroList({ items, tone, labelKey = "title", subKey, ageKey }: {
  items: any[];
  tone: ToneKey;
  labelKey?: string;
  subKey?: string;
  // ✅ FIX-ECC4: ageKey is now optional — if omitted, age is derived from submitted_at/created_at
  ageKey?: string;
}) {
  const acc = TONES[tone];
  if (!items.length) return null;
  return (
    <div className="space-y-1.5 mt-3 pt-3 border-t border-slate-100/80">
      {items.slice(0, 3).map((it, i) => {
        const label = safeStr(it?.[labelKey] || it?.title || it?.name || it?.label || it?.project_title || "---");
        const sub   = subKey ? safeStr(it?.[subKey]) : "";
        // ✅ FIX-ECC4: use explicit ageKey if provided, otherwise derive from timestamp fields
        const age   = ageKey
          ? safeStr(it?.[ageKey])
          : ageFromItem(it);
        return (
          <m.div key={i}
            initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 + i * 0.06 }}
            className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 bg-white/52 border border-slate-100/70 hover:bg-white/80 transition-all"
            style={{ backdropFilter: "blur(8px)", boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${acc.listDot}`} />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-slate-800 truncate">{label}</div>
              {sub && <div className="text-[10px] text-slate-400 truncate">{sub}</div>}
            </div>
            {age && (
              <div className="shrink-0 text-[10px] text-slate-400 font-medium"
                style={{ fontFamily: "var(--font-mono, monospace)" }}>{age}</div>
            )}
          </m.div>
        );
      })}
    </div>
  );
}

// --- SEVERITY BAR -------------------------------------------------------------

function SeverityBar({ items }: { items: any[] }) {
  if (!items.length) return null;
  const high   = items.filter(it => /high|red|r/.test(safeStr(it?.severity || it?.level || it?.rag || "").toLowerCase())).length;
  const medium = items.filter(it => /med|amber|a|warn/.test(safeStr(it?.severity || it?.level || it?.rag || "").toLowerCase())).length;
  const low    = items.length - high - medium;
  const total  = items.length;

  return (
    <div className="mt-3 pt-3 border-t border-slate-100/80">
      <div className="h-1.5 w-full rounded-full overflow-hidden flex bg-slate-100/80 mb-2">
        {high > 0 && (
          <m.div initial={{ width: 0 }} animate={{ width: `${(high / total) * 100}%` }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="h-full bg-rose-400 rounded-l-full"
            style={{ boxShadow: "0 0 6px rgba(244,63,94,0.35)" }} />
        )}
        {medium > 0 && (
          <m.div initial={{ width: 0 }} animate={{ width: `${(medium / total) * 100}%` }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="h-full bg-amber-400" />
        )}
        {low > 0 && (
          <m.div initial={{ width: 0 }} animate={{ width: `${(low / total) * 100}%` }}
            transition={{ duration: 0.7, delay: 0.4 }}
            className="h-full bg-emerald-400 rounded-r-full" />
        )}
      </div>
      <div className="flex items-center gap-3 text-[10px] font-semibold">
        {high   > 0 && <span className="text-rose-600">{high} critical</span>}
        {medium > 0 && <span className="text-amber-600">{medium} medium</span>}
        {low    > 0 && <span className="text-emerald-600">{low} low</span>}
      </div>
    </div>
  );
}

// --- TILE BODIES --------------------------------------------------------------

function SlaRadarBody({ items }: { items: any[] }) {
  // ✅ FIX-ECC2: sla-radar route returns item.breached / item.at_risk booleans, not sla_state/sla_status
  // Also accept sla_status / sla_state as fallback for any other data sources
  const breached = items.filter(it =>
    it?.breached === true ||
    /breach|overdue|r/.test(safeStr(it?.sla_status || it?.sla_state || it?.state || "").toLowerCase())
  ).length;
  const atRisk = items.filter(it =>
    it?.at_risk === true ||
    /warn|at_risk|a/.test(safeStr(it?.sla_status || it?.sla_state || it?.state || "").toLowerCase())
  ).length;

  return (
    <div>
      <div className="flex items-center gap-2 mt-3">
        {breached > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-rose-200/70 bg-rose-50/80 px-2.5 py-1 text-[10px] font-bold text-rose-700">
            <Flame className="h-3 w-3" />{breached} breached
          </span>
        )}
        {atRisk > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200/70 bg-amber-50/80 px-2.5 py-1 text-[10px] font-bold text-amber-700">
            <Clock3 className="h-3 w-3" />{atRisk} at risk
          </span>
        )}
        {breached === 0 && atRisk === 0 && items.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200/70 bg-emerald-50/80 px-2.5 py-1 text-[10px] font-bold text-emerald-700">
            <CheckCheck className="h-3 w-3" />All within SLA
          </span>
        )}
      </div>
      <MicroList items={items} tone="cyan" labelKey="project_title" subKey="stage_key" />
    </div>
  );
}

function WhoBlockingBody({ items }: { items: any[] }) {
  const structured = items.some(it => typeof it?.count === "number" || typeof it?.pending_count === "number");
  if (structured) {
    return (
      <div className="mt-3 pt-3 border-t border-slate-100/80 space-y-2">
        {items.slice(0, 3).map((it, i) => {
          const name    = safeStr(it?.name || it?.label || it?.email || it?.user || "---");
          const count   = safeNum(it?.count || it?.pending_count);
          const maxWait = safeNum(it?.max_wait_days || it?.max_age_days || 0);
          return (
            <m.div key={i}
              initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 + i * 0.06 }}
              className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 bg-white/52 border border-slate-100/70"
              style={{ backdropFilter: "blur(8px)" }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="h-6 w-6 rounded-lg bg-amber-50/80 border border-amber-200/60 flex items-center justify-center shrink-0">
                  <Users className="h-3 w-3 text-amber-600" />
                </div>
                <span className="text-xs font-semibold text-slate-800 truncate">{name}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] font-bold text-amber-700 bg-amber-50/80 border border-amber-200/60 rounded-lg px-2 py-0.5"
                  style={{ fontFamily: "var(--font-mono, monospace)" }}>
                  {count}
                </span>
                {maxWait > 0 && <span className="text-[10px] text-slate-400 font-medium">{maxWait}d</span>}
              </div>
            </m.div>
          );
        })}
      </div>
    );
  }
  return <MicroList items={items} tone="amber" labelKey="name" />;
}

function RiskSignalsBody({ items }: { items: any[] }) {
  return (
    <div>
      <SeverityBar items={items} />
      <MicroList items={items} tone="rose" labelKey="title" subKey="project_title" />
    </div>
  );
}

function PortfolioApprovalsBody({ items }: { items: any[] }) {
  const byProject = new Map<string, { title: string; count: number }>();
  for (const it of items) {
    const pid   = safeStr(it?.project_id || it?.project?.id || "unknown");
    const title = safeStr(it?.project_title || it?.project_name || it?.project?.title || it?.change?.project_title || pid);
    const p = byProject.get(pid) || { title, count: 0 };
    p.count++;
    byProject.set(pid, p);
  }
  const projectList = Array.from(byProject.entries())
    .map(([pid, p]) => ({ pid, ...p }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="mt-3 pt-3 border-t border-slate-100/80 space-y-1.5">
      {projectList.slice(0, 3).map((p, i) => (
        <m.div key={p.pid}
          initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 + i * 0.06 }}
          className="flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 bg-white/52 border border-slate-100/70"
          style={{ backdropFilter: "blur(8px)" }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 shrink-0" />
            <span className="text-xs font-semibold text-slate-800 truncate">{p.title}</span>
          </div>
          <span className="shrink-0 text-[10px] font-bold text-indigo-700 bg-indigo-50/80 border border-indigo-200/60 rounded-lg px-2 py-0.5"
            style={{ fontFamily: "var(--font-mono, monospace)" }}>
            {p.count}
          </span>
        </m.div>
      ))}
    </div>
  );
}

function BottlenecksBody({ items }: { items: any[] }) {
  const maxCount = items.length ? Math.max(...items.map(it => safeNum(it?.pending_count || it?.count || 1))) : 1;
  return (
    <div className="mt-3 pt-3 border-t border-slate-100/80 space-y-2">
      {items.slice(0, 3).map((it, i) => {
        const label    = safeStr(it?.label || it?.name || it?.email || "---");
        const count    = safeNum(it?.pending_count || it?.count || 0);
        const widthPct = Math.max(8, (count / maxCount) * 100);
        return (
          <m.div key={i}
            initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 + i * 0.06 }}
            className="relative overflow-hidden rounded-xl px-3 py-2 border border-slate-100/70 bg-white/52"
            style={{ backdropFilter: "blur(8px)" }}
          >
            <m.div initial={{ width: 0 }} animate={{ width: `${widthPct}%` }}
              transition={{ duration: 0.7, delay: 0.15 + i * 0.07 }}
              className="absolute left-0 top-0 bottom-0 rounded-l-xl opacity-[0.08] bg-slate-600" />
            <div className="relative flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Layers className="h-3 w-3 text-slate-400 shrink-0" />
                <span className="text-xs font-semibold text-slate-800 truncate">{label}</span>
              </div>
              <span className="shrink-0 text-[10px] font-bold text-slate-600"
                style={{ fontFamily: "var(--font-mono, monospace)" }}>{count}</span>
            </div>
          </m.div>
        );
      })}
    </div>
  );
}

function PendingApprovalsBody({ items }: { items: any[] }) {
  // ✅ FIX-ECC3: exec_approval_cache uses sla_status not sla_state; check both for safety
  const overdue = items.filter(it =>
    /breach|overdue/.test(safeStr(it?.sla_status || it?.sla_state || it?.state || "").toLowerCase())
  ).length;
  return (
    <div>
      {overdue > 0 && (
        <div className="flex items-center gap-2 mt-3 mb-1">
          <span className="inline-flex items-center gap-1 rounded-full border border-rose-200/70 bg-rose-50/80 px-2.5 py-1 text-[10px] font-bold text-rose-700">
            <Flame className="h-3 w-3" />{overdue} SLA breach{overdue !== 1 ? "es" : ""}
          </span>
        </div>
      )}
      {/* ✅ FIX-ECC4: no ageKey — MicroList derives age from submitted_at/created_at automatically */}
      <MicroList items={items} tone="emerald" labelKey="project_title" subKey="stage_key" />
    </div>
  );
}

// --- HEADER -------------------------------------------------------------------

function CockpitHeader({ loading, onRefresh, lastRefreshed }: {
  loading: boolean;
  onRefresh: () => void;
  lastRefreshed: string;
}) {
  const [label, setLabel] = React.useState("");
  React.useEffect(() => {
    function tick() { setLabel(lastRefreshed ? timeAgo(lastRefreshed) : ""); }
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [lastRefreshed]);

  return (
    <div className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl text-white"
            style={{ background: "linear-gradient(135deg,#6366f1,#4f46e5)", boxShadow: "0 4px 16px rgba(99,102,241,0.38), 0 1px 0 rgba(255,255,255,0.22) inset" }}
          >
            <BarChart2 className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-indigo-600 mb-0.5">Live Signals</div>
            <h2 className="text-lg font-bold text-slate-950 leading-tight">Executive Cockpit</h2>
          </div>
        </div>
        <p className="text-sm text-slate-400 font-medium">Org-scoped governance signals</p>
      </div>

      <div className="flex items-center gap-3">
        {label && (
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-medium">
            <RefreshCw className="h-3 w-3 opacity-60" />
            Updated {label}
          </div>
        )}
        <button
          type="button" onClick={onRefresh} disabled={loading}
          className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white/72 px-4 py-2.5 text-sm text-slate-600 hover:bg-white/92 hover:text-slate-900 transition-all disabled:opacity-50"
          style={{ backdropFilter: "blur(10px)", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>
    </div>
  );
}

// --- MAIN EXPORT --------------------------------------------------------------

export default function ExecutiveCockpitClient(_props: { orgId?: string } = {}) {
  const [loading, setLoading] = React.useState(true);
  const [lastRefreshed, setLastRefreshed] = React.useState("");

  const [pendingApprovals,   setPendingApprovals]   = React.useState<Payload | null>(null);
  const [whoBlocking,        setWhoBlocking]        = React.useState<Payload | null>(null);
  const [slaRadar,           setSlaRadar]           = React.useState<Payload | null>(null);
  const [riskSignals,        setRiskSignals]        = React.useState<Payload | null>(null);
  const [portfolioApprovals, setPortfolioApprovals] = React.useState<Payload | null>(null);
  const [bottlenecks,        setBottlenecks]        = React.useState<Payload | null>(null);
  const [fatalError,         setFatalError]         = React.useState<string | null>(null);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setFatalError(null);
    setPendingApprovals(null);
    setWhoBlocking(null);
    setSlaRadar(null);
    setRiskSignals(null);
    setPortfolioApprovals(null);
    setBottlenecks(null);

    try {
      const [paR, wbR, slaR, rsR, portR, bottR] = await Promise.allSettled([
        fetchJson<Payload>("/api/executive/approvals/pending?limit=200",      signal),
        // ✅ FIX-ECC1: corrected paths — were missing /approvals/ prefix
        fetchJson<Payload>("/api/executive/approvals/who-blocking",           signal),
        fetchJson<Payload>("/api/executive/approvals/sla-radar",              signal),
        fetchJson<Payload>("/api/executive/approvals/risk-signals",           signal),
        fetchJson<Payload>("/api/executive/approvals/portfolio",              signal),
        fetchJson<Payload>("/api/executive/approvals/bottlenecks",            signal),
      ]);

      const pa   = settledOrErr(paR,   "Failed to load pending approvals");
      const wb   = settledOrErr(wbR,   "Failed to load who-blocking");
      const sla  = settledOrErr(slaR,  "Failed to load SLA radar");
      const rs   = settledOrErr(rsR,   "Failed to load risk signals");
      const port = settledOrErr(portR, "Failed to load portfolio approvals");
      const bott = settledOrErr(bottR, "Failed to load bottlenecks");

      setPendingApprovals(pa as any);
      setWhoBlocking(wb as any);
      setSlaRadar(sla as any);
      setRiskSignals(rs as any);
      setPortfolioApprovals(port as any);
      setBottlenecks(bott as any);
      setLastRefreshed(new Date().toISOString());

      const allFailed = isErr(pa) && isErr(wb) && isErr(sla) && isErr(rs) && isErr(port) && isErr(bott);
      if (allFailed) setFatalError("All cockpit endpoints failed. Check your API routes.");
    } catch (e: any) {
      if (e?.name !== "AbortError") setFatalError(e?.message ?? "Failed to load executive cockpit");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  function getCount(p: Payload | null): number | null {
    if (!p) return null;
    if (isErr(p)) return null;
    return extractList(p).length;
  }
  function getItems(p: Payload | null, keys?: string[]): any[] {
    if (!p || isErr(p)) return [];
    return extractList(p, keys);
  }
  function getError(p: Payload | null): string | null {
    if (p && isErr(p)) return (p as ApiErr).message ?? (p as ApiErr).error;
    return null;
  }

  const paItems   = getItems(pendingApprovals,   ["items", "pending"]);
  const wbItems   = getItems(whoBlocking,         ["items", "blockers"]);
  const slaItems  = getItems(slaRadar,            ["items", "breaches"]);
  const rsItems   = getItems(riskSignals,          ["items", "signals"]);
  const portItems = getItems(portfolioApprovals);
  const bottItems = getItems(bottlenecks);

  const tiles = [
    {
      id: "pending",
      label: "Pending Approvals",
      icon: <CheckCircle2 className="h-5 w-5" />,
      tone: "emerald" as ToneKey,
      count: getCount(pendingApprovals),
      error: getError(pendingApprovals),
      href: "/approvals",
      body: paItems.length ? <PendingApprovalsBody items={paItems} /> : null,
      scope: (pendingApprovals as any)?.scope,
    },
    {
      id: "blocking",
      label: "Who's Blocking",
      icon: <Users className="h-5 w-5" />,
      tone: "amber" as ToneKey,
      count: getCount(whoBlocking),
      error: getError(whoBlocking),
      href: "/approvals/bottlenecks",
      body: wbItems.length ? <WhoBlockingBody items={wbItems} /> : null,
    },
    {
      id: "sla",
      label: "SLA Radar",
      icon: <Clock3 className="h-5 w-5" />,
      tone: "cyan" as ToneKey,
      count: getCount(slaRadar),
      error: getError(slaRadar),
      href: "/sla",
      body: slaItems.length ? <SlaRadarBody items={slaItems} /> : null,
    },
    {
      id: "risk",
      label: "Risk Signals",
      icon: <AlertTriangle className="h-5 w-5" />,
      tone: "rose" as ToneKey,
      count: getCount(riskSignals),
      error: getError(riskSignals),
      href: "/risks",
      body: rsItems.length ? <RiskSignalsBody items={rsItems} /> : null,
    },
    {
      id: "portfolio",
      label: "Portfolio Approvals",
      icon: <Target className="h-5 w-5" />,
      tone: "indigo" as ToneKey,
      count: getCount(portfolioApprovals),
      error: getError(portfolioApprovals),
      href: "/approvals/portfolio",
      body: portItems.length ? <PortfolioApprovalsBody items={portItems} /> : null,
      scope: (portfolioApprovals as any)?.scope,
    },
    {
      id: "bottlenecks",
      label: "Bottlenecks",
      icon: <Layers className="h-5 w-5" />,
      tone: "slate" as ToneKey,
      count: getCount(bottlenecks),
      error: getError(bottlenecks),
      href: "/approvals/bottlenecks",
      body: bottItems.length ? <BottlenecksBody items={bottItems} /> : null,
    },
  ];

  return (
    <LazyMotion features={domAnimation}>
      <div className="w-full">
        <CockpitHeader loading={loading} onRefresh={() => load()} lastRefreshed={lastRefreshed} />

        <AnimatePresence>
          {fatalError && (
            <m.div
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="mb-6 rounded-2xl border border-rose-200/80 bg-rose-50/82 p-4 flex items-start gap-3"
              style={{ backdropFilter: "blur(10px)" }}
            >
              <AlertTriangle className="h-5 w-5 text-rose-600 mt-0.5 shrink-0" />
              <div>
                <div className="text-sm font-bold text-rose-800 mb-1">Cockpit Error</div>
                <div className="text-sm text-rose-700">{fatalError}</div>
              </div>
            </m.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => <TileSkeleton key={i} delay={i * 0.055} />)
            : tiles.map((tile, i) => (
                <CockpitTile
                  key={tile.id}
                  label={tile.label}
                  count={tile.count}
                  icon={tile.icon}
                  tone={tile.tone}
                  error={tile.error}
                  href={tile.href}
                  delay={i * 0.055}
                >
                  {tile.body}
                  {(tile as any).scope && (
                    <div className="mt-2 text-[10px] text-slate-400 font-medium uppercase tracking-wider">
                      Scope: {(tile as any).scope}
                    </div>
                  )}
                </CockpitTile>
              ))
          }
        </div>

        {!loading && !fatalError && (
          <m.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 }}
            className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/70 bg-white/62 px-5 py-4"
            style={{ backdropFilter: "blur(14px)", boxShadow: "0 1px 4px rgba(0,0,0,0.04), 0 1px 0 rgba(255,255,255,0.9) inset" }}
          >
            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500">
              {tiles.map(t => (
                <div key={t.id} className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${TONES[t.tone].listDot}`} />
                  <span className="font-semibold text-slate-800">{t.count ?? "---"}</span>
                  <span className="font-medium text-[12px]">{t.label.split(" ").pop()}</span>
                </div>
              ))}
            </div>
            <a href="/approvals"
              className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-700 transition-colors uppercase tracking-wider">
              Approvals Centre <ChevronRight className="h-3.5 w-3.5" />
            </a>
          </m.div>
        )}
      </div>
    </LazyMotion>
  );
}