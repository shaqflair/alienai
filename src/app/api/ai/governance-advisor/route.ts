// src/app/api/ai/governance-advisor/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS: HeadersInit = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
};

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}
function clamp(s: string, max: number) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) : t;
}
function safeJsonParse<T = any>(txt: string): T | null {
  try {
    return JSON.parse(txt) as T;
  } catch {
    return null;
  }
}
function jsonOk(data: any, status = 200, headers?: HeadersInit) {
  return NextResponse.json({ ok: true, ...data }, { status, headers });
}
function jsonErr(message: string, status = 400, extra?: any, headers?: HeadersInit) {
  return NextResponse.json({ ok: false, error: message, ...(extra ? { extra } : {}) }, { status, headers });
}
function isMissingColumnError(errMsg: any, col: string) {
  const m = String(errMsg || "").toLowerCase();
  const c = col.toLowerCase();
  return (
    (m.includes("column") && m.includes(c) && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes(c)) ||
    (m.includes("unknown column") && m.includes(c))
  );
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

async function requireAuth(supabase: any) {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw Object.assign(new Error(error.message), { status: 401 });
  if (!data?.user) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  return data.user;
}

async function requireProjectMember(
  supabase: any,
  projectId: string,
  userId: string,
  minRole: "viewer" | "editor" = "viewer"
) {
  const pid = safeStr(projectId).trim();
  if (!pid) throw Object.assign(new Error("Missing projectId"), { status: 400 });

  const { data, error } = await supabase
    .from("project_members")
    .select("role, is_active, removed_at")
    .eq("project_id", pid)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw Object.assign(new Error("Forbidden"), { status: 403 });

  const role = safeLower(data.role);
  const isEditor = role === "owner" || role === "editor";
  if (minRole === "editor" && !isEditor) throw Object.assign(new Error("Forbidden"), { status: 403 });

  return { role: role || "viewer" };
}

type Scope = "global" | "project" | "kb";
function asScope(x: any): Scope {
  const s = safeLower(x);
  if (s === "project" || s === "kb" || s === "global") return s;
  return "global";
}

function daysSince(isoOrDate: any) {
  try {
    const d = new Date(isoOrDate);
    if (!Number.isFinite(d.getTime())) return null;
    const ms = Date.now() - d.getTime();
    return Math.max(0, Math.floor(ms / 86400000));
  } catch {
    return null;
  }
}
function startOfUtcDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}
function parseDateAny(x: any): Date | null {
  if (!x) return null;
  if (x instanceof Date && !Number.isNaN(x.getTime())) return x;
  const s = safeStr(x).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function inPastUtc(d: Date) {
  return d.getTime() < startOfUtcDay(new Date()).getTime();
}

type AdvisorResult = {
  answer: string;
  confidence: number;
  key_drivers: string[];
  blockers: Array<{
    kind:
      | "approval"
      | "risk"
      | "issue"
      | "assumption"
      | "dependency"
      | "change"
      | "milestone"
      | "task"
      | "artifact"
      | "unknown";
    title: string;
    entity_id: string;
    age_days?: number;
    severity?: number;
    next_action: string;
  }>;
  today_actions: Array<{
    priority: 1 | 2 | 3 | 4 | 5;
    action: string;
    owner_suggestion?: string;
    why: string;
  }>;
  recommended_routes: Array<{ label: string; href: string }>;
  data_requests: string[];
};

function defaultAdvisorResult(answer: string): AdvisorResult {
  return {
    answer,
    confidence: 0.35,
    key_drivers: [],
    blockers: [],
    today_actions: [],
    recommended_routes: [],
    data_requests: [],
  };
}

function buildRecommendedRoutes(scope: Scope, projectId?: string | null, kbSlug?: string | null) {
  if (scope === "kb") {
    const routes = [{ label: "Governance hub", href: "/governance" }];
    if (kbSlug) routes.push({ label: "This article", href: `/governance/${encodeURIComponent(kbSlug)}` });
    routes.push({ label: "Executive cockpit", href: "/executive" });
    return routes;
  }

  if (scope !== "project" || !projectId) {
    return [
      { label: "Governance hub", href: "/governance" },
      { label: "Executive cockpit", href: "/executive" },
    ];
  }

  const p = encodeURIComponent(projectId);
  return [
    { label: "Project overview", href: `/projects/${p}` },
    { label: "Artifacts", href: `/projects/${p}/artifacts` },
    { label: "Approvals inbox", href: `/projects/${p}/approvals/inbox` },
    { label: "Approvals timeline", href: `/projects/${p}/approvals/timeline` },
    { label: "RAID log", href: `/projects/${p}/raid` },
    { label: "Change board", href: `/projects/${p}/change` },
    { label: "WBS", href: `/projects/${p}/wbs` },
  ];
}

/* ---------------- context summariser (what LLM sees) ---------------- */

function summarizeContext(ctx: any) {
  const summary: any = {};

  if (ctx?.project)
    summary.project = {
      id: ctx.project.id,
      title: ctx.project.title,
      project_code: ctx.project.project_code,
      client_name: ctx.project.client_name,
    };

  if (ctx?.members) summary.members = ctx.members;

  if (Array.isArray(ctx?.artifacts)) {
    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    let missingOwners = 0;

    for (const a of ctx.artifacts) {
      const st = safeLower(a?.approval_status || a?.status || "draft") || "draft";
      byStatus[st] = (byStatus[st] || 0) + 1;

      const tp = safeLower(a?.artifact_type || a?.type || "unknown") || "unknown";
      byType[tp] = (byType[tp] || 0) + 1;

      if (!a?.owner_user_id) missingOwners++;
    }

    summary.artifacts = {
      count: ctx.artifacts.length,
      byStatus,
      byType,
      missing_owners: missingOwners,
      stale_drafts_top: Array.isArray(ctx?.staleDraftsTop) ? ctx.staleDraftsTop : [],
    };
  }

  if (ctx?.changes) summary.changes = ctx.changes;
  if (ctx?.raid) summary.raid = ctx.raid;
  if (ctx?.approvals) summary.approvals = ctx.approvals;
  if (ctx?.milestones) summary.milestones = ctx.milestones;
  if (ctx?.work_items) summary.work_items = ctx.work_items;
  if (ctx?.signals) summary.signals = ctx.signals;

  if (ctx?.kb?.article) summary.kb = { article: ctx.kb.article };

  return summary;
}

/* ---------------- baseline answer (deterministic) ---------------- */

function heuristicAnswer(question: string, scope: Scope, ctxSummary: any) {
  const q = safeLower(question);
  const hints: string[] = [];

  if (scope === "kb") {
    const t = safeStr(ctxSummary?.kb?.article?.title);
    const s = safeStr(ctxSummary?.kb?.article?.summary);
    return [
      t ? `Guidance for: ${t}` : "Governance guidance",
      s ? `\nContext: ${s}\n` : "",
      "Ask a specific question and I’ll answer using this article as the governing standard.",
      "",
      "Try:",
      '- "What controls must be in place for this?"',
      '- "What evidence do we need for audit?"',
      '- "What are the escalation triggers and SLAs?"',
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (scope === "project") {
    const owners = Number(ctxSummary?.members?.owners ?? 0);
    if (owners < 2) hints.push("Continuity risk: you should have **2+ Owners** on the project.");

    const pending = Number(ctxSummary?.approvals?.pending ?? 0);
    if (pending > 0) hints.push(`There are **${pending} pending approvals**.`);

    const staleHi = Number(ctxSummary?.raid?.stale_high ?? 0);
    if (staleHi > 0) hints.push(`There are **${staleHi} stale high severity RAID items**.`);

    const missingOwners = Number(ctxSummary?.artifacts?.missing_owners ?? 0);
    if (missingOwners > 0) hints.push(`There are **${missingOwners} artifacts without an owner**.`);

    const overdueWi = Number(ctxSummary?.work_items?.overdue ?? 0);
    if (overdueWi > 0) hints.push(`There are **${overdueWi} overdue work items**.`);

    const overdueMs = Number(ctxSummary?.milestones?.overdue ?? 0);
    if (overdueMs > 0) hints.push(`There are **${overdueMs} overdue milestones**.`);
  }

  if (q.includes("blocking") || q.includes("stuck") || q.includes("approval")) {
    return [
      "Here's how to unblock delivery fast:",
      "",
      "- Identify the **oldest pending approval step** and its assigned approver/group.",
      "- If the approver is unavailable, apply **delegation/holiday cover**.",
      "- If overdue vs SLA, **escalate** and set a due date.",
      "",
      hints.length ? `Signals:\n- ${hints.join("\n- ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (q.includes("safe") || q.includes("risk") || q.includes("raid")) {
    return [
      "Governance risk check:",
      "",
      "- Ensure **owners coverage** (2+ owners).",
      "- Update RAID weekly; escalate high/critical items.",
      "- Ensure changes have impact analysis.",
      "- Ensure key artifacts are current and owned.",
      "",
      hints.length ? `Signals:\n- ${hints.join("\n- ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "Ask me things like:",
    '- "Is this project safe?"',
    '- "What should I do today?"',
    '- "Who is blocking delivery?"',
    "",
    hints.length ? `Signals:\n- ${hints.join("\n- ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildServerBaselineResult(args: {
  question: string;
  scope: Scope;
  ctxSummary: any;
  recommendedRoutes: Array<{ label: string; href: string }>;
}): AdvisorResult {
  const { question, scope, ctxSummary, recommendedRoutes } = args;

  const out = defaultAdvisorResult(heuristicAnswer(question, scope, ctxSummary));
  out.recommended_routes = recommendedRoutes;

  if (scope !== "project") return out;

  const drivers: string[] = [];
  const blockers: AdvisorResult["blockers"] = [];
  const actions: AdvisorResult["today_actions"] = [];

  const owners = Number(ctxSummary?.members?.owners ?? 0);
  const pendingApprovals = Number(ctxSummary?.approvals?.pending ?? 0);
  const staleHigh = Number(ctxSummary?.raid?.stale_high ?? 0);
  const missingOwners = Number(ctxSummary?.artifacts?.missing_owners ?? 0);
  const overdueWi = Number(ctxSummary?.work_items?.overdue ?? 0);
  const overdueMs = Number(ctxSummary?.milestones?.overdue ?? 0);
  const changesPendingTail = Number(ctxSummary?.changes?.pending_tail_top?.length ?? 0);

  if (owners < 2) drivers.push(`Continuity risk: only ${owners} owner(s); best practice is 2+.`);
  if (pendingApprovals > 0) drivers.push(`${pendingApprovals} approval step(s) pending.`);
  if (staleHigh > 0) drivers.push(`${staleHigh} stale high-severity RAID item(s).`);
  if (missingOwners > 0) drivers.push(`${missingOwners} artifact(s) have no owner.`);
  if (overdueMs > 0) drivers.push(`${overdueMs} overdue milestone(s).`);
  if (overdueWi > 0) drivers.push(`${overdueWi} overdue work item(s).`);
  if (changesPendingTail > 0) drivers.push(`${changesPendingTail} change(s) lingering.`);

  const pendingTop = Array.isArray(ctxSummary?.approvals?.pending_top) ? ctxSummary.approvals.pending_top : [];
  for (const p of pendingTop.slice(0, 3)) {
    blockers.push({
      kind: "approval",
      title: safeStr(p?.name || "Pending approval"),
      entity_id: safeStr(p?.id || "approval_step"),
      age_days: typeof p?.age_days === "number" ? p.age_days : undefined,
      next_action: "Confirm the current approver/group, apply delegation if needed, and set a decision due date.",
    });
  }

  const staleHiTop = Array.isArray(ctxSummary?.raid?.stale_high_top) ? ctxSummary.raid.stale_high_top : [];
  for (const r of staleHiTop.slice(0, 3)) {
    blockers.push({
      kind: "risk",
      title: safeStr(r?.title || "Stale RAID item"),
      entity_id: safeStr(r?.id || "raid_item"),
      age_days: typeof r?.age_days === "number" ? r.age_days : undefined,
      severity: typeof r?.severity === "number" ? r.severity : undefined,
      next_action: "Update status, confirm mitigation/owner/date, and escalate if needed.",
    });
  }

  const overdueWorkTop = Array.isArray(ctxSummary?.work_items?.overdue_top) ? ctxSummary.work_items.overdue_top : [];
  for (const w of overdueWorkTop.slice(0, 2)) {
    blockers.push({
      kind: "task",
      title: safeStr(w?.title || "Overdue work item"),
      entity_id: safeStr(w?.id || "work_item"),
      next_action: "Assign/confirm owner, agree recovery plan.",
    });
  }

  const overdueMsTop = Array.isArray(ctxSummary?.milestones?.overdue_top) ? ctxSummary.milestones.overdue_top : [];
  for (const m of overdueMsTop.slice(0, 2)) {
    blockers.push({
      kind: "milestone",
      title: safeStr(m?.title || "Overdue milestone"),
      entity_id: safeStr(m?.id || "milestone"),
      next_action: "Confirm milestone forecast date and escalate if critical path.",
    });
  }

  if (owners < 2)
    actions.push({
      priority: 1,
      action: "Add a second Owner to the project",
      why: "Reduces single point of failure.",
      owner_suggestion: "Account/Portfolio Lead",
    });

  if (pendingApprovals > 0)
    actions.push({
      priority: 1,
      action: "Chase the oldest pending approval and apply delegation if needed",
      why: "Approvals are the most common silent blocker.",
      owner_suggestion: "Project Manager",
    });

  if (staleHigh > 0)
    actions.push({
      priority: 2,
      action: "Update high-severity RAID items and escalate where required",
      why: "Stale high-severity RAID signals hidden risk.",
      owner_suggestion: "Delivery Lead / PM",
    });

  if (overdueMs > 0 || overdueWi > 0)
    actions.push({
      priority: 2,
      action: "Confirm recovery plans for overdue milestones/work items",
      why: "Overdue items imply schedule pressure.",
      owner_suggestion: "Workstream Owners",
    });

  if (missingOwners > 0)
    actions.push({
      priority: 3,
      action: "Assign owners to unowned artifacts",
      why: "Without owners governance becomes unactionable.",
      owner_suggestion: "PMO / PM",
    });

  out.key_drivers = drivers;
  out.blockers = blockers;
  out.today_actions = actions.length ? actions : out.today_actions;
  out.confidence = drivers.length > 0 ? 0.55 : 0.4;

  return out;
}

/* ---------------- OpenAI call ---------------- */

function buildSystemPrompt() {
  return [
    "You are Aliena — a boardroom-grade PMO and governance advisor.",
    "Ground all claims in the provided context JSON.",
    "Do not invent counts, dates, owners, links, or statuses.",
    "Be crisp, executive-ready, and action-oriented.",
    "Return STRICT JSON matching the provided schema.",
  ].join("\n");
}

function buildResponseSchema() {
  return {
    name: "AlienaGovernanceAdvisorResponse",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        answer: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        key_drivers: { type: "array", items: { type: "string" } },
        blockers: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              kind: { type: "string" },
              title: { type: "string" },
              entity_id: { type: "string" },
              age_days: { type: "number" },
              severity: { type: "number" },
              next_action: { type: "string" },
            },
            required: ["kind", "title", "entity_id", "next_action"],
          },
        },
        today_actions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              priority: { type: "number", minimum: 1, maximum: 5 },
              action: { type: "string" },
              owner_suggestion: { type: "string" },
              why: { type: "string" },
            },
            required: ["priority", "action", "why"],
          },
        },
        recommended_routes: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              label: { type: "string" },
              href: { type: "string" },
            },
            required: ["label", "href"],
          },
        },
        data_requests: { type: "array", items: { type: "string" } },
      },
      required: ["answer", "confidence", "key_drivers", "blockers", "today_actions", "recommended_routes", "data_requests"],
    },
  };
}

function extractResponseJson(data: any): AdvisorResult | null {
  const t1 = safeStr(data?.output_text).trim();
  if (t1) {
    const p1 = safeJsonParse<AdvisorResult>(t1);
    if (p1?.answer) return p1;
  }

  try {
    const output = data?.output;
    if (Array.isArray(output)) {
      const chunks: string[] = [];
      for (const o of output) {
        const c = o?.content;
        if (Array.isArray(c)) {
          for (const part of c) {
            const t = safeStr(part?.text);
            if (t) chunks.push(t);
          }
        }
      }
      const joined = chunks.join("\n").trim();
      if (!joined) return null;
      const p2 = safeJsonParse<AdvisorResult>(joined);
      if (p2?.answer) return p2;
    }
  } catch {}

  return null;
}

async function callOpenAI({ question, scope, ctxSummary }: { question: string; scope: Scope; ctxSummary: any }): Promise<AdvisorResult> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.WIRE_AI_API_KEY || "";
  if (!apiKey) return defaultAdvisorResult(heuristicAnswer(question, scope, ctxSummary));

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const temperature = (() => {
    const t = Number(process.env.OPENAI_TEMPERATURE);
    return Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0.2;
  })();

  const contextJson = clamp(JSON.stringify(ctxSummary ?? {}, null, 2), 12000);

  const user = [
    `Scope: ${scope}`,
    "",
    "Context (JSON):",
    contextJson,
    "",
    "User question:",
    question,
    "",
    "Return only JSON matching the schema.",
  ].join("\n");

  const payload = {
    model,
    temperature,
    input: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: user },
    ],
    max_output_tokens: 750,
    response_format: { type: "json_schema", json_schema: buildResponseSchema() },
  };

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return defaultAdvisorResult(heuristicAnswer(question, scope, ctxSummary) + `\n\n(LLM unavailable: ${res.status})`);
  }

  const data: any = await res.json().catch(() => null);
  const parsed = data ? extractResponseJson(data) : null;
  if (parsed?.answer) return parsed;

  return defaultAdvisorResult(heuristicAnswer(question, scope, ctxSummary));
}

/* ---------------- KB context loader ---------------- */

function safeJsonSnippet(x: any, max = 4000) {
  try {
    if (x == null) return "";
    if (typeof x === "string") return clamp(x, max);
    return clamp(JSON.stringify(x, null, 2), max);
  } catch {
    return clamp(safeStr(x), max);
  }
}

async function loadKbArticleContext(supabase: any, args: { articleId?: string; articleSlug?: string }) {
  const id = safeStr(args.articleId).trim();
  const slug = safeLower(args.articleSlug);

  if (!id && !slug) return null;

  let q = supabase
    .from("governance_articles")
    .select("id,slug,title,summary,content,category_id,updated_at")
    .eq("is_published", true);

  if (id) q = q.eq("id", id);
  else q = q.eq("slug", slug);

  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    slug: data.slug,
    title: data.title,
    summary: data.summary,
    updated_at: data.updated_at,
    category_id: data.category_id,
    excerpt: safeJsonSnippet((data as any).content, 4000),
  };
}

/* ---------------- Project context loader ---------------- */

async function loadProjectContext(supabase: any, projectId: string) {
  const pid = safeStr(projectId).trim();
  const ctx: any = {};

  try {
    const { data } = await supabase
      .from("projects")
      .select("id,title,project_code,organisation_id,client_name,created_at")
      .eq("id", pid)
      .maybeSingle();
    if (data) ctx.project = data;
  } catch {}

  try {
    const { data } = await supabase
      .from("project_members")
      .select("role,is_active,removed_at")
      .eq("project_id", pid)
      .is("removed_at", null);

    const list = Array.isArray(data) ? data : [];
    ctx.members = {
      total: list.length,
      owners: list.filter((m: any) => safeLower(m.role) === "owner").length,
      editors: list.filter((m: any) => {
        const r = safeLower(m.role);
        return r === "owner" || r === "editor";
      }).length,
      viewers: list.filter((m: any) => safeLower(m.role) === "viewer").length,
      continuity_ok: list.filter((m: any) => safeLower(m.role) === "owner").length >= 2,
    };
  } catch {}

  try {
    const { data } = await supabase
      .from("artifacts")
      .select("id,title,type,artifact_type,approval_status,status,is_current,deleted_at,updated_at,created_at,owner_user_id")
      .eq("project_id", pid)
      .is("deleted_at", null)
      .eq("is_current", true);

    ctx.artifacts = Array.isArray(data) ? data : [];
    ctx.staleDraftsTop = ctx.artifacts
      .filter((a: any) => safeLower(a?.approval_status || a?.status) === "draft")
      .map((a: any) => ({
        id: a.id,
        title: a.title,
        type: a.artifact_type || a.type || "artifact",
        age_days: daysSince(a.updated_at || a.created_at) ?? undefined,
        owner_missing: !a.owner_user_id,
      }))
      .sort((a: any, b: any) => (b.age_days ?? 0) - (a.age_days ?? 0))
      .slice(0, 5);
  } catch {}

  // ... (rest of your loader unchanged)
  // NOTE: Keep your existing change_requests / raid_items / approval_steps / milestones / work_items logic here.
  // I’m not re-pasting the unchanged parts to avoid accidental divergence.

  return ctx;
}

/* ---------------- handler ---------------- */

export async function POST(req: Request) {
  const supabase = await createClient();

  try {
    const body = await req.json().catch(() => ({} as any));

    const scope = asScope(body?.scope);
    const mode = clamp(safeLower(body?.mode || "advisor"), 40);
    const question = clamp(safeStr(body?.question || body?.q).trim(), 1200);
    const debug = safeLower(body?.debug) === "true" || body?.debug === true;

    const projectId = safeStr(body?.projectId || body?.project_id).trim();

    // KB inputs
    const articleId = safeStr(body?.articleId || body?.article_id).trim();
    const articleSlug = safeLower(body?.articleSlug || body?.article_slug || body?.article);

    if (!question) return jsonErr("Missing question", 400, undefined, NO_STORE_HEADERS);

    // ✅ Enterprise-safe default: require auth for ALL scopes
    // If you want KB advisor public, explicitly set PUBLIC_KB_ADVISOR=true
    const allowPublicKb = safeLower(process.env.PUBLIC_KB_ADVISOR || "") === "true";
    const user = scope === "kb" && allowPublicKb ? null : await requireAuth(supabase);

    let ctx: any = {};

    if (scope === "project") {
      if (!projectId) return jsonErr("Missing projectId", 400, undefined, NO_STORE_HEADERS);
      await requireProjectMember(supabase, projectId, user!.id, "viewer");
      ctx = await loadProjectContext(supabase, projectId);
    }

    if (scope === "kb") {
      const kbArticle = await loadKbArticleContext(supabase, { articleId, articleSlug });
      ctx.kb = { article: kbArticle };
    }

    const ctxSummary = summarizeContext(ctx);

    const recommendedRoutes = buildRecommendedRoutes(
      scope,
      scope === "project" ? projectId : null,
      safeStr(ctxSummary?.kb?.article?.slug) || null
    );

    const baseline = buildServerBaselineResult({
      question: `[${mode}] ${question}`,
      scope,
      ctxSummary,
      recommendedRoutes,
    });

    const modelResult = await callOpenAI({
      question: `[${mode}] ${question}`,
      scope,
      ctxSummary,
    });

    const merged: AdvisorResult = {
      ...baseline,
      ...modelResult,
      recommended_routes: recommendedRoutes,
      key_drivers:
        Array.isArray(modelResult?.key_drivers) && modelResult.key_drivers.length ? modelResult.key_drivers : baseline.key_drivers,
      blockers: Array.isArray(modelResult?.blockers) && modelResult.blockers.length ? modelResult.blockers : baseline.blockers,
      today_actions:
        Array.isArray(modelResult?.today_actions) && modelResult.today_actions.length ? modelResult.today_actions : baseline.today_actions,
      data_requests: Array.isArray(modelResult?.data_requests) ? modelResult.data_requests : baseline.data_requests,
    };

    const response: any = {
      answer: safeStr(merged?.answer),
      result: merged,
    };
    if (debug) response.context = ctxSummary;

    return jsonOk(response, 200, NO_STORE_HEADERS);
  } catch (e: any) {
    const status = typeof e?.status === "number" && e.status >= 400 && e.status <= 599 ? e.status : 500;
    return jsonErr(e?.message || "Server error", status, undefined, NO_STORE_HEADERS);
  }
}