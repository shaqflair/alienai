// src/app/api/lessons/ai-generate/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getOpenAIClient, getOpenAIModel, getOpenAITemperature } from "@/lib/ai/openai";

export const runtime = "nodejs";

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (x || "").trim()
  );
}
function norm(s: any) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}
function safeJson(v: any): any | null {
  if (!v) return null;
  if (typeof v === "object") return v; // jsonb
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }
  return null;
}
function cut(s: any, n: number) {
  return String(s ?? "").trim().slice(0, n);
}
function typeKey(a: any) {
  return String(a?.artifact_type || a?.type || "")
    .trim()
    .toLowerCase();
}
function takeTextArr(arr: any[], key = "text", max = 10) {
  return (Array.isArray(arr) ? arr : [])
    .slice(0, max)
    .map((x) => (typeof x?.[key] === "string" ? x[key] : typeof x === "string" ? x : ""))
    .map((s) => String(s || "").trim())
    .filter(Boolean);
}
function normalizeCategory(raw: any): "what_went_well" | "improvements" | "issues" | null {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (s === "what_went_well") return "what_went_well";
  if (s === "improvements") return "improvements";
  if (s === "issues") return "issues";
  return null;
}

type AiLesson = {
  category: "what_went_well" | "improvements" | "issues";
  description: string;
  action_for_future: string;
  impact?: "Positive" | "Negative";
  severity?: "Low" | "Medium" | "High";
  project_stage?: string;
  ai_summary?: string;
};

type ResolvedProject = {
  project_id: string; // uuid
  project_code: string; // projects.project_code
  title?: string | null; // projects.title
  organisation_id?: string | null;
};

type ArtifactSignal = {
  id: string;
  kind: string;
  title: string;
  status: string;
  updated_at: string;
  signals: string[];
};

