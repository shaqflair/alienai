// src/components/executive/GovernanceIntelligence.tsx — v4 FULL DESIGN
// Matches the HTML mockup exactly:
//   ✅ Hero stats strip (4 cards: Pending / Breaches / At Risk / Active Tracks)
//   ✅ AI Governance Outlook bar with dynamic urgency badge
//   ✅ Portfolio Approval Heatmap — RAG-coloured tiles with heat bar
//   ✅ Process Bottlenecks panel — fill bars, flame indicator
//   ✅ Control Center CTA
//   ✅ Crystal glassmorphism design matching existing card styles

"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ShieldCheck, Users, Layers, ArrowUpRight,
  AlertTriangle, CheckCircle2, Brain, Flame,
  Eye, Activity, Clock3,
} from "lucide-react";
import { LazyMotion, domAnimation, m, AnimatePresence } from "framer-motion";

// ─── TYPES ───────────────────────────────────────────────────────────────────

type Rag = "R" | "A" | "G";

interface UiProject {
  project_id: string;
  project_code: string | null;
  project_title: string | null;
  rag: Rag;
  stage: string | null;
  approver_label: string | null;
  days_waiting: number;
  counts: { ok: number; warn: number; overdue: number; total: number };
}

interface UiBottleneck {
  kind: "user" | "email" | "unknown";
  label: string;
  pending_count: number;
  projects_affected: number;
  avg_wait_days: number;
  max_wait_days: number;
}

// ─── UTILS ───────────────────────────────────────────────────────────────────

function safeStr(x: any) { return typeof x === "string" ? x : x == null ? "" : String(x); }
function safeNum(x: any): number { const n = Number(x); return Number.isFinite(n) ? n : 0; }

function normaliseItem(raw: any) {
  return {
    ...raw,
    _sla_status: safeStr(raw?.sla_status || raw?.sla_state || raw?.state || raw?.rag),
    _hours_to_due: raw?.hours_to_due != null ? safeNum(raw.hours_to_due) : null,
    _hours_overdue: raw?.hours_overdue != null ? safeNum(raw.hours_overdue) : null,
    _approver_label:
      safeStr(raw?.approver_label) || safeStr(raw?.pending_email) ||
      safeStr(raw?.approver_ref) || safeStr(raw?.approver_user_id) ||
      safeStr(raw?.pending_user_id) || "",
    _stage: safeStr(raw?.stage_key) || safeStr(raw?.step_title) || safeStr(raw?.step_name) || "",
    _submitted_at: raw?.submitted_at ?? raw?.created_at ?? null,
  };
}

function toDaysWaiting(item: ReturnType<typeof normaliseItem>): number {
  if (item._hours_overdue != null && item._hours_overdue > 0)
    return Math.max(0, Math.round(item._hours_overdue / 24));
  if (item._submitted_at) {
    const t = new Date(String(item._submitted_at)).getTime();
    if (Number.isFinite(t))
      return Math.max(0, Math.round((Date.now() - t) / (1000 * 60 * 60 * 24)));
  }
  if (item._hours_to_due != null && item._hours_to_due < 0)
    return Math.max(0, Math.round(-item._hours_to_due / 24));
  return 0;
}

function pickSlaState(item: ReturnType<typeof normaliseItem>): "ok" | "warn" | "overdue" {
  const s = safeStr(item._sla_status).toLowerCase().trim();
  if (s === "overdue" || s === "breached" || s === "r") return "overdue";
  if (s === "warn" || s === "at_risk" || s === "a") return "warn";
  if (item._hours_overdue != null && item._hours_overdue > 0) return "overdue";
  return "ok";
}

function pickApproverLabel(item: ReturnType<typeof normaliseItem>): string {
  return item._approver_label || "—";
}

function deriveRag(overdue: number, warn: number): Rag {
  if (overdue > 0) return "R";
  if (warn > 0) return "A";
  return "G";
}

// ─── RAG CONFIG ──────────────────────────────────────────────────────────────

