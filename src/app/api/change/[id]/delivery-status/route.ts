// src/app/api/change/[id]/delivery-status/route.ts
import "server-only";

import { NextResponse } from "next/server";
import {
  sb,
  requireUser,
  requireProjectRole,
  canEdit,
  safeStr,
  logChangeEvent,
} from "@/lib/change/server-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const TABLE = "change_requests";

/* =========================
   Response helpers
========================= */

function ok(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function err(message: string, status = 400, extra?: any) {
  const res = NextResponse.json({ ok: false, error: message, ...(extra ? { extra } : {}) }, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function safeId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s === "null" || s === "undefined") return null;
  return s;
}

function isObj(v: any) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function hasOwn(obj: any, key: string) {
  return Object.prototype.hasOwnProperty.call(obj ?? {}, key);
}

function hasMissingColumn(errMsg: string, col: string) {
  const m = (errMsg || "").toLowerCase();
  return m.includes("column") && m.includes(col.toLowerCase());
}

const ALLOWED_DELIVERY = new Set(["intake", "analysis", "review", "in_progress", "implemented", "closed"]);

function normalizeDeliveryStatus(x: unknown): string | null {
  const v = safeStr(x).trim().toLowerCase();
  if (!v) return null;
  const norm = v === "in-progress" || v === "in progress" ? "in_progress" : v;
  return ALLOWED_DELIVERY.has(norm) ? norm : null;
}

function containsBlockedGovernanceFields(body: any) {
  const blockedKeys = [
    "status",
    "decision_status",
    "decisionStatus",
    "decision_rationale",
    "decisionRationale",
    "decision_by",
    "decisionBy",
    "decision_at",
    "decisionAt",
    "approved_at",
    "approvedAt",
    "approved_by",
    "approvedBy",
    "rejected_at",
    "rejectedAt",
    "rejected_by",
    "rejectedBy",
  ];
  return blockedKeys.some((k) => hasOwn(body, k));
}

function canMoveDelivery(args: { decision: string; from: string; to: string }) {
  const decision = (args.decision || "").toLowerCase();
  const from = (args.from || "intake").toLowerCase();
  const to = (args.to || "").toLowerCase();

  if (!to || from === to) return true;

  if (decision === "submitted") return false;

  if (!decision || decision === "draft" || decision === "rework") {
    const allowed = new Set(["intake", "analysis"]);
    return allowed.has(from) && allowed.has(to);
  }

  if (decision === "approved") {
    if (from === "analysis" && to === "review") return true;

    const order = ["review", "in_progress", "implemented", "closed"];
    const iFrom = order.indexOf(from);
    const iTo = order.indexOf(to);
    if (iFrom === -1 || iTo === -1) return false;
    return iTo === iFrom + 1 || iTo === iFrom - 1;
  }

  if (decision === "rejected") return false;

  return false;
}

/* =========================
   Context (Next 15+)
========================= */

type Ctx = { params: Promise<{ id?: string }> };

/* =========================
   GET (optional)
========================= */

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const id = safeId((await ctx.params)?.id);
    if (!id) return err("Missing id", 400);

    const supabase = await sb();
    const user = await requireUser(supabase);

    const { data: cr, error: crErr } = await supabase.from(TABLE).select("*").eq("id", id).maybeSingle();

    if (crErr) {
      if (hasMissingColumn(safeStr(crErr.message), "delivery_status")) {
        return err("delivery_status column not available yet on this environment.", 409, { column: "delivery_status" });
      }
      return err("Failed to fetch change request", 500, crErr);
    }
    if (!cr) return err("Not found", 404);

    const projectId = String((cr as any).project_id ?? "");
    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return err("Forbidden", 403);

    return ok({ item: cr, data: cr, role });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return err(msg, status);
  }
}

/* =========================
   POST: delivery_status ONLY
========================= */

export async function POST(req: Request, ctx: Ctx) {
  try {
    const id = safeId((await ctx.params)?.id);
    if (!id) return err("Missing id", 400);

    const supabase = await sb();
    const user = await requireUser(supabase);

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    if (!isObj(body)) body = {};

    if (containsBlockedGovernanceFields(body)) {
      return err("Governance enforced: use Submit/Approve/Reject/Request-Changes routes.", 409);
    }

    const to = normalizeDeliveryStatus(body?.delivery_status);
    if (!to) return err("Invalid or missing delivery_status", 400);

    const { data: cr, error: crErr } = await supabase
      .from(TABLE)
      .select("id, project_id, decision_status, delivery_status")
      .eq("id", id)
      .maybeSingle();

    if (crErr) {
      if (hasMissingColumn(safeStr(crErr.message), "delivery_status")) {
        return err("delivery_status column not available yet on this environment.", 409, { column: "delivery_status" });
      }
      return err("Failed to fetch change request", 500, crErr);
    }
    if (!cr) return err("Not found", 404);

    const projectId = String((cr as any).project_id ?? "");
    const decisionStatus = String((cr as any).decision_status ?? "").toLowerCase();
    const from = normalizeDeliveryStatus((cr as any).delivery_status) || "intake";

    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return err("Forbidden", 403);
    if (!canEdit(role)) return err("Forbidden", 403);

    if (decisionStatus === "submitted") {
      return err("This change is locked awaiting decision. Approve/reject/request changes first.", 409);
    }

    if (!canMoveDelivery({ decision: decisionStatus, from, to })) {
      return err("Governance enforced: lane move not allowed for this change state.", 409);
    }

    const now = new Date().toISOString();

    const { data: updated, error: updErr } = await supabase
      .from(TABLE)
      .update({ delivery_status: to, updated_at: now })
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (updErr) {
      if (hasMissingColumn(safeStr(updErr.message), "delivery_status")) {
        return err("delivery_status column not available yet on this environment.", 409, { column: "delivery_status" });
      }
      return err("Update failed", 500, updErr);
    }
    if (!updated) return err("Not found", 404);

    try {
      await logChangeEvent(
        supabase,
        {
          projectId,
          changeRequestId: id,
          actorUserId: user.id,
          actorRole: role,
          eventType: "lane_moved",
          fromValue: from,
          toValue: to,
          note: "Delivery lane updated",
        } as any
      );
    } catch {}

    try {
      await supabase.from("change_events").insert({
        project_id: projectId,
        change_id: id,
        event_type: "status_changed",
        from_status: from,
        to_status: to,
        actor_user_id: user.id,
        actor_role: String(role ?? ""),
        comment: null,
        payload: { source: "delivery_status_route" },
      });
    } catch {}

    return ok({ item: updated, data: updated, role });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return err(msg, status);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  return POST(req, ctx);
}