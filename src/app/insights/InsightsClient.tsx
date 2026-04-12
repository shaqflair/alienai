"use client";

// src/app/insights/InsightsClient.tsx — Executive Intelligence Dossier v6
// Data sources:
//   /api/portfolio/raid-exec-summary  — RAID portfolio executive brief
//   /api/portfolio/raid-list          — full RAID item list + financials
//   /api/portfolio/health             — portfolio health score + drivers
//   /api/ai/briefing                  — AI insights feed
//   /api/portfolio/intelligence       — Pre-Mortem AI + Decision Engine + Truth Layer + Boardroom Mode

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import BoardroomMode from "@/components/portfolio/BoardroomMode";
import DependencyGraphView from "@/components/portfolio/DependencyGraphView";
import OrgMemoryCard from "@/components/portfolio/OrgMemoryCard";

const FONT_URL =
  "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@300;400;500;600&family=Source+Serif+4:opsz,wght@8..60,300;400;600&display=swap";

type WindowDays = 7 | 14 | 30 | 60;
type Rag = "R" | "A" | "G" | "N";

type ExecSummary = {
  ok: true;
  org_name?: string | null;
  client_name?: string | null;
  scope: string;
  days: number;
  summary: { headline: string; generated_at: string };
  kpis: {
    total_items: number;
    overdue_open: number;
    high_score: number;
    sla_hot: number;
    exposure_total: number;
    exposure_total_fmt?: string;
  };
  sections: { key: string; title: string; items: ExecItem[] }[];
  meta?: any;
};

type ExecItem = {
  id: string;
  public_id?: string | null;
  project_id?: string | null;
  project_title?: string | null;
  project_code_label?: string | null;
  type?: string | null;
  title?: string | null;
  score?: number | null;
  due_date?: string | null;
  owner_label?: string | null;
  sla_breach_probability?: number | null;
  sla_days_to_breach?: number | null;
  exposure_total?: number | null;
  exposure_total_fmt?: string | null;
  overdue?: boolean | null;
  note?: string | null;
  prompt?: string | null;
  href?: string | null;
};

type HealthApi = {
  ok: true;
  portfolio_health: number;
  projectCount: number;
  days: number;
  parts: { schedule: number; raid: number; flow: number; approvals: number; activity: number };
  drivers?: any[];
};

type BriefingInsight = {
  id: string;
  severity: "high" | "medium" | "info";
  title: string;
  body: string;
  href?: string | null;
};

type FinanceItem = {
  id: string;
  public_id: string | null;
  project_id: string;
  project_title: string;
  project_code: string | null;
  type: string;
  title: string;
  status: string;
  currency_symbol: string;
  est_cost_impact: number | null;
  est_revenue_at_risk: number | null;
  est_penalties: number | null;
  total_exposure: number;
  score: number | null;
  due_date: string | null;
  due_date_uk: string | null;
};

type PortfolioIntelligenceData = {
  ok: true;
  totalProjects: number;
  scoredProjects: number;
  avgFailureRisk: number;
  portfolioRiskBand: string;
  criticalCount: number;
  highCount: number;
  moderateCount: number;
  lowCount: number;
  falseGreenCount: number;
  materialGapCount: number;
  reportingTrustScore: number;
  worseningCount: number;
  improvingCount: number;
  projects: Array<{
    project_id: string;
    project_title: string;
    project_code: string | null;
    pm_name: string | null;
    declared_status: string | null;
    failure_risk_score: number;
    failure_risk_band: string;
    confidence_score: number;
    direction: string | null;
    hidden_risk: boolean;
    schedule_score: number;
    governance_score: number;
    budget_score: number;
    stability_score: number;
    top_drivers: any[];
    recommended_actions: any[];
    narrative: { executive: string; delivery: string };
    generated_at: string;
    has_snapshot: boolean;
    evidence_status: "green" | "amber" | "red";
    gap: "none" | "minor" | "material" | "critical";
    is_false_green: boolean;
  }>;
  topDecisions: Array<{
    project_id: string;
    project_title: string;
    action: string;
    rationale: string;
    pillar: string;
    priority: string;
    score_impact: number;
    risk_reduction_pct: number;
    owner_hint: string;
  }>;
};

export type RaiseItemProjectOption = {
  id: string;
  title: string;
  code: string | null;
};

const T = {
  bg: "#f9f7f4",
  surface: "#ffffff",
  hr: "#e7e5e4",
  ink: "#1c1917",
  ink2: "#44403c",
  ink3: "#78716c",
  ink4: "#a8a29e",
  ink5: "#d6d3d1",
  mono: "'IBM Plex Mono', 'Menlo', monospace",
  serif: "'Playfair Display', 'Georgia', serif",
  body: "'Source Serif 4', 'Georgia', serif",
};

const RAG: Record<Rag, { fg: string; bg: string; border: string; label: string }> = {
  R: { fg: "#7f1d1d", bg: "#fef2f2", border: "#fca5a5", label: "CRITICAL" },
  A: { fg: "#78350f", bg: "#fffbeb", border: "#fcd34d", label: "ADVISORY" },
  G: { fg: "#14532d", bg: "#f0fdf4", border: "#86efac", label: "CLEAR" },
  N: { fg: "#57534e", bg: "#fafaf9", border: "#e7e5e4", label: "—" },
};

