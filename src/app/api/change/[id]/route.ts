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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const TABLE = "change_requests";

type Ctx = { params: Promise<{ id: string }> };

/* ── Response helpers ── */
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

/* ── Utils ── */
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
  return x.map((v) => safeStr(v).trim()).filter(Boolean).slice(0, 25);
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

async function pickId(req: Request, ctx: Ctx | undefined, body: any): Promise<string | null> {
  if (ctx?.params) {
    const params = await ctx.params;
    const p = safeStr(params?.id).trim();
    if (!isBadIdString(p)) return p;
  }
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
  } catch {}
  const b = safeStr(body?.id ?? body?.change_id).trim();
  if (!isBadIdString(b)) return b;
  return null;
}

/* ── GET ── */
export async function GET(req: Request, ctx: Ctx) {
  try {
    const supabase = await sb();
    const user = await requireUser(supabase);

    const id = await pickId(req, ctx, null);
    if (!id) return err("Missing id", { status: 400, code: "missing_id" });

    // Single change
    {
      const { data: change, error: chErr } = await supabase
        .from(TABLE).select("*").eq("id", id).maybeSingle();

      if (chErr) {
        if (isMissingRelation(chErr.message)) return err("Database table missing: change_requests", { status: 500, code: "missing_relation", extra: { table: TABLE } });
        return err(chErr.message || "Failed to load change", { status: 500, code: "db_error" });
      }

      if (change) {
        const role = await requireProjectRole(supabase, change.project_id, user.id);
        if (!role) return err("Forbidden", { status: 403, code: "forbidden" });

        const approvals = await getApprovalProgressForArtifact({
          supabase, artifactId: change.id, actorUserId: user.id,
        }).catch(() => null);

        return ok({ mode: "change", item: change, role, approvals });
      }
    }

    // Project scope
    let projectId: string | null = null;
    if (isUuid(id)) {
      projectId = id;
    } else {
      const { data: proj, error: projErr } = await supabase
        .from("projects").select("id, project_code, title").eq("project_code", id).maybeSingle();
      if (projErr) return err(projErr.message || "Failed to resolve project", { status: 500, code: "db_error" });
      projectId = proj?.id ?? null;
    }

    if (!projectId) return err("Not found", { status: 404, code: "not_found" });

    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return err("Forbidden", { status: 403, code: "forbidden" });

    // ✅ No deleted_at filter — column does not exist in schema
    // ✅ No computeChangeAIFields — it's async and breaks sync .map()
    const { data: items, error: itemsErr } = await supabase
      .from(TABLE)
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });

    if (itemsErr) {
      if (isMissingRelation(itemsErr.message)) return err("Database table missing: change_requests", { status: 500, code: "missing_relation", extra: { table: TABLE } });
      return err(itemsErr.message || "Failed to load changes", { status: 500, code: "db_error" });
    }

    return ok({ mode: "project", project_id: projectId, role, can_edit: canEdit(role), items: items ?? [] });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return err(msg, { status, code: status === 401 ? "unauthorized" : "server_error" });
  }
}

