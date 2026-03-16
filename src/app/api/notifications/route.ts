// src/app/api/notifications/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonNoStore(payload: any, init?: ResponseInit) {
  const res = NextResponse.json(payload, init);
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return res;
}

function safeInt(v: any, fallback: number, min: number, max: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback;
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return jsonNoStore({ ok: false, error: "Unauthorised" }, { status: 401 });
    }

    const url = new URL(req.url);
    const limit  = safeInt(url.searchParams.get("limit"), 30, 1, 100);
    const unread = url.searchParams.get("unread") === "true";

    let q = supabase
      .from("notifications")
      .select("id, user_id, project_id, artifact_id, type, title, body, link, is_read, created_at, actor_user_id, metadata, source_type, source_id, due_date, bucket, organisation_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (unread) q = q.eq("is_read", false);

    const { data: items, error: qErr } = await q;
    if (qErr) return jsonNoStore({ ok: false, error: qErr.message }, { status: 500 });

    const rows = items ?? [];
    const unreadCount = rows.filter(n => !n.is_read).length;

    return jsonNoStore({ ok: true, unreadCount, items: rows });
  } catch (e: any) {
    return jsonNoStore({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}