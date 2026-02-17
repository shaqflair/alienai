import "server-only";

        param($m)
        $inner = $m.Groups[1].Value
        if ($inner -match '\bNextRequest\b') { return $m.Value }
        if ($inner -match '\bNextResponse\b') {
          # insert NextRequest right after opening brace
          return ('import { NextRequest, ' + $inner.Trim() + ' } from "next/server";') -replace '\s+,', ','
        }
        return $m.Value
      
import { sb, safeStr, jsonError, requireUser, requireProjectRole, canEdit, normalizeImpactAnalysis } from "@/lib/change/server-helpers";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, ctx: { params: { projectId: string; crId: string } }) {
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
      .eq("id", crId)
      .eq("project_id", projectId)
      .select("id, project_id, title, description, proposed_change, impact_analysis, status, priority, tags, updated_at")
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

