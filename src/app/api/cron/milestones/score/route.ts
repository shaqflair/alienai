// src/app/api/cron/milestones/score/route.ts
// Scores unscored (or stale) milestones with GPT-4
// Writes back: risk_score, ai_delay_prob, last_risk_reason
// Add to vercel.json cron: { "path": "/api/cron/milestones/score", "schedule": "0 3 * * *" }

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getOpenAIClient, getOpenAIModel, getOpenAITemperature } from "@/lib/ai/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function num(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(n)));
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

type ScoreResult = {
  risk_score: number;       // 0–100
  ai_delay_prob: number;    // 0–100
  last_risk_reason: string;
};

async function scoreMilestone(m: {
  milestone_name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  baseline_end: string | null;
  project_title: string;
}): Promise<ScoreResult | null> {
  const today = todayISO();
  const due = m.end_date || m.start_date || "unknown";
  const baseline = m.baseline_end || "not set";
  const isOverdue = due !== "unknown" && due < today;
  const slipDays =
    m.end_date && m.baseline_end
      ? Math.round(
          (new Date(m.end_date).getTime() - new Date(m.baseline_end).getTime()) /
            86400000
        )
      : null;

  const prompt = `You are a project schedule risk analyst. Score the following milestone.

Project: ${m.project_title}
Milestone: ${m.milestone_name}
Status: ${m.status}
Due date: ${due}
Baseline due date: ${baseline}
Slip days: ${slipDays !== null ? slipDays + "d" : "unknown (no baseline)"}
Overdue: ${isOverdue ? "YES" : "no"}
Today: ${today}

Respond with ONLY valid JSON, no markdown, no explanation:
{
  "risk_score": <integer 0-100, higher = more risky>,
  "ai_delay_prob": <integer 0-100, probability this milestone will be delayed>,
  "last_risk_reason": "<one sentence explanation, max 150 chars>"
}

Guidance:
- Overdue + planned status = very high risk (80-95)
- At risk status = 60-80
- Slippage > 14 days = add 15-20 points
- No baseline = moderate uncertainty, add 10 points
- Completed/done = risk_score 0, ai_delay_prob 0`;

  try {
    const openai = getOpenAIClient();
    const res = await openai.chat.completions.create({
      model: getOpenAIModel(),
      temperature: getOpenAITemperature(),
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = safeStr(res.choices?.[0]?.message?.content).trim();
    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    return {
      risk_score:       clamp(num(parsed.risk_score)),
      ai_delay_prob:    clamp(num(parsed.ai_delay_prob)),
      last_risk_reason: safeStr(parsed.last_risk_reason).slice(0, 500),
    };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  // Optional: guard with CRON_SECRET
  const authHeader = req.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  // Fetch milestones that are unscored OR scored more than 7 days ago
  const staleDate = new Date(Date.now() - 7 * 86400000).toISOString();

  const { data: milestones, error } = await supabase
    .from("schedule_milestones")
    .select(`
      id, milestone_name, status, start_date, end_date, baseline_end,
      projects:projects ( title )
    `)
    .or(`risk_score.is.null,updated_at.lt.${staleDate}`)
    .not("status", "ilike", "%done%")
    .not("status", "ilike", "%completed%")
    .not("status", "ilike", "%cancelled%")
    .limit(50); // stay within cron time budget

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!milestones?.length) {
    return NextResponse.json({ ok: true, scored: 0, message: "Nothing to score" });
  }

  let scored = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const m of milestones) {
    const result = await scoreMilestone({
      milestone_name: safeStr(m.milestone_name),
      status:         safeStr(m.status),
      start_date:     m.start_date ?? null,
      end_date:       m.end_date ?? null,
      baseline_end:   m.baseline_end ?? null,
      project_title:  safeStr((m.projects as any)?.title || "Unknown project"),
    });

    if (!result) {
      failed++;
      errors.push(m.id);
      continue;
    }

    const { error: updateErr } = await supabase
      .from("schedule_milestones")
      .update({
        risk_score:       result.risk_score,
        ai_delay_prob:    result.ai_delay_prob,
        last_risk_reason: result.last_risk_reason,
      })
      .eq("id", m.id);

    if (updateErr) {
      failed++;
      errors.push(m.id);
    } else {
      scored++;
    }
  }

  return NextResponse.json({
    ok: true,
    scored,
    failed,
    total: milestones.length,
    ...(errors.length ? { failed_ids: errors } : {}),
  });
}mport "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getOpenAIClient, getOpenAIModel, getOpenAITemperature } from "@/lib/ai/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function num(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(n)));
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

