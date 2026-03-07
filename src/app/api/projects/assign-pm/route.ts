import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonOk(d: any)            { return NextResponse.json({ ok: true, ...d }); }
function jsonErr(e: string, s=400) { return NextResponse.json({ ok: false, error: e }, { status: s }); }
function ss(x: any): string        { return typeof x === "string" ? x : x == null ? "" : String(x); }

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return jsonErr("Unauthorized", 401);

    const orgId = await getActiveOrgId().catch(() => null);
    if (!orgId) return jsonErr("No active organisation", 400);

    let body: any = {};
    try { body = await req.json(); } catch { return jsonErr("Invalid JSON", 400); }

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
    if (!["admin", "owner", "manager"].includes(role)) return jsonErr("Insufficient permissions", 403);

    const pmUserId = body.pm_user_id ?? null;
    const pmName   = ss(body.pm_name).trim() || null;

    const { error } = await supabase
      .from("projects")
      .update({
        pm_user_id:          pmUserId,
        project_manager_id:  pmUserId,
      })
      .eq("id", projectId);

    if (error) return jsonErr(error.message, 400);

    return jsonOk({ pm_user_id: pmUserId, pm_name: pmName });
  } catch (e: any) {
    console.error("[POST /api/projects/assign-pm]", e);
    return jsonErr(ss(e?.message) || "Server error", 500);
  }
}