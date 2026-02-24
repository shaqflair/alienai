// src/app/api/change/[id]/request-changes/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  sb,
  requireUser,
  requireProjectRole,
  isOwner,
  safeStr,
  logChangeEvent,
} from "@/lib/change/server-helpers";
import { computeChangeAIFields } from "@/lib/change/ai-compute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* =========================================================
   response helpers
========================================================= */

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

/* =========================================================
   helpers
========================================================= */

function hasMissingColumn(errMsg: string, col: string) {
  const m = (errMsg || "").toLowerCase();
  return m.includes("column") && m.includes(col.toLowerCase());
}
function hasDeliveryStatusMissingColumn(errMsg: string) {
  return hasMissingColumn(errMsg, "delivery_status");
}
function hasArtifactIdMissingColumn(errMsg: string) {
  return hasMissingColumn(errMsg, "artifact_id");
}
function isMissingRelation(errMsg: string) {
  const m = (errMsg || "").toLowerCase();
  return m.includes("does not exist") && m.includes("relation");
}

function normalizeLane(v: unknown) {
  const x = safeStr(v).trim().toLowerCase();
  if (!x) return "";
  if (x === "in-progress" || x === "in progress") return "in_progress";
  if (x === "new") return "intake";
  return x;
}

function pickHeader(req: Request, key: string) {
  try {
    return req.headers.get(key) ?? req.headers.get(key.toLowerCase()) ?? "";
  } catch {
    return "";
  }
}

function getRequestId(req: Request) {
  const h =
    safeStr(pickHeader(req, "x-request-id")).trim() ||
    safeStr(pickHeader(req, "x-vercel-id")).trim() ||
    safeStr(pickHeader(req, "x-amzn-trace-id")).trim();
  return h || randomUUID();
}

/** Best-effort: resolve organisation_id for project */
async function resolveOrganisationIdForProject(supabase: any, projectId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("projects")
      .select("organisation_id")
      .eq("id", projectId)
      .maybeSingle();
    if (error) return null;
    const orgId = safeStr(data?.organisation_id).trim();
    return orgId || null;
  } catch {
    return null;
  }
}

/** Best-effort: get a nice actor name for timeline */
async function resolveActorName(supabase: any, userId: string, fallbackEmail?: string | null) {
  try {
    const { data } = await supabase
      .from("profiles")
      .select("full_name, display_name, name, email")
      .eq("id", userId)
      .maybeSingle();

    const n =
      safeStr((data as any)?.full_name).trim() ||
      safeStr((data as any)?.display_name).trim() ||
      safeStr((data as any)?.name).trim();
    if (n) return n;

    const em = safeStr((data as any)?.email).trim() || safeStr(fallbackEmail).trim();
    return em || null;
  } catch {
    const em = safeStr(fallbackEmail).trim();
    return em || null;
  }
}

/**
 * ✅ Approval timeline event into approval_events
 * Best-effort; never blocks.
 */
