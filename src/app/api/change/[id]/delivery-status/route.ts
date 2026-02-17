// src/app/api/change/[id]/delivery-status/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import {
  sb,
  requireUser,
  requireProjectRole,
  canEdit,
  safeStr,
  logChangeEvent,
} from "@/lib/change/server-helpers";

export const runtime = "nodejs";
const TABLE = "change_requests";

/* =========================
   Types (Next.js 16 params Promise)
========================= */

type RouteCtx = { params: Promise<{ id: string }> };

/* =========================
   Helpers
========================= */

function ok(data: any, init?: ResponseInit) {
  return NextResponse.json({ ok: true, ...data }, init);
}

function err(message: string, init?: (ResponseInit & { extra?: any }) | undefined) {
  const { extra, ...rest } = init || {};
  return NextResponse.json({ ok: false, error: message, ...(extra ? { extra } : {}) }, rest);
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

const ALLOWED_DELIVERY = new Set([
  "intake",
  "analysis",
  "review",
  "in_progress",
  "implemented",
  "closed",
]);

function normalizeDeliveryStatus(x: unknown): string | null {
  const v = safeStr(x).trim().toLowerCase();
  if (!v) return null;
  const norm = v === "in-progress" || v === "in progress" ? "in_progress" : v;
  return ALLOWED_DELIVERY.has(norm) ? norm : null;
}

function containsBlockedGovernanceFields(body: any) {
  // These must never be mutated here
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

  // Submitted: lock
  if (decision === "submitted") return false;

  // Draft/rework/blank: only intake <-> analysis
  if (!decision || decision === "draft" || decision === "rework") {
    const allowed = new Set(["intake", "analysis"]);
    return allowed.has(from) && allowed.has(to);
  }

  // Approved: sequential progression + fix-up analysis -> review
  if (decision === "approved") {
    if (from === "analysis" && to === "review") return true;

    const order = ["review", "in_progress", "implemented", "closed"];
    const iFrom = order.indexOf(from);
    const iTo = order.indexOf(to);
    if (iFrom === -1 || iTo === -1) return false;
    return iTo === iFrom + 1 || iTo === iFrom - 1;
  }

  // Rejected: no delivery moves here (reject route handles it)
  if (decision === "rejected") return false;

  return false;
}

/* =========================
   GET single CR (optional)
========================= */

export async function GET(_req: NextRequest, ctx: RouteCtx) {
  try {
    const { id: rawId } = await ctx.params;
    const id = safeId(rawId);
    if (!id) return err("Missing id", { status: 400 });

    const supabase = await sb();
    const user = await requireUser(supabase);

    const { data: cr, error: crErr } = await supabase
      .from(TABLE)
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (crErr) return err("Failed to fetch change request", { status: 500, extra: crErr });
    if (!cr) return err("Not found", { status: 404 });

    const projectId = String((cr as any).project_id ?? "");
    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return err("Forbidden", { status: 403 });

    return ok({ item: cr, role });
  } catch (e: any) {
    return err(safeStr(e?.message) || "Unexpected error", { status: 500 });
  }
}

/* =========================
   POST: delivery_status ONLY
========================= */

export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const { id: rawId } = await ctx.params;
    const id = safeId(rawId);
    if (!id) return err("Missing id", { status: 400 });

    const supabase = await sb();
    const user = await requireUser(supabase);

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    if (!isObj(body)) body = {};

    // Governance: do not allow decision/governance mutations via this route
    if (containsBlockedGovernanceFields(body)) {
      return err("Governance enforced: use Submit/Approve/Reject/Request-Changes routes.", { status: 409 });
    }

    // Require delivery_status
    const to = normalizeDeliveryStatus(body?.delivery_status);
    if (!to) return err("Invalid or missing delivery_status", { status: 400 });

    // Load CR for auth + transition rules
    const { data: cr, error: crErr } = await supabase
      .from(TABLE)
      .select("id, project_id, decision_status, delivery_status")
      .eq("id", id)
      .maybeSingle();

    if (crErr) return err("Failed to fetch change request", { status: 500, extra: crErr });
    if (!cr) return err("Not found", { status: 404 });

    const projectId = String((cr as any).project_id ?? "");
    const decisionStatus = String((cr as any).decision_status ?? "").toLowerCase();
    const from = normalizeDeliveryStatus((cr as any).delivery_status) || "intake";

    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return err("Forbidden", { status: 403 });
    if (!canEdit(role)) return err("Forbidden", { status: 403 });

    // Lock during submitted
    if (decisionStatus === "submitted") {
      return err("This change is locked awaiting decision. Approve/reject/request changes first.", { status: 409 });
    }

    // Enforce transitions
    if (!canMoveDelivery({ decision: decisionStatus, from, to })) {
      return err("Governance enforced: lane move not allowed for this change state.", { status: 409 });
    }

    const now = new Date().toISOString();

    const { data: updated, error: updErr } = await supabase
      .from(TABLE)
      .update({ delivery_status: to, updated_at: now })
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (updErr) return err("Update failed", { status: 500, extra: updErr });
    if (!updated) return err("Not found", { status: 404 });

    // Audit (best effort)
    try {
      await logChangeEvent(
        supabase,
        {
          projectId,
          changeRequestId: id,
          actorUserId: user.id,
          actorRole: role,
          eventType: "status_changed",
          fromValue: from,
          toValue: to,
          note: "Delivery lane updated",
        } as any
      );
    } catch {}

    // Timeline (best effort)
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
    return err(msg, { status });
  }
}

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  return POST(req, ctx);
}
