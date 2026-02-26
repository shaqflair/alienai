import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import {
  ArtifactHealth,
  ProjectHealthSnapshot,
  ProjectHealthResult,
  HealthSignal,
  computeHealthSignals,
  rollupRAG,
  computeTrend,
  ruleBasedHealthAnalysis,
} from "@/lib/project-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JSON_SCHEMA = {
  name: "project_health",
  strict: true,
  schema: {
    type: "object",
    properties: {
      headline: { type: "string" },
      rag: { type: "string", enum: ["green", "amber", "red", "unknown"] },
      narrative: { type: "string" },
      artifactBreakdown: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string", enum: ["financial", "raid", "schedule", "overall"] },
            label: { type: "string" },
            rag: { type: "string", enum: ["green", "amber", "red", "unknown"] },
            summary: { type: "string" },
            topConcern: { type: ["string", "null"] },
          },
          required: ["key", "label", "rag", "summary", "topConcern"],
          additionalProperties: false,
        },
      },
      crossCuttingRisks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            rationale: { type: "string" },
            urgency: { type: "string", enum: ["immediate", "this_week", "this_sprint", "monitor"] },
          },
          required: ["title", "rationale", "urgency"],
          additionalProperties: false,
        },
      },
      execActions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            action: { type: "string" },
            owner: { type: "string" },
            priority: { type: "string", enum: ["high", "medium", "low"] },
            timeframe: { type: "string" },
          },
          required: ["action", "owner", "priority", "timeframe"],
          additionalProperties: false,
        },
      },
      earlyWarnings: { type: "array", items: { type: "string" } },
    },
    required: ["headline", "rag", "narrative", "artifactBreakdown", "crossCuttingRisks", "execActions", "earlyWarnings"],
    additionalProperties: false,
  },
};

export async function POST(req: NextRequest) {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json" };
  try {
    const body = await req.json();
    const { artifacts, snapshots = [], projectName, windowDays = 30 } = body;

    if (!artifacts || !Array.isArray(artifacts)) {
      return NextResponse.json({ error: "artifacts array is required" }, { status: 400, headers });
    }

    const signals = computeHealthSignals(artifacts, snapshots);
    const overallRag = rollupRAG(artifacts);
    const trend = computeTrend(snapshots, windowDays);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ result: ruleBasedHealthAnalysis(artifacts, signals, snapshots), signals, overallRag, trend }, { headers });
    }

    const openai = new OpenAI({ apiKey });
    const model = process.env.OPENAI_MODEL || "gpt-4o";

    const trendSummary = snapshots.slice(0, 5).map((s: any) => `${s.snapshotDate}: ${s.overallRag.toUpperCase()}`).join(", ");

    const prompt = `Senior Programme Director Briefing.
Project: ${projectName || "Unnamed"}
Overall RAG: ${overallRag.toUpperCase()} | Trend: ${trend.toUpperCase()}

ARTIFACTS:
${artifacts.map((a: any) => `- ${a.label}: ${a.rag.toUpperCase()} (${a.headline})`).join("\n")}

SIGNALS:
${signals.length > 0 ? signals.map((s) => `[${s.severity}] ${s.label}: ${s.detail}`).join("\n") : "Stable."}

HISTORY: ${trendSummary}

Provide a concise exec briefing. Narrative 2-3 sentences. Identify cross-cutting risks and specific actions.`;

    const completion = await openai.chat.completions.create({
      model,
      messages: [{ role: "system", content: prompt }],
      response_format: { type: "json_schema", json_schema: JSON_SCHEMA },
    });

    const parsed = JSON.parse(completion.choices[0].message.content || "{}");
    return NextResponse.json({ result: parsed, signals, overallRag, trend }, { headers });

  } catch (err: any) {
    console.error("[project-health] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers });
  }
}
