/**
 * src/app/api/ai/financial-intelligence/route.ts
 *
 * POST /api/ai/financial-intelligence
 *
 * Analyses a financial plan and returns structured AI commentary.
 * Uses OpenAI Responses API (gpt-4o-mini by default).
 * All fall back to rule-based logic if the OpenAI call fails.
 */
import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import {
  analyseFinancialPlan,
  ruleBasedAnalysis,
  buildMonthKeysFromConfig,
  buildQuartersFromKeys,
  sumMonthsForLines,
  type Signal,
  type FinancialAIAnalysis,
} from "@/lib/financial-intelligence";
import type { FinancialPlanContent } from "@/components/artifacts/FinancialPlanEditor";
import type { MonthlyData, FYConfig } from "@/components/artifacts/FinancialPlanMonthlyView";

// ── Constants ─────────────────────────────────────────────────────────────────

const NO_STORE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

// ── JSON helpers ──────────────────────────────────────────────────────────────

function jsonOk(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE_HEADERS });
}

function jsonErr(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

function clamp(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars) + "\n…[truncated]" : text;
}

// ── Request body ──────────────────────────────────────────────────────────────

type RequestBody = {
  content: FinancialPlanContent;
  monthlyData: MonthlyData;
  fyConfig: FYConfig;
  lastUpdatedAt?: string;
  raidItems?: Array<{ type: string; title: string; severity: string; status: string }>;
  approvalDelays?: Array<{ title: string; daysPending: number; cost_impact?: number }>;
};

// ── JSON schema for OpenAI structured output ──────────────────────────────────

function buildResponseSchema() {
  return {
    name: "financial_ai_analysis",
    strict: true,
    schema: {
      type: "object",
      properties: {
        headline:    { type: "string" },
        overall_rag: { type: "string", enum: ["red", "amber", "green"] },
        narrative:   { type: "string" },
        drivers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title:              { type: "string" },
              explanation:        { type: "string" },
              severity:           { type: "string", enum: ["critical", "warning", "info"] },
              quarter:            { type: ["string", "null"] },
              recommended_action: { type: "string" },
            },
            required: ["title", "explanation", "severity", "quarter", "recommended_action"],
            additionalProperties: false,
          },
        },
        early_warnings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              warning:          { type: "string" },
              likelihood:       { type: "string", enum: ["high", "medium", "low"] },
              potential_impact: { type: "string" },
            },
            required: ["warning", "likelihood", "potential_impact"],
            additionalProperties: false,
          },
        },
        pm_actions: { type: "array", items: { type: "string" } },
      },
      required: ["headline", "overall_rag", "narrative", "drivers", "early_warnings", "pm_actions"],
      additionalProperties: false,
    },
  };
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are a senior project finance advisor embedded in a project management governance platform.
Your role is to analyse financial plan data, explain why forecasts are moving, and provide specific early warnings for Project Managers.

