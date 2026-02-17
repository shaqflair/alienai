import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createSbJsClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}
function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(x ?? ""));
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing env vars: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY");
  return createSbJsClient(url, key, { auth: { persistSession: false } });
}

async function requireAuthAndMembership(projectId: string) {
  const supabase = await createClient();
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

  return { userId: auth.user.id };
}

/**
 * POST /api/ai/sla/check
 * Body: { projectId, days?: number }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const projectId = safeStr(body?.projectId).trim();
    const days = Math.max(1, Math.min(60, Number(body?.days ?? 7)));

    if (!projectId || !isUuid(projectId)) return NextResponse.json({ ok: false, error: "Invalid projectId" }, { status: 400 });
    await requireAuthAndMembership(projectId);

    const sb = adminClient();

    // Find proposed suggestions older than N days
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data: old, error } = await sb
      .from("ai_suggestions")
      .select("id, project_id, artifact_id, target_artifact_type, suggestion_type, created_at")
      .eq("project_id", projectId)
      .eq("status", "proposed")
      .lt("created_at", cutoff)
      .limit(200);

    if (error) throw new Error(error.message);

    const created: any[] = [];

    for (const s of old ?? []) {
      const trig = `sla.escalation.${s.id}.${days}d`;

      const { data: existing } = await sb
        .from("ai_suggestions")
        .select("id")
        .eq("project_id", projectId)
        .eq("status", "proposed")
        .eq("trigger_key", trig)
        .maybeSingle();

      if (existing?.id) continue;

      const { data: ins, error: insErr } = await sb
        .from("ai_suggestions")
        .insert({
          project_id: projectId,
          artifact_id: s.artifact_id,
          section_key: null,
          target_artifact_type: s.target_artifact_type,
          suggestion_type: "sla_escalation",
          rationale: `SLA: Suggestion has been proposed for more than ${days} days. Consider applying, rejecting, or escalating to an approver.`,
          confidence: 0.9,
          patch: null,
          status: "proposed",
          actioned_by: null,
          decided_at: null,
          rejected_at: null,
          triggered_by_event_id: null,
          trigger_key: trig,
        })
        .select()
        .single();

      if (!insErr && ins) created.push(ins);
    }

    return NextResponse.json({ ok: true, scanned: (old ?? []).length, created: created.length, createdSuggestions: created });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

