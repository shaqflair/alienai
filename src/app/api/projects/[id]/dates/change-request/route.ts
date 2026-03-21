// src/app/api/projects/[id]/dates/change-request/route.ts
// POST — raise a change request for date change on active projects
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function fmtDate(d: string | null): string {
  if (!d) return "Not set";
  try {
    return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch { return d; }
}

function daysDiff(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  try {
    return Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
  } catch { return null; }
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
    const body = await req.json().catch(() => ({}));

    const currentStart  = body?.current_start_date  ?? null;
    const currentFinish = body?.current_finish_date ?? null;
    const proposedStart  = body?.proposed_start_date  ?? null;
    const proposedFinish = body?.proposed_finish_date ?? null;
    const reason = safeStr(body?.reason).trim();
    const impact = safeStr(body?.impact).trim();

    if (!reason) {
      return NextResponse.json({ ok: false, error: "Reason is required." }, { status: 400 });
    }

    const hasChange =
      (proposedStart  ?? "") !== (currentStart  ?? "") ||
      (proposedFinish ?? "") !== (currentFinish ?? "");

    if (!hasChange) {
      return NextResponse.json({ ok: false, error: "No date changes proposed." }, { status: 400 });
    }

    if (proposedStart && proposedFinish && proposedFinish < proposedStart) {
      return NextResponse.json({ ok: false, error: "Proposed finish date cannot be before proposed start date." }, { status: 400 });
    }

    const activeOrgId = await getActiveOrgId();

    // Load project
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

    // Must be active (confirmed) to use this endpoint
    if (safeStr(project.resource_status).toLowerCase() === "pipeline") {
      return NextResponse.json({
        ok: false,
        error: "Pipeline projects can have dates edited directly. Use PATCH /dates instead.",
      }, { status: 422 });
    }

    // Check edit access
    const { data: orgMember } = await supabase
      .from("organisation_members")
      .select("role")
      .eq("organisation_id", project.organisation_id)
      .eq("user_id", user.id)
      .is("removed_at", null)
      .maybeSingle();

    const isOrgAdmin = ["admin", "owner"].includes(safeStr(orgMember?.role).toLowerCase());

    let requesterName = "";
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("user_id", user.id)
      .maybeSingle();
    requesterName = safeStr((profile as any)?.full_name).trim() || safeStr((profile as any)?.email).trim() || safeStr(user.email).trim() || "Unknown";

    if (!isOrgAdmin) {
      const { data: projMember } = await supabase
        .from("project_members")
        .select("role")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .is("removed_at", null)
        .maybeSingle();

      const role = safeStr(projMember?.role).toLowerCase();
      if (!["owner", "editor"].includes(role)) {
        return NextResponse.json({ ok: false, error: "You do not have permission to request date changes." }, { status: 403 });
      }
    }

    // Calculate slip
    const finishSlipDays = daysDiff(currentFinish, proposedFinish);
    const startSlipDays  = daysDiff(currentStart, proposedStart);

    // Build the proposed_change summary
    const proposedChangeSummary = [
      proposedStart !== currentStart
        ? `Start date: ${fmtDate(currentStart)} → ${fmtDate(proposedStart)} (${startSlipDays != null ? (startSlipDays > 0 ? `+${startSlipDays}` : startSlipDays) : "?"} days)`
        : null,
      proposedFinish !== currentFinish
        ? `Finish date: ${fmtDate(currentFinish)} → ${fmtDate(proposedFinish)} (${finishSlipDays != null ? (finishSlipDays > 0 ? `+${finishSlipDays}` : finishSlipDays) : "?"} days)`
        : null,
    ].filter(Boolean).join("\n");

    // Build impact_analysis JSONB
    const impactAnalysis = {
      type: "date_change",
      current: {
        start_date:  currentStart,
        finish_date: currentFinish,
      },
      proposed: {
        start_date:  proposedStart,
        finish_date: proposedFinish,
      },
      slip: {
        start_days:  startSlipDays,
        finish_days: finishSlipDays,
      },
      schedule_impact: impact || null,
      submitted_at: new Date().toISOString(),
    };

    // Create the change request
    const { data: cr, error: crErr } = await supabase
  .from("change_requests")
  .insert({
    project_id:       projectId,
    organisation_id:  project.organisation_id,
    requester_id:     user.id,
    requester_name:   requesterName,
    title:            `Date Change Request — ${project.title}`,
    description:      reason,
    proposed_change:  proposedChangeSummary,
    justification:    reason,
    schedule:         impact || `Finish date moved by ${finishSlipDays != null ? `${finishSlipDays} days` : "unknown"}.`,
    impact_analysis:  impactAnalysis,
    tags:             ["date_change"],
    status:           "new",
    delivery_status:  "analysis",
    decision_status:  "draft",
    priority:         finishSlipDays != null && finishSlipDays > 30 ? "High" : "Medium",
    financial:        "No direct financial impact unless resources are extended.",
    risks:            "Delay may impact downstream dependencies and stakeholder commitments.",
    assumptions:      "Proposed dates have been reviewed with the delivery team.",
    lane_sort:        0,
  })
  .select("id, public_id")
  .single();

    if (crErr || !cr) {
      return NextResponse.json({ ok: false, error: crErr?.message || "Failed to create change request" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      changeRequestId: cr.id,
      publicId: cr.public_id,
      message: "Date change request submitted successfully. Dates will be updated once approved.",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Submission failed" }, { status: 500 });
  }
}