const RAG_CFG = {
  R: {
    label: "RED",
    dot: "#f43f5e",
    badgeCls: "text-rose-800 bg-rose-50/90 border-rose-200/70",
    accentHex: "#f43f5e",
    accentGlow: "rgba(244,63,94,0.4)",
    tileBg: "linear-gradient(135deg,rgba(255,241,242,0.92),rgba(255,255,255,0.82))",
    daysColor: "text-rose-600",
    barHex: "#fb7185",
    barGlow: "0 0 8px rgba(244,63,94,0.4)",
  },
  A: {
    label: "AMBER",
    dot: "#f59e0b",
    badgeCls: "text-amber-800 bg-amber-50/90 border-amber-200/70",
    accentHex: "#f59e0b",
    accentGlow: "rgba(245,158,11,0.35)",
    tileBg: "linear-gradient(135deg,rgba(255,251,235,0.92),rgba(255,255,255,0.82))",
    daysColor: "text-amber-600",
    barHex: "#fbbf24",
    barGlow: undefined,
  },
  G: {
    label: "GREEN",
    dot: "#10b981",
    badgeCls: "text-emerald-800 bg-emerald-50/90 border-emerald-200/70",
    accentHex: "#10b981",
    accentGlow: "rgba(16,185,129,0.3)",
    tileBg: "linear-gradient(135deg,rgba(255,255,255,0.96),rgba(248,250,255,0.88))",
    daysColor: "text-slate-700",
    barHex: "#34d399",
    barGlow: undefined,
  },
} as const;

// ─── HERO STAT CARD ──────────────────────────────────────────────────────────

function HeroStat({
  label, value, sub, accentHex, accentGlow, numColor, delay = 0,
}: {
  label: string; value: string | number; sub?: string;
  accentHex: string; accentGlow: string; numColor?: string; delay?: number;
}) {
  return (
    <m.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.16, 1, 0.3, 1] }}
      className="card relative overflow-hidden rounded-2xl"
      style={{
        background: "linear-gradient(145deg,rgba(255,255,255,0.99),rgba(248,250,255,0.97))",
        border: "1px solid rgba(255,255,255,0.92)",
        boxShadow: "0 1px 1px rgba(0,0,0,0.02),0 4px 8px rgba(0,0,0,0.03),0 12px 32px rgba(99,102,241,0.07),0 0 0 1px rgba(226,232,240,0.65),0 1px 0 rgba(255,255,255,1) inset",
        backdropFilter: "blur(28px) saturate(1.9)",
      }}
    >
      {/* top shine */}
      <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
        style={{ background: "linear-gradient(90deg,transparent,rgba(255,255,255,1) 28%,rgba(255,255,255,1) 72%,transparent)" }} />
      {/* left accent */}
      <div className="absolute left-0 top-[20%] bottom-[20%] w-[3px] rounded-r-full pointer-events-none"
        style={{ background: accentHex, boxShadow: `0 0 12px ${accentGlow}` }} />
      <div className="p-5 pl-[22px]">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 mb-2.5">{label}</div>
        <div className={`font-bold leading-none mb-2 ${numColor || "text-slate-950"}`}
          style={{ fontFamily: "'DM Mono',monospace", fontSize: 42, letterSpacing: "-0.03em" }}>
          {value}
        </div>
        {sub && <div className={`text-[11px] font-medium ${numColor ? numColor.replace("600", "500") : "text-slate-400"}`}>{sub}</div>}
      </div>
    </m.div>
  );
}

// ─── AI OUTLOOK BAR ──────────────────────────────────────────────────────────

