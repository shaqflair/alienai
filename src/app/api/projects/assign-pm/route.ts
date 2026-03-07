import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonOk(d: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...d }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}
function jsonErr(e: string, s = 400) {
  const res = NextResponse.json({ ok: false, error: e }, { status: s });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}
function ss(x: any): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return jsonErr("Unauthorized", 401);

    const orgId = await getActiveOrgId().catch(() => null);
    if (!orgId) return jsonErr("No active organisation", 400);

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return jsonErr("Invalid JSON", 400);
    }

    const projectId = ss(body.project_id).trim();
    if (!projectId) return jsonErr("project_id is required", 400);

    const { data: proj } = await supabase
      .from("projects")
      .select("id, organisation_id")
      .eq("id", projectId)
      .eq("organisation_id", orgId)
      .maybeSingle();
    if (!proj?.id) return jsonErr("Project not found", 404);

    const { data: mem } = await supabase
      .from("organisation_members")
      .select("role")
      .eq("organisation_id", orgId)
      .eq("user_id", auth.user.id)
      .is("removed_at", null)
      .maybeSingle();
    const role = ss(mem?.role).toLowerCase();
    if (!["admin", "owner", "manager", "editor"].includes(role)) {
      return jsonErr("Insufficient permissions", 403);
    }

    const rawPmUserId = body.pm_user_id;
    const pmUserId =
      rawPmUserId == null || ss(rawPmUserId).trim() === ""
        ? null
        : ss(rawPmUserId).trim();

    if (pmUserId) {
      const { data: targetMember } = await supabase
        .from("organisation_members")
        .select("user_id")
        .eq("organisation_id", orgId)
        .eq("user_id", pmUserId)
        .is("removed_at", null)
        .maybeSingle();
      if (!targetMember?.user_id) {
        return jsonErr("Selected PM is not an active organisation member", 400);
      }
    }

    // Only update columns that actually exist on the projects table
    const { error } = await supabase
      .from("projects")
      .update({
        pm_user_id: pmUserId,
        project_manager_id: pmUserId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId)
      .eq("organisation_id", orgId);

    if (error) return jsonErr(error.message, 400);

    return jsonOk({ project_id: projectId, pm_user_id: pmUserId });
  } catch (e: any) {
    console.error("[POST /api/projects/assign-pm]", e);
    return jsonErr(ss(e?.message) || "Server error", 500);
  }
}