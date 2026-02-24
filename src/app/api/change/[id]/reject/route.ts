// src/app/api/change/[id]/reject/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  sb,
  requireUser,
  requireProjectRole,
  safeStr,
  logChangeEvent,
  requireApproverForPendingArtifactStep,
  recordArtifactApprovalDecision,
  recomputeApprovalState,
} from "@/lib/change/server-helpers";

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

function getIp(req: Request): string | null {
  const fwd = safeStr(pickHeader(req, "x-forwarded-for")).trim();
  if (fwd) return fwd.split(",")[0]?.trim() || null;
  const real = safeStr(pickHeader(req, "x-real-ip")).trim();
  return real || null;
}

function getUserAgent(req: Request): string | null {
  const ua = safeStr(pickHeader(req, "user-agent")).trim();
  return ua || null;
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

async function logApprovalAudit(
  supabase: any,
  req: Request,
  row: {
    project_id: string;
    artifact_id?: string | null;
    step_id?: string | null;
    chain_id?: string | null;
    actor_user_id?: string | null;
    actor_email?: string | null;
    action: string;
    decision?: string | null;
    comment?: string | null;
    source?: string | null;
    request_id?: string | null;
    payload?: any;
  }
) {
  try {
    const payloadObj = row.payload && typeof row.payload === "object" ? row.payload : {};
    const requestId = safeStr(row.request_id).trim() || getRequestId(req);

    const ins = await supabase.from("approval_audit_log").insert({
      project_id: row.project_id,
      artifact_id: row.artifact_id ?? null,
      step_id: row.step_id ?? null,
      chain_id: row.chain_id ?? null,
      actor_user_id: row.actor_user_id ?? null,
      actor_email: row.actor_email ?? null,
      action: safeStr(row.action).trim() || "unknown",
      decision: row.decision ?? null,
      comment: row.comment ?? null,
      source: row.source ?? null,
      request_id: requestId,
      user_agent: getUserAgent(req),
      ip: getIp(req),
      payload: payloadObj,
    });

    if (ins?.error) {
      const msg = safeStr(ins.error.message);
      if (!isMissingRelation(msg)) {
        // swallow anyway (audit must never block)
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
    const ins = await supabase.from("change_events").insert({
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

    if (ins.error && !isMissingRelation(safeStr(ins.error.message))) {
      // best-effort: swallow
    }
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
  } catch {
    // ignore
  }

  return resolved;
}

/* =========================================================
   Route
========================================================= */

export async function POST(req: Request, ctx: { params: Promise<{ id?: string }> }) {
  try {
    const id = safeStr((await ctx.params).id).trim();
    if (!id) return jsonErr("Missing id", 400);

    const supabase = await sb();
    const user = await requireUser(supabase);

    const requestId = getRequestId(req);

    const body = await req.json().catch(() => ({}));
    const rawNote = safeStr(body?.note).trim();
    const note = rawNote ? rawNote.slice(0, 5000) : "";

    // Load row safely (delivery_status may not exist)
    let cr: any = null;
    let deliveryStatusMissing = false;

    const firstLoad = await supabase
      .from("change_requests")
      .select("id, project_id, status, delivery_status, decision_status, artifact_id")
      .eq("id", id)
      .maybeSingle();

    if (!firstLoad.error) {
      cr = firstLoad.data;
    } else {
      const msg = safeStr(firstLoad.error.message);
      deliveryStatusMissing = hasDeliveryStatusMissingColumn(msg);

      if (deliveryStatusMissing) {
        const secondLoad = await supabase
          .from("change_requests")
          .select("id, project_id, status, decision_status, artifact_id")
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

    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return jsonErr("Forbidden", 403);

    // best-effort org + actor name for timeline
    const organisationId = await resolveOrganisationIdForProject(supabase, projectId);
    const actorEmail = safeStr((user as any)?.email ?? "").trim() || null;
    const actorName = await resolveActorName(supabase, user.id, actorEmail);

    const govStatus = safeStr(cr?.status).trim().toLowerCase();
    const fromLane = normalizeLane(cr?.delivery_status) || null;
    const decisionStatus = safeStr(cr?.decision_status).trim().toLowerCase();

    // Idempotent
    if (decisionStatus === "rejected" || govStatus === "rejected") {
      return jsonOk({ item: cr, data: cr, already: "rejected" });
    }
    if (decisionStatus === "approved" || govStatus === "approved" || govStatus === "in_progress") {
      return jsonErr("Cannot reject an approved change request.", 409);
    }

    if (decisionStatus !== "submitted") {
      return jsonErr(
        `Cannot reject unless decision_status=submitted (current=${decisionStatus || "blank"})`,
        409
      );
    }

    // strict lane gate if delivery_status column exists
    if (!deliveryStatusMissing && fromLane && fromLane !== "review") {
      return jsonErr(`Only changes in Review can be rejected (current lane=${fromLane}).`, 409);
    }

    const artifactId = await ensureArtifactIdForChangeRequest(supabase, cr);
    if (!artifactId) {
      return jsonErr(
        "Missing artifact_id for this change request. Ensure submit created/linked an artifact.",
        409
      );
    }

    // Approver check + pending step
    let pending: any;
    let onBehalfOf: string | null = null;

    try {
      const res = await requireApproverForPendingArtifactStep({
        supabase,
        artifactId,
        actorUserId: user.id,
      });
      pending = res.pending;
      onBehalfOf = res.onBehalfOf;
    } catch (e: any) {
      const msg = safeStr(e?.message);
      if (msg === "Approval engine not available") return jsonErr(msg, 409);
      if (msg === "No pending approval step found.") return jsonErr(msg, 409);
      if (msg === "Forbidden") return jsonErr("Forbidden", 403);
      throw e;
    }

    const effectiveApproverUserId = onBehalfOf ?? user.id;
    const actorRoleLabel = onBehalfOf ? "delegate_approver" : "approver";

    // Record rejected decision (idempotent)
    await recordArtifactApprovalDecision({
      supabase,
      chainId: pending.chainId,
      stepId: pending.stepId,
      approverUserId: effectiveApproverUserId,
      actorUserId: user.id,
      decision: "rejected",
      reason: note || null,
    });

    // Recompute
    const state = await recomputeApprovalState({
      supabase,
      artifactId,
      chainId: pending.chainId,
      stepId: pending.stepId,
    });

    const now = new Date().toISOString();
    const toLane = "analysis";

    // --- AUDIT: step rejected ---
    await logApprovalAudit(supabase, req, {
      request_id: requestId,
      project_id: projectId,
      artifact_id: artifactId,
      step_id: pending.stepId,
      chain_id: pending.chainId,
      actor_user_id: user.id,
      actor_email: actorEmail,
      action: "rejected_step",
      decision: "rejected",
      comment: note || null,
      source: "reject_route",
      payload: {
        at: now,
        change_id: id,
        delegated_for: onBehalfOf || null,
        effective_approver: effectiveApproverUserId,
        step: {
          id: pending.stepId,
          order: pending.stepOrder ?? null,
          name: pending.stepName ?? null,
        },
        chain_status: state.chainStatus,
        step_status: state.stepStatus,
      },
    });

    // --- TIMELINE: rejected step ---
    await insertApprovalEvent(supabase, {
      organisation_id: organisationId,
      project_id: projectId,
      artifact_id: artifactId,
      change_id: id,
      step_id: pending.stepId,
      action_type: "rejected_step",
      actor_user_id: user.id,
      actor_name: actorName,
      actor_role: actorRoleLabel,
      comment: note || null,
      meta: {
        at: now,
        request_id: requestId,
        chain_id: pending.chainId,
        step: {
          id: pending.stepId,
          order: pending.stepOrder ?? null,
          name: pending.stepName ?? null,
        },
        delegated_for: onBehalfOf || null,
        effective_approver: effectiveApproverUserId,
        chain_status: state.chainStatus,
        step_status: state.stepStatus,
      },
    });

    const patchBase: any = {
      status: "rejected",
      decision_status: "rejected",
      decision_rationale: note || null,

      decision_by: effectiveApproverUserId,
      decision_at: now,
      decision_role: onBehalfOf ? "delegate_final" : "chain_final",

      delivery_status: toLane,
      updated_at: now,
    };

    // legacy columns (compat)
    let patch: any = { ...patchBase, approver_id: effectiveApproverUserId, approval_date: now };

    const first = await supabase.from("change_requests").update(patch).eq("id", id).select("*").single();

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

      try {
        await logChangeEvent(supabase, {
          projectId,
          changeRequestId: id,
          actorUserId: user.id,
          actorRole: patch.decision_role,
          eventType: "rejected",
          fromValue: "submitted",
          toValue: "rejected",
          note: note || null,
          payload: {
            chain_id: pending.chainId,
            step_id: pending.stepId,
            delegated_for: onBehalfOf || null,
            to_lane: toLane,
            chain_status: state.chainStatus,
            effective_approver: effectiveApproverUserId,
            delivery_status_missing: !("delivery_status" in patch),
            request_id: requestId,
          },
        } as any);
      } catch {}

      await insertTimelineEvent(supabase, {
        project_id: projectId,
        change_id: id,
        event_type: "status_changed",
        from_status: fromLane,
        to_status: "delivery_status" in patch ? toLane : null,
        actor_user_id: user.id,
        actor_role: patch.decision_role,
        comment: note || null,
        payload: {
          source: "reject_route",
          chain_id: pending.chainId,
          decision_status: "rejected",
          at: now,
          request_id: requestId,
        },
      });

      // --- AUDIT: final rejected ---
      await logApprovalAudit(supabase, req, {
        request_id: requestId,
        project_id: projectId,
        artifact_id: artifactId,
        step_id: pending.stepId,
        chain_id: pending.chainId,
        actor_user_id: user.id,
        actor_email: actorEmail,
        action: "rejected_final",
        decision: "rejected",
        comment: note || null,
        source: "reject_route",
        payload: {
          at: now,
          change_id: id,
          delegated_for: onBehalfOf || null,
          effective_approver: effectiveApproverUserId,
          delivery_status: "delivery_status" in patch ? toLane : null,
          chain_id: pending.chainId,
          step_id: pending.stepId,
        },
      });

      // --- TIMELINE: final rejected ---
      await insertApprovalEvent(supabase, {
        organisation_id: organisationId,
        project_id: projectId,
        artifact_id: artifactId,
        change_id: id,
        step_id: pending.stepId,
        action_type: "rejected_final",
        actor_user_id: user.id,
        actor_name: actorName,
        actor_role: safeStr(patch?.decision_role).trim() || (onBehalfOf ? "delegate_final" : "chain_final"),
        comment: note || null,
        meta: {
          at: now,
          request_id: requestId,
          chain_id: pending.chainId,
          step_id: pending.stepId,
          delegated_for: onBehalfOf || null,
          effective_approver: effectiveApproverUserId,
          delivery_status: "delivery_status" in patch ? toLane : null,
          decision_status: "rejected",
        },
      });

      await emitAiEvent(req, {
        projectId,
        artifactId,
        eventType: "change_saved",
        severity: "info",
        source: "app",
        payload: {
          target_artifact_type: "change_request",
          change_id: id,
          action: "rejected_final",
          decision_status: "rejected",
          chain_id: pending.chainId,
          request_id: requestId,
        },
      });

      return jsonOk({ item: second.data, data: second.data });
    }

    try {
      await logChangeEvent(supabase, {
        projectId,
        changeRequestId: id,
        actorUserId: user.id,
        actorRole: patch.decision_role,
        eventType: "rejected",
        fromValue: "submitted",
        toValue: "rejected",
        note: note || null,
        payload: {
          chain_id: pending.chainId,
          step_id: pending.stepId,
          delegated_for: onBehalfOf || null,
          to_lane: toLane,
          chain_status: state.chainStatus,
          effective_approver: effectiveApproverUserId,
          request_id: requestId,
        },
      } as any);
    } catch {}

    await insertTimelineEvent(supabase, {
      project_id: projectId,
      change_id: id,
      event_type: "status_changed",
      from_status: fromLane,
      to_status: toLane,
      actor_user_id: user.id,
      actor_role: patch.decision_role,
      comment: note || null,
      payload: {
        source: "reject_route",
        chain_id: pending.chainId,
        decision_status: "rejected",
        at: now,
        request_id: requestId,
      },
    });

    // --- AUDIT: final rejected ---
    await logApprovalAudit(supabase, req, {
      request_id: requestId,
      project_id: projectId,
      artifact_id: artifactId,
      step_id: pending.stepId,
      chain_id: pending.chainId,
      actor_user_id: user.id,
      actor_email: actorEmail,
      action: "rejected_final",
      decision: "rejected",
      comment: note || null,
      source: "reject_route",
      payload: {
        at: now,
        change_id: id,
        delegated_for: onBehalfOf || null,
        effective_approver: effectiveApproverUserId,
        delivery_status: toLane,
        chain_id: pending.chainId,
        step_id: pending.stepId,
      },
    });

    // --- TIMELINE: final rejected ---
    await insertApprovalEvent(supabase, {
      organisation_id: organisationId,
      project_id: projectId,
      artifact_id: artifactId,
      change_id: id,
      step_id: pending.stepId,
      action_type: "rejected_final",
      actor_user_id: user.id,
      actor_name: actorName,
      actor_role: safeStr(patch?.decision_role).trim() || (onBehalfOf ? "delegate_final" : "chain_final"),
      comment: note || null,
      meta: {
        at: now,
        request_id: requestId,
        chain_id: pending.chainId,
        step_id: pending.stepId,
        delegated_for: onBehalfOf || null,
        effective_approver: effectiveApproverUserId,
        delivery_status: toLane,
        decision_status: "rejected",
      },
    });

    await emitAiEvent(req, {
      projectId,
      artifactId,
      eventType: "change_saved",
      severity: "info",
      source: "app",
      payload: {
        target_artifact_type: "change_request",
        change_id: id,
        action: "rejected_final",
        decision_status: "rejected",
        chain_id: pending.chainId,
        request_id: requestId,
      },
    });

    return jsonOk({ item: first.data, data: first.data });
  } catch (e: any) {
    console.error("[POST /api/change/:id/reject]", e);
    const msg = safeStr(e?.message) || "Unexpected error";

    const status =
      msg === "Unauthorized"
        ? 401
        : msg === "Forbidden"
          ? 403
          : msg === "Not found"
            ? 404
            : msg === "Approval engine not available"
              ? 409
              : msg === "No pending approval step found."
                ? 409
                : 500;

    return jsonErr(msg, status);
  }
}