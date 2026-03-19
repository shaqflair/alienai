// src/app/api/projects/[id]/dates/route.ts
// PATCH — direct date edit for pipeline projects only
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function isValidDate(s: string | null): boolean {
  if (!s) return true; // null is valid (clearing a date)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
}

export async function PATCH(
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
    const startDate  = body?.start_date  ?? null;
    const finishDate = body?.finish_date ?? null;

    // Validate date formats
    if (!isValidDate(startDate) || !isValidDate(finishDate)) {
      return NextResponse.json({ ok: false, error: "Invalid date format. Use YYYY-MM-DD." }, { status: 400 });
    }

    if (startDate && finishDate && finishDate < startDate) {
      return NextResponse.json({ ok: false, error: "Finish date cannot be before start date." }, { status: 400 });
    }

    const activeOrgId = await getActiveOrgId();

    // Load project to verify access and status
    const { data: project } = await supabase
      .from("projects")
      .select("id, organisation_id, resource_status, status")
      .eq("id", projectId)
      .maybeSingle();

    if (!project) {
      return NextResponse.json({ ok: false, error: "Project not found" }, { status: 404 });
    }

    if (activeOrgId && project.organisation_id !== activeOrgId) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    // Only pipeline projects can have dates edited directly
    if (safeStr(project.resource_status).toLowerCase() !== "pipeline") {
      return NextResponse.json({
        ok: false,
        error: "Active projects require a change request to update dates. Use /dates/change-request instead.",
      }, { status: 422 });
    }

    // Check user has edit access (project member with editor/owner role, or org admin)
    const { data: orgMember } = await supabase
      .from("organisation_members")
      .select("role")
      .eq("organisation_id", project.organisation_id)
      .eq("user_id", user.id)
      .is("removed_at", null)
      .maybeSingle();

    const isOrgAdmin = ["admin", "owner"].includes(safeStr(orgMember?.role).toLowerCase());

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
        return NextResponse.json({ ok: false, error: "You do not have permission to edit project dates." }, { status: 403 });
      }
    }

    // Update dates
    const { error: updateErr } = await supabase
      .from("projects")
      .update({
        start_date:  startDate  || null,
        finish_date: finishDate || null,
        updated_at:  new Date().toISOString(),
      })
      .eq("id", projectId);

    if (updateErr) {
      return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, start_date: startDate, finish_date: finishDate });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Update failed" }, { status: 500 });
  }
}