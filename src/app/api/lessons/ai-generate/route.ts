import "server-only";
import { NextResponse, type NextRequest } from "next/server";
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
  return typeof x === "string" ? x : "";
}
function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test((x || "").trim());
}
function norm(s: any) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

type AiLesson = {
  category: "what_went_well" | "improvements" | "issues";
  description: string;
  action_for_future: string;

  // optional if you added cols
  impact?: "Positive" | "Negative";
  severity?: "Low" | "Medium" | "High";
  project_stage?: string;
  ai_summary?: string;
};

async function collectSignals(sb: any, project_id: string) {
  const raid = await sb
    .from("raid_items")
    .select(
      "type,title,description,status,priority,probability,severity,impact,response_plan,owner_label,due_date,updated_at,created_at"
    )
    .eq("project_id", project_id)
    .order("updated_at", { ascending: false })
    .limit(200);

  const changes = await sb
    .from("change_requests")
    .select(
      "title,description,proposed_change,status,priority,tags,decision_status,decision_rationale,decision_at,ai_score,ai_schedule,ai_cost,ai_scope,updated_at,created_at"
    )
    .eq("project_id", project_id)
    .order("updated_at", { ascending: false })
    .limit(200);

  const existing = await sb
    .from("lessons_learned")
    .select("description")
    .eq("project_id", project_id)
    .limit(500);

  return {
    raid: raid.data ?? [],
    changes: changes.data ?? [],
    existingDescriptions: new Set((existing.data ?? []).map((x: any) => norm(x.description))),
  };
}

function buildPrompt(signals: { raid: any[]; changes: any[] }) {
  // Keep prompt compact & “enterprise”
  const raidTop = signals.raid.slice(0, 120);
  const crTop = signals.changes.slice(0, 120);

  return `
You are an enterprise PMO assistant. Generate "Lessons Learned" from project history.

Input data includes RAID items and Change Requests.
Create 6 to 12 lessons maximum.

Rules:
- Output MUST be strict JSON array (no markdown, no commentary).
- Categories must be exactly one of: "what_went_well", "improvements", "issues".
- Each lesson must be specific, non-duplicative, and actionable.
- "action_for_future" must be an imperative action (start with a verb).
- If you infer governance weaknesses (late decisions, overdue actions, repeated rework), capture them as lessons.
- Keep descriptions concise (1-2 sentences).

JSON schema per item:
{
  "category": "what_went_well" | "improvements" | "issues",
  "description": string,
  "action_for_future": string,
  "impact": "Positive" | "Negative" (optional),
  "severity": "Low" | "Medium" | "High" (optional),
  "project_stage": string (optional),
  "ai_summary": string (optional)
}

RAID_ITEMS: ${JSON.stringify(raidTop)}
CHANGE_REQUESTS: ${JSON.stringify(crTop)}
`;
}

function validateLesson(x: any): x is AiLesson {
  const catOk = x?.category === "what_went_well" || x?.category === "improvements" || x?.category === "issues";
  const descOk = typeof x?.description === "string" && x.description.trim().length >= 8;
  const actOk = typeof x?.action_for_future === "string" && x.action_for_future.trim().length >= 6;
  return Boolean(catOk && descOk && actOk);
}

async function generateLessonsWithOpenAI(signals: { raid: any[]; changes: any[] }) {
  const openai = getOpenAIClient();
  const model = getOpenAIModel();
  const temperature = getOpenAITemperature();

  const prompt = buildPrompt(signals);

  // Use Responses API (works with OpenAI SDK v4+)
  const resp = await openai.responses.create({
    model,
    temperature,
    // “json” helps but we still hard-parse defensively
    response_format: { type: "json_object" },
    input: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const txt = resp.output_text || "";
  // response_format json_object returns an object; we asked for array
  // So we accept either:
  // - { "items": [ ... ] } or
  // - [ ... ]
  let parsed: any;
  try {
    parsed = JSON.parse(txt);
  } catch {
    // last resort: try to extract first JSON block
    const m = txt.match(/(\[.*\]|\{.*\})/s);
    if (!m) throw new Error("AI returned non-JSON output");
    parsed = JSON.parse(m[1]);
  }

  const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
  return arr;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const project_id = safeStr(body.project_id);
    if (!isUuid(project_id)) return jsonErr("Invalid project_id", 400);

    const sb = await createClient();
    const signals = await collectSignals(sb, project_id);

    const raw = await generateLessonsWithOpenAI({ raid: signals.raid, changes: signals.changes });

    const clean: AiLesson[] = [];
    for (const x of raw) {
      if (!validateLesson(x)) continue;

      // normalise optional fields
      const item: AiLesson = {
        category: x.category,
        description: String(x.description).trim(),
        action_for_future: String(x.action_for_future).trim(),
        impact: x.impact === "Positive" || x.impact === "Negative" ? x.impact : undefined,
        severity: x.severity === "Low" || x.severity === "Medium" || x.severity === "High" ? x.severity : undefined,
        project_stage: typeof x.project_stage === "string" ? x.project_stage.trim() : undefined,
        ai_summary: typeof x.ai_summary === "string" ? x.ai_summary.trim() : undefined,
      };

      // dedupe against existing
      if (signals.existingDescriptions.has(norm(item.description))) continue;

      // soft dedupe within this batch
      if (clean.some((y) => norm(y.description) === norm(item.description))) continue;

      clean.push(item);
    }

    if (clean.length === 0) return jsonOk({ created_count: 0, inserted: [] });

    const inserts = clean.map((l) => ({
      project_id,
      category: l.category,
      description: l.description,
      action_for_future: l.action_for_future,

      // optional columns (safe even if null)
      status: "Open",
      impact: l.impact ?? null,
      severity: l.severity ?? null,
      project_stage: l.project_stage ?? null,
      ai_summary: l.ai_summary ?? null,
      ai_generated: true,
    }));

    const { data, error } = await sb
      .from("lessons_learned")
      .insert(inserts)
      .select("id,category,description");

    if (error) return jsonErr(error.message, 400);

    return jsonOk({ created_count: data?.length ?? inserts.length, inserted: data ?? [] });
  } catch (e: any) {
    return jsonErr(e?.message || "AI generation failed", 500);
  }
}

