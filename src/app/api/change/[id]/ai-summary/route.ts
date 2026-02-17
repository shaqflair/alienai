// src/app/api/change/[id]/ai-summary/route.ts
import "server-only";


        param($m)
        $inner = $m.Groups[1].Value
        if ($inner -match '\bNextRequest\b') { return $m.Value }
        if ($inner -match '\bNextResponse\b') {
          # insert NextRequest right after opening brace
          return ('import { NextRequest, ' + $inner.Trim() + ' } from "next/server";') -replace '\s+,', ','
        }
        return $m.Value
      
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}

async function requireAuthAndMembership(supabase: any, projectId: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role, is_active, removed_at")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);
  if (!mem) throw new Error("Not found");
  if (mem.is_active === false) throw new Error("Forbidden");
  if (mem.removed_at != null) throw new Error("Forbidden");

  return auth.user;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const changeId = safeStr(id).trim();
    if (!changeId) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

    const supabase = await createClient();

    // 1) verify change exists + get project_id
    const { data: ch, error: chErr } = await supabase
      .from("change_requests")
      .select("id, project_id")
      .eq("id", changeId)
      .maybeSingle();

    if (chErr) throw new Error(chErr.message);
    if (!ch) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    const projectId = String((ch as any).project_id);
    await requireAuthAndMembership(supabase, projectId);

    // 2) read summary from change_ai_summaries (source of truth)
    const { data: row, error } = await supabase
      .from("change_ai_summaries")
      .select("id, project_id, change_id, summary, alternatives, rationale, model, updated_at, created_at")
      .eq("change_id", changeId)
      .maybeSingle();

    if (error) throw new Error(error.message);

    if (!row) return NextResponse.json({ ok: true, item: null });

    return NextResponse.json({
      ok: true,
      item: {
        id: row.id,
        project_id: row.project_id,
        change_id: row.change_id,
        summary: row.summary ?? null,
        alternatives: row.alternatives ?? [],
        rationale: safeStr(row.rationale) || "",
        model: safeStr(row.model) || "",
        updated_at: row.updated_at ?? row.created_at,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Error" }, { status: 500 });
  }
}

