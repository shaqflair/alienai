// src/components/executive/GovernanceIntelligence.tsx — REBUILT v3
// Fixes applied on top of v2:
//   ✅ FIX-GI1: Field names corrected to match exec_approval_cache schema
//              sla_state       → sla_status
//              age_hours       → hours_to_due ?? hours_overdue
//              pending_email   → approver_label
//              pending_user_id → approver_user_id
//   ✅ FIX-GI2: normaliseItem() helper centralises all field mapping —
//              works for both exec_approval_cache rows (full) and
//              approval_steps direct fallback rows (sparse)
//   ✅ FIX-GI3: toDaysWaiting() uses hours_to_due / hours_overdue correctly —
//              hours_to_due is positive when not yet due (time remaining)
//              hours_overdue is positive when past due (time elapsed since due)
//              age = hours_overdue when overdue, else submitted_at age

"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ShieldCheck, Users, Layers, ArrowUpRight, AlertTriangle,
  Clock3, CheckCircle2, Zap, TrendingUp, Activity, Brain,
  ChevronRight, Target, Eye, Flame,
} from "lucide-react";
import { LazyMotion, domAnimation, m, AnimatePresence } from "framer-motion";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type Rag = "G" | "A" | "R";

type PendingApprovalsResp =
  | { ok: false; error: string }
  | {
      ok?: true;
      scope?: "org" | "member";
      orgId?: string;
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

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function safeNum(x: any): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/**
 * ✅ FIX-GI2: Central field normaliser.
 * Maps exec_approval_cache column names (and sparse approval_steps fallback)
 * to a consistent shape used throughout this component.
 *
 * exec_approval_cache columns  →  normalised name used below
 * ──────────────────────────────────────────────────────────
 * sla_status                   →  _sla_status
 * hours_to_due                 →  _hours_to_due
 * hours_overdue                →  _hours_overdue
 * approver_label               →  _approver_label
 * approver_user_id             →  _approver_user_id
 * stage_key                    →  _stage   (primary)
 * step_title                   →  _stage   (fallback)
 * project_code                 →  project_code  ✅ already matches
 * project_title                →  project_title ✅ already matches
 * submitted_at                 →  _submitted_at
 */
function normaliseItem(raw: any) {
  return {
    ...raw,
    // ✅ FIX-GI1: sla_state → sla_status
    _sla_status: safeStr(raw?.sla_status || raw?.sla_state || raw?.state || raw?.rag),
    // ✅ FIX-GI1: hours_to_due / hours_overdue (replaces age_hours)
    _hours_to_due: raw?.hours_to_due != null ? safeNum(raw.hours_to_due) : null,
    _hours_overdue: raw?.hours_overdue != null ? safeNum(raw.hours_overdue) : null,
    // ✅ FIX-GI1: approver_label (replaces pending_email)
    _approver_label:
      safeStr(raw?.approver_label) ||
      safeStr(raw?.pending_email) ||
      safeStr(raw?.approver_ref) ||
      safeStr(raw?.approver_user_id) ||
      safeStr(raw?.pending_user_id) ||
      "",
    // ✅ FIX-GI1: approver_user_id (replaces pending_user_id)
    _approver_user_id:
      safeStr(raw?.approver_user_id) ||
      safeStr(raw?.pending_user_id) ||
      "",
    // stage — stage_key is primary in cache, step_name / step_title as fallbacks
    _stage:
      safeStr(raw?.stage_key) ||
      safeStr(raw?.step_title) ||
      safeStr(raw?.step_name) ||
      "",
    // submitted_at for age calculation when hours fields are absent
    _submitted_at: raw?.submitted_at ?? raw?.created_at ?? null,
  };
}

/**
 * ✅ FIX-GI3: Derive days waiting from normalised item.
 *
 * exec_approval_cache semantics:
 *   hours_overdue > 0  → item is past its due_at  → use hours_overdue for age
 *   hours_to_due  > 0  → item is not yet due       → use submitted_at elapsed time instead
 *
 * Fallback: compute elapsed days from submitted_at if both hour fields are null
 * (sparse approval_steps direct rows).
 */
function toDaysWaiting(item: ReturnType<typeof normaliseItem>): number {
  // Overdue: use overdue hours directly
  if (item._hours_overdue != null && item._hours_overdue > 0) {
    return Math.max(0, Math.round(item._hours_overdue / 24));
  }
  // Not yet due but we have submitted_at: compute elapsed from submission
  if (item._submitted_at) {
    const submitted = new Date(String(item._submitted_at)).getTime();
    if (Number.isFinite(submitted)) {
      const elapsedHours = (Date.now() - submitted) / (1000 * 60 * 60);
      return Math.max(0, Math.round(elapsedHours / 24));
    }
  }
  // Last resort: hours_to_due is negative when overdue in some schemas
  if (item._hours_to_due != null && item._hours_to_due < 0) {
    return Math.max(0, Math.round(-item._hours_to_due / 24));
  }
  return 0;
}

/**
 * ✅ FIX-GI1: pickSlaState now reads _sla_status (normalised field).
 * exec_approval_cache sla_status values: 'ok' | 'warn' | 'overdue' | 'breached' | 'unknown'
 */
function pickSlaState(item: ReturnType<typeof normaliseItem>): "ok" | "warn" | "overdue" {
  const s = safeStr(item._sla_status).toLowerCase().trim();
  if (s === "overdue" || s === "breached" || s === "r") return "overdue";
  if (s === "warn" || s === "at_risk" || s === "a") return "warn";
  // If hours_overdue is set and positive → treat as overdue regardless of sla_status label
  if (item._hours_overdue != null && item._hours_overdue > 0) return "overdue";
  return "ok";
}

/**
 * ✅ FIX-GI1: pickApproverLabel now reads _approver_label (normalised field).
 */
function pickApproverLabel(item: ReturnType<typeof normaliseItem>): string {
  return item._approver_label || "—";
}

function deriveRag(overdue: number, warn: number): Rag {
  if (overdue > 0) return "R";
  if (warn > 0) return "A";
  return "G";
}

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS — RAG
// ─────────────────────────────────────────────────────────────────────────────

function ragConfig(r: Rag) {
  if (r === "G") return {
    badge: "border-emerald-300/80 bg-emerald-50/90 text-emerald-700",
    bar:   "bg-emerald-400",
    glow:  "rgba(16,185,129,0.22)",
    label: "GREEN",
    dot:   "#10b981",
  };
  if (r === "A") return {
    badge: "border-amber-300/80 bg-amber-50/90 text-amber-700",
    bar:   "bg-amber-400",
    glow:  "rgba(245,158,11,0.22)",
    label: "AMBER",
    dot:   "#f59e0b",
  };
  return {
    badge: "border-rose-300/80 bg-rose-50/90 text-rose-700",
    bar:   "bg-rose-400",
    glow:  "rgba(244,63,94,0.22)",
    label: "RED",
    dot:   "#f43f5e",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SKELETON — matches final card layout to prevent CLS
// ─────────────────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="h-full animate-pulse space-y-3">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="h-20 rounded-2xl bg-slate-100/70" />
      ))}
    </div>
  );
}
function SkeletonBottleneck() {
  return (
    <div className="animate-pulse space-y-2.5">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-16 rounded-2xl bg-slate-100/70" />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROJECT HEAT TILE — severity-weighted visual heat bar
// ─────────────────────────────────────────────────────────────────────────────

function ProjectHeatTile({ project, index }: { project: UiProject; index: number }) {
  const rc = ragConfig(project.rag);
  const total = Math.max(1, project.counts.total);
  const overdueW = (project.counts.overdue / total) * 100;
  const warnW    = (project.counts.warn    / total) * 100;
  const okW      = (project.counts.ok      / total) * 100;

  const heatScore = (project.counts.overdue * 3 + project.counts.warn * 1.5) / total;
  const cardBg = heatScore >= 2
    ? "linear-gradient(135deg, rgba(255,241,242,0.92) 0%, rgba(255,255,255,0.82) 100%)"
    : heatScore >= 0.8
    ? "linear-gradient(135deg, rgba(255,251,235,0.92) 0%, rgba(255,255,255,0.82) 100%)"
    : "linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(248,250,255,0.88) 100%)";

  return (
    <m.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38, delay: index * 0.055, ease: [0.16, 1, 0.3, 1] }}
      className="group relative overflow-hidden rounded-2xl border border-slate-200/70 p-4 hover:border-slate-300/80 transition-all duration-300"
      style={{
        background: cardBg,
        backdropFilter: "blur(14px)",
        boxShadow: `0 1px 3px rgba(0,0,0,0.04), 0 4px 12px ${rc.glow}, 0 1px 0 rgba(255,255,255,0.9) inset`,
      }}
    >
      <div className="absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.95), transparent)" }} />
      <div className={`absolute left-0 top-4 bottom-4 w-[3px] rounded-r-full ${rc.bar}`}
        style={{ boxShadow: `0 0 10px ${rc.glow}` }} />

      <div className="pl-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-bold tracking-widest uppercase ${rc.badge}`}
                style={{ backdropFilter: "blur(8px)" }}>
                <span className="h-1.5 w-1.5 rounded-full mr-1.5" style={{ background: rc.dot }} />
                {rc.label}
              </span>
              {project.project_code && (
                <span className="inline-flex items-center rounded-md border border-indigo-200/60 bg-indigo-50/80 px-2 py-0.5 text-[9px] font-bold text-indigo-700 uppercase tracking-wider"
                  style={{ fontFamily: "var(--font-mono, monospace)", backdropFilter: "blur(4px)" }}>
                  {project.project_code}
                </span>
              )}
            </div>
            <div className="font-bold text-sm text-slate-900 truncate group-hover:text-indigo-700 transition-colors">
              {project.project_title || "Project"}
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-500">
              <span className="font-semibold text-slate-700">{project.stage || "Pending approval"}</span>
              <span className="text-slate-300">·</span>
              <span className="text-slate-400 text-[10px]">by</span>
              <span className="font-semibold text-slate-600 truncate max-w-[100px]">{project.approver_label || "—"}</span>
            </div>
          </div>

          <div className="shrink-0 text-right">
            <div className={`text-base font-bold ${project.counts.overdue > 0 ? "text-rose-600" : project.counts.warn > 0 ? "text-amber-600" : "text-slate-700"}`}
              style={{ fontFamily: "var(--font-mono, monospace)" }}>
              {project.days_waiting}d
            </div>
            <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wide">waiting</div>
          </div>
        </div>

        <div className="mt-3">
          <div className="flex items-center justify-between mb-1.5 text-[9px] text-slate-400 font-bold uppercase tracking-widest">
            <span>{project.counts.total} item{project.counts.total !== 1 ? "s" : ""}</span>
            <div className="flex items-center gap-2">
              {project.counts.overdue > 0 && <span className="text-rose-500">{project.counts.overdue} overdue</span>}
              {project.counts.warn    > 0 && <span className="text-amber-500">{project.counts.warn} at risk</span>}
              {project.counts.ok      > 0 && <span className="text-emerald-500">{project.counts.ok} ok</span>}
            </div>
          </div>
          <div className="h-1.5 w-full rounded-full overflow-hidden flex bg-slate-100/80">
            {project.counts.overdue > 0 && (
              <m.div initial={{ width: 0 }} animate={{ width: `${overdueW}%` }} transition={{ duration: 0.8, delay: index * 0.055 + 0.2 }}
                className="h-full bg-rose-400 rounded-l-full" style={{ boxShadow: "0 0 6px rgba(244,63,94,0.4)" }} />
            )}
            {project.counts.warn > 0 && (
              <m.div initial={{ width: 0 }} animate={{ width: `${warnW}%` }} transition={{ duration: 0.8, delay: index * 0.055 + 0.3 }}
                className="h-full bg-amber-400" />
            )}
            {project.counts.ok > 0 && (
              <m.div initial={{ width: 0 }} animate={{ width: `${okW}%` }} transition={{ duration: 0.8, delay: index * 0.055 + 0.4 }}
                className="h-full bg-emerald-400 rounded-r-full" />
            )}
          </div>
        </div>
      </div>
    </m.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BOTTLENECK TILE — heat gradient + trend bar
