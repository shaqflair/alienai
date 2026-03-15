"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

/* ═══════════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════════ */

type Rag = "green" | "amber" | "red";

type WeeklyReportProject = {
  id?: string | null;
  code?: string | null;
  name?: string | null;
  managerName?: string | null;
  managerEmail?: string | null;
};

type WeeklyReportV1 = {
  version: 1;
  project?: WeeklyReportProject;
  period: { from: string; to: string };
  summary: { rag: Rag; headline: string; narrative: string };
  delivered: Array<{ text: string }>;
  milestones: Array<{ name: string; due: string | null; status: string | null; critical?: boolean }>;
  changes: Array<{ title: string; status: string | null; link?: string | null }>;
  raid: Array<{ title: string; type?: string | null; status?: string | null; due?: string | null; owner?: string | null }>;
  planNextWeek: Array<{ text: string }>;
  resourceSummary?: Array<{ text: string }>;
  keyDecisions?: Array<{ text: string; link?: string | null }>;
  blockers?: Array<{ text: string; link?: string | null }>;
  metrics?: Record<string, any>;
  meta?: Record<string, any>;
};

type UpdateArtifactJsonArgs = { artifactId: string; projectId: string; contentJson: any };
type UpdateArtifactJsonResult = { ok: boolean; error?: string };

export type ProjectHealthProps = {
  healthScore: number | null;
  scheduleHealth: number | null;
  raidHealth: number | null;
  budgetHealth: number | null;
  governanceHealth: number | null;
  scheduleDetail?: { total: number; overdue: number; critical: number; avgSlipDays: number };
  raidDetail?: { total: number; highRisk: number; overdue: number };
  budgetDetail?: { budgetDays: number | null; allocatedDays: number; utilisationPct: number | null };
  governanceDetail?: { pendingApprovalCount: number; openChangeRequests: number };
  resourceLines?: string[];
  finishDate?: string | null;
};

/* ═══════════════════════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════════════════════ */

function safeStr(x: any) { return String(x ?? "").trim(); }

