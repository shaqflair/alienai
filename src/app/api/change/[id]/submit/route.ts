// src/app/api/change/[id]/submit/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  sb,
  requireUser,
  requireProjectRole,
  canEdit,
  safeStr,
  logChangeEvent,
} from "@/lib/change/server-helpers";
import { notifyFirstChangeStepApprovers } from "@/lib/server/notifications/approval-notifications";
import { buildRuntimeApprovalChain } from "@/lib/server/approvals/runtime-chain-builder";

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
   local helpers
========================================================= */

function isBadIdString(x: string) {
  const v = safeStr(x).trim().toLowerCase();
  return !v || v === "null" || v === "undefined";
}

async function pickChangeId(
  req: Request,
  params: Promise<{ id?: string }> | undefined,
  body: any
): Promise<string | null> {
  if (params) {
    const resolvedParams = await params;
    const p = safeStr(resolvedParams?.id).trim();
    if (!isBadIdString(p)) return p;
  }

  try {
    const pathname = new URL(req.url).pathname || "";
    const parts = pathname.split("/").filter(Boolean);

    const last = parts[parts.length - 1] || "";
    if (last.toLowerCase() === "submit" && parts.length >= 2) {
      const candidate = safeStr(parts[parts.length - 2]).trim();
      if (!isBadIdString(candidate) && candidate.toLowerCase() !== "change") return candidate;
    }

    const idx = parts.findIndex((x) => String(x).toLowerCase() === "change");
    if (idx !== -1 && parts[idx + 1]) {
      const candidate = safeStr(parts[idx + 1]).trim();
      if (!isBadIdString(candidate)) return candidate;
    }
  } catch {}

  try {
    const u = new URL(req.url);
    const q1 = safeStr(u.searchParams.get("id")).trim();
    if (!isBadIdString(q1)) return q1;

    const q2 = safeStr(u.searchParams.get("change_id")).trim();
    if (!isBadIdString(q2)) return q2;
  } catch {}

  const b = safeStr(body?.id ?? body?.change_id).trim();
  if (!isBadIdString(b)) return b;

  return null;
}

function hasMissingColumn(errMsg: string, col: string) {
  const m = (errMsg || "").toLowerCase();
  const c = col.toLowerCase();
  return m.includes("column") && m.includes(c);
}

function hasDeliveryStatusMissingColumn(errMsg: string) {
  return hasMissingColumn(errMsg, "delivery_status");
}

function hasApprovalChainIdMissingColumn(errMsg: string) {
  return hasMissingColumn(errMsg, "approval_chain_id");
}

function hasImpactAnalysisMissingColumn(errMsg: string) {
  return hasMissingColumn(errMsg, "impact_analysis");
}

function hasOrganisationIdMissingColumn(errMsg: string) {
  return hasMissingColumn(errMsg, "organisation_id") || hasMissingColumn(errMsg, "organization_id");
}

function hasArtifactIdMissingColumn(errMsg: string) {
  return hasMissingColumn(errMsg, "artifact_id");
}

function hasTitleMissingColumn(errMsg: string) {
  return hasMissingColumn(errMsg, "title");
}

