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
  return NextResponse.json(
    { ok: false, error: message, ...(extra ? { extra } : {}) },
    { status, headers }
  );
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
      required: [
        "answer",
        "confidence",
        "key_drivers",
        "blockers",
        "today_actions",
        "recommended_routes",
        "data_requests",
      ],
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

async function callOpenAI({
  question,
  scope,
  ctxSummary,
}: {
  question: string;
  scope: Scope;
  ctxSummary: any;
}): Promise<AdvisorResult> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.WIRE_AI_API_KEY || "";
  if (!apiKey) return defaultAdvisorResult(heuristicAnswer(question, scope, ctxSummary));

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const temperature = (() => {
    const t = Number(process.env.OPENAI_TEMPERATURE);
    return Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0.2;
  })();

  // Hard cap what the LLM sees (prevents prompt bloat + leakage)
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
    return defaultAdvisorResult(
      heuristicAnswer(question, scope, ctxSummary) + `\n\n(LLM unavailable: ${res.status})`
    );
  }

  const data: any = await res.json().catch(() => null);
  const parsed = data ? extractResponseJson(data) : null;
  if (parsed?.answer) return parsed;

  return defaultAdvisorResult(heuristicAnswer(question, scope, ctxSummary));
}

/* ---------------- KB context loader ---------------- */

async function loadKbArticleContext(
  supabase: any,
  args: { articleId?: string; articleSlug?: string }
) {
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
    excerpt: clamp(safeStr(data.content), 4000),
  };
}

