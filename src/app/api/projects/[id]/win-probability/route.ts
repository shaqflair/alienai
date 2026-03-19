// src/app/api/projects/[id]/win-probability/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
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
    const winProbability = body?.win_probability;

    if (typeof winProbability !== "number" || winProbability < 0 || winProbability > 100) {
      return NextResponse.json({ ok: false, error: "win_probability must be a number between 0 and 100." }, { status: 400 });
    }

    const activeOrgId = await getActiveOrgId();

    const { data: project } = await supabase
      .from("projects")
      .select("id, organisation_id, resource_status")
      .eq("id", projectId)
      .maybeSingle();

    if (!project) {
      return NextResponse.json({ ok: false, error: "Project not found" }, { status: 404 });
    }

    if (activeOrgId && project.organisation_id !== activeOrgId) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    // Only pipeline projects have a win probability
    if (safeStr(project.resource_status).toLowerCase() !== "pipeline") {
      return NextResponse.json({ ok: false, error: "Win probability only applies to pipeline projects." }, { status: 422 });
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
        return NextResponse.json({ ok: false, error: "You do not have permission to edit this project." }, { status: 403 });
      }
    }

    const { error: updateErr } = await supabase
      .from("projects")
      .update({ win_probability: winProbability, updated_at: new Date().toISOString() })
      .eq("id", projectId);

    if (updateErr) {
      return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, win_probability: winProbability });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Update failed" }, { status: 500 });
  }
}