"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Rag = "green" | "amber" | "red";

type WeeklyReportProject = {
  id?: string | null; // UUID
  code?: string | null; // project_code
  name?: string | null; // project title
  managerName?: string | null; // PM display name
  managerEmail?: string | null; // optional
};

type WeeklyReportV1 = {
  version: 1;

  // ? NEW (safe optional, backward compatible)
  project?: WeeklyReportProject;

  period: { from: string; to: string }; // ISO (YYYY-MM-DD)
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
  // Interpret as UTC midnight to avoid timezone shifts
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
    project: {
      id: null,
      code: null,
      name: null,
      managerName: null,
      managerEmail: null,
    },
    period: { from: isoDate(from), to: isoDate(to) },
    summary: {
      rag: "green",
      headline: "Weekly delivery update",
      narrative: "Summary of progress, risks, and next steps.",
    },
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
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Extract project meta from various places (backwards compatible) */
function extractProjectFromAny(x: any): WeeklyReportProject | null {
  if (!x || typeof x !== "object") return null;

  // 1) New canonical home
  const p0 = x?.project;
  if (p0 && typeof p0 === "object") {
    const out: WeeklyReportProject = {
      id: safeStr(p0.id) || null,
      code: safeStr(p0.code) || null,
      name: safeStr(p0.name) || null,
      managerName: safeStr(p0.managerName) || null,
      managerEmail: safeStr(p0.managerEmail) || null,
    };
    if (out.id || out.code || out.name || out.managerName || out.managerEmail) return out;
  }

  // 2) delivery_report meta.sources.project (future generator change)
  const sp = x?.meta?.sources?.project;
  if (sp && typeof sp === "object") {
    const pm = sp?.pm && typeof sp.pm === "object" ? sp.pm : null;
    const out: WeeklyReportProject = {
      id: safeStr(sp.id) || null,
      code: safeStr(sp.code) || safeStr(sp.project_code) || null,
      name: safeStr(sp.name) || safeStr(sp.project_name) || null,
      managerName: safeStr(pm?.name) || safeStr(sp.managerName) || null,
      managerEmail: safeStr(pm?.email) || safeStr(sp.managerEmail) || null,
    };
    if (out.id || out.code || out.name || out.managerName || out.managerEmail) return out;
  }

  // 3) Some APIs might return project info at top level
  const out: WeeklyReportProject = {
    id: safeStr(x?.project_id) || null,
    code: safeStr(x?.project_code) || null,
    name: safeStr(x?.project_name) || null,
    managerName: safeStr(x?.project_manager_name) || null,
    managerEmail: safeStr(x?.project_manager_email) || null,
  };
  if (out.id || out.code || out.name || out.managerName || out.managerEmail) return out;

  return null;
}

/**
 * Normalizes a variety of incoming shapes into WeeklyReportV1:
 * 1) "delivery_report" model (your generator)
 * 2) WeeklyReportV1 itself
 * 3) "weekly_report" style: { type:'weekly_report', periodFrom, periodTo, rag, executiveSummary, ... }
 */
function normalizeWeeklyReportV1(x: any, fallback?: WeeklyReportV1): WeeklyReportV1 | null {
  const fb = fallback ?? defaultModel();
  if (!x || typeof x !== "object") return null;

  const extractedProject = extractProjectFromAny(x) ?? fb.project ?? null;

  // ---------------------------------------------------------------------------
  // 3) weekly_report doc style
  // ---------------------------------------------------------------------------
  if (
    (x?.type === "weekly_report" || x?.type === "weeklyreport") &&
    (x?.periodFrom || x?.periodTo || x?.executiveSummary)
  ) {
    const ragRaw = safeStr(x?.rag).toLowerCase();
    const rag: Rag = ragRaw === "red" ? "red" : ragRaw === "amber" ? "amber" : "green";

    const deliveredRows = Array.isArray(x?.completedThisPeriod?.rows) ? x.completedThisPeriod.rows : [];
    const focusRows = Array.isArray(x?.nextPeriodFocus?.rows) ? x.nextPeriodFocus.rows : [];

    const delivered = deliveredRows
      .filter((r: any) => r?.type === "data")
      .map((r: any) => safeStr((r?.cells ?? [])[0] ?? ""))
      .filter(Boolean)
      .map((t: string) => ({ text: t }));

    const planNextWeek = focusRows
      .filter((r: any) => r?.type === "data")
      .map((r: any) => safeStr((r?.cells ?? [])[0] ?? ""))
      .filter(Boolean)
      .map((t: string) => ({ text: t }));

    const blockersText = safeStr(x?.operationalBlockers || "");
    const blockers = blockersText
      .split("\n")
      .map((t) => safeStr(t))
      .filter(Boolean)
      .map((t) => ({ text: t, link: null as string | null }));

    return {
      version: 1,
      project: extractedProject ?? fb.project,
      period: {
        from: safeStr(x?.periodFrom) || fb.period.from,
        to: safeStr(x?.periodTo) || fb.period.to,
      },
      summary: {
        rag,
        headline: safeStr(x?.executiveSummary?.headline) || fb.summary.headline,
        narrative: safeStr(x?.executiveSummary?.narrative) || fb.summary.narrative,
      },
      delivered,
      milestones: Array.isArray(x?.milestones) ? x.milestones : fb.milestones,
      changes: Array.isArray(x?.changes) ? x.changes : fb.changes,
      raid: Array.isArray(x?.raid) ? x.raid : fb.raid,
      planNextWeek,
      resourceSummary: Array.isArray(x?.resourceSummary) ? x.resourceSummary : fb.resourceSummary ?? [],
      keyDecisions: Array.isArray(x?.keyDecisions) ? x.keyDecisions : fb.keyDecisions ?? [],
      blockers,
      metrics: x?.metrics && typeof x.metrics === "object" ? x.metrics : fb.metrics,
      meta: x?.meta && typeof x.meta === "object" ? x.meta : fb.meta,
    };
  }

  // ---------------------------------------------------------------------------
  // 1) delivery_report model -> WeeklyReportV1
  // ---------------------------------------------------------------------------
  if (x?.version === 1 && x?.period && x?.sections) {
    const sec = x.sections || {};
    const exec = sec.executive_summary || {};

    const completed = Array.isArray(sec.completed_this_period) ? sec.completed_this_period : [];
    const nextFocus = Array.isArray(sec.next_period_focus) ? sec.next_period_focus : [];
    const resource = Array.isArray(sec.resource_summary) ? sec.resource_summary : [];
    const decisions = Array.isArray(sec.key_decisions_taken) ? sec.key_decisions_taken : [];
    const blockers = Array.isArray(sec.operational_blockers) ? sec.operational_blockers : [];

    const delivered = completed
      .map((it: any) => safeStr(it?.text || it?.title || it))
      .filter(Boolean)
      .map((t: string) => ({ text: t }));

    const planNextWeek = nextFocus
      .map((it: any) => safeStr(it?.text || it?.title || it))
      .filter(Boolean)
      .map((t: string) => ({ text: t }));

    const resourceSummary = resource
      .map((it: any) => safeStr(it?.text || it?.title || it))
      .filter(Boolean)
      .map((t: string) => ({ text: t }));

    const keyDecisions = decisions
      .map((it: any) => {
        const text = safeStr(it?.text || it?.title || it);
        if (!text) return null;
        const link = safeStr(it?.link).trim() || null;
        return { text, link };
      })
      .filter(Boolean) as Array<{ text: string; link?: string | null }>;

    const operationalBlockers = blockers
      .map((it: any) => {
        const text = safeStr(it?.text || it?.title || it);
        if (!text) return null;
        const link = safeStr(it?.link).trim() || null;
        return { text, link };
      })
      .filter(Boolean) as Array<{ text: string; link?: string | null }>;

    const ragRaw = safeStr(exec?.rag).toLowerCase();
    const rag: Rag = ragRaw === "red" ? "red" : ragRaw === "amber" ? "amber" : "green";

    return {
      version: 1,
      project: extractedProject ?? fb.project,
      period: {
        from: safeStr(x?.period?.from) || fb.period.from,
        to: safeStr(x?.period?.to) || fb.period.to,
      },
      summary: {
        rag,
        headline: safeStr(exec?.headline) || "Weekly delivery update",
        narrative: safeStr(exec?.narrative) || "Summary of progress, risks, and next steps.",
      },
      delivered,
      planNextWeek,
      resourceSummary,
      keyDecisions,
      blockers: operationalBlockers,

      milestones: Array.isArray(x?.lists?.milestones) ? x.lists.milestones : fb.milestones,
      changes: Array.isArray(x?.lists?.changes) ? x.lists.changes : fb.changes,
      raid: Array.isArray(x?.lists?.raid) ? x.lists.raid : fb.raid,

      metrics: x?.metrics && typeof x.metrics === "object" ? x.metrics : fb.metrics,
      meta: x?.meta && typeof x.meta === "object" ? x.meta : fb.meta,
    };
  }

  // ---------------------------------------------------------------------------
  // 2) classic WeeklyReportV1 directly
  // ---------------------------------------------------------------------------
  if (x?.version === 1 && x?.period && x?.summary) {
    const v = x as WeeklyReportV1;
    return {
      ...v,
      project: extractProjectFromAny(v) ?? fb.project,
      delivered: Array.isArray(v.delivered) ? v.delivered : [],
      milestones: Array.isArray(v.milestones) ? v.milestones : [],
      changes: Array.isArray(v.changes) ? v.changes : [],
      raid: Array.isArray(v.raid) ? v.raid : [],
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
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

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
  // ? Build a *stable* seed from initialJson (supports object or JSON string)
  const seed = useMemo<WeeklyReportV1>(() => {
    const parsed = parseMaybeJson(initialJson);
    const coerced = normalizeWeeklyReportV1(parsed, defaultModel());
    return coerced ?? defaultModel();
  }, [initialJson]);

  // ? Use seed only on first mount; we’ll re-seed via effects below
  const [model, setModel] = useState<WeeklyReportV1>(seed);

  const [busyGen, setBusyGen] = useState(false);
  const [busySave, setBusySave] = useState(false);
  const [busyPdf, setBusyPdf] = useState(false);
  const [busyPpt, setBusyPpt] = useState(false);

  const [err, setErr] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // ? Dirty tracking snapshot (resets when we accept new seed)
  const initialSnapshot = useRef<string>(JSON.stringify(seed));

  // ? Hard reset when switching artifacts (prevents “stuck on previous artifact”)
  const lastArtifactIdRef = useRef<string>("");
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

  // ? Soft rehydrate when seed changes AND we’re not dirty
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

  async function generate() {
    setErr(null);
    setSaveMsg(null);
    setBusyGen(true);
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

      // ? If API also returned project_name/code at top level, merge into report.project
      // ? FIX: avoid mixing ?? with || (Webpack / Next 16 syntax rule)
      const mergedProject: WeeklyReportProject = {
        ...(report.project ?? {}),
        id: (report.project?.id ?? safeStr(json?.project_id)) ?? null,
        code: (report.project?.code ?? safeStr(json?.project_code)) ?? null,
        name: (report.project?.name ?? safeStr(json?.project_name)) ?? null,
        managerName: (report.project?.managerName ?? safeStr(json?.project_manager_name)) ?? null,
        managerEmail: (report.project?.managerEmail ?? safeStr(json?.project_manager_email)) ?? null,
      };

      // ? NEW: store a snapshot for “compare to previous week” exports
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
      // do NOT overwrite initialSnapshot here (generated output is still unsaved)
    } catch (e: any) {
      setErr(e?.message ?? "Generate failed");
    } finally {
      setBusyGen(false);
    }
  }

  async function save() {
    setErr(null);
    setSaveMsg(null);

    if (readOnly) return;
    if (!updateArtifactJsonAction) {
      setErr("Save action not wired. Pass updateArtifactJsonAction from the server host (same as Charter pattern).");
      return;
    }

    setBusySave(true);
    try {
      const res = await updateArtifactJsonAction({
        artifactId,
        projectId,
        contentJson: model,
      });

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
    setErr(null);
    setSaveMsg(null);
    setBusyPdf(true);
    try {
      // ? includeDraft=1 (server can choose current json even if not “final”)
      const url = `/api/artifacts/weekly-report/export/pdf?projectId=${encodeURIComponent(
        projectId
      )}&artifactId=${encodeURIComponent(artifactId)}&includeDraft=1`;

      const fn = `Weekly Report - ${safeStr(model.project?.code) || "Project"} - ${model.period.from}_to_${model.period.to}.pdf`;
      await downloadViaFetch(url, fn);
    } catch (e: any) {
      setErr(e?.message ?? "PDF export failed");
    } finally {
      setBusyPdf(false);
    }
  }

  async function exportPpt() {
    setErr(null);
    setSaveMsg(null);
    setBusyPpt(true);
    try {
      // ? includeDraft=1
      const url = `/api/artifacts/weekly-report/export/ppt?projectId=${encodeURIComponent(
        projectId
      )}&artifactId=${encodeURIComponent(artifactId)}&includeDraft=1`;

      const fn = `Weekly Report - ${safeStr(model.project?.code) || "Project"} - ${model.period.from}_to_${model.period.to}.pptx`;
      await downloadViaFetch(url, fn);
    } catch (e: any) {
      setErr(e?.message ?? "PPT export failed");
    } finally {
      setBusyPpt(false);
    }
  }

  const ragCls =
    model.summary.rag === "green"
      ? "bg-emerald-50 border-emerald-200 text-emerald-900"
      : model.summary.rag === "amber"
      ? "bg-amber-50 border-amber-200 text-amber-900"
      : "bg-rose-50 border-rose-200 text-rose-900";

  const periodUk = `${fmtUkDate(model.period.from)} ? ${fmtUkDate(model.period.to)}`;

  const projName = safeStr(model.project?.name);
  const projCode = safeStr(model.project?.code);
  const pmName = safeStr(model.project?.managerName);
  const pmEmail = safeStr(model.project?.managerEmail);

  const hasProjLine = !!(projName || projCode || pmName || pmEmail);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="text-xl font-semibold">Weekly Report</div>

          {hasProjLine ? (
            <div className="text-xs text-gray-600">
              {projName || projCode ? (
                <span className="mr-2">
                  <span className="text-gray-500">Project:</span>{" "}
                  <span className="font-medium">
                    {projName || "—"}
                    {projCode ? <span className="text-gray-500"> ({projCode})</span> : null}
                  </span>
                </span>
              ) : null}
              {pmName || pmEmail ? (
                <span>
                  <span className="text-gray-500">PM:</span>{" "}
                  <span className="font-medium">
                    {pmName || "—"}
                    {pmEmail ? <span className="text-gray-500"> ({pmEmail})</span> : null}
                  </span>
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="text-xs text-gray-500">
            Period: <span className="font-medium">{periodUk}</span>
            {dirty ? <span className="ml-2 text-amber-700">• Unsaved changes</span> : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${ragCls}`}>
            RAG: {model.summary.rag.toUpperCase()}
          </span>

          <button
            type="button"
            onClick={exportPdf}
            disabled={busyPdf}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            title="Export PDF"
          >
            {busyPdf ? "Exporting…" : "PDF"}
          </button>

          <button
            type="button"
            onClick={exportPpt}
            disabled={busyPpt}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            title="Export PowerPoint"
          >
            {busyPpt ? "Exporting…" : "PPT"}
          </button>

          <button
            type="button"
            onClick={generate}
            disabled={readOnly || busyGen}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            title="Auto-generate from last week activity (WBS/milestones/RAID/changes + due-soon focus)"
          >
            {busyGen ? "Generating…" : "Generate"}
          </button>

          <button
            type="button"
            onClick={save}
            disabled={readOnly || busySave || !dirty}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            title={!updateArtifactJsonAction ? "Save not wired (missing updateArtifactJsonAction)" : "Save report"}
          >
            {busySave ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {err ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{err}</div> : null}
      {saveMsg ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{saveMsg}</div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="grid gap-1">
          <span className="text-xs text-gray-600">From</span>
          <input
            type="date"
            value={model.period.from}
            onChange={(e) => setField("period.from", e.target.value)}
            disabled={readOnly}
            className="rounded-xl border px-3 py-2 text-sm"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-gray-600">To</span>
          <input
            type="date"
            value={model.period.to}
            onChange={(e) => setField("period.to", e.target.value)}
            disabled={readOnly}
            className="rounded-xl border px-3 py-2 text-sm"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-gray-600">RAG</span>
          <select
            value={model.summary.rag}
            onChange={(e) => setField("summary.rag", e.target.value as Rag)}
            disabled={readOnly}
            className="rounded-xl border px-3 py-2 text-sm"
          >
            <option value="green">Green</option>
            <option value="amber">Amber</option>
            <option value="red">Red</option>
          </select>
        </label>
      </div>

      <div className="rounded-2xl border p-4 space-y-3">
        <div className="font-medium">1) Executive Summary</div>

        <label className="grid gap-2">
          <span className="text-sm font-medium">Headline</span>
          <input
            value={model.summary.headline}
            onChange={(e) => setField("summary.headline", e.target.value)}
            disabled={readOnly}
            className="rounded-xl border px-3 py-2"
            placeholder="One-line headline"
          />
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium">Narrative</span>
          <textarea
            value={model.summary.narrative}
            onChange={(e) => setField("summary.narrative", e.target.value)}
            disabled={readOnly}
            className="rounded-xl border px-3 py-2"
            rows={4}
            placeholder="What happened this week, key highlights, blockers, decisions."
          />
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <SectionList
          title="2) Completed This Period"
          items={model.delivered.map((x) => x.text)}
          readOnly={readOnly}
          onChange={(items) => setModel((p) => ({ ...p, delivered: items.map((t) => ({ text: t })) }))}
          placeholder="Add completed item…"
        />
        <SectionList
          title="3) Next Period Focus"
          items={model.planNextWeek.map((x) => x.text)}
          readOnly={readOnly}
          onChange={(items) => setModel((p) => ({ ...p, planNextWeek: items.map((t) => ({ text: t })) }))}
          placeholder="Add focus item…"
        />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <SectionList
          title="4) Resource Summary"
          items={(model.resourceSummary ?? []).map((x) => x.text)}
          readOnly={readOnly}
          onChange={(items) => setModel((p) => ({ ...p, resourceSummary: items.map((t) => ({ text: t })) }))}
          placeholder="Add resource note…"
        />
        <SectionLinkList
          title="5) Key Decisions Taken"
          items={model.keyDecisions ?? []}
          readOnly={readOnly}
          onChange={(items) => setModel((p) => ({ ...p, keyDecisions: items }))}
          placeholderText="Decision text…"
          placeholderLink="(optional) link…"
        />
        <SectionLinkList
          title="6) Operational Blockers"
          items={model.blockers ?? []}
          readOnly={readOnly}
          onChange={(items) => setModel((p) => ({ ...p, blockers: items }))}
          placeholderText="Blocker text…"
          placeholderLink="(optional) link…"
        />
      </div>
    </div>
  );
}

function SectionList({
  title,
  items,
  readOnly,
  onChange,
  placeholder,
}: {
  title: string;
  items: string[];
  readOnly: boolean;
  onChange: (items: string[]) => void;
  placeholder: string;
}) {
  return (
    <div className="rounded-2xl border p-4 space-y-3">
      <div className="font-medium">{title}</div>

      <div className="space-y-2">
        {items.length === 0 ? <div className="text-sm text-gray-500">None yet.</div> : null}
        {items.map((t, idx) => (
          <div key={idx} className="flex gap-2">
            <input
              value={t}
              readOnly={readOnly}
              onChange={(e) => {
                const next = items.slice();
                next[idx] = e.target.value;
                onChange(next);
              }}
              className="flex-1 rounded-xl border px-3 py-2 text-sm"
              placeholder={placeholder}
            />
            {!readOnly ? (
              <button
                type="button"
                onClick={() => onChange(items.filter((_, i) => i !== idx))}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50"
                title="Remove"
              >
                ×
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {!readOnly ? (
        <button
          type="button"
          onClick={() => onChange(items.concat([""]))}
          className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50"
        >
          Add
        </button>
      ) : null}
    </div>
  );
}

function SectionLinkList({
  title,
  items,
  readOnly,
  onChange,
  placeholderText,
  placeholderLink,
}: {
  title: string;
  items: Array<{ text: string; link?: string | null }>;
  readOnly: boolean;
  onChange: (items: Array<{ text: string; link?: string | null }>) => void;
  placeholderText: string;
  placeholderLink: string;
}) {
  const safeItems = Array.isArray(items) ? items : [];

  return (
    <div className="rounded-2xl border p-4 space-y-3">
      <div className="font-medium">{title}</div>

      <div className="space-y-2">
        {safeItems.length === 0 ? <div className="text-sm text-gray-500">None yet.</div> : null}

        {safeItems.map((it, idx) => (
          <div key={idx} className="grid grid-cols-1 gap-2">
            <input
              value={it.text}
              readOnly={readOnly}
              onChange={(e) => {
                const next = safeItems.slice();
                next[idx] = { ...next[idx], text: e.target.value };
                onChange(next);
              }}
              className="rounded-xl border px-3 py-2 text-sm"
              placeholder={placeholderText}
            />

            <div className="flex gap-2">
              <input
                value={safeStr(it.link)}
                readOnly={readOnly}
                onChange={(e) => {
                  const next = safeItems.slice();
                  const v = safeStr(e.target.value) || null;
                  next[idx] = { ...next[idx], link: v };
                  onChange(next);
                }}
                className="flex-1 rounded-xl border px-3 py-2 text-sm"
                placeholder={placeholderLink}
              />
              {!readOnly ? (
                <button
                  type="button"
                  onClick={() => onChange(safeItems.filter((_, i) => i !== idx))}
                  className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50"
                  title="Remove"
                >
                  ×
                </button>
              ) : null}
            </div>

            {it.link ? (
              <div className="text-xs">
                <a className="text-indigo-600 hover:underline" href={it.link} target="_blank" rel="noreferrer">
                  Open link
                </a>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {!readOnly ? (
        <button
          type="button"
          onClick={() => onChange(safeItems.concat([{ text: "", link: null }]))}
          className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50"
        >
          Add
        </button>
      ) : null}
    </div>
  );
}
