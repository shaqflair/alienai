"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

/* ═══════════════════════════════════════════════════════════════
   TYPES (unchanged)
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
  raid: Array<{
    title: string;
    type?: string | null;
    status?: string | null;
    due?: string | null;
    owner?: string | null;
  }>;
  planNextWeek: Array<{ text: string }>;
  resourceSummary?: Array<{ text: string }>;
  keyDecisions?: Array<{ text: string; link?: string | null }>;
  blockers?: Array<{ text: string; link?: string | null }>;
  metrics?: { milestonesDone?: number; wbsDone?: number; changesClosed?: number; raidClosed?: number };
  meta?: { generated_at?: string; sources?: any };
};

type UpdateArtifactJsonArgs = {
  artifactId: string;
  projectId: string;
  contentJson: any;
};
type UpdateArtifactJsonResult = { ok: boolean; error?: string };

/* ═══════════════════════════════════════════════════════════════
   UTILS — all original logic preserved byte-for-byte
═══════════════════════════════════════════════════════════════ */

function safeStr(x: any) {
  return String(x ?? "").trim();
}

function isoDate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isIsoYmd(x: any) {
  return typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.trim());
}

function fmtUkDate(iso: string | null | undefined) {
  const v = safeStr(iso);
  if (!isIsoYmd(v)) return v || "";
  const d = new Date(`${v}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

function defaultModel(): WeeklyReportV1 {
  const to = new Date();
  const from = new Date(to.getTime() - 6 * 24 * 60 * 60 * 1000);
  return {
    version: 1,
    project: { id: null, code: null, name: null, managerName: null, managerEmail: null },
    period: { from: isoDate(from), to: isoDate(to) },
    summary: { rag: "green", headline: "Weekly delivery update", narrative: "Summary of progress, risks, and next steps." },
    delivered: [],
    milestones: [],
    changes: [],
    raid: [],
    planNextWeek: [],
    resourceSummary: [],
    keyDecisions: [],
    blockers: [],
    metrics: {},
    meta: {},
  };
}

function parseMaybeJson(x: any) {
  if (!x) return null;
  if (typeof x === "object") return x;
  if (typeof x === "string") {
    const s = x.trim();
    if (!s) return null;
    if (s.startsWith("{") || s.startsWith("[")) {
      try { return JSON.parse(s); } catch { return null; }
    }
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

  // weekly_report doc style
  if ((x?.type === "weekly_report" || x?.type === "weeklyreport") && (x?.periodFrom || x?.periodTo || x?.executiveSummary)) {
    const ragRaw = safeStr(x?.rag).toLowerCase();
    const rag: Rag = ragRaw === "red" ? "red" : ragRaw === "amber" ? "amber" : "green";
    const deliveredRows = Array.isArray(x?.completedThisPeriod?.rows) ? x.completedThisPeriod.rows : [];
    const focusRows = Array.isArray(x?.nextPeriodFocus?.rows) ? x.nextPeriodFocus.rows : [];
    const delivered = deliveredRows.filter((r: any) => r?.type === "data").map((r: any) => safeStr((r?.cells ?? [])[0] ?? "")).filter(Boolean).map((t: string) => ({ text: t }));
    const planNextWeek = focusRows.filter((r: any) => r?.type === "data").map((r: any) => safeStr((r?.cells ?? [])[0] ?? "")).filter(Boolean).map((t: string) => ({ text: t }));
    const blockersText = safeStr(x?.operationalBlockers || "");
    const blockers = blockersText.split("\n").map((t: string) => safeStr(t)).filter(Boolean).map((t: string) => ({ text: t, link: null as string | null }));
    return {
      version: 1, project: extractedProject ?? fb.project,
      period: { from: safeStr(x?.periodFrom) || fb.period.from, to: safeStr(x?.periodTo) || fb.period.to },
      summary: { rag, headline: safeStr(x?.executiveSummary?.headline) || fb.summary.headline, narrative: safeStr(x?.executiveSummary?.narrative) || fb.summary.narrative },
      delivered, milestones: Array.isArray(x?.milestones) ? x.milestones : fb.milestones,
      changes: Array.isArray(x?.changes) ? x.changes : fb.changes,
      raid: Array.isArray(x?.raid) ? x.raid : fb.raid, planNextWeek,
      resourceSummary: Array.isArray(x?.resourceSummary) ? x.resourceSummary : fb.resourceSummary ?? [],
      keyDecisions: Array.isArray(x?.keyDecisions) ? x.keyDecisions : fb.keyDecisions ?? [],
      blockers, metrics: x?.metrics && typeof x.metrics === "object" ? x.metrics : fb.metrics,
      meta: x?.meta && typeof x.meta === "object" ? x.meta : fb.meta,
    };
  }

  // delivery_report model
  if (x?.version === 1 && x?.period && x?.sections) {
    const sec = x.sections || {};
    const exec = sec.executive_summary || {};
    const completed = Array.isArray(sec.completed_this_period) ? sec.completed_this_period : [];
    const nextFocus = Array.isArray(sec.next_period_focus) ? sec.next_period_focus : [];
    const resource = Array.isArray(sec.resource_summary) ? sec.resource_summary : [];
    const decisions = Array.isArray(sec.key_decisions_taken) ? sec.key_decisions_taken : [];
    const blockersArr = Array.isArray(sec.operational_blockers) ? sec.operational_blockers : [];
    const delivered = completed.map((it: any) => safeStr(it?.text || it?.title || it)).filter(Boolean).map((t: string) => ({ text: t }));
    const planNextWeek = nextFocus.map((it: any) => safeStr(it?.text || it?.title || it)).filter(Boolean).map((t: string) => ({ text: t }));
    const resourceSummary = resource.map((it: any) => safeStr(it?.text || it?.title || it)).filter(Boolean).map((t: string) => ({ text: t }));
    const keyDecisions = decisions.map((it: any) => { const text = safeStr(it?.text || it?.title || it); if (!text) return null; return { text, link: safeStr(it?.link).trim() || null }; }).filter(Boolean) as Array<{ text: string; link?: string | null }>;
    const operationalBlockers = blockersArr.map((it: any) => { const text = safeStr(it?.text || it?.title || it); if (!text) return null; return { text, link: safeStr(it?.link).trim() || null }; }).filter(Boolean) as Array<{ text: string; link?: string | null }>;
    const ragRaw = safeStr(exec?.rag).toLowerCase();
    const rag: Rag = ragRaw === "red" ? "red" : ragRaw === "amber" ? "amber" : "green";
    return {
      version: 1, project: extractedProject ?? fb.project,
      period: { from: safeStr(x?.period?.from) || fb.period.from, to: safeStr(x?.period?.to) || fb.period.to },
      summary: { rag, headline: safeStr(exec?.headline) || "Weekly delivery update", narrative: safeStr(exec?.narrative) || "Summary of progress, risks, and next steps." },
      delivered, planNextWeek, resourceSummary, keyDecisions, blockers: operationalBlockers,
      milestones: Array.isArray(x?.lists?.milestones) ? x.lists.milestones : fb.milestones,
      changes: Array.isArray(x?.lists?.changes) ? x.lists.changes : fb.changes,
      raid: Array.isArray(x?.lists?.raid) ? x.lists.raid : fb.raid,
      metrics: x?.metrics && typeof x.metrics === "object" ? x.metrics : fb.metrics,
      meta: x?.meta && typeof x.meta === "object" ? x.meta : fb.meta,
    };
  }

  // classic WeeklyReportV1
  if (x?.version === 1 && x?.period && x?.summary) {
    const v = x as WeeklyReportV1;
    return {
      ...v, project: extractProjectFromAny(v) ?? fb.project,
      delivered: Array.isArray(v.delivered) ? v.delivered : [], milestones: Array.isArray(v.milestones) ? v.milestones : [],
      changes: Array.isArray(v.changes) ? v.changes : [], raid: Array.isArray(v.raid) ? v.raid : [],
      planNextWeek: Array.isArray(v.planNextWeek) ? v.planNextWeek : [],
      resourceSummary: Array.isArray((v as any)?.resourceSummary) ? (v as any).resourceSummary : [],
      keyDecisions: Array.isArray((v as any)?.keyDecisions) ? (v as any).keyDecisions : [],
      blockers: Array.isArray((v as any)?.blockers) ? (v as any).blockers : [],
      metrics: v.metrics && typeof v.metrics === "object" ? v.metrics : {},
      meta: v.meta && typeof v.meta === "object" ? v.meta : {},
    };
  }
  return null;
}

async function downloadViaFetch(url: string, filename: string) {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try { const a = document.createElement("a"); a.href = objectUrl; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); } finally { URL.revokeObjectURL(objectUrl); }
}

/* ═══════════════════════════════════════════════════════════════
   DESIGN TOKENS
═══════════════════════════════════════════════════════════════ */

const RAG_CONFIG = {
  green: {
    bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700",
    dot: "bg-emerald-500", glow: "shadow-[0_0_0_1px_rgba(16,185,129,0.08)]",
    label: "On Track", ring: "ring-emerald-500/20",
  },
  amber: {
    bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700",
    dot: "bg-amber-500", glow: "shadow-[0_0_0_1px_rgba(245,158,11,0.08)]",
    label: "At Risk", ring: "ring-amber-500/20",
  },
  red: {
    bg: "bg-rose-50", border: "border-rose-200", text: "text-rose-700",
    dot: "bg-rose-500", glow: "shadow-[0_0_0_1px_rgba(244,63,94,0.08)]",
    label: "Critical", ring: "ring-rose-500/20",
  },
} as const;

function cx(...a: Array<string | false | null | undefined>) {
  return a.filter(Boolean).join(" ");
}

const INPUT_CLS =
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-900 placeholder-gray-400 outline-none transition-all focus:border-gray-400 focus:ring-2 focus:ring-gray-200 disabled:bg-gray-50 disabled:text-gray-500";

/* ═══════════════════════════════════════════════════════════════
   ICONS
═══════════════════════════════════════════════════════════════ */

const IconSpark = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v18M3 12h18M5.636 5.636l12.728 12.728M18.364 5.636L5.636 18.364" />
  </svg>
);

const IconSave = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </svg>
);

const IconPdf = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const IconPpt = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

const IconPlus = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const IconX = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const IconLink = () => (
  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
  </svg>
);

const Spinner = ({ className }: { className?: string }) => (
  <svg className={cx("animate-spin", className || "w-4 h-4")} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
    <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════ */

export default function WeeklyReportEditor({
  projectId,
  artifactId,
  initialJson,
  readOnly,
  updateArtifactJsonAction,
}: {
  projectId: string;
  artifactId: string;
  initialJson: any;
  readOnly: boolean;
  updateArtifactJsonAction?: (args: UpdateArtifactJsonArgs) => Promise<UpdateArtifactJsonResult>;
}) {
  const seed = useMemo<WeeklyReportV1>(() => {
    const parsed = parseMaybeJson(initialJson);
    const coerced = normalizeWeeklyReportV1(parsed, defaultModel());
    return coerced ?? defaultModel();
  }, [initialJson]);

  const [model, setModel] = useState<WeeklyReportV1>(seed);
  const [busyGen, setBusyGen] = useState(false);
  const [busySave, setBusySave] = useState(false);
  const [busyPdf, setBusyPdf] = useState(false);
  const [busyPpt, setBusyPpt] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const initialSnapshot = useRef<string>(JSON.stringify(seed));
  const lastArtifactIdRef = useRef<string>("");

  // Hard reset on artifact switch
  useEffect(() => {
    if (artifactId && lastArtifactIdRef.current && lastArtifactIdRef.current !== artifactId) {
      setModel(seed);
      initialSnapshot.current = JSON.stringify(seed);
      setErr(null);
      setSaveMsg(null);
    }
    lastArtifactIdRef.current = artifactId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactId, seed]);

  // Soft rehydrate when seed changes AND not dirty
  useEffect(() => {
    const isDirty = JSON.stringify(model) !== initialSnapshot.current;
    if (!isDirty) {
      setModel(seed);
      initialSnapshot.current = JSON.stringify(seed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  const dirty = JSON.stringify(model) !== initialSnapshot.current;

  function setField(path: string, value: any) {
    setModel((prev) => {
      const next: any = { ...prev };
      const parts = path.split(".");
      let cur: any = next;
      for (let i = 0; i < parts.length - 1; i++) {
        const k = parts[i];
        cur[k] = cur[k] && typeof cur[k] === "object" ? { ...cur[k] } : {};
        cur = cur[k];
      }
      cur[parts[parts.length - 1]] = value;
      return next;
    });
  }

  /* ── Async handlers — identical logic to original ── */

  async function generate() {
    setErr(null); setSaveMsg(null); setBusyGen(true);
    try {
      const res = await fetch("/api/ai/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: "delivery_report",
          projectId,
          payload: { artifactId, period: model.period, windowDays: 7 },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Generate failed");

      const reportRaw = json?.report || json?.delivery_report || json?.ai?.report || json?.content_json;
      const report = normalizeWeeklyReportV1(parseMaybeJson(reportRaw), model);
      if (!report) throw new Error("Generator returned an unexpected payload shape.");

      const mergedProject: WeeklyReportProject = {
        ...(report.project ?? {}),
        id: (report.project?.id ?? safeStr(json?.project_id)) ?? null,
        code: (report.project?.code ?? safeStr(json?.project_code)) ?? null,
        name: (report.project?.name ?? safeStr(json?.project_name)) ?? null,
        managerName: (report.project?.managerName ?? safeStr(json?.project_manager_name)) ?? null,
        managerEmail: (report.project?.managerEmail ?? safeStr(json?.project_manager_email)) ?? null,
      };

      const generatedAt = new Date().toISOString();
      const nextModel: WeeklyReportV1 = {
        ...report,
        project: mergedProject,
        meta: {
          ...(report.meta ?? {}),
          generated_at: generatedAt,
          sources: {
            ...(report.meta?.sources ?? {}),
            snapshot: {
              period: report.period,
              rag: report.summary?.rag,
              milestones: Array.isArray(report.milestones)
                ? report.milestones.map((m) => ({
                    name: safeStr(m?.name),
                    due: safeStr(m?.due) || null,
                    status: safeStr(m?.status) || null,
                    critical: !!m?.critical,
                  }))
                : [],
            },
          },
        },
      };
      setModel(nextModel);
    } catch (e: any) {
      setErr(e?.message ?? "Generate failed");
    } finally {
      setBusyGen(false);
    }
  }

  async function save() {
    setErr(null); setSaveMsg(null);
    if (readOnly) return;
    if (!updateArtifactJsonAction) {
      setErr("Save action not wired. Pass updateArtifactJsonAction from the server host.");
      return;
    }
    setBusySave(true);
    try {
      const res = await updateArtifactJsonAction({ artifactId, projectId, contentJson: model });
      if (!res?.ok) throw new Error(res?.error || "Save failed");
      initialSnapshot.current = JSON.stringify(model);
      setSaveMsg("Saved.");
    } catch (e: any) {
      setErr(e?.message ?? "Save failed");
    } finally {
      setBusySave(false);
    }
  }

  async function exportPdf() {
    setErr(null); setSaveMsg(null); setBusyPdf(true);
    try {
      const url = `/api/artifacts/weekly-report/export/pdf?projectId=${encodeURIComponent(projectId)}&artifactId=${encodeURIComponent(artifactId)}&includeDraft=1`;
      const fn = `Weekly Report - ${safeStr(model.project?.code) || "Project"} - ${model.period.from}_to_${model.period.to}.pdf`;
      await downloadViaFetch(url, fn);
    } catch (e: any) {
      setErr(e?.message ?? "PDF export failed");
    } finally {
      setBusyPdf(false);
    }
  }

  async function exportPpt() {
    setErr(null); setSaveMsg(null); setBusyPpt(true);
    try {
      const url = `/api/artifacts/weekly-report/export/ppt?projectId=${encodeURIComponent(projectId)}&artifactId=${encodeURIComponent(artifactId)}&includeDraft=1`;
      const fn = `Weekly Report - ${safeStr(model.project?.code) || "Project"} - ${model.period.from}_to_${model.period.to}.pptx`;
      await downloadViaFetch(url, fn);
    } catch (e: any) {
      setErr(e?.message ?? "PPT export failed");
    } finally {
      setBusyPpt(false);
    }
  }

  /* ── Derived display values ── */

  const rag = RAG_CONFIG[model.summary.rag];
  const periodUk = `${fmtUkDate(model.period.from)} \u2014 ${fmtUkDate(model.period.to)}`;
  const projName = safeStr(model.project?.name);
  const projCode = safeStr(model.project?.code);
  const pmName = safeStr(model.project?.managerName);

  /* ═══════════════════════════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════════════════════════ */

  return (
    <div className="min-h-screen bg-[#fafaf9]">

      {/* ── STICKY HEADER ── */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-gray-200/60">
        <div className="max-w-5xl mx-auto px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">

            {/* Left: Title cluster */}
            <div className="flex items-center gap-4 min-w-0">
              {/* RAG indicator */}
              <div className={cx(
                "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                "ring-2", rag.ring, rag.bg,
              )}>
                <div className={cx("w-3 h-3 rounded-full", rag.dot)} />
              </div>

              <div className="min-w-0">
                <h1 className="text-[15px] font-semibold text-gray-900 tracking-tight truncate">
                  Weekly Report
                </h1>
                <div className="flex items-center gap-2 text-[12px] text-gray-500">
                  <span className="font-mono">{periodUk}</span>
                  {projCode && (
                    <>
                      <span className="text-gray-300">&middot;</span>
                      <span className="font-medium text-gray-600">{projCode}</span>
                    </>
                  )}
                  {dirty && (
                    <>
                      <span className="text-gray-300">&middot;</span>
                      <span className="text-amber-600 font-medium">Unsaved</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2">
              <ActionBtn icon={<IconPdf />} label="PDF" busy={busyPdf} onClick={exportPdf} />
              <ActionBtn icon={<IconPpt />} label="PPT" busy={busyPpt} onClick={exportPpt} />
              <div className="w-px h-6 bg-gray-200 mx-1" />
              <ActionBtn
                icon={busyGen ? <Spinner /> : <IconSpark />}
                label={busyGen ? "Generating\u2026" : "Generate"}
                busy={busyGen}
                onClick={generate}
                disabled={readOnly || busyGen}
                accent
              />
              <ActionBtn
                icon={busySave ? <Spinner /> : <IconSave />}
                label={busySave ? "Saving\u2026" : "Save"}
                busy={busySave}
                onClick={save}
                disabled={readOnly || busySave || !dirty}
                primary
              />
            </div>
          </div>
        </div>
      </header>

      {/* ── CONTENT ── */}
      <main className="max-w-5xl mx-auto px-6 lg:px-8 py-8 space-y-6">

        {/* Banners */}
        {err && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-rose-50 border border-rose-200 text-[13px] text-rose-700">
            <span className="w-5 h-5 rounded-full bg-rose-500 text-white flex items-center justify-center text-[10px] font-bold shrink-0">!</span>
            <span className="flex-1">{err}</span>
            <button onClick={() => setErr(null)} className="p-1 rounded-md hover:bg-rose-100 transition-colors"><IconX /></button>
          </div>
        )}
        {saveMsg && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[13px] text-emerald-700">
            <span className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[10px] font-bold shrink-0">&check;</span>
            <span className="flex-1">{saveMsg}</span>
            <button onClick={() => setSaveMsg(null)} className="p-1 rounded-md hover:bg-emerald-100 transition-colors"><IconX /></button>
          </div>
        )}

        {/* ── Project meta + Period + RAG ── */}
        <Card>
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="space-y-3 flex-1 min-w-0">
              {(projName || pmName) && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                  {projName && (
                    <span><span className="text-gray-400">Project</span>{" "}<span className="font-medium text-gray-800">{projName}</span></span>
                  )}
                  {pmName && (
                    <span><span className="text-gray-400">PM</span>{" "}<span className="font-medium text-gray-800">{pmName}</span></span>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <FieldLabel label="Period from">
                  <input type="date" value={model.period.from} onChange={(e) => setField("period.from", e.target.value)} disabled={readOnly} className={INPUT_CLS} />
                </FieldLabel>
                <FieldLabel label="Period to">
                  <input type="date" value={model.period.to} onChange={(e) => setField("period.to", e.target.value)} disabled={readOnly} className={INPUT_CLS} />
                </FieldLabel>
                <FieldLabel label="RAG Status">
                  <select value={model.summary.rag} onChange={(e) => setField("summary.rag", e.target.value as Rag)} disabled={readOnly} className={INPUT_CLS}>
                    <option value="green">Green &mdash; On Track</option>
                    <option value="amber">Amber &mdash; At Risk</option>
                    <option value="red">Red &mdash; Critical</option>
                  </select>
                </FieldLabel>
              </div>
            </div>

            {/* RAG badge */}
            <div className={cx(
              "shrink-0 px-4 py-3 rounded-xl border flex flex-col items-center gap-1.5 min-w-[100px]",
              rag.bg, rag.border, rag.glow,
            )}>
              <div className={cx("w-4 h-4 rounded-full", rag.dot)} />
              <span className={cx("text-[11px] font-bold uppercase tracking-wider", rag.text)}>{rag.label}</span>
            </div>
          </div>
        </Card>

        {/* ── Executive Summary ── */}
        <Card>
          <SectionHeader number={1} title="Executive Summary" />
          <div className="mt-4 space-y-3">
            <FieldLabel label="Headline">
              <input
                value={model.summary.headline}
                onChange={(e) => setField("summary.headline", e.target.value)}
                disabled={readOnly}
                className={INPUT_CLS}
                placeholder="One-line headline"
              />
            </FieldLabel>
            <FieldLabel label="Narrative">
              <textarea
                value={model.summary.narrative}
                onChange={(e) => setField("summary.narrative", e.target.value)}
                disabled={readOnly}
                className={cx(INPUT_CLS, "min-h-[120px] resize-y")}
                placeholder="What happened this week \u2014 highlights, blockers, decisions."
              />
            </FieldLabel>
          </div>
        </Card>

        {/* ── Delivered + Next Period ── */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <SectionHeader number={2} title="Completed This Period" count={model.delivered.length} color="emerald" />
            <SectionList
              items={model.delivered.map((x) => x.text)}
              readOnly={readOnly}
              onChange={(items) => setModel((p) => ({ ...p, delivered: items.map((t) => ({ text: t })) }))}
              placeholder="What was delivered\u2026"
            />
          </Card>
          <Card>
            <SectionHeader number={3} title="Next Period Focus" count={model.planNextWeek.length} color="blue" />
            <SectionList
              items={model.planNextWeek.map((x) => x.text)}
              readOnly={readOnly}
              onChange={(items) => setModel((p) => ({ ...p, planNextWeek: items.map((t) => ({ text: t })) }))}
              placeholder="What\u2019s planned next\u2026"
            />
          </Card>
        </div>

        {/* ── Resource + Decisions + Blockers ── */}
        <div className="grid gap-6 md:grid-cols-3">
          <Card>
            <SectionHeader number={4} title="Resources" count={(model.resourceSummary ?? []).length} color="violet" />
            <SectionList
              items={(model.resourceSummary ?? []).map((x) => x.text)}
              readOnly={readOnly}
              onChange={(items) => setModel((p) => ({ ...p, resourceSummary: items.map((t) => ({ text: t })) }))}
              placeholder="Resource note\u2026"
            />
          </Card>
          <Card>
            <SectionHeader number={5} title="Key Decisions" count={(model.keyDecisions ?? []).length} color="amber" />
            <SectionLinkList
              items={model.keyDecisions ?? []}
              readOnly={readOnly}
              onChange={(items) => setModel((p) => ({ ...p, keyDecisions: items }))}
              placeholderText="Decision\u2026"
              placeholderLink="Link (optional)"
            />
          </Card>
          <Card>
            <SectionHeader number={6} title="Blockers" count={(model.blockers ?? []).length} color="rose" />
            <SectionLinkList
              items={model.blockers ?? []}
              readOnly={readOnly}
              onChange={(items) => setModel((p) => ({ ...p, blockers: items }))}
              placeholderText="Blocker\u2026"
              placeholderLink="Link (optional)"
            />
          </Card>
        </div>
      </main>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DESIGN PRIMITIVES
═══════════════════════════════════════════════════════════════ */

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      {children}
    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{label}</span>
      {children}
    </label>
  );
}

function SectionHeader({ number, title, count, color = "gray" }: { number: number; title: string; count?: number; color?: string }) {
  const dotColor: Record<string, string> = {
    emerald: "bg-emerald-500", blue: "bg-blue-500", violet: "bg-violet-500",
    amber: "bg-amber-500", rose: "bg-rose-500", gray: "bg-gray-400",
  };

  return (
    <div className="flex items-center gap-3">
      <div className={cx("w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-bold text-white", dotColor[color] || dotColor.gray)}>
        {number}
      </div>
      <h2 className="text-[14px] font-semibold text-gray-900 tracking-tight">{title}</h2>
      {count != null && (
        <span className="ml-auto px-2 py-0.5 rounded-full bg-gray-100 text-[11px] font-semibold text-gray-500 tabular-nums">
          {count}
        </span>
      )}
    </div>
  );
}

function ActionBtn({
  icon, label, busy, onClick, disabled, primary, accent,
}: {
  icon: React.ReactNode; label: string; busy?: boolean; onClick: () => void;
  disabled?: boolean; primary?: boolean; accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={cx(
        "inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        primary
          ? "bg-gray-900 text-white hover:bg-gray-800 shadow-sm"
          : accent
          ? "bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100"
          : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 shadow-sm",
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════
   LIST COMPONENTS — logic unchanged, design upgraded
═══════════════════════════════════════════════════════════════ */

function SectionList({
  items, readOnly, onChange, placeholder,
}: {
  items: string[]; readOnly: boolean; onChange: (items: string[]) => void; placeholder: string;
}) {
  return (
    <div className="mt-4 space-y-2">
      {items.length === 0 && (
        <div className="py-6 text-center">
          <p className="text-[13px] text-gray-400">No items yet</p>
        </div>
      )}

      {items.map((t, idx) => (
        <div key={idx} className="group flex items-start gap-2">
          <span className="mt-2.5 w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />
          <input
            value={t}
            readOnly={readOnly}
            onChange={(e) => { const next = items.slice(); next[idx] = e.target.value; onChange(next); }}
            className={cx(INPUT_CLS, "flex-1")}
            placeholder={placeholder}
          />
          {!readOnly && (
            <button
              type="button"
              onClick={() => onChange(items.filter((_, i) => i !== idx))}
              className="mt-1.5 p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
              title="Remove"
            >
              <IconX />
            </button>
          )}
        </div>
      ))}

      {!readOnly && (
        <button
          type="button"
          onClick={() => onChange(items.concat([""]))}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-all"
        >
          <IconPlus /> Add item
        </button>
      )}
    </div>
  );
}

function SectionLinkList({
  items, readOnly, onChange, placeholderText, placeholderLink,
}: {
  items: Array<{ text: string; link?: string | null }>; readOnly: boolean;
  onChange: (items: Array<{ text: string; link?: string | null }>) => void;
  placeholderText: string; placeholderLink: string;
}) {
  const safeItems = Array.isArray(items) ? items : [];

  return (
    <div className="mt-4 space-y-3">
      {safeItems.length === 0 && (
        <div className="py-6 text-center">
          <p className="text-[13px] text-gray-400">No items yet</p>
        </div>
      )}

      {safeItems.map((it, idx) => (
        <div key={idx} className="group space-y-1.5 p-3 rounded-xl bg-gray-50/60 border border-gray-100 hover:border-gray-200 transition-colors">
          <div className="flex items-start gap-2">
            <input
              value={it.text}
              readOnly={readOnly}
              onChange={(e) => { const next = safeItems.slice(); next[idx] = { ...next[idx], text: e.target.value }; onChange(next); }}
              className={cx(INPUT_CLS, "flex-1 bg-white")}
              placeholder={placeholderText}
            />
            {!readOnly && (
              <button
                type="button"
                onClick={() => onChange(safeItems.filter((_, i) => i !== idx))}
                className="mt-1.5 p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                title="Remove"
              >
                <IconX />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-gray-400 shrink-0"><IconLink /></span>
            <input
              value={safeStr(it.link)}
              readOnly={readOnly}
              onChange={(e) => {
                const next = safeItems.slice();
                const v = safeStr(e.target.value) || null;
                next[idx] = { ...next[idx], link: v };
                onChange(next);
              }}
              className={cx(INPUT_CLS, "flex-1 bg-white text-[12px]")}
              placeholder={placeholderLink}
            />
          </div>

          {it.link && (
            <div className="pl-5">
              <a
                className="inline-flex items-center gap-1 text-[11px] text-violet-600 hover:text-violet-800 hover:underline font-medium transition-colors"
                href={it.link}
                target="_blank"
                rel="noreferrer"
              >
                <IconLink /> Open link
              </a>
            </div>
          )}
        </div>
      ))}

      {!readOnly && (
        <button
          type="button"
          onClick={() => onChange(safeItems.concat([{ text: "", link: null }]))}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-all"
        >
          <IconPlus /> Add item
        </button>
      )}
    </div>
  );
}