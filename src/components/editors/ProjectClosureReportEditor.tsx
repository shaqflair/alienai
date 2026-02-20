"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Save, Download, FileText, File as FileIcon, Loader2 } from "lucide-react";

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
      acceptance_checklist: { sponsor_signed: false, bau_accepted: false, knowledge_transfer_done: false },
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
      severity: (rr.severity === "high" || rr.severity === "medium" || rr.severity === "low" ? rr.severity : "medium") as
        | "high"
        | "medium"
        | "low",
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
    .map((l) => l.replace(/^\s*(?:[•\-\*\u2022\u00B7\u2023\u25AA\u25CF\u2013]+)\s*/g, "").trimEnd());

  // If it was bullet-style (many short lines), convert to paragraph-ish while preserving intentional paragraphs.
  const compact = lines.join("\n").trim();
  const nonEmpty = lines.filter((l) => l.trim()).length;
  const hasManyLines = nonEmpty >= 3;

  if (!hasManyLines) return compact;

  // Merge single-line bullet fragments into a paragraph; keep blank lines as paragraph breaks.
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
    return { key, title: "Lessons Learned: What didn’t go well", bullets: bulletsFromLines(lines) };
  }

  if (key === "closure.lessons.surprises_risks") {
    const lines = (doc?.lessons?.surprises_risks || []).map((l: any) =>
      l?.action ? `${l.text} (Action: ${l.action})` : l?.text ?? l
    );
    return { key, title: "Lessons Learned: Surprises / Risks", bullets: bulletsFromLines(lines) };
  }

  if (key === "closure.recommendations") {
    const lines = (doc?.recommendations?.items || []).map((r: any) => {
      const t = String(r?.text || "").trim();
      const o = String(r?.owner || "").trim();
      const d = String(r?.due || "").trim();
      return [t, o ? `Owner: ${o}` : "", d ? `Due: ${d}` : ""].filter(Boolean).join(" — ");
    });
    return { key, title: "Recommendations & Follow-up Actions", bullets: bulletsFromLines(lines) };
  }

  return { key, title: key, bullets: "" };
}

function applyClosureSectionReplace(setDoc: any, key: string, section: AiSection) {
  const raw = String(section?.bullets || "");

  if (key === "closure.health.summary") {
    // ✅ Force summary to be free-text (strip bullets, merge lines)
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
      lessons: { ...d.lessons, surprises_risks: lines.map((t) => ({ text: t, action: "" })) },
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

/* ─────────────────────────────────────────────── UI Primitives ────────────────────────────────────────────── */
function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-gray-600">{label}</div>
      {children}
    </div>
  );
}

function RowGrid({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`grid grid-cols-1 gap-4 md:grid-cols-3 ${className}`}>{children}</div>;
}

const inputBase =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-60 disabled:bg-gray-50 dark:bg-white dark:text-gray-900 dark:border-gray-300";
const textareaBase =
  "w-full min-h-[90px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-60 disabled:bg-gray-50 dark:bg-white dark:text-gray-900 dark:border-gray-300";
const selectBase =
  "w-full min-h-[40px] rounded-lg border border-gray-300 bg-white text-gray-900 px-3 py-2 text-sm leading-5 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-60 disabled:bg-gray-50 [color-scheme:light] [&>option]:bg-white [&>option]:text-gray-900";
const smallBtn =
  "inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none";
const dangerBtn =
  "inline-flex items-center justify-center rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none";

function ragPill(r: Rag) {
  const base = "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold border";
  if (r === "green") return `${base} border-emerald-200 bg-emerald-50 text-emerald-800`;
  if (r === "amber") return `${base} border-amber-200 bg-amber-50 text-amber-800`;
  return `${base} border-red-200 bg-red-50 text-red-800`;
}

function overallPill(v: "good" | "watch" | "critical") {
  const base = "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold border";
  if (v === "good") return `${base} border-emerald-200 bg-emerald-50 text-emerald-800`;
  if (v === "watch") return `${base} border-amber-200 bg-amber-50 text-amber-800`;
  return `${base} border-red-200 bg-red-50 text-red-800`;
}

function ragSelectAccent(r: Rag) {
  if (r === "green") return "border-l-4 border-l-emerald-500";
  if (r === "amber") return "border-l-4 border-l-amber-500";
  return "border-l-4 border-l-red-500";
}

function overallSelectAccent(v: "good" | "watch" | "critical") {
  if (v === "good") return "border-l-4 border-l-emerald-500";
  if (v === "watch") return "border-l-4 border-l-amber-500";
  return "border-l-4 border-l-red-500";
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

  // Common wrappers: { ok, ... }, { data }, { project }, { item }
  const root = payload?.project ?? payload?.data ?? payload?.item ?? payload;

  // Some APIs return arrays (e.g. list endpoints)
  const p = Array.isArray(root) ? root?.[0] : root;
  if (!p || typeof p !== "object") return null;

  const project_code = safeStr((p as any).project_code ?? (p as any).code ?? (p as any).projectCode).trim() || null;
  const project_name =
    safeStr((p as any).title ?? (p as any).project_name ?? (p as any).name ?? (p as any).projectName).trim() || null;
  const client_name = safeStr((p as any).client_name ?? (p as any).client ?? (p as any).business).trim() || null;

  // sponsor / pm are often stored differently in different schemas
  const sponsor = safeStr((p as any).sponsor ?? (p as any).sponsor_name ?? (p as any).sponsorName).trim() || null;
  const pm =
    safeStr(
      (p as any).project_manager ??
        (p as any).project_manager_name ??
        (p as any).pm ??
        (p as any).pm_name ??
        (p as any).projectManager
    ).trim() || null;

  // If absolutely nothing useful found, return null
  if (!project_code && !project_name && !client_name && !sponsor && !pm) return null;

  return { project_code, project_name, client_name, sponsor, pm };
}

