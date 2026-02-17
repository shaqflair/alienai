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

/* =========================================================
   helpers (holiday-cover safe)
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

function toLaneDb(v: string) {
  const x = safeStr(v).toLowerCase();
  if (x === "in-progress") return "in_progress";
  if (x === "inprogress") return "in_progress";
  if (x === "in_progress") return "in_progress";
  if (x === "intake") return "intake";
  if (x === "analysis") return "analysis";
  if (x === "review") return "review";
  if (x === "implemented") return "implemented";
  if (x === "closed") return "closed";
  if (x === "new") return "intake";
  return x || "in_progress";
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
      // swallow
    }
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

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await ctx.params;
    const id = safeStr(rawId).trim();
    if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

    const supabase = await sb();
    const user = await requireUser(supabase);

    const body = await req.json().catch(() => ({}));
    const rawNote = safeStr(body?.note).trim();
    const note = rawNote ? rawNote.slice(0, 5000) : "";

    // Load safely (delivery_status may not exist)
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

    if (!cr) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    const projectId = safeStr(cr?.project_id).trim();
    if (!projectId) return NextResponse.json({ ok: false, error: "Missing project_id" }, { status: 500 });

    const memberRole = await requireProjectRole(supabase, projectId, user.id);
    if (!memberRole) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    const decisionStatus = safeStr(cr?.decision_status).trim().toLowerCase();
    const fromLane = safeStr(cr?.delivery_status).trim().toLowerCase() || null;

    // must be submitted
    if (decisionStatus !== "submitted") {
      return NextResponse.json(
        {
          ok: false,
          error: `Cannot approve unless decision_status=submitted (current=${decisionStatus || "(null)"})`,
        },
        { status: 409 }
      );
    }

    // strict lane gate if column exists
    if (!deliveryStatusMissing && fromLane !== "review") {
      return NextResponse.json(
        { ok: false, error: `Cannot approve unless in Review lane (lane=${fromLane || "(null)"})` },
        { status: 409 }
      );
    }

    // Ensure artifact_id exists (we now drive approvals from artifacts.approval_chain_id)
    const artifactId = await ensureArtifactIdForChangeRequest(supabase, cr);
    if (!artifactId) {
      return NextResponse.json(
        { ok: false, error: "Missing artifact_id for this change request. Ensure submit created/linked an artifact." },
        { status: 409 }
      );
    }

    // ✅ Canonical approver check + pending step
    const { pending, onBehalfOf } = await requireApproverForPendingArtifactStep({
      supabase,
      artifactId,
      actorUserId: user.id,
    });

    const effectiveApproverUserId = onBehalfOf ?? user.id;

    // ✅ Write decision (idempotent per approver per step)
    await recordArtifactApprovalDecision({
      supabase,
      chainId: pending.chainId,
      stepId: pending.stepId,
      approverUserId: effectiveApproverUserId,
      actorUserId: user.id,
      decision: "approved",
      reason: note || null,
    });

    // ✅ Recompute step/chain/artifact state
    const state = await recomputeApprovalState({
      supabase,
      artifactId,
      chainId: pending.chainId,
      stepId: pending.stepId,
    });

    const now = new Date().toISOString();

    // If chain is not approved yet, keep CR in submitted/review (just audit)
    if (state.chainStatus !== "approved") {
      try {
        await logChangeEvent(
          supabase,
          {
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
              delegated_for: onBehalfOf || null,
              step_name: pending.stepName,
            },
          } as any
        );
      } catch {}

      return NextResponse.json({
        ok: true,
        item: cr,
        approval_chain_id: pending.chainId,
        step_complete: state.stepStatus === "approved",
        chain_complete: false,
      });
    }

    // FINAL APPROVAL -> update change row
    const toLane = "in_progress";

    const patch: any = {
      status: "approved",
      decision_status: "approved",
      decision_rationale: note || null,
      decision_by: user.id,
      decision_at: now,
      decision_role: onBehalfOf ? "delegate_final" : "chain_final",
      approver_id: user.id,
      approval_date: now,
      delivery_status: toLaneDb(toLane),
      updated_at: now,
    };

    const first = await supabase.from("change_requests").update(patch).eq("id", id).select("*").single();

    if (first.error && hasDeliveryStatusMissingColumn(safeStr(first.error.message))) {
      delete patch.delivery_status;
      const second = await supabase.from("change_requests").update(patch).eq("id", id).select("*").single();
      if (second.error) throw second.error;

      try {
        await logChangeEvent(
          supabase,
          {
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
              to_lane: toLane,
              delegated_for: onBehalfOf || null,
              delivery_status_missing: true,
            },
          } as any
        );
      } catch {}

      await insertTimelineEvent(supabase, {
        project_id: projectId,
        change_id: id,
        event_type: "status_changed",
        from_status: fromLane,
        to_status: null,
        actor_user_id: user.id,
        actor_role: patch.decision_role,
        comment: note || null,
        payload: { source: "approve_route", chain_id: pending.chainId, decision_status: "approved", at: now },
      });

      return NextResponse.json({ ok: true, item: second.data, data: second.data });
    }

    if (first.error) throw first.error;

    try {
      await logChangeEvent(
        supabase,
        {
          projectId,
          changeRequestId: id,
          actorUserId: user.id,
          actorRole: patch.decision_role,
          eventType: "approved",
          fromValue: "submitted",
          toValue: "approved",
          note: note || null,
          payload: { chain_id: pending.chainId, to_lane: toLane, delegated_for: onBehalfOf || null },
        } as any
      );
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

    return NextResponse.json({ ok: true, item: first.data, data: first.data });
  } catch (e: any) {
    console.error("[POST /api/change/:id/approve]", e);
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
