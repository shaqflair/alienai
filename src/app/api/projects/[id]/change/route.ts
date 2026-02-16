import "server-only";
import { NextResponse } from "next/server";
import { sb, safeStr, jsonError, requireUser, requireProjectRole, canEdit, normalizeImpactAnalysis } from "@/lib/change/server-helpers";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: { projectId: string } }) {
  try {
    const supabase = await sb();
    const user = await requireUser(supabase);

    const projectId = safeStr(ctx?.params?.projectId).trim();
    if (!projectId) return jsonError("Missing projectId", 400);

    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return jsonError("Forbidden", 403);

    const { data, error } = await supabase
      .from("change_requests")
      .select("id, project_id, requester_id, title, description, proposed_change, impact_analysis, status, priority, tags, approver_id, approval_date, created_at, updated_at")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false })
      .limit(500);

    if (error) throw new Error(error.message);

    // Optional: hydrate requester + approver names (profiles)
    const ids = Array.from(
      new Set(
        (data ?? [])
          .flatMap((r: any) => [String(r.requester_id ?? ""), String(r.approver_id ?? "")])
          .filter(Boolean)
      )
    );

    const { data: profiles } = ids.length
      ? await supabase.from("profiles").select("user_id, full_name, email").in("user_id", ids)
      : ({ data: [] as any[] } as any);

    const byId = new Map<string, any>();
    for (const p of profiles ?? []) byId.set(String(p.user_id), p);

    const rows = (data ?? []).map((r: any) => {
      const reqP = byId.get(String(r.requester_id ?? ""));
      const apprP = byId.get(String(r.approver_id ?? ""));

      return {
        id: String(r.id),
        project_id: String(r.project_id),
        title: String(r.title ?? "").trim() || "Untitled change",
        summary: String(r.description ?? ""),
        proposed_change: String(r.proposed_change ?? ""),
        requester: {
          id: String(r.requester_id ?? ""),
          name: String(reqP?.full_name ?? reqP?.email ?? "").trim(),
        },
        approver: r.approver_id
          ? { id: String(r.approver_id), name: String(apprP?.full_name ?? apprP?.email ?? "").trim() }
          : null,
        approval_date: r.approval_date ? String(r.approval_date) : null,
        status: String(r.status ?? "new"),
        priority: String(r.priority ?? "Medium"),
        tags: Array.isArray(r.tags) ? r.tags : [],
        impact_analysis: normalizeImpactAnalysis(r.impact_analysis),
        created_at: String(r.created_at),
        updated_at: String(r.updated_at),
      };
    });

    return NextResponse.json({ ok: true, data: rows });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

export async function POST(req: Request, ctx: { params: { id: string } }) {
  try {
    const supabase = await sb();
    const user = await requireUser(supabase);

    const projectId = safeStr(ctx?.params?.projectId).trim();
    if (!projectId) return jsonError("Missing projectId", 400);

    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return jsonError("Forbidden", 403);
    if (!canEdit(role)) return jsonError("Requires editor/owner", 403);

    const body = await req.json().catch(() => ({}));

    const title = safeStr(body?.title).trim();
    const description = safeStr(body?.description ?? body?.summary).trim();
    const proposed_change = safeStr(body?.proposed_change).trim();
    const status = safeStr(body?.status).trim() || "new";
    const priority = safeStr(body?.priority).trim() || "Medium";
    const tags = Array.isArray(body?.tags) ? body.tags.map(String) : [];

    const impact_analysis = normalizeImpactAnalysis(body?.impact_analysis ?? body?.aiImpact);

    const { data, error } = await supabase
      .from("change_requests")
      .insert({
        project_id: projectId,
        requester_id: user.id,
        title: title || "Untitled change",
        description,
        proposed_change,
        impact_analysis,
        status,
        priority,
        tags,
      })
      .select("id, project_id, requester_id, title, description, proposed_change, impact_analysis, status, priority, tags, created_at, updated_at")
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
