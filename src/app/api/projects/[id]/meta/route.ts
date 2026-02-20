// src/app/api/projects/[id]/meta/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (x || "").trim()
  );
}

type ParamsLike = { id?: string } | Promise<{ id?: string }>;

/**
 * Accepts either:
 * - UUID project id (projects.id)
 * - Project code (projects.project_code) e.g. "100011"
 */
async function getIdParam(params: ParamsLike) {
  const resolved = typeof (params as any)?.then === "function" ? await (params as any) : (params as any);
  return safeStr(resolved?.id).trim();
}

export async function GET(_req: Request, ctx: { params: ParamsLike }) {
  try {
    const supabase = await createClient();
    const ref = await getIdParam(ctx.params);

    if (!ref) {
      return NextResponse.json({ ok: false, error: "Missing project id" }, { status: 400 });
    }

    // ✅ Resolve by UUID id OR by project_code
    const q = supabase
      .from("projects")
      .select("id, title, client_name, project_code, deleted_at, lifecycle_status, status")
      .is("deleted_at", null);

    const { data, error } = isUuid(ref)
      ? await q.eq("id", ref).maybeSingle()
      : await q.eq("project_code", ref).maybeSingle();

    if (error) throw error;
    if (!data?.id) {
      return NextResponse.json({ ok: false, error: "Project not found" }, { status: 404 });
    }

    // Keep compatibility with your UI (meta.human_id), but it's really project_code in your schema
    const human_id =
      data?.project_code != null && String(data.project_code).trim() !== ""
        ? String(data.project_code)
        : String(data?.id || "").slice(0, 6);

    return NextResponse.json({
      ok: true,
      project: {
        id: data.id,
        title: data.title,
        client_name: data.client_name,
        project_code: data.project_code,
        human_id, // backward-compatible alias
        lifecycle_status: data.lifecycle_status,
        status: data.status,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}