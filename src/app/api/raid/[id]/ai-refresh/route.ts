// src/app/api/raid/[id]/ai-refresh/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import OpenAI from "openai";
import { requireAiAccess } from "@/lib/ai/aiGuard";

export const runtime = "nodejs";

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error, ...(extra ?? {}) }, { status });
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}
function getEnvNumber(name: string, fallback: number) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

function clamp01to100(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}
function calcScore(prob: any, sev: any) {
  const p = clamp01to100(prob);
  const s = clamp01to100(sev);
  return Math.round((p * s) / 100);
}
function severityBand(score: number) {
  if (score >= 80) return "Severe";
  if (score >= 61) return "High";
  if (score >= 31) return "Medium";
  return "Low";
}

function getModel() {
  return safeStr(process.env.OPENAI_MODEL).trim() || "gpt-4.1-mini";
}
function getTemperature() {
  // Lower temperature for structured, consistent RAID output
  const t = getEnvNumber("OPENAI_TEMPERATURE", 0.1);
  return Math.max(0, Math.min(2, t));
}

function getApiKey() {
  const a = safeStr(process.env.WIRE_AI_API_KEY).trim();
  const b = safeStr(process.env.OPENAI_API_KEY).trim();
  return a || b || "";
}

function isOpenAIProvider() {
  const p = safeStr(process.env.AI_PROVIDER).trim().toLowerCase();
  return !p || p === "openai";
}

function shortenErr(e: any) {
  const msg = safeStr(e?.message) || String(e || "");
  return msg.length > 280 ? msg.slice(0, 277) + "…" : msg;
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    try {
      return JSON.parse(stripped);
    } catch {
      return null;
    }
  }
}

async function insertNotification(supabase: any, payload: any) {
  const { error } = await supabase.from("notifications").insert(payload);
  if (error) console.warn("[raid ai-refresh notify]", error.message);
}

/* =========================================================================================
   ✅ IMPROVED: Detailed system instructions with output format spec and rollup template
========================================================================================= */

function buildSystemInstructions() {
  return [
    "You are an expert PMO / project governance assistant generating AI insights for RAID items.",
    "Generate concise, practical, actionable insights for busy delivery teams.",
    "Never invent facts — base all analysis only on the provided item fields.",
    "",
    "=== OUTPUT QUALITY RULES ===",
    "rollup:",
    "  - ONE LINE only. Max 20 words. Designed for a table cell.",
    `  - Format: "[Type] • Score [N] ([Band]) • [Single most important insight or gap]"`,
    `  - Example: "Risk • Score 72 (High) • No mitigation plan — assign owner immediately"`,
    "",
    "summary:",
    "  - 2–3 sentences. Cover: current status, key concern, recommended focus.",
    "  - If wow_context is present and shows a meaningful change, reference it explicitly.",
    "  - Be direct. Avoid filler phrases like 'It is recommended that...'",
    "",
    "recommendations:",
    "  - Exactly 3 items.",
    "  - Each must be a specific, actionable step — not generic advice.",
    "  - If response_plan is missing AND score > 60: rec[0] MUST be a mitigation template:",
    `    e.g. "Create response plan: [mitigation action] — Owner: [role] — Trigger: [condition] — Due: [timeframe]"`,
    "  - rec[1]: Owner/accountability action (assign, confirm, or escalate).",
    "  - rec[2]: Monitoring/review cadence action.",
    "",
    "next_action:",
    "  - Single most important action right now. One sentence, owner-agnostic.",
    "  - This should be the single most impactful step to reduce risk exposure.",
    "",
    "escalate:",
    "  - true if ANY of: score >= 70, no response plan and score >= 50, priority is Critical, status is Blocked.",
    "  - false otherwise.",
    "",
    "stale_risk:",
    "  - true if the item appears stale: no response plan, no due date, and status still Open.",
    "  - false otherwise.",
    "",
    "trend_narrative:",
    "  - If wow_context shows a score change: one-line narrative e.g. 'Score up 8 points WoW — trend worsening'.",
    "  - If no WoW data: empty string ''.",
    "",
    "confidence:",
    "  - Reflect how complete the item fields are (0.0–1.0).",
    "  - High (0.8+): has owner, response_plan, due_date, priority, probability, severity.",
    "  - Medium (0.5–0.79): missing 1–2 key fields.",
    "  - Low (<0.5): missing 3+ key fields.",
    "",
    "signals:",
    "  - Array of short string tags identifying specific data quality gaps or notable conditions.",
    `  - Possible values: "missing_owner", "missing_plan", "missing_due_date", "missing_priority",`,
    `    "high_score_no_plan", "overdue", "blocked", "score_worsening", "score_improving",`,
    `    "critical_priority", "stale_item", "no_wow_data"`,
    "  - Include only signals that apply. Do not invent new signal names.",
  ].join("\n");
}

