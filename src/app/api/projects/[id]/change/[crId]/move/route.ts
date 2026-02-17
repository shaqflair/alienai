import "server-only";
import { NextResponse } from "next/server";
import { sb, safeStr, jsonError, requireUser, requireProjectRole, canEdit, isOwner } from "@/lib/change/server-helpers";

export const runtime = "nodejs";

export async function PATCH(req: Request, ctx: { params: { projectId: string; crId: string } }) {
  try {
    const supabase = await sb();
    const user = await requireUser(supabase);

    const projectId = safeStr(ctx?.params?.projectId).trim();
    const crId = safeStr(ctx?.params?.crId).trim();
    if (!projectId) return jsonError("Missing projectId", 400);
    if (!crId) return jsonError("Missing crId", 400);

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
      .eq("id", crId)
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
