// src/app/api/ai/decision-intelligence/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import {
  Decision,
  DecisionSignal,
  DecisionIntelligenceResult,
  computeDecisionSignals,
  ruleBasedDecisionAnalysis,
  rationaleQualityScore,
  daysTil,
  daysSince,
} from "@/lib/decision-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JSON_SCHEMA = {
  name: "decision_intelligence",
  strict: true,
  schema: {
    type: "object",
    properties: {
      headline: { type: "string" },
      rag: { type: "string", enum: ["green", "amber", "red"] },
      narrative: { type: "string" },
      keyDecisions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ref: { type: "string" },
            title: { type: "string" },
            rationaleScore: { type: "number" },
            rationaleAssessment: { type: "string" },
            impactAssessment: { type: "string" },
            urgency: { type: "string", enum: ["immediate", "this_week", "this_sprint", "monitor"] },
          },
          required: ["ref", "title", "rationaleScore", "rationaleAssessment", "impactAssessment", "urgency"],
          additionalProperties: false,
        },
      },
      pendingRisks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ref: { type: "string" },
            risk: { type: "string" },
            recommendation: { type: "string" },
          },
          required: ["ref", "risk", "recommendation"],
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
      earlyWarnings: { type: "array", items: { type: "string" } },
    },
    required: ["headline", "rag", "narrative", "keyDecisions", "pendingRisks", "pmActions", "earlyWarnings"],
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
    const { decisions, projectName, projectContext } = body as {
      decisions: Decision[];
      projectName?: string;
      projectContext?: string;
    };

    if (!decisions || !Array.isArray(decisions)) {
      return NextResponse.json({ error: "decisions array is required" }, { status: 400, headers });
    }

    const signals: DecisionSignal[] = computeDecisionSignals(decisions);
    const apiKey = process.env.OPENAI_API_KEY || process.env.WIRE_AI_API_KEY;

    if (!apiKey) {
      const fallback = ruleBasedDecisionAnalysis(decisions, signals);
      return NextResponse.json({ result: fallback, signals }, { headers });
    }

    const openai = new OpenAI({ apiKey });
    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

    const open = decisions.filter(
      (d) => !["implemented", "rejected", "superseded"].includes(d.status)
    );

    const prompt = `You are a senior project governance advisor reviewing a project decision log.

Project: ${projectName || "Unnamed Project"}
${projectContext ? `Context: ${projectContext}` : ""}

DECISION LOG SUMMARY
Total decisions: ${decisions.length}
Open: ${open.length} | Approved: ${decisions.filter((d) => d.status === "approved").length} | Implemented: ${decisions.filter((d) => d.status === "implemented").length}
Categories: ${[...new Set(decisions.map((d) => d.category))].join(", ")}

ACTIVE SIGNALS
${signals.length > 0 ? signals.map((s) => `[${s.severity.toUpperCase()}] ${s.label}: ${s.detail}`).join("\n") : "No signals triggered"}

OPEN DECISIONS (sorted by impact)
${open
  .sort((a, b) => {
    const s = { critical: 3, high: 2, medium: 1, low: 0 };
    return s[b.impact] - s[a.impact];
  })
  .slice(0, 12)
  .map((d) => {
    const rScore = rationaleQualityScore(d);
    const overdue = d.neededByDate ? daysTil(d.neededByDate) : null;
    return `${d.ref} [${d.category}] ${d.title}
  Status: ${d.status} | Impact: ${d.impact} | Owner: ${d.owner || "UNOWNED"} | Reversible: ${d.reversible ? "yes" : "no"}
  Raised: ${d.dateRaised}${d.neededByDate ? ` | Needed by: ${d.neededByDate}${overdue !== null && overdue < 0 ? ` (OVERDUE ${Math.abs(overdue)}d)` : ""}` : ""}
  Rationale quality: ${rScore}/5
  Decision: ${d.decision || "(not yet recorded)"}
  Rationale: ${d.rationale ? d.rationale.slice(0, 150) : "(missing)"}`;
  })
  .join("\n\n")}

Provide a structured decision intelligence briefing. Score rationale quality 1-5 where: 5=excellent evidence-based reasoning with options considered, 3=adequate with some justification, 1=missing or single sentence. Narrative: 2-3 sentences, direct and actionable. Headline: single sentence for executive dashboard. Flag decisions that could create project risk if unresolved.`;

    try {
      const response = await (openai as any).post(
        "https://api.openai.com/v1/responses",
        {
          model,
          input: prompt,
          max_output_tokens: 1200,
          response_format: { type: "json_schema", json_schema: JSON_SCHEMA },
        }
      );

      const parsed: DecisionIntelligenceResult = JSON.parse(
        response.data?.output_text ?? response.output_text ?? "{}"
      );

      return NextResponse.json({ result: parsed, signals }, { headers });
    } catch (aiErr: any) {
      console.error("[decision-intelligence] OpenAI error:", aiErr?.message);
      const fallback = ruleBasedDecisionAnalysis(decisions, signals);
      return NextResponse.json({ result: fallback, signals }, { headers });
    }
  } catch (err: any) {
    console.error("[decision-intelligence] Route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers });
  }
}
