import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { sb, safeStr, jsonError, requireUser, requireProjectRole, canEdit } from "@/lib/change/server-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteCtx = { params: Promise<{ id: string; crId: string }> };

function isAllowedLegacyStatus(x: string) {
  const v = safeStr(x).trim().toLowerCase();
  return v === "new" || v === "analysis" || v === "review" || v === "in_progress" || v === "implemented" || v === "closed";
}

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  try {
    const supabase = await sb();
    const user = await requireUser(supabase);

    const { id, crId } = await ctx.params;
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
    if (!isAllowedLegacyStatus(status)) {
      return jsonError(
        "This endpoint only supports lifecycle statuses. Use submit/approve/reject/request-changes for governance decisions.",
        409
      );
    }

    // Block if currently submitted (locked)
    const meta = await supabase
      .from("change_requests")
      .select("id, decision_status")
      .eq("id", changeId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (meta.error) throw new Error(meta.error.message);
    if (!meta.data) return jsonError("Not found", 404);

    const decisionStatus = safeStr((meta.data as any)?.decision_status).trim().toLowerCase();
    if (decisionStatus === "submitted") {
      return jsonError("This change is locked awaiting decision. Use approve/reject/request-changes routes.", 409);
    }

    const { data, error } = await supabase
      .from("change_requests")
      .update({ status: safeStr(status).trim().toLowerCase(), updated_at: new Date().toISOString() })
      .eq("id", changeId)
      .eq("project_id", projectId)
      .select("id, status, updated_at")
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, item: data, data });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}