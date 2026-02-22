// src/app/api/change/[id]/route.ts
import "server-only";

import { NextResponse } from "next/server";
import {
  sb,
  requireUser,
  requireProjectRole,
  canEdit,
  safeStr,
  logChangeEvent,
  getApprovalProgressForArtifact,
} from "@/lib/change/server-helpers";
import { computeChangeAIFields } from "@/lib/change/ai-compute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const TABLE = "change_requests";

// Next.js 15+ async params
type Ctx = { params: Promise<{ id: string }> };

/* =========================
   Response helpers
========================= */

function ok(data: any, init?: ResponseInit) {
  const item = (data && (data.item ?? data.data)) || null;
  const id = item?.id ?? data?.id ?? null;
  const res = NextResponse.json({ ok: true, ...data, ...(id ? { id } : {}) }, init);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function err(message: string, init?: ResponseInit & { extra?: any; code?: string }) {
  const { extra, code, ...rest } = init || {};
  const res = NextResponse.json(
    { ok: false, error: message, ...(code ? { code } : {}), ...(extra ? { extra } : {}) },
    rest
  );
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/* =========================
   Small utils
========================= */

function clamp(s: string, max: number) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) : t;
}

function isObj(v: any) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function hasOwn(obj: any, key: string) {
  return Object.prototype.hasOwnProperty.call(obj ?? {}, key);
}

function asTags(x: any): string[] {
  if (!Array.isArray(x)) return [];
  return x
    .map((v) => safeStr(v).trim())
    .filter(Boolean)
    .slice(0, 25);
}

function isMissingRelation(errMsg: string) {
  const m = (errMsg || "").toLowerCase();
  return m.includes("does not exist") && m.includes("relation");
}

function normalizePriorityToDb(p: unknown): "Low" | "Medium" | "High" | "Critical" {
  const v = safeStr(p).trim().toLowerCase();
  if (v === "low") return "Low";
  if (v === "high") return "High";
  if (v === "critical") return "Critical";
  return "Medium";
}

const ALLOWED_DELIVERY = new Set(["intake", "analysis", "review", "in_progress", "implemented", "closed"]);

function normalizeDeliveryStatus(x: unknown): string | null {
  const v = safeStr(x).trim().toLowerCase();
  if (!v) return null;
  const norm = v === "in-progress" || v === "in progress" ? "in_progress" : v;
  return ALLOWED_DELIVERY.has(norm) ? norm : null;
}

function isBadIdString(x: string) {
  const v = safeStr(x).trim().toLowerCase();
  return !v || v === "null" || v === "undefined";
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (x || "").trim()
  );
}

/**
 * Resolve id from:
 * 1) ctx.params.id (Next route param) - async
 * 2) URL path segment after "/change/"
 * 3) body.id / body.change_id
 */
async function pickId(req: Request, ctx: Ctx | undefined, body: any): Promise<string | null> {
  // 1) Next route params (async)
  if (ctx?.params) {
    const params = await ctx.params;
    const p = safeStr(params?.id).trim();
    if (!isBadIdString(p)) return p;
  }

  // 2) URL path: /api/change/<id> OR /api/change/<id>/...
  try {
    const pathname = new URL(req.url).pathname || "";
    const parts = pathname.split("/").filter(Boolean);

    const last = parts[parts.length - 1] || "";
    if (last.toLowerCase() !== "change" && !isBadIdString(last)) return last;

    const idx = parts.findIndex((x) => String(x).toLowerCase() === "change");
    if (idx !== -1 && parts[idx + 1]) {
      const candidate = safeStr(parts[idx + 1]).trim();
      if (!isBadIdString(candidate) && candidate.toLowerCase() !== "change") return candidate;
    }
  } catch {
    // ignore
  }

  // 3) Body fallback
  const b = safeStr(body?.id ?? body?.change_id).trim();
  if (!isBadIdString(b)) return b;

  return null;
}

/* =========================
   GET (single OR project board)
========================= */