/* ---------------- Project context loader (existing) ---------------- */

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
      .select(
        "id,title,type,artifact_type,approval_status,status,is_current,deleted_at,updated_at,created_at,owner_user_id"
      )
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

  try {
    const { data } = await supabase
      .from("change_requests")
      .select("id,title,decision_status,delivery_status,priority,updated_at,created_at")
      .eq("project_id", pid)
      .order("updated_at", { ascending: false })
      .limit(200);

    const items = Array.isArray(data) ? data : [];
    const byDecision: Record<string, number> = {};
    const byDelivery: Record<string, number> = {};

    for (const it of items) {
      const ds = safeLower((it as any)?.decision_status || "unknown") || "unknown";
      const ls = safeLower((it as any)?.delivery_status || "unknown") || "unknown";
      byDecision[ds] = (byDecision[ds] || 0) + 1;
      byDelivery[ls] = (byDelivery[ls] || 0) + 1;
    }

    const pendingTail = items
      .filter((it: any) => {
        const ds = safeLower(it?.decision_status || "");
        return ds === "pending" || ds === "in_review" || ds === "submitted" || ds === "draft";
      })
      .map((it: any) => ({
        id: it.id,
        title: it.title,
        decision_status: it.decision_status,
        age_days: daysSince(it.updated_at || it.created_at) ?? undefined,
      }))
      .sort((a: any, b: any) => (b.age_days ?? 0) - (a.age_days ?? 0))
      .slice(0, 5);

    ctx.changes = { count: items.length, byDecision, byDelivery, pending_tail_top: pendingTail };
  } catch {}

  try {
    const { data } = await supabase
      .from("raid_items")
      .select("id,type,title,severity,status,due_date,updated_at,created_at")
      .eq("project_id", pid)
      .order("updated_at", { ascending: false })
      .limit(200);

    const items = Array.isArray(data) ? data : [];
    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const now = Date.now();

    const enriched = items.map((it: any) => {
      const sevNum = Number(it?.severity);
      const sev = Number.isFinite(sevNum) ? sevNum : undefined;
      const updated = new Date(it?.updated_at || it?.created_at || now);
      const ageDays = Number.isFinite(updated.getTime())
        ? Math.max(0, Math.floor((now - updated.getTime()) / 86400000))
        : undefined;
      return { id: it.id, type: it.type, title: it.title, severity: sev, status: it.status, age_days: ageDays };
    });

    const staleHigh = enriched
      .filter((x: any) => (x.severity ?? 0) >= 4 && (x.age_days ?? 0) >= 14)
      .sort((a: any, b: any) => (b.age_days ?? 0) - (a.age_days ?? 0))
      .slice(0, 5);

    for (const it of items) {
      const t = safeLower((it as any)?.type || "unknown") || "unknown";
      const s = safeLower(String((it as any)?.severity || "unknown")) || "unknown";
      byType[t] = (byType[t] || 0) + 1;
      bySeverity[s] = (bySeverity[s] || 0) + 1;
    }

    ctx.raid = { count: items.length, byType, bySeverity, stale_high: staleHigh.length, stale_high_top: staleHigh };
  } catch {}

  try {
    const { data } = await supabase
      .from("artifact_approval_steps")
      .select("id,artifact_id,step_status,name,due_at,updated_at,created_at,approver_type,approver_ref")
      .eq("project_id", pid)
      .order("updated_at", { ascending: false })
      .limit(300);

    const steps = Array.isArray(data) ? data : [];

    const pendingSteps = steps
      .filter((s: any) => {
        const st = safeLower(s?.step_status);
        return st === "pending" || st === "in_review";
      })
      .map((s: any) => ({
        id: s.id,
        artifact_id: s.artifact_id,
        name: s.name || "Approval step",
        step_status: s.step_status,
        due_at: s.due_at,
        age_days: daysSince(s.updated_at || s.created_at) ?? undefined,
      }))
      .sort((a: any, b: any) => (b.age_days ?? 0) - (a.age_days ?? 0))
      .slice(0, 8);

    const requested = steps.filter((s: any) => safeLower(s?.step_status) === "changes_requested").length;

    ctx.approvals = { steps: steps.length, pending: pendingSteps.length, changes_requested: requested, pending_top: pendingSteps };
  } catch {}

  try {
    let rows: any[] = [];
    const first = await supabase
      .from("schedule_milestones")
      .select("id,milestone_name,start_date,end_date,status,updated_at,created_at")
      .eq("project_id", pid)
      .order("end_date", { ascending: true })
      .limit(200);

    if (!first.error && Array.isArray(first.data)) {
      rows = first.data;
    } else if (
      first.error &&
      (isMissingColumnError(first.error.message, "updated_at") || isMissingColumnError(first.error.message, "created_at"))
    ) {
      const fb = await supabase
        .from("schedule_milestones")
        .select("id,milestone_name,start_date,end_date,status")
        .eq("project_id", pid)
        .order("end_date", { ascending: true })
        .limit(200);
      rows = Array.isArray(fb.data) ? fb.data : [];
    }

    const enriched = rows.map((m: any) => {
      const due = parseDateAny(m?.end_date ?? m?.start_date);
      const overdue =
        !!(due && inPastUtc(due)) &&
        safeLower(m?.status) !== "done" &&
        safeLower(m?.status) !== "completed" &&
        safeLower(m?.status) !== "closed";

      return { id: m?.id, title: m?.milestone_name, status: m?.status, due_date: m?.end_date ?? m?.start_date ?? null, overdue };
    });

    const overdueTop = enriched.filter((m: any) => m.overdue).slice(0, 8);
    ctx.milestones = { count: rows.length, overdue: overdueTop.length, overdue_top: overdueTop };
  } catch {}

  try {
    const { data } = await supabase
      .from("work_items")
      .select("id,title,status,stage,due_date,updated_at,created_at")
      .eq("project_id", pid)
      .order("due_date", { ascending: true })
      .limit(200);

    const items = Array.isArray(data) ? data : [];
    const overdueTop = items
      .map((w: any) => {
        const due = parseDateAny(w?.due_date);
        const overdue =
          !!(due && inPastUtc(due)) &&
          safeLower(w?.status) !== "done" &&
          safeLower(w?.status) !== "completed" &&
          safeLower(w?.status) !== "closed";
        return { id: w?.id, title: w?.title, status: w?.status, due_date: w?.due_date ?? null, overdue };
      })
      .filter((x: any) => x.overdue)
      .slice(0, 8);

    ctx.work_items = { count: items.length, overdue: overdueTop.length, overdue_top: overdueTop };
  } catch {}

  try {
    const owners = Number(ctx?.members?.owners ?? 0);
    const pending = Number(ctx?.approvals?.pending ?? 0);
    const staleHigh = Number(ctx?.raid?.stale_high ?? 0);
    const missingOwners = Array.isArray(ctx?.artifacts) ? ctx.artifacts.filter((a: any) => !a?.owner_user_id).length : 0;
    const overdueMs = Number(ctx?.milestones?.overdue ?? 0);
    const overdueWi = Number(ctx?.work_items?.overdue ?? 0);
    const pendingChangesTail = Array.isArray(ctx?.changes?.pending_tail_top) ? ctx.changes.pending_tail_top.length : 0;

    let score = 100;
    const drivers: string[] = [];

    if (owners < 2) { score -= 15; drivers.push("Owners coverage < 2."); }
    if (pending > 0) { score -= Math.min(20, 5 + pending * 2); drivers.push(`Pending approvals: ${pending}.`); }
    if (staleHigh > 0) { score -= Math.min(20, staleHigh * 5); drivers.push(`Stale high-severity RAID: ${staleHigh}.`); }
    if (missingOwners > 0) { score -= Math.min(15, missingOwners * 2); drivers.push(`Artifacts missing owner: ${missingOwners}.`); }
    if (overdueMs > 0) { score -= Math.min(15, overdueMs * 4); drivers.push(`Overdue milestones: ${overdueMs}.`); }
    if (overdueWi > 0) { score -= Math.min(15, overdueWi * 3); drivers.push(`Overdue work items: ${overdueWi}.`); }
    if (pendingChangesTail > 0) { score -= Math.min(10, pendingChangesTail * 2); drivers.push(`Changes lingering: ${pendingChangesTail}.`); }

    score = Math.max(0, Math.min(100, Math.round(score)));
    const band: "green" | "amber" | "red" = score >= 75 ? "green" : score >= 55 ? "amber" : "red";

    ctx.signals = {
      health_score: score,
      band,
      drivers,
      counts: {
        owners,
        pending_approvals: pending,
        stale_high_raid: staleHigh,
        artifacts_missing_owner: missingOwners,
        overdue_milestones: overdueMs,
        overdue_work_items: overdueWi,
        changes_pending_tail: pendingChangesTail,
      },
    };
  } catch {}

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

    // Auth only required for non-KB
    const user = scope === "kb" ? null : await requireAuth(supabase);

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
        Array.isArray(modelResult?.key_drivers) && modelResult.key_drivers.length
          ? modelResult.key_drivers
          : baseline.key_drivers,
      blockers:
        Array.isArray(modelResult?.blockers) && modelResult.blockers.length
          ? modelResult.blockers
          : baseline.blockers,
      today_actions:
        Array.isArray(modelResult?.today_actions) && modelResult.today_actions.length
          ? modelResult.today_actions
          : baseline.today_actions,
      data_requests: Array.isArray(modelResult?.data_requests)
        ? modelResult.data_requests
        : baseline.data_requests,
    };

    // Clean response: never echo full context unless explicitly requested
    const response: any = {
      answer: safeStr(merged?.answer),
      result: merged,
    };
    if (debug) response.context = ctxSummary;

    return jsonOk(response, 200, NO_STORE_HEADERS);
  } catch (e: any) {
    const status =
      typeof e?.status === "number" && e.status >= 400 && e.status <= 599 ? e.status : 500;
    return jsonErr(e?.message || "Server error", status, undefined, NO_STORE_HEADERS);
  }
}