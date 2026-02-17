import "server-only";
import { NextResponse } from "next/server";
import {
  sb,
  requireUser,
  requireProjectRole,
  canEdit,
  isOwner,
  safeStr,
} from "@/lib/change/server-helpers";

export const runtime = "nodejs";

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

// Compatibility wrapper (your helper signature may differ)
async function requireRoleCompat(supabase: any, projectId: string, userId: string) {
  try {
    return await (requireProjectRole as any)(supabase, projectId, userId);
  } catch {
    return await (requireProjectRole as any)(supabase, projectId);
  }
}

function clamp(s: string, max: number) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) : t;
}

function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}

function normalizeEventType(x: unknown): "created" | "edited" | "comment" | "status_changed" {
  const t = safeLower(x);

  // allow a few legacy aliases
  if (t === "lane_moved" || t === "lane_changed" || t === "status_change") return "status_changed";
  if (t === "comment" || t === "comment_added") return "comment";
  if (t === "created") return "created";
  if (t === "edited") return "edited";

  // default safe choice
  return "comment";
}

function normalizeStatus(x: unknown) {
  const v = safeLower(x);
  if (!v) return null;
  // keep whatever you store in kanban lanes; also allow "approved"/"rejected" if you already emit it
  return v;
}

/**
 * GET /api/change-events?projectId=UUID&changeId=UUID
 * Reads timeline
 */
export async function GET(req: Request) {
  try {
    const supabase = await sb();
    const user = await requireUser(supabase);

    const url = new URL(req.url);
    const projectId = safeStr(url.searchParams.get("projectId")).trim();
    const changeId = safeStr(url.searchParams.get("changeId")).trim();

    if (!projectId) return jsonErr("Missing projectId", 400);
    if (!changeId) return jsonErr("Missing changeId", 400);

    const role = await requireRoleCompat(supabase, projectId, user.id);
    if (!role) return jsonErr("Forbidden", 403);

    const { data, error } = await supabase
      .from("change_events")
      .select(
        `
        id,
        project_id,
        change_id,
        event_type,
        from_status,
        to_status,
        actor_user_id,
        actor_role,
        comment,
        payload,
        created_at
      `
      )
      .eq("project_id", projectId)
      .eq("change_id", changeId)
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);

    return jsonOk({ items: data ?? [], role, userId: user.id });
  } catch (e: any) {
    console.error("[GET /api/change-events]", e);
    return jsonErr(safeStr(e?.message) || "Failed to load events", 500);
  }
}

/**
 * POST /api/change-events
 * Supports:
 * - comment
 * - status_changed  (requires from_status + to_status)
 *
 * Body:
 * {
 *   projectId, changeId,
 *   eventType?: "comment" | "status_changed" | ...aliases,
 *   comment?: string,
 *   fromStatus?: string, toStatus?: string,
 *   payload?: object
 * }
 */
export async function POST(req: Request) {
  try {
    const supabase = await sb();
    const user = await requireUser(supabase);

    const body = await req.json().catch(() => ({}));

    const projectId = safeStr(body?.projectId).trim();
    const changeId = safeStr(body?.changeId ?? body?.change_id).trim();

    if (!projectId) return jsonErr("Missing projectId", 400);
    if (!changeId) return jsonErr("Missing changeId", 400);

    const role = await requireRoleCompat(supabase, projectId, user.id);
    if (!role) return jsonErr("Forbidden", 403);

    // Editors/owners can write events (tighten if you want)
    if (!canEdit(role)) return jsonErr("Forbidden", 403);

    const eventType = normalizeEventType(body?.eventType ?? body?.event_type);

    const payload =
      body?.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
        ? body.payload
        : {};

    // COMMENT
    if (eventType === "comment") {
      const comment = clamp(safeStr(body?.comment).trim(), 2000);
      if (!comment) return jsonErr("Comment is required", 400);

      const insertRow = {
        project_id: projectId,
        change_id: changeId,
        event_type: "comment",
        from_status: null,
        to_status: null,
        actor_user_id: user.id,
        actor_role: safeStr(role),
        comment,
        payload,
      };

      const { data, error } = await supabase
        .from("change_events")
        .insert(insertRow)
        .select(
          `
          id,
          project_id,
          change_id,
          event_type,
          from_status,
          to_status,
          actor_user_id,
          actor_role,
          comment,
          payload,
          created_at
        `
        )
        .single();

      if (error) throw new Error(error.message);
      return jsonOk({ item: data }, 201);
    }

    // STATUS_CHANGED
    if (eventType === "status_changed") {
      // Optional: make this owner-only if you want strict governance:
      // if (!isOwner(role)) return jsonErr("Only owners can record status changes", 403);

      const from_status = normalizeStatus(body?.fromStatus ?? body?.from_status);
      const to_status = normalizeStatus(body?.toStatus ?? body?.to_status);

      if (!from_status || !to_status) {
        return jsonErr("fromStatus and toStatus are required for status_changed", 400);
      }

      const insertRow = {
        project_id: projectId,
        change_id: changeId,
        event_type: "status_changed",
        from_status,
        to_status,
        actor_user_id: user.id,
        actor_role: safeStr(role),
        comment: null,
        payload,
      };

      const { data, error } = await supabase
        .from("change_events")
        .insert(insertRow)
        .select(
          `
          id,
          project_id,
          change_id,
          event_type,
          from_status,
          to_status,
          actor_user_id,
          actor_role,
          comment,
          payload,
          created_at
        `
        )
        .single();

      if (error) throw new Error(error.message);
      return jsonOk({ item: data }, 201);
    }

    // created / edited are normally written by server routes, not UI
    // but we can allow them if you ever want:
    if (eventType === "created" || eventType === "edited") {
      // keep these owner-only to avoid noisy logs
      if (!isOwner(role)) return jsonErr("Forbidden", 403);

      const from_status = normalizeStatus(body?.fromStatus ?? body?.from_status);
      const to_status = normalizeStatus(body?.toStatus ?? body?.to_status);

      const insertRow = {
        project_id: projectId,
        change_id: changeId,
        event_type: eventType,
        from_status,
        to_status,
        actor_user_id: user.id,
        actor_role: safeStr(role),
        comment: null,
        payload,
      };

      const { data, error } = await supabase
        .from("change_events")
        .insert(insertRow)
        .select(
          `
          id,
          project_id,
          change_id,
          event_type,
          from_status,
          to_status,
          actor_user_id,
          actor_role,
          comment,
          payload,
          created_at
        `
        )
        .single();

      if (error) throw new Error(error.message);
      return jsonOk({ item: data }, 201);
    }

    return jsonErr("Unsupported eventType", 400);
  } catch (e: any) {
    console.error("[POST /api/change-events]", e);
    return jsonErr(safeStr(e?.message) || "Failed to add event", 500);
  }
}
