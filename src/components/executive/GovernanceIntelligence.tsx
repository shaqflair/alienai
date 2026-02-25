// src/components/executive/GovernanceIntelligence.tsx — v5
// All visual styling via inline styles — zero Tailwind dependency for design.
// Tailwind used only for layout utilities (flex, grid, gap, etc.)
// ✅ Hero stats strip
// ✅ AI Governance Outlook wired to POST /api/ai/events
// ✅ Portfolio heatmap with RAG tiles + heat bars
// ✅ Process bottlenecks with fill bars + flame
// ✅ Full glassmorphism crystal design

"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ShieldCheck, Users, Layers, ArrowUpRight,
  AlertTriangle, CheckCircle2, Brain, Flame, Eye, Activity,
} from "lucide-react";
import { LazyMotion, domAnimation, m } from "framer-motion";

// ─── TYPES ────────────────────────────────────────────────────────────────────

type Rag = "R" | "A" | "G";
interface UiProject {
  project_id: string; project_code: string | null; project_title: string | null;
  rag: Rag; stage: string | null; approver_label: string | null;
  days_waiting: number; counts: { ok: number; warn: number; overdue: number; total: number };
}
interface UiBottleneck {
  kind: "user" | "email" | "unknown"; label: string;
  pending_count: number; projects_affected: number;
  avg_wait_days: number; max_wait_days: number;
}
interface AiOutlookState { summary: string | null; recommended: string | null; }

// ─── UTILS ────────────────────────────────────────────────────────────────────

const ss = (x: any): string => typeof x === "string" ? x : x == null ? "" : String(x);
const sn = (x: any): number => { const n = Number(x); return Number.isFinite(n) ? n : 0; };

function normalise(raw: any) {
  return {
    ...raw,
    _sla: ss(raw?.sla_status || raw?.sla_state || raw?.state || raw?.rag),
    _ho: raw?.hours_overdue != null ? sn(raw.hours_overdue) : null,
    _ht: raw?.hours_to_due != null ? sn(raw.hours_to_due) : null,
    _approver: ss(raw?.approver_label) || ss(raw?.pending_email) || ss(raw?.approver_user_id) || ss(raw?.pending_user_id) || "",
    _stage: ss(raw?.stage_key) || ss(raw?.step_title) || ss(raw?.step_name) || "",
    _ts: raw?.submitted_at ?? raw?.created_at ?? null,
  };
}
function daysWaiting(it: ReturnType<typeof normalise>): number {
  if (it._ho != null && it._ho > 0) return Math.max(0, Math.round(it._ho / 24));
  if (it._ts) {
    const t = new Date(ss(it._ts)).getTime();
    if (isFinite(t)) return Math.max(0, Math.round((Date.now() - t) / 86400000));
  }
  if (it._ht != null && it._ht < 0) return Math.max(0, Math.round(-it._ht / 24));
  return 0;
}
function slaState(it: ReturnType<typeof normalise>): "ok" | "warn" | "overdue" {
  const s = it._sla.toLowerCase().trim();
  if (s === "overdue" || s === "breached" || s === "r") return "overdue";
  if (s === "warn" || s === "at_risk" || s === "a") return "warn";
  if (it._ho != null && it._ho > 0) return "overdue";
  return "ok";
}
function deriveRag(ov: number, w: number): Rag { return ov > 0 ? "R" : w > 0 ? "A" : "G"; }

// ─── DESIGN TOKENS ───────────────────────────────────────────────────────────

const CARD_STYLE: React.CSSProperties = {
  background: "linear-gradient(145deg, rgba(255,255,255,0.99) 0%, rgba(248,250,255,0.97) 55%, rgba(243,246,255,0.95) 100%)",
  border: "1px solid rgba(255,255,255,0.92)",
  boxShadow: "0 1px 1px rgba(0,0,0,0.02), 0 4px 8px rgba(0,0,0,0.03), 0 12px 32px rgba(99,102,241,0.07), 0 40px 80px rgba(99,102,241,0.04), 0 0 0 1px rgba(226,232,240,0.65), 0 1px 0 rgba(255,255,255,1) inset",
  backdropFilter: "blur(28px) saturate(1.9)",
  borderRadius: 20,
};