function AiOutlook({
  counts, loading,
}: { counts: { pending: number; at_risk: number; breached: number }; loading: boolean }) {
  const urgency =
    counts.breached >= 3 ? "critical" :
    counts.breached > 0 || counts.at_risk >= 3 ? "elevated" :
    counts.at_risk > 0 ? "moderate" : "clear";

  const cfg = {
    critical: {
      bg: "linear-gradient(135deg,rgba(244,63,94,0.06),rgba(255,241,242,0.7))",
      border: "border-rose-200/50",
      dotHex: "#f43f5e",
      badge: "Elevated",
      badgeCls: "bg-rose-100/80 border-rose-200/60 text-rose-800",
      text: `${counts.breached} approval${counts.breached !== 1 ? "s" : ""} breached SLA. Recommend immediate escalation — review bottlenecks and contact approvers directly.`,
    },
    elevated: {
      bg: "linear-gradient(135deg,rgba(245,158,11,0.06),rgba(255,251,235,0.7))",
      border: "border-amber-200/50",
      dotHex: "#f59e0b",
      badge: "Elevated",
      badgeCls: "bg-amber-100/80 border-amber-200/60 text-amber-800",
      text: `${counts.breached > 0 ? `${counts.breached} breached, ` : ""}${counts.at_risk} approaching threshold. Proactive outreach to approvers recommended.`,
    },
    moderate: {
      bg: "linear-gradient(135deg,rgba(6,182,212,0.05),rgba(239,246,255,0.7))",
      border: "border-cyan-200/50",
      dotHex: "#06b6d4",
      badge: "Moderate",
      badgeCls: "bg-cyan-100/80 border-cyan-200/60 text-cyan-800",
      text: `${counts.at_risk} approval${counts.at_risk !== 1 ? "s" : ""} approaching SLA threshold. Monitor closely.`,
    },
    clear: {
      bg: "linear-gradient(135deg,rgba(16,185,129,0.05),rgba(236,253,245,0.7))",
      border: "border-emerald-200/50",
      dotHex: "#10b981",
      badge: "On Track",
      badgeCls: "bg-emerald-100/80 border-emerald-200/60 text-emerald-800",
      text: counts.pending > 0
        ? `${counts.pending} approval${counts.pending !== 1 ? "s" : ""} in queue — all within SLA.`
        : "No approvals pending. Governance flow is clear.",
    },
  }[urgency];

  return (
    <div className={`relative overflow-hidden rounded-2xl border ${cfg.border} mb-5 p-4`}
      style={{ background: cfg.bg, backdropFilter: "blur(16px)" }}>
      <div className="absolute inset-x-0 top-0 h-px"
        style={{ background: "linear-gradient(90deg,transparent,rgba(255,255,255,0.9),transparent)" }} />
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="relative flex h-6 w-6 items-center justify-center rounded-lg bg-white/80 border border-white/60"
            style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
            <Brain className="h-3.5 w-3.5 text-slate-600" />
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border border-white"
              style={{ background: cfg.dotHex }} />
          </div>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">
            AI Governance Outlook
          </span>
        </div>
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-widest ${cfg.badgeCls}`}>
          {cfg.badge}
        </span>
      </div>
      <p className="text-xs text-slate-600 leading-relaxed">
        {loading
          ? <span className="inline-flex gap-1 items-center">
              {[0, 150, 300].map(d => <span key={d} className="h-1 w-1 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
            </span>
          : cfg.text}
      </p>
    </div>
  );
}

// ─── HEAT TILE ───────────────────────────────────────────────────────────────

function HeatTile({ project, index }: { project: UiProject; index: number }) {
  const rc = RAG_CFG[project.rag];
  const total = Math.max(1, project.counts.total);

  return (
    <m.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38, delay: index * 0.055, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-[14px] border border-slate-200/70 hover:-translate-y-px transition-transform duration-200 cursor-default"
      style={{ background: rc.tileBg, backdropFilter: "blur(14px)" }}
    >
      {/* left accent bar */}
      <div className="absolute left-0 top-4 bottom-4 w-[3px] rounded-r-sm pointer-events-none"
        style={{ background: rc.accentHex, boxShadow: `0 0 10px ${rc.accentGlow}` }} />

      <div className="p-[14px] pl-[22px]">
        {/* badges */}
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${rc.badgeCls}`}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: rc.dot }} />
            {rc.label}
          </span>
          {project.project_code && (
            <span className="font-mono text-[9px] font-bold rounded-md border border-indigo-200/60 bg-indigo-50/80 px-1.5 py-0.5 text-indigo-700"
              style={{ fontFamily: "'DM Mono',monospace" }}>
              {project.project_code}
            </span>
          )}
        </div>

        {/* title + days */}
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="min-w-0">
            <div className="text-[13px] font-bold text-slate-900 leading-tight truncate">
              {project.project_title || "Project"}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5 truncate">
              {[project.stage, project.approver_label && project.approver_label !== "—" ? `by ${project.approver_label}` : null]
                .filter(Boolean).join(" · ")}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className={`text-base font-bold leading-tight ${rc.daysColor}`}
              style={{ fontFamily: "'DM Mono',monospace" }}>
              {project.days_waiting}d
            </div>
            <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wide">waiting</div>
          </div>
        </div>

        {/* count row */}
        <div className="flex items-center justify-between mt-2">
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
            {project.counts.total} item{project.counts.total !== 1 ? "s" : ""}
          </span>
          <div className="flex items-center gap-2 text-[9px] font-bold">
            {project.counts.overdue > 0 && <span className="text-rose-600">{project.counts.overdue} overdue</span>}
            {project.counts.warn > 0 && <span className="text-amber-600">{project.counts.warn} at risk</span>}
            {project.counts.ok > 0 && <span className="text-emerald-600">{project.counts.ok} ok</span>}
          </div>
        </div>

        {/* heat bar */}
        <div className="mt-2 h-[5px] w-full rounded-full overflow-hidden flex bg-slate-100/80">
          {project.counts.overdue > 0 && (
            <m.div
              initial={{ width: 0 }}
              animate={{ width: `${(project.counts.overdue / total) * 100}%` }}
              transition={{ duration: 0.8, delay: index * 0.055 + 0.2 }}
              className="h-full rounded-l-full"
              style={{ background: rc.barHex, boxShadow: rc.barGlow }}
            />
          )}
          {project.counts.warn > 0 && (
            <m.div
              initial={{ width: 0 }}
              animate={{ width: `${(project.counts.warn / total) * 100}%` }}
              transition={{ duration: 0.8, delay: index * 0.055 + 0.3 }}
              className="h-full bg-amber-400"
            />
          )}
          {project.counts.ok > 0 && (
            <m.div
              initial={{ width: 0 }}
              animate={{ width: `${(project.counts.ok / total) * 100}%` }}
              transition={{ duration: 0.8, delay: index * 0.055 + 0.4 }}
              className="h-full bg-emerald-400 rounded-r-full"
            />
          )}
        </div>
      </div>
    </m.div>
  );
}

