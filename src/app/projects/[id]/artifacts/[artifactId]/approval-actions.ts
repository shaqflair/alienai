"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { resolveArtifactAccess } from "@/lib/server/access/resolveArtifactAccess";

import { assertCharterReadyForSubmit } from "@/lib/charter/charter-validation";
import { buildRuntimeApprovalChain } from "@/lib/server/approvals/runtime-chain-builder";
import {
  notifyArtifactChangesRequested,
  notifyArtifactFullyApproved,
  notifyArtifactRejected,
  notifyFirstStepApprovers,
  notifyNextStepApprovers,
} from "@/lib/server/notifications/approval-notifications";
import { addApprovalComment } from "@/lib/server/approvals/comments";
import {
  snapshotArtifactForApprovalApproved,
  snapshotArtifactForApprovalSubmission,
} from "@/lib/server/artifacts/approval-versioning";

/* =========================================================
   Helpers
========================================================= */

function throwDb(error: any, label: string): never {
  const code = error?.code ?? "";
  const msg = error?.message ?? "";
  const hint = error?.hint ?? "";
  const details = error?.details ?? "";
  throw new Error(
    `[${label}] ${code} ${msg}${hint ? ` | hint: ${hint}` : ""}${details ? ` | details: ${details}` : ""}`
  );
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function isMissingColumnError(errMsg: string, col: string) {
  const m = String(errMsg || "").toLowerCase();
  const c = col.toLowerCase();
  return (
    (m.includes("column") && m.includes(c) && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes(c)) ||
    (m.includes("unknown column") && m.includes(c))
  );
}

function isMissingFunctionError(errMsg: string, fn: string) {
  const m = String(errMsg || "").toLowerCase();
  const f = fn.toLowerCase();
  return (
    (m.includes("function") && m.includes(f) && m.includes("does not exist")) ||
    (m.includes("could not find the function") && m.includes(f)) ||
    (m.includes("schema cache") && m.includes(f))
  );
}

function lower(x: any) {
  return safeStr(x).trim().toLowerCase();
}

function firstFinite(...vals: any[]) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toIso(x: any) {
  const s = safeStr(x).trim();
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function isStepTerminalStatus(status: any) {
  const st = lower(status);
  return (
    st === "approved" ||
    st === "rejected" ||
    st === "changes_requested" ||
    st === "cancelled" ||
    st === "closed" ||
    st === "completed" ||
    st === "skipped"
  );
}

function isChainTerminalStatus(status: any) {
  const st = lower(status);
  return (
    st === "approved" ||
    st === "rejected" ||
    st === "changes_requested" ||
    st === "cancelled" ||
    st === "closed" ||
    st === "completed"
  );
}

function getStepMinApprovals(step: any, approverCount?: number) {
  const raw = firstFinite(step?.min_approvals, step?.minimum_approvals, step?.required_approvals, 1);
  const base = Math.max(1, Number(raw || 1));
  if (Number.isFinite(Number(approverCount)) && Number(approverCount) > 0) {
    return Math.min(base, Number(approverCount));
  }
  return base;
}

function getStepOrderValue(step: any, fallback = 1) {
  const raw = firstFinite(
    step?.step_order,
    step?.step_index,
    step?.sequence,
    step?.order_no,
    step?.sort_order,
    fallback
  );
  return Math.max(1, Number(raw || fallback));
}

function getProjectLabel(project: any, fallback?: string | null) {
  return (
    safeStr(project?.title).trim() ||
    safeStr(project?.project_code).trim() ||
    safeStr(fallback).trim() ||
    "Project"
  );
}

async function requireUser() {
  const supabase = await createClient();
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throwDb(authErr, "auth.getUser");
  if (!auth?.user) redirect("/login");
  return { supabase, user: auth.user };
}

async function requireMemberRole(supabase: any, projectId: string, userId: string) {
  const { data: mem, error } = await supabase
    .from("project_members")
    .select("role, is_active")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throwDb(error, "project_members.select");
  if (mem) return String((mem as any)?.role ?? "viewer").toLowerCase();

  const { data: proj } = await supabase
    .from("projects")
    .select("organisation_id")
    .eq("id", projectId)
    .maybeSingle();

  const orgId = safeStr((proj as any)?.organisation_id).trim();
  if (orgId) {
    const { data: orgMem } = await supabase
      .from("organisation_members")
      .select("role")
      .eq("organisation_id", orgId)
      .eq("user_id", userId)
      .is("removed_at", null)
      .maybeSingle();

    if (orgMem) return String((orgMem as any)?.role ?? "viewer").toLowerCase();
  }

  throw new Error("Not a project member.");
}

function canSubmitByRole(myRole: string, isAuthor: boolean) {
  return isAuthor || myRole === "owner" || myRole === "editor";
}

const INCLUDE_EDITORS_AS_APPROVERS = false;

function canApproveByRole(myRole: string) {
  if (INCLUDE_EDITORS_AS_APPROVERS) return myRole === "owner" || myRole === "editor";
  return myRole === "owner";
}

async function getArtifact(supabase: any, artifactId: string) {
  const { data, error } = await supabase
    .from("artifacts")
    .select(
      [
        "id",
        "project_id",
        "organisation_id",
        "user_id",
        "type",
        "title",
        "content",
        "content_json",
        "is_locked",
        "approval_status",
        "submitted_at",
        "submitted_by",
        "approved_at",
        "approved_by",
        "rejected_at",
        "rejected_by",
        "rejection_reason",
        "is_current",
        "is_baseline",
        "root_artifact_id",
        "parent_artifact_id",
        "version",
        "updated_at",
        "approval_chain_id",
        "approval_step_index",
        "status",
        "current_draft_rev",
        "current_version_no",
        "last_saved_version_id",
      ].join(", ")
    )
    .eq("id", artifactId)
    .maybeSingle();

  if (error) throwDb(error, "artifacts.select");
  if (!data) throw new Error("Artifact not found.");
  return data as any;
}

async function writeAuditLog(
  supabase: any,
  args: {
    project_id: string;
    artifact_id: string;
    actor_id: string | null;
    action: string;
    before?: any;
    after?: any;
  }
) {
  const { error } = await supabase.from("artifact_audit_log").insert({
    project_id: args.project_id,
    artifact_id: args.artifact_id,
    actor_id: args.actor_id,
    action: args.action,
    before: args.before ?? null,
    after: args.after ?? null,
  });
  if (error) throwDb(error, "artifact_audit_log.insert");
}

async function getProjectNotificationContext(supabase: any, projectId: string) {
  const { data, error } = await supabase
    .from("projects")
    .select("id, title, project_code")
    .eq("id", projectId)
    .maybeSingle();

  if (error) throwDb(error, "projects.select(notification_context)");

  if (!data) return null;

  return {
    ...(data as any),
    label: getProjectLabel(data, projectId),
  };
}

async function getUserDisplayName(supabase: any, userId: string): Promise<string | null> {
  const uid = safeStr(userId).trim();
  if (!uid) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, user_id, full_name, display_name, name, email")
    .or(`id.eq.${uid},user_id.eq.${uid}`)
    .maybeSingle();

  if (error) {
    console.error("[approval-actions] profile lookup failed:", error);
    return null;
  }

  const resolved =
    safeStr((data as any)?.full_name).trim() ||
    safeStr((data as any)?.display_name).trim() ||
    safeStr((data as any)?.name).trim() ||
    safeStr((data as any)?.email).trim() ||
    null;

  return resolved;
}

async function addApprovalCommentSafe(
  supabase: any,
  args: {
    organisationId?: string | null;
    projectId: string;
    artifactId: string;
    chainId?: string | null;
    stepId?: string | null;
    authorUserId: string;
    commentType: "approve" | "request_changes" | "reject" | "resubmit" | "general";
    body?: string | null;
    isPrivate?: boolean;
  }
) {
  const body = safeStr(args.body).trim();
  if (!body) return;

  try {
    await addApprovalComment(supabase, {
      organisationId: args.organisationId ?? null,
      projectId: args.projectId,
      artifactId: args.artifactId,
      chainId: args.chainId ?? null,
      stepId: args.stepId ?? null,
      authorUserId: args.authorUserId,
      commentType: args.commentType,
      body,
      isPrivate: Boolean(args.isPrivate),
    });
  } catch (error) {
    console.error("[approval-actions] approval comment insert failed:", error);
  }
}

async function getMyActiveEditSessionId(
  supabase: any,
  args: {
    artifactId: string;
    userId: string;
  }
): Promise<string | null> {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("artifact_edit_sessions")
    .select("id, released_at, expires_at")
    .eq("artifact_id", args.artifactId)
    .eq("user_id", args.userId)
    .is("released_at", null)
    .gt("expires_at", nowIso)
    .order("last_heartbeat_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[approval-actions] active edit session lookup failed:", error);
    return null;
  }

  return safeStr((data as any)?.id).trim() || null;
}

async function createApprovalSubmissionSnapshotSafe(args: {
  artifactId: string;
  approvalChainId?: string | null;
  editSessionId?: string | null;
}) {
  try {
    await snapshotArtifactForApprovalSubmission({
      artifactId: args.artifactId,
      approvalChainId: args.approvalChainId ?? null,
      editSessionId: args.editSessionId ?? null,
    });
  } catch (error) {
    console.error("[approval-actions] approval submission snapshot failed:", error);
    throw error;
  }
}

async function createApprovalApprovedSnapshotSafe(args: {
  artifactId: string;
  approvalChainId?: string | null;
}) {
  try {
    await snapshotArtifactForApprovalApproved({
      artifactId: args.artifactId,
      approvalChainId: args.approvalChainId ?? null,
    });
  } catch (error) {
    console.error("[approval-actions] approval approved snapshot failed:", error);
    throw error;
  }
}

/* =========================================================
   Artifact type helpers
========================================================= */

function isProjectCharterType(type: any) {
  const t = String(type ?? "").toLowerCase();
  return t === "project_charter" || t === "project charter" || t === "charter" || t === "projectcharter" || t === "pid";
}

function isClosureReportType(type: any) {
  const t = String(type ?? "").toLowerCase().trim();
  return (
    t === "project_closure_report" ||
    t === "project closure report" ||
    t === "closure_report" ||
    t === "closure report" ||
    t === "project_closeout" ||
    t === "closeout" ||
    t === "close_out" ||
    t === "status_dashboard" ||
    t === "status dashboard"
  );
}

function isFinancialPlanType(type: any) {
  const t = String(type ?? "").toLowerCase().trim();
  return t === "financial_plan" || t === "financial plan";
}

function isApprovalEligibleArtifact(type: any) {
  return isProjectCharterType(type) || isClosureReportType(type) || isFinancialPlanType(type);
}

function normalizeArtifactType(type: any) {
  if (isProjectCharterType(type)) return "project_charter";
  if (isClosureReportType(type)) return "project_closure_report";
  if (isFinancialPlanType(type)) return "financial_plan";
  return safeStr(type).trim().toLowerCase();
}

/* =========================================================
   Governance runtime helpers
========================================================= */

async function getOrganisationIdForProject(supabase: any, projectId: string): Promise<string | null> {
  const p1 = await supabase.from("projects").select("organisation_id").eq("id", projectId).maybeSingle();
  if (!p1.error) {
    const id = safeStr((p1.data as any)?.organisation_id);
    if (id) return id;
  }
  const msg1 = safeStr(p1.error?.message);
  if (!msg1 || !isMissingColumnError(msg1, "organisation_id")) return null;

  const p2 = await supabase.from("projects").select("organization_id").eq("id", projectId).maybeSingle();
  if (!p2.error) {
    const id = safeStr((p2.data as any)?.organization_id);
    if (id) return id;
  }
  return null;
}

async function verifyRuntimeApprovalChainHealth(
  supabase: any,
  args: {
    artifactId: string;
    chainId: string;
  }
) {
  const { data: steps, error: stepsErr } = await supabase
    .from("artifact_approval_steps")
    .select("id, artifact_id, approval_step_id, chain_id, step_order, status, created_at")
    .eq("artifact_id", args.artifactId)
    .eq("chain_id", args.chainId)
    .order("step_order", { ascending: true });

  if (stepsErr) throwDb(stepsErr, "artifact_approval_steps.select(verify_runtime)");

  const runtimeSteps = Array.isArray(steps) ? (steps as any[]) : [];
  if (!runtimeSteps.length) {
    throw new Error(`Runtime approval chain ${args.chainId} created no artifact_approval_steps.`);
  }

  const missingDefinitionLink = runtimeSteps.find((s: any) => !safeStr(s?.approval_step_id).trim());
  if (missingDefinitionLink) {
    throw new Error(
      `Runtime approval chain ${args.chainId} has artifact step ${safeStr(
        missingDefinitionLink?.id
      )} with null approval_step_id.`
    );
  }

  const runtimeStepIds = runtimeSteps.map((s: any) => safeStr(s?.id).trim()).filter(Boolean);

  const { data: approvers, error: approversErr } = await supabase
    .from("approval_step_approvers")
    .select("id, step_id, user_id, email, role, status")
    .in("step_id", runtimeStepIds);

  if (approversErr) throwDb(approversErr, "approval_step_approvers.select(verify_runtime)");

  const approverRows = Array.isArray(approvers) ? (approvers as any[]) : [];
  const approverCountByStepId = new Map<string, number>();

  for (const row of approverRows) {
    const sid = safeStr((row as any)?.step_id).trim();
    if (!sid) continue;
    approverCountByStepId.set(sid, (approverCountByStepId.get(sid) ?? 0) + 1);
  }

  const stepWithoutApprover = runtimeSteps.find(
    (s: any) => (approverCountByStepId.get(safeStr(s?.id).trim()) ?? 0) <= 0
  );
  if (stepWithoutApprover) {
    throw new Error(
      `Runtime approval chain ${args.chainId} has artifact step ${safeStr(
        stepWithoutApprover?.id
      )} with no approval_step_approvers rows.`
    );
  }

  const firstPendingStep =
    runtimeSteps.find((s: any) => lower((s as any)?.status) === "pending") ??
    runtimeSteps.find((s: any) => lower((s as any)?.status) === "active") ??
    runtimeSteps[0] ??
    null;

  return {
    runtimeSteps,
    firstPendingStep,
  };
}

async function updateArtifactSubmitted(
  supabase: any,
  args: { artifactId: string; projectId: string; chainId: string; actorId: string; nowIso: string }
) {
  const { data: firstPendingStep, error: firstStepErr } = await supabase
    .from("artifact_approval_steps")
    .select("id, step_order, status")
    .eq("artifact_id", args.artifactId)
    .eq("chain_id", args.chainId)
    .eq("status", "pending")
    .order("step_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (firstStepErr) throwDb(firstStepErr, "artifact_approval_steps.select(first_pending_for_submit)");

  const firstStepOrder = Math.max(1, Number(firstPendingStep?.step_order ?? 1));

  const patch: any = {
    approval_chain_id: args.chainId,
    approval_status: "submitted",
    approval_step_index: firstStepOrder,
    submitted_at: args.nowIso,
    submitted_by: args.actorId,
    is_locked: true,
    status: "submitted",
  };

  const { data, error } = await supabase
    .from("artifacts")
    .update(patch)
    .eq("id", args.artifactId)
    .eq("project_id", args.projectId)
    .select(
      "id, project_id, approval_status, approval_chain_id, approval_step_index, is_locked, submitted_at, submitted_by, status"
    )
    .maybeSingle();

  if (error) throwDb(error, "artifacts.update(submit_runtime_minimal)");

  if (!data?.id) {
    const { data: probe, error: probeErr } = await supabase
      .from("artifacts")
      .select(
        "id, project_id, approval_status, approval_chain_id, approval_step_index, is_locked, submitted_at, submitted_by, status"
      )
      .eq("id", args.artifactId)
      .maybeSingle();

    if (probeErr) throwDb(probeErr, "artifacts.select(submit_probe)");
    throw new Error(
      `Artifact submit update matched 0 rows. artifact_id=${args.artifactId} project_id=${args.projectId} probe_found=${probe?.id ? "yes" : "no"} probe_status=${safeStr((probe as any)?.approval_status) || "null"}`
    );
  }

  const updatedStatus = lower((data as any).approval_status);
  const updatedChainId = safeStr((data as any).approval_chain_id).trim();
  const updatedLocked = (data as any).is_locked === true;
  const updatedStepIndex = Number((data as any).approval_step_index ?? 0);
  const updatedWorkflowStatus = lower((data as any).status);

  if (
    updatedStatus !== "submitted" ||
    updatedChainId !== args.chainId ||
    !updatedLocked ||
    updatedStepIndex !== firstStepOrder ||
    updatedWorkflowStatus !== "submitted"
  ) {
    throw new Error(
      `Artifact submit verification failed. expected_status=submitted actual_status=${safeStr(
        (data as any).approval_status
      )} expected_chain_id=${args.chainId} actual_chain_id=${updatedChainId} expected_step_index=${firstStepOrder} actual_step_index=${updatedStepIndex} expected_workflow_status=submitted actual_workflow_status=${safeStr(
        (data as any).status
      )}`
    );
  }

  return data as any;
}

async function clearArtifactApprovalLinkIfStale(supabase: any, artifactId: string, chainId: string) {
  const { data: art, error: artErr } = await supabase
    .from("artifacts")
    .select("id, approval_status, approval_chain_id, is_locked")
    .eq("id", artifactId)
    .maybeSingle();

  if (artErr) throwDb(artErr, "artifacts.select(clear_stale_link)");
  if (!art?.id) return;

  const approvalStatus = String((art as any).approval_status ?? "").toLowerCase();
  const linkedChainId = safeStr((art as any).approval_chain_id).trim();
  if (linkedChainId !== chainId) return;

  if (approvalStatus !== "submitted") {
    const { error: clrErr } = await supabase
      .from("artifacts")
      .update({ approval_chain_id: null, is_locked: false })
      .eq("id", artifactId);
    if (clrErr) throwDb(clrErr, "artifacts.update(clear_stale_link)");
  }
}

async function cancelApprovalChainArtifacts(supabase: any, chainId: string, artifactId?: string) {
  const adminDb = createAdminClient();

  await adminDb.from("artifact_approval_steps").delete().eq("chain_id", chainId);

  const { error: chainError } = await supabase
    .from("approval_chains")
    .update({ is_active: false, status: "cancelled" })
    .eq("id", chainId);
  if (chainError) throwDb(chainError, "approval_chains.update(cancel_submit_failure)");

  if (artifactId) await clearArtifactApprovalLinkIfStale(supabase, artifactId, chainId);
}

async function listApprovalStepsForChain(supabase: any, chainId: string) {
  const { data, error } = await supabase.from("artifact_approval_steps").select("*").eq("chain_id", chainId);
  if (error) throwDb(error, "artifact_approval_steps.select(list)");
  return Array.isArray(data) ? (data as any[]) : [];
}

function sortApprovalSteps(rows: any[]) {
  return [...rows].sort((a, b) => {
    const ao = firstFinite(a?.step_order, a?.step_index, a?.sequence, a?.order_no, a?.sort_order, 0) ?? 0;
    const bo = firstFinite(b?.step_order, b?.step_index, b?.sequence, b?.order_no, b?.sort_order, 0) ?? 0;
    if (ao !== bo) return ao - bo;

    const ad = toIso(a?.created_at || a?.inserted_at || a?.started_at || a?.updated_at);
    const bd = toIso(b?.created_at || b?.inserted_at || b?.started_at || b?.updated_at);
    if (ad && bd && ad !== bd) return ad < bd ? -1 : 1;

    return safeStr(a?.id).localeCompare(safeStr(b?.id));
  });
}

function getStepPosition(step: any, sortedSteps: any[]) {
  return sortedSteps.findIndex((s) => safeStr(s?.id) === safeStr(step?.id));
}

function getCurrentStep(sortedSteps: any[]) {
  return (
    sortedSteps.find((s) => s?.is_active === true) ??
    sortedSteps.find((s) => {
      const st = lower(s?.status);
      return st === "active" || st === "current" || st === "in_progress" || st === "pending_approval";
    }) ??
    sortedSteps.find((s) => {
      const st = lower(s?.status);
      return st === "pending" || st === "submitted" || st === "not_started";
    }) ??
    null
  );
}

function getBlockingPriorStep(sortedSteps: any[], currentStep: any) {
  const currentPos = getStepPosition(currentStep, sortedSteps);
  if (currentPos <= 0) return null;

  for (let i = 0; i < currentPos; i += 1) {
    const step = sortedSteps[i];
    if (!step?.id) continue;
    if (!isStepTerminalStatus(step?.status)) return step;
  }
  return null;
}

async function updateArtifactApprovalProgress(
  supabase: any,
  artifactId: string,
  patchPrimary: Record<string, any>,
  patchFallback?: Record<string, any>
) {
  const u1 = await supabase.from("artifacts").update(patchPrimary).eq("id", artifactId);
  if (!u1.error) return;

  const msg = safeStr(u1.error?.message);
  if (
    patchFallback &&
    (isMissingColumnError(msg, "approval_step_index") ||
      isMissingColumnError(msg, "status") ||
      isMissingColumnError(msg, "locked_at") ||
      isMissingColumnError(msg, "locked_by"))
  ) {
    const u2 = await supabase.from("artifacts").update(patchFallback).eq("id", artifactId);
    if (!u2.error) return;
    throwDb(u2.error, "artifacts.update(progress_fallback)");
  }
  throwDb(u1.error, "artifacts.update(progress)");
}

async function finalizeArtifactApproval(
  supabase: any,
  args: { artifactId: string; actorId: string; nowIso: string }
) {
  await updateArtifactApprovalProgress(
    supabase,
    args.artifactId,
    {
      approval_status: "approved",
      approved_at: args.nowIso,
      approved_by: args.actorId,
      is_locked: true,
      status: "approved",
    },
    {
      approval_status: "approved",
      approved_at: args.nowIso,
      approved_by: args.actorId,
      is_locked: true,
    }
  );
}

async function moveArtifactToNextApprovalStep(
  supabase: any,
  args: { artifactId: string; nextStepIndex: number }
) {
  await updateArtifactApprovalProgress(
    supabase,
    args.artifactId,
    {
      approval_status: "submitted",
      approval_step_index: args.nextStepIndex,
      is_locked: true,
      status: "submitted",
    },
    {
      approval_status: "submitted",
      is_locked: true,
    }
  );
}

async function keepArtifactOnCurrentApprovalStep(
  supabase: any,
  args: { artifactId: string; currentStepIndex: number }
) {
  await updateArtifactApprovalProgress(
    supabase,
    args.artifactId,
    {
      approval_status: "submitted",
      approval_step_index: args.currentStepIndex,
      is_locked: true,
      status: "submitted",
    },
    {
      approval_status: "submitted",
      is_locked: true,
    }
  );
}

async function markActiveChainStepsClosed(
  supabase: any,
  chainId: string,
  nowIso: string,
  terminalStatus: "changes_requested" | "rejected"
) {
  const r1 = await supabase
    .from("artifact_approval_steps")
    .update({ is_active: false, status: terminalStatus, updated_at: nowIso })
    .eq("chain_id", chainId)
    .eq("is_active", true);
  if (!r1.error) return;

  const r2 = await supabase
    .from("artifact_approval_steps")
    .update({ is_active: false, status: terminalStatus })
    .eq("chain_id", chainId)
    .eq("is_active", true);
  if (r2.error) throwDb(r2.error, "artifact_approval_steps.update(close_active)");
}

async function closeApprovalChain(
  supabase: any,
  chainId: string,
  args: {
    status: "approved" | "changes_requested" | "rejected" | "closed";
    actorId: string;
    nowIso: string;
    reason?: string | null;
  }
) {
  const r1 = await supabase
    .from("approval_chains")
    .update({
      is_active: false,
      status: args.status,
      completed_at: args.nowIso,
      completed_by: args.actorId,
      closed_at: args.nowIso,
      closed_by: args.actorId,
      rejection_reason: args.reason ?? null,
    })
    .eq("id", chainId);
  if (!r1.error) return;

  const r2 = await supabase
    .from("approval_chains")
    .update({
      is_active: false,
      status: args.status,
      completed_at: args.nowIso,
      rejection_reason: args.reason ?? null,
    })
    .eq("id", chainId);
  if (!r2.error) return;

  const r3 = await supabase.from("approval_chains").update({ is_active: false, status: args.status }).eq("id", chainId);
  if (r3.error) throwDb(r3.error, "approval_chains.update(close)");
}

/* =========================================================
   Delegate-safe approval helpers
========================================================= */

type AtomicApproveRpcResult = {
  ok?: boolean;
  step_id?: string | null;
  slot_id?: string | null;
  decision_source?: "direct" | "delegated" | "system" | string | null;
  step_status?: "pending" | "approved" | string | null;
  chain_status?: "pending" | "approved" | string | null;
  progressed?: boolean | null;
  completed_chain?: boolean | null;
  next_step_id?: string | null;
  approved_count?: number | null;
  pending_count?: number | null;
  required_approvals?: number | null;
  delegated_from_user_id?: string | null;
};

type AtomicTerminalRpcResult = {
  ok?: boolean;
  step_id?: string | null;
  slot_id?: string | null;
  decision_source?: "direct" | "delegated" | "system" | string | null;
  step_status?: string | null;
  chain_status?: string | null;
  artifact_status?: string | null;
  progressed?: boolean | null;
  completed_chain?: boolean | null;
  reason?: string | null;
  delegated_from_user_id?: string | null;
};

function isActiveDelegationNow(row: any, nowIso: string) {
  if (!row) return false;
  if (row?.is_active === false) return false;

  const nowMs = new Date(nowIso).getTime();
  const startsMs = new Date(row?.starts_at ?? 0).getTime();
  const endsMs = new Date(row?.ends_at ?? 0).getTime();

  if (!Number.isFinite(nowMs) || !Number.isFinite(startsMs) || !Number.isFinite(endsMs)) return false;
  return startsMs <= nowMs && nowMs < endsMs;
}

async function getActiveDelegateGrantForApprover(
  supabase: any,
  args: {
    organisationId?: string | null;
    approverUserId: string;
    actorUserId: string;
    nowIso: string;
  }
) {
  const approverUserId = safeStr(args.approverUserId).trim();
  const actorUserId = safeStr(args.actorUserId).trim();
  const organisationId = safeStr(args.organisationId).trim();

  if (!approverUserId || !actorUserId || approverUserId === actorUserId) return null;

  let q = supabase
    .from("approver_delegations")
    .select("*")
    .eq("from_user_id", approverUserId)
    .eq("to_user_id", actorUserId)
    .eq("is_active", true);

  if (organisationId) {
    q = q.eq("organisation_id", organisationId);
  }

  const { data, error } = await q.order("starts_at", { ascending: false });
  if (error) throwDb(error, "approver_delegations.select(active_for_actor)");

  const rows = Array.isArray(data) ? data : [];
  return rows.find((row: any) => isActiveDelegationNow(row, args.nowIso)) ?? null;
}

async function getStepApproverRows(supabase: any, stepId: string) {
  const { data, error } = await supabase.from("approval_step_approvers").select("*").eq("step_id", stepId);
  if (error) throwDb(error, "approval_step_approvers.select(by_step)");
  return Array.isArray(data) ? (data as any[]) : [];
}

async function countApprovedApproverSlotsForStep(supabase: any, stepId: string) {
  const rows = await getStepApproverRows(supabase, stepId);
  const approved = rows.filter((r) => lower((r as any)?.status) === "approved");
  return {
    rows,
    approvedCount: approved.length,
  };
}

async function markApproverSlotDecision(
  supabase: any,
  args: {
    approverRowId: string;
    actorUserId: string;
    nowIso: string;
    status: "approved" | "rejected";
    actingAsDelegate: boolean;
  }
) {
  const patchPrimary = {
    status: args.status,
    acted_at: args.nowIso,
    acted_by: args.actorUserId,
    decision_source: args.actingAsDelegate ? "delegated" : "direct",
  };

  const r1 = await supabase
    .from("approval_step_approvers")
    .update(patchPrimary)
    .eq("id", args.approverRowId)
    .in("status", ["pending", "active", "assigned", "not_started"]);

  if (!r1.error) return;

  const msg1 = safeStr(r1.error?.message);
  const patchFallback: Record<string, any> = {
    status: args.status,
    acted_at: args.nowIso,
  };

  const missingActedBy = isMissingColumnError(msg1, "acted_by");
  const missingDecisionSource = isMissingColumnError(msg1, "decision_source");
  const missingActedAt = isMissingColumnError(msg1, "acted_at");
  const missingStatus = isMissingColumnError(msg1, "status");

  if (missingActedBy || missingDecisionSource || missingActedAt || missingStatus) {
    if (missingActedAt) delete patchFallback.acted_at;
    if (missingStatus) delete patchFallback.status;

    const r2 = await supabase.from("approval_step_approvers").update(patchFallback).eq("id", args.approverRowId);

    if (r2.error) throwDb(r2.error, "approval_step_approvers.update(slot_decision_fallback)");
    return;
  }

  throwDb(r1.error, "approval_step_approvers.update(slot_decision)");
}

async function closeStepApproved(
  supabase: any,
  args: {
    stepId: string;
    actorId: string;
    nowIso: string;
  }
) {
  const r1 = await supabase
    .from("artifact_approval_steps")
    .update({
      status: "approved",
      approved_at: args.nowIso,
      approved_by: args.actorId,
      acted_at: args.nowIso,
      actor_id: args.actorId,
      completed_at: args.nowIso,
      is_active: false,
    })
    .eq("id", args.stepId)
    .in("status", ["pending", "active", "in_review", "submitted", "current", "pending_approval"]);

  if (!r1.error) return;

  const r2 = await supabase
    .from("artifact_approval_steps")
    .update({
      status: "approved",
      approved_at: args.nowIso,
      approved_by: args.actorId,
      is_active: false,
    })
    .eq("id", args.stepId);

  if (r2.error) throwDb(r2.error, "artifact_approval_steps.update(close_step_approved)");
}

async function activateStep(supabase: any, stepId: string, nowIso: string) {
  const r1 = await supabase
    .from("artifact_approval_steps")
    .update({ status: "active", is_active: true, started_at: nowIso })
    .eq("id", stepId)
    .in("status", ["pending", "submitted", "not_started"]);
  if (!r1.error) return;

  const r2 = await supabase
    .from("artifact_approval_steps")
    .update({ status: "active", is_active: true })
    .eq("id", stepId);
  if (r2.error) throwDb(r2.error, "artifact_approval_steps.update(activate)");
}

async function resolveActiveChainForArtifact(supabase: any, artifactId: string) {
  const { data: activeChainRow, error: chainErr } = await supabase
    .from("approval_chains")
    .select("*")
    .eq("artifact_id", artifactId)
    .eq("is_active", true)
    .maybeSingle();

  if (chainErr) throwDb(chainErr, "approval_chains.select(active_for_artifact)");

  const chain = (activeChainRow as any) ?? null;
  if (!chain?.id) throw new Error("No active approval chain found for this artifact.");
  if (isChainTerminalStatus(chain?.status) || chain?.is_active === false) {
    throw new Error("The approval chain is already closed.");
  }
  return chain;
}

async function assertApprovalAuditContext(
  supabase: any,
  args: {
    projectId: string;
    artifactId: string;
    actorId: string;
    action: string;
    chainId?: string | null;
    stepId?: string | null;
  }
) {
  const action = safeStr(args.action).trim().toLowerCase();
  if (!action) throw new Error("Audit action is required.");

  const actorId = safeStr(args.actorId).trim();
  if (!actorId) throw new Error("Audit actor is required.");

  const artifactId = safeStr(args.artifactId).trim();
  const projectId = safeStr(args.projectId).trim();
  if (!artifactId || !projectId) throw new Error("Audit artifact/project context is required.");

  const { data: artifactRow, error: artErr } = await supabase
    .from("artifacts")
    .select("id, project_id, approval_chain_id")
    .eq("id", artifactId)
    .maybeSingle();
  if (artErr) throwDb(artErr, "artifacts.select(audit_validate)");
  if (!artifactRow?.id) throw new Error("Audit validation failed: artifact not found.");
  if (safeStr((artifactRow as any)?.project_id) !== projectId) {
    throw new Error("Audit validation failed: artifact does not belong to project.");
  }

  const chainId = safeStr(args.chainId).trim();
  const stepId = safeStr(args.stepId).trim();

  if (chainId) {
    const { data: chainRow, error: chainErr } = await supabase
      .from("approval_chains")
      .select("id, artifact_id, project_id")
      .eq("id", chainId)
      .maybeSingle();
    if (chainErr) throwDb(chainErr, "approval_chains.select(audit_validate)");
    if (!chainRow?.id) throw new Error("Audit validation failed: approval chain not found.");
    if (safeStr((chainRow as any)?.artifact_id) !== artifactId) {
      throw new Error("Audit validation failed: chain does not belong to artifact.");
    }
    const chainProjectId = safeStr((chainRow as any)?.project_id).trim();
    if (chainProjectId && chainProjectId !== projectId) {
      throw new Error("Audit validation failed: chain does not belong to project.");
    }

    if (stepId) {
      const { data: stepRow, error: stepErr } = await supabase
        .from("artifact_approval_steps")
        .select("id, chain_id, artifact_id")
        .eq("id", stepId)
        .maybeSingle();
      if (stepErr) throwDb(stepErr, "artifact_approval_steps.select(audit_validate)");
      if (!stepRow?.id) throw new Error("Audit validation failed: approval step not found.");
      if (safeStr((stepRow as any)?.chain_id) !== chainId) {
        throw new Error("Audit validation failed: step does not belong to chain.");
      }
      const stepArtifactId = safeStr((stepRow as any)?.artifact_id).trim();
      if (stepArtifactId && stepArtifactId !== artifactId) {
        throw new Error("Audit validation failed: step does not belong to artifact.");
      }
    }
  } else if (stepId) {
    throw new Error("Audit validation failed: stepId provided without chainId.");
  }
}

async function writeApprovalAuditLogValidated(
  supabase: any,
  args: {
    projectId: string;
    artifactId: string;
    actorId: string;
    action: string;
    chainId?: string | null;
    stepId?: string | null;
    before?: any;
    after?: any;
  }
) {
  await assertApprovalAuditContext(supabase, {
    projectId: args.projectId,
    artifactId: args.artifactId,
    actorId: args.actorId,
    action: args.action,
    chainId: args.chainId ?? null,
    stepId: args.stepId ?? null,
  });

  await writeAuditLog(supabase, {
    project_id: args.projectId,
    artifact_id: args.artifactId,
    actor_id: args.actorId,
    action: args.action,
    before: {
      ...(args.before ?? {}),
      approval_chain_id: args.chainId ?? null,
      step_id: args.stepId ?? null,
    },
    after: {
      ...(args.after ?? {}),
      approval_chain_id: args.chainId ?? null,
      step_id: args.stepId ?? null,
    },
  });
}

async function assertUserCanActOnCurrentStep(
  supabase: any,
  args: {
    stepId: string;
    userId: string;
    myRole: string;
    organisationId?: string | null;
    nowIso: string;
  }
) {
  const rows = await getStepApproverRows(supabase, args.stepId);

  if (!rows.length) {
    if (!canApproveByRole(args.myRole)) throw new Error("You are not an eligible approver for this step.");
    return {
      matchedApprover: null,
      approverCount: 0,
      actingAsDelegate: false,
      delegatedFromUserId: null,
      delegationId: null,
    };
  }

  const directMatch = rows.find((r) => safeStr((r as any)?.user_id) === args.userId) ?? null;

  if (directMatch) {
    const st = lower((directMatch as any)?.status);
    if (st === "approved") throw new Error("You have already approved this step.");
    if (st === "rejected" || st === "changes_requested") throw new Error("This approval slot has already been completed.");
    if (st === "cancelled" || st === "closed" || st === "skipped") throw new Error("This approval slot is already closed.");

    return {
      matchedApprover: directMatch,
      approverCount: rows.length,
      actingAsDelegate: false,
      delegatedFromUserId: safeStr((directMatch as any)?.user_id) || null,
      delegationId: null,
    };
  }

  for (const row of rows) {
    const approverUserId = safeStr((row as any)?.user_id).trim();
    if (!approverUserId) continue;

    const grant = await getActiveDelegateGrantForApprover(supabase, {
      organisationId: args.organisationId ?? null,
      approverUserId,
      actorUserId: args.userId,
      nowIso: args.nowIso,
    });

    if (!grant?.id) continue;

    const st = lower((row as any)?.status);
    if (st === "approved") throw new Error("This approval slot has already been completed by the approver or delegate.");
    if (st === "rejected" || st === "changes_requested") throw new Error("This approval slot has already been completed.");
    if (st === "cancelled" || st === "closed" || st === "skipped") throw new Error("This approval slot is already closed.");

    return {
      matchedApprover: row,
      approverCount: rows.length,
      actingAsDelegate: true,
      delegatedFromUserId: approverUserId,
      delegationId: safeStr(grant?.id) || null,
    };
  }

  throw new Error("You are not assigned to the current approval step and do not have an active delegate approval grant.");
}

async function assertApprovalActionAllowed(
  supabase: any,
  args: {
    projectId: string;
    artifactId: string;
    userId: string;
    myRole: string;
    organisationId?: string | null;
    nowIso: string;
  }
) {
  const chain = await resolveActiveChainForArtifact(supabase, args.artifactId);
  const steps = sortApprovalSteps(await listApprovalStepsForChain(supabase, chain.id));
  if (!steps.length) throw new Error("No approval steps found for the active approval chain.");

  const currentStep = getCurrentStep(steps);
  if (!currentStep?.id) throw new Error("No current active approval step found.");

  if (isStepTerminalStatus(currentStep?.status)) {
    throw new Error("This approval step is already closed.");
  }

  const blockingStep = getBlockingPriorStep(steps, currentStep);
  if (blockingStep?.id) {
    const blockingOrder = firstFinite(
      blockingStep?.step_order,
      blockingStep?.step_index,
      blockingStep?.sequence,
      blockingStep?.order_no,
      0
    );
    const currentOrder = firstFinite(
      currentStep?.step_order,
      currentStep?.step_index,
      currentStep?.sequence,
      currentStep?.order_no,
      0
    );
    throw new Error(
      `Step ${currentOrder ?? "current"} cannot be actioned before Step ${blockingOrder ?? "previous"} is completed.`
    );
  }

  const approverInfo = await assertUserCanActOnCurrentStep(supabase, {
    stepId: currentStep.id,
    userId: args.userId,
    myRole: args.myRole,
    organisationId: args.organisationId ?? null,
    nowIso: args.nowIso,
  });

  return {
    chain,
    steps,
    currentStep,
    approverInfo,
  };
}

async function approveStepAtomic(
  supabase: any,
  args: {
    stepId: string;
    actorUserId: string;
    comment?: string | null;
  }
): Promise<AtomicApproveRpcResult> {
  const { data, error } = await supabase.rpc("approve_approval_step_atomic", {
    p_step_id: args.stepId,
    p_actor_user_id: args.actorUserId,
    p_comment: safeStr(args.comment).trim() || null,
  });

  if (error) {
    const msg = safeStr(error?.message);
    if (isMissingFunctionError(msg, "approve_approval_step_atomic")) {
      throw new Error(
        "Approval hardening migration is not applied yet. Run the latest database migration before approving."
      );
    }
    throwDb(error, "rpc.approve_approval_step_atomic");
  }

  const result = (data ?? null) as AtomicApproveRpcResult | null;
  if (!result || result.ok !== true) {
    throw new Error("Atomic approval failed.");
  }
  return result;
}

async function rejectStepAtomic(
  supabase: any,
  args: {
    stepId: string;
    actorUserId: string;
    reason?: string | null;
  }
): Promise<AtomicTerminalRpcResult> {
  const { data, error } = await supabase.rpc("reject_approval_step_atomic", {
    p_step_id: args.stepId,
    p_actor_user_id: args.actorUserId,
    p_reason: safeStr(args.reason).trim() || null,
  });

  if (error) {
    const msg = safeStr(error?.message);
    if (isMissingFunctionError(msg, "reject_approval_step_atomic")) {
      throw new Error(
        "Approval hardening migration is not applied yet. Run the latest database migration before rejecting."
      );
    }
    throwDb(error, "rpc.reject_approval_step_atomic");
  }

  const result = (data ?? null) as AtomicTerminalRpcResult | null;
  if (!result || result.ok !== true) {
    throw new Error("Atomic reject failed.");
  }
  return result;
}

async function requestChangesStepAtomic(
  supabase: any,
  args: {
    stepId: string;
    actorUserId: string;
    reason?: string | null;
  }
): Promise<AtomicTerminalRpcResult> {
  const { data, error } = await supabase.rpc("request_changes_approval_step_atomic", {
    p_step_id: args.stepId,
    p_actor_user_id: args.actorUserId,
    p_reason: safeStr(args.reason).trim() || null,
  });

  if (error) {
    const msg = safeStr(error?.message);
    if (isMissingFunctionError(msg, "request_changes_approval_step_atomic")) {
      throw new Error(
        "Approval hardening migration is not applied yet. Run the latest database migration before requesting changes."
      );
    }
    throwDb(error, "rpc.request_changes_approval_step_atomic");
  }

  const result = (data ?? null) as AtomicTerminalRpcResult | null;
  if (!result || result.ok !== true) {
    throw new Error("Atomic request changes failed.");
  }
  return result;
}

async function getStepById(supabase: any, stepId: string) {
  const { data, error } = await supabase.from("artifact_approval_steps").select("*").eq("id", stepId).maybeSingle();
  if (error) throwDb(error, "artifact_approval_steps.select(by_id)");
  return (data as any) ?? null;
}

/* =========================================================
   Suggestions
========================================================= */

function clampInt(x: any, min: number, max: number) {
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  const v = Math.trunc(n);
  if (v < min || v > max) return null;
  return v;
}

export async function addSuggestion(formData: FormData) {
  const { supabase, user } = await requireUser();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const artifactId = String(formData.get("artifact_id") ?? "").trim();
  const anchor = String(formData.get("anchor") ?? "content").trim() || "content";
  const suggested_text = String(formData.get("suggested_text") ?? "").trim();
  const color = String(formData.get("color") ?? "#2563eb").trim() || "#2563eb";
  const bold = String(formData.get("bold") ?? "").toLowerCase() === "true";
  const italic = String(formData.get("italic") ?? "").toLowerCase() === "true";
  const range_start_raw = formData.get("range_start");
  const range_end_raw = formData.get("range_end");

  if (!projectId || !artifactId) throw new Error("project_id and artifact_id are required.");
  if (!suggested_text) throw new Error("suggested_text is required.");

  const myRole = await requireMemberRole(supabase, projectId, user.id);
  if (!(myRole === "owner" || myRole === "editor")) throw new Error("Only project owners/editors can add suggestions.");

  const a0 = await getArtifact(supabase, artifactId);
  if (String(a0.project_id) !== projectId) throw new Error("Artifact does not belong to this project.");

  let range: any = null;
  const contentLen = String(a0.content ?? "").length;
  const rs = range_start_raw !== null ? clampInt(range_start_raw, 0, contentLen) : null;
  const re = range_end_raw !== null ? clampInt(range_end_raw, 0, contentLen) : null;
  const anchorLower = anchor.toLowerCase();

  if ((anchorLower === "content" || anchorLower === "general") && rs !== null && re !== null && re >= rs) {
    range = { start: rs, end: re };
  }

  const { error } = await supabase.from("artifact_suggestions").insert({
    project_id: projectId,
    artifact_id: artifactId,
    actor_user_id: user.id,
    anchor,
    range,
    suggested_text,
    style: { color, bold, italic },
    status: "open",
  });
  if (error) throwDb(error, "artifact_suggestions.insert");

  await writeAuditLog(supabase, {
    project_id: projectId,
    artifact_id: artifactId,
    actor_id: user.id,
    action: "suggest_edit",
    before: { anchor, range: range ?? null },
    after: { anchor, range: range ?? null, style: { color, bold, italic } },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}

export async function applySuggestion(formData: FormData) {
  const { supabase, user } = await requireUser();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const artifactId = String(formData.get("artifact_id") ?? "").trim();
  const suggestionId = String(formData.get("suggestion_id") ?? "").trim();
  if (!projectId || !artifactId || !suggestionId) {
    throw new Error("project_id, artifact_id, suggestion_id are required.");
  }

  const myRole = await requireMemberRole(supabase, projectId, user.id);
  if (!(myRole === "owner" || myRole === "editor")) throw new Error("Only owners/editors can apply suggestions.");

  const { data: s0, error: sErr } = await supabase
    .from("artifact_suggestions")
    .select("id, status, anchor, range, suggested_text, style")
    .eq("id", suggestionId)
    .eq("project_id", projectId)
    .eq("artifact_id", artifactId)
    .maybeSingle();

  if (sErr) throwDb(sErr, "artifact_suggestions.select(apply)");
  if (!s0) throw new Error("Suggestion not found.");

  const status0 = String((s0 as any).status ?? "open").toLowerCase();
  if (status0 === "applied") {
    revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
    return;
  }

  const a0 = await getArtifact(supabase, artifactId);
  if (String(a0.project_id) !== projectId) throw new Error("Artifact does not belong to this project.");

  const approvalStatus = String(a0.approval_status ?? "draft").toLowerCase();
  if (a0.is_locked || !(approvalStatus === "draft" || approvalStatus === "changes_requested")) {
    throw new Error("You can only apply suggestions when the artifact is unlocked (draft/CR).");
  }

  const anchor = String((s0 as any).anchor ?? "content").toLowerCase();
  const suggestedText = String((s0 as any).suggested_text ?? "").trim();
  if (!suggestedText) throw new Error("Suggestion is empty.");

  const beforeArtifact = { title: a0.title, content: a0.content };

  if (anchor === "title") {
    const { error: upArtErr } = await supabase.from("artifacts").update({ title: suggestedText }).eq("id", artifactId);
    if (upArtErr) throwDb(upArtErr, "artifacts.update(apply_title)");
  } else {
    const content = String(a0.content ?? "");
    const range = (s0 as any).range as any;
    let nextContent = content;

    if (range && typeof range === "object") {
      const start = clampInt((range as any).start, 0, content.length);
      const end = clampInt((range as any).end, 0, content.length);

      if (start !== null && end !== null && end >= start) {
        nextContent = content.slice(0, start) + suggestedText + content.slice(end);
      } else {
        nextContent = content + "\n\n---\nAPPLIED SUGGESTION [" + anchor + "]\n" + suggestedText + "\n";
      }
    } else {
      nextContent = content + "\n\n---\nAPPLIED SUGGESTION [" + anchor + "]\n" + suggestedText + "\n";
    }

    const { error: upArtErr } = await supabase.from("artifacts").update({ content: nextContent }).eq("id", artifactId);
    if (upArtErr) throwDb(upArtErr, "artifacts.update(apply_content)");
  }

  const { error: upSugErr } = await supabase
    .from("artifact_suggestions")
    .update({ status: "applied" })
    .eq("id", suggestionId)
    .eq("project_id", projectId)
    .eq("artifact_id", artifactId);
  if (upSugErr) throwDb(upSugErr, "artifact_suggestions.update(applied)");

  await writeAuditLog(supabase, {
    project_id: projectId,
    artifact_id: artifactId,
    actor_id: user.id,
    action: "suggestion_applied_to_artifact",
    before: {
      suggestion_id: suggestionId,
      suggestion_status: status0,
      anchor,
      artifact: beforeArtifact,
    },
    after: {
      suggestion_id: suggestionId,
      suggestion_status: "applied",
      applied_to: anchor === "title" ? "title" : "content",
    },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}

export async function dismissSuggestion(formData: FormData) {
  const { supabase, user } = await requireUser();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const artifactId = String(formData.get("artifact_id") ?? "").trim();
  const suggestionId = String(formData.get("suggestion_id") ?? "").trim();
  if (!projectId || !artifactId || !suggestionId) {
    throw new Error("project_id, artifact_id, suggestion_id are required.");
  }

  const myRole = await requireMemberRole(supabase, projectId, user.id);
  if (!(myRole === "owner" || myRole === "editor")) throw new Error("Only owners/editors can dismiss suggestions.");

  const { data: s0, error: sErr } = await supabase
    .from("artifact_suggestions")
    .select("id, status")
    .eq("id", suggestionId)
    .eq("project_id", projectId)
    .eq("artifact_id", artifactId)
    .maybeSingle();

  if (sErr) throwDb(sErr, "artifact_suggestions.select(dismiss)");
  if (!s0) throw new Error("Suggestion not found.");

  const status0 = String((s0 as any).status ?? "open").toLowerCase();
  if (status0 === "dismissed") {
    revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
    return;
  }

  const { error: upErr } = await supabase
    .from("artifact_suggestions")
    .update({ status: "dismissed" })
    .eq("id", suggestionId)
    .eq("project_id", projectId)
    .eq("artifact_id", artifactId);
  if (upErr) throwDb(upErr, "artifact_suggestions.update(dismissed)");

  await writeAuditLog(supabase, {
    project_id: projectId,
    artifact_id: artifactId,
    actor_id: user.id,
    action: "suggestion_dismissed",
    before: { suggestion_id: suggestionId, status: status0 },
    after: { suggestion_id: suggestionId, status: "dismissed" },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}

/* =========================================================
   Artifact title rename
========================================================= */

export async function renameArtifactTitle(formData: FormData) {
  const { supabase, user } = await requireUser();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const artifactId = String(formData.get("artifact_id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();

  if (!projectId || !artifactId) throw new Error("project_id and artifact_id are required.");
  if (!title) throw new Error("Title is required.");

  const myRole = await requireMemberRole(supabase, projectId, user.id);
  const a0 = await getArtifact(supabase, artifactId);
  if (String(a0.project_id) !== projectId) throw new Error("Artifact does not belong to this project.");

  const isAuthor = String(a0.user_id) === user.id;
  if (!(isAuthor || myRole === "owner" || myRole === "editor")) {
    throw new Error("Only the author or owners/editors can rename the artifact.");
  }

  const approvalStatus = String(a0.approval_status ?? "draft").toLowerCase();
  if (a0.is_locked || !(approvalStatus === "draft" || approvalStatus === "changes_requested")) {
    throw new Error("You can only rename when the artifact is unlocked (draft or changes requested).");
  }

  const { error } = await supabase.from("artifacts").update({ title }).eq("id", artifactId);
  if (error) throwDb(error, "artifacts.update(rename_title)");

  await writeAuditLog(supabase, {
    project_id: projectId,
    artifact_id: artifactId,
    actor_id: user.id,
    action: "rename_title",
    before: { title: a0.title },
    after: { title },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}

/* =========================================================
   Submit for Approval
========================================================= */

export async function submitArtifactForApproval(projectId: string, artifactId: string) {
  const { supabase, user } = await requireUser();
  if (!projectId || !artifactId) throw new Error("projectId and artifactId are required.");

  const myRole = await requireMemberRole(supabase, projectId, user.id);
  const a0 = await getArtifact(supabase, artifactId);
  if (String(a0.project_id) !== projectId) throw new Error("Artifact does not belong to this project.");
  if (!a0.is_current) throw new Error("Only the current version can be submitted.");

  if (!isApprovalEligibleArtifact(a0.type)) {
    throw new Error(
      "Submit for approval is only enabled for Project Charter, Project Closure Report, and Financial Plan."
    );
  }

  const isAuthor = String(a0.user_id) === user.id;
  if (!canSubmitByRole(myRole, isAuthor)) {
    throw new Error("Only the author or project owners/editors can submit/resubmit.");
  }

  const st = lower(a0.approval_status || "draft");
  if (!(st === "draft" || st === "changes_requested")) {
    throw new Error(`Cannot submit from status: ${st}`);
  }

  if (isProjectCharterType(a0.type)) {
    assertCharterReadyForSubmit(a0.content_json);
  }

  const existingLinkedChainId = safeStr(a0.approval_chain_id).trim();
  if (existingLinkedChainId && st === "submitted") {
    throw new Error("This artifact already has an approval chain.");
  }

  const { data: allActiveChains, error: sweepErr } = await supabase
    .from("approval_chains")
    .select("id")
    .eq("artifact_id", artifactId)
    .eq("is_active", true);

  if (sweepErr) throwDb(sweepErr, "approval_chains.select(sweep_all_active)");

  const staleChainIds: string[] = (allActiveChains ?? [])
    .map((r: any) => safeStr(r?.id).trim())
    .filter(Boolean);

  for (const staleId of staleChainIds) {
    const linkedChainId = safeStr((a0 as any).approval_chain_id).trim();
    const artifactLooksSubmitted = st === "submitted" || st === "approved" || st === "rejected";
    const artifactLinkedToThis = !!linkedChainId && linkedChainId === staleId;

    if (artifactLooksSubmitted && artifactLinkedToThis) {
      revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
      revalidatePath(`/projects/${projectId}/artifacts`);
      return { ok: true, artifactId, approvalChainId: staleId, recovered: false, noOp: true };
    }

    await cancelApprovalChainArtifacts(supabase, staleId, artifactId);
  }

  const { data: postSweepCheck, error: postSweepErr } = await supabase
    .from("approval_chains")
    .select("id")
    .eq("artifact_id", artifactId)
    .eq("is_active", true)
    .limit(1);

  if (postSweepErr) throwDb(postSweepErr, "approval_chains.select(post_sweep_verify)");

  if ((postSweepCheck ?? []).length > 0) {
    throw new Error(
      `Artifact submit blocked: could not cancel all active approval chains for artifact ${artifactId}. Remaining chain id: ${safeStr((postSweepCheck as any)[0]?.id)}. Please retry in a moment.`
    );
  }

  {
    const adminDb = createAdminClient();

    await adminDb
      .from("artifact_approval_steps")
      .delete()
      .eq("artifact_id", artifactId)
      .neq("status", "approved");

    const { data: allChainsForArtifact } = await adminDb
      .from("approval_chains")
      .select("id")
      .eq("artifact_id", artifactId);

    const chainIdsToClean: string[] = (allChainsForArtifact ?? [])
      .map((c: any) => safeStr(c?.id).trim())
      .filter(Boolean);

    for (const cid of chainIdsToClean) {
      await adminDb
        .from("artifact_approval_steps")
        .delete()
        .eq("chain_id", cid)
        .neq("status", "approved");
    }
  }

  const organisationId = await getOrganisationIdForProject(supabase, projectId);
  if (!organisationId) throw new Error("Could not resolve organisation for this project.");

  const nowIso = new Date().toISOString();
  const adminDbForBuilder = createAdminClient();

  let runtime: any;
  try {
    runtime = await buildRuntimeApprovalChain(adminDbForBuilder, {
      organisationId,
      projectId,
      artifactId,
      actorId: user.id,
      artifactType: normalizeArtifactType(a0.type),
    });
  } catch (error: any) {
    const msg = safeStr(error?.message) || "unknown error";
    if (msg.toLowerCase().includes("already has an active approval chain")) {
      throw new Error("A previous approval submission is still being processed. Please wait a moment and try submitting again.");
    }
    throw new Error(`Runtime approval chain build failed: ${msg}`);
  }

  const runtimeChainId = safeStr(runtime?.chainId).trim();
  if (!runtimeChainId) throw new Error("Runtime approval chain build returned no chainId.");

  let runtimeHealth: {
    runtimeSteps: any[];
    firstPendingStep: any | null;
  };
  try {
    runtimeHealth = await verifyRuntimeApprovalChainHealth(adminDbForBuilder, {
      artifactId,
      chainId: runtimeChainId,
    });
  } catch (error) {
    await cancelApprovalChainArtifacts(adminDbForBuilder, runtimeChainId, artifactId);
    throw error;
  }

  const editSessionId = await getMyActiveEditSessionId(supabase, {
    artifactId,
    userId: user.id,
  });

  try {
    await createApprovalSubmissionSnapshotSafe({
      artifactId,
      approvalChainId: runtimeChainId,
      editSessionId,
    });
  } catch (error) {
    await cancelApprovalChainArtifacts(adminDbForBuilder, runtimeChainId, artifactId);
    throw error;
  }

  let updatedArtifact: any;
  try {
    updatedArtifact = await updateArtifactSubmitted(supabase, {
      artifactId,
      projectId,
      chainId: runtimeChainId,
      actorId: user.id,
      nowIso,
    });
  } catch (error) {
    await cancelApprovalChainArtifacts(adminDbForBuilder, runtimeChainId, artifactId);
    throw error;
  }

  const project = await getProjectNotificationContext(supabase, projectId);
  const submittedByName = await getUserDisplayName(supabase, user.id);

  try {
    await notifyFirstStepApprovers(supabase, {
      artifactId,
      artifactTitle: safeStr(a0.title).trim() || "Artifact",
      artifactType: safeStr(a0.type).trim() || "artifact",
      artifactAuthorUserId: safeStr(a0.user_id),
      project: project ?? null,
      projectFallbackRef: projectId,
      submittedByName,
    });
  } catch (notifyErr) {
    console.error("[submitArtifactForApproval] first-step notification failed:", notifyErr);
  }

  if (st === "changes_requested") {
    await addApprovalCommentSafe(supabase, {
      organisationId: safeStr((a0 as any)?.organisation_id || organisationId) || null,
      projectId,
      artifactId,
      chainId: runtimeChainId,
      stepId: null,
      authorUserId: user.id,
      commentType: "resubmit",
      body: "Artifact updated and resubmitted for approval.",
    });
  }

  await writeApprovalAuditLogValidated(supabase, {
    projectId,
    artifactId,
    actorId: user.id,
    action: st === "changes_requested" ? "resubmit" : "submit",
    chainId: runtimeChainId,
    before: {
      approval_status: a0.approval_status,
      approval_step_index: a0.approval_step_index ?? null,
      is_locked: a0.is_locked,
      approval_chain_id: a0.approval_chain_id ?? null,
      current_draft_rev: a0.current_draft_rev ?? null,
      current_version_no: a0.current_version_no ?? null,
      last_saved_version_id: a0.last_saved_version_id ?? null,
      status: a0.status ?? null,
    },
    after: {
      approval_status: safeStr(updatedArtifact?.approval_status || "submitted"),
      approval_step_index: Number(updatedArtifact?.approval_step_index ?? runtimeHealth.firstPendingStep?.step_order ?? 1),
      is_locked: updatedArtifact?.is_locked === true,
      approval_chain_id: safeStr(updatedArtifact?.approval_chain_id || runtimeChainId),
      submitted_at: safeStr(updatedArtifact?.submitted_at || nowIso),
      submitted_by: safeStr(updatedArtifact?.submitted_by || user.id),
      status: safeStr(updatedArtifact?.status || "submitted"),
      runtime_steps_created: true,
      runtime_artifact_type: safeStr(runtime?.chosenType || normalizeArtifactType(a0.type)),
      runtime_step_count: runtimeHealth.runtimeSteps.length,
      runtime_first_pending_step_id: safeStr(runtimeHealth.firstPendingStep?.id) || null,
      runtime_first_pending_step_order: Number(runtimeHealth.firstPendingStep?.step_order ?? 1),
      approval_submission_snapshot_created: true,
      approval_submission_snapshot_session_id: editSessionId,
    },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
  revalidatePath(`/projects/${projectId}/artifacts`);
  return {
    ok: true,
    artifactId,
    approvalChainId: runtimeChainId,
    recovered: staleChainIds.length > 0,
    noOp: false,
  };
}

/* =========================================================
   Approve / Request Changes / Reject
========================================================= */

export async function approveStep(projectId: string, artifactId: string, comment?: string) {
  const { supabase, user } = await requireUser();
  if (!projectId || !artifactId) throw new Error("projectId and artifactId are required.");

  const access = await resolveArtifactAccess({
    supabase,
    artifactId,
    userId: user.id,
  });

  if (!access.canViewArtifact) {
    throw new Error("You do not have access to this artifact.");
  }

  const a0 = await getArtifact(supabase, artifactId);
  if (String(a0.project_id) !== projectId) throw new Error("Artifact does not belong to this project.");
  if (!isApprovalEligibleArtifact(a0.type)) throw new Error("This artifact does not use approvals.");
  if (String(a0.user_id) === user.id) throw new Error("You cannot approve your own artifact.");

  const st = lower(a0.approval_status);
  if (st !== "submitted") throw new Error("Artifact is not currently submitted for approval.");

  if (!access.hasApprovalAccess && !access.hasCurrentStepApprovalAccess && !access.canApproveArtifact) {
    throw new Error("You do not have approval access for this artifact.");
  }

  const nowIso = new Date().toISOString();
  const myRole = safeStr(access.projectRole || "viewer").toLowerCase();

  const { chain, steps, currentStep, approverInfo } = await assertApprovalActionAllowed(supabase, {
    projectId,
    artifactId,
    userId: user.id,
    myRole,
    organisationId: safeStr((a0 as any)?.organisation_id) || null,
    nowIso,
  });

  const currentPos = getStepPosition(currentStep, steps);
  const project = await getProjectNotificationContext(supabase, projectId);
  const actorDisplayName = await getUserDisplayName(supabase, user.id);

  const atomic = await approveStepAtomic(supabase, {
    stepId: safeStr(currentStep.id),
    actorUserId: user.id,
    comment: comment ?? null,
  });

  await addApprovalCommentSafe(supabase, {
    organisationId: safeStr((a0 as any)?.organisation_id) || null,
    projectId,
    artifactId,
    chainId: safeStr((chain as any)?.id) || null,
    stepId: safeStr((currentStep as any)?.id) || null,
    authorUserId: user.id,
    commentType: "approve",
    body: comment ?? null,
  });

  const approvalsCount = Number.isFinite(Number(atomic.approved_count)) ? Number(atomic.approved_count) : null;
  const threshold = Number.isFinite(Number(atomic.required_approvals))
    ? Number(atomic.required_approvals)
    : getStepMinApprovals(currentStep, approverInfo.approverCount);

  const delegatedFromUserId =
    safeStr(atomic.delegated_from_user_id).trim() || approverInfo.delegatedFromUserId || null;

  const actedAsDelegate = lower(atomic.decision_source) === "delegated" || !!approverInfo.actingAsDelegate;

  if (lower(atomic.step_status) === "pending" && atomic.progressed !== true) {
    await writeApprovalAuditLogValidated(supabase, {
      projectId,
      artifactId,
      actorId: user.id,
      action: "approve_step_vote",
      chainId: chain.id,
      stepId: currentStep.id,
      before: {
        approval_status: a0.approval_status,
        is_locked: a0.is_locked,
        step_status: currentStep.status,
      },
      after: {
        approval_status: "submitted",
        step_status: "active",
        approvals_count: approvalsCount,
        min_approvals: threshold,
        step_closed: false,
        acted_as_delegate: actedAsDelegate,
        delegated_from_user_id: delegatedFromUserId,
        approval_slot_id: safeStr(atomic.slot_id) || safeStr(approverInfo.matchedApprover?.id) || null,
        delegation_id: approverInfo.delegationId ?? null,
        decision_source: safeStr(atomic.decision_source) || null,
      },
    });

    revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
    revalidatePath(`/projects/${projectId}/artifacts`);
    return;
  }

  if (safeStr(atomic.next_step_id).trim()) {
    const nextStepId = safeStr(atomic.next_step_id).trim();
    const nextStep = steps.find((s) => safeStr(s?.id) === nextStepId) ?? (await getStepById(supabase, nextStepId));

    try {
      await notifyNextStepApprovers(supabase, {
        artifactId,
        artifactTitle: safeStr(a0.title).trim() || "Artifact",
        artifactType: safeStr(a0.type).trim() || "artifact",
        project: project ?? null,
        projectFallbackRef: projectId,
        approvedByName: actorDisplayName,
      });
    } catch (notifyErr) {
      console.error("[approveStep] next-step notification failed:", notifyErr);
    }

    await writeApprovalAuditLogValidated(supabase, {
      projectId,
      artifactId,
      actorId: user.id,
      action: "approve_step",
      chainId: chain.id,
      stepId: currentStep.id,
      before: {
        approval_status: a0.approval_status,
        is_locked: a0.is_locked,
        step_status: currentStep.status,
        next_step_id: null,
      },
      after: {
        approval_status: "submitted",
        step_status: "approved",
        approvals_count: approvalsCount,
        min_approvals: threshold,
        next_step_id: nextStepId,
        next_step_status: safeStr(nextStep?.status || "active"),
        approval_step_index: Math.max(1, getStepOrderValue(nextStep, getStepOrderValue(currentStep, 1) + 1)),
        acted_as_delegate: actedAsDelegate,
        delegated_from_user_id: delegatedFromUserId,
        approval_slot_id: safeStr(atomic.slot_id) || safeStr(approverInfo.matchedApprover?.id) || null,
        delegation_id: approverInfo.delegationId ?? null,
        decision_source: safeStr(atomic.decision_source) || null,
      },
    });

    revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
    revalidatePath(`/projects/${projectId}/artifacts`);
    return;
  }

  await createApprovalApprovedSnapshotSafe({
    artifactId,
    approvalChainId: safeStr((chain as any)?.id) || null,
  });

  const baselineId = await promoteApprovedToBaseline(supabase, {
    projectId,
    approvedArtifactId: artifactId,
    artifactType: a0.type,
    actorId: user.id,
  });

  try {
    await notifyArtifactFullyApproved(supabase, {
      artifactId,
      artifactTitle: safeStr(a0.title).trim() || "Artifact",
      artifactType: safeStr(a0.type).trim() || "artifact",
      artifactAuthorUserId: safeStr(a0.user_id),
      project: project ?? null,
      projectFallbackRef: projectId,
      approvedByName: actorDisplayName,
    });
  } catch (notifyErr) {
    console.error("[approveStep] final-approval notification failed:", notifyErr);
  }

  await writeApprovalAuditLogValidated(supabase, {
    projectId,
    artifactId,
    actorId: user.id,
    action: "approve",
    chainId: chain.id,
    stepId: currentStep.id,
    before: {
      approval_status: a0.approval_status,
      is_locked: a0.is_locked,
      step_status: currentStep.status,
    },
    after: {
      approval_status: "approved",
      approved_by: user.id,
      approved_at: nowIso,
      chain_closed: true,
      step_status: "approved",
      approvals_count: approvalsCount,
      min_approvals: threshold,
      acted_as_delegate: actedAsDelegate,
      delegated_from_user_id: delegatedFromUserId,
      approval_slot_id: safeStr(atomic.slot_id) || safeStr(approverInfo.matchedApprover?.id) || null,
      delegation_id: approverInfo.delegationId ?? null,
      decision_source: safeStr(atomic.decision_source) || null,
      approval_approved_snapshot_created: true,
    },
  });

  await writeAuditLog(supabase, {
    project_id: projectId,
    artifact_id: artifactId,
    actor_id: user.id,
    action: "baseline_promoted",
    before: { is_baseline: false },
    after: { is_baseline: true, baseline_artifact_id: baselineId },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
  revalidatePath(`/projects/${projectId}/artifacts`);
}

export async function approveArtifact(projectId: string, artifactId: string, comment?: string) {
  return approveStep(projectId, artifactId, comment);
}

export async function requestChangesArtifact(projectId: string, artifactId: string, reason?: string) {
  const { supabase, user } = await requireUser();
  if (!projectId || !artifactId) throw new Error("projectId and artifactId are required.");

  const access = await resolveArtifactAccess({
    supabase,
    artifactId,
    userId: user.id,
  });

  if (!access.canViewArtifact) {
    throw new Error("You do not have access to this artifact.");
  }

  const a0 = await getArtifact(supabase, artifactId);
  if (String(a0.project_id) !== projectId) throw new Error("Artifact does not belong to this project.");
  if (!isApprovalEligibleArtifact(a0.type)) throw new Error("This artifact does not use approvals.");
  if (String(a0.user_id) === user.id) throw new Error("You cannot request changes on your own artifact.");

  const st = lower(a0.approval_status);
  if (st !== "submitted") throw new Error("Artifact is not currently submitted for approval.");

  if (!access.hasApprovalAccess && !access.hasCurrentStepApprovalAccess && !access.canApproveArtifact) {
    throw new Error("You do not have approval access for this artifact.");
  }

  const nowIso = new Date().toISOString();
  const myRole = safeStr(access.projectRole || "viewer").toLowerCase();

  const { chain, currentStep, approverInfo } = await assertApprovalActionAllowed(supabase, {
    projectId,
    artifactId,
    userId: user.id,
    myRole,
    organisationId: safeStr((a0 as any)?.organisation_id) || null,
    nowIso,
  });

  const project = await getProjectNotificationContext(supabase, projectId);
  const actorDisplayName = await getUserDisplayName(supabase, user.id);

  const atomic = await requestChangesStepAtomic(supabase, {
    stepId: safeStr(currentStep.id),
    actorUserId: user.id,
    reason: reason ?? null,
  });

  await addApprovalCommentSafe(supabase, {
    organisationId: safeStr((a0 as any)?.organisation_id) || null,
    projectId,
    artifactId,
    chainId: safeStr((chain as any)?.id) || null,
    stepId: safeStr((currentStep as any)?.id) || null,
    authorUserId: user.id,
    commentType: "request_changes",
    body: reason ?? null,
  });

  try {
    await notifyArtifactChangesRequested(supabase, {
      artifactId,
      artifactTitle: safeStr(a0.title).trim() || "Artifact",
      artifactType: safeStr(a0.type).trim() || "artifact",
      artifactAuthorUserId: safeStr(a0.user_id),
      project: project ?? null,
      projectFallbackRef: projectId,
      requestedByName: actorDisplayName,
      reason: reason ?? null,
    });
  } catch (notifyErr) {
    console.error("[requestChangesArtifact] notification failed:", notifyErr);
  }

  const delegatedFromUserId =
    safeStr(atomic.delegated_from_user_id).trim() || approverInfo.delegatedFromUserId || null;

  const actedAsDelegate = lower(atomic.decision_source) === "delegated" || !!approverInfo.actingAsDelegate;

  await writeApprovalAuditLogValidated(supabase, {
    projectId,
    artifactId,
    actorId: user.id,
    action: "request_changes",
    chainId: chain.id,
    stepId: currentStep.id,
    before: {
      approval_status: a0.approval_status,
      is_locked: a0.is_locked,
      step_status: currentStep.status,
    },
    after: {
      approval_status: safeStr(atomic.artifact_status || "changes_requested"),
      reason: reason ?? null,
      is_locked: false,
      chain_closed: true,
      step_status: safeStr(atomic.step_status || "changes_requested"),
      acted_as_delegate: actedAsDelegate,
      delegated_from_user_id: delegatedFromUserId,
      approval_slot_id: safeStr(atomic.slot_id) || safeStr(approverInfo.matchedApprover?.id) || null,
      delegation_id: approverInfo.delegationId ?? null,
      decision_source: safeStr(atomic.decision_source) || null,
    },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
  revalidatePath(`/projects/${projectId}/artifacts`);
}

export async function rejectFinalArtifact(projectId: string, artifactId: string, reason?: string) {
  const { supabase, user } = await requireUser();
  if (!projectId || !artifactId) throw new Error("projectId and artifactId are required.");

  const access = await resolveArtifactAccess({
    supabase,
    artifactId,
    userId: user.id,
  });

  if (!access.canViewArtifact) {
    throw new Error("You do not have access to this artifact.");
  }

  const a0 = await getArtifact(supabase, artifactId);
  if (String(a0.project_id) !== projectId) throw new Error("Artifact does not belong to this project.");
  if (!isApprovalEligibleArtifact(a0.type)) throw new Error("This artifact does not use approvals.");
  if (String(a0.user_id) === user.id) throw new Error("You cannot reject your own artifact.");

  const st = lower(a0.approval_status);
  if (st !== "submitted") throw new Error("Artifact is not currently submitted for approval.");

  if (!access.hasApprovalAccess && !access.hasCurrentStepApprovalAccess && !access.canApproveArtifact) {
    throw new Error("You do not have approval access for this artifact.");
  }

  const nowIso = new Date().toISOString();
  const myRole = safeStr(access.projectRole || "viewer").toLowerCase();

  const { chain, currentStep, approverInfo } = await assertApprovalActionAllowed(supabase, {
    projectId,
    artifactId,
    userId: user.id,
    myRole,
    organisationId: safeStr((a0 as any)?.organisation_id) || null,
    nowIso,
  });

  const project = await getProjectNotificationContext(supabase, projectId);
  const actorDisplayName = await getUserDisplayName(supabase, user.id);

  const atomic = await rejectStepAtomic(supabase, {
    stepId: safeStr(currentStep.id),
    actorUserId: user.id,
    reason: reason ?? null,
  });

  await addApprovalCommentSafe(supabase, {
    organisationId: safeStr((a0 as any)?.organisation_id) || null,
    projectId,
    artifactId,
    chainId: safeStr((chain as any)?.id) || null,
    stepId: safeStr((currentStep as any)?.id) || null,
    authorUserId: user.id,
    commentType: "reject",
    body: reason ?? null,
  });

  try {
    await notifyArtifactRejected(supabase, {
      artifactId,
      artifactTitle: safeStr(a0.title).trim() || "Artifact",
      artifactType: safeStr(a0.type).trim() || "artifact",
      artifactAuthorUserId: safeStr(a0.user_id),
      project: project ?? null,
      projectFallbackRef: projectId,
      rejectedByName: actorDisplayName,
      reason: reason ?? null,
    });
  } catch (notifyErr) {
    console.error("[rejectFinalArtifact] notification failed:", notifyErr);
  }

  const delegatedFromUserId =
    safeStr(atomic.delegated_from_user_id).trim() || approverInfo.delegatedFromUserId || null;

  const actedAsDelegate = lower(atomic.decision_source) === "delegated" || !!approverInfo.actingAsDelegate;

  await writeApprovalAuditLogValidated(supabase, {
    projectId,
    artifactId,
    actorId: user.id,
    action: "reject_final",
    chainId: chain.id,
    stepId: currentStep.id,
    before: {
      approval_status: a0.approval_status,
      is_locked: a0.is_locked,
      step_status: currentStep.status,
    },
    after: {
      approval_status: safeStr(atomic.artifact_status || "rejected"),
      reason: reason ?? null,
      is_locked: false,
      chain_closed: true,
      step_status: safeStr(atomic.step_status || "rejected"),
      acted_as_delegate: actedAsDelegate,
      delegated_from_user_id: delegatedFromUserId,
      approval_slot_id: safeStr(atomic.slot_id) || safeStr(approverInfo.matchedApprover?.id) || null,
      delegation_id: approverInfo.delegationId ?? null,
      decision_source: safeStr(atomic.decision_source) || null,
    },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
  revalidatePath(`/projects/${projectId}/artifacts`);
}

/* =========================================================
   Baseline promotion (internal)
========================================================= */

async function promoteApprovedToBaseline(
  supabase: any,
  args: { projectId: string; approvedArtifactId: string; artifactType: string | null; actorId: string }
): Promise<string> {
  const { projectId, approvedArtifactId, artifactType, actorId } = args;
  if (!artifactType) throw new Error("Artifact type is required to create a baseline.");

  const { error: retireErr } = await supabase
    .from("artifacts")
    .update({ is_current: false })
    .eq("project_id", projectId)
    .eq("type", artifactType)
    .eq("is_baseline", true)
    .eq("is_current", true);
  if (retireErr) throwDb(retireErr, "artifacts.update(retire_baseline)");

  const a0 = await getArtifact(supabase, approvedArtifactId);
  const now = new Date().toISOString();

  const { data: inserted, error: insErr } = await supabase
    .from("artifacts")
    .insert({
      project_id: projectId,
      user_id: a0.user_id ?? actorId,
      type: a0.type,
      title: a0.title,
      content: String(a0.content ?? ""),
      content_json: a0.content_json ?? null,
      is_locked: true,
      locked_at: now,
      locked_by: actorId,
      version: (a0.version ?? 1) + 1,
      parent_artifact_id: a0.id,
      root_artifact_id: a0.root_artifact_id ?? a0.id,
      approval_status: "approved",
      approved_at: now,
      approved_by: actorId,
      is_current: true,
      is_baseline: true,
      status: "approved",
    })
    .select("id")
    .single();

  if (insErr) throwDb(insErr, "artifacts.insert(baseline)");
  return String(inserted.id);
}