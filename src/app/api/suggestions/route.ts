import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createSbJsClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}
function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
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

  return { userId: auth.user.id, role: String((mem as any).role ?? "viewer") };
}

/**
 * GET /api/suggestions?projectId=...&artifactId=...&status=proposed|suggested|rejected|all&targetArtifactType=...&includeTest=1
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const projectId = safeStr(url.searchParams.get("projectId")).trim();
    const artifactId = safeStr(url.searchParams.get("artifactId") ?? "").trim();
    const targetArtifactType = safeStr(url.searchParams.get("targetArtifactType") ?? "").trim();
    const status = safeLower(url.searchParams.get("status") ?? "proposed");
    const limitRaw = Number(url.searchParams.get("limit") ?? "20");
    const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? limitRaw : 20));

    // ✅ hide ui_test unless explicitly requested or in dev
    const includeTestParam = safeLower(url.searchParams.get("includeTest") ?? "");
    const includeTest = includeTestParam === "1" || includeTestParam === "true" || process.env.NODE_ENV === "development";

    if (!projectId) return NextResponse.json({ ok: false, error: "Missing projectId" }, { status: 400 });
    if (!isUuid(projectId)) return NextResponse.json({ ok: false, error: "Invalid projectId" }, { status: 400 });

    if (artifactId && !isUuid(artifactId)) {
      return NextResponse.json({ ok: false, error: "Invalid artifactId" }, { status: 400 });
    }

    await requireAuthAndMembership(projectId);

    const sb = adminClient();

    let q = sb
      .from("ai_suggestions")
      .select(
        [
          "id",
          "project_id",
          "artifact_id",
          "section_key",
          "target_artifact_type",
          "suggestion_type",
          "rationale",
          "confidence",
          "patch",
          "status",
          "created_at",
          "decided_at",
          "rejected_at",
          "trigger_key",
          "triggered_by_event_id",
        ].join(",")
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (artifactId) q = q.eq("artifact_id", artifactId);
    if (targetArtifactType) q = q.eq("target_artifact_type", targetArtifactType);
    if (status !== "all") q = q.eq("status", status);

    // ✅ hide ui_test by default
    if (!includeTest) {
      // supabase-js filter for NOT EQUAL:
      q = q.neq("suggestion_type", "ui_test");
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, suggestions: data ?? [], includeTest });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
