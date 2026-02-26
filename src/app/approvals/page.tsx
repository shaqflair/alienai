// src/app/approvals/page.tsx — Control Centre v2
// Tabs: Overview · PM Performance · Bottlenecks · At Risk Predictor

"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
import {
  ShieldCheck, Users, ArrowUpRight, CheckCircle2, AlertTriangle,
  Clock, TrendingUp, TrendingDown, Layers, ChevronDown, X,
  BarChart2, Flame, Activity, RefreshCw, UserCheck, Zap,
  FileText, Download, ExternalLink,
} from "lucide-react";
import { m, LazyMotion, domAnimation, AnimatePresence } from "framer-motion";

// ─── TYPES ────────────────────────────────────────────────────────────────────

type Rag = "R" | "A" | "G";
type Tab = "overview" | "pm" | "bottlenecks" | "atrisk" | "digest";
type RiskLevel = "HIGH" | "MEDIUM" | "LOW";

interface RiskSignal {
  key: string; label: string; detail: string;
  score: number; triggered: boolean;
}
interface ProjectRisk {
  project_id: string; project_code: string | null; project_title: string | null;
  risk_score: number; risk_level: RiskLevel; signals: RiskSignal[];
  days_since_activity: number | null; overdue_steps: number;
  rejection_rate: number | null; total_decisions: number;
}

interface PmItem {
  user_id: string; full_name: string; email: string;
  avatar_url: string | null; role: string; color: string;
  projects_managed: number;
  project_list: { id: string; title: string | null; project_code: string | null }[];
  decisions: { approved: number; rejected: number; total: number; approval_rate: number | null };
  pending_as_approver: number; overdue_items: number; rag: Rag;
}

interface CacheItem {
  project_id: string; project_title: string | null; project_code: string | null;
  approver_label: string | null; sla_status: string; window_days: number;
}

interface Project {
  id: string; title: string | null; project_code: string | null;
  project_manager_id: string | null;
}

// ─── DESIGN TOKENS ───────────────────────────────────────────────────────────

const CARD: React.CSSProperties = {
  background: "linear-gradient(145deg,rgba(255,255,255,0.99),rgba(248,250,255,0.97))",
  border: "1px solid rgba(226,232,240,0.8)",
  boxShadow: "0 1px 1px rgba(0,0,0,0.02),0 4px 8px rgba(0,0,0,0.03),0 12px 32px rgba(99,102,241,0.06)",
  backdropFilter: "blur(20px) saturate(1.8)",
  borderRadius: 16,
};

const RAG_CFG: Record<Rag, { dot: string; bg: string; border: string; color: string; label: string }> = {
  R: { dot: "#f43f5e", bg: "rgba(255,241,242,0.9)", border: "rgba(253,164,175,0.6)", color: "#9f1239", label: "At Risk" },
  A: { dot: "#f59e0b", bg: "rgba(255,251,235,0.9)", border: "rgba(252,211,77,0.6)", color: "#92400e", label: "Monitor" },
  G: { dot: "#10b981", bg: "rgba(236,253,245,0.9)", border: "rgba(110,231,183,0.6)", color: "#065f46", label: "On Track" },
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const ss = (x: any) => typeof x === "string" ? x : x == null ? "" : String(x);

function initials(name: string) {
  return name.split(" ").map(w => w[0] || "").join("").toUpperCase().slice(0, 2) || "??";
}

function RagBadge({ rag }: { rag: Rag }) {
  const c = RAG_CFG[rag];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, borderRadius: 20, padding: "2px 9px", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", background: c.bg, border: `1px solid ${c.border}`, color: c.color }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: c.dot }} />{c.label}
    </span>
  );
}