type ScoreResult = {
  risk_score: number;        // 0–100
  ai_delay_prob: number;     // 0–100
  last_risk_reason: string;
};

async function scoreMilestone(m: {
  milestone_name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  baseline_end: string | null;
  project_title: string;
}): Promise<ScoreResult | null> {
  const today = todayISO();
  const due = m.end_date || m.start_date || "unknown";
  const baseline = m.baseline_end || "not set";
  const isOverdue = due !== "unknown" && due < today;
  const slipDays =
    m.end_date && m.baseline_end
      ? Math.round(
          (new Date(m.end_date).getTime() - new Date(m.baseline_end).getTime()) /
            86400000
        )
      : null;

  const prompt = `You are a project schedule risk analyst. Score the following milestone.

Project: ${m.project_title}
Milestone: ${m.milestone_name}
Status: ${m.status}
Due date: ${due}
Baseline due date: ${baseline}
Slip days: ${slipDays !== null ? \`\${slipDays}d\` : "unknown (no baseline)"}
Overdue: ${isOverdue ? "YES" : "no"}
Today: ${today}

Respond with ONLY valid JSON, no markdown, no explanation:
{
  "risk_score": <integer 0-100, higher = more risky>,
  "ai_delay_prob": <integer 0-100, probability this milestone will be delayed>,
  "last_risk_reason": "<one sentence explanation, max 150 chars>"
}

Guidance:
- Overdue + planned status = very high risk (80-95)
- At risk status = 60-80
- Slippage > 14 days = add 15-20 points
- No baseline = moderate uncertainty, add 10 points
- Completed/done = risk_score 0, ai_delay_prob 0\`;

  try {
    const openai = getOpenAIClient();
    const res = await openai.chat.completions.create({
      model: getOpenAIModel(),
      temperature: getOpenAITemperature(),
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = safeStr(res.choices?.[0]?.message?.content).trim();
    const clean = raw.replace(/`{3}json|`{3}/g, "").trim();
    const parsed = JSON.parse(clean);

    return {
      risk_score:        clamp(num(parsed.risk_score)),
      ai_delay_prob:     clamp(num(parsed.ai_delay_prob)),
      last_risk_reason: safeStr(parsed.last_risk_reason).slice(0, 500),
    };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== \`Bearer \${process.env.CRON_SECRET}\`
  ) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const staleDate = new Date(Date.now() - 7 * 86400000).toISOString();

  const { data: milestones, error } = await supabase
    .from("schedule_milestones")
    .select(\`
      id, milestone_name, status, start_date, end_date, baseline_end,
      projects:projects ( title )
    \`)
    .or(\`risk_score.is.null,updated_at.lt.\${staleDate}\`)
    .not("status", "ilike", "%done%")
    .not("status", "ilike", "%completed%")
    .not("status", "ilike", "%cancelled%")
    .limit(50);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!milestones?.length) {
    return NextResponse.json({ ok: true, scored: 0, message: "Nothing to score" });
  }

  let scored = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const m of milestones) {
    const result = await scoreMilestone({
      milestone_name: safeStr(m.milestone_name),
      status:          safeStr(m.status),
      start_date:      m.start_date ?? null,
      end_date:        m.end_date ?? null,
      baseline_end:    m.baseline_end ?? null,
      project_title:  safeStr((m.projects as any)?.title || "Unknown project"),
    });

    if (!result) {
      failed++;
      errors.push(m.id);
      continue;
    }

    const { error: updateErr } = await supabase
      .from("schedule_milestones")
      .update({
        risk_score:        result.risk_score,
        ai_delay_prob:     result.ai_delay_prob,
        last_risk_reason: result.last_risk_reason,
      })
      .eq("id", m.id);

    if (updateErr) {
      failed++;
      errors.push(m.id);
    } else {
      scored++;
    }
  }

  return NextResponse.json({
    ok: true,
    scored,
    failed,
    total: milestones.length,
    ...(errors.length ? { failed_ids: errors } : {}),
  });
}
