// src/app/api/projects/[id]/gate/record-baseline/route.ts
// Records Gate 1 for projects that were created directly as active (bypassed pipeline)
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import { checkGate1 } from "@/lib/server/gates/checkGate1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id: projectId } = await params;
    const body = await req.formData().catch(() => null);
    const gateOverride   = safeStr(body?.get("gate_override")).trim() === "true";
    const overrideReason = safeStr(body?.get("gate_override_reason")).trim();

    const activeOrgId = await getActiveOrgId();

    const { data: project } = await supabase
      .from("projects")
      .select("id, organisation_id, resource_status, title")
      .eq("id", projectId)
      .maybeSingle();

    if (!project) {
      return NextResponse.json({ ok: false, error: "Project not found" }, { status: 404 });
    }

    if (activeOrgId && project.organisation_id !== activeOrgId) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    // Only admins can record baseline
    const { data: orgMember } = await supabase
      .from("organisation_members")
      .select("role")
      .eq("organisation_id", project.organisation_id)
      .eq("user_id", user.id)
      .is("removed_at", null)
      .maybeSingle();

    const isAdmin = ["admin", "owner"].includes(safeStr(orgMember?.role).toLowerCase());
    if (!isAdmin) {
      return NextResponse.json({ ok: false, error: "Only org admins can record a retrospective baseline." }, { status: 403 });
    }

    // Check if a gate record already exists
    const { data: existing } = await supabase
      .from("project_gates")
      .select("id")
      .eq("project_id", projectId)
      .eq("gate_number", 1)
      .maybeSingle();

    if (existing?.id) {
      return NextResponse.json({ ok: false, error: "Gate 1 has already been recorded for this project." }, { status: 409 });
    }

    // Run the gate check
    const gate = await checkGate1(projectId);
    const canProceedClean = gate.failCount === 0 && gate.warnCount === 0;

    if (!canProceedClean && !gateOverride) {
      return NextResponse.json({
        ok: false,
        error: "Gate criteria not fully met. Use override=true with a reason to record anyway.",
        gate,
      }, { status: 422 });
    }

    if (!canProceedClean && gate.failCount > 0 && !overrideReason) {
      return NextResponse.json({ ok: false, error: "An override reason is required." }, { status: 400 });
    }

    // Record the gate
    const { error: insertErr } = await supabase.from("project_gates").insert({
      project_id:        projectId,
      organisation_id:   project.organisation_id,
      gate_number:       1,
      gate_name:         "Baseline",
      status:            canProceedClean ? "passed" : "passed_with_override",
      passed_at:         new Date().toISOString(),
      passed_by:         user.id,
      override:          !canProceedClean,
      override_reason:   !canProceedClean ? overrideReason : null,
      pass_count:        gate.passCount,
      warn_count:        gate.warnCount,
      fail_count:        gate.failCount,
      criteria_snapshot: gate.criteria,
    });

    if (insertErr) {
      return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      projectId,
      message: canProceedClean
        ? "Gate 1 baseline recorded successfully."
        : "Gate 1 baseline recorded with override.",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Failed" }, { status: 500 });
  }
}