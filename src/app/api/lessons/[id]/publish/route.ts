// src/app/api/lessons/[id]/publish/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

/* ---------------- helpers ---------------- */

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400, details?: any) {
  return NextResponse.json({ ok: false, error, details }, { status });
}
function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(x || "").trim()
  );
}
function normRole(x: any) {
  return String(x || "").trim().toLowerCase();
}

async function requireEditor(sb: any, project_id: string) {
  const { data: auth, error: aErr } = await sb.auth.getUser();
  // FIX: Removed 'as const'
  if (aErr) return { ok: false, error: aErr.message };

  const uid = auth?.user?.id;
  // FIX: Removed 'as const'
  if (!uid) return { ok: false, error: "Not authenticated" };

  const { data, error } = await sb
    .from("project_members")
    .select("role, removed_at")
    .eq("project_id", project_id)
    .eq("user_id", uid)
    .is("removed_at", null)
    .maybeSingle();

  // FIX: Removed 'as const'
  if (error) return { ok: false, error: error.message };

  const role = normRole(data?.role);
  if (!(role === "owner" || role === "editor")) return { ok: false, error: "Forbidden" };

  return { ok: true, uid };
}

/* ---------------- route ---------------- */

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await Promise.resolve(ctx.params);
  const id = safeStr(rawId).trim();

  if (!isUuid(id)) return jsonErr("Invalid id", 400);

  const sb = await createClient();

  // load row to get project_id (and ensure record exists)
  const { data: row, error: rowErr } = await sb
    .from("lessons_learned")
    .select("id, project_id, is_published, library_tags")
    .eq("id", id)
    .maybeSingle();

  if (rowErr) return jsonErr(rowErr.message, 400);
  if (!row) return jsonErr("Not found", 404);

  const gate = await requireEditor(sb, row.project_id);
  if (!gate.ok) return jsonErr(gate.error, gate.error === "Forbidden" ? 403 : 401);

  const body = await req.json().catch(() => ({}));
  const publish = Boolean(body?.publish);

  const tagsRaw = Array.isArray(body?.library_tags) ? body.library_tags : [];
  const tags = tagsRaw
    .map((t: any) => safeStr(t).trim())
    .filter(Boolean)
    .slice(0, 20);

  // only set published_at/by when publishing; clear when unpublishing
  const patch: any = {
    is_published: publish,
    published_at: publish ? new Date().toISOString() : null,
    published_by: publish ? gate.uid : null,
    library_tags: tags,
  };

  const { data, error } = await sb
    .from("lessons_learned")
    .update(patch)
    .eq("id", id)
    .select("id, is_published, published_at, library_tags")
    .single();

  if (error) return jsonErr(error.message, 400);

  return jsonOk({ item: data });
}