Rules:
- Be direct and specific: reference exact amounts, months, and cost line names
- Never give generic advice — every recommendation must reference specific data from the context
- Prioritise critical signals above informational ones
- Keep narrative concise: PMs need actionable intelligence, not financial theory
- All amounts should include the currency symbol from the context
- Return only JSON matching the schema — no preamble, no markdown`;
}

// ── User prompt builder ───────────────────────────────────────────────────────

function buildUserPrompt(body: RequestBody, signals: Signal[]): string {
  const { content, monthlyData, fyConfig, raidItems, approvalDelays } = body;
  const sym = content.currency === "USD" ? "$" : content.currency === "EUR" ? "€" : "£";
  const lines = content.cost_lines ?? [];
  const allMonths = buildMonthKeysFromConfig(fyConfig);
  const quarters  = buildQuartersFromKeys(allMonths, fyConfig.fy_start_month);
  const nowKey = new Date().toISOString().slice(0, 7);

  const approvedBudget = Number(content.total_approved_budget) || 0;
  const totalForecast  = sumMonthsForLines(lines, monthlyData, allMonths, "forecast");
  const totalActual    = sumMonthsForLines(lines, monthlyData, allMonths, "actual");
  const totalBudget    = sumMonthsForLines(lines, monthlyData, allMonths, "budget");

  const qSummaries = quarters.map(q => {
    const qB = sumMonthsForLines(lines, monthlyData, q.months, "budget");
    const qA = sumMonthsForLines(lines, monthlyData, q.months.filter(m => m < nowKey), "actual");
    const qF = sumMonthsForLines(lines, monthlyData, q.months, "forecast");
    return `${q.label}: Budget ${sym}${qB.toLocaleString()}, Actual ${sym}${qA.toLocaleString()}, Forecast ${sym}${qF.toLocaleString()}, Util ${qB ? Math.round((qF/qB)*100) : "N/A"}%`;
  }).join("\n");

  const signalSummary = signals.map(s =>
    `[${s.severity.toUpperCase()}] ${s.code}: ${s.aiContext || s.detail}`
  ).join("\n");

  const raidSummary = raidItems?.length
    ? `\nRAID items:\n${raidItems.map(r => `- ${r.type.toUpperCase()} | ${r.title} | ${r.severity} | ${r.status}`).join("\n")}`
    : "";

  const approvalSummary = approvalDelays?.length
    ? `\nApproval delays:\n${approvalDelays.map(a =>
        `- "${a.title}" pending ${a.daysPending} days${a.cost_impact ? `, potential cost impact ${sym}${a.cost_impact.toLocaleString()}` : ""}`
      ).join("\n")}`
    : "";

  const ctx = {
    currency: content.currency,
    approved_budget: approvedBudget,
    total_phased_budget: totalBudget,
    total_actual: totalActual,
    total_forecast: totalForecast,
    forecast_vs_approved_pct: approvedBudget ? Math.round((totalForecast / approvedBudget) * 100) : null,
    cost_lines: lines.map(l => ({
      category: l.category,
      description: l.description,
      budgeted: l.budgeted,
      forecast: l.forecast,
      actual: l.actual,
    })),
    change_requests: (content.change_exposure ?? []).map(c => ({
      ref: c.change_ref, title: c.title, cost_impact: c.cost_impact, status: c.status,
    })),
  };

  return [
    "FINANCIAL PLAN CONTEXT",
    "======================",
    clamp(JSON.stringify(ctx, null, 2), 6000),
    "",
    "QUARTERLY SUMMARY",
    "=================",
    qSummaries,
    "",
    "SIGNALS DETECTED",
    "================",
    signalSummary || "No signals detected.",
    raidSummary,
    approvalSummary,
    "",
    "Return only JSON matching the schema.",
  ].join("\n");
}

// ── OpenAI call — Chat Completions API ───────────────────────────────────────

async function callOpenAI(body: RequestBody, signals: Signal[]): Promise<FinancialAIAnalysis | null> {
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) return null;

  const openai = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user",   content: buildUserPrompt(body, signals) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: buildResponseSchema(),
      },
    });

    const outText = completion.choices[0].message.content;
    if (!outText) return null;
    return JSON.parse(outText) as FinancialAIAnalysis;
  } catch (err) {
    console.error("OpenAI call failed:", err);
    return null;
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body: RequestBody = await req.json();

    if (!body?.content || !body?.fyConfig) {
      return jsonErr("Missing required fields: content, fyConfig", 400);
    }

    // 1. Deterministic signal engine (always runs, zero latency)
    const signals = analyseFinancialPlan(
      body.content,
      body.monthlyData ?? {},
      body.fyConfig,
      { lastUpdatedAt: body.lastUpdatedAt },
    );

    // 2. Attempt AI Analysis
    const aiResult = await callOpenAI(body, signals);

    // 3. Fall back to rule-based analysis if OpenAI unavailable
    const analysis: FinancialAIAnalysis = aiResult
      ?? ruleBasedAnalysis(signals, body.content, body.monthlyData ?? {}, body.fyConfig);

    return jsonOk({ signals, analysis });

  } catch (e: any) {
    return jsonErr(e?.message || "Server error", 500);
  }
}
