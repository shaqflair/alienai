import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import {
  RAIDItem,
  RAIDSignal,
  RAIDIntelligenceResult,
  computeRAIDSignals,
  ruleBasedRAIDAnalysis,
} from "@/lib/raid-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JSON_SCHEMA = {
  name: "raid_intelligence",
  strict: true,
  schema: {
    type: "object",
    properties: {
      headline: { type: "string" },
      rag: { type: "string", enum: ["green", "amber", "red"] },
      narrative: { type: "string" },
      topRisks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ref: { type: "string" },
            title: { type: "string" },
            rationale: { type: "string" },
            urgency: {
              type: "string",
              enum: ["immediate", "this_week", "this_sprint", "monitor"],
            },
          },
          required: ["ref", "title", "rationale", "urgency"],
          additionalProperties: false,
        },
      },
      escalations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ref: { type: "string" },
            reason: { type: "string" },
            recommendedAction: { type: "string" },
          },
          required: ["ref", "reason", "recommendedAction"],
          additionalProperties: false,
        },
      },
      pmActions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            action: { type: "string" },
            priority: { type: "string", enum: ["high", "medium", "low"] },
            timeframe: { type: "string" },
          },
          required: ["action", "priority", "timeframe"],
          additionalProperties: false,
        },
      },
      earlyWarnings: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: [
      "headline",
      "rag",
      "narrative",
      "topRisks",
      "escalations",
      "pmActions",
      "earlyWarnings",
    ],
    additionalProperties: false,
  },
};

export async function POST(req: NextRequest) {
  const headers = {
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  };

  try {
    const body = await req.json();
    const { items, projectName, projectContext } = body as {
      items: RAIDItem[];
      projectName?: string;
      projectContext?: string;
    };

    if (!items || !Array.isArray(items)) {
      return NextResponse.json(
        { error: "items array is required" },
        { status: 400, headers }
      );
    }

    // Always compute deterministic signals first
    const signals: RAIDSignal[] = computeRAIDSignals(items);

    const apiKey =
      process.env.OPENAI_API_KEY || process.env.WIRE_AI_API_KEY;

    if (!apiKey) {
      const fallback = ruleBasedRAIDAnalysis(items, signals);
      return NextResponse.json({ result: fallback, signals }, { headers });
    }

    const openai = new OpenAI({ apiKey });
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const open = items.filter(
      (i) => !["closed", "resolved", "mitigated"].includes(i.status)
    );

    const prompt = `You are a senior project risk advisor analysing a project RAID log.

Project: ${projectName || "Unnamed Project"}
${projectContext ? `Context: ${projectContext}` : ""}

RAID SUMMARY
Total items: ${items.length}
Open: ${open.length}
Risks: ${open.filter((i) => i.type === "risk").length}
Assumptions: ${open.filter((i) => i.type === "assumption").length}
Issues: ${open.filter((i) => i.type === "issue").length}
Dependencies: ${open.filter((i) => i.type === "dependency").length}

ACTIVE SIGNALS
${signals.length > 0 ? signals.map((s) => `[${s.severity.toUpperCase()}] ${s.label}: ${s.detail}`).join("\n") : "No signals triggered"}

OPEN RAID ITEMS (top 15 by severity)
${open
  .sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0))
  .slice(0, 15)
  .map(
    (i) =>
      `${i.ref} [${i.type.toUpperCase()}] ${i.title}
  Status: ${i.status} | Impact: ${i.impact} | Owner: ${i.owner || "UNOWNED"} | Due: ${i.dueDate || "none"}
  Last updated: ${i.lastUpdated}${i.riskScore ? ` | Risk score: ${i.riskScore}` : ""}
  ${i.mitigationPlan ? `Mitigation: ${i.mitigationPlan}` : "No mitigation plan"}`
  )
  .join("\n\n")}

Provide a structured RAID intelligence briefing. The narrative should be 2-3 sentences, direct, and actionable. The headline should be a single sentence suitable for an executive dashboard. Flag the 3 most critical risks and any items requiring immediate escalation. List 3-5 concrete PM actions.`;

    try {
      const completion = await openai.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_schema", json_schema: JSON_SCHEMA },
      });

      const parsed: RAIDIntelligenceResult = JSON.parse(
        completion.choices[0].message.content || "{}"
      );

      return NextResponse.json({ result: parsed, signals }, { headers });
    } catch (aiErr: any) {
      console.error("[raid-intelligence] OpenAI error:", aiErr?.message);
      const fallback = ruleBasedRAIDAnalysis(items, signals);
      return NextResponse.json({ result: fallback, signals }, { headers });
    }
  } catch (err: any) {
    console.error("[raid-intelligence] Route error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