/* =========================================================================================
   ✅ IMPROVED: Expanded JSON schema with next_action, escalate, stale_risk, trend_narrative
========================================================================================= */

function raidResponseFormat() {
  return {
    type: "json_schema" as const,
    json_schema: {
      name: "raid_ai_refresh",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          rollup: { type: "string" },
          summary: { type: "string" },
          recommendations: {
            type: "array",
            minItems: 3,
            maxItems: 3,
            items: { type: "string" },
          },
          next_action: { type: "string" },
          escalate: { type: "boolean" },
          stale_risk: { type: "boolean" },
          trend_narrative: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          signals: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: [
          "rollup",
          "summary",
          "recommendations",
          "next_action",
          "escalate",
          "stale_risk",
          "trend_narrative",
          "confidence",
          "signals",
        ],
      },
    },
  };
}

function aiQualityScore(input: {
  owner_label?: string | null;
  response_plan?: string | null;
  due_date?: string | null;
  priority?: string | null;
  probability?: number | null;
  severity?: number | null;
  status?: string | null;
  score?: number | null;
}) {
  let q = 0;

  if (safeStr(input.owner_label).trim()) q += 20;
  if (safeStr(input.response_plan).trim()) q += 20;
  if (safeStr(input.priority).trim()) q += 10;

  if (Number.isFinite(Number(input.probability))) q += 10;
  if (Number.isFinite(Number(input.severity))) q += 10;

  const st = safeStr(input.status).toLowerCase();
  const isOpenish = st === "open" || st.includes("progress");

  if (isOpenish && safeStr(input.due_date).trim()) q += 15;
  if (isOpenish && !safeStr(input.due_date).trim()) q -= 5;

  const sc = Number(input.score ?? 0);
  if (sc >= 61 && !safeStr(input.response_plan).trim()) q -= 10;

  return Math.max(0, Math.min(100, Math.round(q)));
}

/* =========================================================================================
   ✅ IMPROVED: Build a narrative WoW context string instead of passing raw numbers
========================================================================================= */

function buildWowNarrative(wow_delta: number | null, wow_prev_score: number | null, currentScore: number): string {
  if (wow_delta === null || wow_prev_score === null) {
    return "No prior week data available — this may be the first assessment.";
  }

  const direction = wow_delta > 0 ? "increased" : wow_delta < 0 ? "decreased" : "unchanged";
  const arrow = wow_delta > 0 ? "↑" : wow_delta < 0 ? "↓" : "→";
  const abs = Math.abs(wow_delta);

  const context =
    wow_delta > 10
      ? "Score is worsening significantly — immediate attention needed."
      : wow_delta > 0
        ? "Score is trending upward — monitor closely."
        : wow_delta < -10
          ? "Score has improved significantly week-on-week."
          : wow_delta < 0
            ? "Score is trending downward — positive trajectory."
            : "Score is stable week-on-week.";

  return `Score ${direction} by ${abs} points ${arrow} (was ${wow_prev_score}, now ${currentScore}). ${context}`;
}

/* =========================================================================================
   ✅ IMPROVED: Build richer input prompt with narrative WoW and explicit signal pre-hints
========================================================================================= */

function buildUserPrompt(
  item: any,
  input: ReturnType<typeof buildInputObj>,
  wowNarrative: string
): string {
  const hasOwner = Boolean(safeStr(item.owner_label).trim());
  const hasPlan = Boolean(safeStr(item.response_plan).trim());
  const hasDueDate = Boolean(safeStr(item.due_date).trim());
  const hasPriority = Boolean(safeStr(item.priority).trim());

  const dataGaps: string[] = [];
  if (!hasOwner) dataGaps.push("owner_label is missing");
  if (!hasPlan) dataGaps.push("response_plan is missing");
  if (!hasDueDate) dataGaps.push("due_date is missing");
  if (!hasPriority) dataGaps.push("priority is missing");

  const lines: string[] = [
    "Generate AI insights for this RAID item.",
    "",
    "=== RAID ITEM ===",
    JSON.stringify(input, null, 2),
    "",
    "=== WEEK-ON-WEEK CONTEXT ===",
    wowNarrative,
    "",
  ];

  if (dataGaps.length) {
    lines.push("=== DATA QUALITY GAPS (for signals and recommendations) ===");
    lines.push(...dataGaps.map((g) => `• ${g}`));
    lines.push("");
  }

  if (!hasPlan && input.score >= 61) {
    lines.push(
      "⚠️  HIGH SCORE + NO PLAN: recommendations[0] MUST be a specific mitigation template.",
      "Format: 'Create response plan: [action] — Owner: [role] — Trigger: [condition] — Due: [timeframe]'",
      ""
    );
  }

  lines.push("Return JSON matching the schema. No extra text.");

  return lines.join("\n");
}

