// src/app/api/change/[id]/submit/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  sb,
  requireUser,
  requireProjectRole,
  canEdit,
  logChangeEvent,
} from "@/lib/change/server-helpers";
import { ensureDedicatedArtifactIdForChangeRequest } from "@/lib/change/resolveDedicatedChangeArtifact";
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

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

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

function hasStatusMissingColumn(errMsg: string) {
  return hasMissingColumn(errMsg, "status");
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

async function getActiveApprovalChainForArtifact(
  supabase: any,
  artifactId: string
): Promise<{ id: string; status: string | null } | null> {
  const aid = safeStr(artifactId).trim();
  if (!aid) return null;

  try {
    const { data, error } = await supabase
      .from("approval_chains")
      .select("id, status, is_active")
      .eq("artifact_id", aid)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;

    return {
      id: safeStr((data as any)?.id).trim(),
      status: safeStr((data as any)?.status).trim() || null,
    };
  } catch {
    return null;
  }
}

async function countOtherChangesLinkedToArtifact(
  supabase: any,
  artifactId: string,
  changeId: string
): Promise<number> {
  const aid = safeStr(artifactId).trim();
  const cid = safeStr(changeId).trim();
  if (!aid || !cid) return 0;

  try {
    const { data, error } = await supabase
      .from("change_requests")
      .select("id")
      .eq("artifact_id", aid);

    if (error || !Array.isArray(data)) return 0;
    return data.filter((r: any) => safeStr(r?.id).trim() !== cid).length;
  } catch {
    return 0;
  }
}

async function ensureArtifactIsDedicatedToChange(
  supabase: any,
  artifactId: string,
  changeId: string
) {
  const linkedOtherCount = await countOtherChangesLinkedToArtifact(supabase, artifactId, changeId);
  if (linkedOtherCount > 0) {
    throw new Error(
      `Artifact ${artifactId} is already linked to another change request. Dedicated per-change artifacts are required.`
    );
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
  const first = await supabase
    .from("projects")
    .select("organisation_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!first.error) {
    const orgId = (first.data as any)?.organisation_id;
    return orgId ? String(orgId) : null;
  }

  if (!hasOrganisationIdMissingColumn(safeStr(first.error?.message))) return null;

  const second = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .maybeSingle();

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
  const first = await supabase
    .from("change_requests")
    .select("impact_analysis")
    .eq("id", changeId)
    .maybeSingle();

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
  nowIso: string,
  approvalStepIndex?: number | null
) {
  const patch1: any = {
    approval_chain_id: chainId,
    submitted_at: nowIso,
    submitted_by: actorId,
    status: "submitted",
    approval_status: "submitted",
    approval_step_index:
      typeof approvalStepIndex === "number" && Number.isFinite(approvalStepIndex)
        ? approvalStepIndex
        : 0,
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
  const first = await supabase
    .from("change_requests")
    .update({ approval_chain_id: chainId })
    .eq("id", changeId);

  if (!first.error) return;
  if (hasApprovalChainIdMissingColumn(safeStr(first.error.message))) return;
}

async function syncChangeToSubmittedReview(
  supabase: any,
  args: {
    changeId: string;
    artifactId: string;
    chainId: string;
    nowIso: string;
    includeDeliveryStatus?: boolean;
    includeStatus?: boolean;
  }
) {
  const patch: any = {
    decision_status: "submitted",
    decision_at: null,
    decision_by: null,
    decision_role: null,
    decision_rationale: null,
    updated_at: args.nowIso,
    artifact_id: args.artifactId,
  };

  if (args.includeDeliveryStatus !== false) {
    patch.delivery_status = "review";
  }
  if (args.includeStatus !== false) {
    patch.status = "review";
  }

  if (safeStr(args.chainId).trim()) {
    patch.approval_chain_id = args.chainId;
  }

  let attempt = await supabase
    .from("change_requests")
    .update(patch)
    .eq("id", args.changeId)
    .select(
      "id, project_id, artifact_id, approval_chain_id, status, delivery_status, decision_status"
    )
    .maybeSingle();

  if (!attempt.error) return attempt.data ?? null;

  const msg = safeStr(attempt.error.message);
  const retryPatch = { ...patch };

  if (hasDeliveryStatusMissingColumn(msg)) delete (retryPatch as any).delivery_status;
  if (hasStatusMissingColumn(msg)) delete (retryPatch as any).status;
  if (hasArtifactIdMissingColumn(msg)) delete (retryPatch as any).artifact_id;
  if (hasApprovalChainIdMissingColumn(msg)) delete (retryPatch as any).approval_chain_id;

  attempt = await supabase
    .from("change_requests")
    .update(retryPatch)
    .eq("id", args.changeId)
    .select(
      "id, project_id, artifact_id, approval_chain_id, status, delivery_status, decision_status"
    )
    .maybeSingle();

  if (attempt.error) {
    throw new Error(attempt.error.message);
  }

  return attempt.data ?? null;
}

/**
 * Concurrency-safe claim using ONLY valid decision_status values.
 * We temporarily claim by moving to "submitted", which is allowed by DB constraint.
 * The chain builder is idempotent, so retries can safely reuse the active chain.
 */
async function claimChangeForSubmission(
  supabase: any,
  args: {
    changeId: string;
    nowIso: string;
    currentDecisionStatus: string | null;
    deliveryStatusMissing: boolean;
    currentLane: string | null;
  }
) {
  const patch: any = {
    decision_status: "submitted",
    updated_at: args.nowIso,
  };

  let query = supabase.from("change_requests").update(patch).eq("id", args.changeId);

  const currentDecision = safeStr(args.currentDecisionStatus).trim().toLowerCase();

  if (currentDecision === "draft") {
    query = query.eq("decision_status", "draft");
  } else if (!currentDecision) {
    query = query.is("decision_status", null);
  } else {
    return false;
  }

  if (!args.deliveryStatusMissing) {
    const lane = safeStr(args.currentLane).trim().toLowerCase();
    if (lane) {
      query = query.eq("delivery_status", lane);
    }
  }

  const { data, error } = await query
    .select("id, decision_status, delivery_status")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to claim change for submission: ${error.message}`);
  }

  return !!data;
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
      approval_chain_id?: string;
      status?: string;
      delivery_status?: string;
      decision_status?: string;
      [key: string]: any;
    };

    let cr: ChangeRow | null = null;
    let deliveryStatusMissing = false;

    const firstLoad = await supabase
      .from("change_requests")
      .select(
        "id, project_id, artifact_id, approval_chain_id, status, delivery_status, decision_status"
      )
      .eq("id", changeId)
      .maybeSingle();

    if (!firstLoad.error) {
      cr = firstLoad.data as ChangeRow;
    } else {
      deliveryStatusMissing = hasDeliveryStatusMissingColumn(safeStr(firstLoad.error.message));
      if (deliveryStatusMissing) {
        const secondLoad = await supabase
          .from("change_requests")
          .select("id, project_id, artifact_id, approval_chain_id, status, decision_status")
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

    if (!deliveryStatusMissing && fromLane !== "analysis" && decision !== "submitted") {
      return jsonErr("Only changes in Analysis can be submitted for approval.", 409);
    }

    const artifactId = await ensureDedicatedArtifactIdForChangeRequest(supabase, cr);
    if (!artifactId) {
      return jsonErr(
        "Unable to resolve a dedicated artifact for this change request. Create/backfill a per-change artifact first.",
        409
      );
    }

    await ensureArtifactIsDedicatedToChange(supabase, artifactId, changeId);

    const now = new Date().toISOString();
    const toLane = "review";

    const organisationId = await getOrganisationIdForProject(supabase, projectId);
    if (!organisationId) {
      return jsonErr("Project has no organisation_id. Configure organisation_id on the project first.", 409);
    }

    const actorEmail = safeStr((user as any)?.email ?? "").trim() || null;
    const actorName = await resolveActorName(supabase, user.id, actorEmail);
    const amount = await loadImpactCostForChange(supabase, changeId);

    const existingActiveChain = await getActiveApprovalChainForArtifact(supabase, artifactId);

    if (decision === "submitted" && existingActiveChain?.id) {
      const firstStep = await getFirstPendingStepSummary(supabase, existingActiveChain.id);

      await updateArtifactSubmitted(
        supabase,
        artifactId,
        existingActiveChain.id,
        user.id,
        now,
        firstStep?.step_order ?? 0
      );
      await tryAttachApprovalChainIdToChange(supabase, changeId, existingActiveChain.id);

      const synced = await syncChangeToSubmittedReview(supabase, {
        changeId,
        artifactId,
        chainId: existingActiveChain.id,
        nowIso: now,
        includeDeliveryStatus: !deliveryStatusMissing,
        includeStatus: true,
      });

      const finalItem = {
        ...(synced || cr),
        artifact_id: safeStr((synced as any)?.artifact_id).trim() || artifactId,
        approval_chain_id:
          safeStr((synced as any)?.approval_chain_id).trim() || existingActiveChain.id,
        delivery_status:
          (synced as any)?.delivery_status ?? (deliveryStatusMissing ? null : toLaneDb(toLane)),
        status: safeStr((synced as any)?.status).trim() || "review",
        decision_status: "submitted",
      };

      return jsonOk({
        item: finalItem,
        data: finalItem,
        approval_chain_id: existingActiveChain.id,
        artifact_id: artifactId,
        amount,
        artifact_type: normalizeArtifactType("change"),
        already: "submitted",
      });
    }

    const claimed = await claimChangeForSubmission(supabase, {
      changeId,
      nowIso: now,
      currentDecisionStatus: decision || null,
      deliveryStatusMissing,
      currentLane: fromLane,
    });

    if (!claimed) {
      const latest = await supabase
        .from("change_requests")
        .select(
          "id, project_id, artifact_id, approval_chain_id, status, delivery_status, decision_status"
        )
        .eq("id", changeId)
        .maybeSingle();

      const latestRow = (latest.data as ChangeRow | null) || cr;
      const latestDecision = safeStr((latestRow as any)?.decision_status).trim().toLowerCase();
      const latestArtifactId = safeStr((latestRow as any)?.artifact_id).trim() || artifactId;

      if (latestArtifactId) {
        await ensureArtifactIsDedicatedToChange(supabase, latestArtifactId, changeId);
      }

      const activeChainAfterMiss = latestArtifactId
        ? await getActiveApprovalChainForArtifact(supabase, latestArtifactId)
        : null;

      if (latestDecision === "submitted" || activeChainAfterMiss?.id) {
        const chainId =
          activeChainAfterMiss?.id || safeStr((latestRow as any)?.approval_chain_id).trim();
        const firstStep = chainId ? await getFirstPendingStepSummary(supabase, chainId) : null;

        if (chainId) {
          await updateArtifactSubmitted(
            supabase,
            latestArtifactId,
            chainId,
            user.id,
            now,
            firstStep?.step_order ?? 0
          );
          await tryAttachApprovalChainIdToChange(supabase, changeId, chainId);

          const synced = await syncChangeToSubmittedReview(supabase, {
            changeId,
            artifactId: latestArtifactId,
            chainId,
            nowIso: now,
            includeDeliveryStatus: !deliveryStatusMissing,
            includeStatus: true,
          });

          const finalItem = {
            ...(synced || latestRow),
            artifact_id: safeStr((synced as any)?.artifact_id).trim() || latestArtifactId,
            approval_chain_id: safeStr((synced as any)?.approval_chain_id).trim() || chainId,
            delivery_status:
              (synced as any)?.delivery_status ?? (deliveryStatusMissing ? null : toLaneDb(toLane)),
            status: safeStr((synced as any)?.status).trim() || "review",
            decision_status: "submitted",
          };

          return jsonOk({
            item: finalItem,
            data: finalItem,
            approval_chain_id: chainId,
            artifact_id: latestArtifactId,
            amount,
            artifact_type: normalizeArtifactType("change"),
            already: "submitted",
          });
        }

        return jsonOk({
          item: {
            ...latestRow,
            artifact_id: latestArtifactId,
            delivery_status: (latestRow as any)?.delivery_status ?? null,
            decision_status: "submitted",
          },
          data: latestRow,
          already: "submitted",
        });
      }

      return jsonErr("Another submission is already in progress for this change.", 409);
    }

    const built = await buildRuntimeApprovalChain(supabase, {
      organisationId,
      projectId,
      artifactId,
      actorId: user.id,
      amount,
      artifactType: normalizeArtifactType("change"),
    });

    const chainId = safeStr(built.chainId).trim();
    const chosenType = safeStr(built.chosenType).trim();

    if (!chainId) {
      throw new Error("Approval chain build returned no chain id.");
    }

    const firstStep = await getFirstPendingStepSummary(supabase, chainId);

    await updateArtifactSubmitted(
      supabase,
      artifactId,
      chainId,
      user.id,
      now,
      firstStep?.step_order ?? 0
    );
    await tryAttachApprovalChainIdToChange(supabase, changeId, chainId);

    const updated = await syncChangeToSubmittedReview(supabase, {
      changeId,
      artifactId,
      chainId,
      nowIso: now,
      includeDeliveryStatus: !deliveryStatusMissing,
      includeStatus: true,
    });

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
          toValue: deliveryStatusMissing ? null : toLane,
          note: null,
          payload: {
            decision_status: { from: decision || null, to: "submitted" },
            lane: {
              from: deliveryStatusMissing ? null : fromLane || null,
              to: deliveryStatusMissing ? null : toLane,
            },
            board_status: { from: safeStr(cr?.status).trim() || null, to: "review" },
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
      to_status: deliveryStatusMissing ? null : toLane,
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
        to_lane: deliveryStatusMissing ? null : toLane,
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
      approval_chain_id: safeStr((resultItem as any)?.approval_chain_id).trim() || chainId,
      delivery_status:
        (resultItem as any)?.delivery_status ?? (deliveryStatusMissing ? null : "review"),
      status: safeStr((resultItem as any)?.status).trim() || "review",
      decision_status: "submitted",
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