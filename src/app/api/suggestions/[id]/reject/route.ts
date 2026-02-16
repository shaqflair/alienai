import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

async function safeJson(req: Request) {
  return await req.json().catch(() => ({}));
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();

  // ✅ Auth
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) return NextResponse.json({ ok: false, error: authErr.message }, { status: 401 });
  if (!auth?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  // ✅ Next.js: params is a Promise
  const { id: rawId } = await ctx.params;
  const id = safeParam(rawId);
  if (!id) return NextResponse.json({ ok: false, error: "Missing suggestion id" }, { status: 400 });

  const body = await safeJson(req);
  const projectId = safeParam(body?.projectId);
  if (!projectId) return NextResponse.json({ ok: false, error: "Missing projectId" }, { status: 400 });

  // ✅ Membership check
  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (memErr) return NextResponse.json({ ok: false, error: memErr.message }, { status: 500 });
  if (!mem) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  // ✅ Fetch current status (idempotent)
  const { data: existing, error: getErr } = await supabase
    .from("ai_suggestions")
    .select("id,status")
    .eq("id", id)
    .eq("project_id", projectId)
    .maybeSingle();

  if (getErr) return NextResponse.json({ ok: false, error: getErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ ok: false, error: "Suggestion not found" }, { status: 404 });

  const currStatus = String(existing.status ?? "").toLowerCase();

  // Allow rejecting from proposed OR suggested (both are actionable in your DB)
  if (currStatus !== "proposed" && currStatus !== "suggested") {
    return NextResponse.json({
      ok: true,
      suggestion: { id: existing.id, status: existing.status },
      note: `No change (already ${existing.status})`,
    });
  }

  const nowIso = new Date().toISOString();

  // ✅ DB constraint allows: proposed | applied | rejected | suggested
  const updatePatch: Record<string, any> = {
    status: "rejected",
    decided_at: nowIso,
    rejected_at: nowIso,
    actioned_by: auth.user.id,
  };

  const { data, error } = await supabase
    .from("ai_suggestions")
    .update(updatePatch)
    .eq("id", id)
    .eq("project_id", projectId)
    .select("id,status,decided_at,rejected_at,actioned_by")
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: "Suggestion not found" }, { status: 404 });

  return NextResponse.json({ ok: true, suggestion: data });
}
