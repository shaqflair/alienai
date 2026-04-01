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
import { ensureDedicatedArtifactIdForChangeRequest } from "@/lib/change/resolveDedicatedChangeArtifact";
import { computeChangeAIFields } from "@/lib/change/ai-compute";
import { notifyChangeChangesRequested } from "@/lib/server/notifications/approval-notifications";

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

async function resolveOrganisationIdForProject(
  supabase: any,
  projectId: string
): Promise<string | null> {
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

async function resolveActorName(
  supabase: any,
  userId: string,
  fallbackEmail?: string | null
) {
  try {
    const { data } = await supabase
      .from("profiles")
      .select("full_name, name, email")
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

async function loadProjectForNotification(supabase: any, projectId: string) {
  try {
    const { data } = await supabase
      .from("projects")
      .select("id, title, project_code")
      .eq("id", projectId)
      .maybeSingle();
    return data ?? { id: projectId, title: "Project", project_code: null };
  } catch {
    return { id: projectId, title: "Project", project_code: null };
  }
}

async function loadChangeNotificationContext(supabase: any, changeId: string) {
  try {
    const { data } = await supabase
      .from("change_requests")
      .select("id, title, requester_id")
      .eq("id", changeId)
      .maybeSingle();

    return {
      title: safeStr((data as any)?.title).trim() || "Change Request",
      requesterUserId: safeStr((data as any)?.requester_id).trim() || null,
      changeType: "Change Request",
    };
  } catch {
    return {
      title: "Change Request",
      requesterUserId: null,
      changeType: "Change Request",
    };
  }
}

async function syncArtifactReworkState(
  supabase: any,
  args: {
    artifactId: string;
    chainId: string;
    actorUserId: string;
    nowIso: string;
  }
) {
  const patch1: any = {
    approval_chain_id: args.chainId,
    approval_status: "changes_requested",
    status: "draft",
    is_locked: false,
    rejected_at: null,
    rejected_by: null,
    approved_at: null,
    approved_by: null,
    updated_at: args.nowIso,
  };

  const first = await supabase.from("artifacts").update(patch1).eq("id", args.artifactId);
  if (!first.error) return;

  const patch2: any = {
    approval_chain_id: args.chainId,
    approval_status: "changes_requested",
    is_locked: false,
    updated_at: args.nowIso,
  };

  const second = await supabase.from("artifacts").update(patch2).eq("id", args.artifactId);
  if (second.error) {
    throw new Error(`artifacts rework patch failed: ${second.error.message}`);
  }
}

async function closeReworkApprovalChainIfPossible(
  supabase: any,
  args: { chainId: string; nowIso: string }
) {
  const patch1: any = {
    status: "changes_requested",
    is_active: false,
    updated_at: args.nowIso,
  };

  const first = await supabase.from("approval_chains").update(patch1).eq("id", args.chainId);
  if (!first.error) return;

  const patch2: any = {
    status: "changes_requested",
    is_active: false,
  };

  const second = await supabase.from("approval_chains").update(patch2).eq("id", args.chainId);
  if (second.error) {
    throw new Error(`approval_chains rework patch failed: ${second.error.message}`);
  }
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

    let cr: any = null;
    let deliveryStatusMissing = false;

    const firstLoad = await supabase
      .from("change_requests")
      .select("id, project_id, status, decision_status, delivery_status, artifact_id, title")
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
          .select("id, project_id, status, decision_status, artifact_id, title")
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

    if (decisionStatus === "rework") {
      return jsonOk({ item: cr, data: cr, already: "rework" });
    }

    if (decisionStatus === "approved") {
      return jsonErr("Cannot request changes from an approved change request.", 409);
    }

    if (decisionStatus === "rejected") {
      return jsonErr("Cannot request changes from a rejected change request.", 409);
    }

    if (decisionStatus !== "submitted") {
      return jsonErr(
        `Cannot request changes when decision_status=${decisionStatus || "(null)"}`,
        409
      );
    }

    if (!deliveryStatusMissing && fromLane && fromLane !== "review") {
      return jsonErr(
        `Only changes in Review can be sent back for rework (current lane=${fromLane}).`,
        409
      );
    }

    const artifactId = await ensureDedicatedArtifactIdForChangeRequest(supabase, cr);
    if (!artifactId) {
      return jsonErr(
        "Missing dedicated artifact_id for this change request. Ensure submit created/linked a per-change artifact.",
        409
      );
    }

    const organisationId = await resolveOrganisationIdForProject(supabase, projectId);
    const actorEmail = safeStr((user as any)?.email ?? "").trim() || null;
    const actorName = await resolveActorName(supabase, user.id, actorEmail);

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

    await recordArtifactApprovalDecision({
      supabase,
      chainId: pending.chainId,
      stepId: pending.stepId,
      approverUserId: effectiveApproverUserId,
      actorUserId: user.id,
      decision: "changes_requested",
      reason: note || null,
    });

    const state = await recomputeApprovalState({
      supabase,
      artifactId,
      chainId: pending.chainId,
      stepId: pending.stepId,
    });

    const now = new Date().toISOString();
    const toLane = "analysis";

    await insertApprovalEvent(supabase, {
      organisation_id: organisationId,
      project_id: projectId,
      artifact_id: artifactId,
      change_id: id,
      step_id: pending.stepId,
      action_type: "requested_changes_step",
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

    await closeReworkApprovalChainIfPossible(supabase, {
      chainId: pending.chainId,
      nowIso: now,
    });

    await syncArtifactReworkState(supabase, {
      artifactId,
      chainId: pending.chainId,
      actorUserId: effectiveApproverUserId,
      nowIso: now,
    });

    const patchBase: any = {
      status: "analysis",
      decision_status: "rework",
      decision_rationale: note || null,
      decision_by: effectiveApproverUserId,
      decision_at: now,
      decision_role: onBehalfOf ? "delegate_final" : "chain_final",
      delivery_status: toLane,
      updated_at: now,
      artifact_id: artifactId,
    };

    let patch: any = { ...patchBase, approver_id: effectiveApproverUserId, approval_date: now };

    const first = await supabase
      .from("change_requests")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();

    let updatedRow: any = null;

    if (first.error) {
      const msg = safeStr(first.error.message);

      if (hasDeliveryStatusMissingColumn(msg)) delete patch.delivery_status;
      if (hasArtifactIdMissingColumn(msg)) delete patch.artifact_id;
      if (hasMissingColumn(msg, "approver_id")) delete patch.approver_id;
      if (hasMissingColumn(msg, "approval_date")) delete patch.approval_date;
      if (hasMissingColumn(msg, "decision_role")) delete patch.decision_role;
      if (hasMissingColumn(msg, "decision_rationale")) delete patch.decision_rationale;
      if (hasMissingColumn(msg, "decision_by")) delete patch.decision_by;
      if (hasMissingColumn(msg, "decision_at")) delete patch.decision_at;

      const second = await supabase
        .from("change_requests")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();

      if (second.error) throw second.error;

      updatedRow = second.data;
    } else {
      updatedRow = first.data;
    }

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
            from_lane: deliveryStatusMissing ? null : fromLane,
            to_lane: "delivery_status" in patch ? toLane : null,
            delivery_status_missing: !("delivery_status" in patch),
            artifact_id_missing: !("artifact_id" in patch),
            chain_id: pending.chainId,
            step_id: pending.stepId,
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
        artifact_id: artifactId,
        chain_id: pending.chainId,
        step_id: pending.stepId,
        lifecycle: { from: lifecycle || null, to: "analysis" },
        decision_status: { from: "submitted", to: "rework" },
        to_lane: "delivery_status" in patch ? toLane : null,
        at: now,
        request_id: requestId,
      },
    });

    await insertApprovalEvent(supabase, {
      organisation_id: organisationId,
      project_id: projectId,
      artifact_id: artifactId,
      change_id: id,
      step_id: pending.stepId,
      action_type: "requested_changes_final",
      actor_user_id: user.id,
      actor_name: actorName,
      actor_role: onBehalfOf ? "delegate_final" : safeStr(role),
      comment: note || null,
      meta: {
        at: now,
        request_id: requestId,
        chain_id: pending.chainId,
        step_id: pending.stepId,
        lifecycle: { from: lifecycle || null, to: "analysis" },
        decision_status: { from: "submitted", to: "rework" },
        from_lane: deliveryStatusMissing ? null : fromLane,
        to_lane: "delivery_status" in patch ? toLane : null,
        delivery_status_missing: !("delivery_status" in patch),
        artifact_id_missing: !("artifact_id" in patch),
        delegated_for: onBehalfOf || null,
        effective_approver: effectiveApproverUserId,
        source: "request_changes_route",
      },
    });

    try {
      const projectForNotification = await loadProjectForNotification(supabase, projectId);
      const changeForNotification = await loadChangeNotificationContext(supabase, id);

      if (changeForNotification.requesterUserId) {
        await notifyChangeChangesRequested(supabase, {
          changeId: id,
          changeTitle: changeForNotification.title,
          changeType: changeForNotification.changeType,
          changeAuthorUserId: changeForNotification.requesterUserId,
          project: projectForNotification,
          projectFallbackRef: projectId,
          requestedByName: actorName ?? actorEmail ?? null,
          reason: note || null,
          projectId,
        });
      }
    } catch (notifyErr) {
      console.error("[POST /api/change/:id/request-changes] notification failed:", notifyErr);
    }

    try {
      const computed = await computeChangeAIFields({
        supabase,
        projectId,
        changeRow: updatedRow,
      });

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
        chain_id: pending.chainId,
        request_id: requestId,
      },
    });

    return jsonOk({
      item: updatedRow,
      data: updatedRow,
      artifact_id: artifactId,
    });
  } catch (e: any) {
    console.error("[POST /api/change/:id/request-changes]", e);
    const msg = safeStr(e?.message) || "Unexpected error";
    const status =
      msg === "Unauthorized"
        ? 401
        : msg === "Forbidden"
          ? 403
          : msg === "Approval engine not available"
            ? 409
            : msg === "No pending approval step found."
              ? 409
              : 500;
    return jsonErr(msg, status);
  }
}