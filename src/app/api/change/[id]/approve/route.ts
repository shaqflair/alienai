// src/app/api/change/[id]/approve/route.ts
import "server-only";

import { NextResponse, type NextRequest } from "next/server";
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

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await ctx.params;
    const id = safeStr(rawId).trim();
    if (!id) return jsonErr("Missing id", 400);

    const supabase = await sb();
    const user = await requireUser(supabase);

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

    // membership gate
    const memberRole = await requireProjectRole(supabase, projectId, user.id);
    if (!memberRole) return jsonErr("Forbidden", 403);

    const govStatus = safeStr(cr?.status).trim().toLowerCase();
    const decisionStatus = safeStr(cr?.decision_status).trim().toLowerCase();
    const fromLane = normalizeLane(cr?.delivery_status) || null;

    // Idempotent
    if (decisionStatus === "approved" || govStatus === "approved" || govStatus === "in_progress") {
      return jsonOk({ item: cr, data: cr, already: "approved" });
    }
    if (decisionStatus === "rejected" || govStatus === "rejected") {
      return jsonErr("Cannot approve a rejected change request.", 409);
    }

    // must be submitted
    if (decisionStatus !== "submitted") {
      return jsonErr(
        `Cannot approve unless decision_status=submitted (current=${decisionStatus || "(null)"})`,
        409
      );
    }

    // strict lane gate if delivery_status column exists
    if (!deliveryStatusMissing && fromLane !== "review") {
      return jsonErr(`Cannot approve unless in Review lane (lane=${fromLane || "(null)"})`, 409);
    }

    // ensure artifact_id exists
    const artifactId = await ensureArtifactIdForChangeRequest(supabase, cr);
    if (!artifactId) {
      return jsonErr(
        "Missing artifact_id for this change request. Ensure submit created/linked an artifact.",
        409
      );
    }

    // canonical approver check + pending step
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

    // record decision (idempotent per step+approver)
    await recordArtifactApprovalDecision({
      supabase,
      chainId: pending.chainId,
      stepId: pending.stepId,
      approverUserId: effectiveApproverUserId,
      actorUserId: user.id,
      decision: "approved",
      reason: note || null,
    });

    // recompute chain state
    const state = await recomputeApprovalState({
      supabase,
      artifactId,
      chainId: pending.chainId,
      stepId: pending.stepId,
    });

    const now = new Date().toISOString();

    // If not final yet, keep CR submitted/review; return refreshed row
    if (state.chainStatus !== "approved") {
      try {
        await logChangeEvent(supabase, {
          projectId,
          changeRequestId: id,
          actorUserId: user.id,
          actorRole: onBehalfOf ? "delegate_approver" : "approver",
          eventType: "approved_step",
          fromValue: `step_${pending.stepOrder}`,
          toValue: `step_${pending.stepOrder}`,
          note: note || null,
          payload: {
            chain_id: pending.chainId,
            step_id: pending.stepId,
            step_name: pending.stepName,
            delegated_for: onBehalfOf || null,
          },
        } as any);
      } catch {}

      try {
        await insertTimelineEvent(supabase, {
          project_id: projectId,
          change_id: id,
          event_type: "comment",
          from_status: fromLane,
          to_status: fromLane,
          actor_user_id: user.id,
          actor_role: onBehalfOf ? "delegate_approver" : "approver",
          comment: note ? `Approved step: ${note}` : "Approved step",
          payload: {
            source: "approve_route",
            chain_id: pending.chainId,
            step_id: pending.stepId,
            chain_status: state.chainStatus,
          },
        });
      } catch {}

      const fresh = await supabase.from("change_requests").select("*").eq("id", id).maybeSingle();
      const item = fresh.data || cr;

      await emitAiEvent(req, {
        projectId,
        artifactId,
        eventType: "change_saved",
        severity: "info",
        source: "app",
        payload: {
          target_artifact_type: "change_request",
          change_id: id,
          action: "approved_step",
          chain_id: pending.chainId,
          step_id: pending.stepId,
        },
      });

      return jsonOk({
        item,
        data: item,
        approval_chain_id: pending.chainId,
        step_complete: state.stepStatus === "approved",
        chain_complete: false,
      });
    }

    // FINAL APPROVAL -> update CR row
    const toLane = "in_progress";

    const patchBase: any = {
      // lifecycle after approval is execution
      status: "in_progress",

      decision_status: "approved",
      decision_rationale: note || null,

      // effective approver (delegate-safe)
      decision_by: effectiveApproverUserId,
      decision_at: now,
      decision_role: onBehalfOf ? "delegate_final" : "chain_final",

      delivery_status: toLane,
      updated_at: now,
    };

    // legacy compat
    let patch: any = { ...patchBase, approver_id: effectiveApproverUserId, approval_date: now };

    const first = await supabase.from("change_requests").update(patch).eq("id", id).select("*").single();

    // Retry stripping missing columns (legacy-safe)
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
          eventType: "approved",
          fromValue: "submitted",
          toValue: "approved",
          note: note || null,
          payload: {
            chain_id: pending.chainId,
            delegated_for: onBehalfOf || null,
            effective_approver: effectiveApproverUserId,
            delivery_status_missing: !("delivery_status" in patch),
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
        payload: { source: "approve_route", chain_id: pending.chainId, decision_status: "approved", at: now },
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
          action: "approved_final",
          decision_status: "approved",
          chain_id: pending.chainId,
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
        eventType: "approved",
        fromValue: "submitted",
        toValue: "approved",
        note: note || null,
        payload: {
          chain_id: pending.chainId,
          delegated_for: onBehalfOf || null,
          effective_approver: effectiveApproverUserId,
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
      payload: { source: "approve_route", chain_id: pending.chainId, decision_status: "approved", at: now },
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
        action: "approved_final",
        decision_status: "approved",
        chain_id: pending.chainId,
      },
    });

    return jsonOk({ item: first.data, data: first.data });
  } catch (e: any) {
    console.error("[POST /api/change/:id/approve]", e);
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