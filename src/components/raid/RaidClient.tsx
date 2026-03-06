"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

/* ─── Google Fonts injection ────────────────────────────────────────────────── */
const FONT_URL = "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=IBM+Plex+Mono:wght@300;400;500;600&family=Source+Serif+4:opsz,wght@8..60,300;400;600&display=swap";

/* ─── Types ─────────────────────────────────────────────────────────────────── */

type RaidItem = {
  id: string;
  project_id: string;
  project_title: string;
  project_code: string | null;
  type: string;
  title: string;
  description: string;
  status: string;
  priority: string | null;
  probability: number | null;
  severity: number | null;
  score: number | null;
  score_source: "ai" | "basic";
  score_tooltip: string;
  sla_breach_probability: number | null;
  sla_days_to_breach: number | null;
  sla_confidence: number | null;
  currency: string;
  currency_symbol: string;
  est_cost_impact: number | null;
  est_revenue_at_risk: number | null;
  est_penalties: number | null;
  due_date: string | null;
  due_date_uk: string | null;
  owner_label: string;
  ai_rollup: string;
  ai_status: string;
  created_at: string;
  updated_at: string;
};

type ApiResponse = {
  ok: boolean;
  scope: string;
  windowDays: number;
  type: string;
  status: string;
  items: RaidItem[];
  meta: { projectCount: number; scope: string; active_only: boolean };
  error?: string;
};

type ScopeParam  = "all" | "window" | "overdue";
type TypeParam   = "all" | "Risk" | "Issue" | "Assumption" | "Dependency";
type StatusParam = "all" | "open" | "in_progress" | "mitigated" | "closed" | "invalid";
type SortKey     = "score" | "sla" | "exposure" | "due_date" | "type";
type Rag         = "R" | "A" | "G" | "N";

/* ─── Helpers ───────────────────────────────────────────────────────────────── */

function n(x: any, fallback = 0): number {
  const v = Number(x);
  return Number.isFinite(v) ? v : fallback;
}

