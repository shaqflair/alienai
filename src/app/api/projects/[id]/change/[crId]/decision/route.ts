import "server-only";
import { NextRequest, NextResponse } from "next/server";
import {
  sb,
  safeStr,
  jsonError,
  requireUser,
  requireProjectRole,
  isOwner,
} from "@/lib/change/server-helpers";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string; crId: string }> };

export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const supabase = await sb();
    const user = await requireUser(supabase);

    const { id, crId } = await ctx.params;

    // folder is [id] so param key is id; map to your existing naming
    const projectId = safeStr(id).trim();
    const changeId = safeStr(crId).trim();

    if (!projectId) return jsonError("Missing projectId", 400);
    if (!changeId) return jsonError("Missing crId", 400);

    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return jsonError("Forbidden", 403);
    if (!isOwner(role)) return jsonError("Only owners can approve/reject", 403);

    const body = await req.json().catch(() => ({}));
    const decision = safeStr(body?.decision).trim().toLowerCase(); // "approved" | "rejected"
    if (decision !== "approved" && decision !== "rejected") {
      return jsonError("decision must be approved|rejected", 400);
    }

    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("change_requests")
      .update({
        status: decision,
        approver_id: user.id,
        approval_date: now,
      })
      .eq("id", changeId)
      .eq("project_id", projectId)
      .select("id, status, approver_id, approval_date, updated_at")
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