export async function GET(req: Request, ctx: Ctx) {
  try {
    const supabase = await sb();
    const user = await requireUser(supabase);

    const id = await pickId(req, ctx, null);
    if (!id) return err("Missing id", { status: 400, code: "missing_id" });

    // 1) SINGLE change_request id
    {
      const { data: change, error: chErr } = await supabase
        .from(TABLE)
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (chErr) {
        if (isMissingRelation(chErr.message)) {
          return err("Database table missing: change_requests", {
            status: 500,
            code: "missing_relation",
            extra: { table: TABLE },
          });
        }
        return err(chErr.message || "Failed to load change", { status: 500, code: "db_error" });
      }

      if (change) {
        const role = await requireProjectRole(supabase, change.project_id, user.id);
        if (!role) return err("Forbidden", { status: 403, code: "forbidden" });

        // approvals progress (best-effort)
        const approvals = await getApprovalProgressForArtifact({
          supabase,
          artifactId: change.id,
          actorUserId: user.id,
        }).catch(() => null);

        return ok({
          mode: "change",
          item: change,
          role,
          approvals,
        });
      }
    }

    // 2) PROJECT scope (uuid project_id OR human project_code)
    let projectId: string | null = null;

    if (isUuid(id)) {
      projectId = id;
    } else {
      const { data: proj, error: projErr } = await supabase
        .from("projects")
        .select("id, project_code, title")
        .eq("project_code", id)
        .maybeSingle();

      if (projErr) return err(projErr.message || "Failed to resolve project", { status: 500, code: "db_error" });
      projectId = proj?.id ?? null;
    }

    if (!projectId) return err("Not found", { status: 404, code: "not_found" });

    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return err("Forbidden", { status: 403, code: "forbidden" });

    const { data: items, error: itemsErr } = await supabase
      .from(TABLE)
      .select("*")
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });

    if (itemsErr) {
      if (isMissingRelation(itemsErr.message)) {
        return err("Database table missing: change_requests", {
          status: 500,
          code: "missing_relation",
          extra: { table: TABLE },
        });
      }
      return err(itemsErr.message || "Failed to load changes", { status: 500, code: "db_error" });
    }

    // add AI fields safely
    let withAI = items ?? [];
    try {
      withAI = (items ?? []).map((it: any) => {
        try {
          return computeChangeAIFields(it);
        } catch {
          return it;
        }
      });
    } catch {
      // ignore
    }

    return ok({
      mode: "project",
      project_id: projectId,
      role,
      can_edit: canEdit(role),
      items: withAI,
    });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return err(msg, { status, code: status === 401 ? "unauthorized" : "server_error" });
  }
}

/* =========================
   POST (update)
========================= */

export async function POST(req: Request, ctx: Ctx) {
  try {
    const supabase = await sb();
    const user = await requireUser(supabase);

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    if (!isObj(body)) body = {};

    const id = await pickId(req, ctx, body);
    if (!id) return err("Missing id", { status: 400, code: "missing_id" });

    // updates must target a change row id
    const { data: existing, error: exErr } = await supabase
      .from(TABLE)
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (exErr) {
      if (isMissingRelation(exErr.message)) {
        return err("Database table missing: change_requests", {
          status: 500,
          code: "missing_relation",
          extra: { table: TABLE },
        });
      }
      return err(exErr.message || "Failed to load change", { status: 500, code: "db_error" });
    }
    if (!existing) return err("Not found", { status: 404, code: "not_found" });

    const role = await requireProjectRole(supabase, existing.project_id, user.id);
    if (!role) return err("Forbidden", { status: 403, code: "forbidden" });
    if (!canEdit(role)) return err("Forbidden", { status: 403, code: "forbidden" });

    const patch: any = {};

    if (hasOwn(body, "title")) patch.title = clamp(safeStr(body.title), 140);
    if (hasOwn(body, "description")) patch.description = clamp(safeStr(body.description), 5000);

    if (hasOwn(body, "priority")) patch.priority = normalizePriorityToDb(body.priority);

    if (hasOwn(body, "stage")) {
      const st = normalizeDeliveryStatus(body.stage);
      if (st) patch.stage = st;
    }

    if (hasOwn(body, "status")) {
      const s = safeStr(body.status).trim();
      if (s) patch.status = clamp(s, 60);
    }

    if (hasOwn(body, "owner_id")) patch.owner_id = safeStr(body.owner_id) || null;
    if (hasOwn(body, "owner_label")) patch.owner_label = clamp(safeStr(body.owner_label), 120);

    if (hasOwn(body, "impact_cost")) {
      const n = Number(body.impact_cost);
      patch.impact_cost = Number.isFinite(n) ? n : null;
    }
    if (hasOwn(body, "impact_days")) {
      const n = Number(body.impact_days);
      patch.impact_days = Number.isFinite(n) ? n : null;
    }
    if (hasOwn(body, "impact_scope")) patch.impact_scope = clamp(safeStr(body.impact_scope), 2000);

    if (hasOwn(body, "tags")) patch.tags = asTags(body.tags);

    // compute/refresh AI (best-effort)
    try {
      const computed = computeChangeAIFields({ ...existing, ...patch });
      if (computed && typeof computed === "object") {
        if (hasOwn(computed, "ai_rollup")) patch.ai_rollup = (computed as any).ai_rollup;
      }
    } catch {
      // ignore
    }

    if (!Object.keys(patch).length) {
      return ok({ item: existing });
    }

    const { data: updated, error: upErr } = await supabase
      .from(TABLE)
      .update(patch)
      .eq("id", existing.id)
      .select("*")
      .maybeSingle();

    if (upErr) return err(upErr.message || "Failed to update change", { status: 500, code: "db_error" });
    if (!updated) return err("Failed to update change", { status: 500, code: "db_error" });

    // audit (best-effort)
    try {
      await logChangeEvent(supabase, {
        projectId: existing.project_id,
        changeRequestId: existing.id,
        actorUserId: user.id,
        actorRole: role,
        eventType: "edited",
        fromValue: null,
        toValue: null,
        note: "Change updated",
        payload: { patch_keys: Object.keys(patch) },
      });
    } catch {
      // ignore
    }

    // approvals progress (best-effort)
    const approvals = await getApprovalProgressForArtifact({
      supabase,
      artifactId: existing.id,
      actorUserId: user.id,
    }).catch(() => null);

    return ok({ item: updated, approvals });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return err(msg, { status, code: status === 401 ? "unauthorized" : "server_error" });
  }
}

