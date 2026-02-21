"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Save,
  Download,
  FileText,
  File as FileIcon,
  Loader2,
  ExternalLink,
} from "lucide-react";

// ✅ AI wiring (Closure Report)
import type { Section as AiSection } from "@/lib/ai/closure-ai";
import { useClosureAI } from "@/lib/ai/useClosureAI";

/**
 * Project Closure Report Editor – Full version with all sections
 * Risk IDs now use a TRUE human id field (human_id) like: R-000003 (6 digits)
 * - id: internal row id (uuid/string)
 * - human_id: display id used in UI and exports
 */

type Rag = "green" | "amber" | "red";
type Achieved = "yes" | "partial" | "no";
type Money = number | null;

type KeyStakeholder = { name: string; role: string };
type Achievement = { text: string };
type SuccessCriterion = { text: string; achieved: Achieved };

type DeliveredItem = {
  deliverable: string;
  accepted_by: string;
  accepted_on: string | null;
};

type OutstandingItem = { item: string; owner: string; status: string; target: string };

type BudgetRow = { category: string; budget: Money; actual: Money };
type LessonItem = { text: string; action?: string };

type RiskIssueRow = {
  id: string; // internal row id (uuid/string)
  human_id: string; // ✅ display id e.g. R-000003
  description: string;
  severity: "high" | "medium" | "low";
  owner: string;
  status: string;
  next_action: string;
};

type TeamMove = { person: string; change: string; date: string | null };
type LinkItem = { label: string; url: string };

type AttachmentItem = {
  label?: string | null;
  url: string;
  path?: string | null;
  bucket?: string | null;
  filename?: string | null;
  size_bytes?: number | null;
  uploaded_at?: string | null;
};

type ClosureDocV1 = {
  version: 1;
  project: {
    project_name: string;
    project_code: string;
    client_name: string;
    sponsor: string;
    pm: string;
  };
  // ✅ Summary must be FREE TEXT (no bullets)
  health: { rag: Rag; overall_health: "good" | "watch" | "critical"; summary: string };
  stakeholders: { key: KeyStakeholder[] };
  achievements: { key_achievements: Achievement[] };
  success: { criteria: SuccessCriterion[] };
  deliverables: {
    delivered: DeliveredItem[];
    outstanding: OutstandingItem[];
    acceptance_checklist: {
      sponsor_signed: boolean;
      bau_accepted: boolean;
      knowledge_transfer_done: boolean;
    };
    sponsor_signoff_name: string;
    sponsor_signoff_date: string | null;
  };
  financial_closeout: {
    budget_rows: BudgetRow[];
    roi: { annual_benefit: string; payback_achieved: string; payback_planned: string; npv: string };
  };
  lessons: { went_well: LessonItem[]; didnt_go_well: LessonItem[]; surprises_risks: LessonItem[] };
  handover: {
    risks_issues: RiskIssueRow[];
    team_moves: TeamMove[];
    knowledge_transfer: {
      docs_handed_over: boolean;
      final_demo_done: boolean;
      support_model_doc: boolean;
      runbook_finalised: boolean;
      notes: string;
    };
    support_model: { primary_support: string; escalation: string; hypercare_end: string | null };
  };
  recommendations: { items: { text: string; owner?: string; due?: string | null }[] };
  links: { items: LinkItem[] };
  attachments: { items: AttachmentItem[] };
  signoff: {
    sponsor_name: string;
    sponsor_date: string | null;
    sponsor_decision: "" | "approved" | "conditional" | "rejected";
    pm_name: string;
    pm_date: string | null;
    pm_approved: boolean;
  };
};

type ProjectMeta = {
  project_name?: string | null;
  project_code?: string | null;
  client_name?: string | null;
  sponsor?: string | null;
  pm?: string | null;
};

function safeJson(x: any): any {
  if (!x) return null;
  if (typeof x === "object") return x;
  try {
    return JSON.parse(String(x));
  } catch {
    return null;
  }
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function asMoney(v: string): Money {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function updateArray<T>(arr: T[], idx: number, mut: (item: T) => T): T[] {
  const next = [...arr];
  next[idx] = mut(next[idx]);
  return next;
}

function removeAt<T>(arr: T[], idx: number): T[] {
  return arr.filter((_, i) => i !== idx);
}

function makeDefaultDoc(): ClosureDocV1 {
  return {
    version: 1,
    project: { project_name: "", project_code: "", client_name: "", sponsor: "", pm: "" },
    health: { rag: "green", overall_health: "good", summary: "" },
    stakeholders: { key: [] },
    achievements: { key_achievements: [] },
    success: { criteria: [] },
    deliverables: {
      delivered: [],
      outstanding: [],
      acceptance_checklist: {
        sponsor_signed: false,
        bau_accepted: false,
        knowledge_transfer_done: false,
      },
      sponsor_signoff_name: "",
      sponsor_signoff_date: null,
    },
    financial_closeout: {
      budget_rows: [{ category: "Total", budget: null, actual: null }],
      roi: { annual_benefit: "", payback_achieved: "", payback_planned: "", npv: "" },
    },
    lessons: { went_well: [], didnt_go_well: [], surprises_risks: [] },
    handover: {
      risks_issues: [],
      team_moves: [],
      knowledge_transfer: {
        docs_handed_over: false,
        final_demo_done: false,
        support_model_doc: false,
        runbook_finalised: false,
        notes: "",
      },
      support_model: { primary_support: "", escalation: "", hypercare_end: null },
    },
    recommendations: { items: [] },
    links: { items: [] },
    attachments: { items: [] },
    signoff: {
      sponsor_name: "",
      sponsor_date: null,
      sponsor_decision: "",
      pm_name: "",
      pm_date: null,
      pm_approved: false,
    },
  };
}

/* ─────────────────────────────────────────────── Risk Human ID Generator (R-000003) ────────────────────────────────────────────── */
function generateRiskHumanId(existingRisks: Array<Partial<RiskIssueRow>>): string {
  let maxNum = 0;

  for (const risk of existingRisks || []) {
    const raw = String((risk as any)?.human_id ?? "").trim().toUpperCase();
    if (!raw.startsWith("R-")) continue;
    const num = parseInt(raw.slice(2).replace(/[^\d]/g, ""), 10);
    if (Number.isFinite(num) && num > maxNum) maxNum = num;
  }

  const nextNum = maxNum + 1;
  return `R-${String(nextNum).padStart(6, "0")}`; // ✅ 6 digits
}

function makeInternalId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return (crypto as any).randomUUID();
  } catch {}
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeRisks(rows: any[]): { rows: RiskIssueRow[]; changed: boolean } {
  const safeRows = Array.isArray(rows) ? rows : [];
  let changed = false;

  const nextRows: any[] = safeRows.map((r) => {
    const rr = r ?? {};
    const id = typeof rr.id === "string" && rr.id.trim() ? rr.id : makeInternalId();
    if (id !== rr.id) changed = true;

    let human_id =
      typeof rr.human_id === "string" && rr.human_id.trim()
        ? rr.human_id.trim()
        : typeof rr.id === "string" && rr.id.toUpperCase().startsWith("R-")
          ? rr.id.trim()
          : "";

    if (human_id !== rr.human_id) changed = true;

    return {
      id,
      human_id,
      description: String(rr.description ?? ""),
      severity: (rr.severity === "high" || rr.severity === "medium" || rr.severity === "low"
        ? rr.severity
        : "medium") as "high" | "medium" | "low",
      owner: String(rr.owner ?? ""),
      status: String(rr.status ?? ""),
      next_action: String(rr.next_action ?? ""),
    };
  });

  const assigned: RiskIssueRow[] = [];
  for (const r of nextRows) {
    if (!r.human_id || !String(r.human_id).toUpperCase().startsWith("R-")) {
      r.human_id = generateRiskHumanId([...assigned, ...nextRows]);
      changed = true;
    }
    assigned.push(r as RiskIssueRow);
  }

  return { rows: assigned, changed };
}

/* ─────────────────────────────────────────────── FREE TEXT normalisation (no bullets) ────────────────────────────────────────────── */
function normalizeFreeTextNoBullets(raw: string) {
  const s = safeStr(raw);
  if (!s.trim()) return "";

  const lines = s
    .split("\n")
    .map((l) =>
      l.replace(/^\s*(?:[•\-\*\u2022\u00B7\u2023\u25AA\u25CF\u2013]+)\s*/g, "").trimEnd()
    );

  const compact = lines.join("\n").trim();
  const nonEmpty = lines.filter((l) => l.trim()).length;
  const hasManyLines = nonEmpty >= 3;

  if (!hasManyLines) return compact;

  const paras: string[] = [];
  let cur: string[] = [];
  for (const l of lines) {
    const t = l.trim();
    if (!t) {
      if (cur.length) {
        paras.push(cur.join(" ").replace(/\s+/g, " ").trim());
        cur = [];
      }
      continue;
    }
    cur.push(t);
  }
  if (cur.length) paras.push(cur.join(" ").replace(/\s+/g, " ").trim());

  return paras.join("\n\n").trim();
}

/* ─────────────────────────────────────────────── AI helpers & mapping ────────────────────────────────────────────── */
function bulletsFromLines(lines: string[]) {
  return (lines || [])
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .map((x) => `• ${x}`)
    .join("\n");
}

function linesFromBullets(bullets: string) {
  return String(bullets || "")
    .split("\n")
    .map((l) => l.replace(/^\s*[•\-\*]\s?/, "").trim())
    .filter(Boolean);
}

function getClosureSection(doc: any, key: string): AiSection {
  // ✅ Summary is FREE TEXT (not bullets). We still pass it via AiSection.bullets because the hook expects it.
  if (key === "closure.health.summary") {
    return {
      key,
      title: "Executive Closure Summary (Free text — no bullet points)",
      bullets: String(doc?.health?.summary || ""),
    };
  }

  if (key === "closure.achievements") {
    const lines = (doc?.achievements?.key_achievements || []).map((a: any) => a?.text ?? a);
    return { key, title: "Key Achievements", bullets: bulletsFromLines(lines) };
  }

  if (key === "closure.lessons.went_well") {
    const lines = (doc?.lessons?.went_well || []).map((l: any) =>
      l?.action ? `${l.text} (Action: ${l.action})` : l?.text ?? l
    );
    return { key, title: "Lessons Learned: What went well", bullets: bulletsFromLines(lines) };
  }

  if (key === "closure.lessons.didnt_go_well") {
    const lines = (doc?.lessons?.didnt_go_well || []).map((l: any) =>
      l?.action ? `${l.text} (Action: ${l.action})` : l?.text ?? l
    );
    return {
      key,
      title: "Lessons Learned: What didn't go well",
      bullets: bulletsFromLines(lines),
    };
  }

  if (key === "closure.lessons.surprises_risks") {
    const lines = (doc?.lessons?.surprises_risks || []).map((l: any) =>
      l?.action ? `${l.text} (Action: ${l.action})` : l?.text ?? l
    );
    return {
      key,
      title: "Lessons Learned: Surprises / Risks",
      bullets: bulletsFromLines(lines),
    };
  }

  if (key === "closure.recommendations") {
    const lines = (doc?.recommendations?.items || []).map((r: any) => {
      const t = String(r?.text || "").trim();
      const o = String(r?.owner || "").trim();
      const d = String(r?.due || "").trim();
      return [t, o ? `Owner: ${o}` : "", d ? `Due: ${d}` : ""].filter(Boolean).join(" — ");
    });
    return {
      key,
      title: "Recommendations & Follow-up Actions",
      bullets: bulletsFromLines(lines),
    };
  }

  return { key, title: key, bullets: "" };
}

function applyClosureSectionReplace(setDoc: any, key: string, section: AiSection) {
  const raw = String(section?.bullets || "");

  if (key === "closure.health.summary") {
    const free = normalizeFreeTextNoBullets(raw);
    setDoc((d: any) => ({ ...d, health: { ...d.health, summary: free } }));
    return;
  }

  if (key === "closure.achievements") {
    const lines = linesFromBullets(raw);
    setDoc((d: any) => ({
      ...d,
      achievements: { key_achievements: lines.map((t) => ({ text: t })) },
    }));
    return;
  }

  if (key === "closure.lessons.went_well") {
    const lines = linesFromBullets(raw);
    setDoc((d: any) => ({
      ...d,
      lessons: { ...d.lessons, went_well: lines.map((t) => ({ text: t, action: "" })) },
    }));
    return;
  }

  if (key === "closure.lessons.didnt_go_well") {
    const lines = linesFromBullets(raw);
    setDoc((d: any) => ({
      ...d,
      lessons: { ...d.lessons, didnt_go_well: lines.map((t) => ({ text: t, action: "" })) },
    }));
    return;
  }

  if (key === "closure.lessons.surprises_risks") {
    const lines = linesFromBullets(raw);
    setDoc((d: any) => ({
      ...d,
      lessons: {
        ...d.lessons,
        surprises_risks: lines.map((t) => ({ text: t, action: "" })),
      },
    }));
    return;
  }

  if (key === "closure.recommendations") {
    const lines = linesFromBullets(raw);
    setDoc((d: any) => ({
      ...d,
      recommendations: { items: lines.map((t) => ({ text: t, owner: "", due: null })) },
    }));
    return;
  }
}

/* ─────────────────────────────────────────────── Design System ────────────────────────────────────────────── */

const globalCSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Serif+Display&family=JetBrains+Mono:wght@400;500&display=swap');

.closure-editor {
  --bg: #F8F7F4;
  --surface: #FFFFFF;
  --border: #E8E5DE;
  --border-strong: #D4D0C8;
  --text: #1A1915;
  --text-2: #6B6860;
  --text-3: #9C9889;
  --accent: #2C5545;
  --accent-light: #EDF4F0;
  --green: #2C6E49;
  --green-bg: #E8F5ED;
  --green-border: #B8DCC5;
  --amber: #B8860B;
  --amber-bg: #FFF8E1;
  --amber-border: #F0D78C;
  --red: #C62828;
  --red-bg: #FFF0F0;
  --red-border: #F5C6C6;
  --shadow-sm: 0 1px 2px rgba(26,25,21,0.04);
  --shadow-md: 0 2px 8px rgba(26,25,21,0.06), 0 1px 2px rgba(26,25,21,0.04);
  --radius: 10px;
  --radius-sm: 6px;
  --sans: 'DM Sans', system-ui, -apple-system, sans-serif;
  --display: 'DM Serif Display', Georgia, serif;
  --mono: 'JetBrains Mono', 'SF Mono', monospace;
}

.closure-editor, .closure-editor *, .closure-editor input,
.closure-editor select, .closure-editor textarea {
  font-family: var(--sans);
}

.closure-editor ::-webkit-scrollbar { width: 6px; height: 6px; }
.closure-editor ::-webkit-scrollbar-track { background: transparent; }
.closure-editor ::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 3px; }

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.65; }
}