// ─────────────────────────────────────────────────────────────────────────────

function BottleneckTile({ bottleneck, maxCount, index }: {
  bottleneck: UiBottleneck;
  maxCount: number;
  index: number;
}) {
  const widthPct = maxCount > 0 ? Math.max(8, (bottleneck.pending_count / maxCount) * 100) : 8;
  const heatLevel = bottleneck.max_wait_days > 14 ? "high" : bottleneck.max_wait_days > 7 ? "medium" : "low";
  const heatCfg = {
    high:   { bg: "rgba(255,241,242,0.88)", border: "border-rose-200/70",   bar: "#f43f5e", text: "text-rose-600",  glow: "rgba(244,63,94,0.12)" },
    medium: { bg: "rgba(255,251,235,0.88)", border: "border-amber-200/70",  bar: "#f59e0b", text: "text-amber-600", glow: "rgba(245,158,11,0.10)" },
    low:    { bg: "rgba(248,250,255,0.88)", border: "border-slate-200/70",  bar: "#6366f1", text: "text-indigo-600", glow: "rgba(99,102,241,0.08)" },
  }[heatLevel];

  return (
    <m.div
      initial={{ opacity: 0, x: 14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.38, delay: index * 0.07, ease: [0.16, 1, 0.3, 1] }}
      className={`relative overflow-hidden rounded-2xl border ${heatCfg.border} p-3.5`}
      style={{
        background: heatCfg.bg,
        backdropFilter: "blur(14px)",
        boxShadow: `0 1px 3px rgba(0,0,0,0.04), 0 4px 12px ${heatCfg.glow}, 0 1px 0 rgba(255,255,255,0.88) inset`,
      }}
    >
      <div className="absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.92), transparent)" }} />
      <m.div
        initial={{ width: 0 }}
        animate={{ width: `${widthPct}%` }}
        transition={{ duration: 0.9, delay: index * 0.07 + 0.15, ease: [0.34, 1.56, 0.64, 1] }}
        className="absolute left-0 top-0 bottom-0 rounded-l-2xl pointer-events-none opacity-[0.07]"
        style={{ background: heatCfg.bar }}
      />

      <div className="relative flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-200/70 bg-white/80"
            style={{ backdropFilter: "blur(8px)", boxShadow: "0 1px 4px rgba(0,0,0,0.06), 0 1px 0 rgba(255,255,255,0.9) inset" }}>
            {bottleneck.kind === "user"
              ? <Users className="h-3.5 w-3.5 text-slate-600" />
              : <Layers className="h-3.5 w-3.5 text-slate-600" />
            }
          </div>
          <div className="min-w-0">
            <div className="font-bold text-sm text-slate-900 truncate leading-tight">
              {bottleneck.label}
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400 font-medium">
              <span>{bottleneck.pending_count} item{bottleneck.pending_count !== 1 ? "s" : ""}</span>
              <span className="text-slate-200">·</span>
              <span>{bottleneck.projects_affected} project{bottleneck.projects_affected !== 1 ? "s" : ""}</span>
            </div>
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className={`text-sm font-bold ${heatCfg.text}`} style={{ fontFamily: "var(--font-mono, monospace)" }}>
            {bottleneck.avg_wait_days}d
          </div>
          <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wide">avg wait</div>
        </div>
      </div>

      {heatLevel === "high" && (
        <div className="relative mt-2 flex items-center gap-1.5 text-[10px] text-rose-600 font-semibold">
          <Flame className="h-3 w-3" />
          <span>Max wait: {bottleneck.max_wait_days}d</span>
        </div>
      )}
    </m.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI RISK SUMMARY PILL