// ─── BOTTLENECK TILE ─────────────────────────────────────────────────────────

function BottleneckTile({
  bottleneck, maxCount, index,
}: { bottleneck: UiBottleneck; maxCount: number; index: number }) {
  const widthPct = maxCount > 0 ? Math.max(8, (bottleneck.pending_count / maxCount) * 100) : 8;
  const heat = bottleneck.max_wait_days > 14 ? "high" : bottleneck.max_wait_days > 7 ? "medium" : "low";

  const styles = {
    high:   { cls: "border-rose-300/70 bg-rose-50/88",   fill: "#f43f5e", wait: "text-rose-600" },
    medium: { cls: "border-amber-200/70 bg-amber-50/88", fill: "#f59e0b", wait: "text-amber-600" },
    low:    { cls: "border-slate-200/70 bg-slate-50/88", fill: "#6366f1", wait: "text-indigo-600" },
  }[heat];

  return (
    <m.div
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, delay: index * 0.07, ease: [0.16, 1, 0.3, 1] }}
      className={`relative overflow-hidden rounded-[14px] border ${styles.cls} transition-transform duration-200 hover:translate-x-0.5`}
    >
      {/* heat fill */}
      <m.div
        initial={{ width: 0 }}
        animate={{ width: `${widthPct}%` }}
        transition={{ duration: 0.9, delay: index * 0.07 + 0.15, ease: [0.34, 1.56, 0.64, 1] }}
        className="absolute left-0 top-0 bottom-0 rounded-[14px] pointer-events-none opacity-[0.07]"
        style={{ background: styles.fill }}
      />

      <div className="relative px-[14px] py-3">
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="h-[30px] w-[30px] shrink-0 flex items-center justify-center rounded-[10px] bg-white/80 border border-slate-200/70"
              style={{ backdropFilter: "blur(8px)", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
              {bottleneck.kind === "user"
                ? <Users className="h-3.5 w-3.5 text-slate-600" />
                : <Layers className="h-3.5 w-3.5 text-slate-600" />}
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-bold text-slate-900 truncate leading-tight">
                {bottleneck.label}
              </div>
              <div className="text-[10px] text-slate-400 font-medium mt-0.5">
                {bottleneck.pending_count} item{bottleneck.pending_count !== 1 ? "s" : ""} · {bottleneck.projects_affected} project{bottleneck.projects_affected !== 1 ? "s" : ""}
              </div>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className={`text-[13px] font-bold ${styles.wait}`}
              style={{ fontFamily: "'DM Mono',monospace" }}>
              {bottleneck.avg_wait_days}d
            </div>
            <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wide">avg wait</div>
          </div>
        </div>

        {heat === "high" && (
          <div className="flex items-center gap-1 mt-2 text-[10px] font-semibold text-rose-600">
            <Flame className="h-3 w-3" />
            Max wait: {bottleneck.max_wait_days}d
          </div>
        )}
      </div>
    </m.div>
  );
}