const RAG: Record<Rag, {
  label: string; dot: string; badgeBg: string; badgeBorder: string; badgeColor: string;
  accent: string; accentGlow: string; tileBg: string; dayColor: string; barColor: string; barGlow?: string;
}> = {
  R: {
    label: "RED", dot: "#f43f5e",
    badgeBg: "rgba(255,241,242,0.9)", badgeBorder: "rgba(253,164,175,0.6)", badgeColor: "#9f1239",
    accent: "#f43f5e", accentGlow: "rgba(244,63,94,0.4)",
    tileBg: "linear-gradient(135deg,rgba(255,241,242,0.92),rgba(255,255,255,0.82))",
    dayColor: "#e11d48", barColor: "#fb7185", barGlow: "0 0 8px rgba(244,63,94,0.4)",
  },
  A: {
    label: "AMBER", dot: "#f59e0b",
    badgeBg: "rgba(255,251,235,0.9)", badgeBorder: "rgba(252,211,77,0.6)", badgeColor: "#92400e",
    accent: "#f59e0b", accentGlow: "rgba(245,158,11,0.35)",
    tileBg: "linear-gradient(135deg,rgba(255,251,235,0.92),rgba(255,255,255,0.82))",
    dayColor: "#d97706", barColor: "#fbbf24",
  },
  G: {
    label: "GREEN", dot: "#10b981",
    badgeBg: "rgba(236,253,245,0.9)", badgeBorder: "rgba(110,231,183,0.6)", badgeColor: "#065f46",
    accent: "#10b981", accentGlow: "rgba(16,185,129,0.3)",
    tileBg: "linear-gradient(135deg,rgba(255,255,255,0.96),rgba(248,250,255,0.88))",
    dayColor: "#374151", barColor: "#34d399",
  },
};

// ─── HERO STAT ────────────────────────────────────────────────────────────────

function HeroStat({ label, value, sub, accent, accentGlow, numColor, delay = 0 }: {
  label: string; value: string | number; sub?: string;
  accent: string; accentGlow: string; numColor?: string; delay?: number;
}) {
  return (
    <m.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.16, 1, 0.3, 1] }}
      style={{ ...CARD_STYLE, position: "relative", overflow: "hidden" }}
    >
      {/* top shine */}
      <div style={{
        position: "absolute", inset: "0 0 auto 0", height: 1, borderRadius: "20px 20px 0 0",
        background: "linear-gradient(90deg,transparent,rgba(255,255,255,1) 28%,rgba(255,255,255,1) 72%,transparent)",
        pointerEvents: "none",
      }} />
      {/* left accent */}
      <div style={{
        position: "absolute", left: 0, top: "20%", bottom: "20%", width: 3,
        borderRadius: "0 2px 2px 0", background: accent, boxShadow: `0 0 12px ${accentGlow}`,
        pointerEvents: "none",
      }} />
      <div style={{ padding: "20px 20px 20px 22px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#94a3b8", marginBottom: 10 }}>
          {label}
        </div>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 42, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.03em", color: numColor || "#0f172a", marginBottom: 8 }}>
          {value}
        </div>
        {sub && <div style={{ fontSize: 11, color: numColor || "#94a3b8", fontWeight: 500 }}>{sub}</div>}
      </div>
    </m.div>
  );
}

// ─── AI OUTLOOK ───────────────────────────────────────────────────────────────

