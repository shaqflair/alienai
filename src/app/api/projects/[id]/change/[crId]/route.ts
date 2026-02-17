import "server-only";
import { NextRequest, NextResponse } from "next/server";
import {
  sb,
  safeStr,
  jsonError,
  requireUser,
  requireProjectRole,
  canEdit,
  normalizeImpactAnalysis,
} from "@/lib/change/server-helpers";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string; crId: string }> };

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  try {
    const supabase = await sb();
    const user = await requireUser(supabase);

    const { id, crId } = await ctx.params;

    // folder is [id] so param key is id; map to existing naming
    const projectId = safeStr(id).trim();
    const changeId = safeStr(crId).trim();

    if (!projectId) return jsonError("Missing projectId", 400);
    if (!changeId) return jsonError("Missing crId", 400);

    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return jsonError("Forbidden", 403);
    if (!canEdit(role)) return jsonError("Requires editor/owner", 403);

    const body = await req.json().catch(() => ({}));

    const patch: any = {};
    if ("title" in body) patch.title = safeStr(body.title).trim() || "Untitled change";
    if ("description" in body) patch.description = safeStr(body.description).trim();
    if ("summary" in body) patch.description = safeStr(body.summary).trim();
    if ("proposed_change" in body) patch.proposed_change = safeStr(body.proposed_change).trim();
    if ("priority" in body) patch.priority = safeStr(body.priority).trim() || "Medium";
    if ("tags" in body) patch.tags = Array.isArray(body.tags) ? body.tags.map(String) : [];
    if ("impact_analysis" in body) patch.impact_analysis = normalizeImpactAnalysis(body.impact_analysis);
    if ("aiImpact" in body) patch.impact_analysis = normalizeImpactAnalysis(body.aiImpact);

    const { data, error } = await supabase
      .from("change_requests")
      .update(patch)
      .eq("id", changeId)
      .eq("project_id", projectId)
      .select(
        "id, project_id, title, description, proposed_change, impact_analysis, status, priority, tags, updated_at"
      )
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
