import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import {
  Decision,
  DecisionSignal,
  DecisionIntelligenceResult,
  DecisionOption,
  computeDecisionSignals,
  ruleBasedDecisionAnalysis,
  rationaleQualityScore,
  daysTil,
} from "@/lib/decision-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

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

async function generateIntelligenceForProject(
  projectId: string,
  projectName: string,
  decisions: Decision[]
): Promise<{ result: DecisionIntelligenceResult; signals: DecisionSignal[]; fallback: boolean }> {
  const signals = computeDecisionSignals(decisions);
  const apiKey = process.env.OPENAI_API_KEY || process.env.WIRE_AI_API_KEY;

  if (!apiKey) {
    return { result: ruleBasedDecisionAnalysis(decisions, signals), signals, fallback: true };
  }

  const openai = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const open = decisions.filter(
    (d) => !["implemented", "rejected", "superseded"].includes(d.status)
  );

  const prompt = `You are a senior project governance advisor reviewing a decision log for daily briefing.

Project: ${projectName}
Total: ${decisions.length} | Open: ${open.length} | Implemented: ${decisions.filter((d) => d.status === "implemented").length}

SIGNALS
${signals.length > 0 ? signals.map((s) => `[${s.severity.toUpperCase()}] ${s.label}: ${s.detail}`).join("\n") : "No signals"}

OPEN DECISIONS (top 10 by impact)
${open
  .sort((a, b) => {
    const s = { critical: 3, high: 2, medium: 1, low: 0 };
    return s[b.impact] - s[a.impact];
  })
  .slice(0, 10)
  .map((d) => {
    const rScore = rationaleQualityScore(d);
    const overdue = d.neededByDate ? daysTil(d.neededByDate) : null;
    return `${d.ref} ${d.title} | ${d.status} | ${d.impact} impact | Owner: ${d.owner || "UNOWNED"} | Rationale: ${rScore}/5${overdue !== null && overdue < 0 ? " | OVERDUE " + Math.abs(overdue) + "d" : ""}`;
  })
  .join("\n")}

Concise governance brief. Narrative: 2-3 sentences max.`;

  try {
    const response = await openai.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_schema", json_schema: JSON_SCHEMA },
    });

    const result: DecisionIntelligenceResult = JSON.parse(
      response.choices[0].message.content || "{}"
    );
    return { result, signals, fallback: false };
  } catch (err) {
    console.error(`[decision-cron] AI failed for ${projectId}:`, err);
    return { result: ruleBasedDecisionAnalysis(decisions, signals), signals, fallback: true };
  }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, any> = {};
  let processed = 0;
  let failed = 0;

  try {
    const supabase = getSupabase();

    const { data: projects, error: projectErr } = await supabase
      .from("projects")
      .select("id, name")
      .eq("status", "active");

    if (projectErr) throw projectErr;
    if (!projects || projects.length === 0) {
      return NextResponse.json({ message: "No active projects", processed: 0 });
    }

    for (const project of projects) {
      try {
        const { data: rawDecisions, error: decErr } = await supabase
          .from("decisions")
          .select("*")
          .eq("project_id", project.id);

        if (decErr) {
          console.error(`[decision-cron] Fetch failed for ${project.id}:`, decErr);
          failed++;
          continue;
        }

        const decisions: Decision[] = (rawDecisions ?? []).map((row: any) => ({
          id: row.id,
          ref: row.ref,
          title: row.title,
          context: row.context ?? "",
          rationale: row.rationale ?? "",
          decision: row.decision ?? "",
          category: row.category ?? "Other",
          status: row.status,
          impact: row.impact ?? "medium",
          impactDescription: row.impact_description ?? "",
          owner: row.owner,
          approver: row.approver,
          optionsConsidered: row.options_considered ? JSON.parse(row.options_considered) as DecisionOption[] : [],
          dateRaised: row.date_raised,
          neededByDate: row.needed_by_date,
          approvedDate: row.approved_date,
          implementationDate: row.implementation_date,
          reviewDate: row.review_date,
          reversible: row.reversible ?? false,
          linkedRisks: row.linked_risks ? JSON.parse(row.linked_risks) : [],
          linkedChangeRequests: row.linked_change_requests ? JSON.parse(row.linked_change_requests) : [],
          linkedMilestones: row.linked_milestones ? JSON.parse(row.linked_milestones) : [],
          tags: row.tags ? JSON.parse(row.tags) : [],
          lastUpdated: row.last_updated,
          notes: row.notes ?? "",
        }));

        const { result, signals, fallback } = await generateIntelligenceForProject(
          project.id,
          project.name,
          decisions
        );

        const { error: upsertErr } = await supabase.from("decision_intelligence").upsert(
          {
            project_id: project.id,
            headline: result.headline,
            rag: result.rag,
            narrative: result.narrative,
            key_decisions: JSON.stringify(result.keyDecisions),
            pending_risks: JSON.stringify(result.pendingRisks),
            pm_actions: JSON.stringify(result.pmActions),
            early_warnings: JSON.stringify(result.earlyWarnings),
            signals: JSON.stringify(signals),
            fallback,
            generated_at: new Date().toISOString(),
          },
          { onConflict: "project_id" }
        );

        if (upsertErr) {
          console.error(`[decision-cron] Upsert failed for ${project.id}:`, upsertErr);
          failed++;
        } else {
          results[project.id] = { rag: result.rag, signals: signals.length, fallback };
          processed++;
        }
      } catch (projErr) {
        console.error(`[decision-cron] Project ${project.id} failed:`, projErr);
        failed++;
      }
    }

    return NextResponse.json({
      message: "Decision intelligence generated",
      processed,
      failed,
      results,
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[decision-cron] Fatal error:", err);
    return NextResponse.json({ error: "Cron job failed", detail: err?.message }, { status: 500 });
  }
}