async function getMyOrgId(sb: any): Promise<string | null> {
  // Prefer organisations_members / organisation_members if you have it, but to avoid guessing:
  // We can resolve org from any visible project owned/accessible by the user via RLS.
  // However, you passed organisation_id into projects; simplest is to read the project itself.
  // For code-based resolution, we need org. We'll use profiles/org membership if available;
  // If not, we attempt a project_code lookup without org filter (still safe under RLS).
  try {
    const { data: userRes } = await sb.auth.getUser();
    const uid = userRes?.user?.id;
    if (!uid) return null;

    // Many stacks have profiles.organisation_id. If you do, this works.
    const { data, error } = await sb.from("profiles").select("organisation_id").eq("user_id", uid).maybeSingle();
    if (!error && data?.organisation_id) return String(data.organisation_id);

    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve project reference to UUID.
 * Accepts:
 * - UUID (projects.id)
 * - project_code (projects.project_code)
 *
 * IMPORTANT: project_code is unique per organisation (projects_org_project_code_uq),
 * so we try to scope by organisation_id when we can.
 */
async function resolveProject(sb: any, refRaw: string): Promise<ResolvedProject | null> {
  const ref = safeStr(refRaw).trim();
  if (!ref) return null;

  const cols = "id,title,project_code,organisation_id,deleted_at,status,lifecycle_status";

  if (isUuid(ref)) {
    const { data, error } = await sb.from("projects").select(cols).eq("id", ref).maybeSingle();
    if (error) return null;
    if (!data?.id) return null;

    // ignore deleted projects
    if (data.deleted_at) return null;

    return {
      project_id: String(data.id),
      project_code: safeStr(data.project_code || ref),
      title: data.title ?? null,
      organisation_id: data.organisation_id ? String(data.organisation_id) : null,
    };
  }

  const orgId = await getMyOrgId(sb);

  // If we know org, scope it. If not, fallback to plain project_code match (RLS will still protect).
  let q = sb.from("projects").select(cols).eq("project_code", ref).is("deleted_at", null).limit(1);
  if (orgId) q = q.eq("organisation_id", orgId);

  const { data, error } = await q;
  if (error) return null;

  const row = Array.isArray(data) ? data[0] : null;
  if (!row?.id) return null;

  return {
    project_id: String(row.id),
    project_code: safeStr(row.project_code || ref),
    title: row.title ?? null,
    organisation_id: row.organisation_id ? String(row.organisation_id) : null,
  };
}

function extractWeeklyReportSignals(cj: any): string[] {
  // Your real schema (from sample)
  const headline = cj?.summary?.headline ?? "";
  const narrative = cj?.summary?.narrative ?? "";

  const blockers = Array.isArray(cj?.blockers) ? cj.blockers : [];
  const keyDecisions = Array.isArray(cj?.keyDecisions) ? cj.keyDecisions : [];
  const planNextWeek = Array.isArray(cj?.planNextWeek) ? cj.planNextWeek : [];
  const resourceSummary = Array.isArray(cj?.resourceSummary) ? cj.resourceSummary : [];

  const delivered = Array.isArray(cj?.delivered) ? cj.delivered : [];
  const milestones = Array.isArray(cj?.milestones) ? cj.milestones : [];
  const changes = Array.isArray(cj?.changes) ? cj.changes : [];
  const raid = Array.isArray(cj?.raid) ? cj.raid : [];

  const periodFrom = cj?.period?.from ?? cj?.meta?.sources?.snapshot?.period?.from ?? "";
  const periodTo = cj?.period?.to ?? cj?.meta?.sources?.snapshot?.period?.to ?? "";

  const sig: string[] = [];
  const periodLabel =
    periodFrom && periodTo ? `${periodFrom}→${periodTo}` : periodFrom || periodTo ? `${periodFrom}${periodTo}` : "";

  if (periodLabel) sig.push(`Weekly period: ${periodLabel}`);
  if (headline) sig.push(`Headline: ${cut(headline, 220)}`);
  if (narrative) sig.push(`Narrative: ${cut(narrative, 900)}`);

  for (const d of takeTextArr(delivered, "text", 12)) sig.push(`Delivered: ${cut(d, 240)}`);

  const ms = (Array.isArray(milestones) ? milestones : []).slice(0, 14).map((m: any) => ({
    name: String(m?.name ?? "").trim(),
    due: String(m?.due ?? "").trim(),
    status: String(m?.status ?? "").trim(),
  }));
  for (const m of ms) {
    if (!m.name) continue;
    if (m.status) sig.push(`Milestone: ${m.name} (${m.status}${m.due ? `, due ${m.due}` : ""})`);
  }

  for (const b of takeTextArr(blockers, "text", 12)) {
    if (/no operational blockers/i.test(b)) continue;
    sig.push(`Blocker: ${cut(b, 260)}`);
  }
  for (const d of takeTextArr(keyDecisions, "text", 12)) {
    if (/no key decisions/i.test(d)) continue;
    sig.push(`Decision: ${cut(d, 260)}`);
  }
  for (const p of takeTextArr(planNextWeek, "text", 12)) sig.push(`Next: ${cut(p, 260)}`);
  for (const r of takeTextArr(resourceSummary, "text", 12)) sig.push(`Resourcing: ${cut(r, 260)}`);

  for (const c of (Array.isArray(changes) ? changes : []).slice(0, 14)) {
    const title = String(c?.title ?? "").trim();
    const status = String(c?.status ?? "").trim();
    if (!title) continue;
    sig.push(`Change noted: ${title}${status ? ` (${status})` : ""}`);
  }

  for (const r of (Array.isArray(raid) ? raid : []).slice(0, 14)) {
    const title = String(r?.title ?? r?.text ?? "").trim();
    const status = String(r?.status ?? "").trim();
    if (!title) continue;
    sig.push(`RAID noted: ${title}${status ? ` (${status})` : ""}`);
  }

  return sig;
}

function extractSignalsFromArtifact(a: any): ArtifactSignal {
  const cj = safeJson(a?.content_json);
  const t = typeKey(a);
  const status = String(a?.approval_status || a?.status || "").trim();
  const title = cut(a?.title || "", 120) || "Untitled";

  const signals: string[] = [];
  if (status) signals.push(`Workflow: ${status}`);

  if (t === "weekly_report") {
    if (cj) signals.push(...extractWeeklyReportSignals(cj));
    else {
      const fallback = cut(a?.content || "", 1400);
      if (fallback) signals.push(`Weekly text: ${fallback}`);
    }
  } else {
    if (cj) {
      const hintKeys = [
        "summary",
        "headline",
        "narrative",
        "objectives",
        "scope",
        "assumptions",
        "constraints",
        "decisions",
        "actions",
        "milestones",
        "plan",
        "next_steps",
        "recommendations",
        "risks",
        "issues",
        "dependencies",
      ];

      for (const k of hintKeys) {
        const v = (cj as any)?.[k];
        if (typeof v === "string" && v.trim()) signals.push(`${k}: ${cut(v, 420)}`);
        else if (Array.isArray(v) && v.length) {
          const head = v
            .slice(0, 6)
            .map((x) => (typeof x === "string" ? x : typeof x?.text === "string" ? x.text : ""))
            .map((s) => String(s || "").trim())
            .filter(Boolean);
          if (head.length) signals.push(`${k}: ${cut(head.join(" | "), 520)}`);
        } else if (v && typeof v === "object" && Object.keys(v).length) {
          signals.push(`${k}: (present)`);
        }
      }

      if (signals.length <= (status ? 1 : 0)) signals.push(`JSON hint: ${cut(JSON.stringify(cj), 900)}`);
    } else {
      const fallback = cut(a?.content || "", 1000);
      if (fallback) signals.push(`Text hint: ${fallback}`);
    }
  }

  return {
    id: String(a?.id || ""),
    kind: t || "artifact",
    title,
    status,
    updated_at: String(a?.updated_at || a?.created_at || ""),
    signals: signals.slice(0, 14),
  };
}

async function collectSignals(sb: any, project_id: string) {
  const raid = await sb
    .from("raid_items")
    .select(
      "human_id,type,title,description,status,priority,probability,severity,impact,response_plan,owner_label,due_date,updated_at,created_at"
    )
    .eq("project_id", project_id)
    .order("updated_at", { ascending: false })
    .limit(250);

  const changes = await sb
    .from("change_requests")
    .select(
      "human_id,title,description,proposed_change,status,priority,tags,decision_status,decision_rationale,decision_at,ai_score,ai_schedule,ai_cost,ai_scope,updated_at,created_at"
    )
    .eq("project_id", project_id)
    .order("updated_at", { ascending: false })
    .limit(250);

  const arts = await sb
    .from("artifacts")
    .select("id,title,artifact_type,type,is_current,content,content_json,status,approval_status,updated_at,created_at,deleted_at")
    .eq("project_id", project_id)
    .eq("is_current", true)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(250);

  const artifactSignals: ArtifactSignal[] = (arts.data ?? [])
    .map((a: any) => extractSignalsFromArtifact(a))
    .filter((s) => s.id && s.signals.length > 0);

  const existing = await sb.from("lessons_learned").select("description").eq("project_id", project_id).limit(800);

  const raidRows = raid.data ?? [];
  const changeRows = changes.data ?? [];

  const metrics = {
    raid_count: raidRows.length,
    changes_count: changeRows.length,
    artifacts_count: artifactSignals.length,
    open_risks: raidRows.filter(
      (r: any) => String(r?.type || "").toLowerCase() === "risk" && String(r?.status || "").toLowerCase() !== "closed"
    ).length,
    open_issues: raidRows.filter(
      (r: any) => String(r?.type || "").toLowerCase() === "issue" && String(r?.status || "").toLowerCase() !== "closed"
    ).length,
  };

  return {
    raid: raidRows,
    changes: changeRows,
    artifactSignals,
    metrics,
    existingDescriptions: new Set((existing.data ?? []).map((x: any) => norm(x.description))),
  };
}

function buildPrompt(args: {
  project_code: string;
  project_title?: string | null;
  raid: any[];
  changes: any[];
  artifactSignals: ArtifactSignal[];
  metrics: any;
}) {
  const raidTop = args.raid.slice(0, 160);
  const crTop = args.changes.slice(0, 160);
  const artTop = args.artifactSignals.slice(0, 180);

  return `
You are an enterprise PMO assistant helping a Project Manager record Lessons Learned.

Goal:
- Scan the project signals and propose PM-ready lessons that are easy to ACCEPT and log.
- Lessons must be written clearly, in plain English, in a way a PM would approve.
- Create 4 to 12 lessons.

Rules:
- Output MUST be strict JSON ARRAY ONLY (no markdown, no wrapper text).
- Always produce at least 4 lessons.
- Include at least 1 "what_went_well" lesson even if delivery is on track.
- category must be exactly one of: "what_went_well", "improvements", "issues".
- Each lesson must be specific, non-duplicative, and actionable.
- "description" should be 1–2 sentences, written as an observable outcome + what we learned.
- "action_for_future" MUST start with an imperative verb (e.g. "Define", "Agree", "Escalate", "Automate", "Baseline", "Document").
- Prefer lessons that reduce repeat problems: late approvals, unclear ownership, poor change control, missing acceptance criteria, weak RAID follow-up, repeated milestone at-risk status, decision latency.
- Use ARTIFACT_SIGNALS to detect patterns across artifacts.
- Include evidence in ai_summary referencing:
  - RAID human_id + title
  - Change human_id + title/status
  - ArtifactSignal title + key bullet (and weekly period/headline when present)

Project:
- project_code: ${JSON.stringify(args.project_code)}
- project_title: ${JSON.stringify(args.project_title || "")}

METRICS: ${JSON.stringify(args.metrics)}
RAID_ITEMS: ${JSON.stringify(raidTop)}
CHANGE_REQUESTS: ${JSON.stringify(crTop)}
ARTIFACT_SIGNALS: ${JSON.stringify(artTop)}
`;
}

function validateLesson(x: any): x is AiLesson {
  const cat = normalizeCategory(x?.category);
  const descOk = typeof x?.description === "string" && x.description.trim().length >= 8;
  const actOk = typeof x?.action_for_future === "string" && x.action_for_future.trim().length >= 6;
  return Boolean(cat && descOk && actOk);
}

async function generateLessonsWithOpenAI(prompt: string) {
  const openai = getOpenAIClient();
  const model = getOpenAIModel();
  const temperature = getOpenAITemperature();

  const resp = await openai.responses.create({
    model,
    temperature,
    text: {
      format: {
        type: "json_schema",
        name: "lessons_array",
        schema: {
          type: "array",
          minItems: 4,
          maxItems: 12,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["category", "description", "action_for_future"],
            properties: {
              category: { type: "string", enum: ["what_went_well", "improvements", "issues"] },
              description: { type: "string", minLength: 8 },
              action_for_future: { type: "string", minLength: 6 },
              impact: { type: "string", enum: ["Positive", "Negative"] },
              severity: { type: "string", enum: ["Low", "Medium", "High"] },
              project_stage: { type: "string" },
              ai_summary: { type: "string" },
            },
          },
        },
      },
    },
    input: [{ role: "user", content: prompt }],
  });

  const txt = resp.output_text || "";
  let parsed: any;
  try {
    parsed = JSON.parse(txt);
  } catch {
    const m = txt.match(/(\[.*\]|\{.*\})/);
    if (!m) throw new Error("AI returned non-JSON output");
    parsed = JSON.parse(m[1].replace(/\n/g, " "));
  }

  return Array.isArray(parsed) ? parsed : [];
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    // ✅ accept UUID or project_code
    const project_ref = safeStr(body.project_id || body.project_code || body.projectId);
    if (!project_ref.trim()) return jsonErr("Missing project_id or project_code", 400);

    const sb = await createClient();
    const resolved = await resolveProject(sb, project_ref);
    if (!resolved?.project_id) return jsonErr("Project not found", 404);

    const signals = await collectSignals(sb, resolved.project_id);

    const prompt = buildPrompt({
      project_code: resolved.project_code,
      project_title: resolved.title ?? null,
      raid: signals.raid,
      changes: signals.changes,
      artifactSignals: signals.artifactSignals,
      metrics: signals.metrics,
    });

    const raw = await generateLessonsWithOpenAI(prompt);

    const clean: AiLesson[] = [];
    for (const x of raw) {
      if (!validateLesson(x)) continue;

      const cat = normalizeCategory(x?.category);
      if (!cat) continue;

      const item: AiLesson = {
        category: cat,
        description: String(x.description).trim(),
        action_for_future: String(x.action_for_future).trim(),
        impact: x.impact === "Positive" || x.impact === "Negative" ? x.impact : undefined,
        severity: x.severity === "Low" || x.severity === "Medium" || x.severity === "High" ? x.severity : undefined,
        project_stage: typeof x.project_stage === "string" ? x.project_stage.trim() : undefined,
        ai_summary: typeof x.ai_summary === "string" ? x.ai_summary.trim() : undefined,
      };

      if (signals.existingDescriptions.has(norm(item.description))) continue;
      if (clean.some((y) => norm(y.description) === norm(item.description))) continue;

      clean.push(item);
    }

    if (clean.length === 0) {
      return jsonOk({
        created_count: 0,
        inserted: [],
        project: { id: resolved.project_id, project_code: resolved.project_code, title: resolved.title ?? null },
        metrics: signals.metrics,
      });
    }

    const inserts = clean.map((l) => ({
      project_id: resolved.project_id,
      category: l.category,
      description: l.description,
      action_for_future: l.action_for_future,
      status: "Open",
      impact: l.impact ?? null,
      severity: l.severity ?? null,
      project_stage: l.project_stage ?? null,
      ai_summary: l.ai_summary ?? null,
      ai_generated: true,
    }));

    const { data, error } = await sb.from("lessons_learned").insert(inserts).select("id,category,description");
    if (error) return jsonErr(error.message, 400);

    return jsonOk({
      created_count: data?.length ?? inserts.length,
      inserted: data ?? [],
      project: { id: resolved.project_id, project_code: resolved.project_code, title: resolved.title ?? null },
      metrics: signals.metrics,
    });
  } catch (e: any) {
    return jsonErr(e?.message || "AI generation failed", 500);
  }
}