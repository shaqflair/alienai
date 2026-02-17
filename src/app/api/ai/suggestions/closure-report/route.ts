// src/app/api/ai/suggestions/closure-report/route.ts
import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AiSuggestion = {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  reason: string;
  action_type: "flag_section" | "require_confirmation" | "add_text" | "update_field";
  action_payload?: any;
  ruleName?: string;
};

function s(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function safeJson(x: any) {
  if (!x) return null;
  if (typeof x === "object") return x;
  try {
    return JSON.parse(String(x));
  } catch {
    return null;
  }
}

function uid(prefix = "ai") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

/**
 * Very lightweight, deterministic rules.
 * (You can expand this later, or call your LLM safely from here.)
 */
function buildSuggestions(doc: any): AiSuggestion[] {
  const out: AiSuggestion[] = [];

  const healthSummary = s(doc?.health?.summary).trim();
  if (!healthSummary) {
    out.push({
      id: uid("cr"),
      severity: "critical",
      title: "Project health summary is missing",
      description: "Add a short overall health summary so execs understand the outcome at a glance.",
      reason: "Closure reports should always include an overall health narrative.",
      action_type: "flag_section",
      action_payload: { section: "summary" },
      ruleName: "closure.health.summary.missing",
    });
  }

  const wentWell = Array.isArray(doc?.lessons?.went_well) ? doc.lessons.went_well : [];
  const didntGoWell = Array.isArray(doc?.lessons?.didnt_go_well) ? doc.lessons.didnt_go_well : [];
  const surprises = Array.isArray(doc?.lessons?.surprises_risks) ? doc.lessons.surprises_risks : [];
  const lessonsCount = wentWell.length + didntGoWell.length + surprises.length;

  if (lessonsCount === 0) {
    out.push({
      id: uid("wrn"),
      severity: "warning",
      title: "Lessons Learned missing",
      description: "Capture what went well, what didnâ€™t go well, and surprises/risks.",
      reason: "Lessons Learned improves repeatability and reduces future risk.",
      action_type: "flag_section",
      action_payload: { section: "lessons_learned" },
      ruleName: "closure.lessons.missing",
    });
  }

  const budgetRows = Array.isArray(doc?.financial_closeout?.budget_rows) ? doc.financial_closeout.budget_rows : [];
  const hasAnyMoney = budgetRows.some((r: any) => Number.isFinite(Number(r?.budget)) || Number.isFinite(Number(r?.actual)));
  if (!hasAnyMoney) {
    out.push({
      id: uid("inf"),
      severity: "info",
      title: "Financial closeout looks incomplete",
      description: "Add budget vs actual (even if total-only) and confirm any variance explanation.",
      reason: "Finance stakeholders expect closure financials.",
      action_type: "flag_section",
      action_payload: { section: "financial_closeout" },
      ruleName: "closure.financials.incomplete",
    });
  }

  const outstanding = Array.isArray(doc?.deliverables?.outstanding) ? doc.deliverables.outstanding : [];
  if (outstanding.length > 0) {
    out.push({
      id: uid("wrn"),
      severity: "warning",
      title: "Outstanding items still open",
      description: "Confirm owners/targets for outstanding deliverables and agree handover approach.",
      reason: "Closure requires clear ownership of remaining work.",
      action_type: "flag_section",
      action_payload: { section: "outstanding_items" },
      ruleName: "closure.outstanding.present",
    });
  }

  const sponsorDecision = s(doc?.signoff?.sponsor_decision).trim();
  if (!sponsorDecision) {
    out.push({
      id: uid("inf"),
      severity: "info",
      title: "Sponsor decision not captured",
      description: "Record sponsor sign-off decision (approved/conditional/rejected) and date.",
      reason: "Governance typically requires explicit closure approval.",
      action_type: "flag_section",
      action_payload: { section: "signoff" },
      ruleName: "closure.signoff.sponsor.decision.missing",
    });
  }

  return out;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const artifactId = s(url.searchParams.get("artifact_id")).trim();

    if (!artifactId) {
      return NextResponse.json({ ok: false, error: "Missing artifact_id" }, { status: 400 });
    }

    const sb = await createClient();

    // Adjust select columns if your schema differs
    const { data, error } = await sb
      .from("artifacts")
      .select("id, type, content_json, updated_at, project_id")
      .eq("id", artifactId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ ok: false, error: "Artifact not found" }, { status: 404 });

    const doc = safeJson((data as any).content_json) || {};
    const suggestions = buildSuggestions(doc);

    return NextResponse.json({
      ok: true,
      artifact_id: artifactId,
      suggestions,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Failed" }, { status: 500 });
  }
}


