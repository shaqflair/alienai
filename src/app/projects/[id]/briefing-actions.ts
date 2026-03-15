"use server";

import "server-only";
import OpenAI from "openai";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";

// -- Constants ----------------------------------------------------------------

const BRIEFING_TTL_HOURS = 24;
const BRIEFING_MODEL     = "gpt-4o";

// -- Types --------------------------------------------------------------------

export type BriefingSection = {
  summary:             string;
  on_track:            string[];
  needs_attention:     { item: string; priority: "high" | "medium" }[];
  biggest_risk:        string;
  recommended_actions: string[];
};

export type ProjectBriefing = {
  id:           string;
  project_id:   string;
  content:      BriefingSection;
  generated_at: string;
  generated_by: "auto" | "manual" | "system";
  is_stale:     boolean;
};

// -- Helpers ------------------------------------------------------------------

function safeStr(x: unknown): string {
  if (typeof x === "string") return x;
  if (x == null) return "";
  return String(x);
}

function isStale(generatedAt: string): boolean {
  const age = Date.now() - new Date(generatedAt).getTime();
  return age > BRIEFING_TTL_HOURS * 60 * 60 * 1000;
}

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey });
}

// -- Prompt schema ------------------------------------------------------------

const BRIEFING_SYSTEM = `You are a senior PMO advisor generating concise daily briefings for
project managers. Be specific, not generic. Reference actual risks, milestones, and artifacts
by name. No filler phrases like "continue to monitor" or "ensure alignment".
Always respond with valid JSON only -- no prose, no markdown fences.`;

const BRIEFING_SCHEMA = `{
  "summary": "string -- 1-2 sentence plain English overview of where the project stands today",
  "on_track": ["string -- specific item going well"],
  "needs_attention": [
    { "item": "string -- specific actionable item", "priority": "high" }
  ],
  "biggest_risk": "string -- single sentence describing the most critical threat to delivery",
  "recommended_actions": [
    "string -- concrete action for today"
  ]
}`;

// -- Data fetchers ------------------------------------------------------------

async function fetchProjectMeta(supabase: any, projectId: string) {
  const { data } = await supabase
    .from("projects")
    .select("id, title, name, start_date, finish_date, status, health_score, rag_status")
    .eq("id", projectId)
    .maybeSingle();
  return data ?? {};
}

async function fetchOpenRaidItems(supabase: any, projectId: string) {
  const { data, error } = await supabase
    .from("raid_items")
    .select("id, type, title, description, status, priority, owner, due_date")
    .eq("project_id", projectId)
    .in("status", ["open", "active", "in_progress", "identified"])
    .order("priority", { ascending: false })
    .limit(20);

  if (!error && data?.length) return data as any[];

  const { data: risks } = await supabase
    .from("risks")
    .select("id, title, description, status, impact, likelihood, owner")
    .eq("project_id", projectId)
    .not("status", "eq", "closed")
    .limit(10);

  return risks ?? [];
}

async function fetchUpcomingMilestones(supabase: any, projectId: string) {
  const today       = new Date();
  const twoWeeks    = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);

  const { data: milestones, error: msErr } = await supabase
    .from("milestones")
    .select("id, title, due_date, status, owner")
    .eq("project_id", projectId)
    .gte("due_date", twoWeeksAgo.toISOString().split("T")[0])
    .lte("due_date", twoWeeks.toISOString().split("T")[0])
    .order("due_date", { ascending: true })
    .limit(10);

  if (!msErr && milestones?.length) return milestones as any[];

  const { data: scheduleArtifact } = await supabase
    .from("artifacts")
    .select("content_json")
    .eq("project_id", projectId)
    .in("type", ["schedule", "SCHEDULE"])
    .eq("is_current", true)
    .maybeSingle();

  const tasks = scheduleArtifact?.content_json?.tasks ?? scheduleArtifact?.content_json?.milestones ?? [];
  if (!Array.isArray(tasks)) return [];

  return tasks
    .filter((t: any) => {
      const d = new Date(t.due_date ?? t.end_date ?? "");
      return !isNaN(d.getTime()) && d >= twoWeeksAgo && d <= twoWeeks;
    })
    .slice(0, 10)
    .map((t: any) => ({
      title:    t.title ?? t.name ?? "Unnamed task",
      due_date: t.due_date ?? t.end_date,
      status:   t.status ?? "unknown",
    }));
}