function isoDate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fmtUkDate(iso: string | null | undefined) {
  const v = safeStr(iso);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return v || "";
  const d = new Date(`${v}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}

function defaultModel(): WeeklyReportV1 {
  const to = new Date();
  const from = new Date(to.getTime() - 6 * 24 * 60 * 60 * 1000);
  return {
    version: 1,
    project: { id: null, code: null, name: null, managerName: null, managerEmail: null },
    period: { from: isoDate(from), to: isoDate(to) },
    summary: { rag: "green", headline: "Weekly delivery update", narrative: "Summary of progress, risks, and next steps." },
    delivered: [], milestones: [], changes: [], raid: [], planNextWeek: [],
    resourceSummary: [], keyDecisions: [], blockers: [], metrics: {}, meta: {},
  };
}

function parseMaybeJson(x: any) {
  if (!x) return null;
  if (typeof x === "object") return x;
  if (typeof x === "string") {
    const s = x.trim();
    if (!s) return null;
    if (s.startsWith("{") || s.startsWith("[")) { try { return JSON.parse(s); } catch { return null; } }
  }
  return null;
}

function extractProjectFromAny(x: any): WeeklyReportProject | null {
  if (!x || typeof x !== "object") return null;
  const p0 = x?.project;
  if (p0 && typeof p0 === "object") {
    const out: WeeklyReportProject = {
      id: safeStr(p0.id) || null, code: safeStr(p0.code) || null,
      name: safeStr(p0.name) || null, managerName: safeStr(p0.managerName) || null,
      managerEmail: safeStr(p0.managerEmail) || null,
    };
    if (out.id || out.code || out.name || out.managerName || out.managerEmail) return out;
  }
  const sp = x?.meta?.sources?.project;
  if (sp && typeof sp === "object") {
    const pm = sp?.pm && typeof sp.pm === "object" ? sp.pm : null;
    const out: WeeklyReportProject = {
      id: safeStr(sp.id) || null, code: safeStr(sp.code) || safeStr(sp.project_code) || null,
      name: safeStr(sp.name) || safeStr(sp.project_name) || null,
      managerName: safeStr(pm?.name) || safeStr(sp.managerName) || null,
      managerEmail: safeStr(pm?.email) || safeStr(sp.managerEmail) || null,
    };
    if (out.id || out.code || out.name || out.managerName || out.managerEmail) return out;
  }
  const out: WeeklyReportProject = {
    id: safeStr(x?.project_id) || null, code: safeStr(x?.project_code) || null,
    name: safeStr(x?.project_name) || null, managerName: safeStr(x?.project_manager_name) || null,
    managerEmail: safeStr(x?.project_manager_email) || null,
  };
  if (out.id || out.code || out.name || out.managerName || out.managerEmail) return out;
  return null;
}

function normalizeWeeklyReportV1(x: any, fallback?: WeeklyReportV1): WeeklyReportV1 | null {
  const fb = fallback ?? defaultModel();
  if (!x || typeof x !== "object") return null;
  const extractedProject = extractProjectFromAny(x) ?? fb.project ?? null;

  if ((x?.type === "weekly_report" || x?.type === "weeklyreport") && (x?.periodFrom || x?.periodTo || x?.executiveSummary)) {
    const ragRaw = safeStr(x?.rag).toLowerCase();
    const rag: Rag = ragRaw === "red" ? "red" : ragRaw === "amber" ? "amber" : "green";
    const deliveredRows = Array.isArray(x?.completedThisPeriod?.rows) ? x.completedThisPeriod.rows : [];
    const focusRows = Array.isArray(x?.nextPeriodFocus?.rows) ? x.nextPeriodFocus.rows : [];
    const delivered = deliveredRows.filter((r: any) => r?.type === "data").map((r: any) => safeStr((r?.cells ?? [])[0] ?? "")).filter(Boolean).map((t: string) => ({ text: t }));
    const planNextWeek = focusRows.filter((r: any) => r?.type === "data").map((r: any) => safeStr((r?.cells ?? [])[0] ?? "")).filter(Boolean).map((t: string) => ({ text: t }));
    const blockers = safeStr(x?.operationalBlockers || "").split("\n").map((t: string) => safeStr(t)).filter(Boolean).map((t: string) => ({ text: t, link: null as string | null }));
    return { version: 1, project: extractedProject ?? fb.project, period: { from: safeStr(x?.periodFrom) || fb.period.from, to: safeStr(x?.periodTo) || fb.period.to }, summary: { rag, headline: safeStr(x?.executiveSummary?.headline) || fb.summary.headline, narrative: safeStr(x?.executiveSummary?.narrative) || fb.summary.narrative }, delivered, milestones: Array.isArray(x?.milestones) ? x.milestones : fb.milestones, changes: Array.isArray(x?.changes) ? x.changes : fb.changes, raid: Array.isArray(x?.raid) ? x.raid : fb.raid, planNextWeek, resourceSummary: Array.isArray(x?.resourceSummary) ? x.resourceSummary : fb.resourceSummary ?? [], keyDecisions: Array.isArray(x?.keyDecisions) ? x.keyDecisions : fb.keyDecisions ?? [], blockers, metrics: x?.metrics && typeof x.metrics === "object" ? x.metrics : fb.metrics, meta: x?.meta && typeof x.meta === "object" ? x.meta : fb.meta };
  }

  if (x?.version === 1 && x?.period && x?.sections) {
    const sec = x.sections || {};
    const exec = sec.executive_summary || {};
    const ragRaw = safeStr(exec?.rag).toLowerCase();
    const rag: Rag = ragRaw === "red" ? "red" : ragRaw === "amber" ? "amber" : "green";
    const mapArr = (arr: any[]) => arr.map((it: any) => safeStr(it?.text || it?.title || it)).filter(Boolean).map((t: string) => ({ text: t }));
    const mapLink = (arr: any[]) => arr.map((it: any) => { const text = safeStr(it?.text || it?.title || it); if (!text) return null; return { text, link: safeStr(it?.link).trim() || null }; }).filter(Boolean) as Array<{ text: string; link?: string | null }>;
    return { version: 1, project: extractedProject ?? fb.project, period: { from: safeStr(x?.period?.from) || fb.period.from, to: safeStr(x?.period?.to) || fb.period.to }, summary: { rag, headline: safeStr(exec?.headline) || "Weekly delivery update", narrative: safeStr(exec?.narrative) || "Summary of progress, risks, and next steps." }, delivered: mapArr(Array.isArray(sec.completed_this_period) ? sec.completed_this_period : []), planNextWeek: mapArr(Array.isArray(sec.next_period_focus) ? sec.next_period_focus : []), resourceSummary: mapArr(Array.isArray(sec.resource_summary) ? sec.resource_summary : []), keyDecisions: mapLink(Array.isArray(sec.key_decisions_taken) ? sec.key_decisions_taken : []), blockers: mapLink(Array.isArray(sec.operational_blockers) ? sec.operational_blockers : []), milestones: Array.isArray(x?.lists?.milestones) ? x.lists.milestones : fb.milestones, changes: Array.isArray(x?.lists?.changes) ? x.lists.changes : fb.changes, raid: Array.isArray(x?.lists?.raid) ? x.lists.raid : fb.raid, metrics: x?.metrics && typeof x.metrics === "object" ? x.metrics : fb.metrics, meta: x?.meta && typeof x.meta === "object" ? x.meta : fb.meta };
  }

  if (x?.version === 1 && x?.period && x?.summary) {
    const v = x as WeeklyReportV1;
    return { ...v, project: extractProjectFromAny(v) ?? fb.project, delivered: Array.isArray(v.delivered) ? v.delivered : [], milestones: Array.isArray(v.milestones) ? v.milestones : [], changes: Array.isArray(v.changes) ? v.changes : [], raid: Array.isArray(v.raid) ? v.raid : [], planNextWeek: Array.isArray(v.planNextWeek) ? v.planNextWeek : [], resourceSummary: Array.isArray((v as any)?.resourceSummary) ? (v as any).resourceSummary : [], keyDecisions: Array.isArray((v as any)?.keyDecisions) ? (v as any).keyDecisions : [], blockers: Array.isArray((v as any)?.blockers) ? (v as any).blockers : [], metrics: v.metrics && typeof v.metrics === "object" ? v.metrics : {}, meta: v.meta && typeof v.meta === "object" ? v.meta : {} };
  }
  return null;
}

async function downloadViaFetch(url: string, filename: string) {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try { const a = document.createElement("a"); a.href = objectUrl; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); }
  finally { URL.revokeObjectURL(objectUrl); }
}

/* ═══════════════════════════════════════════════════════════════
   HEALTH UTILS
═══════════════════════════════════════════════════════════════ */

function deriveRagFromHealth(healthScore: number | null): Rag {
  if (healthScore == null) return "green";
  if (healthScore >= 85) return "green";
  if (healthScore >= 70) return "amber";
  return "red";
}

function buildResourceLines(health: ProjectHealthProps): string[] {
  if (health.resourceLines && health.resourceLines.length > 0) return health.resourceLines;
  const lines: string[] = [];
  const { budgetDetail, scheduleDetail } = health;
  if (budgetDetail?.utilisationPct != null) {
    const { allocatedDays, budgetDays, utilisationPct } = budgetDetail;
    const trend = utilisationPct <= 90 ? "on track" : utilisationPct <= 100 ? "approaching budget limit" : "over budget";
    lines.push(`${allocatedDays}d allocated of ${budgetDays ?? "?"}d budget (${utilisationPct}% utilisation) — ${trend}.`);
  }
  if (scheduleDetail?.total != null && scheduleDetail.total > 0) {
    const { total, overdue, critical, avgSlipDays } = scheduleDetail;
    if (overdue > 0) lines.push(`${overdue} of ${total} milestone${total !== 1 ? "s" : ""} overdue${critical > 0 ? `, ${critical} on critical path` : ""}. Average baseline slip: ${avgSlipDays}d.`);
    else lines.push(`All ${total} milestones on track.`);
  }
  return lines;
}

function buildHealthContext(health: ProjectHealthProps): string {
  const rag = deriveRagFromHealth(health.healthScore);
  const lines: string[] = [`Overall health score: ${health.healthScore ?? "unknown"}% (RAG: ${rag.toUpperCase()})`];
  if (health.scheduleHealth != null) { const d = health.scheduleDetail; lines.push(`Schedule health: ${health.scheduleHealth}%${d ? ` — ${d.total} milestones, ${d.overdue} overdue, avg slip ${d.avgSlipDays}d` : ""}.`); }
  if (health.raidHealth != null) { const d = health.raidDetail; lines.push(`RAID health: ${health.raidHealth}%${d ? ` — ${d.total} open items, ${d.highRisk} high-risk, ${d.overdue} past due` : ""}.`); }
  if (health.budgetHealth != null) { const d = health.budgetDetail; lines.push(`Budget health: ${health.budgetHealth}%${d?.utilisationPct != null ? ` — ${d.utilisationPct}% utilisation (${d.allocatedDays}d of ${d.budgetDays ?? "?"}d)` : ""}.`); }
  if (health.governanceHealth != null) { const d = health.governanceDetail; lines.push(`Governance health: ${health.governanceHealth}%${d ? ` — ${d.pendingApprovalCount} pending approvals, ${d.openChangeRequests} open change requests` : ""}.`); }
  if (health.finishDate) lines.push(`Project delivery deadline: ${health.finishDate}.`);
  return lines.join("\n");
}

/* ═══════════════════════════════════════════════════════════════
   RAG CONFIG
═══════════════════════════════════════════════════════════════ */

const RAG: Record<Rag, { bg: string; border: string; text: string; dot: string; label: string; iconBg: string }> = {
  green: { bg: "#f0fdf4", border: "#bbf7d0", text: "#15803d", dot: "#16a34a", label: "On Track",  iconBg: "#16a34a" },
  amber: { bg: "#fffbeb", border: "#fde68a", text: "#b45309", dot: "#f59e0b", label: "At Risk",   iconBg: "#f59e0b" },
  red:   { bg: "#fff5f5", border: "#fecaca", text: "#b91c1c", dot: "#ef4444", label: "Critical",  iconBg: "#ef4444" },
};

const SECTION_COLORS: Record<string, string> = {
  "1": "#0d1117", "2": "#16a34a", "3": "#3b82f6",
  "4": "#8b5cf6", "5": "#f59e0b", "6": "#ef4444", "7": "#64748b",
};

/* ═══════════════════════════════════════════════════════════════
   HISTORY DRAWER
═══════════════════════════════════════════════════════════════ */

type HistoryItem = {
  artifactId: string; title: string | null;
  period: { from: string; to: string } | null;
  rag: Rag | null; headline: string | null;
  savedAt: string; contentJson: any;
};

function fmtSavedAt(iso: string): string {
  if (!iso) return "";
  try { return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(iso)); }
  catch { return iso; }
}

function ReportHistoryDrawer({ isOpen, onClose, reports, loading, error, onLoadReport }: {
  isOpen: boolean; onClose: () => void; reports: HistoryItem[];
  loading: boolean; error: string | null;
  onLoadReport: (contentJson: any, periodLabel: string) => void;
}) {
  const [preview, setPreview] = useState<HistoryItem | null>(null);
  useEffect(() => { if (!isOpen) setPreview(null); }, [isOpen]);
  if (!isOpen) return null;

  const cj = preview?.contentJson as WeeklyReportV1 | null;
  const previewRag = preview?.rag ? RAG[preview.rag] : RAG.green;
  const previewPeriod = preview?.period ? `${fmtUkDate(preview.period.from)} — ${fmtUkDate(preview.period.to)}` : "Unknown period";

  return (
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(0,0,0,0.2)", backdropFilter: "blur(2px)" }} onClick={onClose} />
      <div style={{ position: "fixed", right: 0, top: 0, bottom: 0, zIndex: 50, width: "100%", maxWidth: 420, background: "#ffffff", boxShadow: "-4px 0 32px rgba(0,0,0,0.1)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", borderBottom: "1px solid #e8ecf0", flexShrink: 0 }}>
          {preview && (
            <button type="button" onClick={() => setPreview(null)} style={{ padding: 6, borderRadius: 8, border: "1px solid #e8ecf0", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: "#0d1117", margin: 0 }}>{preview ? "Report preview" : "Report history"}</p>
            {preview && <p style={{ fontSize: 12, color: "#8b949e", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{previewPeriod}</p>}
          </div>
          <button type="button" onClick={onClose} style={{ padding: 6, borderRadius: 8, border: "1px solid #e8ecf0", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {!preview && (
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              {loading && <div style={{ textAlign: "center", padding: "40px 0", color: "#8b949e", fontSize: 13 }}>Loading history…</div>}
              {error && !loading && <div style={{ padding: "12px 14px", borderRadius: 10, background: "#fff5f5", border: "1px solid #fecaca", fontSize: 13, color: "#b91c1c" }}>{error}</div>}
              {!loading && !error && reports.length === 0 && <div style={{ textAlign: "center", padding: "40px 0", color: "#8b949e", fontSize: 13 }}>No previous reports saved.</div>}
              {!loading && reports.map((r) => {
                const cfg = r.rag ? RAG[r.rag] : RAG.green;
                const periodLabel = r.period ? `${fmtUkDate(r.period.from)} — ${fmtUkDate(r.period.to)}` : r.title || "Report";
                return (
                  <button key={r.artifactId} type="button" onClick={() => setPreview(r)} style={{ width: "100%", textAlign: "left", borderRadius: 10, border: "1px solid #e8ecf0", background: "#fff", padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: cfg.bg, border: `1px solid ${cfg.border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: cfg.dot }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: "#0d1117", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{periodLabel}</p>
                      {r.headline && <p style={{ fontSize: 12, color: "#8b949e", margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.headline}</p>}
                      <p style={{ fontSize: 11, color: "#8b949e", margin: "4px 0 0" }}>Saved {fmtSavedAt(r.savedAt)}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {preview && cj && (
            <div style={{ padding: "20px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ borderRadius: 10, padding: "12px 14px", background: previewRag.bg, border: `1px solid ${previewRag.border}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: previewRag.dot }} />
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: previewRag.text }}>{previewRag.label}</span>
                </div>
                {cj.summary?.headline && <p style={{ fontSize: 14, fontWeight: 600, color: "#0d1117", margin: 0, lineHeight: 1.4 }}>{cj.summary.headline}</p>}
              </div>
              {cj.summary?.narrative && <p style={{ fontSize: 13, color: "#57606a", lineHeight: 1.65, margin: 0 }}>{cj.summary.narrative}</p>}
              {(["delivered", "planNextWeek", "keyDecisions", "blockers", "resourceSummary"] as const).map((key) => {
                const items = (cj as any)[key] as Array<{ text: string }> | undefined;
                if (!items?.length) return null;
                const labels: Record<string, string> = { delivered: "Completed this week", planNextWeek: "Planned next week", keyDecisions: "Key decisions", blockers: "Blockers", resourceSummary: "Resource summary" };
                return (
                  <div key={key}>
                    <p style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "#8b949e", margin: "0 0 6px" }}>{labels[key]}</p>
                    <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 4 }}>
                      {items.map((it, i) => <li key={i} style={{ fontSize: 13, color: "#57606a" }}>{safeStr(it?.text ?? it)}</li>)}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {preview && (
          <div style={{ padding: "14px 20px", borderTop: "1px solid #e8ecf0", background: "#fff", flexShrink: 0 }}>
            <button type="button" onClick={() => { const label = preview.period ? `${fmtUkDate(preview.period.from)} — ${fmtUkDate(preview.period.to)}` : preview.title || "this report"; onLoadReport(preview.contentJson, label); }} style={{ width: "100%", padding: "10px 0", borderRadius: 10, background: "#7c3aed", border: "none", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Load into editor
            </button>
            <p style={{ textAlign: "center", fontSize: 11, color: "#8b949e", margin: "6px 0 0" }}>This will replace your current unsaved changes</p>
          </div>
        )}
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════ */

export default function WeeklyReportEditor({
  projectId, artifactId, initialJson, readOnly, updateArtifactJsonAction, health,
}: {
  projectId: string; artifactId: string; initialJson: any; readOnly: boolean;
  updateArtifactJsonAction?: (args: UpdateArtifactJsonArgs) => Promise<UpdateArtifactJsonResult>;
  health?: ProjectHealthProps;
}) {
  const seed = useMemo<WeeklyReportV1>(() => {
    const parsed = parseMaybeJson(initialJson);
    return normalizeWeeklyReportV1(parsed, defaultModel()) ?? defaultModel();
  }, [initialJson]);

  const [model, setModel] = useState<WeeklyReportV1>(seed);
  const [busyGen, setBusyGen]   = useState(false);
  const [busySave, setBusySave] = useState(false);
  const [busyPdf, setBusyPdf]   = useState(false);
  const [busyPpt, setBusyPpt]   = useState(false);
  const [busyWord, setBusyWord] = useState(false);
  const [busySync, setBusySync] = useState(false);
  const [err, setErr]           = useState<string | null>(null);
  const [saveMsg, setSaveMsg]   = useState<string | null>(null);
  const [syncMsg, setSyncMsg]   = useState<string | null>(null);
  const [showHistory, setShowHistory]       = useState(false);
  const [historyItems, setHistoryItems]     = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyErr, setHistoryErr]         = useState<string | null>(null);

  const snapshot    = useRef<string>(JSON.stringify(seed));
  const lastIdRef   = useRef<string>("");
  const autoSynced  = useRef(false);

  useEffect(() => {
    if (artifactId && lastIdRef.current && lastIdRef.current !== artifactId) {
      setModel(seed); snapshot.current = JSON.stringify(seed);
      setErr(null); setSaveMsg(null); setSyncMsg(null); autoSynced.current = false;
    }
    lastIdRef.current = artifactId;
  }, [artifactId, seed]);

  useEffect(() => {
    if (JSON.stringify(model) === snapshot.current) { setModel(seed); snapshot.current = JSON.stringify(seed); }
  }, [seed]);

  useEffect(() => {
    if (autoSynced.current || !health || readOnly) return;
    if (model.summary.narrative === "Summary of progress, risks, and next steps." && model.summary.headline === "Weekly delivery update" && (model.resourceSummary ?? []).length === 0) {
      autoSynced.current = true;
      void applyHealthSync(false);
    }
  }, [health]);

  const dirty = JSON.stringify(model) !== snapshot.current;

  function setField(path: string, value: any) {
    setModel((prev) => {
      const next: any = { ...prev };
      const parts = path.split(".");
      let cur: any = next;
      for (let i = 0; i < parts.length - 1; i++) { const k = parts[i]; cur[k] = cur[k] && typeof cur[k] === "object" ? { ...cur[k] } : {}; cur = cur[k]; }
      cur[parts[parts.length - 1]] = value;
      return next;
    });
  }

  // ── Health sync ──────────────────────────────────────────────────────────

  async function applyHealthSync(showToast = true) {
    if (!health) return;
    setBusySync(true); setErr(null);
    try {
      const derivedRag   = deriveRagFromHealth(health.healthScore);
      const resourceLines = buildResourceLines(health);
      const healthContext = buildHealthContext(health);
      let headline  = model.summary.headline;
      let narrative = model.summary.narrative;
      try {
        const res = await fetch("/api/ai/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventType: "weekly_report_narrative", projectId, payload: { artifactId, period: model.period, ragStatus: derivedRag, healthContext, projectName: model.project?.name ?? "", projectCode: model.project?.code ?? "", managerName: model.project?.managerName ?? "" } }) });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json?.ok) {
          setModel((prev) => ({ ...prev, summary: { ...prev.summary, rag: derivedRag, headline: safeStr(json.headline) || prev.summary.headline, narrative: safeStr(json.narrative) || prev.summary.narrative }, delivered: json.delivered?.length ? json.delivered : prev.delivered, planNextWeek: json.planNextWeek?.length ? json.planNextWeek : prev.planNextWeek, resourceSummary: json.resourceSummary?.length ? json.resourceSummary : resourceLines.map((t) => ({ text: t })), keyDecisions: json.keyDecisions?.length ? json.keyDecisions : prev.keyDecisions, blockers: json.blockers?.length ? json.blockers : prev.blockers }));
          if (showToast) { setSyncMsg(`Synced from project health (${health.healthScore ?? "?"}% → ${derivedRag.toUpperCase()}).`); setTimeout(() => setSyncMsg(null), 4000); }
          return;
        }
        headline  = buildFallbackHeadline(health, derivedRag, model);
        narrative = buildFallbackNarrative(health, derivedRag, model);
      } catch { headline = buildFallbackHeadline(health, derivedRag, model); narrative = buildFallbackNarrative(health, derivedRag, model); }
      setModel((prev) => ({ ...prev, summary: { ...prev.summary, rag: derivedRag, headline, narrative }, resourceSummary: resourceLines.map((t) => ({ text: t })) }));
      if (showToast) { setSyncMsg(`Synced from project health (${health.healthScore ?? "?"}% → ${derivedRag.toUpperCase()}).`); setTimeout(() => setSyncMsg(null), 4000); }
    } catch (e: any) { setErr(e?.message ?? "Sync failed"); }
    finally { setBusySync(false); }
  }

  function buildFallbackHeadline(h: ProjectHealthProps, rag: Rag, m: WeeklyReportV1): string {
    const projLabel = safeStr(m.project?.name || m.project?.code) || "Project";
    return `${projLabel} — ${rag === "green" ? "On Track" : rag === "amber" ? "At Risk" : "Critical"} (${h.healthScore ?? "?"}% health)`;
  }

  function buildFallbackNarrative(h: ProjectHealthProps, rag: Rag, m: WeeklyReportV1): string {
    const ragDesc = rag === "green" ? "The project is progressing well and remains on track for delivery." : rag === "amber" ? "The project has some areas of concern that require attention to maintain the delivery timeline." : "The project is in a critical state. Immediate executive attention is required.";
    const parts: string[] = [ragDesc];
    if (h.scheduleHealth != null && h.scheduleDetail) { const { overdue, total, critical, avgSlipDays } = h.scheduleDetail; if (overdue > 0) parts.push(`Schedule health is at ${h.scheduleHealth}% with ${overdue} of ${total} milestone${total !== 1 ? "s" : ""} overdue${critical > 0 ? `, including ${critical} on the critical path` : ""}. Average baseline slip is ${avgSlipDays} day${avgSlipDays !== 1 ? "s" : ""}.`); else parts.push(`All ${total} schedule milestone${total !== 1 ? "s" : ""} are on track.`); }
    if (h.raidHealth != null && h.raidDetail) { const { highRisk, total } = h.raidDetail; if (highRisk > 0) parts.push(`${highRisk} of ${total} open RAID item${total !== 1 ? "s" : ""} are rated high-risk and are being actively managed.`); }
    if (h.finishDate) parts.push(`Delivery deadline: ${h.finishDate}.`);
    return parts.join(" ");
  }

  // ── Generate ─────────────────────────────────────────────────────────────

  async function generate() {
    setErr(null); setSaveMsg(null); setBusyGen(true);
    try {
      const res = await fetch("/api/ai/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventType: "delivery_report", projectId, payload: { artifactId, period: model.period, windowDays: 7, healthContext: health ? buildHealthContext(health) : undefined, derivedRag: health ? deriveRagFromHealth(health.healthScore) : undefined } }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Generate failed");
      const reportRaw = json?.report || json?.delivery_report || json?.ai?.report || json?.content_json;
      const report = normalizeWeeklyReportV1(parseMaybeJson(reportRaw), model);
      if (!report) throw new Error("Generator returned an unexpected payload shape.");
      const mergedProject: WeeklyReportProject = { ...(report.project ?? {}), id: report.project?.id ?? safeStr(json?.project_id) ?? null, code: report.project?.code ?? safeStr(json?.project_code) ?? null, name: report.project?.name ?? safeStr(json?.project_name) ?? null, managerName: report.project?.managerName ?? safeStr(json?.project_manager_name) ?? null, managerEmail: report.project?.managerEmail ?? safeStr(json?.project_manager_email) ?? null };
      const finalRag = health ? deriveRagFromHealth(health.healthScore) : report.summary.rag;
      const finalResources = report.resourceSummary && report.resourceSummary.length > 0 ? report.resourceSummary : health ? buildResourceLines(health).map((t) => ({ text: t })) : [];
      setModel({ ...report, project: mergedProject, summary: { ...report.summary, rag: finalRag }, resourceSummary: finalResources, meta: { ...(report.meta ?? {}), generated_at: new Date().toISOString() } });
    } catch (e: any) { setErr(e?.message ?? "Generate failed"); }
    finally { setBusyGen(false); }
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  async function save() {
    setErr(null); setSaveMsg(null);
    if (readOnly) return;
    if (!updateArtifactJsonAction) { setErr("Save action not wired."); return; }
    setBusySave(true);
    try {
      const res = await updateArtifactJsonAction({ artifactId, projectId, contentJson: model });
      if (!res?.ok) throw new Error(res?.error || "Save failed");
      snapshot.current = JSON.stringify(model);
      setSaveMsg("Saved.");
    } catch (e: any) { setErr(e?.message ?? "Save failed"); }
    finally { setBusySave(false); }
  }

  async function exportPdf() {
    setErr(null); setBusyPdf(true);
    try { await downloadViaFetch(`/api/artifacts/weekly-report/export/pdf?projectId=${encodeURIComponent(projectId)}&artifactId=${encodeURIComponent(artifactId)}&includeDraft=1`, `Weekly Report - ${safeStr(model.project?.code) || "Project"} - ${model.period.from}_to_${model.period.to}.pdf`); }
    catch (e: any) { setErr(e?.message ?? "PDF export failed"); }
    finally { setBusyPdf(false); }
  }

  async function exportPpt() {
    setErr(null); setBusyPpt(true);
    try { await downloadViaFetch(`/api/artifacts/weekly-report/export/ppt?projectId=${encodeURIComponent(projectId)}&artifactId=${encodeURIComponent(artifactId)}&includeDraft=1`, `Weekly Report - ${safeStr(model.project?.code) || "Project"} - ${model.period.from}_to_${model.period.to}.pptx`); }
    catch (e: any) { setErr(e?.message ?? "PPT export failed"); }
    finally { setBusyPpt(false); }
  }

  async function exportWord() {
    setErr(null); setBusyWord(true);
    try { await downloadViaFetch(`/api/artifacts/weekly-report/export/word?projectId=${encodeURIComponent(projectId)}&artifactId=${encodeURIComponent(artifactId)}&includeDraft=1`, `Weekly Report - ${safeStr(model.project?.code) || "Project"} - ${model.period.from}_to_${model.period.to}.docx`); }
    catch (e: any) { setErr(e?.message ?? "Word export failed"); }
    finally { setBusyWord(false); }
  }

  async function openHistory() {
    setHistoryErr(null); setShowHistory(true); setHistoryLoading(true);
    try {
      const res = await fetch(`/api/artifacts/weekly-report/history?projectId=${encodeURIComponent(projectId)}&artifactId=${encodeURIComponent(artifactId)}&limit=50`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!json?.ok) throw new Error(json?.error || "Failed to load history");
      setHistoryItems(Array.isArray(json.reports) ? json.reports : []);
    } catch (e: any) { setHistoryErr(e?.message ?? "Could not load report history"); }
    finally { setHistoryLoading(false); }
  }

  function loadHistoryItem(contentJson: any, periodLabel: string) {
    const parsed = normalizeWeeklyReportV1(contentJson, model);
    if (!parsed) { setErr("Could not load that report — the data format was not recognised."); return; }
    setModel(parsed); snapshot.current = JSON.stringify(parsed);
    setShowHistory(false); setSaveMsg(`Loaded report: ${periodLabel}. Save to keep it.`);
  }

  // ── Derived display ───────────────────────────────────────────────────────

  const rag       = RAG[model.summary.rag];
  const periodUk  = `${fmtUkDate(model.period.from)} — ${fmtUkDate(model.period.to)}`;
  const projName  = safeStr(model.project?.name);
  const projCode  = safeStr(model.project?.code);
  const pmName    = safeStr(model.project?.managerName);

  // ── Styles ────────────────────────────────────────────────────────────────

  const S = {
    page:    { minHeight: "100vh", background: "#f6f8fa", fontFamily: "'Geist', -apple-system, sans-serif" } as React.CSSProperties,
    header:  { background: "#ffffff", borderBottom: "1px solid #e8ecf0", padding: "14px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, position: "sticky" as const, top: 0, zIndex: 30 },
    iconBox: { width: 44, height: 44, borderRadius: 12, background: rag.iconBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 } as React.CSSProperties,
    dot:     { width: 14, height: 14, borderRadius: "50%", background: "#fff" } as React.CSSProperties,
    title:   { fontSize: 18, fontWeight: 700, color: "#0d1117", margin: 0, letterSpacing: "-0.3px" },
    subtitle:{ fontSize: 13, color: "#8b949e", margin: 0, display: "flex", alignItems: "center", gap: 6 } as React.CSSProperties,
    dot3:    { width: 3, height: 3, borderRadius: "50%", background: "#d0d7de", display: "inline-block" },
    codePill:{ fontSize: 11, fontFamily: "ui-monospace, monospace", background: "#f6f8fa", color: "#57606a", padding: "2px 7px", borderRadius: 4, border: "1px solid #e8ecf0" },
    unsaved: { fontSize: 11, color: "#b45309", background: "#fef3c7", padding: "2px 7px", borderRadius: 4 },
    actions: { display: "flex", alignItems: "center", gap: 6 } as React.CSSProperties,
    body:    { maxWidth: 960, margin: "0 auto", padding: "28px 28px 64px", display: "flex", flexDirection: "column" as const, gap: 16 },
    card:    { background: "#ffffff", borderRadius: 16, padding: "24px 28px" } as React.CSSProperties,
    lbl:     { fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase" as const, color: "#8b949e", marginBottom: 6, display: "block" },
    input:   { width: "100%", background: "#f6f8fa", border: "1px solid #e8ecf0", borderRadius: 8, padding: "9px 12px", fontSize: 13, color: "#0d1117", fontFamily: "inherit", outline: "none", boxSizing: "border-box" as const },
    textarea:{ width: "100%", background: "#f6f8fa", border: "1px solid #e8ecf0", borderRadius: 8, padding: "9px 12px", fontSize: 13, color: "#0d1117", fontFamily: "inherit", outline: "none", resize: "vertical" as const, lineHeight: 1.65, boxSizing: "border-box" as const },
    select:  { width: "100%", background: "#f6f8fa", border: "1px solid #e8ecf0", borderRadius: 8, padding: "9px 12px", fontSize: 13, color: "#0d1117", fontFamily: "inherit", outline: "none", appearance: "none" as const, cursor: "pointer" },
    numBadge:(n: string, color: string): React.CSSProperties => ({ width: 28, height: 28, borderRadius: 8, background: color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff", flexShrink: 0 }),
    sectionHdr:{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 } as React.CSSProperties,
    sectionTitle:{ fontSize: 15, fontWeight: 700, color: "#0d1117", letterSpacing: "-0.2px" },
    countPill:{ marginLeft: "auto", fontSize: 11, color: "#8b949e", background: "#f6f8fa", padding: "2px 9px", borderRadius: 20, border: "1px solid #e8ecf0" },
  };

  const Btn = ({ label, busy, onClick, disabled, style }: { label: string; busy?: boolean; onClick: () => void; disabled?: boolean; style?: React.CSSProperties }) => (
    <button type="button" onClick={onClick} disabled={disabled || busy} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 13px", borderRadius: 8, border: "1px solid #e8ecf0", background: "#fff", fontSize: 13, fontWeight: 600, color: "#57606a", cursor: "pointer", fontFamily: "inherit", opacity: (disabled || busy) ? 0.45 : 1, whiteSpace: "nowrap" as const, ...style }}>
      {busy ? "…" : label}
    </button>
  );

  const taStyle: React.CSSProperties = { ...S.textarea, minHeight: "unset", height: "auto", overflowY: "hidden", resize: "none", lineHeight: 1.55, padding: "7px 10px" };

  const AutoTA = ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) => {
    const ref = React.useRef<HTMLTextAreaElement>(null);
    React.useEffect(() => { if (ref.current) { ref.current.style.height = "auto"; ref.current.style.height = ref.current.scrollHeight + "px"; } }, [value]);
    return (
      <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={1}
        style={{ ...taStyle, flex: 1, width: "100%" }}
        onInput={(e) => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; }}
      />
    );
  };

  const ListEditor = ({ items, onChange, placeholder }: { items: Array<{ text: string }>; onChange: (v: Array<{ text: string }>) => void; placeholder: string }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.length === 0 && <div style={{ fontSize: 12, color: "#c9d1d9", padding: "8px 0" }}>No items yet</div>}
      {items.map((it, idx) => (
        <div key={idx} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#d0d7de", flexShrink: 0, marginTop: 10 }} />
          {readOnly
            ? <span style={{ fontSize: 13, color: "#0d1117", flex: 1, lineHeight: 1.55 }}>{it.text}</span>
            : <AutoTA value={it.text} onChange={(v) => { const next = items.slice(); next[idx] = { text: v }; onChange(next); }} placeholder={placeholder} />
          }
          {!readOnly && (
            <button type="button" onClick={() => onChange(items.filter((_, i) => i !== idx))} style={{ border: "none", background: "none", cursor: "pointer", color: "#c9d1d9", fontSize: 16, padding: "0 2px", lineHeight: 1, marginTop: 6, flexShrink: 0 }}>×</button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button type="button" onClick={() => onChange(items.concat([{ text: "" }]))} style={{ fontSize: 12, color: "#8b949e", background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: "4px 0", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4 }}>
          + Add item
        </button>
      )}
    </div>
  );

  const LinkListEditor = ({ items, onChange, placeholderText }: { items: Array<{ text: string; link?: string | null }>; onChange: (v: Array<{ text: string; link?: string | null }>) => void; placeholderText: string }) => {
    const safe = Array.isArray(items) ? items : [];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {safe.length === 0 && <div style={{ fontSize: 12, color: "#c9d1d9", padding: "8px 0" }}>No items yet</div>}
        {safe.map((it, idx) => (
          <div key={idx} style={{ display: "flex", flexDirection: "column", gap: 4, background: "#f6f8fa", borderRadius: 8, padding: "8px 10px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#d0d7de", flexShrink: 0, marginTop: 10 }} />
              {readOnly
                ? <span style={{ fontSize: 13, color: "#0d1117", flex: 1, lineHeight: 1.55 }}>{it.text}</span>
                : <AutoTA value={it.text} onChange={(v) => { const next = safe.slice(); next[idx] = { ...next[idx], text: v }; onChange(next); }} placeholder={placeholderText} />
              }
              {!readOnly && (
                <button type="button" onClick={() => onChange(safe.filter((_, i) => i !== idx))} style={{ border: "none", background: "none", cursor: "pointer", color: "#c9d1d9", fontSize: 16, padding: "0 2px", lineHeight: 1, marginTop: 6, flexShrink: 0 }}>×</button>
              )}
            </div>
            {!readOnly && (
              <input value={safeStr(it.link)} onChange={(e) => { const next = safe.slice(); next[idx] = { ...next[idx], link: e.target.value || null }; onChange(next); }} style={{ ...S.input, fontSize: 11, color: "#8b949e", background: "#fff", paddingLeft: 22 }} placeholder="Link (optional)" />
            )}
            {readOnly && it.link && <a href={it.link} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#3b82f6", textDecoration: "none", paddingLeft: 14 }}>↗ Open link</a>}
          </div>
        ))}
        {!readOnly && (
          <button type="button" onClick={() => onChange(safe.concat([{ text: "", link: null }]))} style={{ fontSize: 12, color: "#8b949e", background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: "4px 0", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4 }}>
            + Add item
          </button>
        )}
      </div>
    );
  };

  /* ── Render ── */
  return (
    <div style={S.page}>
      {/* ── Header ── */}
      <header style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          <div style={S.iconBox}><div style={S.dot} /></div>
          <div style={{ minWidth: 0 }}>
            <p style={S.title}>Weekly Report</p>
            <div style={S.subtitle}>
              <span>{periodUk}</span>
              {projCode && (<><span style={S.dot3} /><span style={S.codePill}>{projCode}</span></>)}
              {dirty && (<><span style={S.dot3} /><span style={S.unsaved}>Unsaved</span></>)}
            </div>
          </div>
        </div>
        <div style={S.actions}>
          <Btn label={busyPdf  ? "…" : "PDF"}     onClick={exportPdf}   busy={busyPdf} />
          <Btn label={busyPpt  ? "…" : "PPT"}     onClick={exportPpt}   busy={busyPpt} />
          <Btn label={busyWord ? "…" : "Word"}     onClick={exportWord}  busy={busyWord} />
          <Btn label="History"                     onClick={openHistory} />
          {health && !readOnly && (
            <Btn label={busySync ? "Syncing…" : "↻ Sync health"} onClick={() => void applyHealthSync(true)} busy={busySync} />
          )}
          <Btn label={busyGen ? "Generating…" : "✦ Generate"} onClick={generate} busy={busyGen} disabled={readOnly}
            style={{ background: "#ede9fe", border: "1px solid #c4b5fd", color: "#6d28d9" }} />
          <Btn label={busySave ? "Saving…" : "Save"} onClick={save} busy={busySave} disabled={readOnly || !dirty}
            style={{ background: "#0d1117", border: "1px solid #0d1117", color: "#fff" }} />
        </div>
      </header>

      {/* ── Body ── */}
      <div style={S.body}>

        {/* Banners */}
        {err && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderRadius: 10, background: "#fff5f5", border: "1px solid #fecaca", fontSize: 13, color: "#b91c1c" }}>
            <span style={{ flex: 1 }}>{err}</span>
            <button type="button" onClick={() => setErr(null)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16, color: "#b91c1c" }}>×</button>
          </div>
        )}
        {saveMsg && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderRadius: 10, background: "#f0fdf4", border: "1px solid #bbf7d0", fontSize: 13, color: "#15803d" }}>
            <span style={{ flex: 1 }}>{saveMsg}</span>
            <button type="button" onClick={() => setSaveMsg(null)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16, color: "#15803d" }}>×</button>
          </div>
        )}
        {syncMsg && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderRadius: 10, background: "#eff6ff", border: "1px solid #bfdbfe", fontSize: 13, color: "#1d4ed8" }}>
            <span style={{ flex: 1 }}>{syncMsg}</span>
            <button type="button" onClick={() => setSyncMsg(null)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16, color: "#1d4ed8" }}>×</button>
          </div>
        )}

        {/* ── Card 1: Project meta + Period + RAG ── */}
        <div style={S.card}>
          {/* Project / PM row */}
          {(projName || pmName) && (
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
              <div>
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "#8b949e", display: "block", marginBottom: 4 }}>Project</span>
                <span style={{ fontSize: 18, fontWeight: 700, color: "#0d1117" }}>{projName || "—"}</span>
              </div>
              {pmName && (
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "#8b949e", display: "block", marginBottom: 4 }}>PM</span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: "#0d1117" }}>{pmName}</span>
                </div>
              )}
            </div>
          )}

          {/* Period + RAG grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
            <div>
              <span style={S.lbl}>Period from</span>
              <input type="date" value={model.period.from} onChange={(e) => setField("period.from", e.target.value)} disabled={readOnly} style={S.input} />
            </div>
            <div>
              <span style={S.lbl}>Period to</span>
              <input type="date" value={model.period.to} onChange={(e) => setField("period.to", e.target.value)} disabled={readOnly} style={S.input} />
            </div>
            <div>
              <span style={S.lbl}>RAG status</span>
              <div style={{ position: "relative" }}>
                <select value={model.summary.rag} onChange={(e) => setField("summary.rag", e.target.value as Rag)} disabled={readOnly} style={{ ...S.select, color: rag.text, fontWeight: 600 }}>
                  <option value="green">Green — On Track</option>
                  <option value="amber">Amber — At Risk</option>
                  <option value="red">Red — Critical</option>
                </select>
              </div>
            </div>
          </div>

          {/* ON TRACK pill */}
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, marginTop: 16 }}>
            {health?.healthScore != null && (
              <span style={{ fontSize: 11, color: "#8b949e" }}>
                Project health: <strong style={{ color: "#0d1117" }}>{health.healthScore}%</strong> — RAG auto-derived. Override above if needed.
              </span>
            )}
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: rag.bg, border: `1px solid ${rag.border}`, borderRadius: 10, padding: "8px 16px" }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: rag.dot }} />
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: rag.text }}>{rag.label}</span>
            </div>
          </div>
        </div>

        {/* ── Card 2: Executive Summary ── */}
        <div style={S.card}>
          <div style={S.sectionHdr}>
            <div style={S.numBadge("1", SECTION_COLORS["1"])}>1</div>
            <span style={S.sectionTitle}>Executive Summary</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <span style={S.lbl}>Headline</span>
              {readOnly
                ? <p style={{ fontSize: 14, color: "#0d1117", margin: 0, lineHeight: 1.5 }}>{model.summary.headline}</p>
                : <input value={model.summary.headline} onChange={(e) => setField("summary.headline", e.target.value)} style={S.input} placeholder="One-line headline…" />
              }
            </div>
            <div>
              <span style={S.lbl}>Narrative</span>
              {readOnly
                ? <p style={{ fontSize: 14, color: "#0d1117", margin: 0, lineHeight: 1.65 }}>{model.summary.narrative}</p>
                : <textarea value={model.summary.narrative} onChange={(e) => setField("summary.narrative", e.target.value)} style={{ ...S.textarea, minHeight: 120 }} placeholder="Executive summary narrative…" />
              }
            </div>
          </div>
        </div>

        {/* ── Cards 3-4: Completed + Next Period (two col) ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={S.card}>
            <div style={S.sectionHdr}>
              <div style={S.numBadge("2", SECTION_COLORS["2"])}>2</div>
              <span style={S.sectionTitle}>Completed This Period</span>
              <span style={S.countPill}>{model.delivered.length}</span>
            </div>
            <ListEditor items={model.delivered} onChange={(items) => setModel((p) => ({ ...p, delivered: items }))} placeholder="What was delivered…" />
          </div>
          <div style={S.card}>
            <div style={S.sectionHdr}>
              <div style={S.numBadge("3", SECTION_COLORS["3"])}>3</div>
              <span style={S.sectionTitle}>Next Period Focus</span>
              <span style={S.countPill}>{model.planNextWeek.length}</span>
            </div>
            <ListEditor items={model.planNextWeek} onChange={(items) => setModel((p) => ({ ...p, planNextWeek: items }))} placeholder="What's planned next…" />
          </div>
        </div>

        {/* ── Cards 5-7: Resources + Decisions + Blockers (three col) ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
          <div style={S.card}>
            <div style={S.sectionHdr}>
              <div style={S.numBadge("4", SECTION_COLORS["4"])}>4</div>
              <span style={S.sectionTitle}>Resources</span>
              <span style={S.countPill}>{(model.resourceSummary ?? []).length}</span>
            </div>
            <ListEditor items={model.resourceSummary ?? []} onChange={(items) => setModel((p) => ({ ...p, resourceSummary: items }))} placeholder="Resource note…" />
          </div>
          <div style={S.card}>
            <div style={S.sectionHdr}>
              <div style={S.numBadge("5", SECTION_COLORS["5"])}>5</div>
              <span style={S.sectionTitle}>Key Decisions</span>
              <span style={S.countPill}>{(model.keyDecisions ?? []).length}</span>
            </div>
            <LinkListEditor items={model.keyDecisions ?? []} onChange={(items) => setModel((p) => ({ ...p, keyDecisions: items }))} placeholderText="Decision…" />
          </div>
          <div style={S.card}>
            <div style={S.sectionHdr}>
              <div style={S.numBadge("6", SECTION_COLORS["6"])}>6</div>
              <span style={S.sectionTitle}>Blockers</span>
              <span style={S.countPill}>{(model.blockers ?? []).length}</span>
            </div>
            <LinkListEditor items={model.blockers ?? []} onChange={(items) => setModel((p) => ({ ...p, blockers: items }))} placeholderText="Blocker…" />
          </div>
        </div>

      </div>

      {/* ── History drawer ── */}
      <ReportHistoryDrawer
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        reports={historyItems}
        loading={historyLoading}
        error={historyErr}
        onLoadReport={loadHistoryItem}
      />
    </div>
  );
}