function AiOutlook({ counts, ai, aiLoading }: {
  counts: { pending: number; at_risk: number; breached: number };
  ai: AiOutlookState | null; aiLoading: boolean;
}) {
  const urgency = counts.breached >= 3 ? "critical"
    : counts.breached > 0 || counts.at_risk >= 3 ? "elevated"
    : counts.at_risk > 0 ? "moderate" : "clear";

  const cfg = {
    critical: { bg: "linear-gradient(135deg,rgba(244,63,94,0.06),rgba(255,241,242,0.7))", border: "rgba(253,164,175,0.5)", dot: "#f43f5e", badge: "Elevated", badgeBg: "rgba(255,228,230,0.8)", badgeBorder: "rgba(252,165,165,0.5)", badgeColor: "#9f1239", fallback: `${counts.breached} approval${counts.breached !== 1 ? "s" : ""} breached SLA. Immediate escalation required — review bottlenecks and contact approvers directly.` },
    elevated: { bg: "linear-gradient(135deg,rgba(245,158,11,0.06),rgba(255,251,235,0.7))", border: "rgba(252,211,77,0.5)", dot: "#f59e0b", badge: "Elevated", badgeBg: "rgba(254,243,199,0.8)", badgeBorder: "rgba(252,211,77,0.5)", badgeColor: "#92400e", fallback: `${counts.at_risk} approval${counts.at_risk !== 1 ? "s" : ""} approaching SLA threshold. Proactive outreach recommended.` },
    moderate: { bg: "linear-gradient(135deg,rgba(6,182,212,0.05),rgba(239,246,255,0.7))", border: "rgba(103,232,249,0.4)", dot: "#06b6d4", badge: "Moderate", badgeBg: "rgba(224,242,254,0.8)", badgeBorder: "rgba(103,232,249,0.5)", badgeColor: "#0e7490", fallback: `${counts.at_risk} item${counts.at_risk !== 1 ? "s" : ""} approaching threshold. Monitor closely.` },
    clear: { bg: "linear-gradient(135deg,rgba(16,185,129,0.05),rgba(236,253,245,0.7))", border: "rgba(110,231,183,0.4)", dot: "#10b981", badge: "On Track", badgeBg: "rgba(209,250,229,0.8)", badgeBorder: "rgba(110,231,183,0.5)", badgeColor: "#065f46", fallback: counts.pending > 0 ? `${counts.pending} approval${counts.pending !== 1 ? "s" : ""} in queue — all within SLA.` : "No approvals pending. Governance flow is clear." },
  }[urgency];

  const text = ai?.summary || cfg.fallback;

  return (
    <div style={{
      position: "relative", overflow: "hidden", borderRadius: 14,
      border: `1px solid ${cfg.border}`, background: cfg.bg,
      backdropFilter: "blur(16px)", padding: "14px 16px", marginBottom: 20,
    }}>
      <div style={{ position: "absolute", inset: "0 0 auto 0", height: 1, background: "linear-gradient(90deg,transparent,rgba(255,255,255,0.9),transparent)", pointerEvents: "none" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ position: "relative", width: 24, height: 24, borderRadius: 8, background: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,0.6)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", flexShrink: 0 }}>
            <Brain size={14} color="#64748b" />
            <span style={{ position: "absolute", top: -2, right: -2, width: 8, height: 8, borderRadius: "50%", background: cfg.dot, border: "1.5px solid white" }} />
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#64748b" }}>AI Governance Outlook</span>
        </div>
        <span style={{ borderRadius: 20, padding: "3px 10px", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", background: cfg.badgeBg, border: `1px solid ${cfg.badgeBorder}`, color: cfg.badgeColor }}>
          {cfg.badge}
        </span>
      </div>
      <p style={{ fontSize: 12, color: "#475569", lineHeight: 1.6, margin: 0 }}>
        {aiLoading
          ? <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
              {[0, 150, 300].map(d => <span key={d} style={{ width: 6, height: 6, borderRadius: "50%", background: "#94a3b8", display: "inline-block", animation: "bounce 1s infinite", animationDelay: `${d}ms` }} />)}
            </span>
          : text}
        {!aiLoading && ai?.recommended && ai.recommended !== text && (
          <span style={{ display: "block", marginTop: 4, color: "#64748b" }}>{ai.recommended}</span>
        )}
      </p>
    </div>
  );
}

// ─── HEAT TILE ────────────────────────────────────────────────────────────────

function HeatTile({ p, idx }: { p: UiProject; idx: number }) {
  const rc = RAG[p.rag];
  const tot = Math.max(1, p.counts.total);

  return (
    <m.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38, delay: idx * 0.055, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -1 }}
      style={{ position: "relative", overflow: "hidden", borderRadius: 14, border: "1px solid rgba(226,232,240,0.7)", background: rc.tileBg, backdropFilter: "blur(14px)", cursor: "default" }}
    >
      {/* left accent bar */}
      <div style={{ position: "absolute", left: 0, top: 16, bottom: 16, width: 3, borderRadius: "0 2px 2px 0", background: rc.accent, boxShadow: `0 0 10px ${rc.accentGlow}`, pointerEvents: "none" }} />

      <div style={{ padding: "14px 14px 14px 22px" }}>
        {/* badges */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, borderRadius: 20, padding: "2px 8px", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", background: rc.badgeBg, border: `1px solid ${rc.badgeBorder}`, color: rc.badgeColor }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: rc.dot, flexShrink: 0 }} />
            {rc.label}
          </span>
          {p.project_code && (
            <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, fontWeight: 700, borderRadius: 6, padding: "2px 7px", background: "rgba(238,242,255,0.8)", border: "1px solid rgba(199,210,254,0.6)", color: "#4338ca" }}>
              {p.project_code}
            </span>
          )}
        </div>

        {/* title + days */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {p.project_title || "Project"}
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {[p.stage, p.approver_label && p.approver_label !== "—" ? `by ${p.approver_label}` : null].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div style={{ flexShrink: 0, textAlign: "right" }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 16, fontWeight: 700, color: rc.dayColor }}>{p.days_waiting}d</div>
            <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>waiting</div>
          </div>
        </div>

        {/* count summary */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            {p.counts.total} item{p.counts.total !== 1 ? "s" : ""}
          </span>
          <div style={{ display: "flex", gap: 8, fontSize: 9, fontWeight: 700 }}>
            {p.counts.overdue > 0 && <span style={{ color: "#e11d48" }}>{p.counts.overdue} overdue</span>}
            {p.counts.warn > 0 && <span style={{ color: "#d97706" }}>{p.counts.warn} at risk</span>}
            {p.counts.ok > 0 && <span style={{ color: "#059669" }}>{p.counts.ok} ok</span>}
          </div>
        </div>

        {/* segmented heat bar */}
        <div style={{ height: 5, borderRadius: 4, background: "rgba(241,245,249,0.8)", overflow: "hidden", display: "flex", marginTop: 8 }}>
          {p.counts.overdue > 0 && (
            <m.div initial={{ width: 0 }} animate={{ width: `${(p.counts.overdue / tot) * 100}%` }} transition={{ duration: 0.8, delay: idx * 0.055 + 0.2 }}
              style={{ height: "100%", background: rc.barColor, borderRadius: "4px 0 0 4px", boxShadow: rc.barGlow }} />
          )}
          {p.counts.warn > 0 && (
            <m.div initial={{ width: 0 }} animate={{ width: `${(p.counts.warn / tot) * 100}%` }} transition={{ duration: 0.8, delay: idx * 0.055 + 0.3 }}
              style={{ height: "100%", background: "#fbbf24" }} />
          )}
          {p.counts.ok > 0 && (
            <m.div initial={{ width: 0 }} animate={{ width: `${(p.counts.ok / tot) * 100}%` }} transition={{ duration: 0.8, delay: idx * 0.055 + 0.4 }}
              style={{ height: "100%", background: "#34d399", borderRadius: "0 4px 4px 0" }} />
          )}
        </div>
      </div>
    </m.div>
  );
}

// ─── BOTTLENECK TILE ──────────────────────────────────────────────────────────

function BnTile({ b, maxCount, idx }: { b: UiBottleneck; maxCount: number; idx: number }) {
  const pct = maxCount > 0 ? Math.max(8, (b.pending_count / maxCount) * 100) : 8;
  const heat = b.max_wait_days > 14 ? "high" : b.max_wait_days > 7 ? "medium" : "low";
  const s = {
    high:   { bg: "rgba(255,241,242,0.88)", border: "rgba(253,164,175,0.7)",  fill: "#f43f5e", waitColor: "#e11d48" },
    medium: { bg: "rgba(255,251,235,0.88)", border: "rgba(252,211,77,0.6)",   fill: "#f59e0b", waitColor: "#d97706" },
    low:    { bg: "rgba(248,250,255,0.88)", border: "rgba(226,232,240,0.7)",  fill: "#6366f1", waitColor: "#6366f1" },
  }[heat];

  return (
    <m.div
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, delay: idx * 0.07, ease: [0.16, 1, 0.3, 1] }}
      style={{ position: "relative", overflow: "hidden", borderRadius: 14, border: `1px solid ${s.border}`, background: s.bg }}
    >
      {/* fill bar */}
      <m.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.9, delay: idx * 0.07 + 0.15, ease: [0.34, 1.56, 0.64, 1] }}
        style={{ position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 14, opacity: 0.07, background: s.fill, pointerEvents: "none" }} />

      <div style={{ position: "relative", padding: "12px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
            <div style={{ width: 30, height: 30, borderRadius: 10, background: "rgba(255,255,255,0.8)", border: "1px solid rgba(226,232,240,0.7)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, backdropFilter: "blur(8px)", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
              {b.kind === "user" ? <Users size={14} color="#64748b" /> : <Layers size={14} color="#64748b" />}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.label}</div>
              <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 500, marginTop: 2 }}>
                {b.pending_count} item{b.pending_count !== 1 ? "s" : ""} · {b.projects_affected} project{b.projects_affected !== 1 ? "s" : ""}
              </div>
            </div>
          </div>
          <div style={{ flexShrink: 0, textAlign: "right" }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, fontWeight: 700, color: s.waitColor }}>{b.avg_wait_days}d</div>
            <div style={{ fontSize: 9, color: "#94a3b8", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.1em" }}>avg wait</div>
          </div>
        </div>
        {heat === "high" && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6, fontSize: 10, fontWeight: 600, color: "#e11d48" }}>
            <Flame size={12} />
            Max wait: {b.max_wait_days}d
          </div>
        )}
      </div>
    </m.div>
  );
}

