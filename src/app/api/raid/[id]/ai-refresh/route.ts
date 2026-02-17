// src/app/api/raid/[id]/ai-refresh/route.ts
import "server-only";

        param($m)
        $inner = $m.Groups[1].Value
        if ($inner -match '\bNextRequest\b') { return $m.Value }
        if ($inner -match '\bNextResponse\b') {
          # insert NextRequest right after opening brace
          return ('import { NextRequest, ' + $inner.Trim() + ' } from "next/server";') -replace '\s+,', ','
        }
        return $m.Value
      
import { createClient } from "@/utils/supabase/server";
import OpenAI from "openai";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

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
  const t = getEnvNumber("OPENAI_TEMPERATURE", 0.2);
  return Math.max(0, Math.min(2, t));
}

/** âœ… accept either key name */
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
  return msg.length > 280 ? msg.slice(0, 277) + "â€¦" : msg;
}

async function insertNotification(supabase: any, payload: any) {
  const { error } = await supabase.from("notifications").insert(payload);
  if (error) console.warn("[raid ai-refresh notify]", error.message);
}

function buildSystemInstructions() {
  return [
    "You are an expert PMO / project governance assistant.",
    "Generate concise, practical RAID insights for busy delivery teams.",
    "Never invent facts. Base suggestions only on the provided item fields.",
    "Prefer concrete next steps (owner/action/trigger/cadence).",
    "Keep rollup short enough for a table cell (one line).",
  ].join("\n");
}