async function fetchRecentArtifactActivity(supabase: any, projectId: string) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: auditRows } = await supabase
    .from("artifact_audit_log")
    .select("action, artifact_id, created_at, after")
    .eq("project_id", projectId)
    .gte("created_at", sevenDaysAgo)
    .in("action", ["submit", "resubmit", "approve", "request_changes", "reject_final", "baseline_promoted"])
    .order("created_at", { ascending: false })
    .limit(10);

  if (auditRows?.length) return auditRows as any[];

  const { data: artifacts } = await supabase
    .from("artifacts")
    .select("id, title, type, approval_status, updated_at")
    .eq("project_id", projectId)
    .gte("updated_at", sevenDaysAgo)
    .order("updated_at", { ascending: false })
    .limit(10);

  return artifacts ?? [];
}

async function fetchLatestWeeklyReport(supabase: any, projectId: string) {
  const { data } = await supabase
    .from("artifacts")
    .select("title, content, content_json, updated_at")
    .eq("project_id", projectId)
    .in("type", ["weekly_report", "WEEKLY_REPORT", "weekly", "status_report"])
    .eq("is_current", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ?? null;
}

// -- Prompt builder -----------------------------------------------------------

function buildUserPrompt(data: {
  project:          any;
  raidItems:        any[];
  milestones:       any[];
  artifactActivity: any[];
  weeklyReport:     any | null;
  generatedAt:      string;
}): string {
  const projectName = safeStr(data.project?.title ?? data.project?.name ?? "this project");
  const today = new Date(data.generatedAt).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  const raidSummary = data.raidItems.length
    ? data.raidItems.slice(0, 10).map((r: any) =>
        `- [${safeStr(r.type ?? r.category ?? "RISK").toUpperCase()}] ${safeStr(r.title)}: ` +
        `${safeStr(r.description ?? "").slice(0, 120)} ` +
        `(priority: ${r.priority ?? "unknown"}, owner: ${r.owner ?? "unassigned"})`
      ).join("\n")
    : "No open RAID items.";

  const milestoneSummary = data.milestones.length
    ? data.milestones.map((m: any) =>
        `- ${safeStr(m.title)} -- due ${safeStr(m.due_date)} -- status: ${safeStr(m.status)}`
      ).join("\n")
    : "No milestones due in the next 14 days.";

  const activitySummary = data.artifactActivity.length
    ? data.artifactActivity.slice(0, 5).map((a: any) =>
        `- ${safeStr(a.action ?? a.approval_status)} on ` +
        `${safeStr(a.title ?? a.type ?? "artifact")} at ` +
        `${safeStr(a.created_at ?? a.updated_at ?? "").slice(0, 10)}`
      ).join("\n")
    : "No recent governance activity.";

  const weeklySummary = data.weeklyReport
    ? (typeof data.weeklyReport.content_json === "object"
        ? JSON.stringify(data.weeklyReport.content_json).slice(0, 600)
        : safeStr(data.weeklyReport.content).slice(0, 600))
    : "No weekly report available.";

  return `Generate a daily briefing for the project manager of "${projectName}".
Today is ${today}.

PROJECT HEALTH
- Health Score: ${data.project?.health_score ?? "unknown"}%
- RAG Status: ${safeStr(data.project?.rag_status ?? "unknown").toUpperCase()}
- Timeline: ${safeStr(data.project?.start_date || "TBC")} -> ${safeStr(data.project?.finish_date || "TBC")}

OPEN RAID ITEMS
${raidSummary}

MILESTONES DUE WITHIN 14 DAYS
${milestoneSummary}

RECENT GOVERNANCE ACTIVITY (last 7 days)
${activitySummary}

LATEST WEEKLY REPORT (excerpt)
${weeklySummary}

Required JSON schema:
${BRIEFING_SCHEMA}

Rules:
- Be specific -- reference actual risks, milestones, and artifacts by name
- on_track: 2-4 items
- needs_attention: 2-4 items ordered by urgency, each with priority "high" or "medium"
- recommended_actions: exactly 3 concrete things to do today
- No filler phrases like "continue to monitor" or "ensure alignment"
- Return ONLY the JSON object`;
}

// -- LLM call -----------------------------------------------------------------

async function buildDailyBriefingLLM(data: {
  project:          any;
  raidItems:        any[];
  milestones:       any[];
  artifactActivity: any[];
  weeklyReport:     any | null;
  generatedAt:      string;
}): Promise<{ content: BriefingSection; model: string }> {
  const client     = getOpenAIClient();
  const userPrompt = buildUserPrompt(data);

  const response = await client.chat.completions.create({
    model: BRIEFING_MODEL,
    response_format: { type: "json_object" },
    max_tokens: 1000,
    messages: [
      { role: "system", content: BRIEFING_SYSTEM },
      { role: "user",   content: userPrompt },
    ],
  });

  const text    = response.choices[0]?.message?.content ?? "";
  const content = JSON.parse(text) as BriefingSection;
  return { content, model: response.model };
}

// -- Rule-based fallback ------------------------------------------------------

function buildDailyBriefingFallback(data: {
  project:          any;
  raidItems:        any[];
  milestones:       any[];
  artifactActivity: any[];
}): { content: BriefingSection; model: string } {
  const health    = data.project?.health_score ?? null;
  const rag       = safeStr(data.project?.rag_status ?? "").toUpperCase() || "UNKNOWN";
  const highRaids = data.raidItems.filter((r: any) =>
    safeStr(r.priority).toLowerCase() === "high"
  );
  const overdue = data.milestones.filter((m: any) => {
    const due = new Date(safeStr(m.due_date));
    return !isNaN(due.getTime()) && due < new Date() && safeStr(m.status).toLowerCase() !== "complete";
  });

  const on_track: string[] = [];
  if (data.raidItems.length === 0)                         on_track.push("No open RAID items requiring immediate action");
  if (overdue.length === 0)                                on_track.push("No overdue milestones in the next 14 days");
  if (rag === "GREEN" || (health != null && health >= 80)) on_track.push(`Health score tracking at ${health != null ? `${health}%` : rag}`);
  if (data.artifactActivity.length > 0)                   on_track.push("Recent governance activity is recorded");
  if (on_track.length === 0)                              on_track.push("Project is active in the system");

  const needs_attention: { item: string; priority: "high" | "medium" }[] = [];
  if (highRaids.length > 0) {
    needs_attention.push({
      item:     `${highRaids.length} high-priority RAID item${highRaids.length > 1 ? "s" : ""} open: ${safeStr(highRaids[0]?.title)}`,
      priority: "high",
    });
  }
  if (overdue.length > 0) {
    needs_attention.push({
      item:     `${overdue.length} overdue milestone${overdue.length > 1 ? "s" : ""}: ${safeStr(overdue[0]?.title)} was due ${safeStr(overdue[0]?.due_date)}`,
      priority: "high",
    });
  }
  const soonMs = data.milestones.filter((m: any) => {
    const due         = new Date(safeStr(m.due_date));
    const inSevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    return !isNaN(due.getTime()) && due >= new Date() && due <= inSevenDays;
  });
  if (soonMs.length > 0) {
    needs_attention.push({
      item:     `Milestone due within 7 days: ${safeStr(soonMs[0]?.title)} on ${safeStr(soonMs[0]?.due_date)}`,
      priority: "medium",
    });
  }
  if (needs_attention.length === 0) {
    needs_attention.push({ item: "Review project data is up to date for accurate briefing", priority: "medium" });
  }

  const biggest_risk = highRaids.length > 0
    ? `${safeStr(highRaids[0]?.title)}: ${safeStr(highRaids[0]?.description ?? "").slice(0, 120) || "High priority -- assign mitigation owner"}`
    : data.raidItems.length > 0
    ? `${data.raidItems.length} open RAID item${data.raidItems.length > 1 ? "s" : ""} -- review and triage urgently`
    : "No specific risks identified -- ensure RAID register is kept up to date";

  const recommended_actions = [
    highRaids.length > 0
      ? `Review and update mitigation plan for: ${safeStr(highRaids[0]?.title)}`
      : "Review RAID register and confirm all items have owners and mitigations",
    overdue.length > 0
      ? `Chase overdue milestone status: ${safeStr(overdue[0]?.title)}`
      : soonMs.length > 0
      ? `Confirm delivery readiness for: ${safeStr(soonMs[0]?.title)} (due ${safeStr(soonMs[0]?.due_date)})`
      : "Review schedule and confirm next milestone is on track",
    "Check pending artifact approvals and governance actions",
  ];

  const projectName = safeStr(data.project?.title ?? data.project?.name ?? "Project");

  return {
    content: {
      summary: `${projectName} is tracking at ${health != null ? `${health}% health` : `RAG ${rag}`}. ${needs_attention.length > 0 ? `${needs_attention.length} item${needs_attention.length > 1 ? "s" : ""} require attention today.` : "No critical issues identified."}`,
      on_track:            on_track.slice(0, 4),
      needs_attention:     needs_attention.slice(0, 4),
      biggest_risk,
      recommended_actions: recommended_actions.slice(0, 3),
    },
    model: "rule-based-fallback-v1",
  };
}

// -- Core generation ----------------------------------------------------------

async function generateBriefingContent(
  projectId: string,
  supabase: any
): Promise<{ content: BriefingSection; model: string; snapshot: any }> {
  const [project, raidItems, milestones, artifactActivity, weeklyReport] = await Promise.all([
    fetchProjectMeta(supabase, projectId),
    fetchOpenRaidItems(supabase, projectId),
    fetchUpcomingMilestones(supabase, projectId),
    fetchRecentArtifactActivity(supabase, projectId),
    fetchLatestWeeklyReport(supabase, projectId),
  ]);

  const generatedAt = new Date().toISOString();
  const inputData   = { project, raidItems, milestones, artifactActivity, weeklyReport, generatedAt };

  let content: BriefingSection;
  let model: string;

  try {
    ({ content, model } = await buildDailyBriefingLLM(inputData));
  } catch (err) {
    console.error("[briefing-actions] gpt-4o briefing failed, using fallback:", err);
    ({ content, model } = buildDailyBriefingFallback(inputData));
  }

  return {
    content,
    model,
    snapshot: {
      project_health:    project?.health_score,
      rag_status:        project?.rag_status,
      raid_count:        raidItems.length,
      milestone_count:   milestones.length,
      activity_count:    artifactActivity.length,
      has_weekly_report: !!weeklyReport,
      model,
    },
  };
}

// -- Public server actions ----------------------------------------------------

export async function getOrGenerateBriefing(
  projectId: string
): Promise<{ briefing: ProjectBriefing | null; error?: string }> {
  if (!projectId) return { briefing: null, error: "projectId is required." };

  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect("/login");

    const { data: existing } = await supabase
      .from("project_briefings")
      .select("id, project_id, content, generated_at, generated_by")
      .eq("project_id", projectId)
      .maybeSingle();

    if (existing && !isStale(existing.generated_at)) {
      return { briefing: { ...existing, is_stale: false } as ProjectBriefing };
    }

    const { content, model, snapshot } = await generateBriefingContent(projectId, supabase);
    const now = new Date().toISOString();

    const { data: upserted, error: upsertErr } = await supabase
      .from("project_briefings")
      .upsert(
        { project_id: projectId, content, generated_at: now, generated_by: "auto", model, data_snapshot: snapshot },
        { onConflict: "project_id" }
      )
      .select("id, project_id, content, generated_at, generated_by")
      .maybeSingle();

    if (upsertErr) throw upsertErr;

    return {
      briefing: {
        ...(upserted ?? { id: "", project_id: projectId, content, generated_at: now, generated_by: "auto" }),
        is_stale: false,
      } as ProjectBriefing,
    };
  } catch (e: any) {
    console.error("[getOrGenerateBriefing]", e?.message ?? e);
    return { briefing: null, error: safeStr(e?.message) || "Failed to generate briefing." };
  }
}

