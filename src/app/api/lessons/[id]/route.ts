// src/app/api/lessons/[id]/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
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

/** Extract id from Next params OR from URL path as a fallback */
function extractId(req: Request, paramsMaybe: any) {
  const fromParams = safeStr(paramsMaybe?.id).trim();
  if (fromParams) return fromParams;

  // fallback: last path segment
  try {
    const u = new URL(req.url);
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "";
    return safeStr(last).trim();
  } catch {
    return "";
  }
}

/** minimal enterprise role gate: owner/editor only */
async function requireEditor(sb: any, project_id: string) {
  const { data: auth } = await sb.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return { ok: false, error: "Not authenticated" as const };

  const { data, error } = await sb
    .from("project_members")
    .select("role, removed_at")
    .eq("project_id", project_id)
    .eq("user_id", uid)
    .is("removed_at", null)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  const role = normRole(data?.role);
  const allowed = role === "owner" || role === "editor";
  if (!allowed) return { ok: false, error: "Forbidden" as const };
  return { ok: true, uid };
}

/**
 * Next.js 16 typed route handlers expect:
 * - request: NextRequest
 * - context.params: Promise<{ id: string }>
 */
type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const { id: paramId } = await ctx.params;
  const id = extractId(req, { id: paramId });

  if (!isUuid(id)) {
    return jsonErr("Invalid id", 400, {
      received: id,
      url: req.url,
      hint: "Ensure route file is src/app/api/lessons/[id]/route.ts and request is /api/lessons/<UUID>",
    });
  }

  const sb = await createClient();

  // 1) load row to get project_id + protect cross-project updates
  const { data: row, error: rowErr } = await sb
    .from("lessons_learned")
    .select("id, project_id, ai_generated")
    .eq("id", id)
    .maybeSingle();

  if (rowErr) return jsonErr(rowErr.message, 400);
  if (!row) return jsonErr("Not found", 404);

  // 2) role check (owner/editor)
  const gate = await requireEditor(sb, row.project_id);
  if (!gate.ok) return jsonErr(gate.error, gate.error === "Forbidden" ? 403 : 401);

  const body = await req.json().catch(() => ({}));
  const patch: any = {};

  // 3) allow patching user-owned fields
  // FIX: Removed 'as const' from the array, added explicit type annotation (line 58)
  const allowedFields: string[] = [
    "category",
    "description",
    "action_for_future",
    "status",
    "impact",
    "severity",
    "project_stage",
    "action_owner_label",
  ];
  
  for (const k of allowedFields) {
    if (!(k in body)) continue;

    const v = safeStr((body as any)[k]);

    if (k === "category" || k === "description") {
      if (!v.trim()) return jsonErr(`${k} cannot be empty`, 400);
      patch[k] = v.trim();
      continue;
    }

    patch[k] = v.trim() ? v.trim() : null;
  }

  // 4) AI fields: only allow if explicitly flagged "allow_ai_fields": true
  const allowAiFields = Boolean(body?.allow_ai_fields);
  if (allowAiFields) {
    if ("ai_summary" in body) patch.ai_summary = safeStr(body.ai_summary).trim() || null;
    if ("ai_generated" in body) patch.ai_generated = Boolean(body.ai_generated);
  }

  if (Object.keys(patch).length === 0) return jsonErr("No changes", 400);

  const { data, error } = await sb
    .from("lessons_learned")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) return jsonErr(error.message, 400);
  return jsonOk({ item: data });
}

export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  const { id: paramId } = await ctx.params;
  const id = extractId(req, { id: paramId });

  if (!isUuid(id)) {
    return jsonErr("Invalid id", 400, {
      received: id,
      url: req.url,
      hint: "Ensure route file is src/app/api/lessons/[id]/route.ts and request is /api/lessons/<UUID>",
    });
  }

  const sb = await createClient();

  // load row to get project_id
  const { data: row, error: rowErr } = await sb
    .from("lessons_learned")
    .select("id, project_id")
    .eq("id", id)
    .maybeSingle();

  if (rowErr) return jsonErr(rowErr.message, 400);
  if (!row) return jsonErr("Not found", 404);

  const gate = await requireEditor(sb, row.project_id);
  if (!gate.ok) return jsonErr(gate.error, gate.error === "Forbidden" ? 403 : 401);

  const { error } = await sb.from("lessons_learned").delete().eq("id", id);
  if (error) return jsonErr(error.message, 400);

  return jsonOk({ deleted: true });
}