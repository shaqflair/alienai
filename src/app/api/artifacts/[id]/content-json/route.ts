// src/app/api/artifacts/[id]/content-json/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (x || "").trim()
  );
}
function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
}
function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

/* ───────────────────────── Membership gate ───────────────────────── */

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

/* ───────────────────────── Stakeholder helpers (for summary) ───────────────────────── */

function stakeholderRowsFromDoc(contentJson: any): any[] {
  const cj = contentJson && typeof contentJson === "object" ? contentJson : null;
  if (!cj) return [];
  if (Array.isArray((cj as any).rows)) return (cj as any).rows;

  if (Array.isArray((cj as any).groups)) {
    const out: any[] = [];
    for (const g of (cj as any).groups) {
      const gName = safeStr(g?.name || g?.label || g?.title).trim();
      if (Array.isArray(g?.rows)) {
        for (const r of g.rows) {
          out.push({ ...r, group: safeStr(r?.group).trim() || gName || "" });
        }
      }
    }
    return out;
  }
  return [];
}

function stakeholderGroupNames(contentJson: any): string[] {
  const cj = contentJson && typeof contentJson === "object" ? contentJson : null;
  if (!cj) return [];
  const groups = Array.isArray((cj as any).groups) ? (cj as any).groups : [];
  return Array.from(
    new Set(
      groups
        .map((g: any) => safeStr(g?.name || g?.label || g?.title).trim())
        .filter(Boolean)
        .slice(0, 50)
    )
  );
}

/** ✅ Searchable human summary for the `content` column (WBS + Schedule + Stakeholder Register supported). */
function makeSummary(title: string, contentJson: any) {
  const t = title || "Artifact";
  const type = safeStr(contentJson?.type).trim();
  const version = contentJson?.version != null ? `v${String(contentJson.version)}` : "";
  const meta = [type, version].filter(Boolean).join(" ");
  const metaText = meta ? ` • ${meta}` : "";

  const cjType = safeStr(contentJson?.type).trim().toLowerCase();
  const isStakeholderDoc = cjType === "stakeholder_register" || cjType === "stakeholder-register";

  if (isStakeholderDoc) {
    const rows = stakeholderRowsFromDoc(contentJson);
    const groups = stakeholderGroupNames(contentJson);
    const names =
      rows.length
        ? Array.from(
            new Set(
              rows
                .map((r: any) => safeStr(r?.name).trim())
                .filter(Boolean)
                .slice(0, 50)
            )
          )
        : [];

    const countText = `${rows.length} stakeholder(s)`;
    const groupText = groups.length
      ? ` • groups: ${groups.slice(0, 6).join(", ")}${groups.length > 6 ? "…" : ""}`
      : "";
    const topText = names.length
      ? ` • top: ${names.slice(0, 6).join(", ")}${names.length > 6 ? "…" : ""}`
      : "";

    return `${t}${metaText} • ${countText}${groupText}${topText}`;
  }

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

  const phases = Array.isArray(contentJson?.phases) ? contentJson.phases : [];
  const items = Array.isArray(contentJson?.items) ? contentJson.items : [];
  const phaseNames =
    phases.length
      ? Array.from(new Set(phases.map((p: any) => safeStr(p?.name).trim()).filter(Boolean).slice(0, 50)))
      : [];

  const isScheduleDoc = cjType === "schedule";
  const isWbsDoc = cjType === "wbs";

  if (isScheduleDoc) {
    const countText = `${items.length} item(s)`;
    const phaseText = phaseNames.length
      ? ` • phases: ${phaseNames.slice(0, 6).join(", ")}${phaseNames.length > 6 ? "…" : ""}`
      : "";
    return `${t}${metaText} • ${countText}${phaseText}`;
  }

  if (isWbsDoc) {
    const countText = `${wbsCount} item(s)`;
    const topText = wbsTop.length ? ` • top: ${wbsTop.slice(0, 6).join(", ")}${wbsTop.length > 6 ? "…" : ""}` : "";
    return `${t}${metaText} • ${countText}${topText}`;
  }

  const countText = items.length || phases.length ? `${items.length} item(s)` : `${wbsCount} item(s)`;
  const phaseText = phaseNames.length
    ? ` • phases: ${phaseNames.slice(0, 6).join(", ")}${phaseNames.length > 6 ? "…" : ""}`
    : "";
  const topText =
    !phaseNames.length && wbsTop.length ? ` • top: ${wbsTop.slice(0, 6).join(", ")}${wbsTop.length > 6 ? "…" : ""}` : "";

  return `${t}${metaText} • ${countText}${phaseText}${topText}`;
}

