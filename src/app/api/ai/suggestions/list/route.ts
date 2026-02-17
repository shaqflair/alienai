// src/app/api/ai/suggestions/list/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}

export async function POST(req: Request) {
  let stage = "start";

  try {
    stage = "createClient";
    const supabase = await createClient();

    stage = "parseBody";
    const body = await req.json().catch(() => ({}));
    const projectId = safeStr(body?.projectId).trim();
    const target = safeStr(body?.target_artifact_type).trim() || "stakeholder_register";
    const statusRaw = safeStr(body?.status).trim().toLowerCase();
    const artifactId = safeStr(body?.artifactId).trim();

    if (!projectId) {
      return NextResponse.json({ ok: false, stage: "validate", error: "Missing projectId" }, { status: 400 });
    }

    stage = "auth.getUser";
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) throw new Error(authErr.message);
    if (!auth?.user) return NextResponse.json({ ok: false, stage, error: "Unauthorized" }, { status: 401 });

    stage = "project_members.check";
    const { data: mem, error: memErr } = await supabase
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (memErr) throw new Error(memErr.message);
    if (!mem) return NextResponse.json({ ok: false, stage, error: "Not found (not a project member)" }, { status: 404 });

    stage = "ai_suggestions.select.exec";

    // ✅ payload exists after migration above
    let q = supabase
      .from("ai_suggestions")
      .select("id, project_id, artifact_id, target_artifact_type, suggestion_type, status, rationale, payload, sig, created_at")
      .eq("project_id", projectId)
      .eq("target_artifact_type", target)
      .order("created_at", { ascending: false });

    if (artifactId) q = q.eq("artifact_id", artifactId);

    if (!statusRaw || statusRaw === "proposed") q = q.eq("status", "proposed");
    else if (statusRaw !== "all" && statusRaw !== "*") q = q.eq("status", statusRaw);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, suggestions: data ?? [] });
  } catch (e: any) {
    console.error("[api/ai/suggestions/list] 500", { stage, error: e?.message ?? e });
    return NextResponse.json({ ok: false, stage, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