function raidSchema() {
  return {
    name: "raid_ai_refresh",
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
        confidence: { type: "number", minimum: 0, maximum: 1 },
        signals: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["rollup", "summary", "recommendations", "confidence", "signals"],
    },
  } as const;
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

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const raidId = safeStr(id).trim();
  if (!raidId) return jsonErr("Missing id", 400);

  if (!isOpenAIProvider()) return jsonErr("AI_PROVIDER is not set to openai", 400);

  const apiKey = getApiKey();
  if (!apiKey) return jsonErr("Missing OPENAI_API_KEY (or WIRE_AI_API_KEY) on server env", 500);

  const client = new OpenAI({ apiKey });

  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  const actorId = auth?.user?.id ?? null;

  const { data: item, error: readErr } = await supabase
    .from("raid_items")
    .select(
      "id,project_id,item_no,public_id,type,title,description,owner_label,priority,probability,severity,impact,ai_rollup,owner_id,status,response_plan,next_steps,notes,related_refs,created_at,updated_at,due_date,ai_dirty"
    )
    .eq("id", raidId)
    .maybeSingle();

  if (readErr) return jsonErr(readErr.message, 400);
  if (!item) return jsonErr("RAID item not found (or access denied).", 404);

  const probability = clamp01to100(item.probability ?? 0);
  const severity = clamp01to100(item.severity ?? 0);
  const score = calcScore(probability, severity);

  const type = safeStr(item.type).trim() || "Risk";
  const priority = safeStr(item.priority).trim() || "";
  const status = safeStr(item.status).trim() || "Open";
  const description = safeStr(item.description).trim() || "Untitled";
  const hasPlan = Boolean(safeStr(item.response_plan).trim());
  const band = severityBand(score);

  // âœ… best-effort score history
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

  // âœ… WoW trend best-effort
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

  const input = {
    project_id: item.project_id,
    raid_item_id: item.id,
    type,
    description,
    priority: priority || null,
    status,
    probability,
    severity,
    score,
    band,
    owner_label: safeStr(item.owner_label || "").trim() || null,
    due_date: safeStr(item.due_date || "").trim() || null,
    response_plan: safeStr(item.response_plan || "").trim() || null,
    has_plan: hasPlan,
    wow_delta,
    wow_prev_score,
  };

  const model = getModel();
  const temperature = getTemperature();

  let ai_status: "ok" | "fallback" = "ok";
  let ai_error: string | null = null;

  let aiOut: {
    rollup: string;
    summary: string;
    recommendations: string[];
    confidence: number;
    signals: string[];
  };

  try {
    const js = raidSchema();

    const resp = await client.responses.create({
      model,
      temperature,
      instructions: buildSystemInstructions(),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "Create AI insights for this single RAID item.",
                "Return JSON ONLY that matches the schema.",
                "rollup must be one line, suitable for a table cell.",
                "recommendations must be exactly 3 short actionable bullets.",
                "confidence should reflect how complete the fields are (plan/priority/owner/due date).",
                "If wow_delta is present, mention it briefly in the summary (not the rollup).",
                "",
                "RAID item (JSON):",
                JSON.stringify(input),
              ].join("\n"),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: js.name,
          schema: js.schema,
        },
      },
    });

    const raw = (resp as any).output_text as string | undefined;
    if (!raw) throw new Error("No output_text from model");
    aiOut = JSON.parse(raw);
  } catch (e: any) {
    ai_status = "fallback";
    ai_error = shortenErr(e);
    console.warn("[raid ai-refresh openai]", ai_error);

    const wowTxt =
      typeof wow_delta === "number"
        ? ` â€¢ WoW ${wow_delta > 0 ? "â†‘" : wow_delta < 0 ? "â†“" : "â†’"}${Math.abs(wow_delta)}`
        : "";

    aiOut = {
      rollup: `${type} â€¢ Score ${score} (${band}) â€¢ L${probability}/S${severity}${
        priority ? ` â€¢ Priority: ${priority}` : " â€¢ Priority: â€”"
      } â€¢ Plan: ${hasPlan ? "âœ…" : "âš ï¸ missing"} â€¢ Status: ${status}`,
      summary: `AI unavailable; using fallback rollup${wowTxt}. Try again.`,
      recommendations: [
        hasPlan ? "Confirm triggers and review cadence." : "Add response plan (mitigation + trigger + owner + due date).",
        "Assign/confirm owner and next checkpoint date.",
        "Escalate if trend worsens or score crosses threshold.",
      ],
      confidence: 0.55,
      signals: ["openai_error_fallback"],
    };
  }

  // âœ… AI versioning + quality scoring
  const ai_version = "raid-ai-openai-v2";
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

  const prevRefs = item.related_refs && typeof item.related_refs === "object" ? item.related_refs : {};
  const prevAi = (prevRefs as any).ai && typeof (prevRefs as any).ai === "object" ? (prevRefs as any).ai : {};

  const nextAi = {
    ...aiOut,
    ai_status,
    ai_error,
    ai_quality,
    score,
    band,
    model,
    temperature,
    wow: { delta: wow_delta, prev_score: wow_prev_score },

    // âœ… IMPORTANT: include score in inputs for client-side "score changed?" checks
    inputs: { probability, severity, score, priority: priority || null, status, type },

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

  // âœ… Persist AI & mark ai_dirty false
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

  // âœ… Write AI run history (audit/diff)
  try {
    await supabase.from("raid_ai_runs").insert({
      raid_item_id: item.id,
      project_id: item.project_id,
      actor_user_id: actorId,
      model,
      version: ai_version,
      ai: nextAi,
      inputs: input,
      ai_quality,
    });
  } catch (e: any) {
    console.warn("[raid ai-refresh history insert]", e?.message || e);
  }

  // âœ… Notify on high score / critical
  const shouldNotify = score >= 70 || priority === "Critical";
  if (shouldNotify) {
    const notifyUserId = item.owner_id || actorId;
    if (notifyUserId) {
      await insertNotification(supabase, {
        user_id: notifyUserId,
        project_id: item.project_id,
        artifact_id: null,
        type: "raid_alert",
        title: `RAID alert: ${type} (${band})`,
        body: `${description} â€” Score ${score} (L${probability}/S${severity})${priority ? ` â€” ${priority}` : ""}. ${
          aiOut.recommendations?.[0] || ""
        }`,
        link: `/projects/${item.project_id}/raid`,
        is_read: false,
        actor_user_id: actorId,
        metadata: {
          raid_item_id: item.id,
          raid_type: type,
          score,
          likelihood: probability,
          severity,
          priority: priority || null,
          status,
          wow_delta,
          wow_prev_score,
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