// ─── SKELETON ────────────────────────────────────────────────────────────────

function SkeletonTile({ h = 108 }: { h?: number }) {
  return <div className="rounded-[14px] bg-slate-100/70 animate-pulse" style={{ height: h }} />;
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function GovernanceIntelligence({
  days = 30,
  approvalItems: parentItems,
}: {
  days?: 7 | 14 | 30 | 60;
  approvalItems?: any[];
}) {
  const [resp, setResp] = useState<any>(null);
  const loading = !resp;

  useEffect(() => {
    if (parentItems !== undefined) { setResp({ ok: true, items: parentItems }); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/executive/approvals/pending?limit=200&days=${days}`, {
          cache: "no-store", credentials: "include",
          headers: { Accept: "application/json", "Cache-Control": "no-store, no-cache" },
        });
        const json = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (json?.ok === false) { setResp({ ok: false, error: json.error || "Failed" }); return; }
        setResp({ ok: true, items: Array.isArray(json?.items) ? json.items : [] });
      } catch {
        if (!cancelled) setResp({ ok: false, error: "Failed to load" });
      }
    })();
    return () => { cancelled = true; };
  }, [days, parentItems]);

  const items = useMemo(() => {
    if (!resp?.ok) return [];
    return (resp.items || []).map(normaliseItem);
  }, [resp]);

  const counts = useMemo(() => {
    let ok = 0, warn = 0, overdue = 0;
    for (const it of items) {
      const s = pickSlaState(it);
      if (s === "overdue") overdue++; else if (s === "warn") warn++; else ok++;
    }
    return { waiting: ok, at_risk: warn, breached: overdue, pending: ok + warn + overdue };
  }, [items]);

  const projects: UiProject[] = useMemo(() => {
    const map = new Map<string, UiProject>();
    for (const it of items) {
      const pid = safeStr(it?.project_id); if (!pid) continue;
      const state = pickSlaState(it);
      const age = toDaysWaiting(it);
      let p = map.get(pid);
      if (!p) {
        p = { project_id: pid, project_code: it?.project_code ?? null, project_title: it?.project_title ?? null,
          rag: "G", stage: it._stage || null, approver_label: pickApproverLabel(it), days_waiting: age,
          counts: { ok: 0, warn: 0, overdue: 0, total: 0 } };
        map.set(pid, p);
      }
      p.counts.total++;
      if (state === "overdue") p.counts.overdue++;
      else if (state === "warn") p.counts.warn++;
      else p.counts.ok++;
      p.days_waiting = Math.max(p.days_waiting, age);
      if (!p.approver_label || p.approver_label === "—") p.approver_label = pickApproverLabel(it);
      if (!p.stage) p.stage = it._stage || null;
    }
    return Array.from(map.values())
      .map(p => ({ ...p, rag: deriveRag(p.counts.overdue, p.counts.warn) }))
      .sort((a, b) => {
        const aw = a.counts.overdue > 0 ? 2 : a.counts.warn > 0 ? 1 : 0;
        const bw = b.counts.overdue > 0 ? 2 : b.counts.warn > 0 ? 1 : 0;
        return bw !== aw ? bw - aw : b.days_waiting - a.days_waiting;
      });
  }, [items]);

  const bottlenecks: UiBottleneck[] = useMemo(() => {
    const map = new Map<string, { kind: UiBottleneck["kind"]; label: string; ages: number[]; projects: Set<string>; count: number }>();
    for (const it of items) {
      const label = pickApproverLabel(it); if (label === "—") continue;
      const kind: UiBottleneck["kind"] = it?.approver_type === "user" ? "user" : it?.approver_type === "email" ? "email" : "unknown";
      const key = `${kind}::${label}`;
      const age = toDaysWaiting(it);
      const pid = safeStr(it?.project_id);
      let b = map.get(key);
      if (!b) { b = { kind, label, ages: [], projects: new Set(), count: 0 }; map.set(key, b); }
      b.count++; b.ages.push(age); if (pid) b.projects.add(pid);
    }
    return Array.from(map.values())
      .map(x => ({
        kind: x.kind, label: x.label, pending_count: x.count,
        projects_affected: x.projects.size,
        avg_wait_days: Math.round((x.ages.reduce((a, n) => a + n, 0) / (x.ages.length || 1)) * 10) / 10,
        max_wait_days: x.ages.length ? Math.max(...x.ages) : 0,
      }))
      .sort((a, b) => b.pending_count !== a.pending_count ? b.pending_count - a.pending_count : b.max_wait_days - a.max_wait_days);
  }, [items]);

  const maxBnCount = bottlenecks.length ? Math.max(...bottlenecks.map(b => b.pending_count)) : 1;
  const error = resp?.ok === false ? resp.error : null;
  const dayLabel = `${days}d`;

  return (
    <LazyMotion features={domAnimation}>
      {/* ── HERO STATS STRIP ──────────────────────────────────────── */}
      {!loading && counts.pending > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
          <HeroStat
            label="Pending Approvals" value={counts.pending}
            sub={`↑ ${counts.pending} in queue`}
            accentHex="#6366f1" accentGlow="rgba(99,102,241,0.4)" delay={0}
          />
          <HeroStat
            label="SLA Breaches" value={counts.breached}
            sub={counts.breached > 0 ? "🔴 Immediate action" : "All within SLA"}
            accentHex="#f43f5e" accentGlow="rgba(244,63,94,0.35)"
            numColor={counts.breached > 0 ? "text-rose-600" : undefined} delay={0.06}
          />
          <HeroStat
            label="At Risk" value={counts.at_risk}
            sub={counts.at_risk > 0 ? "⚠ Monitor closely" : "None at risk"}
            accentHex="#f59e0b" accentGlow="rgba(245,158,11,0.35)"
            numColor={counts.at_risk > 0 ? "text-amber-600" : undefined} delay={0.12}
          />
          <HeroStat
            label="Active Tracks" value={projects.length}
            sub={projects.slice(0, 2).map(p => p.project_code || p.project_title?.split(" ")[0] || "—").join(", ") || "—"}
            accentHex="#10b981" accentGlow="rgba(16,185,129,0.35)"
            numColor="text-emerald-600" delay={0.18}
          />
        </div>
      )}

      {/* ── GOVERNANCE INTELLIGENCE CARD ─────────────────────────── */}
      <m.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        className="relative overflow-hidden rounded-2xl"
        style={{
          background: "linear-gradient(145deg,rgba(255,255,255,0.99) 0%,rgba(248,250,255,0.97) 55%,rgba(243,246,255,0.95) 100%)",
          border: "1px solid rgba(255,255,255,0.92)",
          boxShadow: "0 1px 1px rgba(0,0,0,0.02),0 4px 8px rgba(0,0,0,0.03),0 12px 32px rgba(99,102,241,0.07),0 40px 80px rgba(99,102,241,0.04),0 0 0 1px rgba(226,232,240,0.65),0 1px 0 rgba(255,255,255,1) inset",
          backdropFilter: "blur(28px) saturate(1.9)",
        }}
      >
        {/* crystal overlays */}
        <div className="absolute inset-0 rounded-2xl pointer-events-none"
          style={{ background: "linear-gradient(135deg,rgba(255,255,255,0.65) 0%,transparent 52%,rgba(255,255,255,0.12) 100%)" }} />
        <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
          style={{ background: "linear-gradient(90deg,transparent,rgba(255,255,255,1) 28%,rgba(255,255,255,1) 72%,transparent)" }} />
        <div className="absolute -bottom-20 -right-20 w-64 h-64 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(ellipse,rgba(99,102,241,0.055) 0%,transparent 65%)", filter: "blur(2px)" }} />

        <div className="relative p-6">
          {/* ── Card Header ── */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl text-white text-lg"
                style={{ background: "linear-gradient(135deg,#6366f1,#4f46e5)", boxShadow: "0 4px 16px rgba(99,102,241,0.38),0 1px 0 rgba(255,255,255,0.22) inset" }}>
                🛡
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-indigo-600 mb-0.5">
                  Governance Intelligence
                </div>
                <h2 className="text-[17px] font-bold text-slate-950 leading-tight"
                  style={{ fontFamily: "'Syne','Inter',sans-serif", fontWeight: 800 }}>
                  Approvals — Portfolio Control
                </h2>
              </div>
            </div>

            {/* status pills */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/72 px-3 py-1.5 text-[11px] font-bold text-slate-600"
                style={{ backdropFilter: "blur(10px)" }}>
                <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                {loading ? "—" : `${counts.pending} waiting`}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200/60 bg-amber-50/82 px-3 py-1.5 text-[11px] font-bold text-amber-800">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                {loading ? "—" : `${counts.at_risk} at risk`}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200/60 bg-rose-50/82 px-3 py-1.5 text-[11px] font-bold text-rose-800">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
                {loading ? "—" : `${counts.breached} breached`}
              </span>
              <span className="inline-flex items-center rounded-full border border-slate-200/60 bg-slate-100/60 px-2.5 py-1.5 text-[10px] font-semibold text-slate-500">
                {dayLabel}
              </span>
            </div>
          </div>

          {/* error */}
          {error && (
            <div className="mb-4 rounded-2xl border border-rose-200/70 bg-rose-50/72 px-4 py-3 text-sm text-rose-700">
              <AlertTriangle className="inline h-4 w-4 mr-2 -mt-0.5" />{error}
            </div>
          )}

          {/* AI Outlook */}
          <AiOutlook counts={counts} loading={loading} />

          {/* ── Main Two-Column Grid ── */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5">

            {/* LEFT: Heatmap */}
            <div>
              {/* sub-header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="h-[10px] w-[3px] rounded-full bg-indigo-500"
                    style={{ boxShadow: "0 0 8px rgba(99,102,241,0.5)" }} />
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                    Portfolio Approval Heatmap
                  </span>
                </div>
                {!loading && projects.length > 0 && (
                  <span className="text-[10px] text-slate-400 font-medium">
                    {projects.length} stalled track{projects.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {[1,2,3,4].map(i => <SkeletonTile key={i} />)}
                </div>
              ) : projects.length === 0 ? (
                <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="rounded-2xl border border-dashed border-slate-200/80 bg-white/40 px-6 py-14 text-center"
                  style={{ backdropFilter: "blur(10px)" }}>
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50/80 border border-emerald-200/60"
                    style={{ boxShadow: "0 4px 16px rgba(16,185,129,0.15)" }}>
                    <CheckCircle2 className="h-7 w-7 text-emerald-500" />
                  </div>
                  <div className="text-sm font-bold text-slate-700">No stalled approvals</div>
                  <div className="text-xs text-slate-400 mt-1.5 uppercase tracking-wider font-medium">
                    Portfolio flow is clear
                  </div>
                </m.div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {projects.slice(0, 8).map((p, i) => (
                    <HeatTile key={`${p.project_id}-${i}`} project={p} index={i} />
                  ))}
                </div>
              )}

              {projects.length > 8 && (
                <p className="mt-3 text-[11px] text-slate-400 italic">
                  +{projects.length - 8} more stalled tracks not shown
                </p>
              )}
            </div>

            {/* RIGHT: Bottlenecks */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="h-[10px] w-[3px] rounded-full bg-rose-500"
                  style={{ boxShadow: "0 0 6px rgba(244,63,94,0.4)" }} />
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                  Process Bottlenecks
                </span>
              </div>

              {loading ? (
                <div className="space-y-2">
                  {[1,2,3].map(i => <SkeletonTile key={i} h={64} />)}
                </div>
              ) : bottlenecks.length === 0 ? (
                <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="rounded-2xl border border-dashed border-slate-200/80 bg-white/40 px-5 py-10 text-center"
                  style={{ backdropFilter: "blur(10px)" }}>
                  <Activity className="h-6 w-6 text-slate-300 mx-auto mb-2" />
                  <div className="text-sm font-semibold text-slate-600">No congestion</div>
                  <div className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider">
                    Approvals flowing freely
                  </div>
                </m.div>
              ) : (
                <div className="space-y-2">
                  {bottlenecks.slice(0, 6).map((b, i) => (
                    <BottleneckTile key={`${b.label}-${i}`} bottleneck={b} maxCount={maxBnCount} index={i} />
                  ))}
                </div>
              )}

              {/* CTA */}
              <m.a
                href="/approvals"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="group mt-[18px] inline-flex items-center gap-2 rounded-xl border border-indigo-200/60 bg-indigo-50/60 px-4 py-2.5 text-[11px] font-bold text-indigo-700 hover:bg-indigo-50/90 transition-all"
                style={{ backdropFilter: "blur(8px)", boxShadow: "0 1px 4px rgba(99,102,241,0.10)" }}
              >
                <Eye className="h-3.5 w-3.5" />
                Control Center
                <ArrowUpRight className="h-3 w-3 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </m.a>
            </div>
          </div>
        </div>
      </m.div>
    </LazyMotion>
  );
}