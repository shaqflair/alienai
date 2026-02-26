//src/app/api/approvals/audit/route.ts
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

function clampInt(v: any, min: number, max: number, def: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function decodeCursor(cursor: string | null): null | { t: string; id: string } {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const obj = JSON.parse(raw);
    if (!obj || typeof obj.t !== "string" || typeof obj.id !== "string") return null;
    return { t: obj.t, id: obj.id };
  } catch {
    return null;
  }
}

function encodeCursor(t: string, id: string) {
  return Buffer.from(JSON.stringify({ t, id }), "utf8").toString("base64url");
}

/* ---------------- route ---------------- */

export async function GET(req: Request) {
  try {
    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return jsonErr(authErr.message, 401);
    if (!auth?.user) return jsonErr("Unauthorized", 401);

    const url = new URL(req.url);
    const project_id = safeStr(url.searchParams.get("project_id")).trim();
    const artifact_id = safeStr(url.searchParams.get("artifact_id")).trim();
    const step_id = safeStr(url.searchParams.get("step_id")).trim();
    const action = safeStr(url.searchParams.get("action")).trim().toLowerCase();
    const limit = clampInt(url.searchParams.get("limit"), 1, 200, 50);
    const cursor = decodeCursor(url.searchParams.get("cursor"));

    if (!project_id) return jsonErr("Missing project_id", 400);

    const { data: memberOk, error: memberErr } = await supabase.rpc(
      "is_project_member",
      { p_project_id: project_id }
    );
    if (memberErr) return jsonErr(memberErr.message, 400);
    if (!memberOk) return jsonErr("Forbidden", 403);

    let q = supabase
      .from("approval_audit_log_v")
      .select(
        [
          "id",
          "created_at",
          "project_id",
          "artifact_id",
          "artifact_title",
          "artifact_kind",
          "step_id",
          "step_name",
          "step_order",
          "chain_id",
          "actor_user_id",
          "actor_email",
          "action",
          "decision",
          "comment",
          "payload",
        ].join(",")
      )
      .eq("project_id", project_id);

    if (artifact_id) q = q.eq("artifact_id", artifact_id);
    if (step_id) q = q.eq("step_id", step_id);
    if (action) q = q.eq("action", action);

    q = q.order("created_at", { ascending: false }).order("id", { ascending: false });

    if (cursor) {
      q = q.or(
        `created_at.lt.${cursor.t},and(created_at.eq.${cursor.t},id.lt.${cursor.id})`
      );
    }

    q = q.limit(limit);

    const { data, error } = await q;
    if (error) return jsonErr(error.message, 400);

    const rows = Array.isArray(data) ? data : [];
    const nextCursor =
      rows.length === limit
        ? encodeCursor(rows[rows.length - 1].created_at, rows[rows.length - 1].id)
        : null;

    return jsonOk({ rows, nextCursor }, 200);
  } catch (e: any) {
    return jsonErr(e?.message || "Server error", 500);
  }
}
