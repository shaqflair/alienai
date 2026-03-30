// src/app/api/ai/events/route.ts — REBUILT v7 + AI health logging
// ✅ Write-focused AI/events endpoint
// ✅ All responses remain no-store
// ✅ Project-detail branches remain org-member/project-access controlled
// ✅ project_events insert + trigger-engine wiring for governance suggestion generation
// ✅ AI health logging (success / failure / slow / empty / invalid_json)
// ✅ artifact_due removed from this endpoint; use shared server loaders for due digest reads

import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { buildPmImpactAssessment, safeNum as safeNumAi } from "@/lib/ai/change-ai";
import { processEventAndGenerateSuggestions } from "@/lib/ai/trigger-engine";
import { logAiHealthEvent } from "@/lib/ai/health-logger";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ── ai health ─────────────────────────────────────────────────────────── */

const AI_HEALTH_ENDPOINT = "/api/ai/events";
const AI_SLOW_RESPONSE_MS = 8000;

type AiHealthSignal =
  | "success"
  | "failure"
  | "timeout"
  | "empty_output"
  | "invalid_json"
  | "slow_response";
type AiHealthSeverity = "info" | "warning" | "critical";

async function safeLogRouteHealth(args: {
  projectId?: string | null;
  artifactId?: string | null;
  eventType: AiHealthSignal;
  severity: AiHealthSeverity;
  routeEventType?: string | null;
  model?: string | null;
  latencyMs?: number | null;
  success?: boolean;
  errorMessage?: string | null;
  metadata?: Record<string, any> | null;
}) {
  try {
    const success =
      args.success ?? (args.eventType !== "failure" && args.eventType !== "timeout");

    await logAiHealthEvent({
      projectId: args.projectId ?? undefined,
      artifactId: args.artifactId ?? undefined,
      eventType: args.eventType,
      severity: args.severity,
      endpoint: AI_HEALTH_ENDPOINT,
      model: args.model ?? undefined,
      latencyMs: args.latencyMs ?? undefined,
      success,
      errorMessage: args.errorMessage ?? undefined,
      metadata: {
        routeEventType: args.routeEventType ?? null,
        ...(args.metadata ?? {}),
      },
    });
  } catch (err) {
    console.error("[ai/events] health logging failed", err);
  }
}

async function maybeLogSlowRouteHealth(args: {
  projectId?: string | null;
  artifactId?: string | null;
  routeEventType?: string | null;
  model?: string | null;
  latencyMs?: number | null;
  metadata?: Record<string, any> | null;
}) {
  const latencyMs = Number(args.latencyMs ?? 0);
  if (!Number.isFinite(latencyMs) || latencyMs < AI_SLOW_RESPONSE_MS) return;

  await safeLogRouteHealth({
    projectId: args.projectId ?? null,
    artifactId: args.artifactId ?? null,
    eventType: "slow_response",
    severity: "warning",
    routeEventType: args.routeEventType ?? null,
    model: args.model ?? null,
    latencyMs,
    success: true,
    metadata: {
      thresholdMs: AI_SLOW_RESPONSE_MS,
      ...(args.metadata ?? {}),
    },
  });
}

function extractUsageMeta(usage: any) {
  const inputTokens =
    Number.isFinite(Number(usage?.prompt_tokens)) ? Number(usage.prompt_tokens) : null;
  const outputTokens =
    Number.isFinite(Number(usage?.completion_tokens)) ? Number(usage.completion_tokens) : null;
  const totalTokens =
    Number.isFinite(Number(usage?.total_tokens)) ? Number(usage.total_tokens) : null;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

/* ── utils ─────────────────────────────────────────────────────────────── */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function jsonNoStore(payload: any, init?: ResponseInit) {
  const res = NextResponse.json(payload, init);
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}
function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}
function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}
function clampInt(n: any, min: number, max: number, fallback: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}
function safeJson(x: any): any {
  if (!x) return null;
  if (typeof x === "object") return x;
  try {
    return JSON.parse(String(x));
  } catch {
    return null;
  }
}
function startOfUtcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
}
function endOfUtcWindow(from: Date, windowDays: number) {
  return new Date(from.getTime() + windowDays * 24 * 60 * 60 * 1000);
}
function parseWindowDays(raw: any, fallback: number): number {
  const s = safeStr(raw).trim().toLowerCase();
  if (s === "all") return 60;
  return clampInt(raw, 1, 90, fallback);
}
function parseDueToUtcDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const s = safeStr(value).trim();
  if (!s || s === "—" || s.toLowerCase() === "na" || s.toLowerCase() === "n/a") return null;
  const isoTry = new Date(s);
  if (!isNaN(isoTry.getTime())) return isoTry;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    return new Date(
      Date.UTC(
        clampInt(m[3], 1900, 3000, 2000),
        clampInt(m[2], 1, 12, 1) - 1,
        clampInt(m[1], 1, 31, 1),
        0,
        0,
        0
      )
    );
  }
  return null;
}
function mergeBits(parts: Array<string | null | undefined>) {
  return parts
    .map((x) => safeStr(x).trim())
    .filter(Boolean)
    .join("\n\n");
}
function normalizeProjectIdentifier(input: string) {
  let v = safeStr(input).trim();
  try {
    v = decodeURIComponent(v);
  } catch {}
  v = v.trim();
  const m = v.match(/(\d{3,})$/);
  if (m?.[1]) return m[1];
  return v;
}
function isMissingColumnError(errMsg: string, col: string) {
  const m = String(errMsg || "").toLowerCase();
  const c = col.toLowerCase();
  return (
    (m.includes("column") && m.includes(c) && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes(c)) ||
    m.includes("unknown column")
  );
}
function isNumericLike(s: string) {
  return /^\d+$/.test(String(s || "").trim());
}

/* ── event trigger helpers ─────────────────────────────────────────────── */

