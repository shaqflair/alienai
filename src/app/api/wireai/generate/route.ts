// src/app/api/wireai/generate/route.ts
import "server-only";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/utils/supabase/server";
import { requireAiAccess } from "@/lib/ai/aiGuard";

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
   Weekly Report schema
========================================================================================= */

type WeeklyRag = "green" | "amber" | "red";

type WeeklyExecutiveSummary = {
  headline: string;
  narrative: string;
};

type WeeklyReportDocV1 = {
  version: 1;
  type: "weekly_report";
  periodFrom: string;
  periodTo: string;
  rag: WeeklyRag;
  executiveSummary: WeeklyExecutiveSummary;
  completedThisPeriod: { columns: number; rows: RowObj[] };
  nextPeriodFocus: { columns: number; rows: RowObj[] };
  resourceSummary?: { columns: number; rows: RowObj[] } | null;
  keyDecisionsTaken: { columns: number; rows: RowObj[] };
  operationalBlockers: string;
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

function getAiApiKey(): string {
  return env("OPENAI_API_KEY") || env("WIRE_AI_API_KEY");
}

function mustAiApiKey() {
  const v = getAiApiKey();
  if (!v) throw new Error("Missing env var: OPENAI_API_KEY (or WIRE_AI_API_KEY)");
  return v;
}

function provider() {
  return (env("AI_PROVIDER") || "mock").toLowerCase();
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    // Strip markdown code fences if present (some models wrap JSON)
    const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    try {
      return JSON.parse(stripped);
    } catch {
      return null;
    }
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
   Enrichment helpers
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

/**
 * ✅ NEW: Renders enriched meta as human-readable prose so the model
 * processes it naturally rather than parsing raw JSON blobs.
 */
function buildWeeklyContextNarrative(meta: any, fromYmd: string, toYmd: string): string {
  const lines: string[] = [];

  // Previous RAG
  const prevRag = s(meta?.previous?.rag).trim();
  if (prevRag) {
    lines.push(`Previous week RAG status: ${prevRag.toUpperCase()}.`);
  }

  // Dimensions
  const dims = meta?.dimensions && typeof meta.dimensions === "object" ? meta.dimensions : null;
  if (dims) {
    const dimParts: string[] = [];
    if (dims.time) dimParts.push(`Time=${dims.time.toUpperCase()}`);
    if (dims.scope) dimParts.push(`Scope=${dims.scope.toUpperCase()}`);
    if (dims.cost) dimParts.push(`Cost=${dims.cost.toUpperCase()}`);
    if (dims.quality) dimParts.push(`Quality=${dims.quality.toUpperCase()}`);
    if (dimParts.length) lines.push(`Health dimensions: ${dimParts.join(", ")}.`);
  }

  // Milestones
  const milestones = Array.isArray(meta?.milestones) ? meta.milestones : [];
  if (milestones.length) {
    const overdue = milestones.filter((m: any) => {
      const due = s(m?.due).slice(0, 10);
      return looksLikeYmd(due) && isEarlier(due, toYmd);
    });
    const upcoming = milestones.filter((m: any) => {
      const due = s(m?.due).slice(0, 10);
      return looksLikeYmd(due) && !isEarlier(due, toYmd);
    });

    if (overdue.length) {
      lines.push(
        `OVERDUE milestones (${overdue.length}): ${overdue
          .slice(0, 4)
          .map((m: any) => `"${s(m.name)}" (due ${s(m.due)})`)
          .join(", ")}. These MUST be reflected in the RAG and blockers.`
      );
    }

    if (upcoming.length) {
      lines.push(
        `Upcoming milestones: ${upcoming
          .slice(0, 4)
          .map((m: any) => `"${s(m.name)}" (due ${s(m.due)})`)
          .join(", ")}.`
      );
    }
  }

  // Scope signal
  if (dims?.scope === "red") {
    lines.push("WBS data shows ≥25% of work items blocked — scope is under pressure. Reflect this in blockers.");
  } else if (dims?.scope === "amber") {
    lines.push("WBS data shows 10–25% of work items at risk — note in next period focus or blockers.");
  }

  // Previous period completed items for context
  const prevMilestones = meta?.previous?.milestonesByName
    ? Object.keys(meta.previous.milestonesByName).slice(0, 5)
    : [];
  if (prevMilestones.length) {
    lines.push(`Items completed in prior period (for context): ${prevMilestones.join(", ")}.`);
  }

  return lines.length ? lines.join("\n") : "(No historical project context available.)";
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
  return CHARTER_REQUIRED_SECTIONS.map((x: any) => ({
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
   ✅ IMPROVED: Model & temperature routing
   - Full charter generation gets a larger model and higher temperature for richer prose
   - Validate/structured modes get lower temperature for consistency
========================================================================================= */

type CharterMode = "full" | "section" | "suggest" | "validate";

function resolveModel(mode: CharterMode, quality?: string): string {
  const envModel = env("OPENAI_MODEL");
  if (envModel) return envModel; // explicit override always wins

  // Route full charter generation to a more capable model for richer output
  if (mode === "full" || quality === "high") return "gpt-4.1";

  return "gpt-4.1-mini";
}

function resolveTemperature(mode: CharterMode): number {
  const envTemp = env("OPENAI_TEMPERATURE");
  if (envTemp) return Math.max(0, Math.min(2, Number(envTemp)));

  // Higher temperature for creative/generative work → more natural prose
  // Lower temperature for validation/structured extraction → more consistent
  if (mode === "full") return 0.5;
  if (mode === "section" || mode === "suggest") return 0.4;
  if (mode === "validate") return 0.1;

  return 0.2;
}

/* =========================================================================================
   ✅ IMPROVED: System prompts with chain-of-thought, section-specific rubrics, and
   PMI-quality validation criteria
========================================================================================= */

function buildSystemPromptForMode(mode: CharterMode) {
  const base = [
    "Act as an expert Programme/Project Manager and PMO lead. You write executive-ready PMI-inspired Project Charters.",
    "Return ONLY JSON. No markdown code fences. No explanations outside JSON.",
    "",
    "All outputs MUST be wrapped as one of these patch shapes:",
    `A) { "patch": { "kind": "replace_all", "doc": { "version": 2, "type": "project_charter", "meta": {..}, "sections": [..] } } }`,
    `B) { "patch": { "kind": "replace_section", "key": "<sectionKey>", "section": { "key": "<sectionKey>", "title": "<title>", "bullets"?: "...", "table"?: { "columns": N, "rows": [...] } } } }`,
    `C) { "patch": { "kind": "suggestions", "key": "<sectionKey>", "suggestions": [ { "id": "concise", "label": "Concise", "section": {...} }, { "id": "detailed", "label": "Detailed", "section": {...} } ] } }`,
    `D) { "patch": { "kind": "validate", "issues": [ { "key": "<sectionKey>", "severity":"info|warn|error", "message":"...", "fix"?: { "kind":"replace_section", "key":"<sectionKey>", "section": {...}} } ] } }`,
    "",
    "=== GLOBAL RULES ===",
    "- Use the provided required section schema and keys (exact keys, exact order for replace_all).",
    "- If information is missing, still complete the section and prefix uncertain statements with [ASSUMPTION] or [TBC].",
    "- Keep language enterprise-friendly, concise, and suitable for Steering Committee review.",
    "- Avoid invented financial figures unless explicitly provided; use ranges + [ASSUMPTION] and state the basis.",
    "",
    "=== FORMATTING RULES BY SECTION TYPE ===",
    "- BULLETS sections: bullets is a single string with ONE item per line.",
    "- TABLE sections: table = { columns: N, rows: [ {type:'header', cells:[...]}, {type:'data', cells:[...]}, ... ] }",
    "- Table header row must be first and match the provided headers exactly.",
    "- Always include at least 2 data rows for each table section.",
    "",
    "=== SECTION-SPECIFIC REQUIREMENTS ===",
    "",
    "business_case:",
    "  - Write as FREE TEXT prose (2–5 short paragraphs). NO bullet markers.",
    "  - Must answer: Why are we doing this? What problem does it solve? What is the strategic alignment?",
    "  - Include a brief cost-benefit statement even if only directional.",
    "",
    "objectives:",
    "  - Write as FREE TEXT prose. NO bullet markers.",
    "  - Each objective must be SMART (Specific, Measurable, Achievable, Relevant, Time-bound).",
    "  - Include at least 3–5 measurable outcomes.",
    "",
    "scope_in_out:",
    "  - Table with two columns: In Scope | Out of Scope.",
    "  - Be specific. Vague entries like 'all features' are not acceptable.",
    "  - Include at least 4 rows of meaningful scope items.",
    "",
    "milestones_timeline:",
    "  - Must include realistic target dates (use [ASSUMPTION] if estimating).",
    "  - Order milestones chronologically.",
    "  - Include project kick-off, key phase gates, and go-live/closure.",
    "",
    "financials:",
    "  - If no data provided: use realistic ranges, clearly mark as [ASSUMPTION], and state basis (e.g. 'market rate estimate').",
    "  - Include CAPEX, OPEX, and contingency as separate line items where applicable.",
    "  - Do NOT invent specific figures without flagging them.",
    "",
    "risks:",
    "  - MUST start each line with '• '.",
    "  - Format: '• [Risk description] — Likelihood: High/Med/Low | Impact: High/Med/Low | Mitigation: [action]'",
    "  - Include at least 5 meaningful risks.",
    "",
    "issues:",
    "  - MUST start each line with '• '.",
    "  - Format: '• [Issue description] — Owner: [name/TBC] | Target resolution: [date/TBC]'",
    "  - If no known issues, write one line: '• No current issues identified at charter stage.'",
    "",
    "assumptions:",
    "  - MUST start each line with '• '.",
    "  - Each assumption should be falsifiable (something that, if wrong, would affect the plan).",
    "  - Include at least 4 assumptions.",
    "",
    "dependencies:",
    "  - MUST start each line with '• '.",
    "  - Distinguish internal vs external dependencies.",
    "  - Include at least 3 dependencies.",
    "",
    "project_team:",
    "  - Must include PM, Sponsor, and at least 2 other roles.",
    "  - Use [TBC] for unknown names.",
    "",
    "stakeholders:",
    "  - Influence column: High / Medium / Low.",
    "  - Include both internal and external stakeholders.",
    "  - At least 5 rows.",
    "",
    "approval_committee:",
    "  - Include at least the Sponsor and PM.",
    "  - Dates and decisions may be [TBC] at charter stage.",
  ];

  const modeSpecific = buildModeSpecificPrompt(mode);

  return [...base, "", ...modeSpecific].join("\n");
}

function buildModeSpecificPrompt(mode: CharterMode): string[] {
  if (mode === "full") {
    return [
      "=== MODE: FULL CHARTER GENERATION ===",
      "Think step by step before writing each section:",
      "  1. Read the PM Brief and meta context thoroughly.",
      "  2. Identify what is known vs unknown.",
      "  3. For each section, decide what real content can be inferred vs what needs [ASSUMPTION]/[TBC].",
      "  4. Write sections in a coherent voice — they should feel like one document, not isolated fields.",
      "",
      "Output: replace_all with a COMPLETE charter containing ALL required sections in exact schema order.",
      "Quality bar: Every section must have substantive content. Empty or single-word cells are not acceptable.",
    ];
  }

  if (mode === "section") {
    return [
      "=== MODE: SECTION REGENERATION ===",
      "Output: replace_section for the requested sectionKey ONLY.",
      "Read the full doc context before writing — the section must be consistent with the rest of the charter.",
      "Apply the section-specific requirements from the global rules above.",
    ];
  }

  if (mode === "suggest") {
    return [
      "=== MODE: SUGGESTIONS ===",
      "Output: suggestions for the requested sectionKey.",
      "Provide EXACTLY 3 suggestions with these ids and labels:",
      "  1. id='concise', label='Concise' — tight, executive-summary style",
      "  2. id='detailed', label='Detailed' — comprehensive, all sub-points covered",
      "  3. id='risk_focused', label='Risk-Focused' — emphasises risks, caveats, and unknowns",
      "Each suggestion must be a complete, self-contained section (not a diff).",
      "Apply the section-specific formatting requirements above to each suggestion.",
    ];
  }

  if (mode === "validate") {
    return [
      "=== MODE: VALIDATE ===",
      "Inspect the provided doc against PMI best practices and the section requirements above.",
      "",
      "Issue severity definitions:",
      "  error   — Missing required content, invalid format, or content that would cause SteerCo rejection",
      "  warn    — Incomplete, vague, or missing best-practice elements that reduce document quality",
      "  info    — Enhancement opportunities or minor style suggestions",
      "",
      "Validation checklist — check EVERY section against these criteria:",
      "  business_case: Is there a clear problem statement? Strategic alignment? Cost-benefit direction?",
      "  objectives: Are objectives SMART? Are there measurable outcomes with target dates?",
      "  scope_in_out: Are in/out scope items specific (not generic)? At least 4 rows?",
      "  milestones_timeline: Do milestones have dates? Are they in chronological order?",
      "  financials: Are figures present (even as ranges)? Is contingency included?",
      "  risks: Do risks follow the Likelihood/Impact/Mitigation format? At least 5?",
      "  issues: Are issues listed with owners and target dates?",
      "  assumptions: Are assumptions specific and falsifiable?",
      "  dependencies: Are internal vs external dependencies distinguished?",
      "  project_team: Is PM present? Sponsor present? At least 4 roles?",
      "  stakeholders: Is Influence column populated? At least 5 stakeholders?",
      "  approval_committee: Are Sponsor and PM listed?",
      "",
      "For each issue found, provide a concrete fix (replace_section) where possible.",
      "Do not flag [ASSUMPTION] or [TBC] markers as errors — they are intentional.",
      "Return at least 3 issues if the document has any quality gaps.",
    ];
  }

  return [];
}

/* =========================================================================================
   ✅ IMPROVED: Weekly system prompt with structured narrative output guidance
========================================================================================= */

function buildWeeklySystemPrompt() {
  return [
    "You are a senior PMO lead writing a Weekly Delivery Report for an enterprise programme.",
    "Return ONLY valid JSON. No markdown. No explanations.",
    "",
    "Output shape:",
    `{
  "content_json": {
    "version": 1,
    "type": "weekly_report",
    "periodFrom": "YYYY-MM-DD",
    "periodTo": "YYYY-MM-DD",
    "rag": "green|amber|red",
    "executiveSummary": { "headline": "...", "narrative": "..." },
    "completedThisPeriod": { "columns": 4, "rows": [ { "type":"header","cells":["Item","Status","Owner","Notes"] }, ... ] },
    "nextPeriodFocus": { "columns": 4, "rows": [ ... ] },
    "resourceSummary": { "columns": 3, "rows": [ ... ] } | null,
    "keyDecisionsTaken": { "columns": 4, "rows": [ ... ] },
    "operationalBlockers": "one bullet per line starting with • ",
    "meta": { "previous": { "rag":"green|amber|red" }, "dimensions": { "time":"...", "scope":"..." }, "milestones":[...] }
  }
}`,
    "",
    "=== RAG DETERMINATION RULES ===",
    "Read the project context narrative carefully before setting RAG. Rules in priority order:",
    "  RED:   Any overdue milestone, ≥25% WBS items blocked, critical blocker with no mitigation, or prev was RED with no improvement.",
    "  AMBER: Milestone due within 7 days and at risk, 10–25% WBS items blocked, or prev was AMBER with open concerns.",
    "  GREEN: No overdue milestones, no critical blockers, delivery on track.",
    "The RAG you set MUST be consistent with the context narrative and operationalBlockers content.",
    "",
    "=== CONTENT QUALITY RULES ===",
    "- executiveSummary.headline: One punchy sentence capturing the week in 10–15 words.",
    "- executiveSummary.narrative: 2–4 sentences. Cover: overall status, key achievements, main risks/blockers, outlook.",
    "  If WoW trend data is present, briefly reference it (e.g. 'Score improved from X to Y week-on-week').",
    "- completedThisPeriod: Be specific — list actual deliverables, not generic 'tasks progressed'. Min 3 rows.",
    "- nextPeriodFocus: Link to upcoming milestones from the context. Min 3 rows.",
    "- operationalBlockers: Each line starts with '• '. If none, write '• No blockers this period.'",
    "  If overdue milestones exist in context, MUST reflect them as blockers.",
    "- resourceSummary: Include only if resource risks exist. Null otherwise.",
    "- keyDecisionsTaken: Include decisions taken or deferred. At least 1 row (use 'No key decisions' if none).",
    "",
    "=== META RULES ===",
    "- Preserve all incoming meta fields. You may add but MUST NOT remove any keys.",
    "- If milestones are provided in meta, reference them in nextPeriodFocus and operationalBlockers where relevant.",
  ].join("\n");
}

/* =========================================================================================
   LLM call
========================================================================================= */

async function callYourLLM(args: { system: string; user: string; model: string; temperature: number }) {
  const apiKey = mustAiApiKey();
  const client = new OpenAI({ apiKey });

  const resp = await client.chat.completions.create({
    model: args.model,
    temperature: args.temperature,
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

  lines.push("");
  lines.push("If key details are missing, make reasonable assumptions and mark them clearly with [ASSUMPTION] / [TBC].");
  lines.push("Use an executive tone suitable for Steering Committee approval.");
  return lines.join("\n").trim();
}

function normalizeFullPrompt(body: any, meta: any) {
  const userPrompt = s(body?.userPrompt || body?.prompt || body?.pmBrief || "");
  const pmBrief = s(meta?.pm_brief || meta?.pmBrief || "");
  const instructions = Array.isArray(body?.instructions) ? body.instructions.map((x: any) => s(x)).filter(Boolean) : [];

  const parts: string[] = [];

  parts.push("Request:", buildDefaultCharterRequest(meta), "");

  if (pmBrief.trim()) parts.push("PM Brief:", pmBrief.trim(), "");
  if (userPrompt.trim()) parts.push("Additional user prompt:", userPrompt.trim(), "");
  if (instructions.length) parts.push("Additional instructions:", ...instructions.map((x: any) => `- ${x}`), "");

  const combined = parts.join("\n").trim();
  return combined;
}

/* =========================================================================================
   Handler
========================================================================================= */

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr || !auth?.user) return json({ ok: false, error: "Not authenticated" }, 401);

  const body = await req.json().catch(() => ({}));

  // ── Weekly path ──────────────────────────────────────────────────────────────
  if (isWeeklyRequest(body)) {
    const p = provider();

    const from = looksLikeYmd(s(body?.periodFrom)) ? s(body.periodFrom) : looksLikeYmd(s(body?.from)) ? s(body.from) : "";
    const to = looksLikeYmd(s(body?.periodTo)) ? s(body.periodTo) : looksLikeYmd(s(body?.to)) ? s(body.to) : "";
    const rag = coerceRag(body?.rag);

    const fallbackFrom = from || new Date().toISOString().slice(0, 10);
    const fallbackTo = to || new Date().toISOString().slice(0, 10);

    const meta = body?.meta && typeof body.meta === "object" ? body.meta : {};
    const context = clampStr(body?.userPrompt || body?.prompt || body?.notes || "");

    const projectId = s(body?.projectId || body?.project_id || meta?.projectId || meta?.project_id).trim() || null;

    const guard = await requireAiAccess({ projectId, kind: "wireai.generate.weekly" });
    if (!guard.ok) return json({ ok: false, error: guard.error, meta: guard.meta ?? null }, guard.status);

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
          executiveSummary: {
            headline: "Weekly delivery update",
            narrative: "Stable progress across planned workstreams.",
          },
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

    // ✅ Build weekly user prompt using narrative context (not raw JSON blob)
    const contextNarrative = buildWeeklyContextNarrative(enrichedMeta, fallbackFrom, fallbackTo);

    const weeklyModel = env("OPENAI_MODEL") || "gpt-4.1-mini";
    const weeklyTemp = env("OPENAI_TEMPERATURE") ? Number(env("OPENAI_TEMPERATURE")) : 0.3;

    const system = buildWeeklySystemPrompt();
    const user = [
      "=== REPORTING PERIOD ===",
      `From: ${fallbackFrom}  To: ${fallbackTo}  Requested RAG: ${rag.toUpperCase()}`,
      "",
      "=== PROJECT CONTEXT (read carefully before writing) ===",
      contextNarrative,
      "",
      "=== USER NOTES / ADDITIONAL CONTEXT ===",
      context || "(none provided)",
      "",
      "=== FULL META (for preservation) ===",
      JSON.stringify(enrichedMeta ?? {}, null, 2),
    ].join("\n");

    try {
      const raw = await callYourLLM({ system, user, model: weeklyModel, temperature: weeklyTemp });
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

  // ── Charter / Closure path ────────────────────────────────────────────────────
  const mode = s(body?.mode).toLowerCase() as CharterMode;
  const meta = body?.meta && typeof body.meta === "object" ? body.meta : {};
  const doc = body?.doc && typeof body.doc === "object" ? body.doc : null;

  if (!["full", "section", "suggest", "validate"].includes(mode)) {
    return json({ ok: false, error: "Invalid mode. Use full|section|suggest|validate." }, 400);
  }

  const p = provider();
  const quality = s(body?.quality).trim().toLowerCase(); // "high" → routes to gpt-4.1

  const sectionKey = s(body?.key || body?.sectionKey || "").trim();
  const notes = s(body?.notes || "");
  const selectedText = s(body?.selectedText || "");

  const fullPrompt = normalizeFullPrompt(body, meta);

  if (mode === "full" && !fullPrompt.trim()) {
    return json(
      { ok: false, error: "Missing prompt. Provide userPrompt OR meta.pm_brief OR instructions[]." },
      400
    );
  }

  if ((mode === "section" || mode === "suggest") && !sectionKey) {
    return json({ ok: false, error: "Missing key (sectionKey)" }, 400);
  }

  if ((mode === "section" || mode === "suggest") && !isAllowedSectionKey(sectionKey)) {
    return json({ ok: false, error: `Unknown section key: ${sectionKey}` }, 400);
  }

  const projectId =
    s(
      body?.projectId ||
        body?.project_id ||
        meta?.projectId ||
        meta?.project_id ||
        doc?.meta?.projectId ||
        doc?.meta?.project_id
    ).trim() || null;

  const guard = await requireAiAccess({ projectId, kind: `wireai.generate.${mode}` });
  if (!guard.ok) return json({ ok: false, error: guard.error, meta: guard.meta ?? null }, guard.status);

  // MOCK
  if (p === "mock") {
    const docOut = normalizeReplaceAllDoc({ meta, sections: Array.isArray(doc?.sections) ? doc.sections : [] });
    const patchOut: Patch = { kind: "replace_all", doc: docOut };
    return json({ ok: true, patch: patchOut, charterV2: docOut });
  }

  // ✅ Resolve model and temperature per mode
  const model = resolveModel(mode, quality);
  const temperature = resolveTemperature(mode);

  const system = buildSystemPromptForMode(mode);

  const userLines: string[] = [];

  if (mode === "full") {
    userLines.push(
      "=== PM BRIEF / INSTRUCTIONS ===",
      fullPrompt.trim(),
      "",
      "Think step by step: what is known, what must be assumed, and how sections relate to each other."
    );
  } else if (mode === "section") {
    userLines.push(
      "=== TASK ===",
      `Regenerate ONLY this section: ${sectionKey}`,
      "",
      "Read the full doc context below first to ensure consistency."
    );
  } else if (mode === "suggest") {
    userLines.push("=== TASK ===", `Generate 3 suggestions for section: ${sectionKey}`);
    if (notes.trim()) userLines.push("", "User notes:", notes.trim());
    if (selectedText.trim()) userLines.push("", "Currently selected text:", selectedText.trim());
  } else if (mode === "validate") {
    userLines.push(
      "=== TASK ===",
      "Validate this charter doc for completeness and PMI best practices.",
      "Apply every criterion from the validation checklist in the system prompt.",
      "Be specific in your messages — reference actual content gaps, not generic advice."
    );
  }

  userLines.push(
    "",
    "=== PROJECT META ===",
    JSON.stringify(meta ?? {}, null, 2),
    "",
    "=== REQUIRED SECTION SCHEMA (follow exactly) ===",
    JSON.stringify(buildSchemaHint(), null, 2),
    ""
  );

  if (mode === "full") {
    userLines.push(
      "=== EXISTING DOC (context — output a fully regenerated charter) ===",
      JSON.stringify(doc ?? {}, null, 2)
    );
  } else if (mode === "section" || mode === "suggest") {
    const existingSection =
      Array.isArray(doc?.sections) ? (doc.sections as any[]).find((x) => s(x?.key) === sectionKey) : null;

    userLines.push(
      "=== FULL DOC (context) ===",
      JSON.stringify(doc ?? {}, null, 2),
      "",
      "=== CURRENT SECTION (focus) ===",
      JSON.stringify(existingSection ?? {}, null, 2)
    );
  } else if (mode === "validate") {
    userLines.push("=== DOC TO VALIDATE ===", JSON.stringify(doc ?? {}, null, 2));
  }

  const user = userLines.join("\n");

  try {
    const raw = await callYourLLM({ system, user, model, temperature });

    const parsed = safeJsonParse(raw);
    const patch = extractPatch(parsed);

    if (!patch) {
      return json({ ok: false, error: "AI returned invalid JSON patch wrapper", raw }, 422);
    }

    if (patch.kind === "replace_all") {
      const normalizedDoc = normalizeReplaceAllDoc((patch as any).doc);
      const patchOut: Patch = { kind: "replace_all", doc: normalizedDoc };
      return json({ ok: true, patch: patchOut, charterV2: normalizedDoc });
    }

    if (patch.kind === "replace_section") {
      const k = s((patch as any).key || sectionKey).trim();
      if (!k || !isAllowedSectionKey(k)) return json({ ok: false, error: "AI returned invalid section key", raw }, 422);

      const normalized = normalizeSection(k, (patch as any).section ?? {});
      const patchOut: Patch = { kind: "replace_section", key: k, section: normalized };
      return json({ ok: true, patch: patchOut });
    }

    if (patch.kind === "suggestions") {
      const k = s((patch as any).key || sectionKey).trim();
      if (!k || !isAllowedSectionKey(k)) return json({ ok: false, error: "AI returned invalid suggestions key", raw }, 422);

      const suggestionsIn = Array.isArray((patch as any).suggestions) ? (patch as any).suggestions : [];
      const suggestions = suggestionsIn
        .filter((x: any) => x && typeof x === "object")
        .slice(0, 6)
        .map((x: any, idx: number) => {
          const id =
            s(x.id || "").trim() ||
            (idx === 0 ? "concise" : idx === 1 ? "detailed" : idx === 2 ? "risk_focused" : `alt_${idx + 1}`);
          const label =
            s(x.label || "").trim() ||
            (id === "concise" ? "Concise" : id === "detailed" ? "Detailed" : id === "risk_focused" ? "Risk-Focused" : "Alternative");
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
          const severity = s(x.severity || "warn").toLowerCase() as "info" | "warn" | "error";
          const message = clampStr(x.message || "");

          let fix: any = undefined;
          if (x.fix && typeof x.fix === "object" && s(x.fix.kind) === "replace_section") {
            const fk = s(x.fix.key || key).trim();
            if (fk && isAllowedSectionKey(fk)) {
              fix = { kind: "replace_section", key: fk, section: normalizeSection(fk, x.fix.section ?? {}) };
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