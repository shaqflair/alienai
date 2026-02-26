// src/app/api/wbs/[artifactId]/sync/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- response helpers ---------------- */

function noStoreJson(payload: any, status = 200) {
  const res = NextResponse.json(payload, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}
function jsonErr(message: string, status = 400, details?: any) {
  return noStoreJson({ ok: false, error: message, details }, status);
}
function jsonOk(payload: any) {
  return noStoreJson({ ok: true, ...payload }, 200);
}

/* ---------------- utils ---------------- */

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function safeLower(x: any) {
  return safeStr(x).trim().toLowerCase();
}

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function looksLikeIsoDate(d: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(d || "").trim());
}

function parseIsoDateOnlyOrNull(x: any): string | null {
  const s = safeStr(x).trim();
  if (!s) return null;

  // accept yyyy-mm-dd
  if (looksLikeIsoDate(s)) return s;

  // accept timestamp-ish, normalize to yyyy-mm-dd (UTC)
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function clampInt(n: any, min: number, max: number, fallback: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function mapStatus(x: any): "todo" | "inprogress" | "done" | "blocked" {
  const s = safeLower(x);

  // canonical DB values
  if (s === "todo") return "todo";
  if (s === "inprogress") return "inprogress";
  if (s === "done") return "done";
  if (s === "blocked") return "blocked";

  // editor values
  if (s === "in_progress") return "inprogress";
  if (s === "not_started" || s === "notstarted" || s === "not-started") return "todo";

  return "todo";
}

function mapEffortToNumeric(e: any): number | null {
  const s = safeStr(e).trim().toUpperCase();
  if (s === "S") return 1;
  if (s === "M") return 2;
  if (s === "L") return 3;

  // if numeric effort ever comes through
  const n = Number(e);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);

  return null;
}

/** Safe "NOT IN" delete: chunked + uses id deletes */
async function deleteStaleRows(
  supabase: any,
  projectId: string,
  artifactId: string,
  keepList: string[]
) {
  const CHUNK = 900;

  // fetch current rows for this artifact
  const { data: cur, error } = await supabase
    .from("wbs_items")
    .select("id, source_row_id")
    .eq("project_id", projectId)
    .eq("source_artifact_id", artifactId)
    .limit(5000);

  if (error) return { ok: false, error: error.message };

  const keep = new Set((keepList ?? []).map((x) => safeStr(x).trim()).filter(Boolean));
  const toDeleteIds = (cur || [])
    .filter((r: any) => {
      const sr = safeStr(r?.source_row_id).trim();
      return sr && !keep.has(sr);
    })
    .map((r: any) => safeStr(r?.id).trim())
    .filter(Boolean);

  for (let i = 0; i < toDeleteIds.length; i += CHUNK) {
    const chunk = toDeleteIds.slice(i, i + CHUNK);
    const del = await supabase.from("wbs_items").delete().in("id", chunk);
    if (del.error) return { ok: false, error: del.error.message };
  }

  return { ok: true, deleted: toDeleteIds.length };
}

/* ---------------- handler ---------------- */

export async function POST(
  req: Request,
  { params }: { params: { artifactId?: string } }
) {
  try {
    const aId = safeStr(params?.artifactId).trim();
    if (!aId || !isUuid(aId)) return jsonErr("Missing/invalid artifactId", 400);

    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return jsonErr(authErr.message, 401);
    if (!auth?.user) return jsonErr("Unauthorized", 401);

    const body = await req.json().catch(() => ({} as any));
    const projectId = safeStr(body?.projectId ?? body?.project_id).trim();
    if (!projectId || !isUuid(projectId)) return jsonErr("Missing/invalid projectId", 400);

    // ✅ Authz gate (at minimum: must be a project member)
    // If you have a stricter RPC (e.g. require_project_role), swap it in here.
    try {
      const memberCheck = await supabase.rpc("is_project_member", {
        p_project_id: projectId,
        p_user_id: auth.user.id,
      });
      const isMember = !!memberCheck?.data;
      if (memberCheck?.error) return jsonErr(memberCheck.error.message, 403);
      if (!isMember) return jsonErr("Forbidden", 403);
    } catch {
      // If RPC is missing in some envs, fail closed.
      return jsonErr("Forbidden (membership check unavailable)", 403);
    }

    const rows = Array.isArray(body?.rows) ? body.rows : [];

    // cap to protect DB / API
    const MAX_ROWS = 5000;
    const sliced = rows.slice(0, MAX_ROWS);

    if (!sliced.length) {
      // If editor emptied, remove linked items
      const del = await supabase
        .from("wbs_items")
        .delete()
        .eq("project_id", projectId)
        .eq("source_artifact_id", aId);

      if (del.error) return jsonErr(del.error.message, 400);
      return jsonOk({ synced: 0, deletedAllForArtifact: true });
    }

    // Build parent mapping based on levels (stack)
    const stack: Array<{ level: number; rowId: string }> = [];
    const rowIdToParentRowId = new Map<string, string | null>();
    const rowIdToSort = new Map<string, number>();

    for (let i = 0; i < sliced.length; i++) {
      const r = sliced[i] ?? {};
      const rowId = safeStr(r?.id).trim() || `row_${i}`;
      const lvl = Number(r?.level ?? 0);

      while (stack.length && lvl <= stack[stack.length - 1].level) stack.pop();
      const parent = stack.length ? stack[stack.length - 1].rowId : null;

      rowIdToParentRowId.set(rowId, parent);
      rowIdToSort.set(rowId, i);

      stack.push({ level: lvl, rowId });
    }

    // 1) Upsert "flat" rows (parent assigned later after we know DB ids)
    const upsertPayload = sliced.map((r: any, i: number) => {
      const sourceRowId = safeStr(r?.id).trim() || `row_${i}`;

      const due =
        r?.due_date ??
        r?.dueDate ??
        r?.end_date ??
        r?.endDate ??
        r?.end ??
        null;

      const dueDate = parseIsoDateOnlyOrNull(due);

      const name =
        safeStr(r?.deliverable).trim() ||
        safeStr(r?.name).trim() ||
        safeStr(r?.title).trim() ||
        "Work item";

      return {
        project_id: projectId,
        source_artifact_id: aId,
        source_row_id: sourceRowId,

        name: name.slice(0, 500),
        description: safeStr(r?.description).trim() || null,

        owner: (safeStr(r?.owner_label).trim() || safeStr(r?.owner).trim()) || null,

        due_date: dueDate,

        estimated_effort: mapEffortToNumeric(r?.effort),
        status: mapStatus(r?.status),

        sort_order: rowIdToSort.get(sourceRowId) ?? i,

        // parent_id patched in step 3
      };
    });

    const up = await supabase
      .from("wbs_items")
      .upsert(upsertPayload, { onConflict: "project_id,source_artifact_id,source_row_id" });

    if (up.error) return jsonErr(up.error.message, 400);

    // 2) Reload to map source_row_id -> id
    const after = await supabase
      .from("wbs_items")
      .select("id, source_row_id")
      .eq("project_id", projectId)
      .eq("source_artifact_id", aId)
      .limit(5000);

    if (after.error) return jsonErr(after.error.message, 400);

    const srToId = new Map<string, string>();
    for (const x of (after.data ?? []) as Array<{ id: string; source_row_id: string }>) {
      const sr = safeStr((x as any).source_row_id).trim();
      const id = safeStr((x as any).id).trim();
      if (sr && id) srToId.set(sr, id);
    }

    // 3) Patch parent_id (never self-parent)
    const parentUpdates = sliced
      .map((r: any, i: number) => {
        const sourceRowId = safeStr(r?.id).trim() || `row_${i}`;
        const selfId = srToId.get(sourceRowId);
        if (!selfId) return null;

        const parentSource = rowIdToParentRowId.get(sourceRowId) ?? null;
        const parentId = parentSource ? srToId.get(parentSource) ?? null : null;

        // guard against self-parent (DB check constraint)
        const safeParentId = parentId && parentId !== selfId ? parentId : null;

        return { id: selfId, parent_id: safeParentId };
      })
      .filter(Boolean) as Array<{ id: string; parent_id: string | null }>;

    if (parentUpdates.length) {
      const pu = await supabase.from("wbs_items").upsert(parentUpdates, { onConflict: "id" });
      if (pu.error) {
        // tolerant: don't fail the whole sync if parent patching has issues
        return jsonOk({
          synced: upsertPayload.length,
          parentPatched: false,
          parentPatchError: pu.error.message,
        });
      }
    }

    // 4) Delete stale rows not present anymore (for this artifact)
    const keepList = upsertPayload.map((x: any) => x.source_row_id).filter(Boolean);
    const delRes = await deleteStaleRows(supabase, projectId, aId, keepList);

    if (!delRes.ok) {
      // tolerant: sync still succeeded; deletion can be retried
      return jsonOk({
        synced: upsertPayload.length,
        parentPatched: true,
        staleDeleted: false,
        staleDeleteError: delRes.error,
      });
    }

    return jsonOk({
      synced: upsertPayload.length,
      parentPatched: true,
      staleDeleted: true,
      staleDeletedCount: delRes.deleted,
      meta: {
        capped: rows.length > sliced.length ? { requested: rows.length, used: sliced.length } : null,
      },
    });
  } catch (e: any) {
    return jsonErr(e?.message ?? "Unknown error", 500);
  }
}