// ─── SKELETONS ────────────────────────────────────────────────────────────────

function Skel({ h = 108 }: { h?: number }) {
  return <div style={{ height: h, borderRadius: 14, background: "rgba(241,245,249,0.7)", animation: "pulse 2s ease-in-out infinite" }} />;
}

// ─── SECTION LABEL ────────────────────────────────────────────────────────────

function SectionLabel({ color, glow, text, right }: { color: string; glow: string; text: string; right?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <div style={{ width: 3, height: 10, borderRadius: 2, background: color, boxShadow: `0 0 8px ${glow}`, flexShrink: 0 }} />
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#94a3b8" }}>{text}</span>
      {right && <span style={{ marginLeft: "auto", fontSize: 10, color: "#94a3b8", fontWeight: 500 }}>{right}</span>}
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function GovernanceIntelligence({
  days = 30,
  approvalItems: parentItems,
}: {
  days?: 7 | 14 | 30 | 60;
  approvalItems?: any[];
}) {
  const [appResp, setAppResp] = useState<any>(null);
  const [ai, setAi] = useState<AiOutlookState | null>(null);
  const [aiLoading, setAiLoading] = useState(true);

  // ── fetch approvals cache
  useEffect(() => {
    if (parentItems !== undefined) { setAppResp({ ok: true, items: parentItems }); return; }
    let dead = false;
    fetch(`/api/executive/approvals/pending?limit=200&days=${days}`, {
      cache: "no-store", credentials: "include",
      headers: { Accept: "application/json", "Cache-Control": "no-store, no-cache" },
    }).then(r => r.json()).then(j => {
      if (dead) return;
      setAppResp(j?.ok === false ? { ok: false, error: j.error } : { ok: true, items: Array.isArray(j?.items) ? j.items : [] });
    }).catch(() => { if (!dead) setAppResp({ ok: false, error: "Failed to load" }); });
    return () => { dead = true; };
  }, [days, parentItems]);

  // ── fetch AI outlook
  useEffect(() => {
    let dead = false;
    setAiLoading(true);
    fetch("/api/ai/events", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ eventType: "artifact_due", windowDays: days }),
    }).then(r => r.json()).then(j => {
      if (dead || !j?.ok) return;
      const aiBlock = j?.ai ?? {};
      setAi({ summary: ss(aiBlock?.summary) || null, recommended: ss(aiBlock?.recommendedMessage) || null });
    }).catch(() => {}).finally(() => { if (!dead) setAiLoading(false); });
    return () => { dead = true; };
  }, [days]);

  const items = useMemo(() => {
    if (!appResp?.ok) return [];
    return (appResp.items || []).map(normalise);
  }, [appResp]);

  const counts = useMemo(() => {
    let ok = 0, warn = 0, ov = 0;
    for (const it of items) { const s = slaState(it); if (s === "overdue") ov++; else if (s === "warn") warn++; else ok++; }
    return { waiting: ok, at_risk: warn, breached: ov, pending: ok + warn + ov };
  }, [items]);

  const projects: UiProject[] = useMemo(() => {
    const map = new Map<string, UiProject>();
    for (const it of items) {
      const pid = ss(it?.project_id); if (!pid) continue;
      const state = slaState(it); const age = daysWaiting(it);
      let p = map.get(pid);
      if (!p) { p = { project_id: pid, project_code: it?.project_code ?? null, project_title: it?.project_title ?? null, rag: "G", stage: it._stage || null, approver_label: it._approver || "—", days_waiting: age, counts: { ok: 0, warn: 0, overdue: 0, total: 0 } }; map.set(pid, p); }
      p.counts.total++;
      if (state === "overdue") p.counts.overdue++; else if (state === "warn") p.counts.warn++; else p.counts.ok++;
      p.days_waiting = Math.max(p.days_waiting, age);
      if (!p.approver_label || p.approver_label === "—") p.approver_label = it._approver || "—";
      if (!p.stage) p.stage = it._stage || null;
    }
    return Array.from(map.values()).map(p => ({ ...p, rag: deriveRag(p.counts.overdue, p.counts.warn) }))
      .sort((a, b) => { const aw = a.counts.overdue > 0 ? 2 : a.counts.warn > 0 ? 1 : 0, bw = b.counts.overdue > 0 ? 2 : b.counts.warn > 0 ? 1 : 0; return bw !== aw ? bw - aw : b.days_waiting - a.days_waiting; });
  }, [items]);

  const bottlenecks: UiBottleneck[] = useMemo(() => {
    const map = new Map<string, { kind: UiBottleneck["kind"]; label: string; ages: number[]; projects: Set<string>; count: number }>();
    for (const it of items) {
      const label = it._approver; if (!label || label === "—") continue;
      const kind: UiBottleneck["kind"] = it?.approver_type === "user" ? "user" : it?.approver_type === "email" ? "email" : "unknown";
      const key = `${kind}::${label}`; const age = daysWaiting(it); const pid = ss(it?.project_id);
      let b = map.get(key); if (!b) { b = { kind, label, ages: [], projects: new Set(), count: 0 }; map.set(key, b); }
      b.count++; b.ages.push(age); if (pid) b.projects.add(pid);
    }
    return Array.from(map.values()).map(x => ({
      kind: x.kind, label: x.label, pending_count: x.count, projects_affected: x.projects.size,
      avg_wait_days: Math.round((x.ages.reduce((a, n) => a + n, 0) / (x.ages.length || 1)) * 10) / 10,
      max_wait_days: x.ages.length ? Math.max(...x.ages) : 0,
    })).sort((a, b) => b.pending_count !== a.pending_count ? b.pending_count - a.pending_count : b.max_wait_days - a.max_wait_days);
  }, [items]);

  const maxBn = bottlenecks.length ? Math.max(...bottlenecks.map(b => b.pending_count)) : 1;
  const loading = !appResp;
  const error = appResp?.ok === false ? appResp.error : null;
  const showHero = !loading && counts.pending > 0;

  return (
    <LazyMotion features={domAnimation}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
        @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
      `}</style>

      {/* ── HERO STATS STRIP ─────────────────────────────────────── */}
      {showHero && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 20 }}>
          <HeroStat label="Pending Approvals" value={counts.pending} sub={`${counts.pending} in queue`} accent="#6366f1" accentGlow="rgba(99,102,241,0.4)" delay={0} />
          <HeroStat label="SLA Breaches" value={counts.breached} sub={counts.breached > 0 ? "🔴 Immediate action" : "All within SLA"} accent="#f43f5e" accentGlow="rgba(244,63,94,0.35)" numColor={counts.breached > 0 ? "#e11d48" : undefined} delay={0.06} />
          <HeroStat label="At Risk" value={counts.at_risk} sub={counts.at_risk > 0 ? "⚠ Monitor closely" : "None at risk"} accent="#f59e0b" accentGlow="rgba(245,158,11,0.35)" numColor={counts.at_risk > 0 ? "#d97706" : undefined} delay={0.12} />
          <HeroStat label="Active Tracks" value={projects.length} sub={projects.slice(0, 2).map(p => p.project_code || p.project_title?.split(" ")[0] || "—").join(", ") || "—"} accent="#10b981" accentGlow="rgba(16,185,129,0.35)" numColor="#059669" delay={0.18} />
        </div>
      )}

      {/* ── MAIN GOVERNANCE CARD ─────────────────────────────────── */}
      <m.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        style={{ ...CARD_STYLE, position: "relative", overflow: "hidden" }}
      >
        {/* crystal overlays */}
        <div style={{ position: "absolute", inset: 0, borderRadius: 20, background: "linear-gradient(135deg,rgba(255,255,255,0.65) 0%,transparent 52%,rgba(255,255,255,0.12) 100%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", inset: "0 0 auto 0", height: 1, borderRadius: "20px 20px 0 0", background: "linear-gradient(90deg,transparent,rgba(255,255,255,1) 28%,rgba(255,255,255,1) 72%,transparent)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: -80, right: -80, width: 256, height: 256, borderRadius: "50%", background: "radial-gradient(ellipse,rgba(99,102,241,0.055) 0%,transparent 65%)", filter: "blur(2px)", pointerEvents: "none" }} />

        <div style={{ position: "relative", padding: 24 }}>

          {/* ── Header ── */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg,#6366f1,#4f46e5)", boxShadow: "0 4px 16px rgba(99,102,241,0.38),0 1px 0 rgba(255,255,255,0.22) inset", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <ShieldCheck size={20} color="white" />
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.2em", color: "#6366f1", marginBottom: 2 }}>Governance Intelligence</div>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>Approvals — Portfolio Control</h2>
              </div>
            </div>

            {/* status pills */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {[
                { dot: "#94a3b8", bg: "rgba(255,255,255,0.72)", border: "rgba(226,232,240,0.8)", color: "#64748b", label: `${loading ? "—" : counts.pending} waiting` },
                { dot: "#f59e0b", bg: "rgba(255,251,235,0.82)", border: "rgba(252,211,77,0.6)", color: "#92400e", label: `${loading ? "—" : counts.at_risk} at risk` },
                { dot: "#f43f5e", bg: "rgba(255,241,242,0.82)", border: "rgba(253,164,175,0.6)", color: "#9f1239", label: `${loading ? "—" : counts.breached} breached`, pulse: true },
              ].map((pill, i) => (
                <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 20, padding: "6px 12px", fontSize: 11, fontWeight: 700, background: pill.bg, border: `1px solid ${pill.border}`, color: pill.color, backdropFilter: "blur(10px)" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: pill.dot, flexShrink: 0, animation: pill.pulse ? "pulse 2s ease-in-out infinite" : undefined }} />
                  {pill.label}
                </span>
              ))}
              <span style={{ display: "inline-flex", alignItems: "center", borderRadius: 20, padding: "6px 10px", fontSize: 10, fontWeight: 600, background: "rgba(241,245,249,0.6)", border: "1px solid rgba(226,232,240,0.6)", color: "#64748b" }}>{days}d</span>
            </div>
          </div>

          {/* error */}
          {error && (
            <div style={{ marginBottom: 16, borderRadius: 14, border: "1px solid rgba(253,164,175,0.7)", background: "rgba(255,241,242,0.72)", padding: "12px 16px", fontSize: 13, color: "#9f1239", display: "flex", alignItems: "center", gap: 8 }}>
              <AlertTriangle size={16} /> {error}
            </div>
          )}

          {/* AI Outlook */}
          <AiOutlook counts={counts} ai={ai} aiLoading={aiLoading} />

          {/* ── Two-column grid ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20 }}>

            {/* LEFT: Heatmap */}
            <div>
              <SectionLabel color="#6366f1" glow="rgba(99,102,241,0.5)" text="Portfolio Approval Heatmap" right={!loading && projects.length > 0 ? `${projects.length} stalled track${projects.length !== 1 ? "s" : ""}` : undefined} />

              {loading ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {[1, 2, 3, 4].map(i => <Skel key={i} />)}
                </div>
              ) : projects.length === 0 ? (
                <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ borderRadius: 16, border: "1px dashed rgba(226,232,240,0.8)", background: "rgba(255,255,255,0.4)", backdropFilter: "blur(10px)", padding: "56px 24px", textAlign: "center" }}>
                  <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(236,253,245,0.8)", border: "1px solid rgba(110,231,183,0.6)", boxShadow: "0 4px 16px rgba(16,185,129,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                    <CheckCircle2 size={28} color="#10b981" />
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#374151" }}>No stalled approvals</div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>Portfolio flow is clear</div>
                </m.div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {projects.slice(0, 8).map((p, i) => <HeatTile key={`${p.project_id}-${i}`} p={p} idx={i} />)}
                </div>
              )}
              {projects.length > 8 && <p style={{ marginTop: 12, fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>+{projects.length - 8} more stalled tracks not shown</p>}
            </div>

            {/* RIGHT: Bottlenecks */}
            <div>
              <SectionLabel color="#f43f5e" glow="rgba(244,63,94,0.4)" text="Process Bottlenecks" />

              {loading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[1, 2, 3].map(i => <Skel key={i} h={64} />)}
                </div>
              ) : bottlenecks.length === 0 ? (
                <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ borderRadius: 16, border: "1px dashed rgba(226,232,240,0.8)", background: "rgba(255,255,255,0.4)", backdropFilter: "blur(10px)", padding: "40px 20px", textAlign: "center" }}>
                  <Activity size={24} color="#cbd5e1" style={{ margin: "0 auto 8px" }} />
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#64748b" }}>No congestion</div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.1em" }}>Approvals flowing freely</div>
                </m.div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {bottlenecks.slice(0, 6).map((b, i) => <BnTile key={`${b.label}-${i}`} b={b} maxCount={maxBn} idx={i} />)}
                </div>
              )}

              <m.a href="/approvals" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
                style={{ marginTop: 18, display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(238,242,255,0.6)", border: "1px solid rgba(199,210,254,0.6)", borderRadius: 12, padding: "10px 16px", fontSize: 11, fontWeight: 700, color: "#4338ca", backdropFilter: "blur(8px)", textDecoration: "none", cursor: "pointer", boxShadow: "0 1px 4px rgba(99,102,241,0.10)" }}>
                <Eye size={14} /> Control Center <ArrowUpRight size={12} />
              </m.a>
            </div>
          </div>
        </div>
      </m.div>
    </LazyMotion>
  );
}