async function insertApprovalEvent(
  supabase: any,
  row: {
    organisation_id?: string | null;
    project_id: string;
    artifact_id?: string | null;
    change_id?: string | null;
    step_id?: string | null;
    action_type: string;
    actor_user_id?: string | null;
    actor_name?: string | null;
    actor_role?: string | null;
    comment?: string | null;
    meta?: any;
  }
) {
  try {
    const payloadObj = row.meta && typeof row.meta === "object" ? row.meta : {};
    const ins = await supabase.from("approval_events").insert({
      organisation_id: row.organisation_id ?? null,
      project_id: row.project_id,
      artifact_id: row.artifact_id ?? null,
      change_id: row.change_id ?? null,
      step_id: row.step_id ?? null,
      action_type: safeStr(row.action_type).trim() || "unknown",
      actor_user_id: row.actor_user_id ?? null,
      actor_name: row.actor_name ?? null,
      actor_role: row.actor_role ?? null,
      comment: row.comment ?? null,
      meta: payloadObj,
    });

    if (ins?.error) {
      const msg = safeStr(ins.error.message);
      if (!isMissingRelation(msg)) {
        // swallow
      }
    }
  } catch {
    // swallow
  }
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

async function emitAiEvent(req: Request, body: any) {
  try {
    await fetch(new URL("/api/ai/events", req.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
  } catch {
    // swallow
  }
}

async function ensureArtifactIdForChangeRequest(supabase: any, cr: any): Promise<string | null> {
  const current = safeStr(cr?.artifact_id).trim();
  if (current) return current;

  const projectId = safeStr(cr?.project_id).trim();
  if (!projectId) return null;

  const { data, error } = await supabase
    .from("artifacts")
    .select("id, type, is_current, created_at")
    .eq("project_id", projectId)
    .in("type", ["change_requests", "change_request", "change"])
    .order("is_current", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) return null;
  const resolved = Array.isArray(data) && data[0]?.id ? String(data[0].id) : null;
  if (!resolved) return null;

  try {
    await supabase.from("change_requests").update({ artifact_id: resolved }).eq("id", cr.id);
  } catch {}

  return resolved;
}

/**
 * POST /api/change/:id/request-changes
 * Body: { note?: string }
 */
export async function POST(req: Request, ctx: { params: Promise<{ id?: string }> }) {
  try {
    const supabase = await sb();
    const user = await requireUser(supabase);

    const requestId = getRequestId(req);

    const id = safeStr((await ctx.params).id).trim();
    if (!id) return jsonErr("Missing id", 400);

    const body = await req.json().catch(() => ({}));
    const note = safeStr(body?.note).trim().slice(0, 5000);

    // Load CR (delivery_status / artifact_id may not exist)
    let cr: any = null;
    let deliveryStatusMissing = false;

    const firstLoad = await supabase
      .from("change_requests")
      .select("id, project_id, status, decision_status, delivery_status, artifact_id")
      .eq("id", id)
      .maybeSingle();

    if (!firstLoad.error) {
      cr = firstLoad.data;
    } else {
      const msg = safeStr(firstLoad.error.message);
      deliveryStatusMissing = hasDeliveryStatusMissingColumn(msg);
      const needsRetry = deliveryStatusMissing || hasArtifactIdMissingColumn(msg);

      if (needsRetry) {
        const secondLoad = await supabase
          .from("change_requests")
          .select("id, project_id, status, decision_status")
          .eq("id", id)
          .maybeSingle();

        if (secondLoad.error) throw secondLoad.error;
        cr = secondLoad.data;
      } else {
        throw firstLoad.error;
      }
    }

    if (!cr) return jsonErr("Not found", 404);

    const projectId = safeStr(cr?.project_id).trim();
    if (!projectId) return jsonErr("Missing project_id", 500);

    const lifecycle = safeStr(cr?.status).trim().toLowerCase();
    const decisionStatus = safeStr(cr?.decision_status).trim().toLowerCase();
    const fromLane = normalizeLane(cr?.delivery_status) || null;

    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return jsonErr("Forbidden", 403);
    if (!isOwner(role)) return jsonErr("Forbidden", 403);

    // ✅ Idempotent
    if (decisionStatus === "rework") {
      return jsonOk({ item: cr, data: cr, already: "rework" });
    }

    // Only from submitted
    if (decisionStatus !== "submitted") {
      return jsonErr(`Cannot request changes when decision_status=${decisionStatus || "(null)"}`, 409);
    }

    // Lane gate ONLY if lane exists
    if (!deliveryStatusMissing && fromLane && fromLane !== "review") {
      return jsonErr(`Only changes in Review can be sent back for rework (current lane=${fromLane}).`, 409);
    }

    const artifactId = await ensureArtifactIdForChangeRequest(supabase, cr);
    if (!artifactId) {
      return jsonErr("Missing artifact_id (Change Requests artifact). Create/backfill the project artifact first.", 409);
    }

    // best-effort org + actor name for timeline
    const organisationId = await resolveOrganisationIdForProject(supabase, projectId);
    const actorEmail = safeStr((user as any)?.email ?? "").trim() || null;
    const actorName = await resolveActorName(supabase, user.id, actorEmail);

    const now = new Date().toISOString();
    const toLane = "analysis";

    const patchBase: any = {
      status: "analysis",
      decision_status: "rework",
      decision_rationale: note || null,
      decision_by: user.id,
      decision_at: now,
      decision_role: safeStr(role),
      delivery_status: toLane,
      updated_at: now,
    };

    let patch: any = { ...patchBase, approver_id: user.id, approval_date: now };

    const first = await supabase.from("change_requests").update(patch).eq("id", id).select("*").single();

    let updatedRow: any = null;

    if (first.error) {
      const msg = safeStr(first.error.message);

      if (hasDeliveryStatusMissingColumn(msg)) delete patch.delivery_status;
      if (hasMissingColumn(msg, "approver_id")) delete patch.approver_id;
      if (hasMissingColumn(msg, "approval_date")) delete patch.approval_date;
      if (hasMissingColumn(msg, "decision_role")) delete patch.decision_role;
      if (hasMissingColumn(msg, "decision_rationale")) delete patch.decision_rationale;
      if (hasMissingColumn(msg, "decision_by")) delete patch.decision_by;
      if (hasMissingColumn(msg, "decision_at")) delete patch.decision_at;

      const second = await supabase.from("change_requests").update(patch).eq("id", id).select("*").single();
      if (second.error) throw second.error;

      updatedRow = second.data;
    } else {
      updatedRow = first.data;
    }

    // Audit (best effort)
    try {
      await logChangeEvent(
        supabase,
        {
          projectId,
          artifactId,
          changeRequestId: id,
          actorUserId: user.id,
          actorRole: role,
          eventType: "changes_requested",
          fromValue: lifecycle || null,
          toValue: "analysis",
          note: note || null,
          payload: {
            lifecycle: { from: lifecycle || null, to: "analysis" },
            decision_status: { from: "submitted", to: "rework" },
            to_lane: "delivery_status" in patch ? toLane : null,
            delivery_status_missing: !("delivery_status" in patch),
            request_id: requestId,
          },
        } as any
      );
    } catch {}

    await insertTimelineEvent(supabase, {
      project_id: projectId,
      change_id: id,
      event_type: "status_changed",
      from_status: deliveryStatusMissing ? null : fromLane,
      to_status: "delivery_status" in patch ? toLane : null,
      actor_user_id: user.id,
      actor_role: safeStr(role),
      comment: note || null,
      payload: {
        source: "request_changes_route",
        lifecycle: { from: lifecycle || null, to: "analysis" },
        decision_status: { from: "submitted", to: "rework" },
        to_lane: "delivery_status" in patch ? toLane : null,
        at: now,
        request_id: requestId,
      },
    });

    // ✅ Approval timeline (final “requested changes” decision)
    await insertApprovalEvent(supabase, {
      organisation_id: organisationId,
      project_id: projectId,
      artifact_id: artifactId,
      change_id: id,
      step_id: null,
      action_type: "requested_changes_final",
      actor_user_id: user.id,
      actor_name: actorName,
      actor_role: safeStr(role),
      comment: note || null,
      meta: {
        at: now,
        request_id: requestId,
        lifecycle: { from: lifecycle || null, to: "analysis" },
        decision_status: { from: "submitted", to: "rework" },
        from_lane: deliveryStatusMissing ? null : fromLane,
        to_lane: "delivery_status" in patch ? toLane : null,
        delivery_status_missing: !("delivery_status" in patch),
        source: "request_changes_route",
      },
    });

    // AI compute (best-effort)
    try {
      const computed = await computeChangeAIFields({ supabase, projectId, changeRow: updatedRow });
      await supabase
        .from("change_requests")
        .update({
          ai_score: computed.ai_score,
          ai_schedule: computed.ai_schedule,
          ai_cost: computed.ai_cost,
          ai_scope: computed.ai_scope,
          links: computed.links,
        })
        .eq("id", id);
    } catch {}

    await emitAiEvent(req, {
      projectId,
      artifactId,
      eventType: "change_saved",
      severity: "info",
      source: "app",
      payload: {
        target_artifact_type: "change_request",
        change_id: id,
        action: "request_changes",
        decision_status: "rework",
        request_id: requestId,
      },
    });

    return jsonOk({ item: updatedRow, data: updatedRow });
  } catch (e: any) {
    console.error("[POST /api/change/:id/request-changes]", e);
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500;
    return jsonErr(msg, status);
  }
}