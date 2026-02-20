// src/app/api/wireai/generate/route.ts
import "server-only";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RowObj = { type: "header" | "data"; cells: string[] };

type V2Section = {
  key: string;
  title: string;
  bullets?: string;
  table?: { columns: number; rows: RowObj[] };
};

type Patch =
  | { kind: "replace_all"; doc: any }
  | { kind: "replace_section"; key: string; section: V2Section }
  | { kind: "suggestions"; key: string; suggestions: { id: string; label: string; section: V2Section }[] }
  | {
      kind: "validate";
      issues: {
        key: string;
        severity: "info" | "warn" | "error";
        message: string;
        fix?: { kind: "replace_section"; key: string; section: V2Section };
      }[];
    };

/* =========================================================================================
   Weekly Report schema (kept as-is)
========================================================================================= */

type WeeklyRag = "green" | "amber" | "red";

type WeeklyExecutiveSummary = {
  headline: string;
  narrative: string;
};

type WeeklyReportDocV1 = {
  version: 1;
  type: "weekly_report";
  periodFrom: string; // YYYY-MM-DD
  periodTo: string; // YYYY-MM-DD
  rag: WeeklyRag;

  executiveSummary: WeeklyExecutiveSummary;

  completedThisPeriod: { columns: number; rows: RowObj[] };
  nextPeriodFocus: { columns: number; rows: RowObj[] };

  resourceSummary?: { columns: number; rows: RowObj[] } | null;

  keyDecisionsTaken: { columns: number; rows: RowObj[] };

  operationalBlockers: string; // bullets, one per line

  meta?: {
    previous?: {
      rag?: WeeklyRag;
      milestonesByName?: Record<string, { rag?: WeeklyRag }>;
    };
    dimensions?: {
      time?: WeeklyRag;
      scope?: WeeklyRag;
      cost?: WeeklyRag;
      quality?: WeeklyRag;
    };
    milestones?: Array<{ name: string; due?: string | null }>;
    [k: string]: any;
  };
};

