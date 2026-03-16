import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function s(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function lower(x: unknown) {
  return s(x).trim().toLowerCase();
}

function json(data: any, status = 200) {
  const res = NextResponse.json(data, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function normalizeStatus(input: unknown) {
  const v = lower(input);
  if (!v || v === "all") return null;
  if (v === "suggested") return "proposed";
  if (v === "rejected") return "dismissed";
  if (v === "proposed" || v === "applied" || v === "dismissed") return v;
  return null;
}

function normalizeArtifactType(input: unknown) {
  return lower(input).replace(/[-\s]+/g, "_").replace(/__+/g, "_").trim();
}

function normalizePanelStatus(input: unknown) {
  const v = lower(input);
  if (v === "dismissed") return "rejected";
  if (v === "proposed") return "proposed";
  if (v === "applied") return "applied";
  if (v === "suggested") return "suggested";
  if (v === "rejected") return "rejected";
  return "proposed";
}

function normalizeSeverity(input: unknown) {
  const v = lower(input);
  if (v === "high" || v === "medium" || v === "low") return v;
  return "medium";
}

function derivePatch(row: any) {
  return row?.patch ?? row?.recommended_patch ?? null;
}

function mapSuggestionRow(row: any) {
  const patch = derivePatch(row);

  return {
    id: s(row?.id),
    project_id: s(row?.project_id),
    artifact_id: row?.artifact_id ?? null,
    section_key: row?.section_key ?? null,

    target_artifact_type: row?.target_artifact_type ?? null,
    suggestion_type: s(row?.suggestion_type),
    severity: normalizeSeverity(row?.severity),

    title: s(row?.title),
    body: s(row?.body),
    rationale: s(row?.rationale),

    evidence: row?.evidence ?? {},
    recommended_patch: row?.recommended_patch ?? patch,
    patch,

    status: normalizePanelStatus(row?.status),

    triggered_by_event_id: row?.triggered_by_event_id ?? null,
    trigger_key: s(row?.trigger_key),

    created_at: s(row?.created_at),
    updated_at: s(row?.updated_at),
  };
}

async function requireAuth(supabase: any) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");
  return auth.user;
}

async function requireProjectMembership(supabase: any, projectId: string, userId: string) {
  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role, removed_at")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);
  return mem ?? null;
}

/**
 * GET /api/suggestions
 *
 * Query params supported:
 * - projectId
 * - artifactId
 * - artifactType
 * - status        (all | proposed | suggested | applied | rejected | dismissed)
 * - limit
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const user = await requireAuth(supabase);

    const url = new URL(req.url);
    const projectId = s(url.searchParams.get("projectId")).trim();
    const artifactId = s(url.searchParams.get("artifactId")).trim();
    const artifactType = normalizeArtifactType(url.searchParams.get("artifactType"));
    const statusFilter = normalizeStatus(url.searchParams.get("status"));
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 100) || 100));

    if (!projectId) {
      return json({ ok: false, error: "Missing projectId" }, 400);
    }

    const membership = await requireProjectMembership(supabase, projectId, user.id);
    if (!membership) {
      return json({ ok: false, error: "Forbidden" }, 403);
    }

    let q = supabase
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
          "evidence",
          "recommended_patch",
          "patch",
          "status",
          "triggered_by_event_id",
          "trigger_key",
          "created_at",
          "updated_at",
        ].join(",")
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (artifactId) q = q.eq("artifact_id", artifactId);

    if (artifactType) {
      q = q.eq("target_artifact_type", artifactType);
    }

    if (statusFilter) {
      q = q.eq("status", statusFilter);
    }

    const { data, error } = await q;
    if (error) return json({ ok: false, error: error.message }, 500);

    const items = Array.isArray(data) ? data.map(mapSuggestionRow) : [];

    return json({
      ok: true,
      items,
      suggestions: items,
      count: items.length,
    });
  } catch (e: any) {
    const msg = s(e?.message || e);
    const status = /unauthorized/i.test(msg) ? 401 : /forbidden/i.test(msg) ? 403 : 500;
    return json({ ok: false, error: msg }, status);
  }
}

/**
 * POST
 *
 * Backward-compatible status update endpoint for a single suggestion id.
 * Supports both route-param based calls and body-only calls:
 * - { id }
 * - { suggestionId }
 * - { suggestion: { id } }
 *
 * This preserves older panel/apply flows, while the dedicated apply route
 * remains the richer mutation path for artifact JSON updates.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id?: string }> }
) {
  try {
    const p = await params;
    const body = await req.json().catch(() => ({}));

    const suggestionId =
      s(p?.id).trim() ||
      s(body?.id).trim() ||
      s(body?.suggestionId).trim() ||
      s(body?.suggestion?.id).trim();

    const projectId = s(body?.projectId).trim() || null;
    const artifactId = s(body?.artifactId).trim() || null;

    const supabase = await createClient();
    const user = await requireAuth(supabase);

    if (!suggestionId) return json({ ok: false, error: "Missing suggestion id" }, 400);

    let suggestionQuery = supabase
      .from("ai_suggestions")
      .select(
        [
          "id",
          "project_id",
          "artifact_id",
          "status",
          "patch",
          "recommended_patch",
          "target_artifact_type",
          "suggestion_type",
        ].join(",")
      )
      .eq("id", suggestionId);

    if (projectId) suggestionQuery = suggestionQuery.eq("project_id", projectId);

    const { data: suggestion, error: suggestionError } = await suggestionQuery.maybeSingle();
    if (suggestionError) return json({ ok: false, error: suggestionError.message }, 500);
    if (!suggestion) return json({ ok: false, error: "Suggestion not found" }, 404);

    const membership = await requireProjectMembership(supabase, s(suggestion.project_id), user.id);
    if (!membership) return json({ ok: false, error: "Forbidden" }, 403);

    const currentStatus = normalizeStatus(suggestion.status) ?? "proposed";
    if (currentStatus !== "proposed") {
      return json(
        {
          ok: false,
          error: `Not actionable (status=${s(suggestion.status)})`,
        },
        400
      );
    }

    let q = supabase
      .from("ai_suggestions")
      .update({
        status: "applied",
        decided_at: new Date().toISOString(),
        rejected_at: null,
        updated_at: new Date().toISOString(),
        ...(artifactId ? { artifact_id: artifactId } : {}),
        patch: suggestion.patch ?? suggestion.recommended_patch ?? null,
      })
      .eq("id", suggestionId);

    if (projectId) q = q.eq("project_id", projectId);

    const { error } = await q;
    if (error) return json({ ok: false, error: error.message }, 500);

    try {
      await supabase.from("ai_suggestion_feedback").insert({
        suggestion_id: suggestionId,
        actor_user_id: user.id,
        action: "applied",
        note: null,
      });
    } catch {
      // ignore
    }

    return json({
      ok: true,
      id: suggestionId,
      status: "applied",
    });
  } catch (e: any) {
    const msg = s(e?.message || e);
    const status = /unauthorized/i.test(msg) ? 401 : /forbidden/i.test(msg) ? 403 : 500;
    return json({ ok: false, error: msg }, status);
  }
}