/* =========================
   PATCH (explicit)
========================= */

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    return await POST(req, ctx);
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return err(msg, { status, code: status === 401 ? "unauthorized" : "server_error" });
  }
}

/* =========================
   DELETE
========================= */

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const supabase = await sb();
    const user = await requireUser(supabase);

    const id = await pickId(req, ctx, null);
    if (!id) return err("Missing id", { status: 400, code: "missing_id" });

    const { data: existing, error: exErr } = await supabase
      .from(TABLE)
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (exErr) {
      if (isMissingRelation(exErr.message)) {
        return err("Database table missing: change_requests", {
          status: 500,
          code: "missing_relation",
          extra: { table: TABLE },
        });
      }
      return err(exErr.message || "Failed to load change", { status: 500, code: "db_error" });
    }
    if (!existing) return err("Not found", { status: 404, code: "not_found" });

    const role = await requireProjectRole(supabase, existing.project_id, user.id);
    if (!role) return err("Forbidden", { status: 403, code: "forbidden" });
    if (!canEdit(role)) return err("Forbidden", { status: 403, code: "forbidden" });

    const hasDeletedAt = hasOwn(existing, "deleted_at");

    if (hasDeletedAt) {
      const { data: deleted, error: delErr } = await supabase
        .from(TABLE)
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", existing.id)
        .select("*")
        .maybeSingle();

      if (delErr) return err(delErr.message || "Failed to delete change", { status: 500, code: "db_error" });

      try {
        await logChangeEvent(supabase, {
          projectId: existing.project_id,
          changeRequestId: existing.id,
          actorUserId: user.id,
          actorRole: role,
          eventType: "deleted",
          note: "Change deleted",
          payload: {},
        });
      } catch {}

      return ok({ id: existing.id, deleted: true, item: deleted ?? null });
    }

    const { error: hardErr } = await supabase.from(TABLE).delete().eq("id", existing.id);
    if (hardErr) return err(hardErr.message || "Failed to delete change", { status: 500, code: "db_error" });

    try {
      await logChangeEvent(supabase, {
        projectId: existing.project_id,
        changeRequestId: existing.id,
        actorUserId: user.id,
        actorRole: role,
        eventType: "deleted",
        note: "Change deleted",
        payload: {},
      });
    } catch {}

    return ok({ id: existing.id, deleted: true });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return err(msg, { status, code: status === 401 ? "unauthorized" : "server_error" });
  }
}