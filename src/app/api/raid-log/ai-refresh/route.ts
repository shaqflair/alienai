// src/app/api/raid-log/ai-refresh/route.ts
// POST { id } — runs AI scoring on a raid_log item, writes ai_rollup back
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function jsonOk(d: any)            { return NextResponse.json({ ok: true,  ...d }, { headers: { "Cache-Control": "no-store" } }); }
function jsonErr(e: string, s=400) { return NextResponse.json({ ok: false, error: e }, { status: s, headers: { "Cache-Control": "no-store" } }); }
function ss(x: any): string        { return typeof x === "string" ? x : x == null ? "" : String(x); }
function clamp(n: any): number     { const v = Number(n); return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0; }
function score(l: any, s: any)     { return Math.round((clamp(l) * clamp(s)) / 100); }
function band(n: number)           { return n >= 80 ? "Severe" : n >= 61 ? "High" : n >= 31 ? "Medium" : "Low"; }

function getApiKey() {
  return ss(process.env.WIRE_AI_API_KEY || process.env.OPENAI_API_KEY).trim();
}

const SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "raid_log_ai_refresh",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        rollup:          { type: "string" },
        summary:         { type: "string" },
        recommendations: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } },
        next_action:     { type: "string" },
        escalate:        { type: "boolean" },
        confidence:      { type: "number", minimum: 0, maximum: 1 },
        signals:         { type: "array", items: { type: "string" } },
      },
      required: ["rollup","summary","recommendations","next_action","escalate","confidence","signals"],
    },
  },
};

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return jsonErr("Unauthorized", 401);

    const { id } = await req.json().catch(() => ({}));
    if (!id) return jsonErr("Missing id", 400);

    // Fetch raid_log item
    const { data: item, error: itemErr } = await supabase
      .from("raid_log")
      .select("id,project_id,name,type,priority,likelihood,severity,owner,status,organisation_id,organisation_name")
      .eq("id", id)
      .maybeSingle();

    if (itemErr || !item) return jsonErr("Item not found", 404);

    // Resolve owner name if UUID
    let ownerLabel = ss(item.owner);
    if (/^[0-9a-f-]{36}$/i.test(ownerLabel)) {
      const { data: profile } = await supabase
        .from("profiles").select("full_name").eq("user_id", ownerLabel).maybeSingle();
      if (profile?.full_name) ownerLabel = ss(profile.full_name);
    }

    // Fetch project name
    const { data: project } = item.project_id
      ? await supabase.from("projects").select("title,project_code").eq("id", item.project_id).maybeSingle()
      : { data: null };

    const itemScore = score(item.likelihood, item.severity);
    const scoreBand = band(itemScore);

    const prompt = [
      `You are a PMO risk advisor analysing a RAID register item.`,
      ``,
      `PROJECT: ${ss(project?.title || item.organisation_name)} (${ss(project?.project_code || "")})`,
      ``,
      `RAID ITEM:`,
      `Type: ${ss(item.type)} | Priority: ${ss(item.priority)} | Status: ${ss(item.status)}`,
      `Name: ${ss(item.name)}`,
      `Likelihood: ${item.likelihood ?? "?"}% | Severity: ${item.severity ?? "?"}% | Score: ${itemScore} (${scoreBand})`,
      `Owner: ${ownerLabel || "Unassigned"}`,
      ``,
      `Generate:`,
      `- rollup: ONE LINE max 20 words for a table cell. Format: "[Type] • Score ${itemScore} (${scoreBand}) • [key insight]"`,
      `- summary: 2-3 sentences covering status, key concern, recommended focus`,
      `- recommendations: exactly 3 specific actionable steps`,
      `- next_action: single most important action right now`,
      `- escalate: true if score >= 70 or priority is Critical`,
      `- confidence: 0.0-1.0 based on data completeness`,
      `- signals: applicable tags from: missing_owner, missing_plan, missing_priority, high_score_no_plan, critical_priority, stale_item`,
      `Return only JSON matching the schema.`,
    ].join("\n");

    const apiKey = getApiKey();
    let result: any = null;

    if (apiKey) {
      try {
        const openai = new OpenAI({ apiKey });
        const resp = await openai.chat.completions.create({
          model: ss(process.env.OPENAI_MODEL).trim() || "gpt-4.1-mini",
          temperature: 0.1,
          max_tokens: 600,
          messages: [{ role: "user", content: prompt }],
          response_format: SCHEMA,
        });
        const txt = resp.choices?.[0]?.message?.content;
        if (txt) result = JSON.parse(txt);
      } catch(e) { console.error("OpenAI raid-log refresh failed:", e); }
    }

    if (!result) {
      result = {
        rollup:          `${ss(item.type)} • Score ${itemScore} (${scoreBand}) • Review required`,
        summary:         `This ${ss(item.type).toLowerCase()} has a score of ${itemScore} (${scoreBand}). Owner: ${ownerLabel || "unassigned"}. Status: ${ss(item.status)}.`,
        recommendations: ["Assign a clear owner and due date.", "Define and document a response plan.", "Schedule a review at next team meeting."],
        next_action:     "Assign owner and set a review date.",
        escalate:        itemScore >= 70 || ss(item.priority).toLowerCase() === "critical",
        confidence:      item.likelihood && item.severity && item.owner ? 0.7 : 0.4,
        signals:         [
          ...(!item.owner ? ["missing_owner"] : []),
          ...(itemScore >= 70 ? ["high_score_no_plan"] : []),
          ...(!item.priority ? ["missing_priority"] : []),
        ],
      };
    }

    // Write ai_rollup back to raid_log
    const { error: updateErr } = await supabase
      .from("raid_log")
      .update({ ai_rollup: ss(result.rollup), last_updated: new Date().toISOString() })
      .eq("id", id);

    if (updateErr) console.error("raid_log ai_rollup update failed:", updateErr.message);

    return jsonOk({
      id,
      score: itemScore,
      band:  scoreBand,
      rollup:          ss(result.rollup),
      summary:         ss(result.summary),
      recommendations: Array.isArray(result.recommendations) ? result.recommendations : [],
      next_action:     ss(result.next_action),
      escalate:        Boolean(result.escalate),
      confidence:      Number(result.confidence) || 0,
      signals:         Array.isArray(result.signals) ? result.signals : [],
    });
  } catch(e: any) {
    console.error("[POST /api/raid-log/ai-refresh]", e);
    return jsonErr(ss(e?.message) || "Server error", 500);
  }
}