function num(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function nowUK() {
  return new Date()
    .toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    .replace(",", "");
}

function fmtUkDate(x: any) {
  if (!x) return "—";
  const s = String(x).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

function scoreRag(score: number | null): Rag {
  if (score == null) return "N";
  if (score >= 70) return "R";
  if (score >= 40) return "A";
  return "G";
}

function healthRag(score: number): Rag {
  if (score >= 85) return "G";
  if (score >= 70) return "A";
  return "R";
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const r = await fetch(url, init);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

function cleanText(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : String(v ?? "").trim();
  return s || null;
}

function buildProjectRaidHref(projectId: string | null | undefined): string | null {
  const pid = cleanText(projectId);
  if (!pid) return null;
  return `/projects/${encodeURIComponent(pid)}/raid`;
}

function canonicalRaidHref(rawHref?: string | null, projectId?: string | null): string | null {
  const directProjectHref = buildProjectRaidHref(projectId);
  const raw = cleanText(rawHref);
  if (!raw) return directProjectHref;
  if (raw.startsWith("/projects/")) {
    const match = raw.match(/^\/projects\/([^/?#]+)\/raid(?:[/?#].*)?$/i);
    if (match?.[1]) return `/projects/${encodeURIComponent(match[1])}/raid`;
  }
  if (raw.startsWith("/portfolio/raid")) {
    try {
      const url = new URL(raw, "http://localhost");
      const pid = cleanText(url.searchParams.get("projectId")) || cleanText(url.searchParams.get("project_id")) || cleanText(url.searchParams.get("id")) || cleanText(projectId);
      return buildProjectRaidHref(pid);
    } catch { return directProjectHref; }
  }
  if (raw.includes("/projects/") && raw.includes("/raid")) {
    const idx = raw.indexOf("/projects/");
    const sliced = raw.slice(idx);
    const match = sliced.match(/^\/projects\/([^/?#]+)\/raid(?:[/?#].*)?$/i);
    if (match?.[1]) return `/projects/${encodeURIComponent(match[1])}/raid`;
  }
  return directProjectHref;
}

function Mono({ children, size = 11, color, weight = 400, upper = false }: { children: React.ReactNode; size?: number; color?: string; weight?: number; upper?: boolean }) {
  return (
    <span style={{ fontFamily: T.mono, fontSize: size, color: color ?? T.ink3, fontWeight: weight, letterSpacing: upper ? "0.08em" : undefined, textTransform: upper ? "uppercase" : undefined }}>
      {children}
    </span>
  );
}

function Cap({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.13em", textTransform: "uppercase", color: T.ink4 }}>
      {children}
    </span>
  );
}

function Pip({ rag, pulse }: { rag: Rag; pulse?: boolean }) {
  const color = rag === "N" ? T.ink5 : RAG[rag].fg;
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 10, height: 10 }}>
      {pulse && rag === "R" && <span style={{ position: "absolute", inset: -3, borderRadius: "50%", background: color, opacity: 0.2, animation: "ragPulse 2.2s ease-in-out infinite" }} />}
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block" }} />
    </span>
  );
}

function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 12px", fontFamily: T.mono, fontSize: 10, fontWeight: active ? 600 : 400, letterSpacing: "0.07em", textTransform: "uppercase", background: active ? T.ink : "transparent", color: active ? "#fff" : T.ink3, border: `1px solid ${active ? T.ink : T.hr}`, borderRadius: 2, cursor: "pointer", transition: "all 0.13s ease" }}>
      {label}
    </button>
  );
}

function SectionRule({ label }: { label?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      {label && <Cap>{label}</Cap>}
      <div style={{ flex: 1, height: "1px", background: T.hr }} />
    </div>
  );
}

const ITEM_TYPES = ["Risk", "Issue", "Assumption", "Dependency"] as const;
const PRIORITIES = ["Critical", "High", "Medium", "Low"] as const;
const IMPACTS = ["low", "medium", "high", "critical"] as const;

export function RaiseItemModal({ projects, onClose, onSuccess, lockedProjectId, lockedProjectTitle, lockedProjectCode }: { projects: RaiseItemProjectOption[]; onClose: () => void; onSuccess: () => void; lockedProjectId?: string | null; lockedProjectTitle?: string | null; lockedProjectCode?: string | null }) {
  const effectiveProjects = useMemo<RaiseItemProjectOption[]>(() => {
    if (lockedProjectId) return [{ id: lockedProjectId, title: lockedProjectTitle || "Project", code: lockedProjectCode || null }];
    return projects;
  }, [projects, lockedProjectId, lockedProjectTitle, lockedProjectCode]);

  const [projectId, setProjectId] = useState(lockedProjectId || effectiveProjects[0]?.id || "");
  const [type, setType] = useState<(typeof ITEM_TYPES)[number]>("Risk");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("Medium");
  const [dueDate, setDueDate] = useState("");
  const [probability, setProbability] = useState(50);
  const [severity, setSeverity] = useState(50);
  const [responsePlan, setResponsePlan] = useState("");
  const [impact, setImpact] = useState<(typeof IMPACTS)[number]>("medium");
  const [nextSteps, setNextSteps] = useState("");
  const [notes, setNotes] = useState("");
  const [owner, setOwner] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiDrafting, setAiDrafting] = useState(false);
  const [aiDraftErr, setAiDraftErr] = useState<string | null>(null);
  const [aiDraftDone, setAiDraftDone] = useState(false);

  useEffect(() => {
    if (lockedProjectId) { setProjectId(lockedProjectId); return; }
    if (!projectId && effectiveProjects[0]?.id) setProjectId(effectiveProjects[0].id);
  }, [lockedProjectId, effectiveProjects, projectId]);

  async function handleAiDraft() {
    if (!aiPrompt.trim()) return;
    setAiDrafting(true); setAiDraftErr(null); setAiDraftDone(false);
    try {
      const res = await fetch("/api/raid/ai-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: aiPrompt, projectId }) });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "AI draft failed");
      const d = j.draft ?? {};
      if (d.type && ITEM_TYPES.includes(d.type)) setType(d.type);
      if (d.priority && PRIORITIES.includes(d.priority)) setPriority(d.priority);
      if (d.impact && IMPACTS.includes(d.impact)) setImpact(d.impact);
      if (d.title) setTitle(d.title);
      if (d.description) setDescription(d.description);
      if (d.probability != null) setProbability(Math.max(0, Math.min(100, Number(d.probability) || 0)));
      if (d.severity != null) setSeverity(Math.max(0, Math.min(100, Number(d.severity) || 0)));
      if (d.response_plan) setResponsePlan(d.response_plan);
      if (d.next_steps) setNextSteps(d.next_steps);
      if (d.notes) setNotes(d.notes);
      setAiDraftDone(true);
    } catch (e: any) {
      setAiDraftErr(e?.message ?? "AI draft failed");
    } finally { setAiDrafting(false); }
  }

  async function handleSubmit() {
    if (!title.trim()) { setError("Title is required."); return; }
    if (!description.trim()) { setError("Description is required."); return; }
    if (!owner.trim()) { setError("Owner is required."); return; }
    if (!projectId) { setError("Select a project."); return; }
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/raid", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, type, priority, status: "Open", title: title.trim(), description: description.trim(), due_date: dueDate || null, owner_label: owner.trim(), probability, severity, impact, response_plan: responsePlan.trim() || null, next_steps: nextSteps.trim() || null, notes: notes.trim() || null }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error ?? `HTTP ${res.status}`); }
      onSuccess(); onClose();
    } catch (e: any) { setError(e?.message ?? "Failed to save."); } finally { setSaving(false); }
  }

  const INP: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "8px 10px", fontFamily: T.mono, fontSize: 12, color: T.ink, background: "#fff", border: "1px solid " + T.hr, borderRadius: 2, outline: "none" };
  const LBL: React.CSSProperties = { display: "block", marginBottom: 5, fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: T.ink4 };
  const projectLocked = Boolean(lockedProjectId);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: T.surface, borderRadius: 4, border: "1px solid " + T.hr, boxShadow: "0 24px 80px rgba(0,0,0,0.2)", width: "100%", maxWidth: 560, animation: "fadeUp 0.2s ease both", overflow: "hidden", maxHeight: "92vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid " + T.hr, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div><div style={{ fontFamily: T.serif, fontSize: 20, fontWeight: 700, color: T.ink }}>Raise New Item</div><Cap>Risk · Issue · Assumption · Dependency</Cap></div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: T.mono, fontSize: 18, color: T.ink4, padding: "4px 8px", lineHeight: 1 }}>x</button>
        </div>
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16, overflowY: "auto", flex: 1 }}>
          <div style={{ background: "linear-gradient(135deg,#0f172a 0%,#1e293b 100%)", borderRadius: 4, padding: "14px 16px", border: "1px solid #334155" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 16 }}>✨</span>
              <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "#e2e8f0", textTransform: "uppercase" }}>AI Draft Assistant</span>
              <span style={{ fontFamily: T.mono, fontSize: 9, color: "#64748b", marginLeft: "auto" }}>Describe the situation, AI fills the form</span>
            </div>
            <textarea value={aiPrompt} onChange={(e) => { setAiPrompt(e.target.value); setAiDraftDone(false); }} placeholder="e.g. Our key supplier may not deliver the integration module by go-live..." rows={3} style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", fontFamily: T.body, fontSize: 13, color: "#f1f5f9", background: "rgba(255,255,255,0.07)", border: "1px solid #334155", borderRadius: 2, resize: "vertical", outline: "none" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <button onClick={handleAiDraft} disabled={aiDrafting || !aiPrompt.trim()} style={{ padding: "8px 18px", fontFamily: T.mono, fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", background: aiDrafting ? "#334155" : "#6366f1", color: "#fff", border: "none", borderRadius: 2, cursor: aiDrafting || !aiPrompt.trim() ? "default" : "pointer", opacity: !aiPrompt.trim() ? 0.5 : 1 }}>
                {aiDrafting ? "Drafting…" : "✨ AI Draft"}
              </button>
              {aiDraftDone && <span style={{ fontFamily: T.mono, fontSize: 10, color: "#4ade80" }}>✓ Form filled — review and adjust below</span>}
              {aiDraftErr && <span style={{ fontFamily: T.mono, fontSize: 10, color: "#f87171" }}>{aiDraftErr}</span>}
            </div>
          </div>
          <div>
            <label style={LBL}>Project *</label>
            {projectLocked ? (
              <div style={{ ...INP, background: "#f5f3f0", color: T.ink2 }}>{lockedProjectCode ? `${lockedProjectCode} — ` : ""}{lockedProjectTitle || "Project"}</div>
            ) : (
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={INP}>{effectiveProjects.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} — ` : ""}{p.title}</option>)}</select>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div><label style={LBL}>Type *</label><select value={type} onChange={(e) => setType(e.target.value as any)} style={INP}>{ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
            <div><label style={LBL}>Priority</label><select value={priority} onChange={(e) => setPriority(e.target.value as any)} style={INP}>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
            <div><label style={LBL}>Impact</label><select value={impact} onChange={(e) => setImpact(e.target.value as any)} style={INP}>{IMPACTS.map((v) => <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>)}</select></div>
          </div>
          <div><label style={LBL}>Title *</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Concise title for this item" style={INP} /></div>
          <div><label style={LBL}>Description *</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the risk/issue, its impact and context..." rows={3} style={{ ...INP, resize: "vertical", fontFamily: T.body, fontSize: 13 }} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <label style={LBL}>Probability: {probability}%</label>
              <input type="range" min={0} max={100} step={5} value={probability} onChange={(e) => setProbability(Number(e.target.value))} style={{ width: "100%", accentColor: T.ink }} />
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontFamily: T.mono, fontSize: 9, color: T.ink5 }}>0%</span><span style={{ fontFamily: T.mono, fontSize: 9, color: T.ink5 }}>100%</span></div>
            </div>
            <div>
              <label style={LBL}>Severity: {severity}%</label>
              <input type="range" min={0} max={100} step={5} value={severity} onChange={(e) => setSeverity(Number(e.target.value))} style={{ width: "100%", accentColor: T.ink }} />
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontFamily: T.mono, fontSize: 9, color: T.ink5 }}>0%</span><span style={{ fontFamily: T.mono, fontSize: 9, color: T.ink5 }}>100%</span></div>
            </div>
          </div>
          <div style={{ background: "#f5f3f0", padding: "8px 12px", borderRadius: 2 }}>
            <span style={{ fontFamily: T.mono, fontSize: 10, color: T.ink3 }}>Risk Score: <strong style={{ color: T.ink }}>{Math.round((probability * severity) / 100)}</strong><span style={{ color: T.ink4 }}> = {probability}% × {severity}% ÷ 100</span></span>
          </div>
          <div><label style={LBL}>Response Plan / Mitigation</label><textarea value={responsePlan} onChange={(e) => setResponsePlan(e.target.value)} placeholder="How will this be mitigated or managed..." rows={2} style={{ ...INP, resize: "vertical", fontFamily: T.body, fontSize: 13 }} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label style={LBL}>Next Steps</label><textarea value={nextSteps} onChange={(e) => setNextSteps(e.target.value)} placeholder="Immediate actions to take..." rows={2} style={{ ...INP, resize: "vertical", fontFamily: T.body, fontSize: 13 }} /></div>
            <div><label style={LBL}>Notes</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional context or comments..." rows={2} style={{ ...INP, resize: "vertical", fontFamily: T.body, fontSize: 13 }} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label style={LBL}>Owner *</label><input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Name or team" style={INP} /></div>
            <div><label style={LBL}>Due Date</label><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={INP} /></div>
          </div>
          {error && <div style={{ padding: "10px 14px", borderRadius: 2, background: RAG.R.bg, border: "1px solid " + RAG.R.border, fontFamily: T.mono, fontSize: 11, color: RAG.R.fg }}>{error}</div>}
        </div>
        <div style={{ padding: "14px 24px 20px", borderTop: "1px solid " + T.hr, display: "flex", justifyContent: "flex-end", gap: 10, flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: "9px 20px", fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", background: "transparent", color: T.ink3, border: "1px solid " + T.hr, borderRadius: 2, cursor: "pointer" }}>Cancel</button>
          <button onClick={handleSubmit} disabled={saving} style={{ padding: "9px 20px", fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", background: saving ? T.ink3 : T.ink, color: "#fff", border: "none", borderRadius: 2, cursor: saving ? "default" : "pointer" }}>{saving ? "Saving..." : "Raise Item"}</button>
        </div>
      </div>
    </div>
  );
}

function HealthMeter({ score, parts }: { score: number; parts?: HealthApi["parts"] }) {
  const rag = healthRag(score);
  const color = RAG[rag].fg;
  const partLabels = parts ? [{ k: "Schedule", v: parts.schedule }, { k: "RAID", v: parts.raid }, { k: "Flow", v: parts.flow }, { k: "Approvals", v: parts.approvals }, { k: "Activity", v: parts.activity }] : [];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
        <div style={{ fontFamily: T.serif, fontSize: 72, fontWeight: 700, lineHeight: 1, color, letterSpacing: "-0.02em" }}>{score}<span style={{ fontFamily: T.mono, fontSize: 28, color: T.ink4, fontWeight: 300 }}>%</span></div>
        <div>
          <div style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: RAG[rag].fg, background: RAG[rag].bg, border: `1px solid ${RAG[rag].border}`, padding: "3px 8px", borderRadius: 2, display: "inline-block" }}>{RAG[rag].label}</div>
          <div style={{ marginTop: 6 }}><Cap>Portfolio Health Score</Cap></div>
        </div>
      </div>
      <div style={{ height: 4, background: T.hr, borderRadius: 4, overflow: "hidden", marginBottom: 20 }}><div style={{ height: "100%", width: `${score}%`, background: color, borderRadius: 4, transition: "width 1s ease" }} /></div>
      {partLabels.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {partLabels.map(({ k, v }) => {
            const pr = healthRag(v);
            return (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Mono size={10} color={T.ink4} upper>{k}</Mono>
                <div style={{ flex: 1, height: 2, background: T.hr, borderRadius: 2, overflow: "hidden" }}><div style={{ height: "100%", width: `${v}%`, background: RAG[pr].fg, borderRadius: 2, opacity: 0.7 }} /></div>
                <Mono size={11} color={RAG[pr].fg} weight={600}>{v}</Mono>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function KpiCell({ label, value, alert, sub }: { label: string; value: string | number; alert?: boolean; sub?: string }) {
  return (
    <div style={{ padding: "20px 24px", borderRight: `1px solid ${T.hr}` }}>
      <Cap>{label}</Cap>
      <div style={{ fontFamily: T.serif, fontSize: 36, fontWeight: 700, lineHeight: 1, marginTop: 8, marginBottom: 4, color: alert ? RAG.R.fg : T.ink }}>{value}</div>
      {sub && <Cap>{sub}</Cap>}
    </div>
  );
}

function SevBadge({ sev }: { sev: "high" | "medium" | "info" }) {
  const cfg = { high: { fg: RAG.R.fg, bg: RAG.R.bg, bd: RAG.R.border, label: "HIGH" }, medium: { fg: RAG.A.fg, bg: RAG.A.bg, bd: RAG.A.border, label: "MEDIUM" }, info: { fg: "#1e40af", bg: "#eff6ff", bd: "#bfdbfe", label: "INFO" } }[sev];
  return <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", color: cfg.fg, background: cfg.bg, border: `1px solid ${cfg.bd}`, padding: "2px 7px", borderRadius: 2 }}>{cfg.label}</span>;
}

function RaidItemRow({ item, expanded, onToggle }: { item: ExecItem; expanded: boolean; onToggle: () => void }) {
  const rag = scoreRag(item.score ?? null);
  const rc = RAG[rag];
  const over = item.overdue;
  const projectRaidHref = canonicalRaidHref(item.href, item.project_id);
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer", background: expanded ? "#faf9f7" : T.surface, transition: "background 0.1s" }} className="raid-row">
        <td style={{ width: 3, padding: 0 }}><div style={{ width: 3, minHeight: 52, background: rag === "N" ? "transparent" : rc.fg, opacity: rag === "G" ? 0.4 : 1 }} /></td>
        <td style={{ padding: "12px 16px", verticalAlign: "middle" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {item.public_id && <Mono size={9} color={T.ink3} weight={700} upper>{item.public_id}</Mono>}
              <Mono size={9} color={T.ink4} weight={600} upper>{item.type || "RAID"}</Mono>
              {over && <Mono size={9} color={RAG.R.fg} weight={600} upper>Overdue</Mono>}
            </div>
            <div style={{ fontFamily: T.body, fontSize: 13, color: T.ink2, fontWeight: 400, lineHeight: 1.3 }}>{item.title}</div>
            {item.project_title && <Mono size={10} color={T.ink4}>{item.project_title}</Mono>}
          </div>
        </td>
        <td style={{ padding: "12px 16px", verticalAlign: "middle", width: 90 }}>
          {item.score != null ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 44, height: 2, background: T.ink5, borderRadius: 2, overflow: "hidden" }}><div style={{ width: `${item.score}%`, height: "100%", background: rc.fg, borderRadius: 2 }} /></div>
              <Mono size={12} color={rc.fg} weight={600}>{item.score}</Mono>
            </div>
          ) : <Mono color={T.ink5}>—</Mono>}
        </td>
        <td style={{ padding: "12px 16px", verticalAlign: "middle", width: 90 }}>
          {item.sla_breach_probability != null ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Pip rag={num(item.sla_breach_probability) >= 70 ? "R" : num(item.sla_breach_probability) >= 40 ? "A" : "G"} pulse={num(item.sla_breach_probability) >= 70} />
              <Mono size={11} color={T.ink3} weight={500}>{item.sla_breach_probability}%</Mono>
            </div>
          ) : <Mono color={T.ink5}>—</Mono>}
        </td>
        <td style={{ padding: "12px 16px", verticalAlign: "middle", width: 110 }}><Mono size={11} color={num(item.exposure_total) > 500_000 ? RAG.A.fg : num(item.exposure_total) > 0 ? T.ink3 : T.ink5} weight={num(item.exposure_total) > 0 ? 600 : 400}>{item.exposure_total_fmt || "—"}</Mono></td>
        <td style={{ padding: "12px 16px", verticalAlign: "middle", width: 100 }}><Mono size={11} color={over ? RAG.R.fg : T.ink3} weight={over ? 600 : 400}>{fmtUkDate(item.due_date)}</Mono></td>
        <td style={{ padding: "12px 16px", verticalAlign: "middle", width: 140 }}><Mono size={10} color={T.ink4}>{item.owner_label || "—"}</Mono></td>
        <td style={{ padding: "12px 12px 12px 6px", verticalAlign: "middle", width: 28, textAlign: "center" }}><span style={{ fontFamily: T.mono, fontSize: 11, color: T.ink4, display: "inline-block", transition: "transform 0.2s", transform: expanded ? "rotate(180deg)" : "none" }}>▾</span></td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} style={{ padding: 0, borderBottom: `1px solid ${T.hr}` }}>
            <div style={{ background: rc.bg, borderTop: `1px solid ${rc.border}`, padding: "20px 32px 24px", animation: "drawerOpen 0.18s ease-out both" }}>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 40 }}>
                <div>
                  <SectionRule label="Intelligence Summary" />
                  <p style={{ fontFamily: T.body, fontSize: 13, color: T.ink2, lineHeight: 1.75, margin: 0, fontWeight: 300 }}>{item.note || item.prompt || "No summary available."}</p>
                </div>
                <div>
                  <SectionRule label="Details" />
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[["RAID ID", item.public_id || null], ["Score", item.score != null ? String(item.score) : null], ["SLA Breach", item.sla_breach_probability != null ? `${item.sla_breach_probability}%` : null], ["Days to Breach", item.sla_days_to_breach != null ? `~${item.sla_days_to_breach}d` : null], ["Exposure", item.exposure_total_fmt || null], ["Due Date", fmtUkDate(item.due_date)], ["Owner", item.owner_label || null]].filter(([, v]) => v).map(([k, v]) => (
                      <div key={k as string} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                        <Mono size={10} color={T.ink4}>{k}</Mono>
                        <Mono size={11} color={T.ink2} weight={500}>{v}</Mono>
                      </div>
                    ))}
                  </div>
                  {projectRaidHref && (
                    <div style={{ marginTop: 16 }}>
                      <Link href={projectRaidHref} onClick={(e) => e.stopPropagation()} style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: "#1d4ed8", textDecoration: "none", borderBottom: "1px solid #bfdbfe", paddingBottom: 1 }}>OPEN IN PROJECT REGISTER →</Link>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function InsightCard({ insight }: { insight: BriefingInsight }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.hr}`, borderLeft: `3px solid ${insight.severity === "high" ? RAG.R.fg : insight.severity === "medium" ? RAG.A.fg : "#1d4ed8"}`, padding: "16px 20px", cursor: "pointer", transition: "background 0.1s" }} onClick={() => setExpanded((v) => !v)}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}><SevBadge sev={insight.severity} /></div>
          <div style={{ fontFamily: T.body, fontSize: 13.5, color: T.ink, fontWeight: 600, lineHeight: 1.3 }}>{insight.title}</div>
          {expanded && <p style={{ fontFamily: T.body, fontSize: 13, color: T.ink2, lineHeight: 1.75, margin: "10px 0 0", fontWeight: 300, animation: "drawerOpen 0.15s ease-out" }}>{insight.body}</p>}
        </div>
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.ink4, flexShrink: 0, marginTop: 2, transition: "transform 0.2s", transform: expanded ? "rotate(180deg)" : "none" }}>▾</span>
      </div>
      {expanded && insight.href && (
        <div style={{ marginTop: 12 }}>
          <Link href={insight.href} onClick={(e) => e.stopPropagation()} style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: "#1d4ed8", textDecoration: "none", borderBottom: "1px solid #bfdbfe", paddingBottom: 1 }}>VIEW DETAILS →</Link>
        </div>
      )}
    </div>
  );
}