export async function regenerateBriefing(
  projectId: string
): Promise<{ briefing: ProjectBriefing | null; error?: string }> {
  if (!projectId) return { briefing: null, error: "projectId is required." };

  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect("/login");

    const { data: mem } = await supabase
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", auth.user.id)
      .eq("is_active", true)
      .maybeSingle();

    const role = safeStr((mem as any)?.role).toLowerCase();
    if (role !== "owner" && role !== "editor") {
      return { briefing: null, error: "Only owners and editors can regenerate the briefing." };
    }

    const { content, model, snapshot } = await generateBriefingContent(projectId, supabase);
    const now = new Date().toISOString();

    const { data: upserted, error: upsertErr } = await supabase
      .from("project_briefings")
      .upsert(
        { project_id: projectId, content, generated_at: now, generated_by: "manual", model, data_snapshot: snapshot },
        { onConflict: "project_id" }
      )
      .select("id, project_id, content, generated_at, generated_by")
      .maybeSingle();

    if (upsertErr) throw upsertErr;

    return {
      briefing: {
        ...(upserted ?? { id: "", project_id: projectId, content, generated_at: now, generated_by: "manual" }),
        is_stale: false,
      } as ProjectBriefing,
    };
  } catch (e: any) {
    console.error("[regenerateBriefing]", e?.message ?? e);
    return { briefing: null, error: safeStr(e?.message) || "Regeneration failed." };
  }
}

export async function getCachedBriefing(
  projectId: string
): Promise<{ briefing: ProjectBriefing | null }> {
  if (!projectId) return { briefing: null };

  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("project_briefings")
      .select("id, project_id, content, generated_at, generated_by")
      .eq("project_id", projectId)
      .maybeSingle();

    if (!data) return { briefing: null };
    return { briefing: { ...data, is_stale: isStale(data.generated_at) } as ProjectBriefing };
  } catch {
    return { briefing: null };
  }
}