function deriveEventSeverity(eventType: string, payload: any): "info" | "warning" | "critical" {
  const explicit = safeLower(payload?.severity);
  if (explicit === "info" || explicit === "warning" || explicit === "critical") return explicit;

  const t = safeLower(eventType);
  if (
    t.includes("critical") ||
    t.includes("rejected") ||
    t.includes("failed") ||
    t.includes("breach") ||
    t.includes("escalated")
  ) {
    return "critical";
  }
  if (
    t.includes("delayed") ||
    t.includes("overdue") ||
    t.includes("submitted") ||
    t.includes("changes_requested") ||
    t.includes("warning")
  ) {
    return "warning";
  }
  return "info";
}

function shouldPersistProjectEvent(eventType: string): boolean {
  const t = safeLower(eventType);
  if (!t) return false;

  const ignore = new Set([
    "artifact_due",
    "delivery_report",
    "weekly_report_narrative",
    "change_ai_impact_assessment",
  ]);
  if (ignore.has(t)) return false;

  if (
    t.startsWith("artifact_") ||
    t.startsWith("approval_") ||
    t.startsWith("closure_") ||
    t.startsWith("change_") ||
    t.startsWith("raid_") ||
    t.startsWith("risk_") ||
    t.startsWith("issue_") ||
    t.startsWith("dependency_") ||
    t.startsWith("assumption_")
  ) {
    return true;
  }

  return (
    t.includes("artifact") ||
    t.includes("approval") ||
    t.includes("closure_report") ||
    t.includes("closure") ||
    t.includes("governance")
  );
}

function extractArtifactId(body: any, payload: any): string | null {
  const v =
    safeStr(body?.artifact_id).trim() ||
    safeStr(body?.artifactId).trim() ||
    safeStr(payload?.artifact_id).trim() ||
    safeStr(payload?.artifactId).trim() ||
    safeStr(payload?.source?.artifact_id).trim() ||
    safeStr(payload?.sourceArtifactId).trim();
  return v || null;
}

function extractSectionKey(body: any, payload: any): string | null {
  const v =
    safeStr(body?.section_key).trim() ||
    safeStr(body?.sectionKey).trim() ||
    safeStr(payload?.section_key).trim() ||
    safeStr(payload?.sectionKey).trim();
  return v || null;
}

async function createProjectEventAndRunEngine(args: {
  supabase: any;
  projectId: string;
  eventType: string;
  body: any;
  payload: any;
  userId: string | null;
}) {
  const { supabase, projectId, eventType, body, payload, userId } = args;

  const artifactId = extractArtifactId(body, payload);
  const sectionKey = extractSectionKey(body, payload);

  const eventPayload =
    payload && typeof payload === "object"
      ? {
          ...payload,
          project_id: safeStr(payload?.project_id).trim() || projectId,
          artifact_id: safeStr(payload?.artifact_id).trim() || artifactId,
          section_key: safeStr(payload?.section_key).trim() || sectionKey,
        }
      : {
          value: payload ?? null,
          project_id: projectId,
          artifact_id: artifactId,
          section_key: sectionKey,
        };

  const insertRow = {
    project_id: projectId,
    artifact_id: artifactId,
    section_key: sectionKey,
    event_type: eventType,
    actor_user_id: userId || null,
    source: "app" as const,
    severity: deriveEventSeverity(eventType, eventPayload),
    payload: eventPayload,
  };

  const { data, error } = await supabase
    .from("project_events")
    .insert(insertRow)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const eventId = safeStr(data?.id).trim();
  if (!eventId) return null;

  try {
    await processEventAndGenerateSuggestions(eventId);
  } catch (e: any) {
    console.error("[ai/events] trigger-engine failed", {
      eventId,
      eventType,
      error: e?.message ?? e,
    });
  }

  return eventId;
}

/* ── auth error classifier ──────────────────────────────────────────────── */

function isAuthError(e: any): boolean {
  const msg = safeStr(e?.message).toLowerCase();
  return (
    msg === "unauthorized" ||
    msg === "forbidden" ||
    msg.includes("jwt") ||
    msg.includes("not authenticated") ||
    msg.includes("invalid token") ||
    msg.includes("token expired") ||
    msg.includes("refresh_token_not_found") ||
    msg.includes("user not found") ||
    msg.includes("session_not_found") ||
    msg.includes("auth session missing") ||
    (msg.includes("auth") && msg.includes("error"))
  );
}

/* ── auth ──────────────────────────────────────────────────────────────── */

async function requireAuth(supabase: any) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");
  return auth.user;
}

async function requireProjectAccessViaOrg(supabase: any, projectUuid: string, userId: string) {
  const { data, error } = await supabase
    .from("projects")
    .select("id,organisation_id,deleted_at")
    .eq("id", projectUuid)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.id || data.deleted_at != null) throw new Error("Project not found");

  const orgId = safeStr(data.organisation_id).trim();
  if (!orgId) throw new Error("Forbidden");

  const { data: mem, error: memErr } = await supabase
    .from("organisation_members")
    .select("role,removed_at")
    .eq("organisation_id", orgId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);
  if (!mem) throw new Error("Forbidden");

  return { organisation_id: orgId, role: safeStr(mem.role).trim() || "member" };
}

/* ── project resolver ───────────────────────────────────────────────────── */

const HUMAN_COL_CANDIDATES = [
  "project_code",
  "project_human_id",
  "human_id",
  "code",
  "slug",
  "reference",
  "ref",
] as const;

async function resolveProjectUuid(supabase: any, identifier: string): Promise<string | null> {
  const raw = safeStr(identifier).trim();
  if (!raw) return null;
  if (looksLikeUuid(raw)) return raw;

  const id = normalizeProjectIdentifier(raw);

  for (const col of HUMAN_COL_CANDIDATES) {
    const likelyNumeric =
      col === "project_code" || col === "human_id" || col === "project_human_id";
    if (likelyNumeric && !isNumericLike(id)) continue;

    const { data, error } = await supabase
      .from("projects")
      .select("id")
      .eq(col as any, id)
      .maybeSingle();

    if (error) {
      if (isMissingColumnError(error.message, col)) continue;
      throw new Error(error.message);
    }
    if (data?.id) return String(data.id);
  }

  for (const col of ["slug", "reference", "ref", "code"] as const) {
    const { data, error } = await supabase
      .from("projects")
      .select("id")
      .eq(col as any, raw)
      .maybeSingle();

    if (error) {
      if (isMissingColumnError(error.message, col)) continue;
      throw new Error(error.message);
    }
    if (data?.id) return String(data.id);
  }

  return null;
}

