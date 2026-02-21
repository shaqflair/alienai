import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}
function expectedUpdatedAtFrom(req: NextRequest, body: any) {
  const hdr = safeStr(req.headers.get("if-match-updated-at")).trim();
  const b = safeStr(body?.expected_updated_at).trim();
  return hdr || b || "";
}

async function requireProjectMember(supabase: any, projectId: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) return { ok: false as const, status: 401, error: "Unauthorized" };

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role,is_active")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (memErr) return { ok: false as const, status: 400, error: memErr.message };
  if (!mem?.is_active) return { ok: false as const, status: 403, error: "Forbidden" };

  return { ok: true as const, userId: auth.user.id, role: safeStr(mem.role) };
}
function canWrite(role: string) {
  const r = safeStr(role).toLowerCase();
  return r === "owner" || r === "editor";
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await req.json().catch(() => null);
    if (!body) return jsonErr("Invalid JSON", 400);

    const raidId = safeStr(body.id).trim();
    if (!looksLikeUuid(raidId)) return jsonErr("Invalid or missing id", 400);

    const expected = expectedUpdatedAtFrom(req, body);

    const { data: current, error: curErr } = await supabase
      .from("raid_items")
      .select("id,project_id,updated_at")
      .eq("id", raidId)
      .maybeSingle();

    if (curErr) return jsonErr(curErr.message, 400);
    if (!current) return NextResponse.json({ ok: true }, { status: 204 });

    const access = await requireProjectMember(supabase, safeStr((current as any).project_id));
    if (!access.ok) return jsonErr(access.error, access.status);
    if (!canWrite(access.role)) return jsonErr("Forbidden", 403);

    const currentUpdatedAt = safeStr((current as any).updated_at).trim();
    if (expected && currentUpdatedAt && expected !== currentUpdatedAt) {
      return jsonErr("Conflict", 409, {
        stale: true,
        expected_updated_at: expected,
        current_updated_at: currentUpdatedAt,
      });
    }

    const { error: delErr } = await supabase.from("raid_items").delete().eq("id", raidId);
    if (delErr) return jsonErr(delErr.message, 400);

    return NextResponse.json({ ok: true }, { status: 204 });
  } catch (e: any) {
    return jsonErr("Failed to delete RAID item", 500, { message: safeStr(e?.message) });
  }
}