function SectionPanel({ section }: { section: ExecSummary["sections"][0] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (!section.items.length) return null;
  const TH: React.CSSProperties = { padding: "8px 16px", fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: T.ink4, textAlign: "left", borderBottom: `1px solid ${T.hr}`, background: "#f5f3f0", whiteSpace: "nowrap" };
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.hr}`, overflow: "hidden", animation: "fadeUp 0.4s ease both" }}>
      <div style={{ padding: "18px 24px 14px", borderBottom: `1px solid ${T.hr}`, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div style={{ fontFamily: T.serif, fontSize: 20, fontWeight: 600, color: T.ink }}>{section.title}</div>
        <Mono size={10} color={T.ink5} upper>{section.items.length} items</Mono>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead>
            <tr>
              <th style={{ ...TH, width: 3, padding: 0 }} />
              <th style={{ ...TH, minWidth: 280 }}>Item</th>
              <th style={{ ...TH, width: 90 }}>Score</th>
              <th style={{ ...TH, width: 90 }}>SLA</th>
              <th style={{ ...TH, width: 110 }}>Exposure</th>
              <th style={{ ...TH, width: 100 }}>Due</th>
              <th style={{ ...TH, width: 140 }}>Owner</th>
              <th style={{ ...TH, width: 28 }} />
            </tr>
          </thead>
          <tbody>
            {section.items.map((item) => (
              <React.Fragment key={item.id}>
                <RaidItemRow item={item} expanded={expandedId === item.id} onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)} />
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DownloadBar({ days, scope }: { days: WindowDays; scope: string }) {
  const [loading, setLoading] = useState<"pdf" | "pptx" | "md" | null>(null);
  async function download(format: "pdf" | "pptx" | "md") {
    setLoading(format);
    try {
      const url = `/api/portfolio/raid-exec-summary?days=${days}&scope=${scope}&download=1&format=${format}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const a = document.createElement("a");
      const ext = format === "pptx" ? "pptx" : format === "md" ? "md" : "pdf";
      a.href = URL.createObjectURL(blob);
      a.download = `portfolio_raid_brief_${days}d.${ext}`;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 300);
    } catch { alert("Download failed — please try again."); } finally { setLoading(null); }
  }
  const btn = (format: "pdf" | "pptx" | "md", label: string) => (
    <button onClick={() => download(format)} disabled={!!loading} style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", padding: "8px 16px", background: loading === format ? T.ink : "transparent", color: loading === format ? "#fff" : T.ink2, border: `1px solid ${T.hr}`, borderRadius: 2, cursor: loading ? "default" : "pointer", transition: "all 0.13s ease" }}>
      {loading === format ? "GENERATING…" : label}
    </button>
  );
  return <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{btn("pdf", "↓ PDF")}{btn("pptx", "↓ PPTX")}{btn("md", "↓ MD")}</div>;
}