function parseStakeholdersFromAny(payload: any): KeyStakeholder[] {
  if (!payload) return [];
  const root = payload?.items ?? payload?.data ?? payload?.stakeholders ?? payload?.rows ?? payload;
  const arr = Array.isArray(root) ? root : [];
  const mapped: KeyStakeholder[] = arr
    .map((s: any) => {
      const name =
        safeStr(s?.name ?? s?.display_name ?? s?.full_name ?? s?.stakeholder_name ?? s?.title ?? "").trim() || "";
      const role =
        safeStr(s?.role ?? s?.responsibility ?? s?.position ?? s?.stakeholder_role ?? s?.job_title ?? "").trim() || "";
      if (!name && !role) return null;
      return { name, role };
    })
    .filter(Boolean) as any;

  // De-dupe by (name|role)
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

  // Meta auto-population status
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

      // Best-effort: try common endpoints (non-breaking if one doesn't exist)
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
        const cur = next.project ?? { project_name: "", project_code: "", client_name: "", sponsor: "", pm: "" };

        // ✅ Only fill if empty (so we don't overwrite user edits)
        const project_code = cur.project_code?.trim() ? cur.project_code : safeStr(meta?.project_code).trim();
        const pm = cur.pm?.trim() ? cur.pm : safeStr(meta?.pm).trim();
        const project_name = cur.project_name?.trim()
          ? cur.project_name
          : safeStr(meta?.project_name).trim() || cur.project_name;
        const client_name = cur.client_name?.trim()
          ? cur.client_name
          : safeStr(meta?.client_name).trim() || cur.client_name;
        const sponsor = cur.sponsor?.trim() ? cur.sponsor : safeStr(meta?.sponsor).trim() || cur.sponsor;

        next.project = { ...cur, project_code, pm, project_name, client_name, sponsor };
        return next;
      });

      setMetaApplied(true);
      setMetaMsg("Project Code / PM auto-populated.");
      setMetaBusy(false);
      setTimeout(() => setMetaMsg(null), 3000);
    }

    run();

    return () => {
      cancelled = true;
    };
    // We intentionally omit doc from deps to avoid overwriting user edits repeatedly
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, metaApplied]);

  /* ── Auto-generate Key Stakeholders from Stakeholder Register ───────────────── */
  useEffect(() => {
    let cancelled = false;

    async function run() {
      const pid = safeStr(projectId).trim();
      if (!pid) return;

      // Auto-apply only if empty
      if (stakeAutoApplied) return;
      if (doc?.stakeholders?.key?.length) {
        setStakeAutoApplied(true);
        return;
      }

      setStakeBusy(true);
      setStakeMsg(null);

      const candidates = [
        `/api/projects/${pid}/stakeholders`,
        `/api/stakeholders?project_id=${encodeURIComponent(pid)}`,
        `/api/stakeholders/list?project_id=${encodeURIComponent(pid)}`,
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
      setTimeout(() => setStakeMsg(null), 3000);
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
      `/api/projects/${pid}/stakeholders`,
      `/api/stakeholders?project_id=${encodeURIComponent(pid)}`,
      `/api/stakeholders/list?project_id=${encodeURIComponent(pid)}`,
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
    setTimeout(() => setStakeMsg(null), 3000);
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
      // ✅ Hint for the AI layer: summary is free text
      summary_format: "free_text_no_bullets",
    };
  }, [doc]);

  const { aiLoadingKey, aiError, improveSection, regenerateSection } = useClosureAI({
    doc,
    meta: closureMeta,
    getSectionByKey: (key: string) => getClosureSection(doc, key),
    applySectionReplace: (key: string, section: AiSection) => applyClosureSectionReplace(setDoc, key, section),
    onDirty: () => {
      // optional hook point
    },
  });

  /* ── Item Mutators ───────────────────────────────────────────────────────── */

  // Stakeholders (manual override still allowed)
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

  // Achievements
  const addAchievement = () => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      achievements: { key_achievements: [...d.achievements.key_achievements, { text: "" }] },
    }));
  };
  const removeAchievement = (idx: number) => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      achievements: { key_achievements: removeAt(d.achievements.key_achievements, idx) },
    }));
  };

  // Success Criteria
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

  // Delivered
  const addDelivered = () => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      deliverables: {
        ...d.deliverables,
        delivered: [...d.deliverables.delivered, { deliverable: "", accepted_by: "", accepted_on: null }],
      },
    }));
  };
  const removeDelivered = (idx: number) => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      deliverables: { ...d.deliverables, delivered: removeAt(d.deliverables.delivered, idx) },
    }));
  };

  // Outstanding ✅
  const addOutstanding = () => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      deliverables: {
        ...d.deliverables,
        outstanding: [...d.deliverables.outstanding, { item: "", owner: "", status: "", target: "" }],
      },
    }));
  };
  const removeOutstanding = (idx: number) => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      deliverables: { ...d.deliverables, outstanding: removeAt(d.deliverables.outstanding, idx) },
    }));
  };

  // Budget
  const addBudgetRow = () => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      financial_closeout: {
        ...d.financial_closeout,
        budget_rows: [...d.financial_closeout.budget_rows, { category: "", budget: null, actual: null }],
      },
    }));
  };
  const removeBudgetRow = (idx: number) => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      financial_closeout: { ...d.financial_closeout, budget_rows: removeAt(d.financial_closeout.budget_rows, idx) },
    }));
  };

  // Lessons
  const addLesson = (key: "went_well" | "didnt_go_well" | "surprises_risks") => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      lessons: { ...d.lessons, [key]: [...d.lessons[key], { text: "", action: "" }] as any },
    }));
  };
  const removeLesson = (key: "went_well" | "didnt_go_well" | "surprises_risks", idx: number) => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      lessons: { ...d.lessons, [key]: removeAt(d.lessons[key], idx) as any },
    }));
  };

  // Risks & Issues (with human id)
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
      return { ...d, handover: { ...d.handover, risks_issues: [...existing, next] } };
    });
  };
  const removeRiskIssue = (idx: number) => {
    if (!canEdit) return;
    setDoc((d) => ({ ...d, handover: { ...d.handover, risks_issues: removeAt(d.handover.risks_issues, idx) } }));
  };

  // Team moves
  const addTeamMove = () => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      handover: { ...d.handover, team_moves: [...d.handover.team_moves, { person: "", change: "", date: null }] },
    }));
  };
  const removeTeamMove = (idx: number) => {
    if (!canEdit) return;
    setDoc((d) => ({ ...d, handover: { ...d.handover, team_moves: removeAt(d.handover.team_moves, idx) } }));
  };

  // Recommendations
  const addRecommendation = () => {
    if (!canEdit) return;
    setDoc((d) => ({
      ...d,
      recommendations: { items: [...d.recommendations.items, { text: "", owner: "", due: null }] },
    }));
  };
  const removeRecommendation = (idx: number) => {
    if (!canEdit) return;
    setDoc((d) => ({ ...d, recommendations: { items: removeAt(d.recommendations.items, idx) } }));
  };

  // Links
  const addLink = () => {
    if (!canEdit) return;
    setDoc((d) => ({ ...d, links: { items: [...d.links.items, { label: "", url: "" }] } }));
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
            : payload?.error || payload?.message || JSON.stringify(payload).slice(0, 600);

        throw new Error(`Export failed: ${res.status} - ${msg}`);
      }

      const blob = await res.blob();

      const cd = res.headers.get("content-disposition");
      const serverName =
        filenameFromContentDisposition(cd) || `Closure-Report.${type === "pdf" ? "pdf" : "docx"}`;

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
        setDoc((d) => ({ ...d, attachments: { items: [...d.attachments.items, ...items] } }));
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

      setDoc((d) => ({ ...d, attachments: { items: d.attachments.items.filter((_, i) => i !== idx) } }));
      setUploadMsg("Attachment removed.");
    } catch (e: any) {
      setUploadMsg(`Remove failed: ${e?.message || e}`);
    } finally {
      setAttBusy(null);
      setTimeout(() => setUploadMsg(null), 4000);
    }
  }

  // ✅ Project Code + PM should be auto-populated (read-only when projectId exists)
  const projectFieldsAuto = !!safeStr(projectId).trim();

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Top Fixed Header */}
      <div className="sticky top-0 z-20 bg-white border-b shadow-sm px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <input
            className="text-xl font-bold bg-transparent border-none focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded px-3 py-1.5 w-1/3"
            value={doc.project.project_name || "Untitled Closure Report"}
            disabled={isReadOnly}
            onChange={(e) => setDoc((d) => ({ ...d, project: { ...d.project, project_name: e.target.value } }))}
            placeholder="Project Title"
          />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <span className={ragPill(doc.health.rag)}>RAG: {doc.health.rag.toUpperCase()}</span>
              <span className={overallPill(doc.health.overall_health)}>Overall: {doc.health.overall_health}</span>
            </div>

            <Button
              onClick={handleSave}
              disabled={isReadOnly || saving || autoSaving}
              variant="default"
              size="sm"
              className="min-w-[140px]"
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
                <Button variant="outline" size="sm" disabled={dlBusy !== null}>
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
              <span className={`text-sm font-medium ${metaMsg?.includes("Could not") ? "text-amber-700" : "text-slate-600"}`}>
                {metaBusy ? "Loading project meta…" : metaMsg}
              </span>
            )}

            {saveMsg && (
              <span className={`text-sm font-medium ${saveMsg.includes("failed") ? "text-red-600" : "text-green-600"}`}>
                {saveMsg}
              </span>
            )}
            {dlMsg && (
              <span className={`text-sm font-medium ${dlMsg.includes("failed") ? "text-red-600" : "text-green-600"}`}>
                {dlMsg}
              </span>
            )}
            {aiError && <span className="text-sm font-medium text-red-600">{aiError}</span>}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-10">
        {/* PROJECT SUMMARY */}
        <div ref={refProjectSummary}>
          <Section title="Project Summary">
            <RowGrid>
              <Field label="Project Name">
                <input
                  className={inputBase}
                  value={doc.project.project_name}
                  disabled={isReadOnly}
                  onChange={(e) => setDoc((d) => ({ ...d, project: { ...d.project, project_name: e.target.value } }))}
                />
              </Field>

              <Field label="Project Code / ID">
                <input
                  className={inputBase}
                  value={doc.project.project_code}
                  disabled={isReadOnly || projectFieldsAuto}
                  onChange={(e) => setDoc((d) => ({ ...d, project: { ...d.project, project_code: e.target.value } }))}
                  placeholder={projectFieldsAuto ? "Auto-populated" : ""}
                  title={projectFieldsAuto ? "Auto-populated from the project record" : undefined}
                />
              </Field>

              <Field label="Client / Business">
                <input
                  className={inputBase}
                  value={doc.project.client_name}
                  disabled={isReadOnly}
                  onChange={(e) => setDoc((d) => ({ ...d, project: { ...d.project, client_name: e.target.value } }))}
                />
              </Field>

              <Field label="Sponsor">
                <input
                  className={inputBase}
                  value={doc.project.sponsor}
                  disabled={isReadOnly}
                  onChange={(e) => setDoc((d) => ({ ...d, project: { ...d.project, sponsor: e.target.value } }))}
                />
              </Field>

              <Field label="Project Manager">
                <input
                  className={inputBase}
                  value={doc.project.pm}
                  disabled={isReadOnly || projectFieldsAuto}
                  onChange={(e) => setDoc((d) => ({ ...d, project: { ...d.project, pm: e.target.value } }))}
                  placeholder={projectFieldsAuto ? "Auto-populated" : ""}
                  title={projectFieldsAuto ? "Auto-populated from the project record" : undefined}
                />
              </Field>
            </RowGrid>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
              <Field label="RAG Status">
                <select
                  className={`${selectBase} ${ragSelectAccent(doc.health.rag)}`}
                  value={doc.health.rag}
                  disabled={isReadOnly}
                  onChange={(e) => setDoc((d) => ({ ...d, health: { ...d.health, rag: e.target.value as Rag } }))}
                >
                  <option value="green">Green</option>
                  <option value="amber">Amber</option>
                  <option value="red">Red</option>
                </select>
              </Field>

              <Field label="Overall Health">
                <select
                  className={`${selectBase} ${overallSelectAccent(doc.health.overall_health)}`}
                  value={doc.health.overall_health}
                  disabled={isReadOnly}
                  onChange={(e) =>
                    setDoc((d) => ({ ...d, health: { ...d.health, overall_health: e.target.value as any } }))
                  }
                >
                  <option value="good">Good</option>
                  <option value="watch">Watch</option>
                  <option value="critical">Critical</option>
                </select>
              </Field>

              <Field label="Summary (Free text)">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="text-xs text-gray-500">Executive summary. Free text only (no bullet points).</div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={smallBtn}
                      disabled={isReadOnly || aiLoadingKey === "closure.health.summary"}
                      onClick={() => improveSection("closure.health.summary")}
                    >
                      {aiLoadingKey === "closure.health.summary" ? "Working…" : "Improve"}
                    </button>
                    <button
                      type="button"
                      className={smallBtn}
                      disabled={isReadOnly || aiLoadingKey === "closure.health.summary"}
                      onClick={() => regenerateSection("closure.health.summary")}
                    >
                      {aiLoadingKey === "closure.health.summary" ? "Working…" : "Regenerate"}
                    </button>
                  </div>
                </div>

                <textarea
                  className={textareaBase}
                  value={doc.health.summary}
                  disabled={isReadOnly}
                  onChange={(e) => setDoc((d) => ({ ...d, health: { ...d.health, summary: e.target.value } }))}
                  placeholder="Write an executive closure summary (paragraph form)."
                />

                {/* gentle guardrail if user pastes bullets */}
                {!!doc.health.summary.trim() && /^\s*[•\-\*]/m.test(doc.health.summary) && (
                  <div className="mt-2 text-xs text-amber-700">
                    Tip: This field is free text. If you pasted bullets, they will be removed automatically when AI edits
                    are applied.
                  </div>
                )}
              </Field>
            </div>
          </Section>
        </div>

        {/* KEY STAKEHOLDERS */}
        <Section
          title="Key Stakeholders"
          right={
            <div className="flex items-center gap-2">
              {stakeMsg && (
                <span className={`text-xs ${stakeMsg.includes("No stakeholders") ? "text-amber-700" : "text-slate-600"}`}>
                  {stakeMsg}
                </span>
              )}
              <button
                type="button"
                className={smallBtn}
                disabled={isReadOnly || stakeBusy || !safeStr(projectId).trim()}
                onClick={refreshStakeholdersFromRegister}
                title={!safeStr(projectId).trim() ? "Project id required to load stakeholder register" : undefined}
              >
                {stakeBusy ? "Refreshing…" : "Refresh from Stakeholder Register"}
              </button>

              {canEdit && (
                <button type="button" className={smallBtn} onClick={addStakeholder}>
                  + Add Stakeholder
                </button>
              )}
            </div>
          }
        >
          {doc.stakeholders.key.length === 0 ? (
            <p className="text-sm text-gray-500">
              No key stakeholders recorded yet.
              {safeStr(projectId).trim() ? " (They can be generated from the Stakeholder Register.)" : ""}
            </p>
          ) : (
            <div className="space-y-4">
              {doc.stakeholders.key.map((stake, i) => (
                <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                  <div className="md:col-span-5">
                    <input
                      className={inputBase}
                      placeholder="Name"
                      value={stake.name}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        setDoc((d) => ({
                          ...d,
                          stakeholders: {
                            key: updateArray(d.stakeholders.key, i, (s) => ({ ...s, name: e.target.value })),
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="md:col-span-6">
                    <input
                      className={inputBase}
                      placeholder="Role / Responsibility"
                      value={stake.role}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        setDoc((d) => ({
                          ...d,
                          stakeholders: {
                            key: updateArray(d.stakeholders.key, i, (s) => ({ ...s, role: e.target.value })),
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="md:col-span-1">
                    {canEdit && (
                      <button type="button" className={dangerBtn} onClick={() => removeStakeholder(i)}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* KEY ACHIEVEMENTS */}
        <Section
          title="Key Achievements"
          right={
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={smallBtn}
                disabled={isReadOnly || aiLoadingKey === "closure.achievements"}
                onClick={() => improveSection("closure.achievements")}
              >
                {aiLoadingKey === "closure.achievements" ? "Working…" : "Improve"}
              </button>
              <button
                type="button"
                className={smallBtn}
                disabled={isReadOnly || aiLoadingKey === "closure.achievements"}
                onClick={() => regenerateSection("closure.achievements")}
              >
                {aiLoadingKey === "closure.achievements" ? "Working…" : "Regenerate"}
              </button>

              {canEdit && (
                <button type="button" className={smallBtn} onClick={addAchievement}>
                  + Add Achievement
                </button>
              )}
            </div>
          }
        >
          {doc.achievements.key_achievements.length === 0 ? (
            <p className="text-sm text-gray-500">No key achievements recorded yet.</p>
          ) : (
            <div className="space-y-4">
              {doc.achievements.key_achievements.map((ach, i) => (
                <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                  <div className="md:col-span-11">
                    <textarea
                      className={textareaBase}
                      placeholder="Describe the achievement / milestone"
                      value={ach.text}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        setDoc((d) => ({
                          ...d,
                          achievements: {
                            key_achievements: updateArray(d.achievements.key_achievements, i, (a) => ({
                              ...a,
                              text: e.target.value,
                            })),
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="md:col-span-1 pt-2">
                    {canEdit && (
                      <button type="button" className={dangerBtn} onClick={() => removeAchievement(i)}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* SUCCESS CRITERIA */}
        <Section
          title="Success Criteria"
          right={canEdit && (
            <button type="button" className={smallBtn} onClick={addCriterion}>
              + Add
            </button>
          )}
        >
          {doc.success.criteria.length === 0 ? (
            <p className="text-sm text-gray-500">No success criteria recorded.</p>
          ) : (
            <div className="space-y-4">
              {doc.success.criteria.map((c, i) => (
                <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                  <div className="md:col-span-8">
                    <textarea
                      className={textareaBase}
                      placeholder="Criterion"
                      value={c.text}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        setDoc((d) => ({
                          ...d,
                          success: {
                            criteria: updateArray(d.success.criteria, i, (x) => ({ ...x, text: e.target.value })),
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="md:col-span-3">
                    <Field label="Status">
                      <select
                        className={`${selectBase} bg-white text-gray-900 border border-gray-300`}
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
                  </div>
                  <div className="md:col-span-1 pt-1">
                    {canEdit && (
                      <button type="button" className={dangerBtn} onClick={() => removeCriterion(i)}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* DELIVERABLES & ACCEPTANCE */}
        <div ref={refOutstanding}>
          <Section title="Deliverables & Acceptance">
            <div className="space-y-8">
              {/* Delivered */}
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-base font-medium">Delivered Items</h3>
                  {canEdit && (
                    <button type="button" className={smallBtn} onClick={addDelivered}>
                      + Add
                    </button>
                  )}
                </div>
                {doc.deliverables.delivered.length === 0 ? (
                  <p className="text-sm text-gray-500">No delivered items recorded.</p>
                ) : (
                  <div className="space-y-4">
                    {doc.deliverables.delivered.map((item, i) => (
                      <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                        <div className="md:col-span-5">
                          <input
                            className={inputBase}
                            placeholder="Deliverable"
                            value={item.deliverable}
                            disabled={isReadOnly}
                            onChange={(e) =>
                              setDoc((d) => ({
                                ...d,
                                deliverables: {
                                  ...d.deliverables,
                                  delivered: updateArray(d.deliverables.delivered, i, (it) => ({
                                    ...it,
                                    deliverable: e.target.value,
                                  })),
                                },
                              }))
                            }
                          />
                        </div>
                        <div className="md:col-span-3">
                          <input
                            className={inputBase}
                            placeholder="Accepted by"
                            value={item.accepted_by}
                            disabled={isReadOnly}
                            onChange={(e) =>
                              setDoc((d) => ({
                                ...d,
                                deliverables: {
                                  ...d.deliverables,
                                  delivered: updateArray(d.deliverables.delivered, i, (it) => ({
                                    ...it,
                                    accepted_by: e.target.value,
                                  })),
                                },
                              }))
                            }
                          />
                        </div>
                        <div className="md:col-span-3">
                          <input
                            type="date"
                            className={inputBase}
                            value={item.accepted_on ?? ""}
                            disabled={isReadOnly}
                            onChange={(e) =>
                              setDoc((d) => ({
                                ...d,
                                deliverables: {
                                  ...d.deliverables,
                                  delivered: updateArray(d.deliverables.delivered, i, (it) => ({
                                    ...it,
                                    accepted_on: e.target.value,
                                  })),
                                },
                              }))
                            }
                          />
                        </div>
                        <div className="md:col-span-1">
                          {canEdit && (
                            <button type="button" className={dangerBtn} onClick={() => removeDelivered(i)}>
                              Remove
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Outstanding ✅ */}
              <div className="border-t pt-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-base font-medium">Outstanding Items</h3>
                  {canEdit && (
                    <button type="button" className={smallBtn} onClick={addOutstanding}>
                      + Add
                    </button>
                  )}
                </div>
                {doc.deliverables.outstanding.length === 0 ? (
                  <p className="text-sm text-gray-500">No outstanding items recorded.</p>
                ) : (
                  <div className="space-y-4">
                    {doc.deliverables.outstanding.map((item, i) => (
                      <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                        <div className="md:col-span-4">
                          <input
                            className={inputBase}
                            placeholder="Item"
                            value={item.item}
                            disabled={isReadOnly}
                            onChange={(e) =>
                              setDoc((d) => ({
                                ...d,
                                deliverables: {
                                  ...d.deliverables,
                                  outstanding: updateArray(d.deliverables.outstanding, i, (it) => ({
                                    ...it,
                                    item: e.target.value,
                                  })),
                                },
                              }))
                            }
                          />
                        </div>
                        <div className="md:col-span-3">
                          <input
                            className={inputBase}
                            placeholder="Owner"
                            value={item.owner}
                            disabled={isReadOnly}
                            onChange={(e) =>
                              setDoc((d) => ({
                                ...d,
                                deliverables: {
                                  ...d.deliverables,
                                  outstanding: updateArray(d.deliverables.outstanding, i, (it) => ({
                                    ...it,
                                    owner: e.target.value,
                                  })),
                                },
                              }))
                            }
                          />
                        </div>
                        <div className="md:col-span-2">
                          <input
                            className={inputBase}
                            placeholder="Status"
                            value={item.status}
                            disabled={isReadOnly}
                            onChange={(e) =>
                              setDoc((d) => ({
                                ...d,
                                deliverables: {
                                  ...d.deliverables,
                                  outstanding: updateArray(d.deliverables.outstanding, i, (it) => ({
                                    ...it,
                                    status: e.target.value,
                                  })),
                                },
                              }))
                            }
                          />
                        </div>
                        <div className="md:col-span-2">
                          <input
                            className={inputBase}
                            placeholder="Target date"
                            value={item.target}
                            disabled={isReadOnly}
                            onChange={(e) =>
                              setDoc((d) => ({
                                ...d,
                                deliverables: {
                                  ...d.deliverables,
                                  outstanding: updateArray(d.deliverables.outstanding, i, (it) => ({
                                    ...it,
                                    target: e.target.value,
                                  })),
                                },
                              }))
                            }
                          />
                        </div>
                        <div className="md:col-span-1">
                          {canEdit && (
                            <button type="button" className={dangerBtn} onClick={() => removeOutstanding(i)}>
                              Remove
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Acceptance checklist */}
              <div className="border-t pt-6">
                <h3 className="text-base font-medium mb-4">Acceptance Checklist</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={doc.deliverables.acceptance_checklist.sponsor_signed}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        setDoc((d) => ({
                          ...d,
                          deliverables: {
                            ...d.deliverables,
                            acceptance_checklist: {
                              ...d.deliverables.acceptance_checklist,
                              sponsor_signed: e.target.checked,
                            },
                          },
                        }))
                      }
                    />
                    Sponsor signed off
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={doc.deliverables.acceptance_checklist.bau_accepted}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        setDoc((d) => ({
                          ...d,
                          deliverables: {
                            ...d.deliverables,
                            acceptance_checklist: {
                              ...d.deliverables.acceptance_checklist,
                              bau_accepted: e.target.checked,
                            },
                          },
                        }))
                      }
                    />
                    BAU / Operations accepted
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={doc.deliverables.acceptance_checklist.knowledge_transfer_done}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        setDoc((d) => ({
                          ...d,
                          deliverables: {
                            ...d.deliverables,
                            acceptance_checklist: {
                              ...d.deliverables.acceptance_checklist,
                              knowledge_transfer_done: e.target.checked,
                            },
                          },
                        }))
                      }
                    />
                    Knowledge transfer completed
                  </label>
                </div>
              </div>

              {/* Sponsor signoff */}
              <div className="border-t pt-6 mt-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Field label="Sponsor Sign-off Name">
                    <input
                      className={inputBase}
                      value={doc.deliverables.sponsor_signoff_name}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        setDoc((d) => ({ ...d, deliverables: { ...d.deliverables, sponsor_signoff_name: e.target.value } }))
                      }
                    />
                  </Field>
                  <Field label="Sign-off Date">
                    <input
                      type="date"
                      className={inputBase}
                      value={doc.deliverables.sponsor_signoff_date ?? ""}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        setDoc((d) => ({ ...d, deliverables: { ...d.deliverables, sponsor_signoff_date: e.target.value } }))
                      }
                    />
                  </Field>
                </div>
              </div>
            </div>
          </Section>
        </div>

        {/* FINANCIAL CLOSEOUT */}
        <div ref={refFinancial}>
          <Section
            title="Financial Closeout"
            right={
              <div className="text-sm text-gray-600">
                Budget: <strong>{fmtPounds(financialTotals.budget || 0)}</strong> | Actual:{" "}
                <strong>{fmtPounds(financialTotals.actual || 0)}</strong> | Variance:{" "}
                <strong>{fmtPounds(financialTotals.variance || 0)}</strong>
                {financialTotals.pct != null && ` (${financialTotals.pct.toFixed(1)}%)`}
              </div>
            }
          >
            <div className="space-y-8">
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-base font-medium">Budget Summary</h3>
                  {canEdit && (
                    <button type="button" className={smallBtn} onClick={addBudgetRow}>
                      + Add Row
                    </button>
                  )}
                </div>

                {doc.financial_closeout.budget_rows.length === 0 ? (
                  <p className="text-sm text-gray-500">No budget rows added.</p>
                ) : (
                  <div className="space-y-4">
                    {doc.financial_closeout.budget_rows.map((row, i) => (
                      <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                        <div className="md:col-span-4">
                          <input
                            className={inputBase}
                            placeholder="Category"
                            value={row.category}
                            disabled={isReadOnly}
                            onChange={(e) =>
                              setDoc((d) => ({
                                ...d,
                                financial_closeout: {
                                  ...d.financial_closeout,
                                  budget_rows: updateArray(d.financial_closeout.budget_rows, i, (r) => ({
                                    ...r,
                                    category: e.target.value,
                                  })),
                                },
                              }))
                            }
                          />
                        </div>
                        <div className="md:col-span-3">
                          <input
                            type="number"
                            className={inputBase}
                            placeholder="Budget (£)"
                            value={row.budget ?? ""}
                            disabled={isReadOnly}
                            onChange={(e) =>
                              setDoc((d) => ({
                                ...d,
                                financial_closeout: {
                                  ...d.financial_closeout,
                                  budget_rows: updateArray(d.financial_closeout.budget_rows, i, (r) => ({
                                    ...r,
                                    budget: asMoney(e.target.value),
                                  })),
                                },
                              }))
                            }
                          />
                        </div>
                        <div className="md:col-span-3">
                          <input
                            type="number"
                            className={inputBase}
                            placeholder="Actual (£)"
                            value={row.actual ?? ""}
                            disabled={isReadOnly}
                            onChange={(e) =>
                              setDoc((d) => ({
                                ...d,
                                financial_closeout: {
                                  ...d.financial_closeout,
                                  budget_rows: updateArray(d.financial_closeout.budget_rows, i, (r) => ({
                                    ...r,
                                    actual: asMoney(e.target.value),
                                  })),
                                },
                              }))
                            }
                          />
                        </div>
                        <div className="md:col-span-2">
                          {canEdit && (
                            <button type="button" className={dangerBtn} onClick={() => removeBudgetRow(i)}>
                              Remove
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t pt-6">
                <h3 className="text-base font-medium mb-4">ROI Metrics</h3>
                <RowGrid>
                  <Field label="Annual Benefit">
                    <input
                      className={inputBase}
                      value={doc.financial_closeout.roi.annual_benefit}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        setDoc((d) => ({
                          ...d,
                          financial_closeout: {
                            ...d.financial_closeout,
                            roi: { ...d.financial_closeout.roi, annual_benefit: e.target.value },
                          },
                        }))
                      }
                    />
                  </Field>
                  <Field label="Payback Achieved">
                    <input
                      className={inputBase}
                      value={doc.financial_closeout.roi.payback_achieved}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        setDoc((d) => ({
                          ...d,
                          financial_closeout: {
                            ...d.financial_closeout,
                            roi: { ...d.financial_closeout.roi, payback_achieved: e.target.value },
                          },
                        }))
                      }
                    />
                  </Field>
                  <Field label="Payback Planned">
                    <input
                      className={inputBase}
                      value={doc.financial_closeout.roi.payback_planned}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        setDoc((d) => ({
                          ...d,
                          financial_closeout: {
                            ...d.financial_closeout,
                            roi: { ...d.financial_closeout.roi, payback_planned: e.target.value },
                          },
                        }))
                      }
                    />
                  </Field>
                  <Field label="NPV">
                    <input
                      className={inputBase}
                      value={doc.financial_closeout.roi.npv}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        setDoc((d) => ({
                          ...d,
                          financial_closeout: {
                            ...d.financial_closeout,
                            roi: { ...d.financial_closeout.roi, npv: e.target.value },
                          },
                        }))
                      }
                    />
                  </Field>
                </RowGrid>
              </div>
            </div>
          </Section>
        </div>

        {/* LESSONS LEARNED */}
        <div ref={refLessons}>
          <Section title="Lessons Learned">
            {(["went_well", "didnt_go_well", "surprises_risks"] as const).map((key) => {
              const label =
                key === "went_well"
                  ? "What went well"
                  : key === "didnt_go_well"
                    ? "What didn't go well"
                    : "Surprises / Risks encountered";

              const aiKey = `closure.lessons.${key}`;

              return (
                <div key={key} className="mt-8">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-base font-medium">{label}</h3>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className={smallBtn}
                        disabled={isReadOnly || aiLoadingKey === aiKey}
                        onClick={() => improveSection(aiKey)}
                      >
                        {aiLoadingKey === aiKey ? "Working…" : "Improve"}
                      </button>

                      <button
                        type="button"
                        className={smallBtn}
                        disabled={isReadOnly || aiLoadingKey === aiKey}
                        onClick={() => regenerateSection(aiKey)}
                      >
                        {aiLoadingKey === aiKey ? "Working…" : "Regenerate"}
                      </button>

                      {canEdit && (
                        <button type="button" className={smallBtn} onClick={() => addLesson(key)}>
                          + Add
                        </button>
                      )}
                    </div>
                  </div>

                  {doc.lessons[key].length === 0 ? (
                    <p className="text-sm text-gray-500">Nothing recorded yet.</p>
                  ) : (
                    <div className="space-y-4">
                      {doc.lessons[key].map((lesson, i) => (
                        <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                          <div className="md:col-span-7">
                            <textarea
                              className={textareaBase}
                              placeholder="Description"
                              value={lesson.text}
                              disabled={isReadOnly}
                              onChange={(e) =>
                                setDoc((d) => ({
                                  ...d,
                                  lessons: {
                                    ...d.lessons,
                                    [key]: updateArray(d.lessons[key], i, (l) => ({ ...l, text: e.target.value })),
                                  },
                                }))
                              }
                            />
                          </div>
                          <div className="md:col-span-4">
                            <textarea
                              className={textareaBase}
                              placeholder="Recommended action (optional)"
                              value={lesson.action ?? ""}
                              disabled={isReadOnly}
                              onChange={(e) =>
                                setDoc((d) => ({
                                  ...d,
                                  lessons: {
                                    ...d.lessons,
                                    [key]: updateArray(d.lessons[key], i, (l) => ({ ...l, action: e.target.value })),
                                  },
                                }))
                              }
                            />
                          </div>
                          <div className="md:col-span-1 pt-2">
                            {canEdit && (
                              <button type="button" className={dangerBtn} onClick={() => removeLesson(key, i)}>
                                Remove
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </Section>
        </div>

        {/* HANDOVER & SUPPORT */}
        <Section title="Handover & Support">
          <div className="space-y-10">
            {/* Open Risks & Issues */}
            <div>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-base font-medium">Open Risks & Issues</h3>
                {canEdit && (
                  <button type="button" className={smallBtn} onClick={addRiskIssue}>
                    + Add Risk/Issue
                  </button>
                )}
              </div>

              {doc.handover.risks_issues.length === 0 ? (
                <p className="text-sm text-gray-500">No open risks or issues recorded.</p>
              ) : (
                <div className="space-y-6">
                  {doc.handover.risks_issues.map((ri, i) => (
                    <div key={ri.id} className="border border-gray-200 rounded-lg p-5 bg-white space-y-4">
                      <div className="flex justify-between items-center">
                        <div className="text-sm font-medium text-gray-800">
                          Risk ID:{" "}
                          <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">{ri.human_id || ri.id}</span>
                        </div>
                        {canEdit && (
                          <button type="button" className={dangerBtn} onClick={() => removeRiskIssue(i)}>
                            Remove
                          </button>
                        )}
                      </div>

                      <input
                        className={inputBase}
                        placeholder="Description of risk/issue"
                        value={ri.description}
                        disabled={isReadOnly}
                        onChange={(e) =>
                          setDoc((d) => ({
                            ...d,
                            handover: {
                              ...d.handover,
                              risks_issues: updateArray(d.handover.risks_issues, i, (r) => ({
                                ...r,
                                description: e.target.value,
                              })),
                            },
                          }))
                        }
                      />

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <Field label="Severity">
                          <select
                            className={selectBase}
                            value={ri.severity}
                            disabled={isReadOnly}
                            onChange={(e) =>
                              setDoc((d) => ({
                                ...d,
                                handover: {
                                  ...d.handover,
                                  risks_issues: updateArray(d.handover.risks_issues, i, (r) => ({
                                    ...r,
                                    severity: e.target.value as any,
                                  })),
                                },
                              }))
                            }
                          >
                            <option value="high">High</option>
                            <option value="medium">Medium</option>
                            <option value="low">Low</option>
                          </select>
                        </Field>

                        <Field label="Owner">
                          <input
                            className={inputBase}
                            value={ri.owner}
                            disabled={isReadOnly}
                            onChange={(e) =>
                              setDoc((d) => ({
                                ...d,
                                handover: {
                                  ...d.handover,
                                  risks_issues: updateArray(d.handover.risks_issues, i, (r) => ({
                                    ...r,
                                    owner: e.target.value,
                                  })),
                                },
                              }))
                            }
                          />
                        </Field>

                        <Field label="Status">
                          <input
                            className={inputBase}
                            value={ri.status}
                            disabled={isReadOnly}
                            onChange={(e) =>
                              setDoc((d) => ({
                                ...d,
                                handover: {
                                  ...d.handover,
                                  risks_issues: updateArray(d.handover.risks_issues, i, (r) => ({
                                    ...r,
                                    status: e.target.value,
                                  })),
                                },
                              }))
                            }
                          />
                        </Field>

                        <Field label="Next Action">
                          <input
                            className={inputBase}
                            value={ri.next_action}
                            disabled={isReadOnly}
                            onChange={(e) =>
                              setDoc((d) => ({
                                ...d,
                                handover: {
                                  ...d.handover,
                                  risks_issues: updateArray(d.handover.risks_issues, i, (r) => ({
                                    ...r,
                                    next_action: e.target.value,
                                  })),
                                },
                              }))
                            }
                          />
                        </Field>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Team Moves / Changes */}
            <div>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-base font-medium">Team Moves / Changes</h3>
                {canEdit && (
                  <button type="button" className={smallBtn} onClick={addTeamMove}>
                    + Add Team Move
                  </button>
                )}
              </div>

              {doc.handover.team_moves.length === 0 ? (
                <p className="text-sm text-gray-500">No team changes recorded.</p>
              ) : (
                <div className="space-y-4">
                  {doc.handover.team_moves.map((tm, i) => (
                    <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                      <div className="md:col-span-4">
                        <input
                          className={inputBase}
                          placeholder="Person name"
                          value={tm.person}
                          disabled={isReadOnly}
                          onChange={(e) =>
                            setDoc((d) => ({
                              ...d,
                              handover: {
                                ...d.handover,
                                team_moves: updateArray(d.handover.team_moves, i, (t) => ({
                                  ...t,
                                  person: e.target.value,
                                })),
                              },
                            }))
                          }
                        />
                      </div>
                      <div className="md:col-span-5">
                        <input
                          className={inputBase}
                          placeholder="Change / role / departure reason"
                          value={tm.change}
                          disabled={isReadOnly}
                          onChange={(e) =>
                            setDoc((d) => ({
                              ...d,
                              handover: {
                                ...d.handover,
                                team_moves: updateArray(d.handover.team_moves, i, (t) => ({
                                  ...t,
                                  change: e.target.value,
                                })),
                              },
                            }))
                          }
                        />
                      </div>
                      <div className="md:col-span-2">
                        <input
                          type="date"
                          className={inputBase}
                          value={tm.date ?? ""}
                          disabled={isReadOnly}
                          onChange={(e) =>
                            setDoc((d) => ({
                              ...d,
                              handover: {
                                ...d.handover,
                                team_moves: updateArray(d.handover.team_moves, i, (t) => ({
                                  ...t,
                                  date: e.target.value,
                                })),
                              },
                            }))
                          }
                        />
                      </div>
                      <div className="md:col-span-1">
                        {canEdit && (
                          <button type="button" className={dangerBtn} onClick={() => removeTeamMove(i)}>
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Knowledge Transfer + Support Model */}
            <div className="border-t pt-8 grid md:grid-cols-2 gap-10">
              <div className="space-y-6">
                <h3 className="text-base font-medium">Knowledge Transfer</h3>
                <div className="space-y-3">
                  {[
                    { key: "docs_handed_over", label: "Documentation handed over" },
                    { key: "final_demo_done", label: "Final demo / walkthrough completed" },
                    { key: "support_model_doc", label: "Support model documented" },
                    { key: "runbook_finalised", label: "Runbook / operations guide finalised" },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={doc.handover.knowledge_transfer[key as keyof typeof doc.handover.knowledge_transfer]}
                        disabled={isReadOnly}
                        onChange={(e) =>
                          setDoc((d) => ({
                            ...d,
                            handover: {
                              ...d.handover,
                              knowledge_transfer: { ...d.handover.knowledge_transfer, [key]: e.target.checked as any },
                            },
                          }))
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <Field label="Additional notes">
                  <textarea
                    className={textareaBase}
                    value={doc.handover.knowledge_transfer.notes}
                    disabled={isReadOnly}
                    onChange={(e) =>
                      setDoc((d) => ({
                        ...d,
                        handover: {
                          ...d.handover,
                          knowledge_transfer: { ...d.handover.knowledge_transfer, notes: e.target.value },
                        },
                      }))
                    }
                  />
                </Field>
              </div>

              <div className="space-y-6">
                <h3 className="text-base font-medium">Target Operating / Support Model</h3>
                <div className="space-y-4">
                  <Field label="Primary Support Contact">
                    <input
                      className={inputBase}
                      value={doc.handover.support_model.primary_support}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        setDoc((d) => ({
                          ...d,
                          handover: {
                            ...d.handover,
                            support_model: { ...d.handover.support_model, primary_support: e.target.value },
                          },
                        }))
                      }
                    />
                  </Field>

                  <Field label="Escalation Path">
                    <input
                      className={inputBase}
                      value={doc.handover.support_model.escalation}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        setDoc((d) => ({
                          ...d,
                          handover: {
                            ...d.handover,
                            support_model: { ...d.handover.support_model, escalation: e.target.value },
                          },
                        }))
                      }
                    />
                  </Field>

                  <Field label="Hypercare Ends">
                    <input
                      type="date"
                      className={inputBase}
                      value={doc.handover.support_model.hypercare_end ?? ""}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        setDoc((d) => ({
                          ...d,
                          handover: {
                            ...d.handover,
                            support_model: { ...d.handover.support_model, hypercare_end: e.target.value },
                          },
                        }))
                      }
                    />
                  </Field>
                </div>
              </div>
            </div>
          </div>
        </Section>

        {/* RECOMMENDATIONS */}
        <Section
          title="Recommendations & Follow-up Actions"
          right={
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={smallBtn}
                disabled={isReadOnly || aiLoadingKey === "closure.recommendations"}
                onClick={() => improveSection("closure.recommendations")}
              >
                {aiLoadingKey === "closure.recommendations" ? "Working…" : "Improve"}
              </button>
              <button
                type="button"
                className={smallBtn}
                disabled={isReadOnly || aiLoadingKey === "closure.recommendations"}
                onClick={() => regenerateSection("closure.recommendations")}
              >
                {aiLoadingKey === "closure.recommendations" ? "Working…" : "Regenerate"}
              </button>

              {canEdit && (
                <button type="button" className={smallBtn} onClick={addRecommendation}>
                  + Add
                </button>
              )}
            </div>
          }
        >
          {doc.recommendations.items.length === 0 ? (
            <p className="text-sm text-gray-500">No recommendations added.</p>
          ) : (
            <div className="space-y-4">
              {doc.recommendations.items.map((item, i) => (
                <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                  <div className="md:col-span-7">
                    <textarea
                      className={textareaBase}
                      placeholder="Text"
                      value={item.text}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        setDoc((d) => ({
                          ...d,
                          recommendations: {
                            items: updateArray(d.recommendations.items, i, (it) => ({ ...it, text: e.target.value })),
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="md:col-span-3">
                    <input
                      className={inputBase}
                      placeholder="Owner"
                      value={item.owner ?? ""}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        setDoc((d) => ({
                          ...d,
                          recommendations: {
                            items: updateArray(d.recommendations.items, i, (it) => ({ ...it, owner: e.target.value })),
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="md:col-span-1">
                    <input
                      type="date"
                      className={inputBase}
                      value={item.due ?? ""}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        setDoc((d) => ({
                          ...d,
                          recommendations: {
                            items: updateArray(d.recommendations.items, i, (it) => ({ ...it, due: e.target.value })),
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="md:col-span-1">
                    {canEdit && (
                      <button type="button" className={dangerBtn} onClick={() => removeRecommendation(i)}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* USEFUL LINKS */}
        <Section
          title="Useful Links & References"
          right={
            canEdit && (
              <button type="button" className={smallBtn} onClick={addLink}>
                + Add link
              </button>
            )
          }
        >
          {doc.links.items.length === 0 ? (
            <p className="text-sm text-gray-500">No links added yet.</p>
          ) : (
            <div className="space-y-4">
              {doc.links.items.map((item, i) => (
                <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                  <div className="md:col-span-5">
                    <input
                      className={inputBase}
                      placeholder="Label"
                      value={item.label}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        setDoc((d) => ({
                          ...d,
                          links: { items: updateArray(d.links.items, i, (it) => ({ ...it, label: e.target.value })) },
                        }))
                      }
                    />
                  </div>
                  <div className="md:col-span-6">
                    <input
                      className={inputBase}
                      placeholder="URL"
                      value={item.url}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        setDoc((d) => ({
                          ...d,
                          links: { items: updateArray(d.links.items, i, (it) => ({ ...it, url: e.target.value })) },
                        }))
                      }
                    />
                  </div>
                  <div className="md:col-span-1">
                    {canEdit && (
                      <button type="button" className={dangerBtn} onClick={() => removeLink(i)}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* ATTACHMENTS */}
        <Section
          title="Attachments & Evidence"
          right={
            canEdit && (
              <div className="flex items-center gap-3">
                {uploadMsg && (
                  <span className={`text-sm ${uploadMsg.includes("failed") ? "text-red-600" : "text-green-600"}`}>
                    {uploadMsg}
                  </span>
                )}
                <label className="cursor-pointer text-sm font-medium text-indigo-600 hover:text-indigo-800">
                  {uploading ? "Uploading…" : "Upload files"}
                  <input
                    type="file"
                    multiple
                    ref={fileInputRef}
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => handleUpload(e.target.files)}
                  />
                </label>
              </div>
            )
          }
        >
          {doc.attachments.items.length === 0 ? (
            <p className="text-sm text-gray-500">No files attached yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {doc.attachments.items.map((att, i) => {
                const removeKey = String(att.path || att.url || att.filename || i);
                const busy = attBusy === removeKey;

                return (
                  <div
                    key={i}
                    className="border border-gray-200 rounded-lg p-4 flex justify-between items-start gap-3 bg-white"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">{att.label || att.filename || "Attachment"}</div>
                      <a
                        href={att.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-indigo-600 hover:underline truncate block"
                      >
                        {att.url}
                      </a>
                      <div className="text-xs text-gray-500 mt-1">
                        {att.filename && `File: ${att.filename}`}
                        {att.size_bytes && ` • ${(att.size_bytes / 1024).toFixed(1)} KB`}
                      </div>
                    </div>

                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        className={smallBtn}
                        disabled={busy}
                        onClick={() => {
                          const newLabel = prompt("Update label:", att.label || "");
                          if (newLabel != null) {
                            setDoc((d) => ({
                              ...d,
                              attachments: {
                                items: updateArray(d.attachments.items, i, (a) => ({ ...a, label: newLabel })),
                              },
                            }));
                          }
                        }}
                      >
                        Edit label
                      </button>

                      {canEdit && (
                        <button
                          type="button"
                          className={dangerBtn}
                          disabled={busy}
                          onClick={() => handleDeleteAttachment(att, i)}
                        >
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

        {/* FINAL SIGN-OFF */}
        <div ref={refSignoff}>
          <Section title="Final Sign-off">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <Field label="Sponsor Name">
                <input
                  className={inputBase}
                  value={doc.signoff.sponsor_name}
                  disabled={isReadOnly}
                  onChange={(e) => setDoc((d) => ({ ...d, signoff: { ...d.signoff, sponsor_name: e.target.value } }))}
                />
              </Field>
              <Field label="Sponsor Date">
                <input
                  type="date"
                  className={inputBase}
                  value={doc.signoff.sponsor_date ?? ""}
                  disabled={isReadOnly}
                  onChange={(e) => setDoc((d) => ({ ...d, signoff: { ...d.signoff, sponsor_date: e.target.value } }))}
                />
              </Field>
              <Field label="Sponsor Decision">
                <select
                  className={selectBase}
                  value={doc.signoff.sponsor_decision}
                  disabled={isReadOnly}
                  onChange={(e) =>
                    setDoc((d) => ({ ...d, signoff: { ...d.signoff, sponsor_decision: e.target.value as any } }))
                  }
                >
                  <option value="">— Select —</option>
                  <option value="approved">Approved</option>
                  <option value="conditional">Conditional</option>
                  <option value="rejected">Rejected</option>
                </select>
              </Field>
            </div>

            <div className="border-t pt-6 mt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <Field label="Project Manager Name">
                  <input
                    className={inputBase}
                    value={doc.signoff.pm_name}
                    disabled={isReadOnly}
                    onChange={(e) => setDoc((d) => ({ ...d, signoff: { ...d.signoff, pm_name: e.target.value } }))}
                  />
                </Field>
                <Field label="PM Date">
                  <input
                    type="date"
                    className={inputBase}
                    value={doc.signoff.pm_date ?? ""}
                    disabled={isReadOnly}
                    onChange={(e) => setDoc((d) => ({ ...d, signoff: { ...d.signoff, pm_date: e.target.value } }))}
                  />
                </Field>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={doc.signoff.pm_approved}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        setDoc((d) => ({ ...d, signoff: { ...d.signoff, pm_approved: e.target.checked } }))
                      }
                    />
                    PM has approved / confirmed
                  </label>
                </div>
              </div>
            </div>
          </Section>
        </div>

        {/* Bottom spacing */}
        <div className="h-20" />
      </div>
    </div>
  );
}