/* ── project meta ───────────────────────────────────────────────────────── */

type ProjectMeta = {
  project_human_id: string | null;
  project_code: string | null;
  project_name: string | null;
  project_manager_user_id: string | null;
  project_manager_name: string | null;
  project_manager_email: string | null;
};

async function loadProjectMeta(supabase: any, projectUuid: string): Promise<ProjectMeta> {
  const { data: proj, error } = await supabase
    .from("projects")
    .select("id,title,project_code")
    .eq("id", projectUuid)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const project_code = safeStr((proj as any)?.project_code).trim() || null;
  const project_name = safeStr((proj as any)?.title).trim() || null;

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("user_id,created_at,role,removed_at")
    .eq("project_id", projectUuid)
    .in("role", ["project_manager", "owner"] as any)
    .is("removed_at", null)
    .order("created_at", { ascending: true })
    .limit(25);

  if (memErr) throw new Error(memErr.message);

  const rows = Array.isArray(mem) ? mem : [];
  const pmRow =
    rows.find((x: any) => safeLower(x?.role) === "project_manager" && x?.user_id) ||
    rows.find((x: any) => safeLower(x?.role) === "owner" && x?.user_id) ||
    rows.find((x: any) => x?.user_id);

  const pmUserId = pmRow?.user_id ? String(pmRow.user_id) : null;

  let project_manager_name: string | null = null;
  let project_manager_email: string | null = null;

  if (pmUserId) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name,email")
      .eq("user_id", pmUserId)
      .maybeSingle();

    project_manager_name = safeStr((prof as any)?.full_name).trim() || "Project Manager";
    project_manager_email = safeStr((prof as any)?.email).trim() || null;
  }

  return {
    project_human_id: project_code,
    project_code,
    project_name,
    project_manager_user_id: pmUserId,
    project_manager_name,
    project_manager_email,
  };
}

/* ── draft assist ───────────────────────────────────────────────────────── */

function buildDraftAssistAi(input: any) {
  const title = safeStr(input?.title).trim();
  const summary = safeStr(input?.summary).trim();
  const justification = safeStr(input?.justification).trim();
  const financial = safeStr(input?.financial).trim();
  const schedule = safeStr(input?.schedule).trim();
  const risks = safeStr(input?.risks).trim();
  const dependencies = safeStr(input?.dependencies).trim();
  const assumptions = safeStr(input?.assumptions).trim();
  const implementation = safeStr(input?.implementation).trim();
  const rollback = safeStr(input?.rollback).trim();
  const interview = input?.interview ?? {};

  const about = safeStr(interview?.about).trim();
  const why = safeStr(interview?.why).trim();
  const impacted = safeStr(interview?.impacted).trim();
  const when = safeStr(interview?.when).trim();
  const constraints = safeStr(interview?.constraints).trim();
  const costs = safeStr(interview?.costs).trim();
  const riskLevel = safeStr(interview?.riskLevel).trim() || "Medium";
  const rollbackInterview = safeStr(interview?.rollback).trim();

  const bestTitle = title || about;
  const bestSummary =
    summary ||
    mergeBits([
      about ? `Change: ${about}.` : "",
      why ? `Purpose: ${why}.` : "",
      impacted ? `Impact: ${impacted}.` : "",
      when ? `Timing: ${when}.` : "",
    ]);

  const bestJustification =
    justification ||
    mergeBits([
      why ? `Driver / value: ${why}` : "",
      constraints ? `Governance / constraints: ${constraints}` : "",
      bestTitle
        ? `Outcome: Deliver "${bestTitle}" with controlled risk and clear validation evidence.`
        : "",
    ]) ||
    "State why the change is required, business benefit, and risk of not proceeding.";

  const bestFinancial =
    financial ||
    (costs
      ? `Known costs / effort: ${costs}\nBudget/PO: TBC\nCommercial notes: confirm rate card / approvals.`
      : "") ||
    "Confirm cost, resource effort, and any commercial approvals required.";

  const bestSchedule =
    schedule ||
    mergeBits([
      when ? `Target window/milestone: ${when}` : "",
      "Plan: design → approvals → implement → validate → handover/close.",
      "Dependencies: confirm CAB/Change window and sequencing with release calendar.",
    ]) ||
    "Outline target window, milestones, and sequencing.";

  const bestRisks =
    risks ||
    mergeBits([
      `Risk level: ${riskLevel}`,
      "Risks: service disruption, access/security misconfiguration, rollback complexity.",
      "Mitigations: peer review, CAB approval, change window, comms plan, validation checklist.",
    ]) ||
    "Identify top risks and mitigations.";

  const bestDependencies =
    dependencies ||
    mergeBits([
      constraints ? `Approvals: ${constraints}` : "",
      "Dependencies: vendor availability, test environment readiness, access prerequisites, monitoring/alerting.",
    ]) ||
    "Capture approvals, vendors, prerequisites, and tooling.";

  const bestAssumptions =
    assumptions ||
    mergeBits([
      "Assumptions: stakeholder availability, change window access, environments stable, test accounts ready.",
      "Unknowns: confirm impacted services/users and acceptance criteria.",
    ]) ||
    "State assumptions and unknowns to validate.";

  const bestImplementation =
    implementation ||
    mergeBits([
      "Implementation steps:",
      "1) Pre-checks (access, backups/snapshots, approvals logged)",
      "2) Implement change (controlled / scripted where possible)",
      "3) Validate (functional + monitoring checks)",
      "4) Communicate completion + evidence",
      "5) Update docs / handover",
    ]) ||
    "Define pre-checks, controlled change steps, validation, and handover.";

  const bestRollback =
    rollback ||
    mergeBits([
      rollbackInterview
        ? `Rollback approach: ${rollbackInterview}`
        : "Rollback approach: revert configuration / disable new access; restore previous state.",
      "Validation evidence: screenshots/log extracts, monitoring green, stakeholder sign-off.",
    ]) ||
    "Define safe backout and validation evidence.";

  return {
    summary: bestSummary,
    justification: bestJustification,
    financial: bestFinancial,
    schedule: bestSchedule,
    risks: bestRisks,
    dependencies: bestDependencies,
    assumptions: bestAssumptions,
    implementation: bestImplementation,
    rollback: bestRollback,
    impact: { days: 1, cost: 0, risk: "Medium — validate in change window" },
  };
}