export default function InsightsClient() {
  const [mounted, setMounted] = useState(false);
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const [scope, setScope] = useState<"all" | "window" | "overdue">("all");
  const [activeTab, setActiveTab] = useState<"overview" | "raid" | "ai" | "finance" | "premortem" | "dependencies" | "memory">("overview");

  const [execData, setExecData] = useState<ExecSummary | null>(null);
  const [execLoading, setExecLoading] = useState(true);
  const [health, setHealth] = useState<HealthApi | null>(null);
  const [insights, setInsights] = useState<BriefingInsight[]>([]);
  const [insLoading, setInsLoading] = useState(true);
  const [finItems, setFinItems] = useState<FinanceItem[]>([]);
  const [finLoading, setFinLoading] = useState(false);
  const [finSort, setFinSort] = useState<"total" | "cost" | "revenue" | "penalties">("total");
  const [pmData,    setPmData]    = useState<PortfolioIntelligenceData | null>(null);
  const [pmLoading, setPmLoading] = useState(false);
  const [boardroomOpen, setBoardroomOpen] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    let c = false; setExecLoading(true);
    (async () => {
      const j = await fetchJson<any>(`/api/portfolio/raid-exec-summary?days=${windowDays}&scope=${scope}`);
      if (!c) { setExecData(j?.ok ? j : null); setExecLoading(false); }
    })();
    return () => { c = true; };
  }, [windowDays, scope]);

  useEffect(() => {
    let c = false;
    (async () => {
      const j = await fetchJson<any>(`/api/portfolio/health?days=${windowDays}`);
      if (!c && j?.ok) setHealth(j);
    })();
    return () => { c = true; };
  }, [windowDays]);

  useEffect(() => {
    let c = false; setInsLoading(true);
    (async () => {
      const j = await fetchJson<any>(`/api/ai/briefing?days=${windowDays}`);
      if (!c) { setInsights(j?.ok && Array.isArray(j.insights) ? j.insights : []); setInsLoading(false); }
    })();
    return () => { c = true; };
  }, [windowDays]);

  useEffect(() => {
    if (activeTab !== "finance") return;
    let c = false; setFinLoading(true);
    (async () => {
      const j = await fetchJson<any>(`/api/portfolio/raid-list?scope=all&window=${windowDays}`);
      if (!c) {
        if (j?.ok && Array.isArray(j.items)) {
          const withFin = j.items.filter((it: any) => (Number(it.est_cost_impact) || 0) + (Number(it.est_revenue_at_risk) || 0) + (Number(it.est_penalties) || 0) > 0).map((it: any): FinanceItem => ({ id: it.id, public_id: it.public_id ?? null, project_id: it.project_id, project_title: it.project_title || "Project", project_code: it.project_code ?? null, type: it.type || "RAID", title: it.title || "Untitled", status: it.status || "", currency_symbol: it.currency_symbol || "£", est_cost_impact: it.est_cost_impact ?? null, est_revenue_at_risk: it.est_revenue_at_risk ?? null, est_penalties: it.est_penalties ?? null, total_exposure: (Number(it.est_cost_impact) || 0) + (Number(it.est_revenue_at_risk) || 0) + (Number(it.est_penalties) || 0), score: it.score ?? null, due_date: it.due_date ?? null, due_date_uk: it.due_date_uk ?? null }));
          setFinItems(withFin);
        } else { setFinItems([]); }
        setFinLoading(false);
      }
    })();
    return () => { c = true; };
  }, [activeTab, windowDays]);

  useEffect(() => {
    let c = false; setPmLoading(true);
    (async () => {
      const j = await fetchJson<any>("/api/portfolio/intelligence");
      if (!c) { setPmData(j?.ok ? j : null); setPmLoading(false); }
    })();
    return () => { c = true; };
  }, []);

  const kpis = execData?.kpis;
  const sections = execData?.sections ?? [];
  const healthScore = health ? Math.max(0, Math.min(100, Math.round(num(health.portfolio_health)))) : null;
  const fullRaidRegisterHref = "/portfolio/raid";

  const TABS: { k: typeof activeTab; l: string }[] = [
    { k: "overview",  l: "Overview" },
    { k: "raid",      l: "RAID Register" },
    { k: "finance",   l: "Finance Exposure" },
    { k: "ai",        l: "AI Signals" },
    { k: "premortem",     l: "Pre-Mortem AI" },
    { k: "dependencies",  l: "Dependency Graph" },
    { k: "memory",        l: "Org Memory" },
  ];

  const SCOPES: { v: typeof scope; l: string }[] = [{ v: "all", l: "All" }, { v: "window", l: "In Window" }, { v: "overdue", l: "Overdue" }];
  const WINDOWS: WindowDays[] = [7, 14, 30, 60];

  return (
    <>
      <style>{`
        @import url("${FONT_URL}");
        @keyframes ragPulse { 0%,100%{transform:scale(1);opacity:0.2} 50%{transform:scale(2.4);opacity:0.08} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes drawerOpen { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
        .raid-row { transition: background 0.1s; }
        .raid-row:hover { background: #f9f7f4 !important; }
        input::placeholder { color: #a8a29e; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #d6d3d1; border-radius: 2px; }
      `}</style>

      <div style={{ minHeight: "100vh", background: T.bg, fontFamily: T.mono, opacity: mounted ? 1 : 0, transition: "opacity 0.35s ease" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto", padding: "40px 40px 100px" }}>

          {/* Header */}
          <div style={{ borderBottom: `2px solid ${T.ink}`, paddingBottom: 22, marginBottom: 30, animation: "fadeUp 0.4s ease both" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Link href="/" style={{ fontFamily: T.mono, fontSize: 10, color: T.ink4, textDecoration: "none", letterSpacing: "0.08em" }}>← PORTFOLIO INTELLIGENCE</Link>
                <span style={{ color: T.ink5 }}>·</span>
                <Cap>EXECUTIVE INSIGHTS</Cap>
              </div>
              <Mono size={10} color={T.ink5}>{nowUK()}</Mono>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 32 }}>
              <div>
                <h1 style={{ fontFamily: T.serif, fontSize: 48, fontWeight: 700, margin: 0, letterSpacing: "-0.02em", lineHeight: 1, color: T.ink }}>Decision Intelligence</h1>
                <p style={{ fontFamily: T.body, fontSize: 14, color: T.ink3, marginTop: 10, fontWeight: 300, lineHeight: 1.5, maxWidth: 520 }}>
                  {execData?.summary?.headline || "RAID signals, SLA threats, financial exposure and Pre-Mortem AI across all active projects — distilled for executive action."}
                </p>
              </div>
              <div style={{ flexShrink: 0, textAlign: "right" }}>
                {execData?.meta && (
                  <>
                    <Mono size={10} color={T.ink4} upper>{execData.meta.projectCounts?.filtered ?? execData.meta.projectCounts?.active ?? "—"} projects in scope</Mono>
                    <div style={{ marginTop: 4 }}><Mono size={10} color={T.ink5} upper>Org scope · live</Mono></div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Toolbar */}
          <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: "12px 18px", marginBottom: 24, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, animation: "fadeUp 0.4s 0.06s ease both" }}>
            <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
              {TABS.map((t) => (
                <Pill key={t.k} label={t.l} active={activeTab === t.k} onClick={() => setActiveTab(t.k)} />
              ))}
            </div>
            <div style={{ width: 1, height: 20, background: T.hr }} />
            <div style={{ display: "flex", gap: 3 }}>{SCOPES.map((s) => <Pill key={s.v} label={s.l} active={scope === s.v} onClick={() => setScope(s.v)} />)}</div>
            <div style={{ width: 1, height: 20, background: T.hr }} />
            <div style={{ display: "flex", gap: 3 }}>{WINDOWS.map((w) => <Pill key={w} label={`${w}D`} active={windowDays === w} onClick={() => setWindowDays(w)} />)}</div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={() => setBoardroomOpen(true)}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 16px", fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", background: T.ink, color: "#fff", border: "none", borderRadius: 2, cursor: "pointer" }}
              >
                ◆ Boardroom
              </button>
              <DownloadBar days={windowDays} scope={scope} />
            </div>
          </div>

          {/* KPI strip */}
          {kpis && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", border: `1px solid ${T.hr}`, background: T.surface, marginBottom: 24, animation: "fadeUp 0.4s 0.1s ease both" }}>
              <KpiCell label="Total Items" value={kpis.total_items} />
              <KpiCell label="Overdue" value={kpis.overdue_open} alert={kpis.overdue_open > 0} sub="open past due" />
              <KpiCell label="High Score" value={kpis.high_score} alert={kpis.high_score > 0} sub="score ≥ 70" />
              <KpiCell label="SLA Hotspots" value={kpis.sla_hot} alert={kpis.sla_hot > 0} sub="breach risk ≥ 70%" />
              {healthScore != null ? <KpiCell label="Portfolio Health" value={`${healthScore}%`} sub={healthScore >= 85 ? "green" : healthScore >= 70 ? "amber" : "red"} alert={healthScore < 70} /> : <KpiCell label="Portfolio Health" value="—" />}
              <div style={{ padding: "20px 24px" }}>
                <Cap>Total Exposure</Cap>
                <div style={{ fontFamily: T.serif, fontSize: 36, fontWeight: 700, lineHeight: 1, marginTop: 8, marginBottom: 4, color: kpis.exposure_total > 0 ? RAG.A.fg : T.ink4 }}>{kpis.exposure_total > 0 ? kpis.exposure_total_fmt || "—" : "—"}</div>
                <Cap>cost + revenue + penalties</Cap>
              </div>
            </div>
          )}

          {execLoading && activeTab !== "premortem" && (
            <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: "80px", textAlign: "center" }}>
              <Mono size={11} color={T.ink5}>RETRIEVING INTELLIGENCE…</Mono>
            </div>
          )}

          {/* Overview tab */}
          {!execLoading && activeTab === "overview" && (
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, animation: "fadeUp 0.4s 0.14s ease both" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: "28px 32px" }}>
                  <SectionRule label="Executive Headline" />
                  <p style={{ fontFamily: T.body, fontSize: 15, color: T.ink2, lineHeight: 1.8, margin: 0, fontWeight: 300 }}>{execData?.summary?.headline || "No data available for the selected window."}</p>
                  {execData?.summary?.generated_at && <div style={{ marginTop: 16 }}><Mono size={10} color={T.ink5}>Generated {fmtUkDate(execData.summary.generated_at)}</Mono></div>}
                </div>
                {sections.filter((s) => s.items.length > 0).map((sec) => (
                  <div key={sec.key} style={{ background: T.surface, border: `1px solid ${T.hr}`, overflow: "hidden" }}>
                    <div style={{ padding: "16px 24px 12px", borderBottom: `1px solid ${T.hr}`, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                      <div style={{ fontFamily: T.serif, fontSize: 17, fontWeight: 600, color: T.ink }}>{sec.title}</div>
                      <button onClick={() => setActiveTab("raid")} style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", color: "#1d4ed8", background: "none", border: "none", cursor: "pointer", textTransform: "uppercase" }}>VIEW ALL →</button>
                    </div>
                    <div>
                      {sec.items.slice(0, 3).map((item) => {
                        const rag = scoreRag(item.score ?? null);
                        const rc = RAG[rag];
                        return (
                          <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 24px", borderBottom: `1px solid ${T.hr}` }}>
                            <div style={{ width: 3, height: 42, background: rag === "N" ? T.ink5 : rc.fg, flexShrink: 0, opacity: rag === "G" ? 0.4 : 1 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                                {item.public_id && <Mono size={9} color={T.ink3} weight={700} upper>{item.public_id}</Mono>}
                                <Mono size={9} color={T.ink4} weight={600} upper>{item.type}</Mono>
                                {item.overdue && <Mono size={9} color={RAG.R.fg} weight={600} upper>Overdue</Mono>}
                              </div>
                              <div style={{ fontFamily: T.body, fontSize: 13, color: T.ink2, fontWeight: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
                            </div>
                            <div style={{ flexShrink: 0, textAlign: "right" }}>{item.score != null && <Mono size={12} color={rc.fg} weight={600}>{item.score}</Mono>}</div>
                            <div style={{ flexShrink: 0, width: 90 }}><Mono size={10} color={T.ink4}>{item.project_title}</Mono></div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {healthScore != null && (
                  <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: "28px 28px" }}>
                    <SectionRule label="Portfolio Health" />
                    <HealthMeter score={healthScore} parts={health?.parts} />
                    {health?.projectCount && <div style={{ marginTop: 16, borderTop: `1px solid ${T.hr}`, paddingTop: 14 }}><Mono size={10} color={T.ink5} upper>{health.projectCount} active projects · {windowDays}d window</Mono></div>}
                  </div>
                )}
                <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: "20px 24px" }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
                    <SectionRule label="AI Signals" />
                    <button onClick={() => setActiveTab("ai")} style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", color: "#1d4ed8", background: "none", border: "none", cursor: "pointer", textTransform: "uppercase", marginBottom: 14 }}>ALL →</button>
                  </div>
                  {insLoading ? <Mono size={10} color={T.ink5}>LOADING SIGNALS…</Mono> : insights.length === 0 ? <Mono size={10} color={T.ink5}>No active signals.</Mono> : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{insights.slice(0, 4).map((ins) => <InsightCard key={ins.id} insight={ins} />)}</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* RAID tab */}
          {!execLoading && activeTab === "raid" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20, animation: "fadeUp 0.4s 0.1s ease both" }}>
              {sections.length === 0 || sections.every((s) => s.items.length === 0) ? (
                <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: "80px", textAlign: "center" }}><Mono size={12} color={T.ink5}>No items match the current window and scope.</Mono></div>
              ) : (
                <>
                  {sections.map((sec) => <SectionPanel key={sec.key} section={sec} />)}
                  <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 8 }}>
                    <Link href={fullRaidRegisterHref} style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: "#1d4ed8", textDecoration: "none", borderBottom: "1px solid #bfdbfe", paddingBottom: 1 }}>OPEN FULL RAID REGISTER →</Link>
                  </div>
                </>
              )}
            </div>
          )}

          {/* AI Signals tab */}
          {activeTab === "ai" && (
            <div style={{ animation: "fadeUp 0.4s 0.1s ease both" }}>
              {insLoading ? (
                <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: "80px", textAlign: "center" }}><Mono size={11} color={T.ink5}>RETRIEVING AI SIGNALS…</Mono></div>
              ) : insights.length === 0 ? (
                <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: "80px", textAlign: "center" }}><Mono size={12} color={T.ink5}>No active AI signals for this window.</Mono></div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}><Cap>{insights.length} signals</Cap><div style={{ flex: 1, height: 1, background: T.hr }} /></div>
                  {insights.map((ins) => <InsightCard key={ins.id} insight={ins} />)}
                </div>
              )}
            </div>
          )}

          {/* Finance tab */}
          {activeTab === "finance" && (() => {
            const sym = finItems[0]?.currency_symbol || "£";
            const fmt = (v: number | null) => {
              if (!v || !Number.isFinite(v)) return "—";
              if (v >= 1_000_000) return `${sym}${(v / 1_000_000).toFixed(1)}m`;
              if (v >= 1_000) return `${sym}${Math.round(v / 1_000)}k`;
              return `${sym}${Math.round(v)}`;
            };
            const sorted = [...finItems].sort((a, b) => {
              if (finSort === "cost") return (b.est_cost_impact || 0) - (a.est_cost_impact || 0);
              if (finSort === "revenue") return (b.est_revenue_at_risk || 0) - (a.est_revenue_at_risk || 0);
              if (finSort === "penalties") return (b.est_penalties || 0) - (a.est_penalties || 0);
              return b.total_exposure - a.total_exposure;
            });
            const totals = finItems.reduce((acc, it) => ({ total: acc.total + it.total_exposure, cost: acc.cost + (it.est_cost_impact || 0), revenue: acc.revenue + (it.est_revenue_at_risk || 0), penalties: acc.penalties + (it.est_penalties || 0) }), { total: 0, cost: 0, revenue: 0, penalties: 0 });
            const byProject = finItems.reduce((acc, it) => { const k = it.project_title; if (!acc[k]) acc[k] = 0; acc[k] += it.total_exposure; return acc; }, {} as Record<string, number>);
            const projectList = Object.entries(byProject).sort((a, b) => b[1] - a[1]).slice(0, 8);
            const TH: React.CSSProperties = { padding: "9px 16px", fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: T.ink4, textAlign: "left", borderBottom: `1px solid ${T.hr}`, background: "#f5f3f0", whiteSpace: "nowrap", cursor: "pointer", userSelect: "none" };
            const sortBtn = (k: typeof finSort, label: string) => <th style={{ ...TH, color: finSort === k ? T.ink : T.ink4 }} onClick={() => setFinSort(k)}>{label}{finSort === k ? " ↓" : ""}</th>;
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 20, animation: "fadeUp 0.4s 0.1s ease both" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", border: `1px solid ${T.hr}`, background: T.surface }}>
                  {[{ label: "Total Exposure", value: fmt(totals.total), alert: totals.total >= 500_000 }, { label: "Cost Impact", value: fmt(totals.cost), alert: false }, { label: "Revenue at Risk", value: fmt(totals.revenue), alert: false }, { label: "Penalties", value: fmt(totals.penalties), alert: totals.penalties > 0 }].map(({ label, value, alert }) => (
                    <div key={label} style={{ padding: "20px 24px", borderRight: `1px solid ${T.hr}` }}>
                      <Cap>{label}</Cap>
                      <div style={{ fontFamily: T.serif, fontSize: 40, fontWeight: 700, lineHeight: 1, marginTop: 8, marginBottom: 4, color: alert ? RAG.R.fg : value === "—" ? T.ink4 : T.ink }}>{value}</div>
                    </div>
                  ))}
                </div>
                {projectList.length > 0 && (
                  <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: "24px 28px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}><Cap>Exposure by Project</Cap><div style={{ flex: 1, height: 1, background: T.hr }} /><Mono size={10} color={T.ink5}>{projectList.length} projects with exposure</Mono></div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {projectList.map(([proj, val]) => {
                        const share = totals.total > 0 ? val / totals.total : 0;
                        const rag: Rag = val >= 500_000 ? "R" : val >= 100_000 ? "A" : "N";
                        return (
                          <div key={proj} style={{ display: "flex", alignItems: "center", gap: 14 }}>
                            <div style={{ width: 180, flexShrink: 0 }}><Mono size={10} color={T.ink3} weight={500}>{proj}</Mono></div>
                            <div style={{ flex: 1, height: 6, background: T.hr, borderRadius: 3, overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.round(share * 100)}%`, background: rag === "N" ? T.ink3 : RAG[rag].fg, borderRadius: 3, transition: "width 0.8s ease", opacity: 0.8 }} /></div>
                            <div style={{ width: 80, textAlign: "right", flexShrink: 0 }}><Mono size={12} color={rag === "N" ? T.ink3 : RAG[rag].fg} weight={600}>{fmt(val)}</Mono></div>
                            <div style={{ width: 36, textAlign: "right", flexShrink: 0 }}><Mono size={10} color={T.ink5}>{Math.round(share * 100)}%</Mono></div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {finLoading && <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: "80px", textAlign: "center" }}><Mono size={11} color={T.ink5}>RETRIEVING FINANCIAL EXPOSURE DATA…</Mono></div>}
                {!finLoading && finItems.length === 0 && <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: "80px", textAlign: "center" }}><Mono size={12} color={T.ink5}>No financial exposure recorded against RAID items.</Mono><div style={{ marginTop: 12 }}><Mono size={10} color={T.ink5}>Add cost, revenue risk or penalty estimates to RAID items to see them here.</Mono></div></div>}
                {!finLoading && sorted.length > 0 && (
                  <div style={{ background: T.surface, border: `1px solid ${T.hr}`, overflow: "hidden" }}>
                    <div style={{ padding: "18px 24px 14px", borderBottom: `1px solid ${T.hr}`, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                      <div style={{ fontFamily: T.serif, fontSize: 20, fontWeight: 600, color: T.ink }}>Exposure Detail</div>
                      <Mono size={10} color={T.ink5} upper>{sorted.length} items · click column to sort</Mono>
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 920 }}>
                        <thead><tr><th style={{ ...TH, width: 3, padding: 0 }} /><th style={{ ...TH, minWidth: 280 }}>RAID Item</th><th style={{ ...TH, width: 90 }}>Type</th><th style={{ ...TH, width: 80 }}>Due</th>{sortBtn("cost", "Cost Impact")}{sortBtn("revenue", "Revenue Risk")}{sortBtn("penalties", "Penalties")}{sortBtn("total", "Total")}</tr></thead>
                        <tbody>
                          {sorted.map((it) => {
                            const rag: Rag = it.total_exposure >= 500_000 ? "R" : it.total_exposure >= 100_000 ? "A" : "N";
                            const rc = RAG[rag];
                            const TD: React.CSSProperties = { padding: "12px 16px", verticalAlign: "middle", borderBottom: `1px solid ${T.hr}` };
                            return (
                              <tr key={it.id} style={{ background: T.surface }}>
                                <td style={{ width: 3, padding: 0, borderBottom: `1px solid ${T.hr}` }}><div style={{ width: 3, minHeight: 56, background: rag === "N" ? "transparent" : rc.fg, opacity: rag === "N" ? 0 : 0.8 }} /></td>
                                <td style={{ ...TD, minWidth: 280 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>{it.public_id && <Mono size={9} color={T.ink3} weight={700} upper>{it.public_id}</Mono>}</div>
                                  <div style={{ fontFamily: T.body, fontSize: 13, color: T.ink2, fontWeight: 400, lineHeight: 1.3, marginBottom: 3 }}>{it.title}</div>
                                  <Mono size={10} color={T.ink4}>{it.project_title}{it.project_code ? ` (${it.project_code})` : ""}</Mono>
                                </td>
                                <td style={TD}><Mono size={10} color={T.ink3} upper weight={500}>{it.type}</Mono></td>
                                <td style={TD}><Mono size={11} color={T.ink4}>{it.due_date_uk || "—"}</Mono></td>
                                <td style={TD}><Mono size={12} color={it.est_cost_impact ? T.ink2 : T.ink5} weight={it.est_cost_impact ? 600 : 400}>{fmt(it.est_cost_impact)}</Mono></td>
                                <td style={TD}><Mono size={12} color={it.est_revenue_at_risk ? RAG.A.fg : T.ink5} weight={it.est_revenue_at_risk ? 600 : 400}>{fmt(it.est_revenue_at_risk)}</Mono></td>
                                <td style={TD}><Mono size={12} color={it.est_penalties ? RAG.R.fg : T.ink5} weight={it.est_penalties ? 600 : 400}>{fmt(it.est_penalties)}</Mono></td>
                                <td style={{ ...TD, borderRight: "none" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <div style={{ width: 40, height: 2, background: T.hr, borderRadius: 2, overflow: "hidden" }}><div style={{ height: "100%", width: `${totals.total > 0 ? Math.min(100, Math.round((it.total_exposure / totals.total) * 100)) : 0}%`, background: rag === "N" ? T.ink4 : rc.fg, borderRadius: 2 }} /></div>
                                    <Mono size={12} color={rag === "N" ? T.ink2 : rc.fg} weight={600}>{fmt(it.total_exposure)}</Mono>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr style={{ background: "#f5f3f0" }}>
                            <td colSpan={4} style={{ padding: "12px 16px", borderTop: `2px solid ${T.hr}` }}><Mono size={10} color={T.ink4} upper weight={600}>Portfolio Total</Mono></td>
                            <td style={{ padding: "12px 16px", borderTop: `2px solid ${T.hr}` }}><Mono size={12} color={T.ink} weight={600}>{fmt(totals.cost)}</Mono></td>
                            <td style={{ padding: "12px 16px", borderTop: `2px solid ${T.hr}` }}><Mono size={12} color={RAG.A.fg} weight={600}>{fmt(totals.revenue)}</Mono></td>
                            <td style={{ padding: "12px 16px", borderTop: `2px solid ${T.hr}` }}><Mono size={12} color={totals.penalties > 0 ? RAG.R.fg : T.ink5} weight={600}>{fmt(totals.penalties)}</Mono></td>
                            <td style={{ padding: "12px 16px", borderTop: `2px solid ${T.hr}` }}><Mono size={13} color={T.ink} weight={700}>{fmt(totals.total)}</Mono></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Pre-Mortem AI tab */}
          {activeTab === "premortem" && (() => {
            const bandRag = (band: string): Rag => band === "Critical" ? "R" : band === "High" ? "A" : band === "Low" ? "G" : "N";
            const gapColor = (gap: string) => gap === "critical" || gap === "material" ? RAG.R.fg : gap === "minor" ? RAG.A.fg : RAG.G.fg;
            const gapLabel = (gap: string) => gap === "critical" ? "Critical gap" : gap === "material" ? "Material gap" : gap === "minor" ? "Minor gap" : "Consistent";

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 20, animation: "fadeUp 0.4s 0.1s ease both" }}>
                {pmLoading && <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: "80px", textAlign: "center" }}><Mono size={11} color={T.ink5}>RUNNING PRE-MORTEM ANALYSIS…</Mono></div>}
                {!pmLoading && !pmData && <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: "80px", textAlign: "center" }}><Mono size={11} color={T.ink5}>No Pre-Mortem data available. Run the analysis from individual project pages first.</Mono></div>}
                {!pmLoading && pmData && (() => {
                  const projects = pmData.projects;
                  const scored = projects.filter(p => p.has_snapshot);
                  return (
                    <>
                      {/* KPIs */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", border: `1px solid ${T.hr}`, background: T.surface }}>
                        {[
                          { label: "Avg Failure Risk", value: `${pmData.avgFailureRisk}/100`, alert: pmData.avgFailureRisk >= 50 },
                          { label: "Critical",         value: String(pmData.criticalCount),    alert: pmData.criticalCount > 0 },
                          { label: "High Risk",        value: String(pmData.highCount),        alert: pmData.highCount > 0 },
                          { label: "False Green",      value: String(pmData.falseGreenCount),  alert: pmData.falseGreenCount > 0 },
                          { label: "Reporting Trust",  value: `${pmData.reportingTrustScore}%`, alert: pmData.reportingTrustScore < 70 },
                          { label: "Worsening Trend",  value: String(pmData.worseningCount),   alert: pmData.worseningCount > 0 },
                        ].map(({ label, value, alert }) => <KpiCell key={label} label={label} value={value} alert={alert} />)}
                      </div>

                      {/* False green warning */}
                      {pmData.falseGreenCount > 0 && (
                        <div style={{ background: RAG.R.bg, border: `1px solid ${RAG.R.border}`, padding: "16px 24px", display: "flex", alignItems: "flex-start", gap: 12 }}>
                          <Pip rag="R" pulse />
                          <div>
                            <div style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 700, color: RAG.R.fg, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Truth Layer — {pmData.falseGreenCount} false-green project{pmData.falseGreenCount !== 1 ? "s" : ""} detected</div>
                            <div style={{ fontFamily: T.body, fontSize: 13, color: RAG.R.fg, lineHeight: 1.5, fontWeight: 300 }}>{projects.filter(p => p.is_false_green).map(p => p.project_title).join(", ")} — declared healthy but delivery evidence disagrees.</div>
                          </div>
                        </div>
                      )}

                      {/* Risk table */}
                      <div style={{ background: T.surface, border: `1px solid ${T.hr}`, overflow: "hidden" }}>
                        <div style={{ padding: "18px 24px 14px", borderBottom: `1px solid ${T.hr}`, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                          <div style={{ fontFamily: T.serif, fontSize: 20, fontWeight: 600, color: T.ink }}>Pre-Mortem AI — Project Risk Register</div>
                          <Mono size={10} color={T.ink5} upper>{scored.length}/{pmData.totalProjects} projects scored</Mono>
                        </div>
                        <div style={{ overflowX: "auto" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                            <thead>
                              <tr>
                                {[{ h: "Project", w: "auto" }, { h: "Risk Score", w: 120 }, { h: "Band", w: 100 }, { h: "Trend", w: 90 }, { h: "Sched", w: 70 }, { h: "Gov", w: 70 }, { h: "Budget", w: 70 }, { h: "Stability", w: 70 }, { h: "Status", w: 90 }, { h: "Truth", w: 110 }].map(({ h, w }) => (
                                  <th key={h} style={{ padding: "8px 14px", textAlign: "left", fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: T.ink4, background: "#f5f3f0", borderBottom: `1px solid ${T.hr}`, width: w, whiteSpace: "nowrap" }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {projects.map((proj, idx) => {
                                const rag = bandRag(proj.failure_risk_band);
                                const rc = RAG[rag];
                                const rowBg = idx % 2 === 0 ? T.surface : "#faf9f7";
                                const MiniBar = ({ score }: { score: number }) => {
                                  const c = score >= 60 ? RAG.R.fg : score >= 35 ? RAG.A.fg : RAG.G.fg;
                                  return <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 28, height: 2, background: T.hr, borderRadius: 2, overflow: "hidden" }}><div style={{ height: "100%", width: `${score}%`, background: c }} /></div><Mono size={10} color={c} weight={500}>{score}</Mono></div>;
                                };
                                return (
                                  <tr key={proj.project_id} style={{ background: proj.is_false_green ? RAG.A.bg : rowBg }}>
                                    <td style={{ padding: "12px 14px", borderBottom: `1px solid ${T.hr}` }}>
                                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <div style={{ width: 3, height: 32, background: proj.has_snapshot ? rc.fg : T.ink5, opacity: rag === "G" ? 0.4 : 1, flexShrink: 0 }} />
                                        <div>
                                          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                            <a href={`/projects/${proj.project_id}`} style={{ fontFamily: T.body, fontSize: 13, fontWeight: 400, color: T.ink2, textDecoration: "none" }}>{proj.project_title}</a>
                                            {proj.is_false_green && <Pip rag="R" pulse />}
                                          </div>
                                          <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                                            {proj.project_code && <Mono size={9} color={T.ink4}>{proj.project_code}</Mono>}
                                            {proj.pm_name && <Mono size={9} color={T.ink5}>{proj.pm_name}</Mono>}
                                          </div>
                                        </div>
                                      </div>
                                    </td>
                                    <td style={{ padding: "12px 14px", borderBottom: `1px solid ${T.hr}` }}>
                                      {proj.has_snapshot ? <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ width: 56, height: 2, background: T.hr, borderRadius: 2, overflow: "hidden" }}><div style={{ height: "100%", width: `${proj.failure_risk_score}%`, background: rc.fg }} /></div><Mono size={12} color={rc.fg} weight={600}>{proj.failure_risk_score}</Mono></div> : <Mono size={10} color={T.ink5}>No scan</Mono>}
                                    </td>
                                    <td style={{ padding: "12px 14px", borderBottom: `1px solid ${T.hr}` }}>
                                      {proj.has_snapshot && <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", color: rc.fg, background: rc.bg, border: `1px solid ${rc.border}`, padding: "2px 7px", borderRadius: 2 }}>{proj.failure_risk_band.toUpperCase()}</span>}
                                    </td>
                                    <td style={{ padding: "12px 14px", borderBottom: `1px solid ${T.hr}` }}>
                                      <Mono size={11} color={proj.direction === "worsening" ? RAG.R.fg : proj.direction === "improving" ? RAG.G.fg : T.ink5} weight={proj.direction === "worsening" ? 600 : 400}>
                                        {proj.direction === "worsening" ? "↑ worse" : proj.direction === "improving" ? "↓ better" : "— stable"}
                                      </Mono>
                                    </td>
                                    <td style={{ padding: "12px 14px", borderBottom: `1px solid ${T.hr}` }}><MiniBar score={proj.schedule_score} /></td>
                                    <td style={{ padding: "12px 14px", borderBottom: `1px solid ${T.hr}` }}><MiniBar score={proj.governance_score} /></td>
                                    <td style={{ padding: "12px 14px", borderBottom: `1px solid ${T.hr}` }}><MiniBar score={proj.budget_score} /></td>
                                    <td style={{ padding: "12px 14px", borderBottom: `1px solid ${T.hr}` }}><MiniBar score={proj.stability_score} /></td>
                                    <td style={{ padding: "12px 14px", borderBottom: `1px solid ${T.hr}` }}><Mono size={10} color={T.ink3}>{proj.declared_status ?? "—"}</Mono></td>
                                    <td style={{ padding: "12px 14px", borderBottom: `1px solid ${T.hr}` }}>
                                      {proj.has_snapshot && <div><Mono size={10} color={gapColor(proj.gap)} weight={600}>{gapLabel(proj.gap)}</Mono>{proj.is_false_green && <div style={{ marginTop: 2 }}><Mono size={9} color={RAG.A.fg} weight={600}>FALSE GREEN</Mono></div>}</div>}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Decision Engine */}
                      {pmData.topDecisions.length > 0 && (
                        <div style={{ background: T.surface, border: `1px solid ${T.hr}`, overflow: "hidden" }}>
                          <div style={{ padding: "18px 24px 14px", borderBottom: `1px solid ${T.hr}`, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                            <div style={{ fontFamily: T.serif, fontSize: 20, fontWeight: 600, color: T.ink }}>Decision Engine — Portfolio Actions</div>
                            <Mono size={10} color={T.ink5} upper>Ranked by risk reduction impact</Mono>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column" }}>
                            {pmData.topDecisions.map((d, i) => (
                              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 20, padding: "16px 24px", borderBottom: `1px solid ${T.hr}`, background: i < 3 ? RAG.R.bg : T.surface }}>
                                <div style={{ flexShrink: 0, width: 32, height: 32, borderRadius: "50%", background: i < 3 ? RAG.R.fg : T.ink, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 2 }}>
                                  <Mono size={11} color="#fff" weight={700}>{i + 1}</Mono>
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
                                    <a href={`/projects/${d.project_id}`} style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: T.ink2, background: "#f5f3f0", border: `1px solid ${T.hr}`, padding: "2px 8px", borderRadius: 2, textDecoration: "none" }}>{d.project_title}</a>
                                    {d.pillar && <Mono size={9} color={T.ink4} upper>{d.pillar}</Mono>}
                                    <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, color: i < 3 ? RAG.R.fg : T.ink4, background: i < 3 ? RAG.R.bg : "#f5f3f0", border: `1px solid ${i < 3 ? RAG.R.border : T.hr}`, padding: "2px 7px", borderRadius: 2 }}>{d.priority.toUpperCase()}</span>
                                  </div>
                                  <div style={{ fontFamily: T.body, fontSize: 13.5, color: T.ink, fontWeight: 400, lineHeight: 1.4, marginBottom: 4 }}>{d.action}</div>
                                  <div style={{ fontFamily: T.body, fontSize: 12, color: T.ink3, lineHeight: 1.5, fontWeight: 300 }}>{d.rationale}</div>
                                  <div style={{ marginTop: 4 }}><Mono size={10} color={T.ink4}>Owner: {d.owner_hint}</Mono></div>
                                </div>
                                <div style={{ flexShrink: 0, textAlign: "right" }}>
                                  {d.risk_reduction_pct > 0 && <div style={{ fontFamily: T.serif, fontSize: 28, fontWeight: 700, color: RAG.G.fg, lineHeight: 1 }}>-{d.risk_reduction_pct}%</div>}
                                  {d.risk_reduction_pct > 0 && <Mono size={9} color={T.ink5} upper>risk reduction</Mono>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Truth Layer summary */}
                      <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: "24px 28px" }}>
                        <SectionRule label="Truth Layer — Reporting Accuracy" />
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 20 }}>
                          <div>
                            <Cap>Reporting trust score</Cap>
                            <div style={{ fontFamily: T.serif, fontSize: 48, fontWeight: 700, color: pmData.reportingTrustScore >= 80 ? RAG.G.fg : pmData.reportingTrustScore >= 60 ? RAG.A.fg : RAG.R.fg, lineHeight: 1, marginTop: 6 }}>
                              {pmData.reportingTrustScore}<span style={{ fontFamily: T.mono, fontSize: 20, fontWeight: 300, color: T.ink4 }}>%</span>
                            </div>
                            <div style={{ height: 3, background: T.hr, borderRadius: 3, overflow: "hidden", marginTop: 10, maxWidth: 200 }}><div style={{ height: "100%", width: `${pmData.reportingTrustScore}%`, background: pmData.reportingTrustScore >= 80 ? RAG.G.fg : pmData.reportingTrustScore >= 60 ? RAG.A.fg : RAG.R.fg }} /></div>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            {[{ label: "False green detected", value: pmData.falseGreenCount, alert: pmData.falseGreenCount > 0, sub: "projects hiding true risk" }, { label: "Material status gaps", value: pmData.materialGapCount, alert: pmData.materialGapCount > 0, sub: "declared vs evidence mismatch" }, { label: "Worsening trajectory", value: pmData.worseningCount, alert: pmData.worseningCount > 0, sub: "projects on negative trend" }].map(({ label, value, alert, sub }) => (
                              <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                                <div><Mono size={10} color={T.ink4} upper>{label}</Mono><div style={{ marginTop: 1 }}><Mono size={9} color={T.ink5}>{sub}</Mono></div></div>
                                <Mono size={18} color={alert ? RAG.R.fg : RAG.G.fg} weight={700}>{value}</Mono>
                              </div>
                            ))}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <Cap>Projects by risk band</Cap>
                            {[{ band: "Critical", count: pmData.criticalCount, rag: "R" as Rag }, { band: "High", count: pmData.highCount, rag: "A" as Rag }, { band: "Moderate", count: pmData.moderateCount, rag: "N" as Rag }, { band: "Low", count: pmData.lowCount, rag: "G" as Rag }].map(({ band, count, rag }) => (
                              <div key={band} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <Pip rag={rag} />
                                <div style={{ flex: 1, height: 2, background: T.hr, borderRadius: 2, overflow: "hidden" }}><div style={{ height: "100%", width: `${pmData.totalProjects > 0 ? (count / pmData.totalProjects) * 100 : 0}%`, background: RAG[rag].fg, opacity: 0.7 }} /></div>
                                <Mono size={10} color={T.ink3} upper>{band}</Mono>
                                <Mono size={11} color={RAG[rag].fg} weight={600}>{count}</Mono>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            );
          })()}

          {/* Dependencies tab */}
          {activeTab === "dependencies" && (
            <div style={{ animation: "fadeUp 0.4s 0.1s ease both" }}>
              <DependencyGraphView />
            </div>
          )}

          {/* Org Memory tab */}
          {activeTab === "memory" && (
            <div style={{ animation: "fadeUp 0.4s 0.1s ease both" }}>
              <OrgMemoryCard />
            </div>
          )}

          {/* Footer */}
          <div style={{ marginTop: 40, paddingTop: 20, borderTop: `1px solid ${T.hr}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Mono size={10} color={T.ink5} upper>Decision Intelligence · Org scope · {windowDays}d window</Mono>
            <Mono size={10} color={T.ink5}>{nowUK()}</Mono>
          </div>
        </div>
      </div>
      {boardroomOpen && pmData && (
        <BoardroomMode data={pmData} onClose={() => setBoardroomOpen(false)} />
      )}
    </>
  );
}
