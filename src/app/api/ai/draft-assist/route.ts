// src/app/api/ai/draft-assist/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { buildDraftAssist, safeStr } from "@/lib/ai/change-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonNoStore(data: any, init?: ResponseInit) {
  const res = NextResponse.json(data, init);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return jsonNoStore({ ok: false, error: "Unauthorized" }, { status: 401 });

    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }

    const projectId = safeStr(body?.projectId).trim();
    if (!projectId) return jsonNoStore({ ok: false, error: "Missing projectId" }, { status: 400 });

    // Verify project exists and user has access
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, organisation_id")
      .eq("id", projectId)
      .maybeSingle();

    if (projErr) return jsonNoStore({ ok: false, error: projErr.message }, { status: 500 });
    if (!project) return jsonNoStore({ ok: false, error: "Project not found" }, { status: 404 });

    // Verify org membership
    const { data: mem } = await supabase
      .from("organisation_members")
      .select("role")
      .eq("organisation_id", project.organisation_id)
      .eq("user_id", user.id)
      .is("removed_at", null)
      .maybeSingle();

    if (!mem) return jsonNoStore({ ok: false, error: "Forbidden" }, { status: 403 });

    const draft = body?.draft ?? {};

    // Call the AI draft assist
    const result = await buildDraftAssist({
      title: safeStr(draft?.title),
      summary: safeStr(draft?.summary),
      priority: safeStr(draft?.priority),
      requester: safeStr(draft?.requester),
      justification: safeStr(draft?.justification),
      financial: safeStr(draft?.financial),
      schedule: safeStr(draft?.schedule),
      risks: safeStr(draft?.risks),
      dependencies: safeStr(draft?.dependencies),
      assumptions: safeStr(draft?.assumptions),
      implementation: safeStr(draft?.implementation),
      rollback: safeStr(draft?.rollback),
      interview: draft?.interview ?? {},
    });

    return jsonNoStore({ ok: true, item: result, ai: result, model: result.model });
  } catch (e: any) {
    return jsonNoStore({ ok: false, error: safeStr(e?.message) || "Draft assist failed" }, { status: 500 });
  }
}