function fmtMoney(sym: string, val: number | null): string {
  if (!val || val === 0) return "\u2014";
  if (val >= 1_000_000) return `${sym}${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000)     return `${sym}${(val / 1_000).toFixed(0)}K`;
  return `${sym}${val.toLocaleString("en-GB")}`;
}

function totalExposure(item: RaidItem): number {
  return n(item.est_cost_impact) + n(item.est_revenue_at_risk) + n(item.est_penalties);
}

function isOverdue(item: RaidItem): boolean {
  if (!item.due_date) return false;
  if (["Closed", "Invalid", "Mitigated"].includes(item.status)) return false;
  return item.due_date < new Date().toISOString().slice(0, 10);
}

function scoreRag(score: number | null): Rag {
  if (score == null) return "N";
  if (score >= 70) return "R";
  if (score >= 40) return "A";
  return "G";
}

function slaRag(bp: number | null, dtb: number | null): Rag {
  if (bp == null && dtb == null) return "N";
  if (n(bp) >= 70 || (dtb != null && n(dtb) <= 7))  return "R";
  if (n(bp) >= 40 || (dtb != null && n(dtb) <= 21)) return "A";
  return "G";
}

function itemRag(item: RaidItem): Rag {
  if (isOverdue(item)) return "R";
  const sr = scoreRag(item.score);
  if (sr === "R") return "R";
  if (sr === "A") return "A";
  if (slaRag(item.sla_breach_probability, item.sla_days_to_breach) === "R") return "R";
  return sr;
}

function nowUK() {
  return new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).replace(",", "");
}

/* ─── Design tokens ─────────────────────────────────────────────────────────── */

const T = {
  bg:      "#f9f7f4",
  surface: "#ffffff",
  hr:      "#e7e5e4",
  hrDark:  "#a8a29e",
  ink:     "#1c1917",
  ink2:    "#44403c",
  ink3:    "#78716c",
  ink4:    "#a8a29e",
  ink5:    "#d6d3d1",
  mono:    "'IBM Plex Mono', 'Menlo', monospace",
  serif:   "'Playfair Display', 'Georgia', serif",
  body:    "'Source Serif 4', 'Georgia', serif",
};

const RAG_CONFIG: Record<Rag, { fg: string; bg: string; border: string; label: string }> = {
  R: { fg: "#7f1d1d", bg: "#fef2f2", border: "#fca5a5", label: "CRITICAL" },
  A: { fg: "#78350f", bg: "#fffbeb", border: "#fcd34d", label: "ADVISORY" },
  G: { fg: "#14532d", bg: "#f0fdf4", border: "#86efac", label: "CLEAR"    },
  N: { fg: "#57534e", bg: "#fafaf9", border: "#e7e5e4", label: "—"        },
};

const TYPE_COLOR: Record<string, string> = {
  Risk:       "#991b1b",
  Issue:      "#92400e",
  Assumption: "#1e40af",
  Dependency: "#5b21b6",
};

/* ─── Atoms ─────────────────────────────────────────────────────────────────── */

function Mono({ children, size = 11, color, weight = 400, upper = false }: {
  children: React.ReactNode;
  size?: number; color?: string; weight?: number; upper?: boolean;
}) {
  return (
    <span style={{
      fontFamily: T.mono, fontSize: size,
      color: color ?? T.ink3, fontWeight: weight,
      letterSpacing: upper ? "0.08em" : undefined,
      textTransform: upper ? "uppercase" : undefined,
    }}>
      {children}
    </span>
  );
}

function Cap({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: T.mono, fontSize: 9, fontWeight: 600,
      letterSpacing: "0.13em", textTransform: "uppercase",
      color: T.ink4,
    }}>
      {children}
    </span>
  );
}

function Pip({ rag, pulse }: { rag: Rag; pulse?: boolean }) {
  const color = rag === "N" ? T.ink5 : RAG_CONFIG[rag].fg;
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 10, height: 10 }}>
      {pulse && rag === "R" && (
        <span style={{
          position: "absolute", inset: -3, borderRadius: "50%",
          background: color, opacity: 0.2,
          animation: "ragPulse 2.2s ease-in-out infinite",
        }} />
      )}
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block" }} />
    </span>
  );
}

function Pill({ label, active, onClick, dotColor }: {
  label: string; active: boolean;
  onClick: () => void; dotColor?: string;
}) {
  return (
    <button onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "4px 12px",
      fontFamily: T.mono, fontSize: 10, fontWeight: active ? 600 : 400,
      letterSpacing: "0.07em", textTransform: "uppercase",
      background: active ? T.ink : "transparent",
      color: active ? "#fff" : T.ink3,
      border: `1px solid ${active ? T.ink : T.hr}`,
      borderRadius: 2, cursor: "pointer",
      transition: "all 0.13s ease",
    }}>
      {dotColor && active && (
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: dotColor }} />
      )}
      {label}
    </button>
  );
}

/* ─── KPI cell ──────────────────────────────────────────────────────────────── */

function KpiCell({ label, value, sub, alert }: {
  label: string; value: string | number; sub?: string; alert?: boolean;
}) {
  return (
    <div style={{ padding: "22px 28px", borderRight: `1px solid ${T.hr}` }}>
      <Cap>{label}</Cap>
      <div style={{
        fontFamily: T.serif, fontSize: 40, fontWeight: 700,
        lineHeight: 1, marginTop: 10, marginBottom: 6,
        color: alert ? RAG_CONFIG.R.fg : T.ink,
      }}>
        {value}
      </div>
      {sub && <Cap>{sub}</Cap>}
    </div>
  );
}

/* ─── Score meter ───────────────────────────────────────────────────────────── */

function ScoreMeter({ score }: { score: number | null }) {
  if (score == null) return <Mono color={T.ink5}>—</Mono>;
  const rag   = scoreRag(score);
  const color = RAG_CONFIG[rag === "N" ? "N" : rag].fg;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 52, height: 3, background: T.ink5, borderRadius: 3, overflow: "hidden", flexShrink: 0 }}>
        <div style={{
          width: `${score}%`, height: "100%", borderRadius: 3,
          background: color,
          transition: "width 0.9s cubic-bezier(0.16,1,0.3,1)",
        }} />
      </div>
      <Mono size={13} color={color} weight={600}>{score}</Mono>
    </div>
  );
}

/* ─── Type flag ─────────────────────────────────────────────────────────────── */

function TypeFlag({ type }: { type: string }) {
  const c = TYPE_COLOR[type] ?? T.ink4;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 4, height: 4, borderRadius: "50%", background: c, flexShrink: 0, display: "inline-block" }} />
      <Mono size={9} color={c} weight={600} upper>{type}</Mono>
    </span>
  );
}

/* ─── Status chip ───────────────────────────────────────────────────────────── */

function StatusChip({ status }: { status: string }) {
  const done = ["Closed", "Mitigated"].includes(status);
  const open = status === "Open";
  const bg   = done ? "#f0fdf4" : open ? "#fef2f2" : "#fafaf9";
  const fg   = done ? RAG_CONFIG.G.fg : open ? RAG_CONFIG.R.fg : T.ink3;
  const bd   = done ? "#bbf7d0" : open ? "#fecaca" : T.hr;
  return (
    <span style={{
      fontFamily: T.mono, fontSize: 9, fontWeight: 600,
      letterSpacing: "0.08em", textTransform: "uppercase",
      padding: "2px 7px", borderRadius: 2,
      background: bg, color: fg,
      border: `1px solid ${bd}`,
      whiteSpace: "nowrap",
    }}>
      {status}
    </span>
  );
}

/* ─── Rule with label ───────────────────────────────────────────────────────── */

function SectionRule({ label }: { label?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      {label && <Cap>{label}</Cap>}
      <div style={{ flex: 1, height: "1px", background: T.hr }} />
    </div>
  );
}

/* ─── Detail drawer ─────────────────────────────────────────────────────────── */

function DetailDrawer({ item }: { item: RaidItem }) {
  const rag      = itemRag(item);
  const exposure = totalExposure(item);
  const slr      = slaRag(item.sla_breach_probability, item.sla_days_to_breach);
  const rc       = RAG_CONFIG[rag];

  return (
    <div style={{
      background: rc.bg,
      borderTop: `1px solid ${rc.border}`,
      padding: "26px 36px 30px 36px",
      animation: "drawerOpen 0.18s ease-out both",
    }}>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 48 }}>

        {/* Summary */}
        <div>
          <SectionRule label="Intelligence Summary" />
          <p style={{
            fontFamily: T.body, fontSize: 13.5, color: T.ink2,
            lineHeight: 1.75, margin: 0, fontWeight: 300,
          }}>
            {item.ai_rollup || item.description || "No summary available for this item."}
          </p>
          {item.ai_status && (
            <div style={{ marginTop: 10 }}>
              <Mono size={10} color={T.ink4}>AI assessment: </Mono>
              <Mono size={10} color={T.ink3}>{item.ai_status}</Mono>
            </div>
          )}
        </div>

        {/* Risk Intelligence */}
        <div>
          <SectionRule label="Risk Intelligence" />
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {([
              ["Probability",       item.probability           != null ? `${item.probability}%`           : null],
              ["Severity",          item.severity              != null ? `${item.severity}%`             : null],
              ["SLA Breach",        item.sla_breach_probability != null ? `${item.sla_breach_probability}%` : null],
              ["Days to Breach",    item.sla_days_to_breach    != null ? `~${item.sla_days_to_breach}d`   : null],
              ["AI Confidence",     item.sla_confidence        != null ? `${item.sla_confidence}%`       : null],
              ["Scoring Model",     item.score_source === "ai"  ? "AI (trained)"                         : "Formula"],
            ] as [string, string | null][]).map(([k, v]) =>
              v ? (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                  <Mono size={11} color={T.ink4}>{k}</Mono>
                  <Mono size={11} color={T.ink2} weight={500}>{v}</Mono>
                </div>
              ) : null
            )}
          </div>
        </div>

        {/* Exposure */}
        <div>
          <SectionRule label="Financial Exposure" />
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {([
              ["Cost Impact",     item.est_cost_impact],
              ["Revenue at Risk", item.est_revenue_at_risk],
              ["Penalties",       item.est_penalties],
            ] as [string, number | null][]).map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                <Mono size={11} color={T.ink4}>{k}</Mono>
                <Mono size={11} color={T.ink2} weight={500}>{fmtMoney(item.currency_symbol, v)}</Mono>
              </div>
            ))}
            <div style={{ borderTop: `1px solid ${T.hr}`, paddingTop: 9, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <Mono size={11} color={T.ink3} weight={500}>Total Exposure</Mono>
              <Mono size={14} color={exposure > 0 ? RAG_CONFIG.A.fg : T.ink5} weight={600}>
                {fmtMoney(item.currency_symbol, exposure || null)}
              </Mono>
            </div>
          </div>

          <div style={{ marginTop: 22 }}>
            <Link
              href={`/projects/${item.project_id}/raid`}
              onClick={(e) => e.stopPropagation()}
              style={{
                fontFamily: T.mono, fontSize: 10, fontWeight: 600,
                letterSpacing: "0.1em", color: "#1d4ed8",
                textDecoration: "none",
                borderBottom: "1px solid #bfdbfe", paddingBottom: 1,
              }}
            >
              OPEN IN PROJECT REGISTER &rarr;
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Config ────────────────────────────────────────────────────────────────── */

const SCOPES:   { v: ScopeParam;   l: string }[] = [
  { v: "all", l: "All" }, { v: "window", l: "In Window" }, { v: "overdue", l: "Overdue" },
];
const TYPES: { v: TypeParam; l: string }[] = [
  { v: "all", l: "All" }, { v: "Risk", l: "Risk" },
  { v: "Issue", l: "Issue" }, { v: "Assumption", l: "Assumption" },
  { v: "Dependency", l: "Dependency" },
];
const STATUSES: { v: StatusParam; l: string }[] = [
  { v: "all", l: "All" }, { v: "open", l: "Open" },
  { v: "in_progress", l: "In Progress" },
  { v: "mitigated", l: "Mitigated" }, { v: "closed", l: "Closed" },
];
const WINDOWS = [7, 14, 30, 60] as const;
const SORTS: { v: SortKey; l: string }[] = [
  { v: "score",    l: "Risk Score"  },
  { v: "sla",      l: "SLA Threat"  },
  { v: "exposure", l: "Exposure"    },
  { v: "due_date", l: "Due Date"    },
  { v: "type",     l: "Type"        },
];

/* ─── Raise Item Modal ──────────────────────────────────────────────────────────────────────── */

const ITEM_TYPES = ["Risk","Issue","Assumption","Dependency"] as const;
const PRIORITIES = ["Critical","High","Medium","Low"] as const;

function RaiseItemModal({ projects, onClose, onSuccess }: {
  projects: { id: string; title: string; code: string | null }[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [projectId,   setProjectId]   = React.useState(projects[0]?.id ?? "");
  const [type,        setType]        = React.useState<typeof ITEM_TYPES[number]>("Risk");
  const [title,       setTitle]       = React.useState("");
  const [description, setDescription] = React.useState("");
  const [priority,    setPriority]    = React.useState<typeof PRIORITIES[number]>("Medium");
  const [dueDate,     setDueDate]     = React.useState("");
  const [probability, setProbability] = React.useState(50);
  const [severity,    setSeverity]    = React.useState(50);
  const [responsePlan,setResponsePlan]= React.useState("");
  const [owner,       setOwner]       = React.useState("");
  const [saving,      setSaving]      = React.useState(false);
  const [error,       setError]       = React.useState<string | null>(null);

  async function handleSubmit() {
    if (!title.trim())       { setError("Title is required.");       return; }
    if (!description.trim()) { setError("Description is required."); return; }
    if (!owner.trim())       { setError("Owner is required.");       return; }
    if (!projectId)          { setError("Select a project.");        return; }
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/raid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id:  projectId,
          type, priority, status: "Open",
          title:       title.trim(),
          description: description.trim(),
          due_date:    dueDate || null,
          owner_label: owner.trim(),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? ("HTTP " + res.status));
      }
      onSuccess();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  const INP: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "8px 10px",
    fontFamily: T.mono, fontSize: 12, color: T.ink,
    background: "#fff", border: "1px solid " + T.hr, borderRadius: 2, outline: "none",
  };
  const LBL: React.CSSProperties = {
    display: "block", marginBottom: 5, fontFamily: T.mono, fontSize: 9,
    fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: T.ink4,
  };

  return (
    <div style={{ position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,0.45)",
      display:"flex",alignItems:"center",justifyContent:"center",padding:24 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background:T.surface,borderRadius:4,border:"1px solid "+T.hr,
        boxShadow:"0 24px 80px rgba(0,0,0,0.2)",width:"100%",maxWidth:560,
        animation:"fadeUp 0.2s ease both",overflow:"hidden" }}>

        <div style={{ padding:"20px 24px 16px",borderBottom:"1px solid "+T.hr,
          display:"flex",justifyContent:"space-between",alignItems:"center" }}>
          <div>
            <div style={{ fontFamily:T.serif,fontSize:20,fontWeight:700,color:T.ink }}>Raise New Item</div>
            <Cap>Risk · Issue · Assumption · Dependency</Cap>
          </div>
          <button onClick={onClose} style={{ background:"none",border:"none",cursor:"pointer",
            fontFamily:T.mono,fontSize:18,color:T.ink4,padding:"4px 8px",lineHeight:1 }}>x</button>
        </div>

        <div style={{ padding:"20px 24px",display:"flex",flexDirection:"column",gap:16 }}>
          <div>
            <label style={LBL}>Project *</label>
            <select value={projectId} onChange={e => setProjectId(e.target.value)} style={INP}>
              {projects.map(p => <option key={p.id} value={p.id}>{p.code ? p.code+" — " : ""}{p.title}</option>)}
            </select>
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
            <div>
              <label style={LBL}>Type *</label>
              <select value={type} onChange={e => setType(e.target.value as any)} style={INP}>
                {ITEM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={LBL}>Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value as any)} style={INP}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label style={LBL}>Title *</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Concise title for this item" style={INP} />
          </div>
          <div>
            <label style={LBL}>Description *</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Describe the risk/issue, its impact and context..."
              rows={3} style={{ ...INP, resize:"vertical", fontFamily:T.body, fontSize:13 }} />
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16 }}>
            <div>
              <label style={LBL}>Probability: {probability}%</label>
              <input type="range" min={0} max={100} step={5} value={probability}
                onChange={e => setProbability(Number(e.target.value))}
                style={{ width:"100%", accentColor: T.ink }} />
              <div style={{ display:"flex", justifyContent:"space-between" }}>
                <span style={{ fontFamily:T.mono, fontSize:9, color:T.ink5 }}>0%</span>
                <span style={{ fontFamily:T.mono, fontSize:9, color:T.ink5 }}>100%</span>
              </div>
            </div>
            <div>
              <label style={LBL}>Severity: {severity}%</label>
              <input type="range" min={0} max={100} step={5} value={severity}
                onChange={e => setSeverity(Number(e.target.value))}
                style={{ width:"100%", accentColor: T.ink }} />
              <div style={{ display:"flex", justifyContent:"space-between" }}>
                <span style={{ fontFamily:T.mono, fontSize:9, color:T.ink5 }}>0%</span>
                <span style={{ fontFamily:T.mono, fontSize:9, color:T.ink5 }}>100%</span>
              </div>
            </div>
          </div>
          <div style={{ background:"#f5f3f0", padding:"8px 12px", borderRadius:2 }}>
            <span style={{ fontFamily:T.mono, fontSize:10, color:T.ink3 }}>
              Risk Score: <strong style={{ color: T.ink }}>{Math.round((probability * severity) / 100)}</strong>
              <span style={{ color:T.ink4 }}> = {probability}% × {severity}% ÷ 100</span>
            </span>
          </div>
          <div>
            <label style={LBL}>Response Plan / Mitigation</label>
            <textarea value={responsePlan} onChange={e => setResponsePlan(e.target.value)}
              placeholder="How will this be mitigated or managed..."
              rows={2} style={{ ...INP, resize:"vertical", fontFamily:T.body, fontSize:13 }} />
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
            <div>
              <label style={LBL}>Owner *</label>
              <input value={owner} onChange={e => setOwner(e.target.value)}
                placeholder="Name or team" style={INP} />
            </div>
            <div>
              <label style={LBL}>Due Date</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={INP} />
            </div>
          </div>
          {error && (
            <div style={{ padding:"10px 14px",borderRadius:2,
              background:RAG_CONFIG.R.bg,border:"1px solid "+RAG_CONFIG.R.border,
              fontFamily:T.mono,fontSize:11,color:RAG_CONFIG.R.fg }}>{error}</div>
          )}
        </div>

        <div style={{ padding:"14px 24px 20px",borderTop:"1px solid "+T.hr,
          display:"flex",justifyContent:"flex-end",gap:10 }}>
          <button onClick={onClose} style={{ padding:"9px 20px",fontFamily:T.mono,fontSize:10,
            fontWeight:600,letterSpacing:"0.07em",textTransform:"uppercase",
            background:"transparent",color:T.ink3,border:"1px solid "+T.hr,borderRadius:2,cursor:"pointer" }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={saving} style={{ padding:"9px 20px",
            fontFamily:T.mono,fontSize:10,fontWeight:600,letterSpacing:"0.07em",
            textTransform:"uppercase",background:saving?T.ink3:T.ink,color:"#fff",
            border:"none",borderRadius:2,cursor:saving?"default":"pointer" }}>
            {saving ? "Saving..." : "Raise Item"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main component ────────────────────────────────────────────────────────── */

export default function RaidPortfolioClient({
  defaultScope  = "all",
  defaultWindow = 30,
}: {
  defaultScope?:  ScopeParam;
  defaultWindow?: 7 | 14 | 30 | 60;
}) {
  const [data,       setData]       = useState<ApiResponse | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [mounted,    setMounted]    = useState(false);
  const [scope,      setScope]      = useState<ScopeParam>(defaultScope);
  const [type,       setType]       = useState<TypeParam>("all");
  const [status,     setStatus]     = useState<StatusParam>("all");
  const [win,        setWin]        = useState<7 | 14 | 30 | 60>(defaultWindow);
  const [sortKey,    setSortKey]    = useState<SortKey>("score");
  const [search,     setSearch]     = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showRaise,  setShowRaise]  = useState(false);
  const [showModal,  setShowModal]  = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ scope, type, status, window: String(win) });
      const res = await fetch(`/api/portfolio/raid-list?${p}`, { cache: "no-store" });
      setData(await res.json());
    } catch (e: any) {
      setData({
        ok: false, error: String(e?.message ?? "Failed"),
        scope, windowDays: win, type, status, items: [],
        meta: { projectCount: 0, scope: "org", active_only: true },
      });
    } finally {
      setLoading(false);
    }
  }, [scope, type, status, win]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const items = useMemo(() => {
    if (!data?.items) return [];
    let list = data.items;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((i) =>
        `${i.title} ${i.project_title} ${i.owner_label} ${i.type}`.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      if (sortKey === "score")    return n(b.score, -1) - n(a.score, -1);
      if (sortKey === "sla")      return n(b.sla_breach_probability, -1) - n(a.sla_breach_probability, -1);
      if (sortKey === "exposure") return totalExposure(b) - totalExposure(a);
      if (sortKey === "due_date") {
        const [ad, bd] = [a.due_date ?? "9999", b.due_date ?? "9999"];
        return ad < bd ? -1 : ad > bd ? 1 : 0;
      }
      if (sortKey === "type") return (a.type ?? "").localeCompare(b.type ?? "");
      return 0;
    });
  }, [data, search, sortKey]);

  const kpis = useMemo(() => {
    if (!data?.items?.length) return null;
    const all = data.items;
    return {
      total:    all.length,
      critical: all.filter((i) => itemRag(i) === "R").length,
      advisory: all.filter((i) => itemRag(i) === "A").length,
      overdue:  all.filter(isOverdue).length,
      exposure: all.reduce((s, i) => s + totalExposure(i), 0),
      sym:      all.find((i) => i.currency_symbol)?.currency_symbol ?? "£",
    };
  }, [data]);

  const raiseProjects = useMemo(() => {
    if (!data?.items?.length) return [];
    const seen = new Set<string>();
    return data.items
      .filter(i => { if (seen.has(i.project_id)) return false; seen.add(i.project_id); return true; })
      .map(i => ({ id: i.project_id, title: i.project_title, code: i.project_code }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [data]);

  /* ── Table cell styles ── */
  const TH: React.CSSProperties = {
    padding: "9px 16px",
    fontFamily: T.mono, fontSize: 9, fontWeight: 600,
    letterSpacing: "0.12em", textTransform: "uppercase",
    color: T.ink4, textAlign: "left",
    borderBottom: `1px solid ${T.hr}`,
    background: "#f5f3f0",
    whiteSpace: "nowrap",
  };
  const TD: React.CSSProperties = {
    padding: "14px 16px",
    verticalAlign: "middle",
    borderBottom: `1px solid ${T.hr}`,
  };

  return (
    <>
      <style>{`
        @import url("${FONT_URL}");

        @keyframes ragPulse {
          0%, 100% { transform: scale(1);   opacity: 0.2; }
          50%       { transform: scale(2.4); opacity: 0.08; }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes drawerOpen {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .raid-row { transition: background 0.1s; }
        .raid-row:hover { background: #f9f7f4 !important; }
        .raid-row:hover .item-title { color: #1c1917 !important; }
        input::placeholder { color: #a8a29e; }
        input:focus { outline: none; border-color: #a8a29e !important; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #d6d3d1; border-radius: 2px; }
      `}</style>

      <div style={{
        minHeight: "100vh", background: T.bg,
        fontFamily: T.mono,
        opacity: mounted ? 1 : 0, transition: "opacity 0.35s ease",
      }}>
        <div style={{ maxWidth: 1360, margin: "0 auto", padding: "40px 40px 100px" }}>

          {/* ── Masthead ── */}
          <div style={{
            borderBottom: `2px solid ${T.ink}`,
            paddingBottom: 22, marginBottom: 30,
            animation: "fadeUp 0.4s ease both",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Link href="/insights" style={{ fontFamily: T.mono, fontSize: 10, color: T.ink4, textDecoration: "none", letterSpacing: "0.08em" }}>
                  &larr; PORTFOLIO INTELLIGENCE
                </Link>
                <span style={{ color: T.ink5 }}>·</span>
                <Cap>RAID REGISTER</Cap>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <Mono size={10} color={T.ink5}>{nowUK()}</Mono>
                <div style={{ position: "relative" }}>
                  <button
                    onClick={() => setShowModal(true)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "7px 16px",
                      fontFamily: T.mono, fontSize: 10, fontWeight: 600,
                      letterSpacing: "0.07em", textTransform: "uppercase",
                      background: T.ink, color: "#fff",
                      border: "none", borderRadius: 2, cursor: "pointer",
                    }}
                  >
                    <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
                    Raise Risk / Issue
                  </button>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 32 }}>
              <div>
                <h1 style={{
                  fontFamily: T.serif, fontSize: 42, fontWeight: 700, margin: 0,
                  letterSpacing: "-0.02em", lineHeight: 1.05, color: T.ink,
                }}>
                  RAID Portfolio Register
                </h1>
                <p style={{
                  fontFamily: T.body, fontSize: 14, color: T.ink3,
                  marginTop: 8, fontWeight: 300, lineHeight: 1.5, maxWidth: 560,
                }}>
                  Consolidated risks, issues, assumptions and dependencies across all active projects — scored, ranked and ready for action.
                </p>
              </div>
              {data?.meta && (
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <Mono size={10} color={T.ink4} upper>{data.meta.projectCount} active projects</Mono>
                  <div style={{ marginTop: 4 }}>
                    <Mono size={10} color={T.ink5} upper>Org scope · live</Mono>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── KPI strip ── */}
          {kpis && (
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(5, 1fr)",
              border: `1px solid ${T.hr}`, background: T.surface,
              marginBottom: 24,
              animation: "fadeUp 0.4s 0.08s ease both",
            }}>
              <KpiCell label="Total Items"     value={kpis.total}    sub={`${data!.meta.projectCount} projects`} />
              <KpiCell label="Critical"        value={kpis.critical} sub="score ≥ 70 or overdue" alert={kpis.critical > 0} />
              <KpiCell label="Advisory"        value={kpis.advisory} sub="score 40–69" />
              <KpiCell label="Overdue"         value={kpis.overdue}  sub="past due date" alert={kpis.overdue > 0} />
              <div style={{ padding: "22px 28px" }}>
                <Cap>Total Exposure</Cap>
                <div style={{
                  fontFamily: T.serif, fontSize: 40, fontWeight: 700, lineHeight: 1,
                  marginTop: 10, marginBottom: 6,
                  color: kpis.exposure > 0 ? RAG_CONFIG.A.fg : T.ink4,
                }}>
                  {kpis.exposure > 0 ? fmtMoney(kpis.sym, kpis.exposure) : "\u2014"}
                </div>
                <Cap>cost + revenue + penalties</Cap>
              </div>
            </div>
          )}

          {/* ── Controls ── */}
          <div style={{
            background: T.surface, border: `1px solid ${T.hr}`,
            padding: "14px 18px", marginBottom: 12,
            display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center",
            animation: "fadeUp 0.4s 0.14s ease both",
          }}>
            <div style={{ display: "flex", gap: 3 }}>
              {SCOPES.map((s) => <Pill key={s.v} label={s.l} active={scope === s.v} onClick={() => setScope(s.v)} />)}
            </div>
            <div style={{ width: 1, height: 20, background: T.hr }} />
            <div style={{ display: "flex", gap: 3 }}>
              {TYPES.map((t) => (
                <Pill key={t.v} label={t.l} active={type === t.v}
                  dotColor={t.v !== "all" ? TYPE_COLOR[t.v] : undefined}
                  onClick={() => setType(t.v)}
                />
              ))}
            </div>
            <div style={{ width: 1, height: 20, background: T.hr }} />
            <div style={{ display: "flex", gap: 3 }}>
              {STATUSES.map((s) => <Pill key={s.v} label={s.l} active={status === s.v} onClick={() => setStatus(s.v)} />)}
            </div>
            <div style={{ width: 1, height: 20, background: T.hr }} />
            <div style={{ display: "flex", gap: 3 }}>
              {WINDOWS.map((w) => <Pill key={w} label={`${w}D`} active={win === w} onClick={() => setWin(w)} />)}
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, project, owner…"
              style={{
                marginLeft: "auto", padding: "6px 12px",
                fontFamily: T.mono, fontSize: 11,
                background: T.bg, border: `1px solid ${T.hr}`,
                borderRadius: 2, color: T.ink, width: 234,
                transition: "border-color 0.15s",
              }}
            />
          </div>

          {/* ── Sort bar ── */}
          <div style={{
            display: "flex", alignItems: "center", gap: 6, marginBottom: 14,
            animation: "fadeUp 0.4s 0.18s ease both",
          }}>
            <Cap>Sort:</Cap>
            <div style={{ display: "flex", gap: 3, marginLeft: 4 }}>
              {SORTS.map((s) => <Pill key={s.v} label={s.l} active={sortKey === s.v} onClick={() => setSortKey(s.v)} />)}
            </div>
            <div style={{ marginLeft: "auto" }}>
              {loading
                ? <Mono size={10} color={T.ink5}>LOADING…</Mono>
                : <Mono size={10} color={T.ink4}>{items.length} ITEMS</Mono>
              }
            </div>
          </div>

          {/* ── Error ── */}
          {!loading && data && !data.ok && (
            <div style={{
              background: RAG_CONFIG.R.bg,
              border: `1px solid ${RAG_CONFIG.R.border}`,
              borderLeft: `3px solid ${RAG_CONFIG.R.fg}`,
              padding: "18px 24px",
            }}>
              <Cap>Data Error</Cap>
              <p style={{ fontFamily: T.body, fontSize: 13, color: RAG_CONFIG.R.fg, margin: "8px 0 0" }}>
                {data.error}
              </p>
            </div>
          )}

          {/* ── Loading ── */}
          {loading && (
            <div style={{
              background: T.surface, border: `1px solid ${T.hr}`,
              padding: "64px", textAlign: "center",
            }}>
              <Mono size={11} color={T.ink5}>RETRIEVING RAID DATA…</Mono>
            </div>
          )}

          {/* ── Table ── */}
          {!loading && data?.ok && (
            <div style={{
              background: T.surface, border: `1px solid ${T.hr}`,
              overflow: "hidden",
              animation: "fadeUp 0.4s 0.22s ease both",
            }}>
              {items.length === 0 ? (
                <div style={{ padding: "64px", textAlign: "center" }}>
                  <Mono size={12} color={T.ink5}>No items match the current filters.</Mono>
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
                    <thead>
                      <tr>
                        <th style={{ ...TH, width: 3, padding: 0 }} />
                        <th style={{ ...TH, minWidth: 310 }}>Item</th>
                        <th style={{ ...TH, width: 105 }}>Risk Score</th>
                        <th style={{ ...TH, width: 115 }}>SLA Threat</th>
                        <th style={{ ...TH, width: 115 }}>Exposure</th>
                        <th style={{ ...TH, width: 105 }}>Due Date</th>
                        <th style={{ ...TH, width: 100 }}>Status</th>
                        <th style={{ ...TH, width: 170 }}>Project</th>
                        <th style={{ ...TH, width: 30, textAlign: "center" as const }} />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, idx) => {
                        const rag      = itemRag(item);
                        const over     = isOverdue(item);
                        const slr      = slaRag(item.sla_breach_probability, item.sla_days_to_breach);
                        const exposure = totalExposure(item);
                        const expanded = expandedId === item.id;
                        const rc       = RAG_CONFIG[rag];

                        return (
                          <React.Fragment key={item.id}>
                            <tr
                              className="raid-row"
                              onClick={() => setExpandedId(expanded ? null : item.id)}
                              style={{ cursor: "pointer", background: expanded ? "#faf9f7" : T.surface }}
                            >
                              {/* RAG strip */}
                              <td style={{ width: 3, padding: 0 }}>
                                <div style={{
                                  width: 3, minHeight: 58,
                                  background: rag === "N" ? "transparent" : rc.fg,
                                  opacity: rag === "G" ? 0.45 : 1,
                                }} />
                              </td>

                              {/* Item */}
                              <td style={{ ...TD, minWidth: 310 }}>
                                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                  <TypeFlag type={item.type} />
                                  <div className="item-title" style={{
                                    fontFamily: T.body, fontSize: 13.5, color: T.ink2,
                                    fontWeight: 400, lineHeight: 1.35,
                                    transition: "color 0.1s",
                                  }}>
                                    {item.title}
                                  </div>
                                  {item.owner_label && (
                                    <Mono size={10} color={T.ink4}>&darr; {item.owner_label}</Mono>
                                  )}
                                </div>
                              </td>

                              {/* Score */}
                              <td style={TD}><ScoreMeter score={item.score} /></td>

                              {/* SLA */}
                              <td style={TD}>
                                {slr === "N" ? (
                                  <Mono color={T.ink5}>—</Mono>
                                ) : (
                                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                      <Pip rag={slr} pulse={slr === "R"} />
                                      <Mono size={12} color={RAG_CONFIG[slr].fg} weight={600}>
                                        {item.sla_breach_probability != null
                                          ? `${item.sla_breach_probability}%`
                                          : "—"
                                        }
                                      </Mono>
                                    </div>
                                    {item.sla_days_to_breach != null && (
                                      <Mono size={10} color={T.ink4}>~{item.sla_days_to_breach}d</Mono>
                                    )}
                                  </div>
                                )}
                              </td>

                              {/* Exposure */}
                              <td style={TD}>
                                <Mono
                                  size={12}
                                  color={exposure > 500_000 ? RAG_CONFIG.A.fg : exposure > 0 ? T.ink3 : T.ink5}
                                  weight={exposure > 0 ? 600 : 400}
                                >
                                  {fmtMoney(item.currency_symbol, exposure || null)}
                                </Mono>
                              </td>

                              {/* Due */}
                              <td style={TD}>
                                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                  <Mono
                                    size={12}
                                    color={over ? RAG_CONFIG.R.fg : item.due_date ? T.ink3 : T.ink5}
                                    weight={over ? 600 : 400}
                                  >
                                    {item.due_date_uk ?? "—"}
                                  </Mono>
                                  {over && <Mono size={9} color={RAG_CONFIG.R.fg} weight={600} upper>Overdue</Mono>}
                                </div>
                              </td>

                              {/* Status */}
                              <td style={TD}><StatusChip status={item.status} /></td>

                              {/* Project */}
                              <td style={{ ...TD, maxWidth: 170 }}>
                                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  <Mono size={11} color={T.ink4}>{item.project_title}</Mono>
                                </div>
                              </td>

                              {/* Toggle */}
                              <td style={{ ...TD, textAlign: "center" as const, paddingLeft: 6, paddingRight: 12 }}>
                                <span style={{
                                  display: "inline-block",
                                  fontFamily: T.mono, fontSize: 11, color: T.ink4,
                                  transform: expanded ? "rotate(180deg)" : "none",
                                  transition: "transform 0.2s ease",
                                }}>
                                  ▾
                                </span>
                              </td>
                            </tr>

                            {/* Expanded detail */}
                            {expanded && (
                              <tr>
                                <td colSpan={9} style={{ padding: 0, borderBottom: `1px solid ${T.hr}` }}>
                                  <DetailDrawer item={item} />
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Footer ── */}
          {!loading && data?.ok && (
            <div style={{
              marginTop: 24, display: "flex", justifyContent: "space-between",
              alignItems: "center", paddingTop: 16, borderTop: `1px solid ${T.hr}`,
            }}>
              <Mono size={10} color={T.ink5} upper>
                Org scope · active projects only · {data.meta.projectCount} projects · {items.length} items
              </Mono>
              <Mono size={10} color={T.ink5}>{nowUK()}</Mono>
            </div>
          )}

        </div>
      </div>
      {showModal && (
        <RaiseItemModal
          projects={raiseProjects}
          onClose={() => setShowModal(false)}
          onSuccess={() => fetchData()}
        />
      )}
    </>
  );
}