// src/app/api/change/[id]/approve/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { sb, requireUser, requireProjectRole, safeStr, logChangeEvent } from "@/lib/change/server-helpers";

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
function hasApprovalChainIdMissingColumn(errMsg: string) {
  return hasMissingColumn(errMsg, "approval_chain_id");
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
   Chain resolution + step evaluation
========================================================= */

async function resolveChainIdForChange(supabase: any, changeId: string): Promise<string | null> {
  // Prefer change_requests.approval_chain_id if present
  const first = await supabase
    .from("change_requests")
    .select("approval_chain_id")
    .eq("id", changeId)
    .maybeSingle();

  if (!first.error) {
    const cid = safeStr((first.data as any)?.approval_chain_id).trim();
    if (cid) return cid;
  } else {
    // ignore missing column
    if (!hasApprovalChainIdMissingColumn(safeStr(first.error.message))) {
      // other read errors -> ignore, fallback to approval_chains lookup
    }
  }

  // Fallback: find chain by change_id
  const { data, error } = await supabase
    .from("approval_chains")
    .select("id")
    .eq("change_id", changeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data?.id ? String(data.id) : null;
}

async function loadChainSteps(supabase: any, chainId: string): Promise<Array<{ id: string; order: number }>> {
  // Try step_order first, fallback to step
  const first = await supabase
    .from("artifact_approval_steps")
    .select("id, chain_id, step_order")
    .eq("chain_id", chainId)
    .order("step_order", { ascending: true });

  if (!first.error) {
    const rows = Array.isArray(first.data) ? first.data : [];
    return rows
      .filter((r: any) => r?.id)
      .map((r: any) => ({ id: String(r.id), order: Number(r.step_order ?? 0) }))
      .sort((a, b) => a.order - b.order);
  }

  if (!hasMissingColumn(safeStr(first.error.message), "step_order")) {
    throw new Error(safeStr(first.error.message));
  }

  const second = await supabase
    .from("artifact_approval_steps")
    .select("id, chain_id, step")
    .eq("chain_id", chainId)
    .order("step", { ascending: true });

  if (second.error) throw new Error(safeStr(second.error.message));
  const rows = Array.isArray(second.data) ? second.data : [];
  return rows
    .filter((r: any) => r?.id)
    .map((r: any) => ({ id: String(r.id), order: Number((r as any).step ?? 0) }))
    .sort((a, b) => a.order - b.order);
}

async function loadAllowedApproversForStep(supabase: any, stepId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("artifact_step_approvers")
    .select("approver_type, approver_ref, active")
    .eq("step_id", stepId)
    .eq("active", true);

  if (error) throw new Error(safeStr(error.message));

  const rows = Array.isArray(data) ? data : [];
  // approver_ref stores organisation_approvers.id (as text)
  return Array.from(
    new Set(
      rows
        .filter((r: any) => safeStr(r?.approver_type).toLowerCase() === "user")
        .map((r: any) => safeStr(r?.approver_ref).trim())
        .filter(Boolean)
    )
  );
}

async function orgApproverIdForUser(
  supabase: any,
  organisationApproverIds: string[],
  actorUserId: string
): Promise<string | null> {
  if (!organisationApproverIds.length) return null;

  const { data, error } = await supabase
    .from("organisation_approvers")
    .select("id, user_id")
    .in("id", organisationApproverIds);

  if (error) throw new Error(safeStr(error.message));

  const rows = Array.isArray(data) ? data : [];
  const found = rows.find((r: any) => safeStr(r?.user_id).trim() === actorUserId);
  return found?.id ? String(found.id) : null;
}

// Holiday cover: delegate can act for approver (best-effort; supports common column names)
async function findDelegatedApproverUserId(
  supabase: any,
  organisationId: string,
  actorUserId: string,
  candidateApproverUserIds: string[]
): Promise<string | null> {
  if (!candidateApproverUserIds.length) return null;

  // We’ll try common patterns:
  // approver_delegations(organisation_id, approver_user_id, delegate_user_id, is_active, start_at, end_at)
  // or (starts_at/ends_at) naming variations.
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("approver_delegations")
    .select("*")
    .eq("organisation_id", organisationId)
    .eq("is_active", true)
    .eq("delegate_user_id", actorUserId);

  if (error) {
    // if table missing or columns differ, we just disable delegation rather than block
    return null;
  }

  const rows = Array.isArray(data) ? data : [];
  for (const r of rows) {
    const approverUserId = safeStr((r as any)?.approver_user_id).trim();
    if (!approverUserId) continue;
    if (!candidateApproverUserIds.includes(approverUserId)) continue;

    const start =
      safeStr((r as any)?.starts_at).trim() ||
      safeStr((r as any)?.start_at).trim() ||
      safeStr((r as any)?.start_date).trim() ||
      "";
    const end =
      safeStr((r as any)?.ends_at).trim() ||
      safeStr((r as any)?.end_at).trim() ||
      safeStr((r as any)?.end_date).trim() ||
      "";

    const startOk = !start || start <= nowIso;
    const endOk = !end || nowIso <= end;
    if (startOk && endOk) return approverUserId;
  }

  return null;
}

async function getOrganisationIdForProject(supabase: any, projectId: string): Promise<string | null> {
  const first = await supabase.from("projects").select("organisation_id").eq("id", projectId).maybeSingle();
  if (!first.error) return first.data?.organisation_id ? String((first.data as any).organisation_id) : null;

  if (!hasOrganisationIdMissingColumn(safeStr(first.error?.message))) return null;

  const second = await supabase.from("projects").select("organization_id").eq("id", projectId).maybeSingle();
  if (second.error) return null;
  return second.data?.organization_id ? String((second.data as any).organization_id) : null;
}

async function countApprovalsForStep(supabase: any, chainId: string, stepId: string): Promise<number> {
  const { data, error } = await supabase
    .from("artifact_approval_decisions")
    .select("id, decision")
    .eq("chain_id", chainId)
    .eq("step_id", stepId)
    .eq("decision", "approved");

  if (error) throw new Error(safeStr(error.message));
  return Array.isArray(data) ? data.length : 0;
}

async function hasAnyRejectionForChain(supabase: any, chainId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("artifact_approval_decisions")
    .select("id")
    .eq("chain_id", chainId)
    .eq("decision", "rejected")
    .limit(1);

  if (error) throw new Error(safeStr(error.message));
  return Array.isArray(data) ? data.length > 0 : !!data;
}

async function upsertDecision(supabase: any, args: {
  chainId: string;
  stepId: string;
  approverUserId: string;
  actorUserId: string;
  decision: "approved" | "rejected";
  reason?: string | null;
}) {
  const { chainId, stepId, approverUserId, actorUserId, decision, reason } = args;

  const { error } = await supabase
    .from("artifact_approval_decisions")
    .upsert(
      {
        chain_id: chainId,
        step_id: stepId,
        approver_user_id: approverUserId,
        actor_user_id: actorUserId,
        decision,
        reason: reason ?? null,
      },
      { onConflict: "chain_id,step_id,approver_user_id" }
    );

  if (error) throw new Error(safeStr(error.message));
}

/* =========================================================
   Route
========================================================= */

export async function POST(req: Request, ctx: { params: { id: string } }) {
  try {
    const id = safeStr(ctx?.params?.id).trim();
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

    const govStatus = safeStr(cr?.status).trim().toLowerCase();
    const fromLane = safeStr(cr?.delivery_status).trim().toLowerCase() || null;
    const decisionStatus = safeStr(cr?.decision_status).trim().toLowerCase();

    const memberRole = await requireProjectRole(supabase, projectId, user.id);
    if (!memberRole) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    // must be submitted
    if (decisionStatus !== "submitted") {
      return NextResponse.json(
        { ok: false, error: `Cannot approve unless decision_status=submitted (current=${decisionStatus || "(null)"})` },
        { status: 409 }
      );
    }

    // strict lane gate if column exists
    if (!deliveryStatusMissing && fromLane !== "review") {
      return NextResponse.json({ ok: false, error: `Cannot approve unless in Review lane (lane=${fromLane || "(null)"})` }, { status: 409 });
    }

    // Resolve chain id (no fallback to legacy tables)
    const chainId = await resolveChainIdForChange(supabase, id);
    if (!chainId) {
      return NextResponse.json({ ok: false, error: "No approval chain found for this change. Submit must create a chain first." }, { status: 409 });
    }

    // Need organisation id for delegation + mapping
    const organisationId = await getOrganisationIdForProject(supabase, projectId);
    if (!organisationId) {
      return NextResponse.json({ ok: false, error: "Project has no organisation_id; cannot validate approvers." }, { status: 409 });
    }

    // Ensure artifact_id exists for audit triggers
    const artifactId = await ensureArtifactIdForChangeRequest(supabase, cr);

    // Find current step
    const steps = await loadChainSteps(supabase, chainId);
    if (!steps.length) return NextResponse.json({ ok: false, error: "Approval chain has no steps." }, { status: 409 });

    // Determine current step = first step where approvals < requiredApproversCount (requires_all=true model)
    // NOTE: your artifact_step_approvers has `required` but not min_approvals.
    // Clean default: step completes when ALL active step approvers have approved.
    let currentStep: { id: string; order: number } | null = null;
    for (const s of steps) {
      const allowedOrgApprovers = await loadAllowedApproversForStep(supabase, s.id);
      const requiredCount = allowedOrgApprovers.length;
      const approvedCount = await countApprovalsForStep(supabase, chainId, s.id);
      if (approvedCount < requiredCount) {
        currentStep = s;
        break;
      }
    }
    if (!currentStep) {
      // already complete (idempotent)
      return NextResponse.json({ ok: true, item: cr, data: cr });
    }

    // Allowed org-approver IDs for the step
    const allowedOrgApproverIds = await loadAllowedApproversForStep(supabase, currentStep.id);
    if (!allowedOrgApproverIds.length) {
      return NextResponse.json({ ok: false, error: "Current step has no approvers configured." }, { status: 409 });
    }

    // Map allowed org-approver IDs -> user_ids (so we can validate direct or delegated)
    const { data: orgApproverRows, error: oaErr } = await supabase
      .from("organisation_approvers")
      .select("id, user_id")
      .in("id", allowedOrgApproverIds);

    if (oaErr) return NextResponse.json({ ok: false, error: safeStr(oaErr.message) }, { status: 500 });

    const allowedApproverUserIds = Array.from(
      new Set((Array.isArray(orgApproverRows) ? orgApproverRows : []).map((r: any) => safeStr(r?.user_id).trim()).filter(Boolean))
    );

    // Actor must be either direct approver OR delegate for one of them
    let approverUserId: string | null = null;

    if (allowedApproverUserIds.includes(user.id)) {
      approverUserId = user.id;
    } else {
      const delegated = await findDelegatedApproverUserId(supabase, organisationId, user.id, allowedApproverUserIds);
      if (delegated) approverUserId = delegated;
    }

    if (!approverUserId) {
      return NextResponse.json({ ok: false, error: "You are not an allowed approver (or delegate) for the current step." }, { status: 403 });
    }

    // Record decision (idempotent per approver per step)
    await upsertDecision(supabase, {
      chainId,
      stepId: currentStep.id,
      approverUserId,
      actorUserId: user.id,
      decision: "approved",
      reason: note || null,
    });

    // Re-check completion
    const allowedCount = allowedOrgApproverIds.length;
    const approvedCount = await countApprovalsForStep(supabase, chainId, currentStep.id);

    const now = new Date().toISOString();

    // If not final step complete yet, just return
    const isStepComplete = approvedCount >= allowedCount;
    if (!isStepComplete) {
      try {
        if (artifactId) {
          await logChangeEvent(supabase, {
            projectId,
            artifactId,
            changeRequestId: id,
            actorUserId: user.id,
            actorRole: "chain_approver",
            eventType: "approved_step",
            fromValue: `step_${currentStep.order}`,
            toValue: `step_${currentStep.order}`,
            note: note || null,
            payload: { chain_id: chainId, step_id: currentStep.id, approvedCount, requiredCount: allowedCount, delegated_for: approverUserId !== user.id ? approverUserId : null },
          } as any);
        }
      } catch {}

      return NextResponse.json({ ok: true, item: cr, approval_chain_id: chainId, step_complete: false });
    }

    // Determine if chain complete
    let chainComplete = true;
    for (const s of steps) {
      const allowed = await loadAllowedApproversForStep(supabase, s.id);
      const req = allowed.length;
      const got = await countApprovalsForStep(supabase, chainId, s.id);
      if (got < req) {
        chainComplete = false;
        break;
      }
    }

    if (!chainComplete) {
      try {
        if (artifactId) {
          await logChangeEvent(supabase, {
            projectId,
            artifactId,
            changeRequestId: id,
            actorUserId: user.id,
            actorRole: "chain_approver",
            eventType: "step_completed",
            fromValue: `step_${currentStep.order}`,
            toValue: `step_${currentStep.order}`,
            note: null,
            payload: { chain_id: chainId, step_id: currentStep.id },
          } as any);
        }
      } catch {}

      return NextResponse.json({ ok: true, item: cr, approval_chain_id: chainId, step_complete: true });
    }

    // FINAL APPROVAL -> update change row
    const toLane = "in_progress";

    const patch: any = {
      status: "approved",
      decision_status: "approved",
      decision_rationale: note || null,
      decision_by: user.id,
      decision_at: now,
      decision_role: "chain_final",
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
        const finalArtifactId = artifactId || safeStr((second.data as any)?.artifact_id).trim();
        if (finalArtifactId) {
          await logChangeEvent(supabase, {
            projectId,
            artifactId: finalArtifactId,
            changeRequestId: id,
            actorUserId: user.id,
            actorRole: "chain_final",
            eventType: "approved",
            fromValue: "submitted",
            toValue: "approved",
            note: note || null,
            payload: { chain_id: chainId, to_lane: toLane, delivery_status_missing: true },
          } as any);
        }
      } catch {}

      await insertTimelineEvent(supabase, {
        project_id: projectId,
        change_id: id,
        event_type: "status_changed",
        from_status: fromLane,
        to_status: null,
        actor_user_id: user.id,
        actor_role: "chain_final",
        comment: note || null,
        payload: { source: "approve_route", chain_id: chainId, decision_status: "approved", at: now },
      });

      return NextResponse.json({ ok: true, item: second.data, data: second.data });
    }

    if (first.error) throw first.error;

    try {
      const finalArtifactId = safeStr((first.data as any)?.artifact_id).trim() || artifactId;
      if (finalArtifactId) {
        await logChangeEvent(supabase, {
          projectId,
          artifactId: finalArtifactId,
          changeRequestId: id,
          actorUserId: user.id,
          actorRole: "chain_final",
          eventType: "approved",
          fromValue: "submitted",
          toValue: "approved",
          note: note || null,
          payload: { chain_id: chainId, to_lane: toLane },
        } as any);
      }
    } catch {}

    await insertTimelineEvent(supabase, {
      project_id: projectId,
      change_id: id,
      event_type: "status_changed",
      from_status: fromLane,
      to_status: toLane,
      actor_user_id: user.id,
      actor_role: "chain_final",
      comment: note || null,
      payload: { source: "approve_route", chain_id: chainId, decision_status: "approved", at: now },
    });

    return NextResponse.json({ ok: true, item: first.data, data: first.data });
  } catch (e: any) {
    console.error("[POST /api/change/:id/approve]", e);
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
