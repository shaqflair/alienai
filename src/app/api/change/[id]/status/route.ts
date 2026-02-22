// src/app/api/change/[id]/status/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { sb, requireUser, requireProjectRole, canEdit, safeStr, logChangeEvent } from "@/lib/change/server-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonOk(payload: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...payload }, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}
function jsonErr(error: string, status = 400, meta?: any) {
  const res = NextResponse.json({ ok: false, error, meta }, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function safeParam(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

function isValidLifecycleStatus(s: string) {
  const v = String(s ?? "").trim().toLowerCase();
  return v === "new" || v === "analysis" || v === "review" || v === "in_progress" || v === "implemented" || v === "closed";
}

function hasMissingColumn(errMsg: string, col: string) {
  const m = (errMsg || "").toLowerCase();
  return m.includes("column") && m.includes(col.toLowerCase());
}

async function insertTimelineEvent(
  supabase: any,
  row: {
    project_id: string;
    change_id: string;
    event_type: "created" | "status_changed" | "comment" | "edited";
    from_status?: string | null;
    to_status?: string | null;
    actor_user_id?: string | null;
    actor_role?: string | null;
    comment?: string | null;
    payload?: any;
  }
) {
  try {
    await supabase.from("change_events").insert({
      project_id: row.project_id,
      change_id: row.change_id,
      event_type: row.event_type,
      from_status: row.from_status ?? null,
      to_status: row.to_status ?? null,
      actor_user_id: row.actor_user_id ?? null,
      actor_role: row.actor_role ?? null,
      comment: row.comment ?? null,
      payload: row.payload && typeof row.payload === "object" ? row.payload : {},
    });
  } catch {
    // swallow
  }
}

/**
 * PATCH /api/change/:id/status
 * Body: { status: "new"|"analysis"|"review"|"in_progress"|"implemented"|"closed" }
 *
 * Governance: This route NEVER approves/rejects/submits/reworks.
 * Use submit/approve/reject/request-changes routes for that.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id?: string }> }) {
  try {
    const supabase = await sb();
    const user = await requireUser(supabase);

    const { id: rawId } = await ctx.params;
    const id = safeParam(rawId).trim();
    if (!id) return jsonErr("Missing id", 400);

    const body = await req.json().catch(() => ({}));
    const next = safeStr(body?.status).trim().toLowerCase();

    if (!next || !isValidLifecycleStatus(next)) {
      return jsonErr("Invalid status (lifecycle only)", 400, {
        allowed: ["new", "analysis", "review", "in_progress", "implemented", "closed"],
      });
    }

    // Load minimal meta (artifact_id might not exist)
    let meta: any = null;
    const metaRes1 = await supabase
      .from("change_requests")
      .select("id, project_id, artifact_id, status, decision_status, delivery_status")
      .eq("id", id)
      .maybeSingle();

    if (!metaRes1.error) {
      meta = metaRes1.data;
    } else if (hasMissingColumn(safeStr(metaRes1.error.message), "artifact_id")) {
      const metaRes2 = await supabase
        .from("change_requests")
        .select("id, project_id, status, decision_status, delivery_status")
        .eq("id", id)
        .maybeSingle();
      if (metaRes2.error) throw metaRes2.error;
      meta = metaRes2.data;
    } else {
      throw metaRes1.error;
    }

    if (!meta) return jsonErr("Not found", 404);

    const projectId = safeStr(meta.project_id).trim();
    if (!projectId) return jsonErr("Not found", 404);

    const artifactId = safeStr(meta.artifact_id).trim();
    const currentStatus = String(meta.status ?? "").toLowerCase();
    const currentDecision = String(meta.decision_status ?? "").toLowerCase();
    const currentLane = String(meta.delivery_status ?? "").toLowerCase();

    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return jsonErr("Forbidden", 403);
    if (!canEdit(role)) return jsonErr("Forbidden", 403);

    // 🔒 Lock while submitted
    if (currentDecision === "submitted") {
      return jsonErr("This change is locked awaiting decision. Use approve/reject/request-changes routes.", 409);
    }

    const now = new Date().toISOString();

    // lifecycle status only (no decision mutations)
    const patch: any = { status: next, updated_at: now };

    // keep delivery_status loosely aligned if column exists in schema
    // (safe: if column doesn’t exist, update will fail and we’ll retry without it)
    patch.delivery_status = next === "new" ? "intake" : next;

    const upd1 = await supabase.from("change_requests").update(patch).eq("id", id).select("*").single();

    let updated: any = null;

    if (upd1.error && hasMissingColumn(safeStr(upd1.error.message), "delivery_status")) {
      delete patch.delivery_status;
      const upd2 = await supabase.from("change_requests").update(patch).eq("id", id).select("*").single();
      if (upd2.error) throw upd2.error;
      updated = upd2.data;
    } else if (upd1.error) {
      throw upd1.error;
    } else {
      updated = upd1.data;
    }

    try {
      if (artifactId) {
        await logChangeEvent(supabase, {
          projectId,
          artifactId,
          changeRequestId: id,
          actorUserId: user.id,
          actorRole: role,
          eventType: "status_changed",
          fromValue: currentLane || currentStatus || null,
          toValue: next,
          note: null,
          payload: { from_status: currentStatus, to_status: next, from_lane: currentLane || null },
        } as any);
      }
    } catch {}

    await insertTimelineEvent(supabase, {
      project_id: projectId,
      change_id: id,
      event_type: "status_changed",
      from_status: currentLane || currentStatus || null,
      to_status: next,
      actor_user_id: user.id,
      actor_role: safeStr(role),
      comment: null,
      payload: { source: "status_route", from_status: currentStatus, to_status: next },
    });

    return jsonOk({ item: updated, data: updated });
  } catch (e: any) {
    console.error("[PATCH /api/change/:id/status]", e);
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500;
    return jsonErr(msg, status);
  }
}