function s(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function env(name: string) {
  const v = process.env[name];
  return typeof v === "string" ? v.trim() : "";
}

function mustEnv(name: string) {
  const v = env(name);
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function provider() {
  return (env("AI_PROVIDER") || "mock").toLowerCase();
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function clampStr(x: any, max = 20000) {
  const t = s(x);
  return t.length > max ? t.slice(0, max) : t;
}

function looksLikeYmd(x: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(x || "").trim());
}

function coerceRag(x: any): WeeklyRag {
  const v = s(x).trim().toLowerCase();
  if (v === "green" || v === "amber" || v === "red") return v;
  return "green";
}

function normalizeWeeklyBullets(x: any) {
  return clampStr(x);
}

function normalizeWeeklyTable(table: any, headers: string[], minDataRows = 2) {
  const cols = Math.max(1, headers.length);

  const out: { columns: number; rows: RowObj[] } = {
    columns: cols,
    rows: [
      { type: "header", cells: headers.map((h) => s(h)) },
      { type: "data", cells: Array.from({ length: cols }, () => "") },
      { type: "data", cells: Array.from({ length: cols }, () => "") },
    ],
  };

  if (!table || typeof table !== "object") return out;

  const rowsIn = Array.isArray((table as any).rows) ? (table as any).rows : [];
  const dataRows = rowsIn.filter((r: any) => r && r.type === "data");

  const colCount = Math.max(cols, Number((table as any).columns || 0) || cols);

  const mappedData = dataRows.map((r: any) => ({
    type: "data" as const,
    cells: Array.from({ length: colCount }, (_, i) => s((r.cells ?? [])[i] ?? "")),
  }));

  while (mappedData.length < minDataRows) {
    mappedData.push({ type: "data", cells: Array.from({ length: colCount }, () => "") });
  }

  out.columns = colCount;
  out.rows = [{ type: "header", cells: headers.map((h) => s(h)) }, ...mappedData];
  return out;
}

function normalizeWeeklyDoc(doc: any, fallback: { from: string; to: string; rag: WeeklyRag }): WeeklyReportDocV1 {
  const periodFrom = looksLikeYmd(s(doc?.periodFrom)) ? s(doc.periodFrom) : fallback.from;
  const periodTo = looksLikeYmd(s(doc?.periodTo)) ? s(doc.periodTo) : fallback.to;
  const rag = coerceRag(doc?.rag ?? fallback.rag);

  const executiveSummary: WeeklyExecutiveSummary = {
    headline: clampStr(doc?.executiveSummary?.headline ?? doc?.headline ?? "Weekly delivery update", 250),
    narrative: clampStr(doc?.executiveSummary?.narrative ?? doc?.narrative ?? "", 4000),
  };

  const completedThisPeriod = normalizeWeeklyTable(doc?.completedThisPeriod, ["Item", "Status", "Owner", "Notes"], 2);

  const nextPeriodFocus = normalizeWeeklyTable(doc?.nextPeriodFocus, ["Item", "Target Date", "Owner", "Notes"], 2);

  const resourceSummary =
    doc?.resourceSummary && typeof doc.resourceSummary === "object"
      ? normalizeWeeklyTable(doc.resourceSummary, ["Role / Team", "Capacity", "Risks / Notes"], 1)
      : null;

  const keyDecisionsTaken = normalizeWeeklyTable(doc?.keyDecisionsTaken, ["Decision", "Owner", "Date", "Notes"], 1);

  const operationalBlockers = normalizeWeeklyBullets(doc?.operationalBlockers ?? doc?.blockers ?? "");

  const metaIn = doc?.meta && typeof doc.meta === "object" ? doc.meta : undefined;

  return {
    version: 1,
    type: "weekly_report",
    periodFrom,
    periodTo,
    rag,
    executiveSummary,
    completedThisPeriod,
    nextPeriodFocus,
    resourceSummary,
    keyDecisionsTaken,
    operationalBlockers,
    ...(metaIn ? { meta: metaIn } : {}),
  };
}

/* =========================================================================================
   OPTIONAL enrichment (weekly) - kept as-is
========================================================================================= */

function isEarlier(aYmd: string, bYmd: string) {
  return aYmd && bYmd && aYmd < bYmd;
}

function pickLatestDocBeforePeriod(docs: WeeklyReportDocV1[], fromYmd: string) {
  const candidates = docs
    .filter((d) => looksLikeYmd(s(d?.periodTo)) && isEarlier(s(d.periodTo), fromYmd))
    .sort((a, b) => (s(a.periodTo) < s(b.periodTo) ? 1 : -1));
  return candidates[0] ?? null;
}

function tableFirstColBullets(table: { rows: RowObj[] } | null | undefined, max = 6) {
  const rows = Array.isArray(table?.rows) ? table!.rows : [];
  const data = rows.filter((r) => r?.type === "data");
  const out = data.map((r) => s((r.cells ?? [])[0] ?? "").trim()).filter(Boolean);
  return out.slice(0, max);
}

function computeTimeRagFromSchedule(scheduleJson: any, periodTo: string): WeeklyRag {
  const items = Array.isArray(scheduleJson?.items) ? scheduleJson.items : [];
  const milestones = items.filter((it: any) => s(it?.type).toLowerCase() === "milestone");

  const overdue = milestones.some((m: any) => {
    const due = s(m?.end || m?.due || m?.date || "").slice(0, 10);
    const status = s(m?.status).toLowerCase();
    if (!looksLikeYmd(due)) return false;
    const done = status === "done" || status === "completed";
    return !done && isEarlier(due, periodTo);
  });
  if (overdue) return "red";

  const toDt = new Date(`${periodTo}T00:00:00Z`);
  const soon = milestones.some((m: any) => {
    const due = s(m?.end || m?.due || m?.date || "").slice(0, 10);
    const status = s(m?.status).toLowerCase();
    if (!looksLikeYmd(due)) return false;
    const done = status === "done" || status === "completed";
    const dt = new Date(`${due}T00:00:00Z`);
    const diffDays = Math.floor((dt.getTime() - toDt.getTime()) / (24 * 3600 * 1000));
    const atRisk = status === "delayed" || status === "at_risk" || status === "blocked";
    return !done && diffDays >= 0 && diffDays <= 7 && atRisk;
  });
  if (soon) return "amber";

  return "green";
}

function computeScopeRagFromWbs(wbsJson: any): WeeklyRag {
  const items = Array.isArray(wbsJson?.items)
    ? wbsJson.items
    : Array.isArray(wbsJson?.workItems)
      ? wbsJson.workItems
      : [];
  if (!items.length) return "green";

  const blocked = items.filter((it: any) => s(it?.status).toLowerCase() === "blocked").length;
  const total = items.length;

  const ratio = total ? blocked / total : 0;
  if (ratio >= 0.25) return "red";
  if (ratio >= 0.1) return "amber";
  return "green";
}

async function loadProjectArtifacts(projectId: string) {
  const sb = await createClient();

  const { data, error } = await sb
    .from("artifacts")
    .select("id,type,content_json,updated_at")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

/* =========================================================================================
   Charter allowlist + normalize
========================================================================================= */

const CHARTER_REQUIRED_SECTIONS: Array<{
  key: string;
  title: string;
  kind: "bullets" | "table";
  headers?: string[];
}> = [
  { key: "business_case", title: "1. Business Case", kind: "bullets" },
  { key: "objectives", title: "2. Objectives", kind: "bullets" },
  { key: "scope_in_out", title: "3. Scope (In / Out of Scope)", kind: "table", headers: ["In Scope", "Out of Scope"] },
  { key: "key_deliverables", title: "4. Key Deliverables", kind: "bullets" },
  {
    key: "milestones_timeline",
    title: "5. Milestones & Timeline",
    kind: "table",
    headers: ["Milestone", "Target Date", "Actual Date", "Notes"],
  },
  { key: "financials", title: "6. Financials", kind: "table", headers: ["Item", "Amount", "Currency", "Notes"] },
  { key: "risks", title: "7. Risks", kind: "bullets" },
  { key: "issues", title: "8. Issues", kind: "bullets" },
  { key: "assumptions", title: "9. Assumptions", kind: "bullets" },
  { key: "dependencies", title: "10. Dependencies", kind: "bullets" },
  {
    key: "project_team",
    title: "11. Project Team",
    kind: "table",
    headers: ["Role", "Name", "Organisation", "Responsibilities / Notes"],
  },
  {
    key: "stakeholders",
    title: "12. Stakeholders",
    kind: "table",
    headers: ["Stakeholder", "Role/Interest", "Influence", "Engagement / Notes"],
  },
  {
    key: "approval_committee",
    title: "13. Approval / Review Committee",
    kind: "table",
    headers: ["Role", "Name", "Date", "Decision/Notes"],
  },
];

const CLOSURE_ALLOWED_KEYS = new Set<string>([
  "closure.health.summary",
  "closure.achievements",
  "closure.lessons.went_well",
  "closure.lessons.didnt_go_well",
  "closure.lessons.surprises_risks",
  "closure.recommendations",
]);

function isClosureKey(k: string) {
  return k.startsWith("closure.");
}

function buildSchemaHint() {
  return CHARTER_REQUIRED_SECTIONS.map((x) => ({
    key: x.key,
    title: x.title,
    kind: x.kind,
    headers: x.headers ?? null,
  }));
}

function requiredByKey() {
  const m = new Map<string, (typeof CHARTER_REQUIRED_SECTIONS)[number]>();
  for (const r of CHARTER_REQUIRED_SECTIONS) m.set(r.key, r);
  return m;
}

function normalizeTable(sectionKey: string, table: any): { columns: number; rows: RowObj[] } | null {
  const req = requiredByKey().get(sectionKey);
  if (!req || req.kind !== "table") return null;

  const headers = req.headers ?? [];
  const cols = Math.max(1, headers.length);

  const out: { columns: number; rows: RowObj[] } = {
    columns: cols,
    rows: [
      { type: "header", cells: headers.map((h) => s(h)) },
      { type: "data", cells: Array.from({ length: cols }, () => "") },
      { type: "data", cells: Array.from({ length: cols }, () => "") },
    ],
  };

  if (!table || typeof table !== "object") return out;

  const rowsIn = Array.isArray(table.rows) ? table.rows : [];
  const headerRow = rowsIn.find((r: any) => r && r.type === "header");
  const dataRows = rowsIn.filter((r: any) => r && r.type === "data");

  const headerCells =
    headerRow && Array.isArray(headerRow.cells) && headerRow.cells.length
      ? headerRow.cells.map((c: any) => s(c))
      : headers.map((h) => s(h));

  out.columns = Math.max(cols, Number(table.columns || 0) || cols, headerCells.length || cols);
  const colCount = out.columns;

  out.rows[0] = { type: "header", cells: headers.length ? headers.map((h) => s(h)) : headerCells.slice(0, colCount) };

  const mappedData = dataRows.map((r: any) => ({
    type: "data" as const,
    cells: Array.from({ length: colCount }, (_, i) => s((r.cells ?? [])[i] ?? "")),
  }));

  while (mappedData.length < 2) {
    mappedData.push({ type: "data", cells: Array.from({ length: colCount }, () => "") });
  }

  out.rows = [out.rows[0], ...mappedData];
  return out;
}

function normalizeBullets(x: any) {
  return clampStr(x);
}

function normalizeSection(sectionKey: string, incoming: any): V2Section {
  const isClosure = isClosureKey(sectionKey);

  const req = isClosure ? null : requiredByKey().get(sectionKey);
  const title = req?.title ?? s(incoming?.title ?? sectionKey);

  const base: V2Section = { key: sectionKey, title };

  if (!isClosure && req?.kind === "table") {
    base.table = normalizeTable(sectionKey, incoming?.table ?? incoming) ?? normalizeTable(sectionKey, null)!;
    base.bullets = undefined;
  } else {
    base.bullets = normalizeBullets(incoming?.bullets ?? incoming?.text ?? incoming?.content ?? "");
    base.table = undefined;
  }

  return base;
}

function normalizeReplaceAllDoc(doc: any) {
  const meta = doc?.meta && typeof doc.meta === "object" ? doc.meta : {};
  const incomingSections = Array.isArray(doc?.sections) ? doc.sections : [];

  const byKey = new Map<string, any>();
  for (const s0 of incomingSections) {
    const k = s(s0?.key).trim();
    if (!k) continue;
    byKey.set(k, s0);
  }

  const sections: V2Section[] = CHARTER_REQUIRED_SECTIONS.map((req) => normalizeSection(req.key, byKey.get(req.key)));

  return { version: 2, type: "project_charter", meta, sections };
}

/* =========================================================================================
   Prompts
========================================================================================= */

function buildSystemPromptForMode(mode: "full" | "section" | "suggest" | "validate") {
  const base = [
    // ✅ Stronger persona + output discipline
    "Act as an expert Programme/Project Manager and PMO lead. You write executive-ready PMI-inspired Project Charters.",
    "Return ONLY JSON. No markdown. No explanations.",
    "",
    "All outputs MUST be wrapped as one of these patch shapes:",
    `A) { "patch": { "kind": "replace_all", "doc": { "version": 2, "type": "project_charter", "meta": {..}, "sections": [..] } } }`,
    `B) { "patch": { "kind": "replace_section", "key": "<sectionKey>", "section": { "key": "<sectionKey>", "title": "<title>", "bullets"?: "...", "table"?: { "columns": N, "rows": [...] } } } }`,
    `C) { "patch": { "kind": "suggestions", "key": "<sectionKey>", "suggestions": [ { "id": "concise", "label": "Concise", "section": {...} }, { "id": "detailed", "label": "Detailed", "section": {...} } ] } }`,
    `D) { "patch": { "kind": "validate", "issues": [ { "key": "<sectionKey>", "severity":"info|warn|error", "message":"...", "fix"?: { "kind":"replace_section", "key":"<sectionKey>", "section": {...}} } ] } }`,
    "",
    "Global rules:",
    "- Use the provided required section schema and keys (exact keys, exact order for replace_all).",
    "- If information is missing, still complete the section and prefix uncertain statements with [ASSUMPTION] or [TBC].",
    "",
    "Formatting rules by section type:",
    "- For BULLETS sections, bullets is a single string with ONE item per line.",
    "- For TABLE sections, table = { columns: N, rows: [ {type:'header', cells:[...]}, {type:'data', cells:[...]}, ... ] }",
    "- Table header row must be first and match the provided headers exactly.",
    "- Always include at least 2 data rows for each table section.",
    "",
    "Section-specific formatting (IMPORTANT):",
    `- business_case: write as FREE TEXT prose (2–6 short paragraphs). DO NOT use bullet markers. Use blank lines between paragraphs if helpful.`,
    `- objectives: write as FREE TEXT prose with measurable outcomes. DO NOT use bullet markers.`,
    `- risks / issues / assumptions / dependencies: MUST be bullet lines starting with "• " (one per line). Keep them specific and actionable.`,
    "",
    "Quality bar:",
    "- Keep language enterprise-friendly and concise.",
    "- Avoid invented financial claims unless explicitly provided; otherwise use ranges + [ASSUMPTION] and state basis.",
  ];

  const modeSpecific =
    mode === "full"
      ? ["", "Mode=full: You must output replace_all with a complete charter containing ALL required sections in order."]
      : mode === "section"
        ? ["", "Mode=section: You must output replace_section for the requested sectionKey only."]
        : mode === "suggest"
          ? [
              "",
              "Mode=suggest: You must output suggestions for the requested sectionKey.",
              "Return at least 2 suggestions: concise and detailed.",
            ]
          : ["", "Mode=validate: Inspect the provided doc and return validate issues across sections."];

  return [...base, ...modeSpecific].join("\n");
}

function buildWeeklySystemPrompt() {
  return [
    "You are a senior PMO lead writing a Weekly Delivery Report for an enterprise programme.",
    "Return ONLY JSON. No markdown. No explanations.",
    "",
    "Output MUST be a single JSON object with this shape:",
    `{
  "content_json": {
    "version": 1,
    "type": "weekly_report",
    "periodFrom": "YYYY-MM-DD",
    "periodTo": "YYYY-MM-DD",
    "rag": "green|amber|red",
    "executiveSummary": { "headline": "...", "narrative": "..." },
    "completedThisPeriod": { "columns": 4, "rows": [ { "type":"header","cells":[...] }, { "type":"data","cells":[...] } ] },
    "nextPeriodFocus": { "columns": 4, "rows": [ ... ] },
    "resourceSummary": { "columns": 3, "rows": [ ... ] } | null,
    "keyDecisionsTaken": { "columns": 4, "rows": [ ... ] },
    "operationalBlockers": "one bullet per line",
    "meta": { "previous": { "rag":"green|amber|red" }, "dimensions": { "time":"...", "scope":"..." }, "milestones":[...] }
  }
}`,
    "",
    "Rules:",
    "- Keep it realistic and concise.",
    "- Use one bullet per line for operationalBlockers.",
    "- Tables must include a header row and at least 2 data rows (resourceSummary and keyDecisionsTaken can have 1+).",
    "- No invented financial claims unless explicitly provided in context.",
    "- If meta is provided, preserve it. You may add to meta but do not remove keys.",
  ].join("\n");
}

/**
 * OpenAI call (returns JSON string)
 */
async function callYourLLM(args: { system: string; user: string }) {
  const apiKey = mustEnv("WIRE_AI_API_KEY");
  const model = env("OPENAI_MODEL") || "gpt-4.1-mini";
  const temperature = Number(env("OPENAI_TEMPERATURE") || "0.2");

  const client = new OpenAI({ apiKey });

  const resp = await client.chat.completions.create({
    model,
    temperature,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
  });

  const text = resp.choices?.[0]?.message?.content ?? "";
  if (!String(text).trim()) throw new Error("OpenAI returned empty content");
  return String(text);
}

function extractPatch(parsed: any): Patch | null {
  if (parsed?.patch?.kind) return parsed.patch as Patch;
  if (parsed?.kind) return parsed as Patch;
  return null;
}

function isAllowedSectionKey(key: string) {
  const k = s(key).trim();
  if (!k) return false;

  if (requiredByKey().has(k)) return true;
  if (CLOSURE_ALLOWED_KEYS.has(k)) return true;
  if (isClosureKey(k)) return true;

  return false;
}

function isWeeklyRequest(body: any) {
  const t = s(body?.artifactType || body?.type || body?.doc?.type || "").trim().toLowerCase();
  if (t === "weekly_report" || t === "weeklyreport") return true;
  if (body?.weekly === true) return true;
  if (s(body?.mode).trim().toLowerCase() === "weekly") return true;
  return false;
}

/* =========================================================================================
   Response helpers
========================================================================================= */

function json(data: any, status = 200) {
  const res = NextResponse.json(data, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function buildDefaultCharterRequest(meta: any) {
  const projectTitle =
    s(meta?.project_title || meta?.projectTitle || meta?.title || meta?.project_name || meta?.projectName).trim();

  const pm = s(meta?.project_manager || meta?.projectManager || meta?.pm).trim();
  const sponsor = s(meta?.sponsor).trim();
  const dates = s(meta?.dates).trim();

  const lines: string[] = [];
  lines.push("Generate a complete Project Charter using the required schema.");
  if (projectTitle) lines.push(`Project: ${projectTitle}`);
  if (pm) lines.push(`Project Manager: ${pm}`);
  if (sponsor) lines.push(`Sponsor: ${sponsor}`);
  if (dates) lines.push(`Dates: ${dates}`);

  // Guidance that reduces blank outputs without forcing fake facts
  lines.push("");
  lines.push("If key details are missing, make reasonable assumptions and mark them clearly with [ASSUMPTION] / [TBC].");
  lines.push("Use an executive tone suitable for Steering Committee approval.");
  return lines.join("\n").trim();
}

function normalizeFullPrompt(body: any, meta: any) {
  // UI v2 sends: meta.pm_brief + instructions[]
  const userPrompt = s(body?.userPrompt || body?.prompt || body?.pmBrief || "");
  const pmBrief = s(meta?.pm_brief || meta?.pmBrief || "");
  const instructions = Array.isArray(body?.instructions) ? body.instructions.map((x: any) => s(x)).filter(Boolean) : [];

  const parts: string[] = [];

  // ✅ Always include a stable base request so “blank brief” still produces a charter
  parts.push("Request:", buildDefaultCharterRequest(meta), "");

  // ✅ PM Brief is treated as primary context
  if (pmBrief.trim()) parts.push("PM Brief:", pmBrief.trim(), "");

  // Optional explicit user prompt (if caller provided)
  if (userPrompt.trim()) parts.push("Additional user prompt:", userPrompt.trim(), "");

  // Optional extra instructions (from UI)
  if (instructions.length) parts.push("Additional instructions:", ...instructions.map((x) => `- ${x}`), "");

  const combined = parts.join("\n").trim();
  return combined;
}

/* =========================================================================================
   Handler
========================================================================================= */

export async function POST(req: Request) {
  // Optional: ensure auth is present (prevents mysterious RLS behaviour later)
  try {
    const sb = await createClient();
    const { data } = await sb.auth.getUser();
    if (!data?.user) {
      return json({ ok: false, error: "Not authenticated" }, 401);
    }
  } catch {
    // if auth lookup fails, still continue; but most setups should have it
  }

  const body = await req.json().catch(() => ({}));

  // Weekly path (kept as-is)
  if (isWeeklyRequest(body)) {
    const p = provider();

    const from = looksLikeYmd(s(body?.periodFrom))
      ? s(body.periodFrom)
      : looksLikeYmd(s(body?.from))
        ? s(body.from)
        : "";
    const to = looksLikeYmd(s(body?.periodTo))
      ? s(body.periodTo)
      : looksLikeYmd(s(body?.to))
        ? s(body.to)
        : "";
    const rag = coerceRag(body?.rag);

    const fallbackFrom = from || new Date().toISOString().slice(0, 10);
    const fallbackTo = to || new Date().toISOString().slice(0, 10);

    const meta = body?.meta && typeof body.meta === "object" ? body.meta : {};
    const context = clampStr(body?.userPrompt || body?.prompt || body?.notes || "");

    const projectId = s(body?.projectId || body?.project_id || meta?.projectId || meta?.project_id).trim();

    let enrichedMeta: any = meta;

    if (projectId) {
      try {
        const rows = await loadProjectArtifacts(projectId);

        const weeklyDocs: WeeklyReportDocV1[] = rows
          .filter((r: any) => s(r?.type).toLowerCase() === "weekly_report")
          .map((r: any) => r?.content_json)
          .filter((x: any) => x && typeof x === "object" && s(x.type) === "weekly_report");

        const prev = pickLatestDocBeforePeriod(weeklyDocs as any, fallbackFrom);

        const schedule = rows.find((r: any) => s(r?.type).toLowerCase() === "schedule")?.content_json ?? null;
        const wbs = rows.find((r: any) => s(r?.type).toLowerCase() === "wbs")?.content_json ?? null;

        const schedItems = Array.isArray(schedule?.items) ? schedule.items : [];
        const scheduleMilestones = schedItems
          .filter((it: any) => s(it?.type).toLowerCase() === "milestone")
          .map((it: any) => ({
            name: s(it?.name).trim(),
            due: s(it?.end || it?.due || it?.date || "").slice(0, 10) || null,
          }))
          .filter((m: any) => m.name)
          .slice(0, 8);

        const timeRag = schedule ? computeTimeRagFromSchedule(schedule, fallbackTo) : undefined;
        const scopeRag = wbs ? computeScopeRagFromWbs(wbs) : undefined;

        const prevMilestones: Record<string, { rag?: WeeklyRag }> = {};
        if (prev && prev?.completedThisPeriod) {
          const prevItems = tableFirstColBullets(prev.completedThisPeriod, 20);
          for (const t of prevItems) prevMilestones[t] = { rag: prev.rag };
        }

        enrichedMeta = {
          ...(meta || {}),
          previous: prev ? { rag: prev.rag, milestonesByName: prevMilestones } : undefined,
          dimensions: {
            ...(meta?.dimensions || {}),
            ...(timeRag ? { time: timeRag } : {}),
            ...(scopeRag ? { scope: scopeRag } : {}),
          },
          milestones: scheduleMilestones.length ? scheduleMilestones : undefined,
        };
      } catch {
        enrichedMeta = meta;
      }
    }

    if (p === "mock") {
      const weeklyDoc = normalizeWeeklyDoc(
        {
          periodFrom: fallbackFrom,
          periodTo: fallbackTo,
          rag,
          executiveSummary: { headline: "Weekly delivery update", narrative: "Stable progress across planned workstreams." },
          completedThisPeriod: {
            columns: 4,
            rows: [
              { type: "header", cells: ["Item", "Status", "Owner", "Notes"] },
              { type: "data", cells: ["Planned deliverables progressed", "Done", "PMO", "No escalations raised"] },
              { type: "data", cells: ["Governance cadence maintained", "On Track", "Delivery Lead", "Reporting submitted"] },
            ],
          },
          nextPeriodFocus: {
            columns: 4,
            rows: [
              { type: "header", cells: ["Item", "Target Date", "Owner", "Notes"] },
              { type: "data", cells: ["Complete outstanding actions", fallbackTo, "Delivery Lead", "Close out open items"] },
              { type: "data", cells: ["Prepare next governance pack", fallbackTo, "PMO", "Draft ready for review"] },
            ],
          },
          resourceSummary: null,
          keyDecisionsTaken: {
            columns: 4,
            rows: [
              { type: "header", cells: ["Decision", "Owner", "Date", "Notes"] },
              { type: "data", cells: ["No key decisions this period", "PMO", fallbackTo, "—"] },
            ],
          },
          operationalBlockers: "",
          meta: enrichedMeta,
        },
        { from: fallbackFrom, to: fallbackTo, rag }
      );

      return json({ ok: true, content_json: weeklyDoc });
    }

    const system = buildWeeklySystemPrompt();
    const user = [
      "Weekly report request context:",
      context ? context : "(no additional prompt provided)",
      "",
      "Meta (project context if any):",
      JSON.stringify(enrichedMeta ?? {}, null, 2),
      "",
      "Period:",
      JSON.stringify({ periodFrom: fallbackFrom, periodTo: fallbackTo, rag }, null, 2),
    ].join("\n");

    try {
      const raw = await callYourLLM({ system, user });
      const parsed = safeJsonParse(raw);

      const candidate = parsed?.content_json ?? parsed?.contentJson ?? parsed;

      const mergedCandidate =
        candidate && typeof candidate === "object"
          ? { ...candidate, meta: { ...(candidate?.meta || {}), ...(enrichedMeta || {}) } }
          : { meta: enrichedMeta };

      const weeklyDoc = normalizeWeeklyDoc(mergedCandidate, { from: fallbackFrom, to: fallbackTo, rag });

      return json({ ok: true, content_json: weeklyDoc });
    } catch (e: any) {
      return json({ ok: false, error: e?.message ?? "Weekly report generate failed" }, 500);
    }
  }

  // Charter/Closure path
  const mode = s(body?.mode).toLowerCase() as "full" | "section" | "suggest" | "validate";
  const meta = body?.meta && typeof body.meta === "object" ? body.meta : {};
  const doc = body?.doc && typeof body.doc === "object" ? body.doc : null;

  if (!["full", "section", "suggest", "validate"].includes(mode)) {
    return json({ ok: false, error: "Invalid mode. Use full|section|suggest|validate." }, 400);
  }

  const p = provider();

  const sectionKey = s(body?.key || body?.sectionKey || "").trim();
  const notes = s(body?.notes || "");
  const selectedText = s(body?.selectedText || "");

  // ✅ FIX: full mode can be driven by meta.pm_brief and/or instructions
  const fullPrompt = normalizeFullPrompt(body, meta);

  if (mode === "full" && !fullPrompt.trim()) {
    return json(
      {
        ok: false,
        error: "Missing prompt. Provide userPrompt OR meta.pm_brief OR instructions[].",
      },
      400
    );
  }

  if ((mode === "section" || mode === "suggest") && !sectionKey) {
    return json({ ok: false, error: "Missing key (sectionKey)" }, 400);
  }

  if ((mode === "section" || mode === "suggest") && !isAllowedSectionKey(sectionKey)) {
    return json({ ok: false, error: `Unknown section key: ${sectionKey}` }, 400);
  }

  // MOCK for charter: return BOTH patch and charterV2 (UI-friendly)
  if (p === "mock") {
    const docOut = normalizeReplaceAllDoc({ meta, sections: Array.isArray(doc?.sections) ? doc.sections : [] });
    const patchOut: Patch = { kind: "replace_all", doc: docOut };
    return json({ ok: true, patch: patchOut, charterV2: docOut });
  }

  const system = buildSystemPromptForMode(mode);

  const userLines: string[] = [];

  if (mode === "full") {
    userLines.push("High-level request (PM Brief / Instructions):", fullPrompt.trim(), "");
  } else if (mode === "section") {
    userLines.push("Requested mode: regenerate ONE section", `sectionKey: ${sectionKey}`, "");
  } else if (mode === "suggest") {
    userLines.push("Requested mode: improve ONE section (suggestions)", `sectionKey: ${sectionKey}`, "");
    if (notes.trim()) userLines.push("User notes:", notes.trim(), "");
    if (selectedText.trim()) userLines.push("Selected text (if any):", selectedText.trim(), "");
  } else if (mode === "validate") {
    userLines.push("Requested mode: validate doc for completeness and PMI best practices.", "");
  }

  userLines.push(
    "Project context meta (if any):",
    JSON.stringify(meta ?? {}, null, 2),
    "",
    "Required section schema (must follow exactly):",
    JSON.stringify(buildSchemaHint(), null, 2),
    ""
  );

  if (mode === "full") {
    userLines.push(
      "Existing doc (if provided) - use as context but you must output a complete new charter:",
      JSON.stringify(doc ?? {}, null, 2)
    );
  } else if (mode === "section" || mode === "suggest") {
    const existingSection =
      Array.isArray(doc?.sections) ? (doc.sections as any[]).find((x) => s(x?.key) === sectionKey) : null;

    userLines.push(
      "Existing doc (context):",
      JSON.stringify(doc ?? {}, null, 2),
      "",
      "Existing section (focus):",
      JSON.stringify(existingSection ?? {}, null, 2)
    );
  } else if (mode === "validate") {
    userLines.push("Doc to validate:", JSON.stringify(doc ?? {}, null, 2));
  }

  const user = userLines.join("\n");

  try {
    const raw = await callYourLLM({ system, user });

    const parsed = safeJsonParse(raw);
    const patch = extractPatch(parsed);

    if (!patch) {
      return json({ ok: false, error: "AI returned invalid JSON patch wrapper", raw }, 422);
    }

    // ✅ For full mode, ALWAYS return top-level charterV2 for your UI
    if (patch.kind === "replace_all") {
      const normalizedDoc = normalizeReplaceAllDoc((patch as any).doc);
      const patchOut: Patch = { kind: "replace_all", doc: normalizedDoc };
      return json({ ok: true, patch: patchOut, charterV2: normalizedDoc });
    }

    if (patch.kind === "replace_section") {
      const k = s((patch as any).key || sectionKey).trim();

      if (!k || !isAllowedSectionKey(k)) {
        return json({ ok: false, error: "AI returned invalid section key", raw }, 422);
      }

      const normalized = normalizeSection(k, (patch as any).section ?? {});
      const patchOut: Patch = { kind: "replace_section", key: k, section: normalized };
      return json({ ok: true, patch: patchOut });
    }

    if (patch.kind === "suggestions") {
      const k = s((patch as any).key || sectionKey).trim();

      if (!k || !isAllowedSectionKey(k)) {
        return json({ ok: false, error: "AI returned invalid suggestions key", raw }, 422);
      }

      const suggestionsIn = Array.isArray((patch as any).suggestions) ? (patch as any).suggestions : [];
      const suggestions = suggestionsIn
        .filter((x: any) => x && typeof x === "object")
        .slice(0, 6)
        .map((x: any, idx: number) => {
          const id = s(x.id || "").trim() || (idx === 0 ? "concise" : idx === 1 ? "detailed" : `alt_${idx + 1}`);
          const label =
            s(x.label || "").trim() ||
            (id === "concise" ? "Concise" : id === "detailed" ? "Detailed" : "Alternative");
          const section = normalizeSection(k, x.section ?? {});
          return { id, label, section };
        });

      while (suggestions.length < 2) {
        const id = suggestions.length === 0 ? "concise" : "detailed";
        const label = id === "concise" ? "Concise" : "Detailed";
        suggestions.push({ id, label, section: normalizeSection(k, {}) });
      }

      const patchOut: Patch = { kind: "suggestions", key: k, suggestions };
      return json({ ok: true, patch: patchOut });
    }

    if (patch.kind === "validate") {
      const issuesIn = Array.isArray((patch as any).issues) ? (patch as any).issues : [];
      const issues = issuesIn
        .filter((x: any) => x && typeof x === "object")
        .slice(0, 60)
        .map((x: any) => {
          const key = s(x.key || "").trim();
          const severity = (s(x.severity || "warn").toLowerCase() as any) as "info" | "warn" | "error";
          const message = clampStr(x.message || "");

          let fix: any = undefined;
          if (x.fix && typeof x.fix === "object" && s(x.fix.kind) === "replace_section") {
            const fk = s(x.fix.key || key).trim();
            if (fk && isAllowedSectionKey(fk)) {
              fix = {
                kind: "replace_section",
                key: fk,
                section: normalizeSection(fk, x.fix.section ?? {}),
              };
            }
          }

          const safeKey = isAllowedSectionKey(key) ? key : CHARTER_REQUIRED_SECTIONS[0].key;

          return {
            key: safeKey,
            severity: severity === "info" || severity === "warn" || severity === "error" ? severity : "warn",
            message,
            ...(fix ? { fix } : {}),
          };
        });

      const patchOut: Patch = { kind: "validate", issues };
      return json({ ok: true, patch: patchOut });
    }

    return json({ ok: false, error: "Unsupported patch kind", raw }, 422);
  } catch (e: any) {
    return json({ ok: false, error: e?.message ?? "AI generate failed" }, 500);
  }
}