// ─────────────────────────────────────────────────────────────────────────────

function AiRiskSummary({ counts, loading }: {
  counts: { pending: number; at_risk: number; breached: number; waiting: number };
  loading: boolean;
}) {
  const urgency = counts.breached >= 3 ? "critical"
    : counts.breached > 0 || counts.at_risk >= 3 ? "elevated"
    : counts.at_risk > 0 ? "moderate"
    : "clear";

  const cfg = {
    critical: { bg: "from-rose-50/80 to-red-50/60",   border: "border-rose-200/60",   dot: "#f43f5e", label: "Critical", lc: "text-rose-700 bg-rose-100 border-rose-200",   narrative: `${counts.breached} approval${counts.breached !== 1 ? "s" : ""} have breached SLA. Immediate escalation required.` },
    elevated: { bg: "from-amber-50/80 to-orange-50/60", border: "border-amber-200/60", dot: "#f59e0b", label: "Elevated", lc: "text-amber-700 bg-amber-100 border-amber-200", narrative: `${counts.breached > 0 ? `${counts.breached} breached, ` : ""}${counts.at_risk} at risk. Proactive outreach to approvers recommended.` },
    moderate: { bg: "from-cyan-50/60 to-blue-50/40",   border: "border-cyan-200/60",   dot: "#06b6d4", label: "Moderate", lc: "text-cyan-700 bg-cyan-100 border-cyan-200",   narrative: `${counts.at_risk} approval${counts.at_risk !== 1 ? "s" : ""} approaching SLA threshold. Monitor closely.` },
    clear:    { bg: "from-emerald-50/60 to-teal-50/40", border: "border-emerald-200/60", dot: "#10b981", label: "On Track", lc: "text-emerald-700 bg-emerald-100 border-emerald-200", narrative: counts.pending > 0 ? `${counts.pending} approval${counts.pending !== 1 ? "s" : ""} in queue — all within SLA.` : "No approvals pending. Governance flow is clear." },
  }[urgency];

  return (
    <div className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br ${cfg.bg} ${cfg.border} p-4 mb-5`}
      style={{ backdropFilter: "blur(16px)" }}>
      <div className="absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)" }} />
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="relative flex h-6 w-6 items-center justify-center rounded-lg bg-white/80 border border-white/60 shadow-sm">
            <Brain className="h-3.5 w-3.5 text-slate-600" />
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border border-white" style={{ background: cfg.dot }} />
          </div>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">AI Governance Outlook</span>
        </div>
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${cfg.lc}`}>
          {cfg.label}
        </span>
      </div>
      <p className="text-xs text-slate-600 leading-relaxed">
        {loading
          ? <span className="inline-flex gap-1 items-center">{[0,150,300].map(d => <span key={d} className="h-1 w-1 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: `${d}ms` }} />)}</span>
          : cfg.narrative
        }
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function GovernanceIntelligence({
  days = 30,
  approvalItems: parentItems,
}: {
  days?: 7 | 14 | 30 | 60;
  /** Accept items from parent to avoid duplicate fetch */
  approvalItems?: any[];
}) {
  const [resp, setResp] = useState<PendingApprovalsResp | null>(null);
  const fetchedRef = useRef(false);

  const loading = !resp;

  useEffect(() => {
    if (parentItems !== undefined) {
      setResp({ ok: true, items: parentItems });
      return;
    }

    let cancelled = false;
    fetchedRef.current = false;

    (async () => {
      try {
        const r = await fetch(
          `/api/executive/approvals/pending?limit=200&days=${days}`,
          {
            cache: "no-store",
            credentials: "include",
            headers: {
              Accept: "application/json",
              "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
              Pragma: "no-cache",
            },
          }
        );
        const json = await r.json().catch(() => ({})) as any;
        if (cancelled) return;

        if (json?.ok === false) {
          setResp({ ok: false, error: safeStr(json.error) || "Failed to load approval intelligence" });
          return;
        }
        const items = Array.isArray(json?.items) ? json.items : [];
        setResp({ ok: true, scope: json?.scope, orgId: json?.orgId, items });
      } catch {
        if (!cancelled) setResp({ ok: false, error: "Failed to load approval intelligence" });
      }
    })();

    return () => { cancelled = true; };
  }, [days, parentItems]);

  // ── Normalise raw items → consistent field names ──
  // ✅ FIX-GI2: all downstream code works on normalised items only
  const items = useMemo(() => {
    if (!resp || (resp as any).ok === false) return [];
    const raw = ((resp as any).items || []) as any[];
    return raw.map(normaliseItem);
  }, [resp]);

  // ── Summary counts ──
  const counts = useMemo(() => {
    let ok = 0, warn = 0, overdue = 0;
    for (const it of items) {
      const st = pickSlaState(it);
      if (st === "overdue") overdue++;
      else if (st === "warn") warn++;
      else ok++;
    }
    return { waiting: ok, at_risk: warn, breached: overdue, pending: ok + warn + overdue };
  }, [items]);

  // ── Projects ──
  const projects: UiProject[] = useMemo(() => {
    const map = new Map<string, UiProject>();
    for (const it of items) {
      const pid = safeStr(it?.project_id);
      if (!pid) continue;
      const state = pickSlaState(it);
      // ✅ FIX-GI3: use corrected days-waiting helper
      const ageDays = toDaysWaiting(it);

      let p = map.get(pid);
      if (!p) {
        p = {
          project_id: pid,
          project_code: it?.project_code ?? null,
          project_title: it?.project_title ?? null,
          rag: "G",
          // ✅ FIX-GI1: use normalised _stage field
          stage: it._stage || null,
          // ✅ FIX-GI1: use normalised approver label
          approver_label: pickApproverLabel(it),
          days_waiting: ageDays,
          counts: { ok: 0, warn: 0, overdue: 0, total: 0 },
        };
        map.set(pid, p);
      }
      p.counts.total++;
      if (state === "overdue") p.counts.overdue++;
      else if (state === "warn") p.counts.warn++;
      else p.counts.ok++;
      p.days_waiting = Math.max(p.days_waiting, ageDays);
      if (!p.approver_label || p.approver_label === "—") p.approver_label = pickApproverLabel(it);
      if (!p.stage) p.stage = it._stage || null;
    }
    const list = Array.from(map.values()).map(p => ({ ...p, rag: deriveRag(p.counts.overdue, p.counts.warn) }));
    list.sort((a, b) => {
      const aw = a.counts.overdue > 0 ? 2 : a.counts.warn > 0 ? 1 : 0;
      const bw = b.counts.overdue > 0 ? 2 : b.counts.warn > 0 ? 1 : 0;
      if (bw !== aw) return bw - aw;
      return b.days_waiting - a.days_waiting;
    });
    return list;
  }, [items]);

  // ── Bottlenecks ──
  const bottlenecks: UiBottleneck[] = useMemo(() => {
    const map = new Map<string, { kind: UiBottleneck["kind"]; label: string; ages: number[]; projects: Set<string>; count: number }>();
    for (const it of items) {
      const label = pickApproverLabel(it);
      if (label === "—") continue;
      // ✅ FIX-GI1: approver_type field is unchanged in cache schema
      const kind: UiBottleneck["kind"] =
        it?.approver_type === "user" ? "user" :
        it?.approver_type === "email" ? "email" : "unknown";
      const key = `${kind}::${label}`;
      // ✅ FIX-GI3: corrected days waiting
      const ageDays = toDaysWaiting(it);
      const pid = safeStr(it?.project_id);
      let b = map.get(key);
      if (!b) { b = { kind, label, ages: [], projects: new Set(), count: 0 }; map.set(key, b); }
      b.count++;
      b.ages.push(ageDays);
      if (pid) b.projects.add(pid);
    }
    const out: UiBottleneck[] = Array.from(map.values()).map(x => {
      const max = x.ages.length ? Math.max(...x.ages) : 0;
      const avg = x.ages.length ? x.ages.reduce((a, n) => a + n, 0) / x.ages.length : 0;
      return {
        kind: x.kind, label: x.label, pending_count: x.count,
        projects_affected: x.projects.size,
        avg_wait_days: Math.round(avg * 10) / 10,
        max_wait_days: max,
      };
    });
    out.sort((a, b) => b.pending_count !== a.pending_count ? b.pending_count - a.pending_count : b.max_wait_days - a.max_wait_days);
    return out;
  }, [items]);

  const maxBottleneckCount = bottlenecks.length ? Math.max(...bottlenecks.map(b => b.pending_count)) : 1;

  const error = resp && (resp as any).ok === false
    ? (resp as any).error || "Failed to load approval intelligence"
    : null;

  const dayLabel = `${days}d`;

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        className="relative overflow-hidden rounded-2xl p-6"
        style={{
          background: "linear-gradient(145deg, rgba(255,255,255,0.99) 0%, rgba(248,250,255,0.97) 55%, rgba(243,246,255,0.95) 100%)",
          border: "1px solid rgba(255,255,255,0.92)",
          boxShadow: "0 1px 1px rgba(0,0,0,0.02), 0 4px 8px rgba(0,0,0,0.03), 0 12px 32px rgba(99,102,241,0.07), 0 40px 80px rgba(99,102,241,0.04), 0 0 0 1px rgba(226,232,240,0.65), 0 1px 0 rgba(255,255,255,1) inset",
          backdropFilter: "blur(28px) saturate(1.9)",
        }}
      >
        {/* Crystal layers */}
        <div className="absolute inset-0 rounded-2xl pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.65) 0%, transparent 52%, rgba(255,255,255,0.12) 100%)" }} />
        <div className="absolute top-0 inset-x-0 h-[1px] rounded-t-2xl" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,1) 28%, rgba(255,255,255,1) 72%, transparent)" }} />
        <div className="absolute top-0 inset-x-0 h-20 rounded-t-2xl pointer-events-none" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.72) 0%, transparent 100%)" }} />
        <div className="absolute top-1 left-4 right-4 h-5 rounded-full pointer-events-none" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.92) 38%, rgba(255,255,255,0.98) 62%, transparent)", filter: "blur(5px)" }} />
        <div className="absolute -bottom-20 -right-20 w-64 h-64 rounded-full pointer-events-none" style={{ background: "radial-gradient(ellipse, rgba(99,102,241,0.055) 0%, transparent 65%)", filter: "blur(2px)" }} />
        <div className="absolute -top-10 -left-10 w-48 h-48 rounded-full pointer-events-none" style={{ background: "radial-gradient(ellipse, rgba(16,185,129,0.04) 0%, transparent 65%)" }} />

        <div className="relative">
          {/* ── Card Header ── */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl text-white"
                style={{ background: "linear-gradient(135deg,#6366f1,#4f46e5)", boxShadow: "0 4px 16px rgba(99,102,241,0.38), 0 1px 0 rgba(255,255,255,0.22) inset" }}>
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-indigo-600 mb-0.5">
                  Governance Intelligence
                </div>
                <h2 className="text-lg font-bold text-slate-950 leading-tight">
                  Approvals — Portfolio Control
                </h2>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/72 px-3 py-1.5 text-[11px] font-semibold text-slate-600"
                style={{ backdropFilter: "blur(10px)", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
                <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                {loading ? "—" : `${counts.pending} waiting`}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200/80 bg-amber-50/82 px-3 py-1.5 text-[11px] font-bold text-amber-700"
                style={{ backdropFilter: "blur(10px)" }}>
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                {loading ? "—" : `${counts.at_risk} at risk`}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200/80 bg-rose-50/82 px-3 py-1.5 text-[11px] font-bold text-rose-700"
                style={{ backdropFilter: "blur(10px)" }}>
                <span className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse" />
                {loading ? "—" : `${counts.breached} breached`}
              </span>
              <span className="inline-flex items-center rounded-full border border-slate-200/60 bg-slate-100/60 px-2.5 py-1.5 text-[10px] font-semibold text-slate-500"
                style={{ backdropFilter: "blur(8px)" }}>
                {dayLabel}
              </span>
            </div>
          </div>

          {/* Error state */}
          {error && (
            <div className="mb-5 rounded-2xl border border-rose-200/70 bg-rose-50/72 px-4 py-3 text-sm text-rose-700"
              style={{ backdropFilter: "blur(10px)" }}>
              <AlertTriangle className="inline h-4 w-4 mr-2 -mt-0.5" />{error}
            </div>
          )}

          {/* AI Summary */}
          <AiRiskSummary counts={counts} loading={loading} />

          {/* ── Main Grid: Heatmap + Bottlenecks ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Left: Portfolio Approval Heatmap */}
            <div className="lg:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-0.5 rounded-full bg-indigo-400" style={{ boxShadow: "0 0 6px rgba(99,102,241,0.5)" }} />
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Portfolio Approval Heatmap</span>
                </div>
                {projects.length > 0 && (
                  <span className="text-[10px] text-slate-400 font-medium">{projects.length} stalled track{projects.length !== 1 ? "s" : ""}</span>
                )}
              </div>

              {loading ? (
                <SkeletonCard />
              ) : projects.length === 0 ? (
                <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="rounded-2xl border border-dashed border-slate-200/80 bg-white/40 px-6 py-14 text-center"
                  style={{ backdropFilter: "blur(10px)" }}>
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50/80 border border-emerald-200/60"
                    style={{ boxShadow: "0 4px 16px rgba(16,185,129,0.15)" }}>
                    <CheckCircle2 className="h-7 w-7 text-emerald-500" />
                  </div>
                  <div className="text-sm font-bold text-slate-700">No stalled approvals</div>
                  <div className="text-xs text-slate-400 mt-1.5 font-medium uppercase tracking-wider">Portfolio flow is clear</div>
                </m.div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {projects.slice(0, 8).map((p, i) => (
                    <ProjectHeatTile key={`${p.project_id}-${i}`} project={p} index={i} />
                  ))}
                </div>
              )}

              {projects.length > 8 && (
                <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
                  className="mt-4 text-[11px] text-slate-400 font-medium italic">
                  +{projects.length - 8} more stalled tracks not shown
                </m.div>
              )}
            </div>

            {/* Right: Process Bottlenecks */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="h-3 w-0.5 rounded-full bg-rose-400" style={{ boxShadow: "0 0 6px rgba(244,63,94,0.4)" }} />
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Process Bottlenecks</span>
              </div>

              {loading ? (
                <SkeletonBottleneck />
              ) : bottlenecks.length === 0 ? (
                <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="rounded-2xl border border-dashed border-slate-200/80 bg-white/40 px-5 py-10 text-center"
                  style={{ backdropFilter: "blur(10px)" }}>
                  <Activity className="h-6 w-6 text-slate-300 mx-auto mb-2" />
                  <div className="text-sm font-semibold text-slate-600">No congestion</div>
                  <div className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider">Approvals flowing freely</div>
                </m.div>
              ) : (
                <div className="space-y-2.5">
                  {bottlenecks.slice(0, 6).map((b, i) => (
                    <BottleneckTile key={`${b.label}-${i}`} bottleneck={b} maxCount={maxBottleneckCount} index={i} />
                  ))}
                </div>
              )}

              {/* CTA */}
              <m.a
                href="/approvals"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="group mt-5 inline-flex items-center gap-2 rounded-xl border border-indigo-200/60 bg-indigo-50/60 px-4 py-2.5 text-xs font-bold text-indigo-600 hover:bg-indigo-50/90 hover:text-indigo-700 transition-all"
                style={{ backdropFilter: "blur(8px)", boxShadow: "0 1px 4px rgba(99,102,241,0.10)" }}>
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