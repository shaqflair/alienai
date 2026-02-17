// src/app/api/approval-committee/save/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}

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
}

export async function POST(req: Request) {
  try {
    const supabase = createClient();
    const body = await req.json().catch(() => ({}));

    const projectId = safeStr(body?.projectId).trim();
    const row = body?.row ?? null;

    if (!projectId || !row) return NextResponse.json({ ok: false, error: "Missing projectId/row" }, { status: 400 });
    await requireAuthAndMembership(supabase, projectId);

    const payload = {
      id: safeStr(row?.id).trim() || undefined,
      project_id: projectId,
      stakeholder_id: safeStr(row?.stakeholder_id).trim(),
      role: safeStr(row?.role).trim(),
      decision_notes: safeStr(row?.decision_notes).trim() || null,
      decision_date: safeStr(row?.decision_date).trim() || null,
    };

    if (!payload.stakeholder_id) throw new Error("Missing stakeholder_id");
    if (!payload.role) throw new Error("Missing role");

    const { data, error } = await supabase
      .from("approval_committee")
      .upsert(payload, { onConflict: "id" })
      .select("id")
      .maybeSingle();

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, id: data?.id ?? null });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
