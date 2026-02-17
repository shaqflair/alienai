import "server-only";
import { NextRequest, NextResponse } from "next/server";
import {
  sb,
  safeStr,
  jsonError,
  requireUser,
  requireProjectRole,
  canEdit,
  isOwner,
} from "@/lib/change/server-helpers";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string; crId: string }> };

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  try {
    const supabase = await sb();
    const user = await requireUser(supabase);

    const { id, crId } = await ctx.params;

    // folder is [id] so param key is id; map to existing name
    const projectId = safeStr(id).trim();
    const changeId = safeStr(crId).trim();

    if (!projectId) return jsonError("Missing projectId", 400);
    if (!changeId) return jsonError("Missing crId", 400);

    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return jsonError("Forbidden", 403);
    if (!canEdit(role)) return jsonError("Requires editor/owner", 403);

    const body = await req.json().catch(() => ({}));
    const status = safeStr(body?.status).trim();
    if (!status) return jsonError("Missing status", 400);

    // Only owners can set approved/rejected
    if (!isOwner(role) && (status === "approved" || status === "rejected")) {
      return jsonError("Only owners can approve/reject", 403);
    }

    const { data, error } = await supabase
      .from("change_requests")
      .update({ status })
      .eq("id", changeId)
      .eq("project_id", projectId)
      .select("id, status, updated_at")
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
