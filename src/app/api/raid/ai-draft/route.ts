// src/app/api/raid/ai-draft/route.ts
// POST { prompt, projectId } -> filled RAID item fields
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonOk(d: any) { return NextResponse.json({ ok: true, ...d }, { headers: { "Cache-Control": "no-store" } }); }
function jsonErr(e: string, s = 400) { return NextResponse.json({ ok: false, error: e }, { status: s, headers: { "Cache-Control": "no-store" } }); }
function ss(x: any): string { return typeof x === "string" ? x : x == null ? "" : String(x); }

const SCHEMA = {
  name: "raid_draft",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      type:          { type: "string", enum: ["Risk","Issue","Assumption","Dependency"] },
      priority:      { type: "string", enum: ["Critical","High","Medium","Low"] },
      impact:        { type: "string", enum: ["critical","high","medium","low"] },
      title:         { type: "string" },
      description:   { type: "string" },
      probability:   { type: "number" },
      severity:      { type: "number" },
      response_plan: { type: "string" },
      next_steps:    { type: "string" },
      notes:         { type: "string" },
      reasoning:     { type: "string" },
    },
    required: ["type","priority","impact","title","description","probability","severity","response_plan","next_steps","notes","reasoning"],
  },
};

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return jsonErr("Unauthorized", 401);

    let body: any = {};
    try { body = await req.json(); } catch { return jsonErr("Invalid JSON", 400); }

    const prompt = ss(body.prompt).trim();
    if (!prompt) return jsonErr("Missing prompt", 400);

    // Fetch project context if provided
    let projectContext = "";
    if (body.projectId) {
      const { data: p } = await supabase.from("projects")
        .select("title,project_code,client_name,description")
        .eq("id", body.projectId).maybeSingle();
      if (p) projectContext = `Project: ${ss(p.title)} (${ss(p.project_code)}) | Client: ${ss(p.client_name)}`;
    }

    const systemPrompt = [
      "You are a PMO risk advisor helping a project manager log a RAID item.",
      "Based on their description, generate a complete, professional RAID item.",
      "",
      "Rules:",
      "- type: classify as Risk (uncertain future event), Issue (happening now), Assumption (something assumed true), or Dependency (external dependency)",
      "- title: concise, max 12 words, professional tone",
      "- description: 2-3 sentences, factual, specific to what was described",
      "- probability: 0-100 integer (how likely the risk materialises)",
      "- severity: 0-100 integer (how bad the impact would be)",
      "- priority: derived from probability+severity — Critical(>70), High(50-70), Medium(25-50), Low(<25)",
      "- impact: same scale as priority but lowercase",
      "- response_plan: concrete mitigation or management approach",
      "- next_steps: 1-2 immediate actions the PM should take this week",
      "- notes: any caveats, assumptions, or related context",
      "- reasoning: brief explanation of your probability/severity scoring",
      "Return only JSON.",
    ].join("\n");

    const userPrompt = [
      projectContext,
      "",
      `PM's description: "${prompt}"`,
      "",
      "Generate a complete RAID item based on this description.",
    ].filter(Boolean).join("\n");

    const apiKey = ss(process.env.WIRE_AI_API_KEY || process.env.OPENAI_API_KEY).trim();
    if (!apiKey) return jsonErr("AI not configured", 503);

    const openai = new OpenAI({ apiKey });
    const resp = await openai.chat.completions.create({
      model: ss(process.env.OPENAI_MODEL).trim() || "gpt-4.1-mini",
      temperature: 0.3,
      max_tokens: 800,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      response_format: { type: "json_schema", json_schema: SCHEMA },
    });

    const txt = resp.choices?.[0]?.message?.content;
    if (!txt) return jsonErr("No response from AI", 500);

    const result = JSON.parse(txt);
    return jsonOk({ draft: result });
  } catch (e: any) {
    console.error("[POST /api/raid/ai-draft]", e);
    return jsonErr(ss(e?.message) || "Server error", 500);
  }
}