function Avatar({ name, color, url, size = 36 }: { name: string; color: string; url?: string | null; size?: number }) {
  if (url) return <img src={url} style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(255,255,255,0.8)" }} />;
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: `linear-gradient(135deg,${color},${color}bb)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.33, fontWeight: 700, color: "white", border: "2px solid rgba(255,255,255,0.8)", flexShrink: 0, boxShadow: `0 2px 8px ${color}44` }}>
      {initials(name)}
    </div>
  );
}

function StatPill({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{ textAlign: "center", padding: "8px 12px", borderRadius: 10, background: "rgba(248,250,255,0.8)", border: "1px solid rgba(226,232,240,0.6)" }}>
      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 18, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 3 }}>{label}</div>
    </div>
  );
}

// ─── APPROVAL DONUT ───────────────────────────────────────────────────────────

function ApprovalDonut({ approved, rejected, size = 56 }: { approved: number; rejected: number; size?: number }) {
  const total = approved + rejected;
  const r = (size / 2) - 5;
  const circ = 2 * Math.PI * r;
  const approvedPct = total > 0 ? approved / total : 0;
  const approvedDash = approvedPct * circ;
  const cx = size / 2, cy = size / 2;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(241,245,249,0.9)" strokeWidth={6} />
      {total > 0 && (
        <>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#10b981" strokeWidth={6} strokeDasharray={`${approvedDash} ${circ - approvedDash}`} strokeLinecap="round" />
          {rejected > 0 && (
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f43f5e" strokeWidth={6}
              strokeDasharray={`${(rejected / total) * circ} ${circ - (rejected / total) * circ}`}
              strokeDashoffset={-approvedDash} strokeLinecap="round" />
          )}
        </>
      )}
    </svg>
  );
}

// ─── PM CARD ─────────────────────────────────────────────────────────────────

function PmCard({ pm, idx, projects, onAssignProject }: {
  pm: PmItem; idx: number; projects: Project[];
  onAssignProject: (pmId: string, projectId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const rc = RAG_CFG[pm.rag];
  const total = pm.decisions.total;
  const rate = pm.decisions.approval_rate;

  return (
    <m.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38, delay: idx * 0.07, ease: [0.16, 1, 0.3, 1] }}
      style={{ ...CARD, position: "relative", overflow: "hidden" }}>
      {/* Left accent */}
      <div style={{ position: "absolute", left: 0, top: "15%", bottom: "15%", width: 3, borderRadius: "0 2px 2px 0", background: pm.color, boxShadow: `0 0 10px ${pm.color}55` }} />

      <div style={{ padding: "16px 16px 16px 20px" }}>
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <Avatar name={pm.full_name} color={pm.color} url={pm.avatar_url} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pm.full_name}</div>
            <div style={{ fontSize: 11, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pm.email}</div>
          </div>
          <RagBadge rag={pm.rag} />
        </div>

        {/* Stats row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 14 }}>
          <StatPill label="Projects" value={pm.projects_managed} color="#6366f1" />
          <StatPill label="Overdue" value={pm.overdue_items} color={pm.overdue_items > 0 ? "#e11d48" : "#10b981"} />
          <StatPill label="Approved" value={pm.decisions.approved} color="#10b981" />
          <StatPill label="Rejected" value={pm.decisions.rejected} color={pm.decisions.rejected > 0 ? "#f43f5e" : "#94a3b8"} />
        </div>

        {/* Approval rate bar */}
        {total > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: "#64748b" }}>Approval rate</span>
              <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 700, color: rate && rate >= 70 ? "#10b981" : "#f43f5e" }}>{rate ?? 0}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 4, background: "rgba(241,245,249,0.9)", overflow: "hidden", display: "flex" }}>
              <m.div initial={{ width: 0 }} animate={{ width: `${rate ?? 0}%` }} transition={{ duration: 0.8, delay: idx * 0.07 + 0.2 }}
                style={{ height: "100%", background: rate && rate >= 70 ? "linear-gradient(90deg,#10b981,#34d399)" : "linear-gradient(90deg,#f59e0b,#fbbf24)", borderRadius: 4 }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 9, color: "#94a3b8" }}>
              <span>✅ {pm.decisions.approved} approved</span>
              <span>❌ {pm.decisions.rejected} rejected</span>
            </div>
          </div>
        )}

        {/* Pending badge */}
        {pm.pending_as_approver > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, padding: "6px 10px", borderRadius: 8, background: "rgba(255,251,235,0.8)", border: "1px solid rgba(252,211,77,0.5)" }}>
            <Clock size={12} color="#d97706" />
            <span style={{ fontSize: 11, fontWeight: 600, color: "#92400e" }}>{pm.pending_as_approver} pending approval{pm.pending_as_approver !== 1 ? "s" : ""} awaiting this user</span>
          </div>
        )}

        {/* Expand toggle */}
        <button onClick={() => setExpanded(e => !e)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", background: "none", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#6366f1" }}>
          <span>{expanded ? "Hide" : "Show"} projects ({pm.project_list.length})</span>
          <ChevronDown size={14} style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
        </button>

        {/* Expanded project list */}
        <AnimatePresence>
          {expanded && (
            <m.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25 }} style={{ overflow: "hidden" }}>
              <div style={{ paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                {pm.project_list.map((p, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 8, background: "rgba(238,242,255,0.6)", border: "1px solid rgba(199,210,254,0.4)" }}>
                    {p.project_code && <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, fontWeight: 700, color: "#4338ca", background: "rgba(238,242,255,0.8)", border: "1px solid rgba(199,210,254,0.6)", borderRadius: 4, padding: "1px 5px" }}>{p.project_code}</span>}
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#374151", flex: 1 }}>{p.title || "Untitled"}</span>
                  </div>
                ))}
                {pm.project_list.length === 0 && <div style={{ fontSize: 11, color: "#94a3b8", padding: "4px 0" }}>No projects assigned yet</div>}

                {/* Assign project dropdown */}
                <div style={{ marginTop: 6 }}>
                  <button onClick={() => setAssigning(a => !a)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, border: "1px dashed rgba(99,102,241,0.4)", background: "rgba(238,242,255,0.4)", cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#6366f1" }}>
                    <UserCheck size={12} /> Assign a project
                  </button>
                  {assigning && (
                    <div style={{ marginTop: 6, borderRadius: 10, border: "1px solid rgba(226,232,240,0.8)", background: "rgba(255,255,255,0.95)", overflow: "hidden", boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}>
                      {projects.filter(p => p.project_manager_id !== pm.user_id).map(p => (
                        <div key={p.id} onClick={() => { onAssignProject(pm.user_id, p.id); setAssigning(false); }}
                          style={{ padding: "8px 12px", cursor: "pointer", fontSize: 12, color: "#374151", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid rgba(226,232,240,0.4)" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "rgba(238,242,255,0.6)")}
                          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                          {p.project_code && <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, fontWeight: 700, color: "#4338ca" }}>{p.project_code}</span>}
                          <span>{p.title || "Untitled"}</span>
                        </div>
                      ))}
                      {projects.filter(p => p.project_manager_id !== pm.user_id).length === 0 && (
                        <div style={{ padding: "8px 12px", fontSize: 11, color: "#94a3b8" }}>All projects already assigned</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </m.div>
  );
}

// ─── OVERVIEW TAB ─────────────────────────────────────────────────────────────

function OverviewTab({ cacheItems, loading }: { cacheItems: CacheItem[]; loading: boolean }) {
  const counts = useMemo(() => {
    let pending = 0, at_risk = 0, breached = 0;
    for (const it of cacheItems) {
      const s = ss(it?.sla_status).toLowerCase();
      if (s === "overdue" || s === "breached" || s === "overdue_undecided") breached++;
      else if (s === "warn" || s === "at_risk") at_risk++;
      else pending++;
    }
    return { pending, at_risk, breached, total: cacheItems.length };
  }, [cacheItems]);

  const byProject = useMemo(() => {
    const map = new Map<string, { title: string | null; code: string | null; count: number; breached: number; at_risk: number }>();
    for (const it of cacheItems) {
      const pid = ss(it?.project_id); if (!pid) continue;
      const s = ss(it?.sla_status).toLowerCase();
      let p = map.get(pid);
      if (!p) { p = { title: it.project_title, code: it.project_code, count: 0, breached: 0, at_risk: 0 }; map.set(pid, p); }
      p.count++;
      if (s === "overdue" || s === "breached" || s === "overdue_undecided") p.breached++;
      else if (s === "warn" || s === "at_risk") p.at_risk++;
    }
    return Array.from(map.values()).sort((a, b) => b.breached - a.breached || b.at_risk - a.at_risk);
  }, [cacheItems]);

  if (loading) return <div style={{ padding: "40px 0", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Loading overview...</div>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
      {/* Summary cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.15em", color: "#94a3b8", marginBottom: 4 }}>Portfolio Summary</div>
        {[
          { label: "Total Pending", value: counts.total, color: "#6366f1", icon: <Clock size={16} color="#6366f1" /> },
          { label: "SLA Breached", value: counts.breached, color: "#e11d48", icon: <Flame size={16} color="#e11d48" /> },
          { label: "At Risk", value: counts.at_risk, color: "#d97706", icon: <AlertTriangle size={16} color="#d97706" /> },
          { label: "Within SLA", value: counts.pending, color: "#10b981", icon: <CheckCircle2 size={16} color="#10b981" /> },
        ].map((s, i) => (
          <div key={i} style={{ ...CARD, display: "flex", alignItems: "center", gap: 14, padding: "14px 16px" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: `${s.color}15`, border: `1px solid ${s.color}30`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {s.icon}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 22, fontWeight: 700, color: s.color, lineHeight: 1.2 }}>{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* By project */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.15em", color: "#94a3b8", marginBottom: 12 }}>By Project</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {byProject.length === 0 && <div style={{ fontSize: 13, color: "#94a3b8", padding: "20px 0" }}>No data</div>}
          {byProject.map((p, i) => {
            const rag: Rag = p.breached > 0 ? "R" : p.at_risk > 0 ? "A" : "G";
            const rc = RAG_CFG[rag];
            return (
              <div key={i} style={{ ...CARD, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                    {p.code && <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, fontWeight: 700, color: "#4338ca", background: "rgba(238,242,255,0.8)", border: "1px solid rgba(199,210,254,0.6)", borderRadius: 4, padding: "1px 5px" }}>{p.code}</span>}
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title || "Untitled"}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#94a3b8" }}>{p.count} pending · {p.breached} breached · {p.at_risk} at risk</div>
                </div>
                <RagBadge rag={rag} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── BOTTLENECKS TAB ──────────────────────────────────────────────────────────

function BottlenecksTab({ cacheItems, loading }: { cacheItems: CacheItem[]; loading: boolean }) {
  const bottlenecks = useMemo(() => {
    const map = new Map<string, { label: string; count: number; breached: number; projects: Set<string> }>();
    for (const it of cacheItems) {
      const label = ss(it?.approver_label).trim(); if (!label || label === "—") continue;
      const s = ss(it?.sla_status).toLowerCase();
      let b = map.get(label); if (!b) { b = { label, count: 0, breached: 0, projects: new Set() }; map.set(label, b); }
      b.count++;
      if (s === "overdue" || s === "breached" || s === "overdue_undecided") b.breached++;
      if (it.project_id) b.projects.add(it.project_id);
    }
    return Array.from(map.values()).sort((a, b) => b.breached - a.breached || b.count - a.count);
  }, [cacheItems]);

  const maxCount = bottlenecks.length ? Math.max(...bottlenecks.map(b => b.count)) : 1;

  if (loading) return <div style={{ padding: "40px 0", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Loading bottlenecks...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {bottlenecks.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 0" }}>
          <Activity size={32} color="#cbd5e1" style={{ margin: "0 auto 12px" }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: "#64748b" }}>No bottlenecks detected</div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>All approvals flowing freely</div>
        </div>
      )}
      {bottlenecks.map((b, i) => {
        const pct = Math.max(8, (b.count / maxCount) * 100);
        const heat = b.breached >= 3 ? "R" : b.breached >= 1 ? "A" : "G";
        const rc = RAG_CFG[heat];
        return (
          <m.div key={i} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, delay: i * 0.06 }}
            style={{ ...CARD, position: "relative", overflow: "hidden" }}>
            <m.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, delay: i * 0.06 + 0.1 }}
              style={{ position: "absolute", left: 0, top: 0, bottom: 0, background: rc.dot, opacity: 0.06, pointerEvents: "none" }} />
            <div style={{ position: "relative", padding: "14px 16px", display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: `${rc.dot}15`, border: `1px solid ${rc.dot}30`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Users size={16} color={rc.dot} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 3 }}>{b.label}</div>
                <div style={{ fontSize: 10, color: "#94a3b8" }}>{b.count} pending · {b.breached} breached · {b.projects.size} project{b.projects.size !== 1 ? "s" : ""}</div>
              </div>
              <RagBadge rag={heat} />
            </div>
          </m.div>
        );
      })}
    </div>
  );
}

// ─── AT RISK TAB ─────────────────────────────────────────────────────────────

const RISK_CFG: Record<RiskLevel, { dot: string; bg: string; border: string; color: string; label: string; barColor: string }> = {
  HIGH:   { dot: "#f43f5e", bg: "rgba(255,241,242,0.92)", border: "rgba(253,164,175,0.6)", color: "#9f1239",  label: "High Risk",   barColor: "#f43f5e" },
  MEDIUM: { dot: "#f59e0b", bg: "rgba(255,251,235,0.92)", border: "rgba(252,211,77,0.6)",  color: "#92400e",  label: "Medium Risk", barColor: "#f59e0b" },
  LOW:    { dot: "#10b981", bg: "rgba(236,253,245,0.92)", border: "rgba(110,231,183,0.6)", color: "#065f46",  label: "Low Risk",    barColor: "#10b981" },
};

function RiskScoreBar({ score, level }: { score: number; risk_level?: RiskLevel; level: RiskLevel }) {
  const cfg = RISK_CFG[level];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 4, background: "rgba(241,245,249,0.9)", overflow: "hidden" }}>
        <m.div initial={{ width: 0 }} animate={{ width: `${score}%` }} transition={{ duration: 0.8, ease: [0.16,1,0.3,1] }}
          style={{ height: "100%", borderRadius: 4, background: cfg.barColor }} />
      </div>
      <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 700, color: cfg.color, minWidth: 30, textAlign: "right" }}>{score}</span>
    </div>
  );
}

function SignalRow({ signal }: { signal: RiskSignal }) {
  const triggered = signal.triggered;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 0", borderBottom: "1px solid rgba(226,232,240,0.4)" }}>
      <div style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0, marginTop: 1,
        background: triggered ? "rgba(244,63,94,0.12)" : "rgba(16,185,129,0.12)",
        border: `1px solid ${triggered ? "rgba(244,63,94,0.3)" : "rgba(16,185,129,0.3)"}`,
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9 }}>
        {triggered ? "!" : "✓"}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: triggered ? "#9f1239" : "#065f46" }}>{signal.label}</div>
        <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{signal.detail}</div>
      </div>
      {triggered && <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, fontWeight: 700, color: "#f43f5e", flexShrink: 0 }}>+{signal.score}</div>}
    </div>
  );
}

function RiskCard({ item, idx }: { item: ProjectRisk; idx: number }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = RISK_CFG[item.risk_level];

  return (
    <m.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: idx * 0.06, ease: [0.16,1,0.3,1] }}
      style={{ ...CARD, position: "relative", overflow: "hidden" }}>
      {/* left accent */}
      <div style={{ position: "absolute", left: 0, top: "15%", bottom: "15%", width: 3, borderRadius: "0 2px 2px 0", background: cfg.dot, boxShadow: `0 0 8px ${cfg.dot}55` }} />

      <div style={{ padding: "14px 16px 14px 20px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              {item.project_code && (
                <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, fontWeight: 700, color: "#4338ca", background: "rgba(238,242,255,0.8)", border: "1px solid rgba(199,210,254,0.6)", borderRadius: 4, padding: "1px 5px" }}>{item.project_code}</span>
              )}
              <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.project_title || "Untitled Project"}</span>
            </div>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>
              {[
                item.overdue_steps > 0 && `${item.overdue_steps} overdue step${item.overdue_steps !== 1 ? "s" : ""}`,
                item.days_since_activity != null && `${item.days_since_activity}d since activity`,
                item.rejection_rate != null && `${item.rejection_rate}% rejection rate`,
              ].filter(Boolean).join(" · ")}
            </div>
          </div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, borderRadius: 20, padding: "3px 9px", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color, flexShrink: 0 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: cfg.dot }} />{cfg.label}
          </span>
        </div>

        {/* Risk score bar */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: "#64748b" }}>Risk Score</span>
            <span style={{ fontSize: 9, color: "#94a3b8" }}>
              {item.signals.filter(s => s.triggered).length} of {item.signals.length} signals triggered
            </span>
          </div>
          <RiskScoreBar score={item.risk_score} level={item.risk_level} />
        </div>

        {/* Triggered signals summary chips */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {item.signals.filter(s => s.triggered).map(s => (
            <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 8, padding: "2px 8px", fontSize: 9, fontWeight: 600, background: "rgba(255,241,242,0.8)", border: "1px solid rgba(253,164,175,0.4)", color: "#9f1239" }}>
              ⚠ {s.label}
            </span>
          ))}
          {item.signals.filter(s => s.triggered).length === 0 && (
            <span style={{ fontSize: 10, color: "#10b981", fontWeight: 600 }}>✓ No risk signals triggered</span>
          )}
        </div>

        {/* Expand toggle */}
        <button onClick={() => setExpanded(e => !e)}
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0", background: "none", border: "none", cursor: "pointer", fontSize: 10, fontWeight: 600, color: "#6366f1" }}>
          <span>{expanded ? "Hide" : "Show"} signal breakdown</span>
          <ChevronDown size={13} style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
        </button>

        <AnimatePresence>
          {expanded && (
            <m.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25 }} style={{ overflow: "hidden" }}>
              <div style={{ paddingTop: 8 }}>
                {item.signals.map(s => <SignalRow key={s.key} signal={s} />)}
              </div>
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </m.div>
  );
}

function AtRiskTab() {
  const [data, setData] = useState<{ items: ProjectRisk[]; summary: { total: number; high: number; medium: number; low: number } } | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"ALL" | RiskLevel>("ALL");

  useEffect(() => {
    setLoading(true);
    fetch("/api/executive/projects/at-risk", { credentials: "include", cache: "no-store" })
      .then(r => r.json())
      .then(j => { if (j?.ok) setData({ items: j.items ?? [], summary: j.summary ?? { total: 0, high: 0, medium: 0, low: 0 } }); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!data?.items) return [];
    if (filter === "ALL") return data.items;
    return data.items.filter(i => i.risk_level === filter);
  }, [data, filter]);

  if (loading) return <div style={{ padding: "40px 0", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Analysing project risk signals...</div>;

  const summary = data?.summary ?? { total: 0, high: 0, medium: 0, low: 0 };

  return (
    <div>
      {/* Summary strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Total Projects", value: summary.total, color: "#6366f1" },
          { label: "High Risk", value: summary.high, color: "#e11d48" },
          { label: "Medium Risk", value: summary.medium, color: "#d97706" },
          { label: "Low Risk", value: summary.low, color: "#10b981" },
        ].map((s, i) => (
          <div key={i} style={{ ...CARD, padding: "14px 16px", textAlign: "center" }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 28, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 5 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter pills */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {(["ALL", "HIGH", "MEDIUM", "LOW"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: "5px 14px", borderRadius: 20, border: `1px solid ${filter === f ? "#6366f1" : "rgba(226,232,240,0.8)"}`, background: filter === f ? "rgba(238,242,255,0.9)" : "rgba(255,255,255,0.7)", color: filter === f ? "#4338ca" : "#64748b", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
            {f === "ALL" ? `All (${summary.total})` : f === "HIGH" ? `High (${summary.high})` : f === "MEDIUM" ? `Medium (${summary.medium})` : `Low (${summary.low})`}
          </button>
        ))}
      </div>

      {/* Project risk cards */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0" }}>
          <CheckCircle2 size={36} color="#10b981" style={{ margin: "0 auto 12px" }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: "#374151" }}>No projects at this risk level</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: 14 }}>
          {filtered.map((item, i) => <RiskCard key={item.project_id} item={item} idx={i} />)}
        </div>
      )}
    </div>
  );
}


// ─── DIGEST TAB ──────────────────────────────────────────────────────────────

function DigestTab() {
  const [days, setDays] = useState(7);
  const [digest, setDigest] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  const fetchDigest = useCallback(() => {
    setLoading(true);
    fetch(`/api/executive/digest?days=${days}`, { credentials: "include", cache: "no-store" })
      .then(r => r.json())
      .then(j => { if (j?.ok) setDigest(j.digest); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [days]);

  useEffect(() => { fetchDigest(); }, [fetchDigest]);

  function openPdf() {
    setPdfLoading(true);
    const w = window.open(`/api/executive/digest/pdf?days=${days}`, "_blank");
    setTimeout(() => setPdfLoading(false), 2000);
  }

  const ss = (x: any) => typeof x === "string" ? x : x == null ? "" : String(x);
  const fmtDate = (iso: string | null | undefined) => {
    if (!iso) return "—";
    const d = new Date(iso); if (!isFinite(d.getTime())) return "—";
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  };

  function ragColor(status: string) {
    const s = ss(status).toLowerCase();
    if (s === "overdue" || s === "breached" || s === "high" || s === "overdue_undecided") return "#e11d48";
    if (s === "warn" || s === "at_risk" || s === "medium") return "#d97706";
    return "#059669";
  }

  function ragLabel(status: string) {
    const s = ss(status).toLowerCase();
    if (s === "overdue" || s === "breached" || s === "overdue_undecided") return "BREACHED";
    if (s === "warn" || s === "at_risk") return "AT RISK";
    if (s === "high") return "HIGH RISK";
    if (s === "medium") return "MEDIUM RISK";
    return "OK";
  }

  function StatusBadge({ status }: { status: string }) {
    const color = ragColor(status);
    const label = ragLabel(status);
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 20, padding: "2px 8px", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", background: `${color}18`, border: `1px solid ${color}44`, color }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: color }} />{label}
      </span>
    );
  }

  function SectionCard({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
    return (
      <div style={{ ...CARD, padding: "18px 20px", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, paddingBottom: 10, borderBottom: "1px solid rgba(226,232,240,0.6)" }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: "#0f172a", textTransform: "uppercase", letterSpacing: "0.12em" }}>{title}</span>
          {count !== undefined && <span style={{ background: "#6366f1", color: "white", borderRadius: 20, padding: "1px 8px", fontSize: 10, fontWeight: 700 }}>{count}</span>}
        </div>
        {children}
      </div>
    );
  }

  const sum = digest?.summary;
  const sec = digest?.sections;

  return (
    <div>
      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", align: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#64748b", alignSelf: "center" }}>Time window:</span>
          {([7, 14, 30, 60] as const).map(d => (
            <button key={d} onClick={() => setDays(d)}
              style={{ padding: "5px 14px", borderRadius: 20, border: `1px solid ${days === d ? "#6366f1" : "rgba(226,232,240,0.8)"}`, background: days === d ? "rgba(238,242,255,0.9)" : "rgba(255,255,255,0.7)", color: days === d ? "#4338ca" : "#64748b", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
              {d}d
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={fetchDigest}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 10, border: "1px solid rgba(226,232,240,0.8)", background: "rgba(255,255,255,0.9)", color: "#374151", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
            <RefreshCw size={13} /> Refresh
          </button>
          <button onClick={openPdf} disabled={pdfLoading || !digest}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 16px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#6366f1,#4f46e5)", color: "white", fontSize: 11, fontWeight: 700, cursor: digest ? "pointer" : "not-allowed", opacity: pdfLoading ? 0.7 : 1 }}>
            <Download size={13} /> {pdfLoading ? "Opening..." : "Download PDF"}
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: "60px 0", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Compiling executive digest...</div>
      ) : !digest ? (
        <div style={{ padding: "60px 0", textAlign: "center" }}>
          <FileText size={36} color="#cbd5e1" style={{ margin: "0 auto 12px" }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>No digest data</div>
        </div>
      ) : (
        <>
          {/* Header */}
          <div style={{ ...CARD, padding: "16px 20px", marginBottom: 16, background: "linear-gradient(135deg,rgba(99,102,241,0.06),rgba(238,242,255,0.8))", border: "1px solid rgba(199,210,254,0.5)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", marginBottom: 3 }}>Portfolio Governance Digest</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>Last {days} days · Generated {fmtDate(digest.generated_at)}</div>
              </div>
              <button onClick={openPdf} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 10, border: "1px solid rgba(199,210,254,0.6)", background: "rgba(238,242,255,0.6)", color: "#4338ca", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                <ExternalLink size={12} /> View as PDF
              </button>
            </div>
          </div>

          {/* Summary strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 16 }}>
            {[
              { label: "Pending", value: sum.pending_total, color: "#6366f1" },
              { label: "Breached", value: sum.breached_total, color: "#e11d48" },
              { label: "Decisions", value: sum.decisions_total, color: "#0f172a" },
              { label: "New Projects", value: sum.new_projects, color: "#6366f1" },
            ].map((s, i) => (
              <div key={i} style={{ ...CARD, padding: "12px 14px", textAlign: "center" }}>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 24, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* SLA Breaches */}
          <SectionCard title="SLA Breaches" count={sec.sla_breaches.total}>
            {sec.sla_breaches.total === 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#10b981", fontSize: 12, fontWeight: 600 }}>
                <CheckCircle2 size={16} /> No SLA breaches this period
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {sec.sla_breaches.items.map((r: any, i: number) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 8, background: "rgba(255,241,242,0.6)", border: "1px solid rgba(253,164,175,0.3)" }}>
                    <AlertTriangle size={13} color="#e11d48" />
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{ss(r?.project_title) || "—"}</span>
                    {r?.project_code && <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, fontWeight: 700, color: "#4338ca", background: "rgba(238,242,255,0.8)", border: "1px solid rgba(199,210,254,0.6)", borderRadius: 4, padding: "1px 5px" }}>{r.project_code}</span>}
                    <span style={{ fontSize: 10, color: "#64748b" }}>{ss(r?.approver_label) || "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Decisions */}
          <SectionCard title="Approval Decisions" count={sec.decisions.total}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 14 }}>
              {[
                { label: "Approved", value: sec.decisions.approved, color: "#10b981" },
                { label: "Rejected", value: sec.decisions.rejected, color: sec.decisions.rejected > 0 ? "#f43f5e" : "#94a3b8" },
                { label: "Approval Rate", value: sec.decisions.approval_rate != null ? `${sec.decisions.approval_rate}%` : "N/A", color: sec.decisions.approval_rate != null && sec.decisions.approval_rate >= 70 ? "#10b981" : "#f43f5e" },
              ].map((s, i) => (
                <div key={i} style={{ textAlign: "center", padding: "8px", borderRadius: 8, background: "rgba(248,250,255,0.8)", border: "1px solid rgba(226,232,240,0.5)" }}>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 3 }}>{s.label}</div>
                </div>
              ))}
            </div>
            {sec.decisions.recent.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {sec.decisions.recent.map((d: any, i: number) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 7, background: "rgba(248,250,255,0.6)" }}>
                    <StatusBadge status={ss(d?.decision)} />
                    <span style={{ flex: 1, fontSize: 11, color: "#374151" }}>{ss(d?.project_title) || "—"}</span>
                    <span style={{ fontSize: 10, color: "#94a3b8" }}>{fmtDate(d?.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* PM Performance */}
          <SectionCard title="PM Performance Snapshot">
            {sec.pm_performance.length === 0 ? (
              <div style={{ fontSize: 12, color: "#94a3b8" }}>No PM data available.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {sec.pm_performance.map((pm: any, i: number) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10, background: "rgba(248,250,255,0.8)", border: "1px solid rgba(226,232,240,0.5)" }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#6366f1,#4f46e5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "white", flexShrink: 0 }}>
                      {ss(pm?.full_name).split(" ").map((w: string) => w[0] || "").join("").toUpperCase().slice(0, 2)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>{ss(pm?.full_name)}</div>
                      <div style={{ fontSize: 10, color: "#94a3b8" }}>{pm?.projects_managed} project{pm?.projects_managed !== 1 ? "s" : ""}</div>
                    </div>
                    <div style={{ display: "flex", gap: 12, fontSize: 11 }}>
                      <span style={{ color: "#10b981", fontWeight: 700 }}>✅ {pm?.approved}</span>
                      <span style={{ color: pm?.rejected > 0 ? "#f43f5e" : "#94a3b8", fontWeight: 700 }}>❌ {pm?.rejected}</span>
                      {pm?.overdue > 0 && <span style={{ color: "#e11d48", fontWeight: 700 }}>⚠ {pm?.overdue} overdue</span>}
                      {pm?.approval_rate != null && <span style={{ color: pm?.approval_rate >= 70 ? "#10b981" : "#f43f5e", fontWeight: 700 }}>{pm.approval_rate}%</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* At-Risk Projects */}
          <SectionCard title="At-Risk Projects" count={sec.at_risk_projects.length}>
            {sec.at_risk_projects.length === 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#10b981", fontSize: 12, fontWeight: 600 }}>
                <CheckCircle2 size={16} /> No projects at elevated risk
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {sec.at_risk_projects.map((p: any, i: number) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, background: p.risk_level === "HIGH" ? "rgba(255,241,242,0.6)" : "rgba(255,251,235,0.6)", border: `1px solid ${p.risk_level === "HIGH" ? "rgba(253,164,175,0.3)" : "rgba(252,211,77,0.3)"}` }}>
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, fontWeight: 800, color: ragColor(p.risk_level), minWidth: 32 }}>{p.risk_score}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ss(p?.project_title) || "—"}</div>
                      <div style={{ fontSize: 10, color: "#64748b" }}>{p.overdue_steps > 0 ? `${p.overdue_steps} overdue` : ""}{p.days_since_activity != null ? ` · ${p.days_since_activity}d inactive` : ""}</div>
                    </div>
                    <StatusBadge status={p.risk_level} />
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* New Projects */}
          {sec.new_projects.length > 0 && (
            <SectionCard title="New Projects Started" count={sec.new_projects.length}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {sec.new_projects.map((p: any, i: number) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 8, background: "rgba(236,253,245,0.5)", border: "1px solid rgba(110,231,183,0.3)" }}>
                    {p.project_code && <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, fontWeight: 700, color: "#4338ca", background: "rgba(238,242,255,0.8)", border: "1px solid rgba(199,210,254,0.6)", borderRadius: 4, padding: "1px 5px" }}>{p.project_code}</span>}
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{ss(p?.title) || "—"}</span>
                    <span style={{ fontSize: 10, color: "#94a3b8" }}>{fmtDate(p?.created_at)}</span>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {/* Upcoming Milestones */}
          {sec.upcoming_milestones?.length > 0 && (
            <SectionCard title="Upcoming Milestones" count={sec.upcoming_milestones.length}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {sec.upcoming_milestones.map((m: any, i: number) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 8, background: "rgba(248,250,255,0.6)", border: "1px solid rgba(226,232,240,0.5)" }}>
                    <Calendar size={13} color="#6366f1" />
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{ss(m?.title) || "—"}</span>
                    <span style={{ fontSize: 10, color: "#64748b" }}>{ss(m?.project_title) || ss(m?.project_code) || "—"}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#6366f1" }}>{fmtDate(m?.due_date)}</span>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
        </>
      )}
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function ControlCentrePage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [pmData, setPmData] = useState<PmItem[]>([]);
  const [pmLoading, setPmLoading] = useState(true);
  const [cacheItems, setCacheItems] = useState<CacheItem[]>([]);
  const [cacheLoading, setCacheLoading] = useState(true);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Fetch PM performance
  useEffect(() => {
    setPmLoading(true);
    fetch("/api/executive/pm-performance", { credentials: "include", cache: "no-store" })
      .then(r => r.json())
      .then(j => { if (j?.ok) setPmData(j.items ?? []); })
      .catch(() => {})
      .finally(() => setPmLoading(false));
  }, []);

  // Fetch approval cache for overview + bottlenecks
  useEffect(() => {
    setCacheLoading(true);
    fetch("/api/executive/approvals/pending?limit=500&days=60", { credentials: "include", cache: "no-store" })
      .then(r => r.json())
      .then(j => { if (j?.ok) setCacheItems(j.items ?? []); })
      .catch(() => {})
      .finally(() => setCacheLoading(false));
  }, []);

  // Fetch all projects for assignment dropdown
  useEffect(() => {
    fetch("/api/executive/projects", { credentials: "include", cache: "no-store" })
      .then(r => r.json())
      .then(j => { if (j?.ok) setAllProjects(j.items ?? []); })
      .catch(() => {});
  }, []);

  async function handleAssignProject(pmId: string, projectId: string) {
    setSaving(true);
    try {
      const res = await fetch("/api/executive/projects/assign-pm", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, pm_user_id: pmId }),
      });
      const j = await res.json();
      if (j?.ok) {
        setToast("PM assigned successfully");
        // Refresh PM data
        const r2 = await fetch("/api/executive/pm-performance", { credentials: "include", cache: "no-store" });
        const j2 = await r2.json();
        if (j2?.ok) setPmData(j2.items ?? []);
        setAllProjects(prev => prev.map(p => p.id === projectId ? { ...p, project_manager_id: pmId } : p));
      } else {
        setToast("Failed to assign PM");
      }
    } catch { setToast("Error assigning PM"); }
    finally {
      setSaving(false);
      setTimeout(() => setToast(null), 3000);
    }
  }

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <BarChart2 size={14} /> },
    { id: "pm", label: "PM Performance", icon: <Users size={14} /> },
    { id: "bottlenecks", label: "Bottlenecks", icon: <Flame size={14} /> },
    { id: "atrisk", label: "At Risk Predictor", icon: <Zap size={14} /> },
    { id: "digest", label: "Weekly Digest", icon: <FileText size={14} /> },
  ];

  return (
    <LazyMotion features={domAnimation}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <m.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            style={{ position: "fixed", top: 20, right: 20, zIndex: 100, background: "rgba(15,23,42,0.9)", color: "white", borderRadius: 12, padding: "10px 16px", fontSize: 13, fontWeight: 600, backdropFilter: "blur(12px)" }}>
            {toast}
          </m.div>
        )}
      </AnimatePresence>

      <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,rgba(238,242,255,0.6) 0%,rgba(255,255,255,0.8) 50%,rgba(240,253,250,0.5) 100%)", padding: "32px 24px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>

          {/* Page header */}
          <m.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: "linear-gradient(135deg,#6366f1,#4f46e5)", boxShadow: "0 4px 16px rgba(99,102,241,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <ShieldCheck size={24} color="white" />
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.2em", color: "#6366f1", marginBottom: 2 }}>Executive Dashboard</div>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#0f172a" }}>Approvals Control Centre</h1>
              </div>
            </div>
            <a href="/" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, background: "rgba(238,242,255,0.8)", border: "1px solid rgba(199,210,254,0.6)", fontSize: 11, fontWeight: 700, color: "#4338ca", textDecoration: "none" }}>
              ← Dashboard
            </a>
          </m.div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 4, marginBottom: 24, background: "rgba(241,245,249,0.8)", borderRadius: 12, padding: 4, width: "fit-content" }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 9, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, transition: "all 0.2s",
                  background: tab === t.id ? "white" : "transparent",
                  color: tab === t.id ? "#0f172a" : "#64748b",
                  boxShadow: tab === t.id ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                }}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <AnimatePresence mode="wait">
            <m.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>

              {tab === "overview" && <OverviewTab cacheItems={cacheItems} loading={cacheLoading} />}

              {tab === "pm" && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                    <div style={{ fontSize: 13, color: "#64748b" }}>
                      {pmLoading ? "Loading..." : `${pmData.length} team member${pmData.length !== 1 ? "s" : ""} · click a card to expand projects`}
                    </div>
                  </div>
                  {pmLoading ? (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 16 }}>
                      {[1,2,3].map(i => <div key={i} style={{ height: 220, borderRadius: 16, background: "rgba(241,245,249,0.7)", animation: "pulse 2s ease-in-out infinite" }} />)}
                    </div>
                  ) : pmData.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "60px 0" }}>
                      <Users size={40} color="#cbd5e1" style={{ margin: "0 auto 16px" }} />
                      <div style={{ fontSize: 15, fontWeight: 600, color: "#374151" }}>No PM data available</div>
                      <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>Assign project managers to projects to see performance metrics</div>
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 16 }}>
                      {pmData.map((pm, i) => (
                        <PmCard key={pm.user_id} pm={pm} idx={i} projects={allProjects} onAssignProject={handleAssignProject} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {tab === "bottlenecks" && <BottlenecksTab cacheItems={cacheItems} loading={cacheLoading} />}

              {tab === "atrisk" && <AtRiskTab />}

              {tab === "digest" && <DigestTab />}

            </m.div>
          </AnimatePresence>
        </div>
      </div>
    </LazyMotion>
  );
}