/** ✅ Canonical type per your schema: COALESCE(artifact_type, type) */
function canonicalArtifactType(row: any) {
  const a = safeStr(row?.artifact_type).trim();
  return (a || safeStr(row?.type).trim()).toLowerCase();
}

/** ✅ Tight compatibility rules (includes Stakeholder Register) */
function isTypeCompatible(canonicalType: string, contentJson: any) {
  const cjType = safeStr(contentJson?.type).trim().toLowerCase();
  if (!cjType) return true; // allow missing, but block explicit mismatches

  const isScheduleLike = /schedule|gantt|roadmap/.test(canonicalType);
  const isWbsLike = /wbs|work_breakdown|workbreakdown/.test(canonicalType);
  const isStakeholderLike = /stakeholder/.test(canonicalType);

  if (isScheduleLike && cjType !== "schedule") return false;
  if (isWbsLike && cjType !== "wbs") return false;
  if (isStakeholderLike && cjType !== "stakeholder_register" && cjType !== "stakeholder-register") return false;

  return true;
}

/* ───────────────────────── Column existence helper ───────────────────────── */

async function hasArtifactColumn(supabase: any, columnName: string): Promise<boolean> {
  // Uses Postgres information_schema via RPC-less query:
  // In Supabase, direct select from information_schema is usually allowed for authenticated,
  // but if it’s blocked in your setup, we just return false.
  try {
    const { data, error } = await supabase
      .from("information_schema.columns")
      .select("column_name")
      .eq("table_schema", "public")
      .eq("table_name", "artifacts")
      .eq("column_name", columnName)
      .limit(1);

    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/* ───────────────────────── Routes ───────────────────────── */

/**
 * GET /api/artifacts/:id/content-json?projectId=...
 * projectId is optional: if missing, we resolve from artifacts row (and still enforce membership).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id?: string }> | { id?: string } }) {
  try {
    const supabase = await createClient();
    const params = await Promise.resolve(ctx.params as any);

    const artifactId = safeStr(params?.id).trim() || safeStr(params?.artifactId).trim();
    if (!artifactId) return jsonErr("Missing artifactId", 400, { params });
    if (!isUuid(artifactId)) return jsonErr("Invalid artifactId", 400);

    const url = new URL(req.url);
    let projectId = safeStr(url.searchParams.get("projectId")).trim();

    // If projectId not provided, resolve via artifacts row
    if (!projectId) {
      const { data: a0, error: a0Err } = await supabase
        .from("artifacts")
        .select("id, project_id")
        .eq("id", artifactId)
        .maybeSingle();

      if (a0Err) return jsonErr("Failed to load artifact", 500, { message: a0Err.message, code: a0Err.code, hint: a0Err.hint });
      if (!a0?.project_id) return jsonErr("Not found", 404);

      projectId = String(a0.project_id);
    }

    if (!isUuid(projectId)) return jsonErr("Invalid projectId", 400);

    await requireAuthAndMembership(supabase, projectId);

    const { data: art, error: artErr } = await supabase
      .from("artifacts")
      .select("id, project_id, title, type, artifact_type, is_current, content_json, updated_at, created_at, is_locked")
      .eq("id", artifactId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (artErr) return jsonErr("Failed to load artifact", 500, { message: artErr.message, code: artErr.code, hint: artErr.hint });
    if (!art) return jsonErr("Not found", 404);

    return jsonOk({
      artifact: {
        id: (art as any).id,
        project_id: (art as any).project_id,
        title: (art as any).title ?? null,
        type: (art as any).type ?? null,
        artifact_type: (art as any).artifact_type ?? null,
        canonical_type: canonicalArtifactType(art),
        is_current: !!(art as any).is_current,
        is_locked: !!(art as any).is_locked,
        updated_at: (art as any).updated_at ?? null,
        created_at: (art as any).created_at ?? null,
      },
      content_json: (art as any).content_json ?? null,
    });
  } catch (e: any) {
    const msg = String(e?.message ?? "Server error");
    const status = msg === "Unauthorized" ? 401 : msg === "Not found" ? 404 : msg === "Forbidden" ? 403 : 500;
    return jsonErr(msg, status);
  }
}

/**
 * POST /api/artifacts/:id/content-json
 * - projectId is optional: if missing, resolve from artifact row.
 * - Optional concurrency: header If-Match: <artifact.updated_at from GET>
 */
export async function POST(req: Request, ctx: { params: Promise<{ id?: string }> | { id?: string } }) {
  try {
    const supabase = await createClient();
    const params = await Promise.resolve(ctx.params as any);

    const artifactId = safeStr(params?.id).trim() || safeStr(params?.artifactId).trim();
    if (!artifactId) return jsonErr("Missing artifactId", 400, { params });
    if (!isUuid(artifactId)) return jsonErr("Invalid artifactId", 400);

    const body = await req.json().catch(() => ({}));

    let projectId = safeStr(body?.projectId ?? body?.project_id).trim();
    const title = safeStr(body?.title).trim();
    const contentJson = body?.content_json ?? body?.contentJson ?? null;

    if (!contentJson || typeof contentJson !== "object") {
      return jsonErr("content_json must be an object", 400);
    }

    // Resolve projectId if missing
    if (!projectId) {
      const { data: a0, error: a0Err } = await supabase
        .from("artifacts")
        .select("id, project_id")
        .eq("id", artifactId)
        .maybeSingle();

      if (a0Err) return jsonErr("Failed to load artifact", 500, { message: a0Err.message, code: a0Err.code, hint: a0Err.hint });
      if (!a0?.project_id) return jsonErr("Not found", 404);

      projectId = String(a0.project_id);
    }

    if (!isUuid(projectId)) return jsonErr("Invalid projectId", 400);

    const { canEdit } = await requireAuthAndMembership(supabase, projectId);
    if (!canEdit) return jsonErr("Forbidden", 403);

    const { data: art, error: artErr } = await supabase
      .from("artifacts")
      .select("id, project_id, is_locked, title, type, artifact_type, updated_at")
      .eq("id", artifactId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (artErr) return jsonErr("Failed to load artifact", 500, { message: artErr.message, code: artErr.code, hint: artErr.hint });
    if (!art) return jsonErr("Not found", 404);

    if ((art as any).is_locked) return jsonErr("Artifact is locked", 409);

    const canonType = canonicalArtifactType(art);
    if (!isTypeCompatible(canonType, contentJson)) {
      return jsonErr("content_json type does not match artifact type", 422, {
        canonical_type: canonType,
        content_type: contentJson?.type ?? null,
      });
    }

    // ✅ Optimistic concurrency
    const ifMatch = safeStr(req.headers.get("if-match")).trim();
    if (ifMatch && safeStr((art as any).updated_at).trim() !== ifMatch) {
      return jsonErr("Conflict: artifact was updated by someone else. Refresh and retry.", 409, {
        if_match: ifMatch,
        current_updated_at: (art as any).updated_at ?? null,
      });
    }

    const finalTitle = title || safeStr((art as any)?.title);

    // Only set last_saved_at if the column exists
    const canSetLastSavedAt = await hasArtifactColumn(supabase, "last_saved_at");

    const patch: any = {
      content_json: contentJson,
      content: safeStr(body?.content).trim() || makeSummary(finalTitle, contentJson),
    };
    if (title) patch.title = title;
    if (canSetLastSavedAt) patch.last_saved_at = new Date().toISOString();

    // ✅ Do NOT set updated_at manually (trigger does it)
    // ✅ Enforce atomic concurrency by also filtering updated_at in the UPDATE
    let q = supabase.from("artifacts").update(patch).eq("id", artifactId).eq("project_id", projectId);
    if (ifMatch) q = q.eq("updated_at", ifMatch);

    const { data: updated, error: upErr } = await q
      .select("id, project_id, title, type, artifact_type, content, content_json, updated_at, created_at")
      .maybeSingle();

    if (upErr) {
      return jsonErr("Update failed", 500, {
        message: upErr.message,
        code: upErr.code,
        hint: upErr.hint,
        details: (upErr as any).details,
      });
    }

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
