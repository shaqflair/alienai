import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

/* ---------------- helpers ---------------- */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test((x || "").trim());
}

function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
}

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

async function requireAuthAndMembership(supabase: any, projectId: string) {
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

  const role = String((mem as any).role ?? "viewer").toLowerCase();
  const canEdit = role === "owner" || role === "admin" || role === "editor";
  return { userId: auth.user.id, role, canEdit };
}

/** ✅ Searchable human summary for the `content` column */
function makeSummary(title: string, contentJson: any) {
  const t = title || "Artifact";
  const type = safeStr(contentJson?.type).trim();
  const version = contentJson?.version != null ? `v${String(contentJson.version)}` : "";

  // WBS
  const wbsRows = Array.isArray(contentJson?.rows) ? contentJson.rows : [];
  const wbsCount = wbsRows.length;
  const wbsTop =
    wbsRows.length
      ? Array.from(
          new Set(
            wbsRows
              .map((r: any) => safeStr(r?.deliverable || r?.name).trim())
              .filter(Boolean)
              .slice(0, 50)
          )
        )
      : [];

  // Schedule
  const phases = Array.isArray(contentJson?.phases) ? contentJson.phases : [];
  const items = Array.isArray(contentJson?.items) ? contentJson.items : [];
  const phaseNames =
    phases.length
      ? Array.from(
          new Set(
            phases
              .map((p: any) => safeStr(p?.name).trim())
              .filter(Boolean)
              .slice(0, 50)
          )
        )
      : [];

  const meta = [type, version].filter(Boolean).join(" ");
  const metaText = meta ? ` • ${meta}` : "";

  const countText = items.length || phases.length ? `${items.length} item(s)` : `${wbsCount} item(s)`;

  const phaseText = phaseNames.length ? ` • phases: ${phaseNames.slice(0, 6).join(", ")}${phaseNames.length > 6 ? "…" : ""}` : "";
  const topText =
    !phaseNames.length && wbsTop.length ? ` • top: ${wbsTop.slice(0, 6).join(", ")}${wbsTop.length > 6 ? "…" : ""}` : "";

  return `${t}${metaText} • ${countText}${phaseText}${topText}`;
}

function canonicalArtifactType(row: any) {
  const a = safeStr(row?.artifact_type).trim();
  return (a || safeStr(row?.type).trim()).toLowerCase();
}

function isTypeCompatible(canonicalType: string, contentJson: any) {
  const cjType = safeStr(contentJson?.type).trim().toLowerCase();
  if (!cjType) return true; // allow missing type (your choice)

  const isScheduleLike = /schedule|gantt|roadmap/.test(canonicalType);
  const isWbsLike = /wbs|work_breakdown|workbreakdown/.test(canonicalType);

  if (isScheduleLike && cjType !== "schedule") return false;
  if (isWbsLike && cjType !== "wbs") return false;

  return true;
}

/* ---------------- route ---------------- */

/**
 * ✅ POST /api/artifacts/update-json
 * Body:
 * - artifact_id (required)
 * - project_id or projectId (required)
 * - content_json (required object)
 * - title (optional)
 * - content (optional override)
 *
 * Supports optimistic concurrency via If-Match header = artifact.updated_at
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await req.json().catch(() => ({}));

    const artifactId = safeStr(body?.artifact_id ?? body?.artifactId).trim();
    const projectId = safeStr(body?.project_id ?? body?.projectId).trim();
    const title = safeStr(body?.title).trim();
    const contentJson = body?.content_json ?? body?.contentJson ?? null;

    if (!artifactId) return jsonErr("Missing artifact_id", 400);
    if (!isUuid(artifactId)) return jsonErr("Invalid artifact_id", 400);

    if (!projectId) return jsonErr("Missing projectId", 400);
    if (!isUuid(projectId)) return jsonErr("Invalid projectId", 400);

    if (!contentJson || typeof contentJson !== "object") {
      return jsonErr("content_json must be an object", 400);
    }

    const { canEdit } = await requireAuthAndMembership(supabase, projectId);
    if (!canEdit) return jsonErr("Forbidden", 403);

    const { data: art, error: artErr } = await supabase
      .from("artifacts")
      .select("id, project_id, is_locked, title, type, artifact_type, updated_at")
      .eq("id", artifactId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (artErr) throw new Error(artErr.message);
    if (!art) return jsonErr("Not found", 404);
    if ((art as any).is_locked) return jsonErr("Artifact is locked", 409);

    const canonType = canonicalArtifactType(art);
    if (!isTypeCompatible(canonType, contentJson)) {
      return jsonErr("content_json type does not match artifact type", 422, {
        canonical_type: canonType,
        content_type: contentJson?.type ?? null,
      });
    }

    // optimistic concurrency
    const ifMatch = safeStr(req.headers.get("if-match")).trim();
    if (ifMatch && safeStr((art as any).updated_at).trim() !== ifMatch) {
      return jsonErr("Conflict: artifact was updated by someone else. Refresh and retry.", 409, {
        if_match: ifMatch,
        current_updated_at: (art as any).updated_at ?? null,
      });
    }

    const finalTitle = title || safeStr((art as any)?.title);
    const patch: any = {
      content_json: contentJson,
      content: safeStr(body?.content).trim() || makeSummary(finalTitle, contentJson),
      last_saved_at: new Date().toISOString(),
    };
    if (title) patch.title = title;

    let q = supabase.from("artifacts").update(patch).eq("id", artifactId).eq("project_id", projectId);
    if (ifMatch) q = q.eq("updated_at", ifMatch);

    const { data: updated, error: upErr } = await q
      .select("id, project_id, title, type, artifact_type, content, content_json, updated_at, last_saved_at")
      .maybeSingle();

    if (upErr) throw new Error(upErr.message);

    if (!updated) {
      if (ifMatch) return jsonErr("Conflict: artifact was updated by someone else. Refresh and retry.", 409);
      return jsonErr("Not found", 404);
    }

    return jsonOk({ artifact: updated });
  } catch (e: any) {
    const msg = String(e?.message ?? "Server error");
    const status = msg === "Unauthorized" ? 401 : msg === "Not found" ? 404 : msg === "Forbidden" ? 403 : 500;
    return jsonErr(msg, status);
  }
}