/* ── POST / PATCH (update) ── */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const supabase = await sb();
    const user = await requireUser(supabase);

    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }
    if (!isObj(body)) body = {};

    const id = await pickId(req, ctx, body);
    if (!id) return err("Missing id", { status: 400, code: "missing_id" });

    const { data: existing, error: exErr } = await supabase
      .from(TABLE).select("*").eq("id", id).maybeSingle();

    if (exErr) {
      if (isMissingRelation(exErr.message)) return err("Database table missing: change_requests", { status: 500, code: "missing_relation", extra: { table: TABLE } });
      return err(exErr.message || "Failed to load change", { status: 500, code: "db_error" });
    }
    if (!existing) return err("Not found", { status: 404, code: "not_found" });

    const role = await requireProjectRole(supabase, existing.project_id, user.id);
    if (!role) return err("Forbidden", { status: 403, code: "forbidden" });
    if (!canEdit(role)) return err("Forbidden", { status: 403, code: "forbidden" });

    const patch: any = {};

    // ── Core fields ──
    if (hasOwn(body, "title"))
      patch.title = clamp(safeStr(body.title), 140);

    // description / summary — client sends both, accept either
    if (hasOwn(body, "description"))
      patch.description = clamp(safeStr(body.description), 5000);
    else if (hasOwn(body, "summary"))
      patch.description = clamp(safeStr(body.summary), 5000);

    if (hasOwn(body, "priority"))
      patch.priority = normalizePriorityToDb(body.priority);

    if (hasOwn(body, "tags"))
      patch.tags = asTags(body.tags);

    // ── Requester ── client sends requester_name
    if (hasOwn(body, "requester_name"))
      patch.requester_name = clamp(safeStr(body.requester_name), 160);
    else if (hasOwn(body, "requester"))
      patch.requester_name = clamp(safeStr(body.requester), 160);

    // ── Proposed change / justification fields ──
    if (hasOwn(body, "proposedChange"))
      patch.proposed_change = clamp(safeStr(body.proposedChange), 8000);
    else if (hasOwn(body, "proposed_change"))
      patch.proposed_change = clamp(safeStr(body.proposed_change), 8000);

    // Individual breakdown fields
    const breakdown = ["justification", "financial", "schedule", "risks", "dependencies",
                       "assumptions", "implementation_plan", "rollback_plan"] as const;
    for (const field of breakdown) {
      const camel: Record<string, string> = {
        implementation_plan: "implementationPlan",
        rollback_plan: "rollbackPlan",
      };
      const clientKey = camel[field] ?? field;
      if (hasOwn(body, clientKey))
        patch[field] = clamp(safeStr(body[clientKey]), 4000);
      else if (hasOwn(body, field))
        patch[field] = clamp(safeStr(body[field]), 4000);
    }

    // ── Impact analysis ──
    // ai_cost and ai_schedule are integer columns in the schema.
    // The risk descriptor text is stored only inside the impact_analysis JSONB blob.
    const ia = body.impactAnalysis ?? body.impact_analysis ?? null;
    if (isObj(ia)) {
      const days = Number(ia.days ?? 0);
      const cost = Number(ia.cost ?? 0);
      const risk = clamp(safeStr(ia.risk ?? "None identified"), 280);

      if (Number.isFinite(days)) patch.ai_schedule = days;
      if (Number.isFinite(cost)) patch.ai_cost = cost;

      patch.impact_analysis = { days, cost, risk, highlights: ia.highlights ?? [] };
    } else {
      if (hasOwn(body, "impact_cost") || hasOwn(body, "ai_cost")) {
        const n = Number(body.ai_cost ?? body.impact_cost);
        if (Number.isFinite(n)) patch.ai_cost = n;
      }
      if (hasOwn(body, "impact_days") || hasOwn(body, "ai_schedule")) {
        const n = Number(body.ai_schedule ?? body.impact_days);
        if (Number.isFinite(n)) patch.ai_schedule = n;
      }
    }

    // ── Status / stage ──
    if (hasOwn(body, "stage")) {
      const st = normalizeDeliveryStatus(body.stage);
      if (st) patch.stage = st;
    }
    if (hasOwn(body, "delivery_status")) {
      const st = normalizeDeliveryStatus(body.delivery_status);
      if (st) patch.delivery_status = st;
    }
    if (hasOwn(body, "status")) {
      const s = safeStr(body.status).trim();
      if (s) patch.status = clamp(s, 60);
    }

    // ── Owner ──
    if (hasOwn(body, "owner_id"))    patch.owner_id    = safeStr(body.owner_id) || null;
    if (hasOwn(body, "owner_label")) patch.owner_label = clamp(safeStr(body.owner_label), 120);

    // If nothing changed, return existing
    if (!Object.keys(patch).length) return ok({ item: existing });

    let updated: any = null;
    let upErr: any = null;

    ({ data: updated, error: upErr } = await supabase
      .from(TABLE).update(patch).eq("id", existing.id).select("*").maybeSingle());

    // If a column doesn't exist, strip it and retry once
    if (upErr) {
      const msg = safeStr(upErr.message).toLowerCase();
      const colMatch = msg.match(/column ["']?(\w+)["']? of relation/);
      if (colMatch?.[1]) {
        const badCol = colMatch[1];
        const fallbackPatch = { ...patch };
        delete fallbackPatch[badCol];

        if (Object.keys(fallbackPatch).length) {
          ({ data: updated, error: upErr } = await supabase
            .from(TABLE).update(fallbackPatch).eq("id", existing.id).select("*").maybeSingle());
        }
      }
    }

    if (upErr) return err(upErr.message || "Failed to update change", { status: 500, code: "db_error" });
    if (!updated) return err("Failed to update change", { status: 500, code: "db_error" });

    // Audit (best-effort)
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
    } catch {}

    const approvals = await getApprovalProgressForArtifact({
      supabase, artifactId: existing.id, actorUserId: user.id,
    }).catch(() => null);

    return ok({ item: updated, approvals });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return err(msg, { status, code: status === 401 ? "unauthorized" : "server_error" });
  }
}

/* ── PATCH (explicit — delegates to POST) ── */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    return await POST(req, ctx);
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return err(msg, { status, code: status === 401 ? "unauthorized" : "server_error" });
  }
}

/* ── DELETE ── */
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const supabase = await sb();
    const user = await requireUser(supabase);

    const id = await pickId(req, ctx, null);
    if (!id) return err("Missing id", { status: 400, code: "missing_id" });

    const { data: existing, error: exErr } = await supabase
      .from(TABLE).select("*").eq("id", id).maybeSingle();

    if (exErr) {
      if (isMissingRelation(exErr.message)) return err("Database table missing: change_requests", { status: 500, code: "missing_relation", extra: { table: TABLE } });
      return err(exErr.message || "Failed to load change", { status: 500, code: "db_error" });
    }
    if (!existing) return err("Not found", { status: 404, code: "not_found" });

    const role = await requireProjectRole(supabase, existing.project_id, user.id);
    if (!role) return err("Forbidden", { status: 403, code: "forbidden" });
    if (!canEdit(role)) return err("Forbidden", { status: 403, code: "forbidden" });

    // ✅ Hard delete only — deleted_at column does not exist in schema
    const { error: hardErr } = await supabase.from(TABLE).delete().eq("id", existing.id);
    if (hardErr) return err(hardErr.message || "Failed to delete change", { status: 500, code: "db_error" });

    try {
      await logChangeEvent(supabase, {
        projectId: existing.project_id, changeRequestId: existing.id,
        actorUserId: user.id, actorRole: role, eventType: "deleted",
        note: "Change deleted", payload: {},
      });
    } catch {}

    return ok({ id: existing.id, deleted: true });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return err(msg, { status, code: status === 401 ? "unauthorized" : "server_error" });
  }
}