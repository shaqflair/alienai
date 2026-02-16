import { WeeklyReportV1, WeeklyReportProject, Rag } from "./types";

function safeStr(x: any) {
  return String(x ?? "").trim();
}

function isIsoYmd(x: any) {
  return typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.trim());
}

function isoDate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function defaultWeeklyReportModel(): WeeklyReportV1 {
  const to = new Date();
  const from = new Date(to.getTime() - 6 * 24 * 60 * 60 * 1000);
  return {
    version: 1,
    project: { id: null, code: null, name: null, managerName: null, managerEmail: null },
    period: { from: isoDate(from), to: isoDate(to) },
    summary: { rag: "green", headline: "Weekly delivery update", narrative: "Summary of progress, risks, and next steps." },
    delivered: [],
    planNextWeek: [],
    resourceSummary: [],
    keyDecisions: [],
    blockers: [],
    milestones: [],
    changes: [],
    raid: [],
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

function extractProjectFromAny(x: any): WeeklyReportProject | null {
  if (!x || typeof x !== "object") return null;

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

export function normalizeWeeklyReportV1(input: any, fallback?: WeeklyReportV1): WeeklyReportV1 {
  const fb = fallback ?? defaultWeeklyReportModel();
  const x = parseMaybeJson(input);
  if (!x || typeof x !== "object") return fb;

  const extractedProject = extractProjectFromAny(x) ?? fb.project ?? null;

  // delivery_report shape (your generator): { version:1, period, sections, lists }
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

    const blockerItems = blockers
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
        from: isIsoYmd(x?.period?.from) ? x.period.from : fb.period.from,
        to: isIsoYmd(x?.period?.to) ? x.period.to : fb.period.to,
      },
      summary: {
        rag,
        headline: safeStr(exec?.headline) || fb.summary.headline,
        narrative: safeStr(exec?.narrative) || fb.summary.narrative,
      },
      delivered,
      planNextWeek,
      resourceSummary,
      keyDecisions,
      blockers: blockerItems,
      milestones: Array.isArray(x?.lists?.milestones) ? x.lists.milestones : fb.milestones,
      changes: Array.isArray(x?.lists?.changes) ? x.lists.changes : fb.changes,
      raid: Array.isArray(x?.lists?.raid) ? x.lists.raid : fb.raid,
      metrics: x?.metrics && typeof x.metrics === "object" ? x.metrics : fb.metrics,
      meta: x?.meta && typeof x.meta === "object" ? x.meta : fb.meta,
    };
  }

  // already WeeklyReportV1
  if (x?.version === 1 && x?.period && x?.summary) {
    const v = x as WeeklyReportV1;
    return {
      ...fb,
      ...v,
      project: extractProjectFromAny(v) ?? fb.project,
      delivered: Array.isArray(v.delivered) ? v.delivered : [],
      planNextWeek: Array.isArray(v.planNextWeek) ? v.planNextWeek : [],
      resourceSummary: Array.isArray(v.resourceSummary) ? v.resourceSummary : [],
      keyDecisions: Array.isArray(v.keyDecisions) ? v.keyDecisions : [],
      blockers: Array.isArray(v.blockers) ? v.blockers : [],
      milestones: Array.isArray(v.milestones) ? v.milestones : [],
      changes: Array.isArray(v.changes) ? v.changes : [],
      raid: Array.isArray(v.raid) ? v.raid : [],
      metrics: v.metrics && typeof v.metrics === "object" ? v.metrics : {},
      meta: v.meta && typeof v.meta === "object" ? v.meta : {},
    };
  }

  return fb;
}
