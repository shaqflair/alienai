// src/app/api/ai/pm-assessment/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { buildPmImpactAssessment, safeStr, safeNum } from "@/lib/ai/change-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonNoStore(data: any, init?: ResponseInit) {
  const res = NextResponse.json(data, init);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return jsonNoStore({ ok: false, error: "Unauthorized" }, { status: 401 });

    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }

    const projectId = safeStr(body?.projectId).trim();
    const changeId  = safeStr(body?.changeId).trim();

    if (!projectId) return jsonNoStore({ ok: false, error: "Missing projectId" }, { status: 400 });
    if (!changeId)  return jsonNoStore({ ok: false, error: "Missing changeId" },  { status: 400 });

    // Verify project membership
    const { data: project } = await supabase
      .from("projects")
      .select("id, organisation_id")
      .eq("id", projectId)
      .maybeSingle();

    if (!project) return jsonNoStore({ ok: false, error: "Project not found" }, { status: 404 });

    const { data: mem } = await supabase
      .from("organisation_members")
      .select("role")
      .eq("organisation_id", project.organisation_id)
      .eq("user_id", user.id)
      .is("removed_at", null)
      .maybeSingle();

    if (!mem) return jsonNoStore({ ok: false, error: "Forbidden" }, { status: 403 });

    // Load the change request
    const { data: cr, error: crErr } = await supabase
      .from("change_requests")
      .select("*")
      .eq("id", changeId)
      .maybeSingle();

    if (crErr) return jsonNoStore({ ok: false, error: crErr.message }, { status: 500 });
    if (!cr)   return jsonNoStore({ ok: false, error: "Change request not found" }, { status: 404 });

    const ia   = cr.impact_analysis ?? {};
    const days = safeNum(ia?.days ?? cr.ai_schedule, 0);
    const cost = safeNum(ia?.cost ?? cr.ai_cost, 0);
    const risk = safeStr(ia?.risk ?? cr.risk ?? "").trim() || "Not assessed";

    // Call the real PM assessment AI
    const assessment = await buildPmImpactAssessment({
      title:              safeStr(cr.title),
      description:        safeStr(cr.description ?? cr.summary),
      justification:      safeStr(cr.justification),
      financial:          safeStr(cr.financial),
      schedule:           safeStr(cr.schedule),
      risks:              safeStr(cr.risks),
      dependencies:       safeStr(cr.dependencies),
      implementationPlan: safeStr(cr.implementation_plan ?? cr.implementationPlan),
      rollbackPlan:       safeStr(cr.rollback_plan ?? cr.rollbackPlan),
      deliveryStatus:     safeStr(cr.delivery_status ?? cr.status ?? "new"),
      decisionStatus:     safeStr(cr.decision_status ?? "none"),
      priority:           safeStr(cr.priority ?? "Medium"),
      cost,
      days,
      risk,
    });

    return jsonNoStore({
      ok: true,
      assessment,
      model: assessment.model,
      analysed_at: new Date().toISOString(),
      cr: {
        id: cr.id,
        title: cr.title,
        seq: cr.seq ?? null,
      },
    });
  } catch (e: any) {
    return jsonNoStore({ ok: false, error: safeStr(e?.message) || "Assessment failed" }, { status: 500 });
  }
}