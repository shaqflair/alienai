// src/app/api/raid/financial-impact/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function jsonOk(d: any) { return NextResponse.json({ ok: true, ...d }, { headers: { "Cache-Control": "no-store" } }); }
function jsonErr(e: string, s = 400) { return NextResponse.json({ ok: false, error: e }, { status: s, headers: { "Cache-Control": "no-store" } }); }
function ss(x: any): string { return typeof x === "string" ? x : x == null ? "" : String(x); }
function sn(x: any): number | null { const n = Number(x); return Number.isFinite(n) ? n : null; }

const SCHEMA = {
  name: "raid_financial_impact",
  strict: true,
  schema: {
    type: "object",
    properties: {
      reasoning:           { type: "string" },
      currency:            { type: "string" },
      est_cost_impact:     { type: ["number", "null"] },
      est_revenue_at_risk: { type: ["number", "null"] },
      est_penalties:       { type: ["number", "null"] },
      est_schedule_days:   { type: ["number", "null"] },
      confidence:          { type: "string", enum: ["high", "medium", "low"] },
      key_assumptions:     { type: "array", items: { type: "string" } },
    },
    required: ["reasoning","currency","est_cost_impact","est_revenue_at_risk","est_penalties","est_schedule_days","confidence","key_assumptions"],
    additionalProperties: false,
  },
};

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return jsonErr("Unauthorized", 401);

    let body: any = {};
    try { body = await req.json(); } catch { return jsonErr("Invalid JSON body", 400); }
    const { raidItemId } = body;
    if (!raidItemId) return jsonErr("Missing raidItemId", 400);

    // Fetch RAID item
    const { data: item, error: itemErr } = await supabase
      .from("raid_items")
      .select("id,project_id,type,title,description,probability,severity,priority,status,response_plan,owner_label,due_date")
      .eq("id", raidItemId)
      .maybeSingle();
    if (itemErr || !item) return jsonErr("RAID item not found", 404);

    // Fetch project
    const { data: project } = await supabase
      .from("projects")
      .select("id,title,project_code,client_name")
      .eq("id", item.project_id)
      .maybeSingle();

    // Fetch latest financial plan artifact
    const { data: artifact } = await supabase
      .from("artifacts")
      .select("content,updated_at")
      .eq("project_id", item.project_id)
      .eq("type", "financial_plan")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let finContent: any = null;
    if (artifact?.content) {
      try {
        finContent = typeof artifact.content === "string" ? JSON.parse(artifact.content) : artifact.content;
      } catch { finContent = null; }
    }

    const sym = finContent?.currency === "USD" ? "$" : finContent?.currency === "EUR" ? "€" : "£";
    const currency = ss(finContent?.currency || "GBP");
    const approvedBudget = sn(finContent?.total_approved_budget);
    const costLines = (finContent?.cost_lines ?? []).slice(0, 10).map((l: any) => ({
      category: ss(l.category), budgeted: sn(l.budgeted), forecast: sn(l.forecast),
    }));

    const prompt = [
      `You are a senior financial risk advisor. Estimate the financial impact of this RAID item.`,
      ``,
      `PROJECT: ${ss(project?.title)} (${ss(project?.project_code)}) | Client: ${ss(project?.client_name)}`,
      `Approved budget: ${sym}${approvedBudget?.toLocaleString() ?? "unknown"}`,
      costLines.length ? `Cost lines: ${JSON.stringify(costLines)}` : "No financial plan available.",
      ``,
      `RAID ITEM:`,
      `Type: ${ss(item.type)} | Priority: ${ss(item.priority)} | Status: ${ss(item.status)}`,
      `Title: ${ss(item.title)}`,
      `Description: ${ss(item.description)}`,
      `Response plan: ${ss(item.response_plan) || "None"}`,
      `Probability: ${item.probability ?? "?"}% | Severity: ${item.severity ?? "?"}%`,
      `Owner: ${ss(item.owner_label)} | Due: ${ss(item.due_date) || "No date"}`,
      ``,
      `Estimate in ${sym} (${currency}). Use null if not applicable. Be specific.`,
    ].join("\n");

    const apiKey = ss(process.env.WIRE_AI_API_KEY || process.env.OPENAI_API_KEY).trim();
    let result: any = null;

    if (apiKey) {
      try {
        const openai = new OpenAI({ apiKey });
        const resp = await openai.chat.completions.create({
          model: ss(process.env.OPENAI_MODEL).trim() || "gpt-4.1-mini",
          temperature: 0.2,
          max_tokens: 600,
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_schema", json_schema: SCHEMA },
        });
        const txt = resp.choices?.[0]?.message?.content;
        if (txt) result = JSON.parse(txt);
      } catch (e) {
        console.error("[financial-impact] OpenAI failed:", e);
      }
    }

    if (!result) {
      const p = sn(item.probability) ?? 50;
      const s = sn(item.severity) ?? 50;
      const budgetFactor = approvedBudget ? approvedBudget * (p / 100) * (s / 100) : null;
      result = {
        reasoning: "AI unavailable — estimated from probability × severity × budget.",
        currency,
        est_cost_impact:     budgetFactor ? Math.round(budgetFactor * 0.6) : null,
        est_revenue_at_risk: budgetFactor ? Math.round(budgetFactor * 0.3) : null,
        est_penalties:       null,
        est_schedule_days:   Math.round((p / 100) * (s / 100) * 30),
        confidence:          "low",
        key_assumptions:     ["No financial plan data", "Estimate based on P×S formula only"],
      };
    }

    // Try to persist — don't let failure block the response
    try {
      await supabase.from("raid_financials").upsert({
        raid_item_id:        raidItemId,
        currency,
        est_cost_impact:     sn(result.est_cost_impact),
        est_revenue_at_risk: sn(result.est_revenue_at_risk),
        est_penalties:       sn(result.est_penalties),
        est_schedule_days:   sn(result.est_schedule_days),
        updated_at:          new Date().toISOString(),
      }, { onConflict: "raid_item_id" });
    } catch (e) {
      console.warn("[financial-impact] upsert failed (non-fatal):", e);
    }

    return jsonOk({
      raidItemId,
      currency,
      est_cost_impact:     sn(result.est_cost_impact),
      est_revenue_at_risk: sn(result.est_revenue_at_risk),
      est_penalties:       sn(result.est_penalties),
      est_schedule_days:   sn(result.est_schedule_days),
      confidence:          ss(result.confidence),
      reasoning:           ss(result.reasoning),
      key_assumptions:     Array.isArray(result.key_assumptions) ? result.key_assumptions : [],
    });
  } catch (e: any) {
    console.error("[POST /api/raid/financial-impact]", e);
    return jsonErr(ss(e?.message) || "Server error", 500);
  }
}
