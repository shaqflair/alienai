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

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.formData().catch(() => null);
    const projectId      = safeStr(body?.get("project_id")).trim();
    const gateOverride   = safeStr(body?.get("gate_override")).trim() === "true";
    const overrideReason = safeStr(body?.get("gate_override_reason")).trim();

    if (!projectId) {
      return NextResponse.json({ ok: false, error: "Missing project_id" }, { status: 400 });
    }

    const activeOrgId = await getActiveOrgId();

    // Verify project exists, belongs to org, and is pipeline
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, organisation_id, resource_status, title")
      .eq("id", projectId)
      .maybeSingle();

    if (projErr || !project) {
      return NextResponse.json({ ok: false, error: "Project not found" }, { status: 404 });
    }

    if (activeOrgId && project.organisation_id !== activeOrgId) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    if (project.resource_status !== "pipeline") {
      return NextResponse.json({ ok: false, error: "Project is not in pipeline status" }, { status: 400 });
    }

    // Check if user is org admin
    const { data: orgMember } = await supabase
      .from("organisation_members")
      .select("role")
      .eq("organisation_id", project.organisation_id)
      .eq("user_id", user.id)
      .is("removed_at", null)
      .maybeSingle();

    const isAdmin = ["admin", "owner"].includes(safeStr(orgMember?.role).toLowerCase());

    // Run Gate 1 check
    const gate = await checkGate1(projectId);
    const canProceedClean = gate.failCount === 0 && gate.warnCount === 0;

    // Determine if conversion is allowed
    if (!canProceedClean) {
      if (!gateOverride) {
        return NextResponse.json({
          ok: false,
          error: "Gate 1 criteria not met. Use override=true with a reason to proceed.",
          gate,
        }, { status: 422 });
      }

      // Only admins can override failures (warnings can be overridden by anyone with edit access)
      if (gate.failCount > 0 && !isAdmin) {
        return NextResponse.json({
          ok: false,
          error: "Only org admins can override failed Gate 1 criteria.",
          gate,
        }, { status: 403 });
      }

      if (!overrideReason) {
        return NextResponse.json({
          ok: false,
          error: "An override reason is required.",
        }, { status: 400 });
      }
    }

    // Convert the project
    const { error: updateErr } = await supabase
      .from("projects")
      .update({ resource_status: "confirmed" })
      .eq("id", projectId)
      .eq("resource_status", "pipeline");

    if (updateErr) {
      return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });
    }

    // Record the gate passage in project_gates (if table exists — fail gracefully)
    try {
      await supabase.from("project_gates").insert({
        project_id:        projectId,
        organisation_id:   project.organisation_id,
        gate_number:       1,
        gate_name:         "Baseline",
        status:            canProceedClean ? "passed" : gateOverride ? "passed_with_override" : "passed",
        passed_at:         new Date().toISOString(),
        passed_by:         user.id,
        override:          gateOverride && !canProceedClean,
        override_reason:   gateOverride && !canProceedClean ? overrideReason : null,
        pass_count:        gate.passCount,
        warn_count:        gate.warnCount,
        fail_count:        gate.failCount,
        criteria_snapshot: gate.criteria,
      });
    } catch {
      // table may not exist yet — log but don't fail the conversion
      console.warn("[Gate1] project_gates insert failed — table may not exist");
    }

    return NextResponse.json({
      ok: true,
      projectId,
      gateOverride: gateOverride && !canProceedClean,
      message: canProceedClean
        ? "Project successfully converted to active."
        : "Project converted to active with gate override.",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Conversion failed" },
      { status: 500 },
    );
  }
}
