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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(x ?? "")
  );
}
function titleFromSuggestionType(input: unknown) {
  const s = safeStr(input).trim();
  if (!s) return "Suggestion";
  return s
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing env vars: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createSbJsClient(url, key, { auth: { persistSession: false } });
}

async function requireAuthAndMembership(projectId: string) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role, removed_at")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .is("removed_at", null)
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

    const includeTestParam = safeLower(url.searchParams.get("includeTest") ?? "");
    const includeTest =
      includeTestParam === "1" ||
      includeTestParam === "true" ||
      process.env.NODE_ENV === "development";

    if (!projectId) {
      return NextResponse.json({ ok: false, error: "Missing projectId" }, { status: 400 });
    }
    if (!isUuid(projectId)) {
      return NextResponse.json({ ok: false, error: "Invalid projectId" }, { status: 400 });
    }

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
          "severity",
          "title",
          "body",
          "rationale",
          "confidence",
          "patch",
          "status",
          "created_at",
          "updated_at",
          "decided_at",
          "rejected_at",
          "actioned_by",
          "trigger_key",
          "source_event_id",
          "triggered_by_event_id",
          "payload",
          "organisation_id",
        ].join(",")
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (artifactId) q = q.eq("artifact_id", artifactId);
    if (targetArtifactType) q = q.eq("target_artifact_type", targetArtifactType);
    if (status !== "all") q = q.eq("status", status);

    if (!includeTest) {
      q = q.neq("suggestion_type", "ui_test");
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const suggestions = (Array.isArray(data) ? data : []).map((row: any) => {
      const suggestionType = safeStr(row?.suggestion_type).trim();
      const title = safeStr(row?.title).trim() || titleFromSuggestionType(suggestionType);
      const body = safeStr(row?.body).trim() || safeStr(row?.rationale).trim();
      const sourceEventId =
        safeStr(row?.source_event_id).trim() || safeStr(row?.triggered_by_event_id).trim() || null;
      const severity = safeStr(row?.severity).trim() || "medium";

      return {
        id: row?.id ?? null,
        project_id: row?.project_id ?? null,
        artifact_id: row?.artifact_id ?? null,
        section_key: row?.section_key ?? null,
        target_artifact_type: row?.target_artifact_type ?? null,
        suggestion_type: suggestionType || null,
        severity,
        title,
        body,
        rationale: safeStr(row?.rationale).trim() || body || null,
        confidence: typeof row?.confidence === "number" ? row.confidence : null,
        patch: row?.patch ?? null,
        status: row?.status ?? "proposed",
        created_at: row?.created_at ?? null,
        updated_at: row?.updated_at ?? null,
        decided_at: row?.decided_at ?? null,
        rejected_at: row?.rejected_at ?? null,
        actioned_by: row?.actioned_by ?? null,
        trigger_key: row?.trigger_key ?? null,
        source_event_id: sourceEventId,
        triggered_by_event_id: row?.triggered_by_event_id ?? sourceEventId,
        payload: row?.payload ?? {},
        organisation_id: row?.organisation_id ?? null,
      };
    });

    return NextResponse.json({ ok: true, suggestions, includeTest });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}