function isMissingRelation(errMsg: string) {
  const m = (errMsg || "").toLowerCase();
  return m.includes("does not exist") && m.includes("relation");
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

function toLaneDb(v: string) {
  const x = safeStr(v).toLowerCase();
  if (x === "in-progress") return "in_progress";
  if (x === "in_progress") return "in_progress";
  if (x === "intake") return "intake";
  if (x === "analysis") return "analysis";
  if (x === "review") return "review";
  if (x === "implementation") return "implementation";
  if (x === "implemented") return "implemented";
  if (x === "closed") return "closed";
  if (x === "new") return "intake";
  return x || "intake";
}

/* =========================================================
   Canonical artifact type normalisation
========================================================= */

function normalizeArtifactType(
  raw: any
): "project_charter" | "change" | "project_closure_report" | string {
  const v = safeStr(raw).trim();
  const lower = v.toLowerCase();
  if (!lower) return "";

  if (lower === "change_request" || lower === "change_requests" || lower === "change") {
    return "change";
  }
  if (lower === "project_closure" || lower === "project_closure_report") {
    return "project_closure_report";
  }
  if (lower === "project_charter") {
    return "project_charter";
  }

  return lower;
}

/* =========================================================
   artifact helpers
========================================================= */

async function loadChangeTitle(supabase: any, changeId: string): Promise<string> {
  const first = await supabase
    .from("change_requests")
    .select("title")
    .eq("id", changeId)
    .maybeSingle();

  if (!first.error) {
    return safeStr((first.data as any)?.title).trim() || "Change Request";
  }

  if (hasTitleMissingColumn(safeStr(first.error?.message))) {
    return "Change Request";
  }

  return "Change Request";
}

async function loadProjectOwnerForArtifact(supabase: any, projectId: string): Promise<string | null> {
  const { data } = await supabase
    .from("projects")
    .select("created_by, owner_id, user_id")
    .eq("id", projectId)
    .maybeSingle();

  return (
    safeStr((data as any)?.created_by).trim() ||
    safeStr((data as any)?.owner_id).trim() ||
    safeStr((data as any)?.user_id).trim() ||
    null
  );
}

async function createDedicatedChangeArtifact(
  supabase: any,
  args: {
    projectId: string;
    userId: string;
    changeId: string;
    title: string;
  }
): Promise<string | null> {
  const titleBase = safeStr(args.title).trim() || "Change Request";

  const insertPayloads = [
    {
      project_id: args.projectId,
      type: "change",
      artifact_type: "change",
      title: titleBase,
      status: "draft",
      user_id: args.userId,
      is_current: true,
      source_record_id: args.changeId,
    },
    {
      project_id: args.projectId,
      type: "change",
      title: titleBase,
      status: "draft",
      user_id: args.userId,
      is_current: true,
    },
    {
      project_id: args.projectId,
      type: "change_requests",
      title: titleBase,
      status: "draft",
      user_id: args.userId,
      is_current: true,
    },
  ];

  for (const payload of insertPayloads) {
    try {
      const { data, error } = await supabase
        .from("artifacts")
        .insert(payload)
        .select("id")
        .single();

      if (!error && data?.id) {
        return String(data.id);
      }
    } catch {}
  }

  return null;
}

/**
 * IMPORTANT FIX:
 * A submitted change request must use a DEDICATED artifact row.
 * Using the shared "Change Requests" board artifact causes approval-chain collisions
 * because artifact_approval_steps is unique by artifact_id + step_order.
 */
async function ensureDedicatedArtifactIdForChangeRequest(
  supabase: any,
  cr: any
): Promise<string | null> {
  const current = safeStr(cr?.artifact_id).trim();
  const projectId = safeStr(cr?.project_id).trim();
  const changeId = safeStr(cr?.id).trim();

  if (!projectId || !changeId) return null;

  // 1) if CR already has an artifact_id, prefer it
  if (current) {
    const { data: artifactRow, error } = await supabase
      .from("artifacts")
      .select("id, type, artifact_type, title, project_id")
      .eq("id", current)
      .maybeSingle();

    if (!error && artifactRow?.id) {
      const type = safeStr((artifactRow as any)?.type).trim().toLowerCase();
      const artifactType = safeStr((artifactRow as any)?.artifact_type).trim().toLowerCase();

      // dedicated artifact types are safe
      if (type === "change" || artifactType === "change") {
        return String(artifactRow.id);
      }

      // shared board artifact types are NOT safe for per-change approvals
      // so we fall through and create a dedicated change artifact instead
    }
  }

  // 2) try to find a previously created dedicated artifact for this change
  const searchQueries = [
    supabase
      .from("artifacts")
      .select("id, type, artifact_type, title, project_id, created_at")
      .eq("project_id", projectId)
      .eq("type", "change")
      .order("created_at", { ascending: false })
      .limit(20),

    supabase
      .from("artifacts")
      .select("id, type, artifact_type, title, project_id, created_at")
      .eq("project_id", projectId)
      .eq("artifact_type", "change")
      .order("created_at", { ascending: false })
      .limit(20),
  ];

  const changeTitle = await loadChangeTitle(supabase, changeId);

  for (const query of searchQueries) {
    try {
      const { data, error } = await query;
      if (error) continue;

      const found = (Array.isArray(data) ? data : []).find((row: any) => {
        const t = safeStr(row?.title).trim().toLowerCase();
        const expected = changeTitle.trim().toLowerCase();
        return !!t && !!expected && t === expected;
      });

      if (found?.id) {
        const resolved = String(found.id);

        try {
          await supabase.from("change_requests").update({ artifact_id: resolved }).eq("id", changeId);
        } catch {}

        return resolved;
      }
    } catch {}
  }

  // 3) create a dedicated artifact
  const ownerUserId = await loadProjectOwnerForArtifact(supabase, projectId);
  if (!ownerUserId) return null;

  const createdId = await createDedicatedChangeArtifact(supabase, {
    projectId,
    userId: ownerUserId,
    changeId,
    title: changeTitle,
  });

  if (!createdId) return null;

  // 4) attach it back to the change request when the column exists
  try {
    const attach = await supabase
      .from("change_requests")
      .update({ artifact_id: createdId })
      .eq("id", changeId);

    if (attach.error && !hasArtifactIdMissingColumn(safeStr(attach.error.message))) {
      // swallow non-fatal
    }
  } catch {}

  return createdId;
}

/* =========================================================
   Approval timeline helpers
========================================================= */

async function resolveActorName(supabase: any, userId: string, fallbackEmail?: string | null) {
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

async function getFirstPendingStepSummary(
  supabase: any,
  chainId: string
): Promise<{ step_id: string | null; step_order: number | null; name: string | null } | null> {
  const cid = safeStr(chainId).trim();
  if (!cid) return null;

  try {
    const { data, error } = await supabase
      .from("artifact_approval_steps")
      .select("id, step_order, name, status")
      .eq("chain_id", cid)
      .eq("status", "pending")
      .order("step_order", { ascending: true })
      .limit(1);

    if (error) return null;
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return null;

    return {
      step_id: row?.id ? String(row.id) : null,
      step_order: row?.step_order == null ? null : Number(row.step_order),
      name: row?.name ? String(row.name) : null,
    };
  } catch {
    return null;
  }
}

/* =========================================================
   Notification helpers
========================================================= */

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

/* =========================================================
   Org + cost helpers
========================================================= */

async function getOrganisationIdForProject(supabase: any, projectId: string): Promise<string | null> {
  const first = await supabase.from("projects").select("organisation_id").eq("id", projectId).maybeSingle();
  if (!first.error) {
    const orgId = (first.data as any)?.organisation_id;
    return orgId ? String(orgId) : null;
  }
  if (!hasOrganisationIdMissingColumn(safeStr(first.error?.message))) return null;

  const second = await supabase.from("projects").select("organization_id").eq("id", projectId).maybeSingle();
  if (second.error) return null;
  const orgId = (second.data as any)?.organization_id;
  return orgId ? String(orgId) : null;
}

function extractCostFromImpactAnalysis(impact: any): number {
  try {
    const cost = impact?.cost ?? impact?.estimated_cost ?? impact?.budget_delta ?? null;
    const n = Number(cost);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

async function loadImpactCostForChange(supabase: any, changeId: string): Promise<number> {
  const first = await supabase.from("change_requests").select("impact_analysis").eq("id", changeId).maybeSingle();
  if (!first.error) {
    const ia = (first.data as any)?.impact_analysis;
    return extractCostFromImpactAnalysis(ia);
  }
  if (hasImpactAnalysisMissingColumn(safeStr(first.error?.message))) return 0;
  return 0;
}

async function updateArtifactSubmitted(
  supabase: any,
  artifactId: string,
  chainId: string,
  actorId: string,
  nowIso: string
) {
  const patch1: any = {
    approval_chain_id: chainId,
    submitted_at: nowIso,
    submitted_by: actorId,
    status: "submitted",
    approval_status: "submitted",
    approval_step_index: 0,
    is_locked: true,
    locked_at: nowIso,
    locked_by: actorId,
  };

  const u1 = await supabase.from("artifacts").update(patch1).eq("id", artifactId);
  if (!u1.error) return;

  const patch2: any = {
    approval_chain_id: chainId,
    submitted_at: nowIso,
    submitted_by: actorId,
  };
  await supabase.from("artifacts").update(patch2).eq("id", artifactId);
}

async function tryAttachApprovalChainIdToChange(supabase: any, changeId: string, chainId: string) {
  const first = await supabase.from("change_requests").update({ approval_chain_id: chainId }).eq("id", changeId);
  if (!first.error) return;
  if (hasApprovalChainIdMissingColumn(safeStr(first.error.message))) return;
}

/* =========================================================
   Route
========================================================= */

export async function POST(req: Request, ctx: { params: Promise<{ id?: string }> }) {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const changeId = await pickChangeId(req, ctx.params, body);
    if (!changeId) return jsonErr("Missing id", 400);

    const supabase = await sb();
    const user = await requireUser(supabase);

    const requestId = randomUUID();

    type ChangeRow = {
      id: string;
      project_id: string;
      artifact_id?: string;
      status?: string;
      delivery_status?: string;
      decision_status?: string;
      [key: string]: any;
    };

    let cr: ChangeRow | null = null;
    let deliveryStatusMissing = false;

    const firstLoad = await supabase
      .from("change_requests")
      .select("id, project_id, artifact_id, status, delivery_status, decision_status")
      .eq("id", changeId)
      .maybeSingle();

    if (!firstLoad.error) {
      cr = firstLoad.data as ChangeRow;
    } else {
      deliveryStatusMissing = hasDeliveryStatusMissingColumn(safeStr(firstLoad.error.message));
      if (deliveryStatusMissing) {
        const secondLoad = await supabase
          .from("change_requests")
          .select("id, project_id, artifact_id, status, decision_status")
          .eq("id", changeId)
          .maybeSingle();

        if (secondLoad.error) throw new Error(secondLoad.error.message);
        cr = secondLoad.data as ChangeRow;
      } else {
        throw new Error(firstLoad.error.message);
      }
    }

    if (!cr) return jsonErr("Not found", 404);

    const projectId = safeStr(cr?.project_id).trim();
    if (!projectId) return jsonErr("Missing project_id", 500);

    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return jsonErr("Forbidden", 403);
    if (!canEdit(role)) return jsonErr("Forbidden", 403);

    const fromLane = safeStr(cr?.delivery_status).trim().toLowerCase() || null;
    const decision = safeStr(cr?.decision_status).trim().toLowerCase();

    if (decision === "approved" || decision === "rejected") {
      return jsonErr("This change is already decided", 400);
    }

    if (decision === "submitted") {
      return jsonOk({
        item: { ...cr, delivery_status: cr?.delivery_status ?? null },
        data: cr,
        already: "submitted",
      });
    }

    if (!deliveryStatusMissing && fromLane !== "analysis") {
      return jsonErr("Only changes in Analysis can be submitted for approval.", 409);
    }

    const artifactId = await ensureDedicatedArtifactIdForChangeRequest(supabase, cr);
    if (!artifactId) {
      return jsonErr(
        "Unable to resolve a dedicated artifact for this change request. Create/backfill a per-change artifact first.",
        409
      );
    }

    const now = new Date().toISOString();
    const toLane = "review";

    const organisationId = await getOrganisationIdForProject(supabase, projectId);
    if (!organisationId) {
      return jsonErr("Project has no organisation_id. Configure organisation_id on the project first.", 409);
    }

    const actorEmail = safeStr((user as any)?.email ?? "").trim() || null;
    const actorName = await resolveActorName(supabase, user.id, actorEmail);

    const amount = await loadImpactCostForChange(supabase, changeId);

    const { chainId, chosenType } = await buildRuntimeApprovalChain(supabase, {
      organisationId,
      projectId,
      artifactId,
      actorId: user.id,
      amount,
      artifactType: normalizeArtifactType("change"),
    });

    const firstStep = await getFirstPendingStepSummary(supabase, chainId);

    await updateArtifactSubmitted(supabase, artifactId, chainId, user.id, now);
    await tryAttachApprovalChainIdToChange(supabase, changeId, chainId);

    const patch: any = {
      delivery_status: toLaneDb(toLane),
      decision_status: "submitted",
      decision_at: null,
      decision_by: null,
      decision_role: null,
      decision_rationale: null,
      updated_at: now,
      artifact_id: artifactId,
    };

    const firstUpdate = await supabase
      .from("change_requests")
      .update(patch)
      .eq("id", changeId)
      .select("id, project_id, artifact_id, status, delivery_status, decision_status")
      .maybeSingle();

    let updated = firstUpdate.data as ChangeRow | null;
    const deliveryMissingOnUpdate = Boolean(
      firstUpdate.error && hasDeliveryStatusMissingColumn(safeStr(firstUpdate.error.message))
    );
    const artifactMissingOnUpdate = Boolean(
      firstUpdate.error && hasArtifactIdMissingColumn(safeStr(firstUpdate.error.message))
    );

    if (deliveryMissingOnUpdate || artifactMissingOnUpdate) {
      if (deliveryMissingOnUpdate) delete patch.delivery_status;
      if (artifactMissingOnUpdate) delete patch.artifact_id;

      const secondUpdate = await supabase
        .from("change_requests")
        .update(patch)
        .eq("id", changeId)
        .select("id, project_id, artifact_id, status, decision_status")
        .maybeSingle();

      if (secondUpdate.error) throw new Error(secondUpdate.error.message);
      updated = secondUpdate.data as ChangeRow | null;
    } else if (firstUpdate.error) {
      throw new Error(firstUpdate.error.message);
    }

    try {
      await logChangeEvent(
        supabase,
        {
          projectId,
          artifactId,
          changeRequestId: changeId,
          actorUserId: user.id,
          actorRole: role,
          eventType: "submitted_for_approval",
          fromValue: deliveryStatusMissing ? null : fromLane || null,
          toValue: deliveryMissingOnUpdate ? null : toLane,
          note: null,
          payload: {
            decision_status: { from: decision || null, to: "submitted" },
            lane: {
              from: deliveryStatusMissing ? null : fromLane || null,
              to: deliveryMissingOnUpdate ? null : toLane,
            },
            approval_chain_id: chainId,
            approval_chain_artifact_type: chosenType,
            amount,
            submitted_at: now,
            request_id: requestId,
          },
        } as any
      );
    } catch {}

    await insertTimelineEvent(supabase, {
      project_id: projectId,
      change_id: changeId,
      event_type: "status_changed",
      from_status: deliveryStatusMissing ? null : fromLane,
      to_status: deliveryMissingOnUpdate ? null : toLane,
      actor_user_id: user.id,
      actor_role: safeStr(role),
      comment: null,
      payload: {
        source: "submit_route",
        decision_status: "submitted",
        approval_chain_id: chainId,
        approval_chain_artifact_type: chosenType,
        artifact_id: artifactId,
        amount,
        at: now,
        sla_start: true,
        sla_started_at: now,
        request_id: requestId,
      },
    });

    await insertApprovalEvent(supabase, {
      organisation_id: organisationId,
      project_id: projectId,
      artifact_id: artifactId,
      change_id: changeId,
      step_id: firstStep?.step_id ?? null,
      action_type: "submitted",
      actor_user_id: user.id,
      actor_name: actorName,
      actor_role: safeStr(role),
      comment: null,
      meta: {
        at: now,
        request_id: requestId,
        approval_chain_id: chainId,
        artifact_type: chosenType,
        artifact_id: artifactId,
        amount,
        from_lane: deliveryStatusMissing ? null : fromLane || null,
        to_lane: deliveryMissingOnUpdate ? null : toLane,
        delivery_status_missing: deliveryMissingOnUpdate || deliveryStatusMissing,
        first_step: firstStep,
        source: "submit_route",
        sla_started_at: now,
      },
    });

    try {
      const projectForNotification = await loadProjectForNotification(supabase, projectId);
      const changeForNotification = await loadChangeNotificationContext(supabase, changeId);

      await notifyFirstChangeStepApprovers(supabase, {
        projectId,
        changeId,
        changeTitle: changeForNotification.title,
        changeType: changeForNotification.changeType,
        project: projectForNotification,
        projectFallbackRef: projectId,
        submittedByName: actorName ?? actorEmail ?? null,
      });
    } catch (notifyErr) {
      console.error("[POST /api/change/:id/submit] first-step notification failed:", notifyErr);
    }

    const resultItem = updated || cr;
    const finalItem = {
      ...resultItem,
      artifact_id: safeStr((resultItem as any)?.artifact_id).trim() || artifactId,
      delivery_status: resultItem?.delivery_status ?? null,
    };

    return jsonOk({
      item: finalItem,
      data: finalItem,
      approval_chain_id: chainId,
      artifact_id: artifactId,
      amount,
      artifact_type: chosenType,
    });
  } catch (e: any) {
    console.error("[POST /api/change/:id/submit]", e);
    const msg = safeStr(e?.message) || "Server error";
    const status = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500;
    return jsonErr(msg, status);
  }
}