// src/app/api/change/[id]/comments/route.ts
import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { sb, requireUser, requireProjectRole, safeStr } from "@/lib/change/server-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonOk(payload: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...payload }, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}
function jsonErr(message: string, status = 400, extra?: any) {
  const res = NextResponse.json({ ok: false, error: message, ...(extra ? { extra } : {}) }, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function isMissingRelation(errMsg: string) {
  const m = (errMsg || "").toLowerCase();
  return m.includes("does not exist") && m.includes("relation");
}

function canComment(role: string) {
  const r = String(role || "").toLowerCase();
  return r === "owner" || r === "editor";
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const changeId = safeStr(id).trim();
    if (!changeId) return jsonErr("Missing change id", 400);

    const supabase = await sb();
    const user = await requireUser(supabase);

    const { data: cr, error: crErr } = await supabase
      .from("change_requests")
      .select("id, project_id")
      .eq("id", changeId)
      .maybeSingle();

    if (crErr) return jsonErr("Failed to load change request", 500, crErr);
    if (!cr) return jsonErr("Not found", 404);

    const projectId = safeStr((cr as any)?.project_id).trim();
    if (!projectId) return jsonErr("Missing project_id", 500);

    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return jsonErr("Forbidden", 403);

    const { data, error } = await supabase
      .from("change_comments")
      .select("id, change_id, body, created_at, author_id, author_name, artifact_id")
      .eq("change_id", changeId)
      .order("created_at", { ascending: true });

    if (error) {
      if (isMissingRelation(safeStr(error.message))) {
        return jsonErr("Comments table is not available yet (change_comments missing).", 409, { table: "change_comments" });
      }
      return jsonErr("Failed to load comments", 500, error);
    }

    const items = (Array.isArray(data) ? data : []).map((c: any) => ({
      id: safeStr(c?.id),
      change_id: safeStr(c?.change_id),
      body: safeStr(c?.body),
      created_at: c?.created_at,
      author_id: safeStr(c?.author_id),
      author_name: safeStr(c?.author_name),
      artifact_id: safeStr(c?.artifact_id),
    }));

    return jsonOk({ items });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Failed to load comments";
    const status = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : msg === "Not found" ? 404 : 500;
    return jsonErr(msg, status);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const changeId = safeStr(id).trim();
    if (!changeId) return jsonErr("Missing change id", 400);

    const supabase = await sb();
    const user = await requireUser(supabase);

    const { data: cr, error: crErr } = await supabase
      .from("change_requests")
      .select("id, project_id, artifact_id")
      .eq("id", changeId)
      .maybeSingle();

    if (crErr) return jsonErr("Failed to load change request", 500, crErr);
    if (!cr) return jsonErr("Not found", 404);

    const projectId = safeStr((cr as any)?.project_id).trim();
    if (!projectId) return jsonErr("Missing project_id", 500);

    const artifactId = safeStr((cr as any)?.artifact_id).trim();

    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return jsonErr("Forbidden", 403);
    if (!canComment(role)) return jsonErr("Forbidden (editor/owner only)", 403);

    const bodyJson = await req.json().catch(() => ({}));
    const commentBody = safeStr(bodyJson?.body).trim();
    if (!commentBody) return jsonErr("Comment body is required", 400);

    const targetArtifactId = safeStr(bodyJson?.artifactId).trim() || artifactId || null;

    let authorName = "";
    try {
      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name, name, email")
        .eq("id", user.id)
        .maybeSingle();

      authorName =
        safeStr((prof as any)?.full_name) ||
        safeStr((prof as any)?.name) ||
        safeStr((prof as any)?.email) ||
        "";
    } catch {}
    if (!authorName) authorName = safeStr((user as any)?.email) || "User";

    const { data, error } = await supabase
      .from("change_comments")
      .insert({
        change_id: changeId,
        project_id: projectId,
        artifact_id: targetArtifactId,
        body: commentBody.slice(0, 8000),
        author_id: user.id,
        author_name: authorName.slice(0, 200),
      })
      .select("id, change_id, body, created_at, author_id, author_name, artifact_id")
      .maybeSingle();

    if (error) {
      if (isMissingRelation(safeStr(error.message))) {
        return jsonErr("Comments table is not available yet (change_comments missing).", 409, { table: "change_comments" });
      }
      return jsonErr("Failed to post comment", 500, error);
    }

    return jsonOk({ item: data, data });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Failed to post comment";
    const status = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : msg === "Not found" ? 404 : 500;
    return jsonErr(msg, status);
  }
}