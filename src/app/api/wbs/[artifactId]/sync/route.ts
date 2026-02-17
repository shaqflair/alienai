import "server-only";


        param($m)
        $inner = $m.Groups[1].Value
        if ($inner -match '\bNextRequest\b') { return $m.Value }
        if ($inner -match '\bNextResponse\b') {
          # insert NextRequest right after opening brace
          return ('import { NextRequest, ' + $inner.Trim() + ' } from "next/server";') -replace '\s+,', ','
        }
        return $m.Value
      
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

/* ---------------- response helpers ---------------- */

function jsonErr(message: string, status = 400, details?: any) {
  return NextResponse.json({ ok: false, error: message, details }, { status });
}
function jsonOk(payload: any) {
  return NextResponse.json({ ok: true, ...payload }, { status: 200 });
}

/* ---------------- utils ---------------- */

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
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

  // accept timestamp-ish, but normalize to yyyy-mm-dd (UTC)
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
  const s = safeStr(x).trim().toLowerCase();
  if (s === "done") return "done";
  if (s === "blocked") return "blocked";
  if (s === "in_progress" || s === "inprogress") return "inprogress";
  // not_started etc.
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

/** Safe "NOT IN" delete: chunked + uses `not().in()` to avoid fragile string expressions */
async function deleteStaleRows(
  supabase: any,
  projectId: string,
  artifactId: string,
  keepList: string[]
) {
  // If keepList is empty, caller should delete all earlier.
  // If list is massive, chunk to avoid query limits.
  const CHUNK = 900;

  // We can't express "NOT IN (all keepList)" in multiple chunks safely,
  // so we do the inverse: fetch current rows and delete those not in keep set.
  const { data: cur, error } = await supabase
    .from("wbs_items")
    .select("id, source_row_id")
    .eq("project_id", projectId)
    .eq("source_artifact_id", artifactId)
    .limit(5000);

  if (error) return { ok: false, error: error.message };

  const keep = new Set(keepList);
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

export async function POST(req: NextRequest, ctx: { params: Promise<{ artifactId?: string }> }) {
  try {
    const { artifactId } = await ctx.params;
    const aId = safeStr(artifactId).trim();
    if (!aId || !isUuid(aId)) return jsonErr("Missing/invalid artifactId", 400);

    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return jsonErr(authErr.message, 401);
    if (!auth?.user) return jsonErr("Unauthorized", 401);

    const body = await req.json().catch(() => ({} as any));
    const projectId = safeStr(body?.projectId ?? body?.project_id).trim();
    if (!projectId || !isUuid(projectId)) return jsonErr("Missing/invalid projectId", 400);

    const rows = Array.isArray(body?.rows) ? body.rows : [];

    // cap to protect DB / API
    const MAX_ROWS = 5000;
    const sliced = rows.slice(0, MAX_ROWS);

    if (!sliced.length) {
      // If editor emptied, remove linked items
      const del = await supabase.from("wbs_items").delete().eq("project_id", projectId).eq("source_artifact_id", aId);
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

    // 1) Upsert â€œflatâ€ rows (parent assigned later after we know DB ids)
    const upsertPayload = sliced.map((r: any, i: number) => {
      const sourceRowId = safeStr(r?.id).trim() || `row_${i}`;

      // âœ… accept due_date / dueDate / end_date / endDate / end
      const due =
        r?.due_date ??
        r?.dueDate ??
        r?.end_date ??
        r?.endDate ??
        r?.end ??
        null;

      const dueDate = parseIsoDateOnlyOrNull(due);

      // âœ… accept deliverable or name/title as fallback
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

        // âœ… accept owner_label or owner
        owner: (safeStr(r?.owner_label).trim() || safeStr(r?.owner).trim()) || null,

        // âœ… stored as ISO date only (DB)
        due_date: dueDate,

        estimated_effort: mapEffortToNumeric(r?.effort),
        status: mapStatus(r?.status),

        sort_order: rowIdToSort.get(sourceRowId) ?? i,

        // parent_id set in step 2
      };
    });

    const up = await supabase
      .from("wbs_items")
      .upsert(upsertPayload, { onConflict: "project_id,source_artifact_id,source_row_id" });

    if (up.error) return jsonErr(up.error.message, 400);

    // 2) Reload to get fresh mapping for all rows after upsert
    const after = await supabase
      .from("wbs_items")
      .select("id, source_row_id")
      .eq("project_id", projectId)
      .eq("source_artifact_id", aId)
      .limit(5000);

    if (after.error) return jsonErr(after.error.message, 400);

    const srToId = new Map<string, string>();
    for (const x of after.data ?? []) {
      const sr = safeStr((x as any).source_row_id).trim();
      const id = safeStr((x as any).id).trim();
      if (sr && id) srToId.set(sr, id);
    }

    // 3) Patch parent_id for each row
    const parentUpdates = sliced
      .map((r: any, i: number) => {
        const sourceRowId = safeStr(r?.id).trim() || `row_${i}`;
        const selfId = srToId.get(sourceRowId);
        if (!selfId) return null;

        const parentSource = rowIdToParentRowId.get(sourceRowId) ?? null;
        const parentId = parentSource ? srToId.get(parentSource) ?? null : null;

        return { id: selfId, parent_id: parentId };
      })
      .filter(Boolean) as Array<{ id: string; parent_id: string | null }>;

    if (parentUpdates.length) {
      // upsert by id
      const pu = await supabase.from("wbs_items").upsert(parentUpdates, { onConflict: "id" });
      if (pu.error) {
        // tolerant: donâ€™t fail the whole sync if parent patching has issues
        return jsonOk({
          synced: upsertPayload.length,
          parentPatched: false,
          parentPatchError: pu.error.message,
        });
      }
    }

    // 4) Delete stale rows not present anymore (for this artifact)
    const keepList = upsertPayload.map((x) => x.source_row_id).filter(Boolean);
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