/* ── weekly_report_narrative ───────────────────────────────────────────── */

async function buildWeeklyReportNarrative(payload: any): Promise<{
  headline: string;
  narrative: string;
  delivered: Array<{ text: string }>;
  planNextWeek: Array<{ text: string }>;
  resourceSummary: Array<{ text: string }>;
  keyDecisions: Array<{ text: string; link: null }>;
  blockers: Array<{ text: string; link: null }>;
  _meta: {
    model: string;
    usage: ReturnType<typeof extractUsageMeta>;
  };
}> {
  const {
    ragStatus = "green",
    healthContext = "",
    projectName = "",
    projectCode = "",
    managerName = "",
    period,
  } = payload ?? {};

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const systemPrompt = `You are a senior project delivery manager writing weekly executive status reports.

STYLE RULES — follow exactly:

Headline ("headline"):
- One sentence, max 12 words.
- Format: "[Project] — [RAG label] ([score]% health)"

Executive narrative ("narrative"):
- 3-5 sentences of flowing prose. NO bullets. NO lists.
- Board-level: direct, factual, confident. No "I". No invented specifics.

Completed items ("delivered"): Past-tense verb-led phrases, 3-5 items.
Next period items ("planNextWeek"): Future-tense verb-led phrases, 3-5 items.
Resource summary ("resourceSummary"): 1-2 plain sentences on utilisation. 1-2 items.
Key decisions ("keyDecisions"): Concise noun phrases, 2-4 items.
Blockers ("blockers"): Noun phrases stating what is blocked and why. 0-3 items. Empty array if none obvious.

Return ONLY valid JSON — no markdown, no extra keys:
{
  "headline": "string",
  "narrative": "string",
  "delivered": [{ "text": "string" }],
  "planNextWeek": [{ "text": "string" }],
  "resourceSummary": [{ "text": "string" }],
  "keyDecisions": [{ "text": "string", "link": null }],
  "blockers": [{ "text": "string", "link": null }]
}`.trim();

  const userPrompt = `Project: ${projectName}${projectCode ? ` (${projectCode})` : ""}
${managerName ? `Project Manager: ${managerName}` : ""}
Period: ${period?.from ?? "this week"} to ${period?.to ?? "today"}
RAG Status: ${String(ragStatus).toUpperCase()}

Live health data:
${healthContext}

Generate the weekly report fields. Where data is insufficient, write realistic PM-editable placeholders. Do not leave any array field empty.`.trim();

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 800,
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  let result: Record<string, any> = {};
  try {
    result = JSON.parse(completion.choices[0].message.content ?? "{}");
  } catch {
    throw new Error("AI returned invalid JSON for weekly_report_narrative");
  }

  return {
    headline: typeof result.headline === "string" ? result.headline : "",
    narrative: typeof result.narrative === "string" ? result.narrative : "",
    delivered: Array.isArray(result.delivered) ? result.delivered : [],
    planNextWeek: Array.isArray(result.planNextWeek) ? result.planNextWeek : [],
    resourceSummary: Array.isArray(result.resourceSummary) ? result.resourceSummary : [],
    keyDecisions: Array.isArray(result.keyDecisions) ? result.keyDecisions : [],
    blockers: Array.isArray(result.blockers) ? result.blockers : [],
    _meta: {
      model: "gpt-4o-mini",
      usage: extractUsageMeta(completion.usage),
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   GET
══════════════════════════════════════════════════════════════════════════ */

export async function GET(_req: Request) {
  return jsonNoStore(
    {
      ok: false,
      error: "GET is not supported on this endpoint",
      hint: "Use shared server loaders for read models and due digest",
    },
    { status: 405 }
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   POST handler
══════════════════════════════════════════════════════════════════════════ */

export async function POST(req: Request) {
  const startedAt = Date.now();
  let healthProjectId: string | null = null;
  let healthArtifactId: string | null = null;
  let healthRouteEventType: string | null = null;

  try {
    const supabase = await createClient();
    const user = await requireAuth(supabase);

    const body = await req.json().catch(() => ({} as any));
    const eventType = safeStr(body?.eventType).trim();
    healthRouteEventType = eventType || "change_draft_assist_requested";

    const payload = (body && typeof body === "object" ? (body as any).payload : null) || null;
    healthArtifactId = extractArtifactId(body, payload);

    if (eventType === "artifact_due") {
      const latencyMs = Date.now() - startedAt;

      await safeLogRouteHealth({
        artifactId: healthArtifactId,
        eventType: "failure",
        severity: "warning",
        routeEventType: eventType,
        latencyMs,
        success: false,
        errorMessage: "artifact_due is no longer supported on this endpoint",
        metadata: {
          hint: "Use shared server loaders for due digest reads",
        },
      });

      return jsonNoStore(
        {
          ok: false,
          error: "artifact_due is no longer supported on this endpoint",
          hint: "Use shared server loaders for due digest reads",
        },
        { status: 400 }
      );
    }

    const rawProject =
      safeStr(body?.project_id).trim() ||
      safeStr(body?.projectId).trim() ||
      safeStr(body?.project_human_id).trim() ||
      safeStr(body?.payload?.project_id).trim() ||
      safeStr(body?.payload?.projectId).trim() ||
      safeStr(body?.payload?.project_human_id).trim();

    if (!rawProject) {
      const latencyMs = Date.now() - startedAt;

      await safeLogRouteHealth({
        eventType: "failure",
        severity: "warning",
        routeEventType: eventType || null,
        latencyMs,
        success: false,
        errorMessage: "Missing project id",
        metadata: { reason: "missing_project_id" },
      });

      return jsonNoStore({ ok: false, error: "Missing project id" }, { status: 400 });
    }

    const projectUuid = await resolveProjectUuid(supabase, rawProject);
    healthProjectId = projectUuid;

    if (!projectUuid) {
      const latencyMs = Date.now() - startedAt;

      await safeLogRouteHealth({
        eventType: "failure",
        severity: "warning",
        routeEventType: eventType || null,
        latencyMs,
        success: false,
        errorMessage: "Project not found",
        metadata: { rawProject },
      });

      return jsonNoStore(
        { ok: false, error: "Project not found", meta: { rawProject } },
        { status: 404 }
      );
    }

    await requireProjectAccessViaOrg(supabase, projectUuid, user.id);

    const meta = await loadProjectMeta(supabase, projectUuid);

    const draftId =
      safeStr((payload as any)?.draftId).trim() || safeStr(body?.draftId).trim() || "";

    if (eventType === "weekly_report_narrative") {
      try {
        const result = await buildWeeklyReportNarrative(payload);
        const emptyOutput =
          !safeStr(result.headline).trim() &&
          !safeStr(result.narrative).trim() &&
          (!Array.isArray(result.delivered) || result.delivered.length === 0) &&
          (!Array.isArray(result.planNextWeek) || result.planNextWeek.length === 0);

        const latencyMs = Date.now() - startedAt;

        if (emptyOutput) {
          await safeLogRouteHealth({
            projectId: projectUuid,
            artifactId: healthArtifactId,
            eventType: "empty_output",
            severity: "warning",
            routeEventType: eventType,
            model: result._meta.model,
            latencyMs,
            success: true,
            metadata: {
              usage: result._meta.usage,
            },
          });
        } else {
          await safeLogRouteHealth({
            projectId: projectUuid,
            artifactId: healthArtifactId,
            eventType: "success",
            severity: "info",
            routeEventType: eventType,
            model: result._meta.model,
            latencyMs,
            success: true,
            metadata: {
              usage: result._meta.usage,
              headlinePresent: !!safeStr(result.headline).trim(),
              narrativePresent: !!safeStr(result.narrative).trim(),
              deliveredCount: Array.isArray(result.delivered) ? result.delivered.length : 0,
              planNextWeekCount: Array.isArray(result.planNextWeek)
                ? result.planNextWeek.length
                : 0,
            },
          });
        }

        await maybeLogSlowRouteHealth({
          projectId: projectUuid,
          artifactId: healthArtifactId,
          routeEventType: eventType,
          model: result._meta.model,
          latencyMs,
          metadata: {
            usage: result._meta.usage,
          },
        });

        const { _meta, ...publicResult } = result;
        return jsonNoStore({ ok: true, ...publicResult });
      } catch (e: any) {
        const latencyMs = Date.now() - startedAt;
        const invalidJson = safeLower(e?.message).includes("invalid json");

        await safeLogRouteHealth({
          projectId: projectUuid,
          artifactId: healthArtifactId,
          eventType: invalidJson ? "invalid_json" : "failure",
          severity: invalidJson ? "warning" : "critical",
          routeEventType: eventType,
          model: "gpt-4o-mini",
          latencyMs,
          success: false,
          errorMessage: e?.message ?? "weekly_report_narrative failed",
        });

        return jsonNoStore(
          { ok: false, error: e?.message ?? "weekly_report_narrative failed" },
          { status: 500 }
        );
      }
    }

    if (eventType === "change_ai_impact_assessment") {
      const changeId =
        safeStr((payload as any)?.changeId).trim() ||
        safeStr((payload as any)?.change_id).trim() ||
        safeStr((body as any)?.changeId).trim() ||
        safeStr((body as any)?.artifactId).trim();

      if (!changeId) {
        const latencyMs = Date.now() - startedAt;

        await safeLogRouteHealth({
          projectId: projectUuid,
          artifactId: healthArtifactId,
          eventType: "failure",
          severity: "warning",
          routeEventType: eventType,
          latencyMs,
          success: false,
          errorMessage: "Missing changeId",
        });

        return jsonNoStore({ ok: false, error: "Missing changeId" }, { status: 400 });
      }

      let cr: any = null;

      const { data: d1, error: e1 } = await supabase
        .from("change_requests")
        .select(
          "id,project_id,title,description,delivery_status,decision_status,priority,impact_analysis,justification,financial,schedule,risks,dependencies,assumptions,implementation_plan,rollback_plan"
        )
        .eq("id", changeId)
        .eq("project_id", projectUuid)
        .maybeSingle();

      if (!e1) {
        cr = d1;
      } else {
        const { data: d2, error: e2 } = await supabase
          .from("change_requests")
          .select(
            "id,project_id,title,description,delivery_status,decision_status,priority,impact_analysis"
          )
          .eq("id", changeId)
          .eq("project_id", projectUuid)
          .maybeSingle();

        if (e2) {
          const latencyMs = Date.now() - startedAt;

          await safeLogRouteHealth({
            projectId: projectUuid,
            artifactId: healthArtifactId,
            eventType: "failure",
            severity: "critical",
            routeEventType: eventType,
            latencyMs,
            success: false,
            errorMessage: e2.message,
            metadata: { changeId },
          });

          return jsonNoStore({ ok: false, error: e2.message }, { status: 500 });
        }
        cr = d2;
      }

      if (!cr) {
        const latencyMs = Date.now() - startedAt;

        await safeLogRouteHealth({
          projectId: projectUuid,
          artifactId: healthArtifactId,
          eventType: "failure",
          severity: "warning",
          routeEventType: eventType,
          latencyMs,
          success: false,
          errorMessage: "Change request not found",
          metadata: { changeId },
        });

        return jsonNoStore({ ok: false, error: "Change request not found" }, { status: 404 });
      }

      const impact = (cr as any)?.impact_analysis ?? {};

      const assessment = await buildPmImpactAssessment({
        title: safeStr((cr as any)?.title),
        description: safeStr((cr as any)?.description),
        justification: safeStr((cr as any)?.justification),
        financial: safeStr((cr as any)?.financial),
        schedule: safeStr((cr as any)?.schedule),
        risks: safeStr((cr as any)?.risks),
        dependencies: safeStr((cr as any)?.dependencies),
        implementationPlan:
          safeStr((cr as any)?.implementation_plan) || safeStr((cr as any)?.implementationPlan),
        rollbackPlan: safeStr((cr as any)?.rollback_plan) || safeStr((cr as any)?.rollbackPlan),
        deliveryStatus: safeStr((cr as any)?.delivery_status),
        decisionStatus: safeStr((cr as any)?.decision_status),
        priority: safeStr((cr as any)?.priority),
        cost: safeNumAi(impact?.cost, 0),
        days: safeNumAi(impact?.days, 0),
        risk: safeStr(impact?.risk),
      });

      const assessmentLooksEmpty =
        !safeStr(assessment?.recommendation).trim() &&
        !safeStr(assessment?.executive_summary).trim() &&
        (!Array.isArray(assessment?.blockers) || assessment.blockers.length === 0) &&
        (!Array.isArray(assessment?.next_actions) || assessment.next_actions.length === 0);

      const latencyMs = Date.now() - startedAt;

      if (assessmentLooksEmpty) {
        await safeLogRouteHealth({
          projectId: projectUuid,
          artifactId: healthArtifactId,
          eventType: "empty_output",
          severity: "warning",
          routeEventType: eventType,
          model: safeStr(assessment?.model).trim() || "change-impact-assessment",
          latencyMs,
          success: true,
          metadata: { changeId },
        });
      } else {
        await safeLogRouteHealth({
          projectId: projectUuid,
          artifactId: healthArtifactId,
          eventType: "success",
          severity: "info",
          routeEventType: eventType,
          model: safeStr(assessment?.model).trim() || "change-impact-assessment",
          latencyMs,
          success: true,
          metadata: {
            changeId,
            readiness_score: assessment?.readiness_score ?? null,
            blockersCount: Array.isArray(assessment?.blockers) ? assessment.blockers.length : 0,
            nextActionsCount: Array.isArray(assessment?.next_actions)
              ? assessment.next_actions.length
              : 0,
          },
        });
      }

      await maybeLogSlowRouteHealth({
        projectId: projectUuid,
        artifactId: healthArtifactId,
        routeEventType: eventType,
        model: safeStr(assessment?.model).trim() || "change-impact-assessment",
        latencyMs,
        metadata: { changeId },
      });

      return jsonNoStore({
        ok: true,
        eventType,
        scope: "project",
        project_id: projectUuid,
        readiness_score: assessment.readiness_score,
        readiness_label: assessment.readiness_label,
        recommendation: assessment.recommendation,
        executive_summary: assessment.executive_summary,
        schedule: assessment.schedule,
        cost: assessment.cost,
        risk: assessment.risk,
        assessment_scope: assessment.scope,
        governance: assessment.governance,
        blockers: assessment.blockers,
        strengths: assessment.strengths,
        next_actions: assessment.next_actions,
        model: assessment.model,
      });
    }

    if (eventType === "delivery_report") {
      try {
        const { artifactId, period, windowDays: wdRaw, derivedRag, healthContext } = (payload ??
          {}) as any;
        healthArtifactId = safeStr(artifactId).trim() || healthArtifactId;

        const windowDays = parseWindowDays(wdRaw, 7);
        const from = startOfUtcDay(new Date());
        const weekAgo = new Date(from.getTime() - windowDays * 24 * 60 * 60 * 1000);
        const to = endOfUtcWindow(from, windowDays);

        const { data: msData } = await supabase
          .from("schedule_milestones")
          .select(
            "id,milestone_name,end_date,status,critical_path_flag,source_artifact_id"
          )
          .eq("project_id", projectUuid)
          .order("end_date", { ascending: true })
          .limit(50);

        const msRows = Array.isArray(msData) ? (msData as any[]) : [];

        const { data: raidData } = await supabase
          .from("raid_items")
          .select("id,type,title,status,due_date,owner_label,priority")
          .eq("project_id", projectUuid)
          .not("status", "eq", "closed")
          .order("due_date", { ascending: true })
          .limit(30);

        const raidRows = Array.isArray(raidData) ? (raidData as any[]) : [];

        const { data: chData } = await supabase
          .from("change_requests")
          .select("id,title,status,delivery_status,decision_status,updated_at")
          .eq("project_id", projectUuid)
          .order("updated_at", { ascending: false })
          .limit(10);

        const chRows = Array.isArray(chData) ? (chData as any[]) : [];

        const periodFrom = period?.from ?? weekAgo.toISOString().split("T")[0];
        const periodTo = period?.to ?? from.toISOString().split("T")[0];

        const msCompleted = msRows
          .filter((m: any) => {
            const st = safeLower(m?.status);
            return (st === "done" || st === "completed") && parseDueToUtcDate(m?.end_date)! >= weekAgo;
          })
          .slice(0, 5);

        const msDue = msRows
          .filter((m: any) => {
            const st = safeLower(m?.status);
            const due = parseDueToUtcDate(m?.end_date);
            return (
              st !== "done" &&
              st !== "completed" &&
              st !== "closed" &&
              due &&
              due >= from &&
              due <= to
            );
          })
          .slice(0, 8);

        const msForReport = msRows.slice(0, 12).map((m: any) => ({
          name: safeStr(m?.milestone_name).trim() || "Milestone",
          due: safeStr(m?.end_date).split("T")[0] || null,
          status: safeStr(m?.status).trim() || "on_track",
          critical: !!m?.critical_path_flag,
        }));

        const rag =
          derivedRag === "red" || derivedRag === "amber" || derivedRag === "green"
            ? derivedRag
            : "green";

        const changesForReport = chRows.slice(0, 5).map((c: any) => ({
          title: safeStr(c?.title).trim() || "Change request",
          status:
            safeStr(c?.decision_status ?? c?.delivery_status ?? c?.status).trim() || "review",
        }));

        const raidForReport = raidRows.slice(0, 5).map((r: any) => ({
          title: safeStr(r?.title).trim() || "RAID item",
          type: safeStr(r?.type).trim() || "risk",
          status: safeStr(r?.status).trim() || "open",
          priority: safeStr(r?.priority).trim() || "medium",
        }));

        let aiGenerated = false;
        let headline = "";
        let narrative = "";
        let delivered: Array<{ text: string }> = [];
        let planNextWeek: Array<{ text: string }> = [];
        let resourceSummary: Array<{ text: string }> = [];
        let keyDecisions: Array<{ text: string; link: null }> = [];
        let blockers: Array<{ text: string; link: null }> = [];
        let modelUsed = "rule-based-fallback-v1";
        let usageMeta = { inputTokens: null, outputTokens: null, totalTokens: null };

        try {
          const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

          const ragLabel =
            rag === "red"
              ? "Red — Critical"
              : rag === "amber"
                ? "Amber — At Risk"
                : "Green — On Track";
          const msCompletedNames = msCompleted
            .map((m: any) => safeStr(m?.milestone_name).trim())
            .filter(Boolean);
          const msDueNames = msDue
            .map(
              (m: any) =>
                `${safeStr(m?.milestone_name).trim()} (due ${safeStr(m?.end_date).split("T")[0]})`
            )
            .filter(Boolean);
          const highRaid = raidRows
            .filter((r: any) => safeLower(r?.priority) === "high")
            .slice(0, 3);

          const userPrompt = `Project: ${meta.project_name ?? "Project"}${
            meta.project_code ? ` (${meta.project_code})` : ""
          }
PM: ${meta.project_manager_name ?? "Project Manager"}
Period: ${periodFrom} to ${periodTo}
RAG Status: ${ragLabel}
${healthContext ? `\nHealth context:\n${healthContext}` : ""}
${
  msCompletedNames.length
    ? `\nMilestones completed this period:\n${msCompletedNames
        .map((n: string) => `- ${n}`)
        .join("\n")}`
    : ""
}
${
  msDueNames.length
    ? `\nMilestones due next ${windowDays} days:\n${msDueNames
        .map((n: string) => `- ${n}`)
        .join("\n")}`
    : ""
}
${
  highRaid.length
    ? `\nHigh-priority RAID items:\n${highRaid
        .map((r: any) => `- ${safeStr(r?.title).trim()}`)
        .join("\n")}`
    : ""
}

Generate the weekly delivery report. Return ONLY valid JSON:
{
  "headline": "One sentence headline max 12 words",
  "narrative": "3-4 sentence executive narrative, no bullets",
  "delivered": [{"text": "past-tense item"}],
  "planNextWeek": [{"text": "future-tense item"}],
  "resourceSummary": [{"text": "resource note"}],
  "keyDecisions": [{"text": "decision", "link": null}],
  "blockers": [{"text": "blocker description", "link": null}]
}`;

          const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            max_tokens: 900,
            temperature: 0.3,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  "You are a senior project delivery manager. Write concise, factual weekly reports for a PMO. Return only valid JSON with the requested fields.",
              },
              { role: "user", content: userPrompt },
            ],
          });

          const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
          headline = safeStr(parsed.headline).trim();
          narrative = safeStr(parsed.narrative).trim();
          delivered = Array.isArray(parsed.delivered) ? parsed.delivered : [];
          planNextWeek = Array.isArray(parsed.planNextWeek) ? parsed.planNextWeek : [];
          resourceSummary = Array.isArray(parsed.resourceSummary) ? parsed.resourceSummary : [];
          keyDecisions = Array.isArray(parsed.keyDecisions) ? parsed.keyDecisions : [];
          blockers = Array.isArray(parsed.blockers) ? parsed.blockers : [];
          aiGenerated = true;
          modelUsed = "gpt-4o-mini";
          usageMeta = extractUsageMeta(completion.usage);
        } catch (innerErr: any) {
          const invalidJson =
            safeLower(innerErr?.message).includes("invalid json") ||
            safeLower(innerErr?.message).includes("unexpected token");

          if (invalidJson) {
            await safeLogRouteHealth({
              projectId: projectUuid,
              artifactId: healthArtifactId,
              eventType: "invalid_json",
              severity: "warning",
              routeEventType: eventType,
              model: "gpt-4o-mini",
              latencyMs: Date.now() - startedAt,
              success: false,
              errorMessage:
                innerErr?.message ?? "Invalid JSON in delivery_report AI generation",
            });
          }

          const ragLabel =
            rag === "red" ? "Critical" : rag === "amber" ? "At Risk" : "On Track";
          const name = meta.project_name ?? "Project";
          headline = `${name} — ${ragLabel}`;
          narrative = `${name} is currently ${ragLabel.toLowerCase()}. ${
            raidRows.length > 0
              ? `There are ${raidRows.length} open RAID items requiring attention.`
              : "No critical blockers identified."
          } ${
            msDue.length > 0
              ? `${msDue.length} milestone(s) are due in the coming period.`
              : "No milestones due immediately."
          } The team continues to work towards delivery objectives.`;
          delivered = msCompleted
            .slice(0, 3)
            .map((m: any) => ({
              text: `Completed milestone: ${safeStr(m?.milestone_name).trim()}`,
            }));
          if (!delivered.length) {
            delivered = [
              { text: "Continued delivery activities and progress on planned work items." },
            ];
          }
          planNextWeek = msDue
            .slice(0, 3)
            .map((m: any) => ({
              text: `Deliver milestone: ${safeStr(m?.milestone_name).trim()}`,
            }));
          if (!planNextWeek.length) {
            planNextWeek = [
              {
                text: "Continue progress on planned work items and milestone delivery.",
              },
            ];
          }
          resourceSummary = [
            { text: "Team resources allocated as planned. No capacity issues identified." },
          ];
          keyDecisions = [];
          blockers = raidRows
            .filter((r: any) => safeLower(r?.priority) === "high")
            .slice(0, 2)
            .map((r: any) => ({ text: safeStr(r?.title).trim(), link: null }));
        }

        const report = {
          version: 1,
          project: {
            id: projectUuid,
            code: meta.project_code ?? null,
            name: meta.project_name ?? null,
            managerName: meta.project_manager_name ?? null,
            managerEmail: meta.project_manager_email ?? null,
          },
          period: { from: periodFrom, to: periodTo },
          summary: {
            rag,
            headline: headline || `${meta.project_name ?? "Project"} — Weekly Update`,
            narrative: narrative || "Weekly delivery update.",
          },
          delivered,
          planNextWeek,
          milestones: msForReport,
          changes: changesForReport,
          raid: raidForReport,
          resourceSummary,
          keyDecisions,
          blockers,
          metrics: {},
          meta: {
            generated_at: new Date().toISOString(),
            aiGenerated,
            model: modelUsed,
          },
        };

        const reportLooksEmpty =
          !safeStr(report?.summary?.headline).trim() &&
          !safeStr(report?.summary?.narrative).trim() &&
          (!Array.isArray(report?.delivered) || report.delivered.length === 0) &&
          (!Array.isArray(report?.planNextWeek) || report.planNextWeek.length === 0);

        const latencyMs = Date.now() - startedAt;

        if (reportLooksEmpty) {
          await safeLogRouteHealth({
            projectId: projectUuid,
            artifactId: healthArtifactId,
            eventType: "empty_output",
            severity: "warning",
            routeEventType: eventType,
            model: modelUsed,
            latencyMs,
            success: true,
            metadata: {
              aiGenerated,
              usage: usageMeta,
            },
          });
        } else {
          await safeLogRouteHealth({
            projectId: projectUuid,
            artifactId: healthArtifactId,
            eventType: "success",
            severity: "info",
            routeEventType: eventType,
            model: modelUsed,
            latencyMs,
            success: true,
            metadata: {
              aiGenerated,
              usage: usageMeta,
              deliveredCount: Array.isArray(delivered) ? delivered.length : 0,
              planNextWeekCount: Array.isArray(planNextWeek)
                ? planNextWeek.length
                : 0,
              blockersCount: Array.isArray(blockers) ? blockers.length : 0,
            },
          });
        }

        await maybeLogSlowRouteHealth({
          projectId: projectUuid,
          artifactId: healthArtifactId,
          routeEventType: eventType,
          model: modelUsed,
          latencyMs,
          metadata: {
            aiGenerated,
            usage: usageMeta,
          },
        });

        return jsonNoStore({
          ok: true,
          eventType: "delivery_report",
          project_id: projectUuid,
          project_code: meta.project_code,
          project_name: meta.project_name,
          report,
          delivery_report: report,
          content_json: report,
        });
      } catch (e: any) {
        const latencyMs = Date.now() - startedAt;

        await safeLogRouteHealth({
          projectId: projectUuid,
          artifactId: healthArtifactId,
          eventType: "failure",
          severity: "critical",
          routeEventType: eventType,
          latencyMs,
          success: false,
          errorMessage: e?.message ?? "delivery_report generation failed",
        });

        return jsonNoStore(
          { ok: false, error: e?.message ?? "delivery_report generation failed" },
          { status: 500 }
        );
      }
    }

    const knownTypes = [
      "artifact_due",
      "delivery_report",
      "weekly_report_narrative",
      "change_ai_impact_assessment",
    ];

    if (eventType && !knownTypes.includes(eventType)) {
      console.warn(
        `[ai/events] Unrecognised eventType "${eventType}" — falling through to draft assist.`
      );
    }

    if (projectUuid && shouldPersistProjectEvent(eventType)) {
      await createProjectEventAndRunEngine({
        supabase,
        projectId: projectUuid,
        eventType,
        body,
        payload,
        userId: user.id,
      });
    }

    const draft =
      payload && typeof payload === "object"
        ? payload
        : body && typeof body === "object"
          ? body
          : ({} as any);

    const aiDraft = buildDraftAssistAi(draft);
    const draftLooksEmpty =
      !safeStr(aiDraft?.summary).trim() &&
      !safeStr(aiDraft?.justification).trim() &&
      !safeStr(aiDraft?.implementation).trim();

    const latencyMs = Date.now() - startedAt;

    if (draftLooksEmpty) {
      await safeLogRouteHealth({
        projectId: projectUuid,
        artifactId: healthArtifactId,
        eventType: "empty_output",
        severity: "warning",
        routeEventType: eventType || "change_draft_assist_requested",
        model: "draft-rules-v1",
        latencyMs,
        success: true,
        metadata: {
          draftId,
        },
      });
    } else {
      await safeLogRouteHealth({
        projectId: projectUuid,
        artifactId: healthArtifactId,
        eventType: "success",
        severity: "info",
        routeEventType: eventType || "change_draft_assist_requested",
        model: "draft-rules-v1",
        latencyMs,
        success: true,
        metadata: {
          draftId,
          persistedProjectEvent: !!(projectUuid && shouldPersistProjectEvent(eventType)),
        },
      });
    }

    await maybeLogSlowRouteHealth({
      projectId: projectUuid,
      artifactId: healthArtifactId,
      routeEventType: eventType || "change_draft_assist_requested",
      model: "draft-rules-v1",
      latencyMs,
      metadata: {
        draftId,
      },
    });

    return jsonNoStore({
      ok: true,
      eventType: eventType || "change_draft_assist_requested",
      model: "draft-rules-v1",
      draftId,
      project_id: projectUuid,
      project_human_id: meta.project_human_id,
      project_code: meta.project_code,
      project_name: meta.project_name,
      project_manager_name: meta.project_manager_name,
      project_manager_email: meta.project_manager_email,
      project_manager_user_id: meta.project_manager_user_id,
      ai: aiDraft,
    });
  } catch (e: any) {
    const latencyMs = Date.now() - startedAt;

    await safeLogRouteHealth({
      projectId: healthProjectId,
      artifactId: healthArtifactId,
      eventType: safeLower(e?.message).includes("timeout") ? "timeout" : "failure",
      severity: isAuthError(e) ? "warning" : "critical",
      routeEventType: healthRouteEventType,
      latencyMs,
      success: false,
      errorMessage: e?.message ?? "Unknown error",
      metadata: {
        method: "POST",
        code: e?.code ?? null,
        details: e?.details ?? null,
        hint: e?.hint ?? null,
      },
    });

    if (isAuthError(e)) {
      return jsonNoStore({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return jsonNoStore(
      {
        ok: false,
        error: e?.message ?? "Unknown error",
        meta: { code: e?.code ?? null, details: e?.details ?? null, hint: e?.hint ?? null },
      },
      { status: 500 }
    );
  }
}