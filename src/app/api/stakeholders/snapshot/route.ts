// src/app/api/stakeholders/snapshot/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

async function requireAuthAndMembership(supabase: any, projectId: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);
  if (!mem) throw new Error("Not found");

  const role = String((mem as any).role ?? "viewer").toLowerCase();
  const canEdit = role === "owner" || role === "editor";

  return { userId: auth.user.id, role, canEdit };
}

function toRowObj5(r: any) {
  const cells = Array.isArray(r) ? r : [];
  const out = cells.map((x: any) => String(x ?? ""));
  while (out.length < 5) out.push("");
  return { type: "data", cells: out.slice(0, 5) };
}

/**
 * POST /api/stakeholders/snapshot
 * Body:
 * {
 *   projectId: string,
 *   artifactId: string,
 *   rows: Array<[name,poc,role,internal_external,title_role]>
 * }
 *
 * Writes artifacts.content_json as v2 sections -> main_table (columns=5).
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const body = await req.json().catch(() => null);

    const projectId = String(body?.projectId ?? "").trim();
    const artifactId = String(body?.artifactId ?? "").trim();
    const rows = Array.isArray(body?.rows) ? body.rows : null;

    if (!projectId || !artifactId || !rows) {
      return NextResponse.json({ ok: false, error: "Missing projectId, artifactId, or rows[]" }, { status: 400 });
    }

    const { canEdit } = await requireAuthAndMembership(supabase, projectId);
    if (!canEdit) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    // Ensure artifact exists + belongs to project
    const { data: art, error: artErr } = await supabase
      .from("artifacts")
      .select("id, type, project_id")
      .eq("id", artifactId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (artErr) return NextResponse.json({ ok: false, error: artErr.message }, { status: 500 });
    if (!art) return NextResponse.json({ ok: false, error: "Artifact not found" }, { status: 404 });

    const v2 = {
      version: 2,
      type: "stakeholder_register",
      sections: [
        {
          key: "main_table",
          title: "Main Table",
          table: {
            columns: 5,
            rows: rows.map(toRowObj5),
          },
        },
      ],
    };

    const { error: updErr } = await supabase
      .from("artifacts")
      .update({ content_json: v2, updated_at: new Date().toISOString() })
      .eq("id", artifactId)
      .eq("project_id", projectId);

    if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const status =
      msg === "Unauthorized" ? 401 :
      msg === "Not found" ? 404 :
      msg === "Forbidden" ? 403 :
      500;

    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