.c-section { animation: fadeUp 0.4s ease-out both; }
.c-section:nth-child(1) { animation-delay: 0s; }
.c-section:nth-child(2) { animation-delay: 0.04s; }
.c-section:nth-child(3) { animation-delay: 0.08s; }
.c-section:nth-child(4) { animation-delay: 0.12s; }
.c-section:nth-child(5) { animation-delay: 0.16s; }
.c-section:nth-child(6) { animation-delay: 0.20s; }
.c-section:nth-child(7) { animation-delay: 0.24s; }
.c-section:nth-child(8) { animation-delay: 0.28s; }
.c-section:nth-child(9) { animation-delay: 0.32s; }
.c-section:nth-child(10) { animation-delay: 0.36s; }
.c-section:nth-child(11) { animation-delay: 0.40s; }
.c-section:nth-child(12) { animation-delay: 0.44s; }

.c-header {
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  background: rgba(248, 247, 244, 0.88);
}

.closure-editor input[type="checkbox"] {
  appearance: none;
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border: 2px solid var(--border-strong);
  border-radius: 4px;
  cursor: pointer;
  position: relative;
  transition: all 0.15s ease;
  flex-shrink: 0;
  background: var(--surface);
}

.closure-editor input[type="checkbox"]:checked {
  background: var(--accent);
  border-color: var(--accent);
}

.closure-editor input[type="checkbox"]:checked::after {
  content: '';
  position: absolute;
  left: 4px;
  top: 1px;
  width: 6px;
  height: 10px;
  border: solid white;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.closure-editor input[type="checkbox"]:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.closure-editor input[type="checkbox"]:disabled {
  opacity: 0.5;
  cursor: default;
}

.c-input:focus, .c-textarea:focus, .c-select:focus {
  border-color: var(--accent) !important;
  box-shadow: 0 0 0 3px rgba(44, 85, 69, 0.12) !important;
}

.c-textarea { resize: vertical; min-height: 80px; }

.rag-green { border-left: 3px solid var(--green) !important; }
.rag-amber { border-left: 3px solid var(--amber) !important; }
.rag-red { border-left: 3px solid var(--red) !important; }

.c-btn { transition: all 0.15s ease; }
.c-btn:hover:not(:disabled) { background: var(--accent-light); color: var(--accent); }
.c-btn:active:not(:disabled) { transform: scale(0.97); }
.c-btn-danger { transition: all 0.15s ease; }
.c-btn-danger:hover:not(:disabled) { background: var(--red-bg); border-color: var(--red-border); color: var(--red); }
.c-saving { animation: pulse 1.5s ease-in-out infinite; }
.c-pill { transition: transform 0.15s ease, box-shadow 0.15s ease; }
.c-pill:hover { transform: translateY(-1px); box-shadow: var(--shadow-sm); }
.c-att { transition: all 0.2s ease; }
.c-att:hover { border-color: var(--border-strong); box-shadow: var(--shadow-md); }
.c-num { font-family: var(--display); font-size: 11px; letter-spacing: 0.04em; color: var(--text-3); text-transform: uppercase; }
.risk-high { border-left: 3px solid var(--red); }
.risk-medium { border-left: 3px solid var(--amber); }
.risk-low { border-left: 3px solid var(--green); }
`;

/* ── Style objects ─────────────────────────────────────────────────────── */

const inputBase: React.CSSProperties = {
  width: "100%",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  padding: "9px 12px",
  fontSize: 14,
  color: "var(--text)",
  lineHeight: 1.5,
  outline: "none",
  transition: "border-color 0.15s ease, box-shadow 0.15s ease",
};

const textareaBase: React.CSSProperties = {
  ...inputBase,
  minHeight: 90,
  resize: "vertical" as any,
};

const selectBase: React.CSSProperties = {
  ...inputBase,
  minHeight: 40,
  cursor: "pointer",
  appearance: "none" as any,
  backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%236B6860' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 12px center",
  paddingRight: 32,
};

const smallBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  padding: "6px 14px",
  fontSize: 12,
  fontWeight: 500,
  color: "var(--text-2)",
  cursor: "pointer",
  whiteSpace: "nowrap" as any,
  lineHeight: 1.4,
};

const dangerBtn: React.CSSProperties = {
  ...smallBtn,
  color: "var(--red)",
  borderColor: "var(--red-border)",
};

const aiBtn: React.CSSProperties = {
  ...smallBtn,
  background: "var(--accent-light)",
  borderColor: "var(--accent)",
  color: "var(--accent)",
  fontWeight: 600,
  fontSize: 11,
  letterSpacing: "0.03em",
  textTransform: "uppercase" as any,
};

/* ── Pill / accent helpers ─────────────────────────────────────────────── */

function pillStyle(color: "green" | "amber" | "red"): React.CSSProperties {
  const map = {
    green: { bg: "var(--green-bg)", b: "var(--green-border)", t: "var(--green)" },
    amber: { bg: "var(--amber-bg)", b: "var(--amber-border)", t: "var(--amber)" },
    red: { bg: "var(--red-bg)", b: "var(--red-border)", t: "var(--red)" },
  };
  const c = map[color];
  return {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 100,
    padding: "4px 14px",
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.03em",
    textTransform: "uppercase",
    border: `1px solid ${c.b}`,
    background: c.bg,
    color: c.t,
  };
}

function ragPill(r: Rag) {
  return pillStyle(r);
}

function overallPill(v: "good" | "watch" | "critical") {
  return pillStyle(v === "good" ? "green" : v === "watch" ? "amber" : "red");
}

function ragSelectAccent(r: Rag) {
  return `rag-${r}`;
}

function overallSelectAccent(v: "good" | "watch" | "critical") {
  return v === "good" ? "rag-green" : v === "watch" ? "rag-amber" : "rag-red";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

function fmtPounds(n: number) {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `£${Math.round(n).toLocaleString("en-GB")}`;
  }
}

function safeUrl(raw: string): string {
  const s = safeStr(raw).trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  // tolerate "www." etc
  if (/^www\./i.test(s)) return `https://${s}`;
  return s;
}

function canOpenUrl(raw: string): boolean {
  const u = safeUrl(raw);
  return /^https?:\/\//i.test(u);
}

function openUrl(raw: string) {
  const u = safeUrl(raw);
  if (!canOpenUrl(u)) return;
  window.open(u, "_blank", "noopener,noreferrer");
}

/* ─────────────────────────────────────────────── API best-effort fetchers ────────────────────────────────────────────── */
async function tryFetchJson(url: string, init?: RequestInit): Promise<any | null> {
  try {
    const res = await fetch(url, init);
    const json = await res.json().catch(() => null);
    if (!res.ok) return null;
    return json;
  } catch {
    return null;
  }
}

function parseProjectMetaFromAny(payload: any): ProjectMeta | null {
  if (!payload || typeof payload !== "object") return null;

  const root = payload?.project ?? payload?.data ?? payload?.item ?? payload;
  const p = Array.isArray(root) ? root?.[0] : root;
  if (!p || typeof p !== "object") return null;

  const project_code =
    safeStr((p as any).project_code ?? (p as any).code ?? (p as any).projectCode).trim() || null;
  const project_name =
    safeStr(
      (p as any).title ?? (p as any).project_name ?? (p as any).name ?? (p as any).projectName
    ).trim() || null;
  const client_name =
    safeStr((p as any).client_name ?? (p as any).client ?? (p as any).business).trim() || null;

  const sponsor =
    safeStr((p as any).sponsor ?? (p as any).sponsor_name ?? (p as any).sponsorName).trim() || null;

  const pm =
    safeStr(
      (p as any).project_manager ??
        (p as any).project_manager_name ??
        (p as any).pm ??
        (p as any).pm_name ??
        (p as any).projectManager
    ).trim() || null;

  if (!project_code && !project_name && !client_name && !sponsor && !pm) return null;

  return { project_code, project_name, client_name, sponsor, pm };
}

