// src/app/api/projects/[id]/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { sb, requireUser, requireProjectRole, safeStr } from "@/lib/change/server-helpers";

export const runtime = "nodejs";

/* ---------------- utils ---------------- */

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

/**
 * Normalize incoming project identifier:
 * - decodeURIComponent
 * - trim
 * - allow "P-100011" -> "100011"
 */
function normalizeProjectIdentifier(input: string) {
  let v = safeStr(input).trim();
  try {
    // If already decoded this is harmless; if encoded it helps.
    v = decodeURIComponent(v);
  } catch {
    // ignore
  }

  v = v.trim();

  // Accept "P-100011" style
  if (/^p-\s*/i.test(v)) v = v.replace(/^p-\s*/i, "").trim();

  return v;
}

/**
 * Resolve a project identifier to UUID.
 * - If UUID -> return as-is
 * - Else treat as human id: projects.project_code
 */
async function resolveProjectUuid(supabase: any, identifier: string): Promise<string | null> {
  const id = normalizeProjectIdentifier(identifier);
  if (!id) return null;

  if (looksLikeUuid(id)) return id;

  // project_code input
  // IMPORTANT: project_code is stored as text in your model; compare as text.
  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("project_code", id)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const uuid = safeStr(data?.id).trim();
  return uuid || null;
}

/* ---------------- handler ---------------- */

/**
 * GET /api/projects/:id
 * Accepts:
 *  - UUID (projects.id)
 *  - project_code (human id like "100011")
 *  - "P-100011" (human display id)
 *
 * Returns project meta for header display.
 * Requires: user is authenticated + member of project.
 */
export async function GET(_req: Request, ctx: { params: any }) {
  try {
    // Next.js can pass params as object or Promise in some setups — support both.
    const rawParams = ctx?.params && typeof ctx.params?.then === "function" ? await ctx.params : ctx.params;

    const rawId = safeStr(rawParams?.id).trim();
    if (!rawId || rawId === "undefined") return jsonErr("Missing id", 400);

    const supabase = await sb();
    const user = await requireUser(supabase);

    // ✅ Resolve UUID from either uuid OR project_code
    const projectUuid = await resolveProjectUuid(supabase, rawId);
    if (!projectUuid) return jsonErr("Not found", 404, { input: rawId });

    // ✅ membership/role gate must be checked on UUID
    const role = await (requireProjectRole as any)(supabase, projectUuid, user.id).catch(async () => {
      // fallback signature support (older helper)
      return await (requireProjectRole as any)(supabase, projectUuid);
    });

    if (!role) return jsonErr("Forbidden", 403);

    const { data, error } = await supabase
      .from("projects")
      .select("id,title,project_code,client_name,client_logo_url,brand_primary_color")
      .eq("id", projectUuid)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data?.id) return jsonErr("Not found", 404);

    return jsonOk({
      project: data,
      role,

      // helpful echoes for clients that pass either id format
      project_id: safeStr(data?.id).trim() || projectUuid, // UUID
      project_code: safeStr(data?.project_code).trim() || null, // human id
      project_name: safeStr(data?.title).trim() || null,
    });
  } catch (e: any) {
    console.error("[GET /api/projects/:id]", e);
    return jsonErr(safeStr(e?.message) || "Failed to load project", 500);
  }
}