function buildInputObj(item: any, score: number, band: string, wow_delta: number | null, wow_prev_score: number | null) {
  const probability = clamp01to100(item.probability ?? 0);
  const severity = clamp01to100(item.severity ?? 0);
  const type = safeStr(item.type).trim() || "Risk";
  const priority = safeStr(item.priority).trim() || "";
  const status = safeStr(item.status).trim() || "Open";

  return {
    type,
    title: safeStr(item.title).trim() || safeStr(item.description).trim() || "Untitled",
    description: safeStr(item.description).trim() || "",
    status,
    priority: priority || null,
    probability,
    severity,
    score,
    band,
    owner_label: safeStr(item.owner_label || "").trim() || null,
    due_date: safeStr(item.due_date || "").trim() || null,
    response_plan: safeStr(item.response_plan || "").trim() || null,
    next_steps: safeStr(item.next_steps || "").trim() || null,
    // Numeric values for completeness; narrative context in separate section
    wow_delta,
    wow_prev_score,
    project_id: item.project_id,
  };
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const raidId = safeStr(id).trim();
  if (!raidId) return jsonErr("Missing id", 400);

  if (!isOpenAIProvider()) return jsonErr("AI_PROVIDER is not set to openai", 400);

  const apiKey = getApiKey();
  if (!apiKey) return jsonErr("Missing OPENAI_API_KEY (or WIRE_AI_API_KEY) on server env", 500);

  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return jsonErr("Not authenticated", 401);

  const actorId = auth.user.id;

  const { data: item, error: readErr } = await supabase
    .from("raid_items")
    .select(
      "id,project_id,item_no,public_id,type,title,description,owner_label,priority,probability,severity,impact,ai_rollup,owner_id,status,response_plan,next_steps,notes,related_refs,created_at,updated_at,due_date,ai_dirty"
    )
    .eq("id", raidId)
    .maybeSingle();

  if (readErr) return jsonErr(readErr.message, 400);
  if (!item) return jsonErr("RAID item not found (or access denied).", 404);

  const guard = await requireAiAccess({ projectId: item.project_id, kind: "raid.ai-refresh" });
  if (!guard.ok) return jsonErr(guard.error, guard.status, { meta: guard.meta ?? null });

  const probability = clamp01to100(item.probability ?? 0);
  const severity = clamp01to100(item.severity ?? 0);
  const score = calcScore(probability, severity);
  const band = severityBand(score);
  const priority = safeStr(item.priority).trim() || "";
  const status = safeStr(item.status).trim() || "Open";
  const hasPlan = Boolean(safeStr(item.response_plan).trim());

  // Score history insert
  try {
    await supabase.from("raid_item_scores").insert({
      raid_item_id: item.id,
      project_id: item.project_id,
      score,
      probability,
      severity,
    });
  } catch (e: any) {
    console.warn("[raid ai-refresh score insert]", e?.message || e);
  }

  // WoW trend
  let wow_delta: number | null = null;
  let wow_prev_score: number | null = null;
  try {
    const { data: hist, error: hErr } = await supabase
      .from("raid_item_scores")
      .select("score,created_at")
      .eq("raid_item_id", item.id)
      .order("created_at", { ascending: false })
      .limit(30);

    if (!hErr && hist && hist.length) {
      const latest = hist[0];
      const latestTs = new Date((latest as any).created_at).getTime();
      const weekAgoMs = latestTs - 7 * 24 * 60 * 60 * 1000;

      const prev = hist.find((h: any) => new Date(h.created_at).getTime() <= weekAgoMs);
      if (prev) {
        wow_prev_score = Number(prev.score);
        wow_delta = Number(latest.score) - wow_prev_score;
      }
    }
  } catch (e: any) {
    console.warn("[raid ai-refresh wow]", e?.message || e);
  }

  const model = getModel();
  const temperature = getTemperature();

  // ✅ Build structured input object and WoW narrative
  const inputObj = buildInputObj(item, score, band, wow_delta, wow_prev_score);
  const wowNarrative = buildWowNarrative(wow_delta, wow_prev_score, score);

  let ai_status: "ok" | "fallback" = "ok";
  let ai_error: string | null = null;

  let aiOut: {
    rollup: string;
    summary: string;
    recommendations: string[];
    next_action: string;
    escalate: boolean;
    stale_risk: boolean;
    trend_narrative: string;
    confidence: number;
    signals: string[];
  };

  // ✅ Use chat.completions with json_schema response_format (standardised, testable)
  const client = new OpenAI({ apiKey });

  try {
    const resp = await client.chat.completions.create({
      model,
      temperature,
      response_format: raidResponseFormat() as any,
      messages: [
        { role: "system", content: buildSystemInstructions() },
        {
          role: "user",
          content: buildUserPrompt(item, inputObj, wowNarrative),
        },
      ],
    });

    const raw = resp.choices?.[0]?.message?.content ?? "";
    if (!raw) throw new Error("Empty content from model");

    const parsed = safeJsonParse(raw);
    if (!parsed) throw new Error("Model returned invalid JSON");

    // Validate required fields present
    if (!parsed.rollup || !parsed.summary || !Array.isArray(parsed.recommendations)) {
      throw new Error("Model response missing required fields");
    }

    aiOut = {
      rollup: safeStr(parsed.rollup),
      summary: safeStr(parsed.summary),
      recommendations: (parsed.recommendations as any[]).slice(0, 3).map((r: any) => safeStr(r)),
      next_action: safeStr(parsed.next_action || ""),
      escalate: Boolean(parsed.escalate),
      stale_risk: Boolean(parsed.stale_risk),
      trend_narrative: safeStr(parsed.trend_narrative || ""),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.5))),
      signals: Array.isArray(parsed.signals) ? parsed.signals.map((s: any) => safeStr(s)).filter(Boolean) : [],
    };
  } catch (e: any) {
    ai_status = "fallback";
    ai_error = shortenErr(e);
    console.warn("[raid ai-refresh openai]", ai_error);

    // ✅ Richer fallback that still populates the new fields
    const wowTxt = typeof wow_delta === "number"
      ? ` • WoW ${wow_delta > 0 ? "↑" : wow_delta < 0 ? "↓" : "→"}${Math.abs(wow_delta)}`
      : "";

    const shouldEscalate = score >= 70 || priority === "Critical";
    const isStale = !hasPlan && !safeStr(item.due_date).trim() && status.toLowerCase() === "open";

    aiOut = {
      rollup: `${inputObj.type} • Score ${score} (${band})${priority ? ` • ${priority}` : ""} • Plan: ${hasPlan ? "✅" : "⚠️ missing"}`,
      summary: `AI unavailable — using fallback${wowTxt}. Retry for full analysis.`,
      recommendations: [
        hasPlan
          ? "Confirm response plan triggers and review cadence with owner."
          : `Create response plan: [mitigation action] — Owner: [assign role] — Trigger: [condition] — Due: [within 1 week]`,
        "Assign or confirm owner and next checkpoint date.",
        score >= 70 ? "Escalate to programme board — score exceeds threshold." : "Monitor score at next weekly review.",
      ],
      next_action: hasPlan
        ? "Review and confirm response plan is current."
        : "Create response plan and assign owner immediately.",
      escalate: shouldEscalate,
      stale_risk: isStale,
      trend_narrative: typeof wow_delta === "number" ? wowNarrative : "",
      confidence: 0.4,
      signals: [
        "openai_error_fallback",
        ...(!hasPlan ? ["missing_plan"] : []),
        ...(!safeStr(item.owner_label).trim() ? ["missing_owner"] : []),
        ...(score >= 61 && !hasPlan ? ["high_score_no_plan"] : []),
        ...(shouldEscalate ? ["critical_priority"] : []),
        ...(isStale ? ["stale_item"] : []),
      ],
    };
  }

  // ✅ Validate model confidence against deterministic quality score
  // If they diverge significantly, log a warning (useful for monitoring)
  const ai_version = "raid-ai-openai-v3";
  const ai_quality = aiQualityScore({
    owner_label: item.owner_label,
    response_plan: item.response_plan,
    due_date: item.due_date,
    priority,
    probability,
    severity,
    status,
    score,
  });

  const qualityConfidence = ai_quality / 100;
  const confidenceDrift = Math.abs(aiOut.confidence - qualityConfidence);
  if (confidenceDrift > 0.4) {
    console.warn(
      `[raid ai-refresh] confidence drift: model=${aiOut.confidence.toFixed(2)} quality=${qualityConfidence.toFixed(2)} item=${item.id}`
    );
  }

  const prevRefs = item.related_refs && typeof item.related_refs === "object" ? item.related_refs : {};
  const prevAi = (prevRefs as any).ai && typeof (prevRefs as any).ai === "object" ? (prevRefs as any).ai : {};

  const nextAi = {
    ...aiOut,
    ai_status,
    ai_error,
    ai_quality,
    quality_confidence: qualityConfidence,
    score,
    band,
    model,
    temperature,
    wow: { delta: wow_delta, prev_score: wow_prev_score, narrative: wowNarrative },

    inputs: { probability, severity, score, priority: priority || null, status, type: inputObj.type },

    last_run_at: new Date().toISOString(),
    version: ai_version,
    prev: {
      had_ai: Boolean(prevAi?.last_run_at),
      prev_score: typeof prevAi?.score === "number" ? prevAi.score : null,
    },
  };

  const nextRefs = {
    ...(prevRefs as any),
    ai: nextAi,
  };

  async function updateRaid(withDirty: boolean) {
    const payload: any = {
      ai_rollup: aiOut.rollup,
      related_refs: nextRefs,
    };
    if (withDirty) payload.ai_dirty = false;

    const { data, error } = await supabase
      .from("raid_items")
      .update(payload)
      .eq("id", raidId)
      .select(
        "id,project_id,item_no,public_id,type,title,description,owner_label,priority,probability,severity,impact,ai_rollup,owner_id,status,response_plan,next_steps,notes,related_refs,created_at,updated_at,due_date,ai_dirty"
      )
      .single();

    return { data, error };
  }

  let out = await updateRaid(true);
  if (out.error && safeStr(out.error.message).includes('column "ai_dirty"')) {
    out = await updateRaid(false);
  }
  if (out.error) return jsonErr(out.error.message, 400);

  const updated = out.data;

  // Audit log
  try {
    await supabase.from("raid_ai_runs").insert({
      raid_item_id: item.id,
      project_id: item.project_id,
      actor_user_id: actorId,
      model,
      version: ai_version,
      ai: nextAi,
      inputs: inputObj,
      ai_quality,
    });
  } catch (e: any) {
    console.warn("[raid ai-refresh history insert]", e?.message || e);
  }

  // ✅ Notify on high score, critical priority, OR newly flagged escalation
  const shouldNotify = score >= 70 || priority === "Critical" || aiOut.escalate;
  if (shouldNotify) {
    const notifyUserId = item.owner_id || actorId;
    if (notifyUserId) {
      const description = safeStr(item.description).trim() || safeStr(item.title).trim() || "RAID item";
      await insertNotification(supabase, {
        user_id: notifyUserId,
        project_id: item.project_id,
        artifact_id: null,
        type: "raid_alert",
        title: `RAID alert: ${inputObj.type} (${band})`,
        body: [
          `${description} — Score ${score} (L${probability}/S${severity})`,
          priority ? `Priority: ${priority}.` : "",
          aiOut.next_action ? `Next action: ${aiOut.next_action}` : aiOut.recommendations?.[0] || "",
        ]
          .filter(Boolean)
          .join(" "),
        link: `/projects/${item.project_id}/raid`,
        is_read: false,
        actor_user_id: actorId,
        metadata: {
          raid_item_id: item.id,
          raid_type: inputObj.type,
          score,
          likelihood: probability,
          severity,
          priority: priority || null,
          status,
          wow_delta,
          wow_prev_score,
          wow_narrative: wowNarrative,
          escalate: aiOut.escalate,
          stale_risk: aiOut.stale_risk,
          next_action: aiOut.next_action,
          trend_narrative: aiOut.trend_narrative,
          ai_confidence: aiOut.confidence,
          ai_signals: aiOut.signals,
          openai_model: model,
          temperature,
          ai_status,
          ai_error,
          ai_quality,
          ai_version,
        },
      });
    }
  }

  return jsonOk({ item: updated, ai: nextAi });
}