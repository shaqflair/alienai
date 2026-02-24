// src/app/api/approval-events/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { sb, requireUser, requireProjectRole, safeStr } from "@/lib/change/server-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- response helpers ---------------- */

function jsonOk(payload: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...payload }, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function jsonErr(error: string, status = 400, meta?: any) {
  const res = NextResponse.json({ ok: false, error, meta }, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function clampInt(v: any, min: number, max: number, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

/**
 * GET /api/approval-events?projectId=...&artifactId=...&changeId=...&limit=250
 */
export async function GET(req: Request) {
  try {
    const supabase = await sb();
    const user = await requireUser(supabase);

    const url = new URL(req.url);
    const projectId = safeStr(url.searchParams.get("projectId")).trim();
    const artifactId = safeStr(url.searchParams.get("artifactId")).trim();
    const changeId = safeStr(url.searchParams.get("changeId")).trim();
    const limit = clampInt(url.searchParams.get("limit"), 10, 500, 250);

    if (!projectId) return jsonErr("Missing projectId", 400);

    // membership gate
    const role = await (requireProjectRole as any)(supabase, projectId, user.id).catch(async () => {
      try {
        return await (requireProjectRole as any)(supabase, projectId);
      } catch {
        return null;
      }
    });
    if (!role) return jsonErr("Forbidden", 403);

    let q = supabase
      .from("approval_events")
      .select(
        "id, project_id, artifact_id, change_id, step_id, action_type, actor_user_id, actor_name, actor_role, comment, meta, created_at"
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (artifactId) q = q.eq("artifact_id", artifactId);
    if (changeId) q = q.eq("change_id", changeId);

    const { data, error } = await q;
    if (error) throw error;

    return jsonOk({ items: Array.isArray(data) ? data : [], role, userId: user.id });
  } catch (e: any) {
    console.error("[GET /api/approval-events]", e);
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500;
    return jsonErr(msg, status);
  }
}