function parseStakeholdersFromAny(payload: any): KeyStakeholder[] {
  if (!payload) return [];
  const root =
    payload?.items ?? payload?.data ?? payload?.stakeholders ?? payload?.rows ?? payload;
  const arr = Array.isArray(root) ? root : [];
  const mapped: KeyStakeholder[] = arr
    .map((s: any) => {
      // ✅ aligns to your DB: stakeholders.name, stakeholders.role
      const name = safeStr(
        s?.name ?? s?.stakeholder_name ?? s?.display_name ?? s?.full_name ?? s?.title ?? ""
      ).trim();
      const role = safeStr(
        s?.role ?? s?.stakeholder_role ?? s?.position ?? s?.job_title ?? ""
      ).trim();
      if (!name && !role) return null;
      return { name: name || "", role: role || "" };
    })
    .filter(Boolean) as any;

  const seen = new Set<string>();
  const out: KeyStakeholder[] = [];
  for (const k of mapped) {
    const key = `${k.name.toLowerCase()}|${k.role.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
  }
  return out;
}

/* ─────────────────────────────────────────────── UI Primitives ────────────────────────────────────────────── */

function Section({
  title,
  num,
  right,
  children,
}: {
  title: string;
  num?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className="c-section"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        boxShadow: "var(--shadow-sm)",
        padding: "28px 32px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 32,
          right: 32,
          height: 1,
          background: "linear-gradient(90deg, var(--accent) 0%, transparent 100%)",
          opacity: 0.15,
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div>
          {num && (
            <div className="c-num" style={{ marginBottom: 4 }}>
              {num}
            </div>
          )}
          <h2
            style={{
              fontFamily: "var(--display)",
              fontSize: 20,
              fontWeight: 400,
              color: "var(--text)",
              lineHeight: 1.3,
              margin: 0,
            }}
          >
            {title}
          </h2>
        </div>
        {right && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexShrink: 0,
              flexWrap: "wrap",
            }}
          >
            {right}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: "var(--text-2)",
          letterSpacing: "0.02em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: -2 }}>{hint}</div>
      )}
      {children}
    </div>
  );
}

function RowGrid({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 20,
      }}
      className={className}
    >
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: "24px 16px",
        textAlign: "center",
        color: "var(--text-3)",
        fontSize: 13,
        fontStyle: "italic",
        borderRadius: "var(--radius-sm)",
        border: "1px dashed var(--border)",
        background: "var(--bg)",
      }}
    >
      {text}
    </div>
  );
}

function StatusMsg({ msg, isError }: { msg: string | null; isError?: boolean }) {
  if (!msg) return null;
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 500,
        color: isError ? "var(--red)" : "var(--green)",
        whiteSpace: "nowrap",
      }}
    >
      {msg}
    </span>
  );
}

function SeverityDot({ severity }: { severity: "high" | "medium" | "low" }) {
  const colors = { high: "var(--red)", medium: "var(--amber)", low: "var(--green)" };
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: colors[severity],
        marginRight: 6,
        flexShrink: 0,
      }}
    />
  );
}

function AchievedBadge({ achieved }: { achieved: Achieved }) {
  const map: Record<Achieved, { label: string; bg: string; text: string; border: string }> = {
    yes: {
      label: "Achieved",
      bg: "var(--green-bg)",
      text: "var(--green)",
      border: "var(--green-border)",
    },
    partial: {
      label: "Partial",
      bg: "var(--amber-bg)",
      text: "var(--amber)",
      border: "var(--amber-border)",
    },
    no: {
      label: "Not achieved",
      bg: "var(--red-bg)",
      text: "var(--red)",
      border: "var(--red-border)",
    },
  };
  const c = map[achieved];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 10px",
        borderRadius: 100,
        fontSize: 11,
        fontWeight: 600,
        background: c.bg,
        color: c.text,
        border: `1px solid ${c.border}`,
        letterSpacing: "0.02em",
      }}
    >
      {c.label}
    </span>
  );
}

/* ─────────────────────────────────────────────── Main Component ────────────────────────────────────────────── */
export default function ProjectClosureReportEditor({
  artifactId,
  projectId,
  readOnly = false,
  initialJson,
}: {
  artifactId: string;
  projectId?: string | null;
  readOnly?: boolean;
  initialJson?: any;
}) {
  const isReadOnly = !!readOnly;
  const canEdit = !isReadOnly;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const refProjectSummary = useRef<HTMLDivElement>(null);
  const refLessons = useRef<HTMLDivElement>(null);
  const refFinancial = useRef<HTMLDivElement>(null);
  const refOutstanding = useRef<HTMLDivElement>(null);
  const refSignoff = useRef<HTMLDivElement>(null);

  const [doc, setDoc] = useState<ClosureDocV1>(() => {
    const parsed = safeJson(initialJson);
    return parsed?.version === 1 ? (parsed as ClosureDocV1) : makeDefaultDoc();
  });

  const [metaBusy, setMetaBusy] = useState(false);
  const [metaMsg, setMetaMsg] = useState<string | null>(null);
  const [metaApplied, setMetaApplied] = useState(false);

  const [stakeBusy, setStakeBusy] = useState(false);
  const [stakeMsg, setStakeMsg] = useState<string | null>(null);
  const [stakeAutoApplied, setStakeAutoApplied] = useState(false);

  // ✅ Ensure legacy docs get proper human ids for risks
  useEffect(() => {
    setDoc((d) => {
      const { rows, changed } = normalizeRisks((d as any)?.handover?.risks_issues);
      if (!changed) return d;
      return { ...d, handover: { ...d.handover, risks_issues: rows } };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [originalDoc, setOriginalDoc] = useState<ClosureDocV1>(doc);
  const [saving, setSaving] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  const [dlBusy, setDlBusy] = useState<"pdf" | "docx" | null>(null);
  const [dlMsg, setDlMsg] = useState<string | null>(null);

  const [attBusy, setAttBusy] = useState<string | null>(null);

  // Auto-save every 30 seconds if there are changes
  useEffect(() => {
    if (isReadOnly || !canEdit) return;
    const hasChanges = JSON.stringify(doc) !== JSON.stringify(originalDoc);
    if (!hasChanges) return;

    const timer = setTimeout(async () => {
      setAutoSaving(true);
      try {
        await saveBestEffort();
        setOriginalDoc(doc);
        setSaveMsg("Auto-saved");
      } catch (e: any) {
        setSaveMsg(`Auto-save failed: ${e?.message || "Error"}`);
      } finally {
        setAutoSaving(false);
        setTimeout(() => setSaveMsg(null), 3000);
      }
    }, 30000);

    return () => clearTimeout(timer);
  }, [doc, originalDoc, isReadOnly, canEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  const financialTotals = useMemo(() => {
    const rows = doc.financial_closeout.budget_rows || [];
    const budget = rows.reduce((sum, r) => sum + (r.budget ?? 0), 0);
    const actual = rows.reduce((sum, r) => sum + (r.actual ?? 0), 0);
    const variance = actual - budget;
    const pct = budget ? (variance / budget) * 100 : null;
    return { budget, actual, variance, pct };
  }, [doc.financial_closeout.budget_rows]);

  /* ── Auto-populate Project Code + PM (and other fields if empty) ───────────────── */
  useEffect(() => {
    let cancelled = false;

    async function run() {
      const pid = safeStr(projectId).trim();
      if (!pid) return;

      // Only auto-apply once per mount (unless doc is blank)
      if (metaApplied && doc?.project?.project_code?.trim() && doc?.project?.pm?.trim()) return;

      setMetaBusy(true);
      setMetaMsg(null);

      const candidates = [
        `/api/projects/${pid}/meta`,
        `/api/projects/${pid}`,
        `/api/projects/get?id=${encodeURIComponent(pid)}`,
        `/api/project/${pid}`,
      ];

      let meta: ProjectMeta | null = null;
      for (const url of candidates) {
        const json = await tryFetchJson(url);
        const parsed = parseProjectMetaFromAny(json);
        if (parsed) {
          meta = parsed;
          break;
        }
      }

      if (cancelled) return;

      if (!meta) {
        setMetaMsg("Could not load project meta (code/PM) from API.");
        setMetaBusy(false);
        setTimeout(() => setMetaMsg(null), 4000);
        return;
      }

      setDoc((d) => {
        const next = { ...d };
        const cur = next.project ?? {
          project_name: "",
          project_code: "",
          client_name: "",
          sponsor: "",
          pm: "",
        };

        // ✅ Only fill if empty (so we don't overwrite user edits)
        const project_code = cur.project_code?.trim()
          ? cur.project_code
          : safeStr(meta?.project_code).trim();
        const pm = cur.pm?.trim() ? cur.pm : safeStr(meta?.pm).trim();
        const project_name = cur.project_name?.trim()
          ? cur.project_name
          : safeStr(meta?.project_name).trim() || cur.project_name;
        const client_name = cur.client_name?.trim()
          ? cur.client_name
          : safeStr(meta?.client_name).trim() || cur.client_name;
        const sponsor = cur.sponsor?.trim()
          ? cur.sponsor
          : safeStr(meta?.sponsor).trim() || cur.sponsor;

        next.project = { ...cur, project_code, pm, project_name, client_name, sponsor };
        return next;
      });

      setMetaApplied(true);
      setMetaMsg("Project Code / PM auto-populated.");
      setMetaBusy(false);
      setTimeout(() => setMetaMsg(null), 2500);
    }

    run();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, metaApplied]);

  /* ── Auto-generate Key Stakeholders from Stakeholder Register (DB: public.stakeholders) ── */
  useEffect(() => {
    let cancelled = false;

    async function run() {
      const pid = safeStr(projectId).trim();
      if (!pid) return;

      if (stakeAutoApplied) return;
      if (doc?.stakeholders?.key?.length) {
        setStakeAutoApplied(true);
        return;
      }

      setStakeBusy(true);
      setStakeMsg(null);

      // ✅ Prefer endpoints that should map to your `public.stakeholders` table
      const candidates = [
        `/api/stakeholders?project_id=${encodeURIComponent(pid)}`,
        `/api/stakeholders?projectId=${encodeURIComponent(pid)}`,
        `/api/stakeholders/list?project_id=${encodeURIComponent(pid)}`,
        `/api/projects/${pid}/stakeholders`,
      ];

      let list: KeyStakeholder[] = [];
      for (const url of candidates) {
        const json = await tryFetchJson(url);
        const parsed = parseStakeholdersFromAny(json);
        if (parsed.length) {
          list = parsed;
          break;
        }
      }

      if (cancelled) return;

      if (!list.length) {
        setStakeMsg("No stakeholders found (or stakeholder API not available).");
        setStakeBusy(false);
        setTimeout(() => setStakeMsg(null), 4000);
        setStakeAutoApplied(true);
        return;
      }

      setDoc((d) => ({ ...d, stakeholders: { key: list } }));
      setStakeMsg("Key stakeholders generated from Stakeholder Register.");
      setStakeBusy(false);
      setTimeout(() => setStakeMsg(null), 2500);
      setStakeAutoApplied(true);
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [projectId, doc?.stakeholders?.key?.length, stakeAutoApplied]);

  async function refreshStakeholdersFromRegister() {
    const pid = safeStr(projectId).trim();
    if (!pid) return;

    setStakeBusy(true);
    setStakeMsg(null);

    const candidates = [
      `/api/stakeholders?project_id=${encodeURIComponent(pid)}`,
      `/api/stakeholders?projectId=${encodeURIComponent(pid)}`,
      `/api/stakeholders/list?project_id=${encodeURIComponent(pid)}`,
      `/api/projects/${pid}/stakeholders`,
    ];

    let list: KeyStakeholder[] = [];
    for (const url of candidates) {
      const json = await tryFetchJson(url);
      const parsed = parseStakeholdersFromAny(json);
      if (parsed.length) {
        list = parsed;
        break;
      }
    }

    if (!list.length) {
      setStakeMsg("No stakeholders found (or stakeholder API not available).");
      setStakeBusy(false);
      setTimeout(() => setStakeMsg(null), 4000);
      return;
    }

    setDoc((d) => ({ ...d, stakeholders: { key: list } }));
    setStakeMsg("Key stakeholders refreshed from Stakeholder Register.");
    setStakeBusy(false);
    setTimeout(() => setStakeMsg(null), 2500);
  }

  /* ── AI wiring (Closure Report) ─────────────────────────────────────────── */

  const closureMeta = useMemo(() => {
    return {
      project_name: doc?.project?.project_name,
      project_code: doc?.project?.project_code,
      client_name: doc?.project?.client_name,
      sponsor: doc?.project?.sponsor,
      pm: doc?.project?.pm,
      artifactType: "PROJECT_CLOSURE_REPORT",
      summary_format: "free_text_no_bullets",
    };
  }, [doc]);

  const { aiLoadingKey, aiError, improveSection, regenerateSection } = useClosureAI({
    doc,
    meta: closureMeta,
    getSectionByKey: (key: string) => getClosureSection(doc, key),
    applySectionReplace: (key: string, section: AiSection) =>
      applyClosureSectionReplace(setDoc, key, section),
    onDirty: () => {},
  });

  /* ── Item Mutators ───────────────────────────────────────────────────────── */

  const addStakeholder = () => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      stakeholders: { key: [...d.stakeholders.key, { name: "", role: "" }] },
    }));
  };
  const removeStakeholder = (idx: number) => {
    if (!canEdit) return;
    setDoc((d) => ({ ...d, stakeholders: { key: removeAt(d.stakeholders.key, idx) } }));
  };

  const addAchievement = () => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      achievements: {
        key_achievements: [...d.achievements.key_achievements, { text: "" }],
      },
    }));
  };
  const removeAchievement = (idx: number) => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      achievements: {
        key_achievements: removeAt(d.achievements.key_achievements, idx),
      },
    }));
  };

  const addCriterion = () => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      success: { criteria: [...d.success.criteria, { text: "", achieved: "yes" }] },
    }));
  };
  const removeCriterion = (idx: number) => {
    if (!canEdit) return;
    setDoc((d) => ({ ...d, success: { criteria: removeAt(d.success.criteria, idx) } }));
  };

  const addDelivered = () => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      deliverables: {
        ...d.deliverables,
        delivered: [
          ...d.deliverables.delivered,
          { deliverable: "", accepted_by: "", accepted_on: null },
        ],
      },
    }));
  };
  const removeDelivered = (idx: number) => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      deliverables: {
        ...d.deliverables,
        delivered: removeAt(d.deliverables.delivered, idx),
      },
    }));
  };

  const addOutstanding = () => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      deliverables: {
        ...d.deliverables,
        outstanding: [
          ...d.deliverables.outstanding,
          { item: "", owner: "", status: "", target: "" },
        ],
      },
    }));
  };
  const removeOutstanding = (idx: number) => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      deliverables: {
        ...d.deliverables,
        outstanding: removeAt(d.deliverables.outstanding, idx),
      },
    }));
  };

  const addBudgetRow = () => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      financial_closeout: {
        ...d.financial_closeout,
        budget_rows: [
          ...d.financial_closeout.budget_rows,
          { category: "", budget: null, actual: null },
        ],
      },
    }));
  };
  const removeBudgetRow = (idx: number) => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      financial_closeout: {
        ...d.financial_closeout,
        budget_rows: removeAt(d.financial_closeout.budget_rows, idx),
      },
    }));
  };

  const addLesson = (key: "went_well" | "didnt_go_well" | "surprises_risks") => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      lessons: {
        ...d.lessons,
        [key]: [...d.lessons[key], { text: "", action: "" }] as any,
      },
    }));
  };
  const removeLesson = (
    key: "went_well" | "didnt_go_well" | "surprises_risks",
    idx: number
  ) => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      lessons: { ...d.lessons, [key]: removeAt(d.lessons[key], idx) as any },
    }));
  };

  const addRiskIssue = () => {
    if (!canEdit) return;
    setDoc((d) => {
      const existing = d.handover.risks_issues || [];
      const nextHuman = generateRiskHumanId(existing);
      const next: RiskIssueRow = {
        id: makeInternalId(),
        human_id: nextHuman,
        description: "",
        severity: "medium",
        owner: "",
        status: "",
        next_action: "",
      };
      return {
        ...d,
        handover: { ...d.handover, risks_issues: [...existing, next] },
      };
    });
  };
  const removeRiskIssue = (idx: number) => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      handover: {
        ...d.handover,
        risks_issues: removeAt(d.handover.risks_issues, idx),
      },
    }));
  };

  const addTeamMove = () => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      handover: {
        ...d.handover,
        team_moves: [
          ...d.handover.team_moves,
          { person: "", change: "", date: null },
        ],
      },
    }));
  };
  const removeTeamMove = (idx: number) => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      handover: {
        ...d.handover,
        team_moves: removeAt(d.handover.team_moves, idx),
      },
    }));
  };

  const addRecommendation = () => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      recommendations: {
        items: [...d.recommendations.items, { text: "", owner: "", due: null }],
      },
    }));
  };
  const removeRecommendation = (idx: number) => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      recommendations: { items: removeAt(d.recommendations.items, idx) },
    }));
  };

  const addLink = () => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      links: { items: [...d.links.items, { label: "", url: "" }] },
    }));
  };
  const removeLink = (idx: number) => {
    if (!canEdit) return;
    setDoc((d) => ({ ...d, links: { items: removeAt(d.links.items, idx) } }));
  };

  /* ── SAVE ───────────────────────────────────────────────────────────────── */

  async function saveBestEffort() {
    if (isReadOnly) return;

    if (projectId) {
      try {
        const res = await fetch(`/api/artifacts/${artifactId}/content-json`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, content_json: doc }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json?.ok) return;
      } catch {}
    }

    const res = await fetch("/api/artifacts/update-json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artifact_id: artifactId, content_json: doc }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Save failed");
  }

  async function handleSave() {
    if (isReadOnly) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await saveBestEffort();
      setOriginalDoc(doc);
      setSaveMsg("Saved");
    } catch (e: any) {
      setSaveMsg(`Save failed: ${e?.message || "Unknown error"}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 4000);
    }
  }

  /* ── DOWNLOAD (uses your real export routes) ─────────────────────────────── */
  function filenameFromContentDisposition(cd: string | null): string | null {
    if (!cd) return null;

    const mStar = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(cd);
    if (mStar?.[1]) {
      try {
        return decodeURIComponent(mStar[1]).replace(/^"|"$/g, "");
      } catch {
        return mStar[1].replace(/^"|"$/g, "");
      }
    }

    const m = /filename\s*=\s*("?)([^";]+)\1/i.exec(cd);
    if (m?.[2]) return m[2];

    return null;
  }

  async function handleDownload(type: "pdf" | "docx") {
    if (dlBusy) return;
    setDlBusy(type);
    setDlMsg(null);

    try {
      try {
        await saveBestEffort();
        setOriginalDoc(doc);
      } catch {}

      const endpoint = `/api/artifacts/closure-report/export/${type}`;

      const code = (doc?.project?.project_code || "").trim();
      const filenameBase = code ? `${code}-closure-report` : "Closure-Report";

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artifact_id: artifactId,
          filenameBase,
        }),
      });

      if (!res.ok) {
        const ct = res.headers.get("content-type") || "";
        const payload = ct.includes("application/json")
          ? await res.json().catch(() => ({}))
          : await res.text().catch(() => "");

        const msg =
          typeof payload === "string"
            ? payload.slice(0, 600)
            : payload?.error ||
              payload?.message ||
              JSON.stringify(payload).slice(0, 600);

        throw new Error(`Export failed: ${res.status} - ${msg}`);
      }

      const blob = await res.blob();

      const cd = res.headers.get("content-disposition");
      const serverName =
        filenameFromContentDisposition(cd) ||
        `Closure-Report.${type === "pdf" ? "pdf" : "docx"}`;

      downloadBlob(blob, serverName);

      setDlMsg(`${type.toUpperCase()} downloaded`);
    } catch (e: any) {
      setDlMsg(`${type.toUpperCase()} download failed: ${e?.message || "Error"}`);
    } finally {
      setDlBusy(null);
      setTimeout(() => setDlMsg(null), 4000);
    }
  }

  /* ── ATTACHMENTS ─────────────────────────────────────────────────────────── */

  async function handleUpload(fileList: FileList | null) {
    if (!canEdit) return;
    if (!fileList || fileList.length === 0) return;

    setUploading(true);
    setUploadMsg(null);

    try {
      const form = new FormData();
      form.append("artifact_id", artifactId);
      if (projectId) form.append("project_id", String(projectId));
      Array.from(fileList).forEach((f) => form.append("files", f, f.name));

      const res = await fetch("/api/artifacts/attachments/upload", {
        method: "POST",
        body: form,
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Upload failed");

      const items: AttachmentItem[] = Array.isArray(json?.items)
        ? json.items
        : Array.isArray(json?.attachments)
          ? json.attachments
          : [];
      if (items.length) {
        setDoc((d) => ({
          ...d,
          attachments: { items: [...d.attachments.items, ...items] },
        }));
      }

      setUploadMsg("Uploaded.");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e: any) {
      setUploadMsg(`Upload failed: ${e?.message || e}`);
    } finally {
      setUploading(false);
      setTimeout(() => setUploadMsg(null), 4000);
    }
  }

  async function handleDeleteAttachment(att: AttachmentItem, idx: number) {
    if (!canEdit) return;

    const key = String(att.path || att.url || att.filename || idx);
    if (attBusy) return;

    setAttBusy(key);
    setUploadMsg(null);

    try {
      const res = await fetch("/api/artifacts/attachments/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artifact_id: artifactId,
          path: att.path || undefined,
          url: att.url || undefined,
          filename: att.filename || undefined,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Delete failed");

      setDoc((d) => ({
        ...d,
        attachments: {
          items: d.attachments.items.filter((_, i) => i !== idx),
        },
      }));
      setUploadMsg("Attachment removed.");
    } catch (e: any) {
      setUploadMsg(`Remove failed: ${e?.message || e}`);
    } finally {
      setAttBusy(null);
      setTimeout(() => setUploadMsg(null), 4000);
    }
  }

  // Used for placeholders only (do NOT disable PM field; user must be able to override)
  const projectFieldsAuto = !!safeStr(projectId).trim();

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: globalCSS }} />

      <div
        className="closure-editor"
        style={{ minHeight: "100vh", background: "var(--bg)", paddingBottom: 80 }}
      >
        {/* Top Fixed Header */}
        <div
          className="c-header"
          style={{
            position: "sticky",
            top: 0,
            zIndex: 20,
            borderBottom: "1px solid var(--border)",
            padding: "0 32px",
          }}
        >
          <div
            style={{
              maxWidth: 1200,
              margin: "0 auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              height: 64,
              gap: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flex: 1,
                minWidth: 0,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "var(--accent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <FileText size={16} color="white" />
              </div>
              <input
                style={{
                  fontFamily: "var(--display)",
                  fontSize: 18,
                  fontWeight: 400,
                  color: "var(--text)",
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  width: "100%",
                  minWidth: 0,
                  padding: "4px 0",
                }}
                value={doc.project.project_name || "Untitled Closure Report"}
                disabled={isReadOnly}
                onChange={(e) =>
                  setDoc((d) => ({
                    ...d,
                    project: { ...d.project, project_name: e.target.value },
                  }))
                }
                placeholder="Project Title"
              />
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexShrink: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="c-pill" style={ragPill(doc.health.rag)}>
                  RAG: {doc.health.rag.toUpperCase()}
                </span>
                <span className="c-pill" style={overallPill(doc.health.overall_health)}>
                  Overall: {doc.health.overall_health}
                </span>
              </div>

              <div
                style={{
                  width: 1,
                  height: 28,
                  background: "var(--border)",
                  flexShrink: 0,
                }}
              />

              <Button
                onClick={handleSave}
                disabled={isReadOnly || saving || autoSaving}
                variant="default"
                size="sm"
                className={saving || autoSaving ? "c-saving" : ""}
                style={{
                  background: "var(--accent)",
                  borderRadius: "var(--radius-sm)",
                  fontWeight: 600,
                  fontSize: 13,
                  minWidth: 140,
                  height: 36,
                }}
              >
                {saving || autoSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {autoSaving ? "Auto-saving..." : "Saving..."}
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save Report
                  </>
                )}
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={dlBusy !== null}
                    style={{
                      borderRadius: "var(--radius-sm)",
                      borderColor: "var(--border)",
                      fontWeight: 500,
                      fontSize: 13,
                      height: 36,
                      color: "var(--text-2)",
                    }}
                  >
                    {dlBusy ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Exporting...
                      </>
                    ) : (
                      <>
                        <Download className="mr-2 h-4 w-4" />
                        Export
                      </>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleDownload("pdf")}>
                    <FileText className="mr-2 h-4 w-4" />
                    Export as PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleDownload("docx")}>
                    <FileIcon className="mr-2 h-4 w-4" />
                    Export as Word (.docx)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {(metaBusy || metaMsg) && (
                <StatusMsg
                  msg={metaBusy ? "Loading project meta…" : metaMsg}
                  isError={!!metaMsg?.includes("Could not")}
                />
              )}

              <StatusMsg msg={saveMsg} isError={!!saveMsg?.includes("failed")} />
              <StatusMsg msg={dlMsg} isError={!!dlMsg?.includes("failed")} />
              {aiError && <StatusMsg msg={aiError} isError />}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            padding: "40px 32px",
            display: "flex",
            flexDirection: "column",
            gap: 32,
          }}
        >
          {/* ═══ 01 PROJECT SUMMARY ═══ */}
          <div ref={refProjectSummary}>
            <Section title="Project Summary" num="01 — Overview">
              <RowGrid>
                <Field label="Project Name">
                  <input
                    className="c-input"
                    style={inputBase}
                    value={doc.project.project_name}
                    disabled={isReadOnly}
                    onChange={(e) =>
                      setDoc((d) => ({
                        ...d,
                        project: { ...d.project, project_name: e.target.value },
                      }))
                    }
                  />
                </Field>

                <Field label="Project Code / ID">
                  <input
                    className="c-input"
                    style={inputBase}
                    value={doc.project.project_code}
                    disabled={isReadOnly}
                    onChange={(e) =>
                      setDoc((d) => ({
                        ...d,
                        project: { ...d.project, project_code: e.target.value },
                      }))
                    }
                    placeholder={projectFieldsAuto ? "Auto-populated (editable)" : ""}
                    title={
                      projectFieldsAuto
                        ? "Auto-populated from the project record (you can override)"
                        : undefined
                    }
                  />
                </Field>

                <Field label="Client / Business">
                  <input
                    className="c-input"
                    style={inputBase}
                    value={doc.project.client_name}
                    disabled={isReadOnly}
                    onChange={(e) =>
                      setDoc((d) => ({
                        ...d,
                        project: { ...d.project, client_name: e.target.value },
                      }))
                    }
                  />
                </Field>

                <Field label="Sponsor">
                  <input
                    className="c-input"
                    style={inputBase}
                    value={doc.project.sponsor}
                    disabled={isReadOnly}
                    onChange={(e) =>
                      setDoc((d) => ({
                        ...d,
                        project: { ...d.project, sponsor: e.target.value },
                      }))
                    }
                  />
                </Field>

                <Field label="Project Manager">
                  <input
                    className="c-input"
                    style={inputBase}
                    value={doc.project.pm}
                    disabled={isReadOnly}
                    onChange={(e) =>
                      setDoc((d) => ({
                        ...d,
                        project: { ...d.project, pm: e.target.value },
                      }))
                    }
                    placeholder={
                      projectFieldsAuto ? "Auto-populated (override allowed)" : ""
                    }
                    title={
                      projectFieldsAuto
                        ? "Auto-populated from the project record (you can override)"
                        : undefined
                    }
                  />
                </Field>
              </RowGrid>

              <div
                style={{
                  marginTop: 28,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 2fr",
                  gap: 20,
                }}
              >
                <Field label="RAG Status">
                  <select
                    className={`c-select ${ragSelectAccent(doc.health.rag)}`}
                    style={selectBase}
                    value={doc.health.rag}
                    disabled={isReadOnly}
                    onChange={(e) =>
                      setDoc((d) => ({
                        ...d,
                        health: { ...d.health, rag: e.target.value as Rag },
                      }))
                    }
                  >
                    <option value="green">Green</option>
                    <option value="amber">Amber</option>
                    <option value="red">Red</option>
                  </select>
                </Field>

                <Field label="Overall Health">
                  <select
                    className={`c-select ${overallSelectAccent(doc.health.overall_health)}`}
                    style={selectBase}
                    value={doc.health.overall_health}
                    disabled={isReadOnly}
                    onChange={(e) =>
                      setDoc((d) => ({
                        ...d,
                        health: {
                          ...d.health,
                          overall_health: e.target.value as any,
                        },
                      }))
                    }
                  >
                    <option value="good">Good</option>
                    <option value="watch">Watch</option>
                    <option value="critical">Critical</option>
                  </select>
                </Field>

                <Field label="Executive Summary" hint="Free text only — no bullet points">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: 6,
                      marginBottom: 6,
                    }}
                  >
                    <button
                      type="button"
                      className="c-btn"
                      style={aiBtn}
                      disabled={
                        isReadOnly || aiLoadingKey === "closure.health.summary"
                      }
                      onClick={() => improveSection("closure.health.summary")}
                    >
                      {aiLoadingKey === "closure.health.summary"
                        ? "Working…"
                        : "✦ Improve"}
                    </button>
                    <button
                      type="button"
                      className="c-btn"
                      style={aiBtn}
                      disabled={
                        isReadOnly || aiLoadingKey === "closure.health.summary"
                      }
                      onClick={() => regenerateSection("closure.health.summary")}
                    >
                      {aiLoadingKey === "closure.health.summary"
                        ? "Working…"
                        : "✦ Regenerate"}
                    </button>
                  </div>

                  <textarea
                    className="c-textarea"
                    style={{ ...textareaBase, minHeight: 120 }}
                    value={doc.health.summary}
                    disabled={isReadOnly}
                    onChange={(e) =>
                      setDoc((d) => ({
                        ...d,
                        health: { ...d.health, summary: e.target.value },
                      }))
                    }
                    onBlur={() =>
                      setDoc((d) => ({
                        ...d,
                        health: {
                          ...d.health,
                          summary: normalizeFreeTextNoBullets(d.health.summary),
                        },
                      }))
                    }
                    placeholder="Write an executive closure summary (paragraph form)."
                  />
                </Field>
              </div>
            </Section>
          </div>

          {/* ═══ 02 KEY STAKEHOLDERS ═══ */}
          <Section
            title="Key Stakeholders"
            num="02 — People"
            right={
              <>
                {stakeMsg && (
                  <StatusMsg
                    msg={stakeMsg}
                    isError={!!stakeMsg?.includes("No stakeholders")}
                  />
                )}
                <button
                  type="button"
                  className="c-btn"
                  style={smallBtn}
                  disabled={
                    isReadOnly || stakeBusy || !safeStr(projectId).trim()
                  }
                  onClick={refreshStakeholdersFromRegister}
                  title={
                    !safeStr(projectId).trim()
                      ? "Project id required to load stakeholder register"
                      : undefined
                  }
                >
                  {stakeBusy ? "Refreshing…" : "↻ Refresh from Register"}
                </button>

                {canEdit && (
                  <button
                    type="button"
                    className="c-btn"
                    style={smallBtn}
                    onClick={addStakeholder}
                  >
                    + Add Stakeholder
                  </button>
                )}
              </>
            }
          >
            {doc.stakeholders.key.length === 0 ? (
              <EmptyState
                text={`No key stakeholders recorded yet.${safeStr(projectId).trim() ? " (They can be generated from the Stakeholder Register.)" : ""}`}
              />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {doc.stakeholders.key.map((stake, i) => (
                  <div
                    key={i}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr auto",
                      gap: 12,
                      alignItems: "center",
                    }}
                  >
                    <input
                      className="c-input"
                      style={inputBase}
                      placeholder="Name"
                      value={stake.name}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        setDoc((d) => ({
                          ...d,
                          stakeholders: {
                            key: updateArray(d.stakeholders.key, i, (s) => ({
                              ...s,
                              name: e.target.value,
                            })),
                          },
                        }))
                      }
                    />
                    <input
                      className="c-input"
                      style={inputBase}
                      placeholder="Role / Responsibility"
                      value={stake.role}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        setDoc((d) => ({
                          ...d,
                          stakeholders: {
                            key: updateArray(d.stakeholders.key, i, (s) => ({
                              ...s,
                              role: e.target.value,
                            })),
                          },
                        }))
                      }
                    />
                    {canEdit && (
                      <button
                        type="button"
                        className="c-btn-danger"
                        style={dangerBtn}
                        onClick={() => removeStakeholder(i)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* ═══ 03 KEY ACHIEVEMENTS ═══ */}
          <Section
            title="Key Achievements"
            num="03 — Outcomes"
            right={
              <>
                <button
                  type="button"
                  className="c-btn"
                  style={aiBtn}
                  disabled={isReadOnly || aiLoadingKey === "closure.achievements"}
                  onClick={() => improveSection("closure.achievements")}
                >
                  {aiLoadingKey === "closure.achievements"
                    ? "Working…"
                    : "✦ Improve"}
                </button>
                <button
                  type="button"
                  className="c-btn"
                  style={aiBtn}
                  disabled={isReadOnly || aiLoadingKey === "closure.achievements"}
                  onClick={() => regenerateSection("closure.achievements")}
                >
                  {aiLoadingKey === "closure.achievements"
                    ? "Working…"
                    : "✦ Regenerate"}
                </button>

                {canEdit && (
                  <button
                    type="button"
                    className="c-btn"
                    style={smallBtn}
                    onClick={addAchievement}
                  >
                    + Add Achievement
                  </button>
                )}
              </>
            }
          >
            {doc.achievements.key_achievements.length === 0 ? (
              <EmptyState text="No key achievements recorded yet." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {doc.achievements.key_achievements.map((ach, i) => (
                  <div
                    key={i}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: 12,
                      alignItems: "start",
                    }}
                  >
                    <textarea
                      className="c-textarea"
                      style={textareaBase}
                      placeholder="Describe the achievement / milestone"
                      value={ach.text}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        setDoc((d) => ({
                          ...d,
                          achievements: {
                            key_achievements: updateArray(
                              d.achievements.key_achievements,
                              i,
                              (a) => ({
                                ...a,
                                text: e.target.value,
                              })
                            ),
                          },
                        }))
                      }
                    />
                    {canEdit && (
                      <button
                        type="button"
                        className="c-btn-danger"
                        style={{ ...dangerBtn, marginTop: 8 }}
                        onClick={() => removeAchievement(i)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* ═══ 04 SUCCESS CRITERIA ═══ */}
          <Section
            title="Success Criteria"
            num="04 — Evaluation"
            right={
              canEdit && (
                <button
                  type="button"
                  className="c-btn"
                  style={smallBtn}
                  onClick={addCriterion}
                >
                  + Add
                </button>
              )
            }
          >
            {doc.success.criteria.length === 0 ? (
              <EmptyState text="No success criteria recorded." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {doc.success.criteria.map((c, i) => (
                  <div
                    key={i}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 160px auto",
                      gap: 12,
                      alignItems: "start",
                    }}
                  >
                    <textarea
                      className="c-textarea"
                      style={textareaBase}
                      placeholder="Criterion"
                      value={c.text}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        setDoc((d) => ({
                          ...d,
                          success: {
                            criteria: updateArray(d.success.criteria, i, (x) => ({
                              ...x,
                              text: e.target.value,
                            })),
                          },
                        }))
                      }
                    />
                    <div>
                      <Field label="Status">
                        <select
                          className="c-select"
                          style={selectBase}
                          value={c.achieved}
                          disabled={isReadOnly}
                          onChange={(e) =>
                            setDoc((d) => ({
                              ...d,
                              success: {
                                criteria: updateArray(d.success.criteria, i, (x) => ({
                                  ...x,
                                  achieved: e.target.value as Achieved,
                                })),
                              },
                            }))
                          }
                        >
                          <option value="yes">Achieved</option>
                          <option value="partial">Partially achieved</option>
                          <option value="no">Not achieved</option>
                        </select>
                      </Field>
                      <div style={{ marginTop: 8 }}>
                        <AchievedBadge achieved={c.achieved} />
                      </div>
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        className="c-btn-danger"
                        style={{ ...dangerBtn, marginTop: 8 }}
                        onClick={() => removeCriterion(i)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* ═══ 05 DELIVERABLES & ACCEPTANCE ═══ */}
          <div ref={refOutstanding}>
            <Section title="Deliverables & Acceptance" num="05 — Delivery">
              <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
                {/* Delivered */}
                <div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 16,
                    }}
                  >
                    <h3
                      style={{
                        fontFamily: "var(--display)",
                        fontSize: 16,
                        color: "var(--text)",
                        margin: 0,
                      }}
                    >
                      Delivered Items
                    </h3>
                    {canEdit && (
                      <button
                        type="button"
                        className="c-btn"
                        style={smallBtn}
                        onClick={addDelivered}
                      >
                        + Add
                      </button>
                    )}
                  </div>
                  {doc.deliverables.delivered.length === 0 ? (
                    <EmptyState text="No delivered items recorded." />
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      {doc.deliverables.delivered.map((item, i) => (
                        <div
                          key={i}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "2fr 1fr 1fr auto",
                            gap: 12,
                            alignItems: "center",
                          }}
                        >
                          <input
                            className="c-input"
                            style={inputBase}
                            placeholder="Deliverable"
                            value={item.deliverable}
                            disabled={isReadOnly}
                            onChange={(e) =>
                              setDoc((d) => ({
                                ...d,
                                deliverables: {
                                  ...d.deliverables,
                                  delivered: updateArray(
                                    d.deliverables.delivered,
                                    i,
                                    (it) => ({
                                      ...it,
                                      deliverable: e.target.value,
                                    })
                                  ),
                                },
                              }))
                            }
                          />
                          <input
                            className="c-input"
                            style={inputBase}
                            placeholder="Accepted by"
                            value={item.accepted_by}
                            disabled={isReadOnly}
                            onChange={(e) =>
                              setDoc((d) => ({
                                ...d,
                                deliverables: {
                                  ...d.deliverables,
                                  delivered: updateArray(
                                    d.deliverables.delivered,
                                    i,
                                    (it) => ({
                                      ...it,
                                      accepted_by: e.target.value,
                                    })
                                  ),
                                },
                              }))
                            }
                          />
                          <input
                            type="date"
                            className="c-input"
                            style={inputBase}
                            value={item.accepted_on ?? ""}
                            disabled={isReadOnly}
                            onChange={(e) =>
                              setDoc((d) => ({
                                ...d,
                                deliverables: {
                                  ...d.deliverables,
                                  delivered: updateArray(
                                    d.deliverables.delivered,
                                    i,
                                    (it) => ({
                                      ...it,
                                      accepted_on: e.target.value,
                                    })
                                  ),
                                },
                              }))
                            }
                          />
                          {canEdit && (
                            <button
                              type="button"
                              className="c-btn-danger"
                              style={dangerBtn}
                              onClick={() => removeDelivered(i)}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Outstanding */}
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 24 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 16,
                    }}
                  >
                    <h3
                      style={{
                        fontFamily: "var(--display)",
                        fontSize: 16,
                        color: "var(--text)",
                        margin: 0,
                      }}
                    >
                      Outstanding Items
                    </h3>
                    {canEdit && (
                      <button type="button" className="c-btn" style={smallBtn} onClick={addOutstanding}>
                        + Add
                      </button>
                    )}
                  </div>
                  {doc.deliverables.outstanding.length === 0 ? (
                    <EmptyState text="No outstanding items recorded." />
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {doc.deliverables.outstanding.map((item, i) => (
                        <div
                          key={i}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "2fr 1fr 1fr 1fr auto",
                            gap: 12,
                            alignItems: "center",
                          }}
                        >
                          <input className="c-input" style={inputBase} placeholder="Item" value={item.item} disabled={isReadOnly} onChange={(e) => setDoc((d) => ({ ...d, deliverables: { ...d.deliverables, outstanding: updateArray(d.deliverables.outstanding, i, (it) => ({ ...it, item: e.target.value })) } }))} />
                          <input className="c-input" style={inputBase} placeholder="Owner" value={item.owner} disabled={isReadOnly} onChange={(e) => setDoc((d) => ({ ...d, deliverables: { ...d.deliverables, outstanding: updateArray(d.deliverables.outstanding, i, (it) => ({ ...it, owner: e.target.value })) } }))} />
                          <input className="c-input" style={inputBase} placeholder="Status" value={item.status} disabled={isReadOnly} onChange={(e) => setDoc((d) => ({ ...d, deliverables: { ...d.deliverables, outstanding: updateArray(d.deliverables.outstanding, i, (it) => ({ ...it, status: e.target.value })) } }))} />
                          <input className="c-input" style={inputBase} placeholder="Target date" value={item.target} disabled={isReadOnly} onChange={(e) => setDoc((d) => ({ ...d, deliverables: { ...d.deliverables, outstanding: updateArray(d.deliverables.outstanding, i, (it) => ({ ...it, target: e.target.value })) } }))} />
                          {canEdit && (
                            <button type="button" className="c-btn-danger" style={dangerBtn} onClick={() => removeOutstanding(i)}>
                              Remove
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Acceptance checklist */}
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 24 }}>
                  <h3 style={{ fontFamily: "var(--display)", fontSize: 16, color: "var(--text)", margin: "0 0 16px" }}>
                    Acceptance Checklist
                  </h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--text)", cursor: isReadOnly ? "default" : "pointer" }}>
                      <input type="checkbox" checked={doc.deliverables.acceptance_checklist.sponsor_signed} disabled={isReadOnly} onChange={(e) => setDoc((d) => ({ ...d, deliverables: { ...d.deliverables, acceptance_checklist: { ...d.deliverables.acceptance_checklist, sponsor_signed: e.target.checked } } }))} />
                      Sponsor signed off
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--text)", cursor: isReadOnly ? "default" : "pointer" }}>
                      <input type="checkbox" checked={doc.deliverables.acceptance_checklist.bau_accepted} disabled={isReadOnly} onChange={(e) => setDoc((d) => ({ ...d, deliverables: { ...d.deliverables, acceptance_checklist: { ...d.deliverables.acceptance_checklist, bau_accepted: e.target.checked } } }))} />
                      BAU / Operations accepted
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--text)", cursor: isReadOnly ? "default" : "pointer" }}>
                      <input type="checkbox" checked={doc.deliverables.acceptance_checklist.knowledge_transfer_done} disabled={isReadOnly} onChange={(e) => setDoc((d) => ({ ...d, deliverables: { ...d.deliverables, acceptance_checklist: { ...d.deliverables.acceptance_checklist, knowledge_transfer_done: e.target.checked } } }))} />
                      Knowledge transfer completed
                    </label>
                  </div>
                </div>

                {/* Sponsor signoff */}
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 24 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                    <Field label="Sponsor Sign-off Name">
                      <input className="c-input" style={inputBase} value={doc.deliverables.sponsor_signoff_name} disabled={isReadOnly} onChange={(e) => setDoc((d) => ({ ...d, deliverables: { ...d.deliverables, sponsor_signoff_name: e.target.value } }))} />
                    </Field>
                    <Field label="Sign-off Date">
                      <input type="date" className="c-input" style={inputBase} value={doc.deliverables.sponsor_signoff_date ?? ""} disabled={isReadOnly} onChange={(e) => setDoc((d) => ({ ...d, deliverables: { ...d.deliverables, sponsor_signoff_date: e.target.value } }))} />
                    </Field>
                  </div>
                </div>
              </div>
            </Section>
          </div>

          {/* ═══ 06 FINANCIAL CLOSEOUT ═══ */}
          <div ref={refFinancial}>
            <Section
              title="Financial Closeout"
              num="06 — Finance"
              right={
                <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 13, fontFamily: "var(--mono)", fontWeight: 500 }}>
                  <span style={{ color: "var(--text-2)" }}>Budget: <strong style={{ color: "var(--text)" }}>{fmtPounds(financialTotals.budget || 0)}</strong></span>
                  <span style={{ color: "var(--text-2)" }}>Actual: <strong style={{ color: "var(--text)" }}>{fmtPounds(financialTotals.actual || 0)}</strong></span>
                  <span style={{ color: "var(--text-2)" }}>
                    Variance:{" "}
                    <strong style={{ color: financialTotals.variance > 0 ? "var(--red)" : "var(--green)" }}>
                      {fmtPounds(financialTotals.variance || 0)}
                    </strong>
                    {financialTotals.pct != null && (
                      <span style={{ fontSize: 11, marginLeft: 4, opacity: 0.7 }}>
                        ({financialTotals.pct.toFixed(1)}%)
                      </span>
                    )}
                  </span>
                </div>
              }
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <h3 style={{ fontFamily: "var(--display)", fontSize: 16, color: "var(--text)", margin: 0 }}>Budget Summary</h3>
                    {canEdit && (
                      <button type="button" className="c-btn" style={smallBtn} onClick={addBudgetRow}>
                        + Add Row
                      </button>
                    )}
                  </div>

                  {doc.financial_closeout.budget_rows.length === 0 ? (
                    <EmptyState text="No budget rows added." />
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 12, padding: "0 0 8px", borderBottom: "1px solid var(--border)" }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Category</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Budget (£)</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Actual (£)</span>
                        <span style={{ width: 70 }} />
                      </div>
                      {doc.financial_closeout.budget_rows.map((row, i) => (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 12, alignItems: "center" }}>
                          <input className="c-input" style={inputBase} placeholder="Category" value={row.category} disabled={isReadOnly} onChange={(e) => setDoc((d) => ({ ...d, financial_closeout: { ...d.financial_closeout, budget_rows: updateArray(d.financial_closeout.budget_rows, i, (r) => ({ ...r, category: e.target.value })) } }))} />
                          <input type="number" className="c-input" style={{ ...inputBase, fontFamily: "var(--mono)" }} placeholder="0" value={row.budget ?? ""} disabled={isReadOnly} onChange={(e) => setDoc((d) => ({ ...d, financial_closeout: { ...d.financial_closeout, budget_rows: updateArray(d.financial_closeout.budget_rows, i, (r) => ({ ...r, budget: asMoney(e.target.value) })) } }))} />
                          <input type="number" className="c-input" style={{ ...inputBase, fontFamily: "var(--mono)" }} placeholder="0" value={row.actual ?? ""} disabled={isReadOnly} onChange={(e) => setDoc((d) => ({ ...d, financial_closeout: { ...d.financial_closeout, budget_rows: updateArray(d.financial_closeout.budget_rows, i, (r) => ({ ...r, actual: asMoney(e.target.value) })) } }))} />
                          {canEdit && (
                            <button type="button" className="c-btn-danger" style={dangerBtn} onClick={() => removeBudgetRow(i)}>Remove</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 24 }}>
                  <h3 style={{ fontFamily: "var(--display)", fontSize: 16, color: "var(--text)", margin: "0 0 16px" }}>ROI Metrics</h3>
                  <RowGrid>
                    <Field label="Annual Benefit">
                      <input className="c-input" style={inputBase} value={doc.financial_closeout.roi.annual_benefit} disabled={isReadOnly} onChange={(e) => setDoc((d) => ({ ...d, financial_closeout: { ...d.financial_closeout, roi: { ...d.financial_closeout.roi, annual_benefit: e.target.value } } }))} />
                    </Field>
                    <Field label="Payback Achieved">
                      <input className="c-input" style={inputBase} value={doc.financial_closeout.roi.payback_achieved} disabled={isReadOnly} onChange={(e) => setDoc((d) => ({ ...d, financial_closeout: { ...d.financial_closeout, roi: { ...d.financial_closeout.roi, payback_achieved: e.target.value } } }))} />
                    </Field>
                    <Field label="Payback Planned">
                      <input className="c-input" style={inputBase} value={doc.financial_closeout.roi.payback_planned} disabled={isReadOnly} onChange={(e) => setDoc((d) => ({ ...d, financial_closeout: { ...d.financial_closeout, roi: { ...d.financial_closeout.roi, payback_planned: e.target.value } } }))} />
                    </Field>
                    <Field label="NPV">
                      <input className="c-input" style={inputBase} value={doc.financial_closeout.roi.npv} disabled={isReadOnly} onChange={(e) => setDoc((d) => ({ ...d, financial_closeout: { ...d.financial_closeout, roi: { ...d.financial_closeout.roi, npv: e.target.value } } }))} />
                    </Field>
                  </RowGrid>
                </div>
              </div>
            </Section>
          </div>

          {/* ═══ 07 LESSONS LEARNED ═══ */}
          <div ref={refLessons}>
            <Section title="Lessons Learned" num="07 — Reflection">
              {(["went_well", "didnt_go_well", "surprises_risks"] as const).map((key, sectionIdx) => {
                const label = key === "went_well" ? "What went well" : key === "didnt_go_well" ? "What didn't go well" : "Surprises / Risks encountered";
                const icons = { went_well: "✓", didnt_go_well: "✗", surprises_risks: "⚡" };
                const aiKey = `closure.lessons.${key}`;

                return (
                  <div key={key} style={{ marginTop: sectionIdx > 0 ? 28 : 0, paddingTop: sectionIdx > 0 ? 24 : 0, borderTop: sectionIdx > 0 ? "1px solid var(--border)" : "none" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                      <h3 style={{ fontFamily: "var(--display)", fontSize: 16, color: "var(--text)", margin: 0 }}>
                        <span style={{ marginRight: 8 }}>{icons[key]}</span>{label}
                      </h3>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button type="button" className="c-btn" style={aiBtn} disabled={isReadOnly || aiLoadingKey === aiKey} onClick={() => improveSection(aiKey)}>
                          {aiLoadingKey === aiKey ? "Working…" : "✦ Improve"}
                        </button>
                        <button type="button" className="c-btn" style={aiBtn} disabled={isReadOnly || aiLoadingKey === aiKey} onClick={() => regenerateSection(aiKey)}>
                          {aiLoadingKey === aiKey ? "Working…" : "✦ Regenerate"}
                        </button>
                        {canEdit && (
                          <button type="button" className="c-btn" style={smallBtn} onClick={() => addLesson(key)}>+ Add</button>
                        )}
                      </div>
                    </div>

                    {doc.lessons[key].length === 0 ? (
                      <EmptyState text="Nothing recorded yet." />
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {doc.lessons[key].map((lesson, i) => (
                          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 12, alignItems: "start" }}>
                            <textarea className="c-textarea" style={textareaBase} placeholder="Description" value={lesson.text} disabled={isReadOnly}
                              onChange={(e) => setDoc((d) => ({ ...d, lessons: { ...d.lessons, [key]: updateArray(d.lessons[key], i, (l) => ({ ...l, text: e.target.value })) } }))} />
                            <textarea className="c-textarea" style={textareaBase} placeholder="Recommended action (optional)" value={lesson.action ?? ""} disabled={isReadOnly}
                              onChange={(e) => setDoc((d) => ({ ...d, lessons: { ...d.lessons, [key]: updateArray(d.lessons[key], i, (l) => ({ ...l, action: e.target.value })) } }))} />
                            {canEdit && (
                              <button type="button" className="c-btn-danger" style={{ ...dangerBtn, marginTop: 8 }} onClick={() => removeLesson(key, i)}>Remove</button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </Section>
          </div>

          {/* ═══ 08 HANDOVER & SUPPORT ═══ */}
          <Section title="Handover & Support" num="08 — Transition">
            <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
              {/* Open Risks & Issues */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <h3 style={{ fontFamily: "var(--display)", fontSize: 16, color: "var(--text)", margin: 0 }}>Open Risks & Issues</h3>
                  {canEdit && (<button type="button" className="c-btn" style={smallBtn} onClick={addRiskIssue}>+ Add Risk/Issue</button>)}
                </div>
                {doc.handover.risks_issues.length === 0 ? (<EmptyState text="No open risks or issues recorded." />) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {doc.handover.risks_issues.map((ri, i) => (
                      <div key={ri.id} className={`risk-${ri.severity}`} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 20, background: "var(--surface)", display: "flex", flexDirection: "column", gap: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <SeverityDot severity={ri.severity} />
                            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", fontFamily: "var(--mono)" }}>{ri.human_id || ri.id}</span>
                          </div>
                          {canEdit && (<button type="button" className="c-btn-danger" style={dangerBtn} onClick={() => removeRiskIssue(i)}>Remove</button>)}
                        </div>
                        <input className="c-input" style={inputBase} placeholder="Description of risk/issue" value={ri.description} disabled={isReadOnly}
                          onChange={(e) => setDoc((d) => ({ ...d, handover: { ...d.handover, risks_issues: updateArray(d.handover.risks_issues, i, (r) => ({ ...r, description: e.target.value })) } }))} />
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                          <Field label="Severity">
                            <select className="c-select" style={selectBase} value={ri.severity} disabled={isReadOnly}
                              onChange={(e) => setDoc((d) => ({ ...d, handover: { ...d.handover, risks_issues: updateArray(d.handover.risks_issues, i, (r) => ({ ...r, severity: e.target.value as any })) } }))}>
                              <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                            </select>
                          </Field>
                          <Field label="Owner"><input className="c-input" style={inputBase} value={ri.owner} disabled={isReadOnly} onChange={(e) => setDoc((d) => ({ ...d, handover: { ...d.handover, risks_issues: updateArray(d.handover.risks_issues, i, (r) => ({ ...r, owner: e.target.value })) } }))} /></Field>
                          <Field label="Status"><input className="c-input" style={inputBase} value={ri.status} disabled={isReadOnly} onChange={(e) => setDoc((d) => ({ ...d, handover: { ...d.handover, risks_issues: updateArray(d.handover.risks_issues, i, (r) => ({ ...r, status: e.target.value })) } }))} /></Field>
                          <Field label="Next Action"><input className="c-input" style={inputBase} value={ri.next_action} disabled={isReadOnly} onChange={(e) => setDoc((d) => ({ ...d, handover: { ...d.handover, risks_issues: updateArray(d.handover.risks_issues, i, (r) => ({ ...r, next_action: e.target.value })) } }))} /></Field>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Team Moves */}
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <h3 style={{ fontFamily: "var(--display)", fontSize: 16, color: "var(--text)", margin: 0 }}>Team Moves / Changes</h3>
                  {canEdit && (<button type="button" className="c-btn" style={smallBtn} onClick={addTeamMove}>+ Add Team Move</button>)}
                </div>
                {doc.handover.team_moves.length === 0 ? (<EmptyState text="No team changes recorded." />) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {doc.handover.team_moves.map((tm, i) => (
                      <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr auto", gap: 12, alignItems: "center" }}>
                        <input className="c-input" style={inputBase} placeholder="Person name" value={tm.person} disabled={isReadOnly} onChange={(e) => setDoc((d) => ({ ...d, handover: { ...d.handover, team_moves: updateArray(d.handover.team_moves, i, (t) => ({ ...t, person: e.target.value })) } }))} />
                        <input className="c-input" style={inputBase} placeholder="Change / role / departure reason" value={tm.change} disabled={isReadOnly} onChange={(e) => setDoc((d) => ({ ...d, handover: { ...d.handover, team_moves: updateArray(d.handover.team_moves, i, (t) => ({ ...t, change: e.target.value })) } }))} />
                        <input type="date" className="c-input" style={inputBase} value={tm.date ?? ""} disabled={isReadOnly} onChange={(e) => setDoc((d) => ({ ...d, handover: { ...d.handover, team_moves: updateArray(d.handover.team_moves, i, (t) => ({ ...t, date: e.target.value })) } }))} />
                        {canEdit && (<button type="button" className="c-btn-danger" style={dangerBtn} onClick={() => removeTeamMove(i)}>Remove</button>)}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Knowledge Transfer + Support Model */}
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 28, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  <h3 style={{ fontFamily: "var(--display)", fontSize: 16, color: "var(--text)", margin: 0 }}>Knowledge Transfer</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {[
                      { key: "docs_handed_over", label: "Documentation handed over" },
                      { key: "final_demo_done", label: "Final demo / walkthrough completed" },
                      { key: "support_model_doc", label: "Support model documented" },
                      { key: "runbook_finalised", label: "Runbook / operations guide finalised" },
                    ].map(({ key, label }) => (
                      <label key={key} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--text)", cursor: isReadOnly ? "default" : "pointer" }}>
                        <input type="checkbox" checked={doc.handover.knowledge_transfer[key as keyof typeof doc.handover.knowledge_transfer]} disabled={isReadOnly}
                          onChange={(e) => setDoc((d) => ({ ...d, handover: { ...d.handover, knowledge_transfer: { ...d.handover.knowledge_transfer, [key]: e.target.checked as any } } }))} />
                        {label}
                      </label>
                    ))}
                  </div>
                  <Field label="Additional notes">
                    <textarea className="c-textarea" style={textareaBase} value={doc.handover.knowledge_transfer.notes} disabled={isReadOnly}
                      onChange={(e) => setDoc((d) => ({ ...d, handover: { ...d.handover, knowledge_transfer: { ...d.handover.knowledge_transfer, notes: e.target.value } } }))} />
                  </Field>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  <h3 style={{ fontFamily: "var(--display)", fontSize: 16, color: "var(--text)", margin: 0 }}>Target Operating / Support Model</h3>
                  <Field label="Primary Support Contact"><input className="c-input" style={inputBase} value={doc.handover.support_model.primary_support} disabled={isReadOnly} onChange={(e) => setDoc((d) => ({ ...d, handover: { ...d.handover, support_model: { ...d.handover.support_model, primary_support: e.target.value } } }))} /></Field>
                  <Field label="Escalation Path"><input className="c-input" style={inputBase} value={doc.handover.support_model.escalation} disabled={isReadOnly} onChange={(e) => setDoc((d) => ({ ...d, handover: { ...d.handover, support_model: { ...d.handover.support_model, escalation: e.target.value } } }))} /></Field>
                  <Field label="Hypercare Ends"><input type="date" className="c-input" style={inputBase} value={doc.handover.support_model.hypercare_end ?? ""} disabled={isReadOnly} onChange={(e) => setDoc((d) => ({ ...d, handover: { ...d.handover, support_model: { ...d.handover.support_model, hypercare_end: e.target.value } } }))} /></Field>
                </div>
              </div>
            </div>
          </Section>

          {/* ═══ 09 RECOMMENDATIONS ═══ */}
          <Section title="Recommendations & Follow-up Actions" num="09 — Next Steps" right={<>
            <button type="button" className="c-btn" style={aiBtn} disabled={isReadOnly || aiLoadingKey === "closure.recommendations"} onClick={() => improveSection("closure.recommendations")}>{aiLoadingKey === "closure.recommendations" ? "Working…" : "✦ Improve"}</button>
            <button type="button" className="c-btn" style={aiBtn} disabled={isReadOnly || aiLoadingKey === "closure.recommendations"} onClick={() => regenerateSection("closure.recommendations")}>{aiLoadingKey === "closure.recommendations" ? "Working…" : "✦ Regenerate"}</button>
            {canEdit && (<button type="button" className="c-btn" style={smallBtn} onClick={addRecommendation}>+ Add</button>)}
          </>}>
            {doc.recommendations.items.length === 0 ? (<EmptyState text="No recommendations added." />) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {doc.recommendations.items.map((item, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 120px auto", gap: 12, alignItems: "start" }}>
                    <textarea className="c-textarea" style={textareaBase} placeholder="Text" value={item.text} disabled={isReadOnly}
                      onChange={(e) => setDoc((d) => ({ ...d, recommendations: { items: updateArray(d.recommendations.items, i, (it) => ({ ...it, text: e.target.value })) } }))} />
                    <input className="c-input" style={inputBase} placeholder="Owner" value={item.owner ?? ""} disabled={isReadOnly}
                      onChange={(e) => setDoc((d) => ({ ...d, recommendations: { items: updateArray(d.recommendations.items, i, (it) => ({ ...it, owner: e.target.value })) } }))} />
                    <input type="date" className="c-input" style={inputBase} value={item.due ?? ""} disabled={isReadOnly}
                      onChange={(e) => setDoc((d) => ({ ...d, recommendations: { items: updateArray(d.recommendations.items, i, (it) => ({ ...it, due: e.target.value })) } }))} />
                    {canEdit && (<button type="button" className="c-btn-danger" style={{ ...dangerBtn, marginTop: 8 }} onClick={() => removeRecommendation(i)}>Remove</button>)}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* ═══ 10 USEFUL LINKS ═══ */}
          <Section title="Useful Links & References" num="10 — Resources" right={canEdit && (<button type="button" className="c-btn" style={smallBtn} onClick={addLink}>+ Add link</button>)}>
            {doc.links.items.length === 0 ? (<EmptyState text="No links added yet." />) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {doc.links.items.map((item, i) => {
                  const url = safeUrl(item.url);
                  const openable = canOpenUrl(url);
                  const displayText = item.label?.trim() ? item.label.trim() : url || "Open link";
                  return (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 12, alignItems: "center" }}>
                      <input className="c-input" style={inputBase} placeholder="Label" value={item.label} disabled={isReadOnly}
                        onChange={(e) => setDoc((d) => ({ ...d, links: { items: updateArray(d.links.items, i, (it) => ({ ...it, label: e.target.value })) } }))} />
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <input className="c-input" style={inputBase} placeholder="URL (https://...)" value={item.url} disabled={isReadOnly}
                            onChange={(e) => setDoc((d) => ({ ...d, links: { items: updateArray(d.links.items, i, (it) => ({ ...it, url: e.target.value })) } }))} />
                          <button type="button" className="c-btn" style={smallBtn} disabled={isReadOnly || !openable} onClick={() => openUrl(url)} title={openable ? "Open link" : "Enter a valid http(s) URL to open"}>
                            <ExternalLink style={{ width: 14, height: 14 }} />
                          </button>
                        </div>
                        {openable && (
                          <a href={url} target="_blank" rel="noopener noreferrer" style={{ marginTop: 4, fontSize: 12, color: "var(--accent)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={url}>
                            {displayText}
                          </a>
                        )}
                      </div>
                      {canEdit && (<button type="button" className="c-btn-danger" style={dangerBtn} onClick={() => removeLink(i)}>Remove</button>)}
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          {/* ═══ 11 ATTACHMENTS ═══ */}
          <Section title="Attachments & Evidence" num="11 — Documents" right={canEdit && (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {uploadMsg && (<StatusMsg msg={uploadMsg} isError={!!uploadMsg?.includes("failed")} />)}
              <label style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>
                {uploading ? "Uploading…" : "↑ Upload files"}
                <input type="file" multiple ref={fileInputRef} style={{ display: "none" }} disabled={uploading} onChange={(e) => handleUpload(e.target.files)} />
              </label>
            </div>
          )}>
            {doc.attachments.items.length === 0 ? (<EmptyState text="No files attached yet." />) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {doc.attachments.items.map((att, i) => {
                  const removeKey = String(att.path || att.url || att.filename || i);
                  const busy = attBusy === removeKey;
                  const label = (att.label || att.filename || "Attachment").trim();
                  const href = safeUrl(att.url);
                  return (
                    <div key={i} className="c-att" style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 16, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, background: "var(--surface)", transition: "all 0.2s ease" }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
                        {href ? (
                          <a href={href} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "var(--accent)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 4 }} title={href}>{label}</a>
                        ) : (
                          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>No link available</div>
                        )}
                        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>
                          {att.filename && `File: ${att.filename}`}
                          {att.size_bytes && ` · ${(att.size_bytes / 1024).toFixed(1)} KB`}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                        <button type="button" className="c-btn" style={smallBtn} disabled={busy}
                          onClick={() => { const newLabel = prompt("Update label:", att.label || ""); if (newLabel != null) { setDoc((d) => ({ ...d, attachments: { items: updateArray(d.attachments.items, i, (a) => ({ ...a, label: newLabel })) } })); } }}>
                          Edit label
                        </button>
                        {canEdit && (
                          <button type="button" className="c-btn-danger" style={dangerBtn} disabled={busy} onClick={() => handleDeleteAttachment(att, i)}>
                            {busy ? "Removing…" : "Remove"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          {/* ═══ 12 FINAL SIGN-OFF ═══ */}
          <div ref={refSignoff}>
            <Section title="Final Sign-off" num="12 — Closure">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
                <Field label="Sponsor Name">
                  <input className="c-input" style={inputBase} value={doc.signoff.sponsor_name} disabled={isReadOnly}
                    onChange={(e) => setDoc((d) => ({ ...d, signoff: { ...d.signoff, sponsor_name: e.target.value } }))} />
                </Field>
                <Field label="Sponsor Date">
                  <input type="date" className="c-input" style={inputBase} value={doc.signoff.sponsor_date ?? ""} disabled={isReadOnly}
                    onChange={(e) => setDoc((d) => ({ ...d, signoff: { ...d.signoff, sponsor_date: e.target.value } }))} />
                </Field>
                <Field label="Sponsor Decision">
                  <select className="c-select" style={selectBase} value={doc.signoff.sponsor_decision} disabled={isReadOnly}
                    onChange={(e) => setDoc((d) => ({ ...d, signoff: { ...d.signoff, sponsor_decision: e.target.value as any } }))}>
                    <option value="">— Select —</option>
                    <option value="approved">Approved</option>
                    <option value="conditional">Conditional</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </Field>
              </div>

              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 24, marginTop: 24 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
                  <Field label="Project Manager Name">
                    <input className="c-input" style={inputBase} value={doc.signoff.pm_name} disabled={isReadOnly}
                      onChange={(e) => setDoc((d) => ({ ...d, signoff: { ...d.signoff, pm_name: e.target.value } }))} />
                  </Field>
                  <Field label="PM Date">
                    <input type="date" className="c-input" style={inputBase} value={doc.signoff.pm_date ?? ""} disabled={isReadOnly}
                      onChange={(e) => setDoc((d) => ({ ...d, signoff: { ...d.signoff, pm_date: e.target.value } }))} />
                  </Field>
                  <div style={{ display: "flex", alignItems: "flex-end" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 500, color: "var(--text)", cursor: isReadOnly ? "default" : "pointer" }}>
                      <input type="checkbox" checked={doc.signoff.pm_approved} disabled={isReadOnly}
                        onChange={(e) => setDoc((d) => ({ ...d, signoff: { ...d.signoff, pm_approved: e.target.checked } }))} />
                      PM has approved / confirmed
                    </label>
                  </div>
                </div>
              </div>
            </Section>
          </div>

          <div style={{ height: 80 }} />
        </div>
      </div>
    </>
  );
}