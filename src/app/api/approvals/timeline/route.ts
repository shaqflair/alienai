import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- helpers ---------------- */

function jsonOk(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
function jsonErr(error: string, status = 400, meta?: any) {
  const res = NextResponse.json({ ok: false, error, meta }, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s
  );
}

/**
 * GET /api/approvals/timeline?project_id=...&artifact_id=... OR &change_id=...
 */
export async function GET(req: Request) {
  try {
    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return jsonErr(authErr.message, 401);
    const user = auth?.user;
    if (!user) return jsonErr("Unauthorized", 401);

    const url = new URL(req.url);
    const project_id = safeStr(url.searchParams.get("project_id"));
    const artifact_id = safeStr(url.searchParams.get("artifact_id"));
    const change_id = safeStr(url.searchParams.get("change_id"));
    const limitRaw = safeStr(url.searchParams.get("limit"));
    const limit = Math.max(10, Math.min(500, Number(limitRaw || 250) || 250));

    if (!project_id || !isUuid(project_id)) {
      return jsonErr("Missing or invalid project_id", 400);
    }
    if (!artifact_id && !change_id) {
      return jsonErr("Provide artifact_id or change_id", 400);
    }
    if (artifact_id && !isUuid(artifact_id)) {
      return jsonErr("Invalid artifact_id", 400);
    }
    if (change_id && !isUuid(change_id)) {
      return jsonErr("Invalid change_id", 400);
    }

    const { data: member, error: memErr } = await supabase
      .from("project_members")
      .select("role")
      .eq("project_id", project_id)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .maybeSingle();

    if (memErr) return jsonErr(memErr.message, 500);
    if (!member?.role) return jsonErr("Forbidden", 403);

    let q = supabase
      .from("approval_events")
      .select(
        "id, created_at, action_type, actor_user_id, actor_name, actor_role, comment, meta, step_id, artifact_id, change_id"
      )
      .eq("project_id", project_id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (artifact_id) q = q.eq("artifact_id", artifact_id);
    if (change_id) q = q.eq("change_id", change_id);

    const { data: events, error: evErr } = await q;
    if (evErr) return jsonErr(evErr.message, 500);

    const rows = (events ?? [])
      .map((e: any) => ({
        id: e.id,
        created_at: e.created_at,
        action_type: safeStr(e.action_type),
        actor_user_id: e.actor_user_id ?? null,
        actor_name: safeStr(e.actor_name) || null,
        actor_role: safeStr(e.actor_role) || null,
        comment: safeStr(e.comment) || null,
        meta: e.meta ?? null,
        step_id: e.step_id ?? null,
        artifact_id: e.artifact_id ?? null,
        change_id: e.change_id ?? null,
      }))
      .reverse();

    return jsonOk({ events: rows });
  } catch (e: any) {
    return jsonErr("Unexpected error", 500, { message: e?.message || String(e) });
  }
}
