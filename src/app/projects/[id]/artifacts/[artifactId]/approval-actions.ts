"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

// ✅ Charter submit validation
import { assertCharterReadyForSubmit } from "@/lib/charter/charter-validation";
import { buildRuntimeApprovalChain } from "@/lib/server/approvals/runtime-chain-builder";

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
  if (!mem) throw new Error("Not a project member.");
  return String((mem as any)?.role ?? "viewer").toLowerCase();
}

function canSubmitByRole(myRole: string, isAuthor: boolean) {
  return isAuthor || myRole === "owner" || myRole === "editor";
}

/**
 * Legacy fallback approver policy.
 * Runtime engine is now preferred on submit.
 * Direct approve / changes-request / reject still use this gate only
 * as a fallback when step approver rows are missing.
 */
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

/* =========================================================
   Artifact type helpers
========================================================= */

function isProjectCharterType(type: any) {
  const t = String(type ?? "").toLowerCase();
  return (
    t === "project_charter" ||
    t === "project charter" ||
    t === "charter" ||
    t === "projectcharter" ||
    t === "pid"
  );
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

function isApprovalEligibleArtifact(type: any) {
  return isProjectCharterType(type) || isClosureReportType(type);
}

function normalizeArtifactType(type: any) {
  if (isProjectCharterType(type)) return "project_charter";
  if (isClosureReportType(type)) return "project_closure_report";
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
  if (!msg1 || !isMissingColumnError(msg1, "organisation_id")) {
    return null;
  }

  const p2 = await supabase.from("projects").select("organization_id").eq("id", projectId).maybeSingle();

  if (!p2.error) {
    const id = safeStr((p2.data as any)?.organization_id);
    if (id) return id;
  }

  return null;
}

async function updateArtifactSubmitted(
  supabase: any,
  args: {
    artifactId: string;
    projectId: string;
    chainId: string;
    actorId: string;
    nowIso: string;
  }
) {
  const patch: any = {
    approval_chain_id: args.chainId,
    approval_status: "submitted",
    submitted_at: args.nowIso,
    submitted_by: args.actorId,
    is_locked: true,
  };

  const { data, error } = await supabase
    .from("artifacts")
    .update(patch)
    .eq("id", args.artifactId)
    .eq("project_id", args.projectId)
    .select("id, project_id, approval_status, approval_chain_id, is_locked, submitted_at, submitted_by")
    .maybeSingle();

  if (error) throwDb(error, "artifacts.update(submit_runtime_minimal)");

  if (!data?.id) {
    const { data: probe, error: probeErr } = await supabase
      .from("artifacts")
      .select("id, project_id, approval_status, approval_chain_id, is_locked, submitted_at, submitted_by")
      .eq("id", args.artifactId)
      .maybeSingle();

    if (probeErr) throwDb(probeErr, "artifacts.select(submit_probe)");

    throw new Error(
      [
        "Artifact submit update matched 0 rows.",
        "Most likely cause: artifacts UPDATE RLS/policy blocked the row.",
        `artifact_id=${args.artifactId}`,
        `project_id=${args.projectId}`,
        `probe_found=${probe?.id ? "yes" : "no"}`,
        `probe_status=${safeStr((probe as any)?.approval_status) || "null"}`,
        `probe_chain_id=${safeStr((probe as any)?.approval_chain_id) || "null"}`,
        `probe_is_locked=${String((probe as any)?.is_locked ?? "null")}`,
      ].join(" ")
    );
  }

  const updatedStatus = lower((data as any).approval_status);
  const updatedChainId = safeStr((data as any).approval_chain_id).trim();
  const updatedLocked = (data as any).is_locked === true;

  if (updatedStatus !== "submitted" || updatedChainId !== args.chainId || !updatedLocked) {
    throw new Error(
      [
        "Artifact submit verification failed after update.",
        "expected_status=submitted",
        `actual_status=${safeStr((data as any).approval_status) || "null"}`,
        `expected_chain_id=${args.chainId}`,
        `actual_chain_id=${updatedChainId || "null"}`,
        "expected_is_locked=true",
        `actual_is_locked=${String((data as any).is_locked ?? "null")}`,
      ].join(" ")
    );
  }

  return data as any;
}

async function clearArtifactApprovalLinkIfStale(
  supabase: any,
  artifactId: string,
  chainId: string
) {
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
      .update({
        approval_chain_id: null,
        is_locked: false,
      })
      .eq("id", artifactId);

    if (clrErr) throwDb(clrErr, "artifacts.update(clear_stale_link)");
  }
}

async function cancelApprovalChainArtifacts(
  supabase: any,
  chainId: string,
  artifactId?: string
) {
  const { error: stepsError } = await supabase
    .from("artifact_approval_steps")
    .update({ status: "cancelled" })
    .eq("chain_id", chainId);

  if (stepsError) throwDb(stepsError, "artifact_approval_steps.update(cancel_submit_failure)");

  const { error: chainError } = await supabase
    .from("approval_chains")
    .update({ is_active: false, status: "cancelled" })
    .eq("id", chainId);

  if (chainError) throwDb(chainError, "approval_chains.update(cancel_submit_failure)");

  if (artifactId) {
    await clearArtifactApprovalLinkIfStale(supabase, artifactId, chainId);
  }
}

async function getActiveApprovalChainForArtifact(supabase: any, artifactId: string) {
  const { data, error } = await supabase
    .from("approval_chains")
    .select("*")
    .eq("artifact_id", artifactId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throwDb(error, "approval_chains.select(active_for_artifact)");
  return (data as any) ?? null;
}

async function listApprovalStepsForChain(supabase: any, chainId: string) {
  const { data, error } = await supabase
    .from("artifact_approval_steps")
    .select("*")
    .eq("chain_id", chainId);

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
  const active =
    sortedSteps.find((s) => s?.is_active === true) ??
    sortedSteps.find((s) => {
      const st = lower(s?.status);
      return st === "active" || st === "current" || st === "in_progress" || st === "pending_approval";
    }) ??
    sortedSteps.find((s) => {
      const st = lower(s?.status);
      return st === "pending" || st === "submitted" || st === "not_started";
    });

  return active ?? null;
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

async function markStepApproved(supabase: any, stepId: string, userId: string, nowIso: string) {
  const patch1: any = {
    status: "approved",
    approved_at: nowIso,
    approved_by: userId,
    acted_at: nowIso,
    actor_id: userId,
    is_active: false,
  };

  const r1 = await supabase.from("artifact_approval_steps").update(patch1).eq("id", stepId);
  if (r1.error) {
    const patch2: any = {
      status: "approved",
      approved_at: nowIso,
      approved_by: userId,
      is_active: false,
    };
    const r2 = await supabase.from("artifact_approval_steps").update(patch2).eq("id", stepId);
    if (r2.error) throwDb(r2.error, "artifact_approval_steps.update(approve)");
  }

  const approverPatch1: any = {
    status: "approved",
    approved_at: nowIso,
    acted_at: nowIso,
  };
  const ap1 = await supabase
    .from("approval_step_approvers")
    .update(approverPatch1)
    .eq("step_id", stepId)
    .eq("user_id", userId);

  if (ap1.error) {
    const approverPatch2: any = {
      status: "approved",
      approved_at: nowIso,
    };
    const ap2 = await supabase
      .from("approval_step_approvers")
      .update(approverPatch2)
      .eq("step_id", stepId)
      .eq("user_id", userId);

    if (ap2.error) {
      const apMsg = safeStr(ap2.error?.message);
      if (
        !isMissingColumnError(apMsg, "approved_at") &&
        !isMissingColumnError(apMsg, "acted_at") &&
        !isMissingColumnError(apMsg, "status")
      ) {
        throwDb(ap2.error, "approval_step_approvers.update(approve)");
      }
    }
  }
}

async function activateStep(supabase: any, stepId: string, nowIso: string) {
  const patch1: any = {
    status: "active",
    is_active: true,
    started_at: nowIso,
  };

  const r1 = await supabase.from("artifact_approval_steps").update(patch1).eq("id", stepId);
  if (!r1.error) return;

  const patch2: any = {
    status: "active",
    is_active: true,
  };

  const r2 = await supabase.from("artifact_approval_steps").update(patch2).eq("id", stepId);
  if (r2.error) throwDb(r2.error, "artifact_approval_steps.update(activate)");
}

async function markActiveChainStepsClosed(
  supabase: any,
  chainId: string,
  nowIso: string,
  terminalStatus: "changes_requested" | "rejected"
) {
  const patch1: any = {
    is_active: false,
    status: terminalStatus,
    updated_at: nowIso,
  };

  const r1 = await supabase
    .from("artifact_approval_steps")
    .update(patch1)
    .eq("chain_id", chainId)
    .eq("is_active", true);
  if (!r1.error) return;

  const patch2: any = {
    is_active: false,
    status: terminalStatus,
  };

  const r2 = await supabase
    .from("artifact_approval_steps")
    .update(patch2)
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
  const patch1: any = {
    is_active: false,
    status: args.status,
    completed_at: args.nowIso,
    completed_by: args.actorId,
    closed_at: args.nowIso,
    closed_by: args.actorId,
    rejection_reason: args.reason ?? null,
  };

  const r1 = await supabase.from("approval_chains").update(patch1).eq("id", chainId);
  if (!r1.error) return;

  const patch2: any = {
    is_active: false,
    status: args.status,
    completed_at: args.nowIso,
    rejection_reason: args.reason ?? null,
  };

  const r2 = await supabase.from("approval_chains").update(patch2).eq("id", chainId);
  if (!r2.error) return;

  const patch3: any = {
    is_active: false,
    status: args.status,
  };

  const r3 = await supabase.from("approval_chains").update(patch3).eq("id", chainId);
  if (r3.error) throwDb(r3.error, "approval_chains.update(close)");
}

async function getStepApproverRows(supabase: any, stepId: string) {
  const { data, error } = await supabase
    .from("approval_step_approvers")
    .select("*")
    .eq("step_id", stepId);

  if (error) throwDb(error, "approval_step_approvers.select(by_step)");
  return Array.isArray(data) ? (data as any[]) : [];
}

async function assertUserCanActOnCurrentStep(
  supabase: any,
  args: {
    stepId: string;
    userId: string;
    myRole: string;
  }
) {
  const rows = await getStepApproverRows(supabase, args.stepId);

  if (!rows.length) {
    if (!canApproveByRole(args.myRole)) {
      throw new Error("You are not an eligible approver for this step.");
    }
    return { matchedApprover: null, approverCount: 0 };
  }

  const match =
    rows.find((r) => safeStr((r as any)?.user_id) === args.userId) ??
    rows.find((r) => safeStr((r as any)?.approver_user_id) === args.userId) ??
    rows.find((r) => safeStr((r as any)?.delegate_user_id) === args.userId) ??
    null;

  if (!match) throw new Error("You are not assigned to the current approval step.");

  const st = lower((match as any)?.status);
  if (st === "approved") throw new Error("You have already approved this step.");
  if (st === "rejected" || st === "changes_requested") {
    throw new Error("This step has already been completed.");
  }

  return { matchedApprover: match, approverCount: rows.length };
}

async function finalizeArtifactApproval(
  supabase: any,
  args: {
    artifactId: string;
    actorId: string;
    nowIso: string;
  }
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
  args: {
    artifactId: string;
    nextStepIndex: number;
  }
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

/* =========================================================
   Suggestions (unchanged)
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
  if (!(myRole === "owner" || myRole === "editor")) {
    throw new Error("Only project owners/editors can add suggestions.");
  }

  const a0 = await getArtifact(supabase, artifactId);
  if (String(a0.project_id) !== projectId) throw new Error("Artifact does not belong to this project.");

  const style = { color, bold, italic };

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
    style,
    status: "open",
  });

  if (error) throwDb(error, "artifact_suggestions.insert");

  await writeAuditLog(supabase, {
    project_id: projectId,
    artifact_id: artifactId,
    actor_id: user.id,
    action: "suggest_edit",
    before: { anchor, range: range ?? null },
    after: { anchor, range: range ?? null, style },
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
  if (!(myRole === "owner" || myRole === "editor")) {
    throw new Error("Only owners/editors can apply suggestions.");
  }

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
  const canMutateArtifact = !a0.is_locked && (approvalStatus === "draft" || approvalStatus === "changes_requested");
  if (!canMutateArtifact) {
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
        nextContent = content + `\n\n---\nAPPLIED SUGGESTION [${anchor}]\n${suggestedText}\n`;
      }
    } else {
      nextContent = content + `\n\n---\nAPPLIED SUGGESTION [${anchor}]\n${suggestedText}\n`;
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
    before: { suggestion_id: suggestionId, suggestion_status: status0, anchor, artifact: beforeArtifact },
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
  if (!(myRole === "owner" || myRole === "editor")) {
    throw new Error("Only owners/editors can dismiss suggestions.");
  }

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
   Artifact title rename (unchanged)
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
  const canRename = isAuthor || myRole === "owner" || myRole === "editor";
  if (!canRename) throw new Error("Only the author or owners/editors can rename the artifact.");

  const approvalStatus = String(a0.approval_status ?? "draft").toLowerCase();
  const unlocked = !a0.is_locked && (approvalStatus === "draft" || approvalStatus === "changes_requested");
  if (!unlocked) throw new Error("You can only rename when the artifact is unlocked (draft or changes requested).");

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
   Approvals — Governance runtime enabled
========================================================= */

export async function submitArtifactForApproval(projectId: string, artifactId: string) {
  const { supabase, user } = await requireUser();
  if (!projectId || !artifactId) throw new Error("projectId and artifactId are required.");

  const myRole = await requireMemberRole(supabase, projectId, user.id);
  const a0 = await getArtifact(supabase, artifactId);
  if (String(a0.project_id) !== projectId) throw new Error("Artifact does not belong to this project.");

  if (!a0.is_current) throw new Error("Only the current version can be submitted.");

  if (!isApprovalEligibleArtifact(a0.type)) {
    throw new Error("Submit for approval is only enabled for Project Charter and Project Closure Report.");
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

  const activeChain = await getActiveApprovalChainForArtifact(supabase, artifactId);

  if (activeChain?.id) {
    const activeChainId = safeStr(activeChain.id).trim();
    const linkedChainId = safeStr((a0 as any).approval_chain_id).trim();

    const artifactLooksSubmitted =
      st === "submitted" ||
      st === "approved" ||
      st === "rejected";

    const artifactLinkedToThisChain =
      !!linkedChainId && linkedChainId === activeChainId;

    if (artifactLooksSubmitted && artifactLinkedToThisChain) {
      revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
      revalidatePath(`/projects/${projectId}/artifacts`);
      return {
        ok: true,
        artifactId,
        approvalChainId: activeChainId,
        recovered: false,
        noOp: true,
      };
    }

    const recoverableDraftState =
      st === "draft" ||
      st === "changes_requested" ||
      !st;

    if (recoverableDraftState || !artifactLinkedToThisChain) {
      await cancelApprovalChainArtifacts(supabase, activeChainId, artifactId);
      await clearArtifactApprovalLinkIfStale(supabase, artifactId, activeChainId);
    } else {
      throw new Error(
        `Artifact submit blocked: active approval chain ${activeChainId} is already attached to artifact ${artifactId} in status ${st || "unknown"}.`
      );
    }
  }

  const organisationId = await getOrganisationIdForProject(supabase, projectId);
  if (!organisationId) {
    throw new Error("Could not resolve organisation for this project.");
  }

  const nowIso = new Date().toISOString();

  let runtime: any;
  try {
    runtime = await buildRuntimeApprovalChain({
      supabase,
      organisationId,
      projectId,
      artifactId,
      actorUserId: user.id,
      artifactType: normalizeArtifactType(a0.type),
    });
  } catch (error: any) {
    throw new Error(`Runtime approval chain build failed: ${safeStr(error?.message) || "unknown error"}`);
  }

  const runtimeChainId = safeStr(runtime?.chainId).trim();
  if (!runtimeChainId) {
    throw new Error("Runtime approval chain build returned no chainId.");
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
    await cancelApprovalChainArtifacts(supabase, runtimeChainId, artifactId);
    throw error;
  }

  await writeAuditLog(supabase, {
    project_id: projectId,
    artifact_id: artifactId,
    actor_id: user.id,
    action: st === "changes_requested" ? "resubmit" : "submit",
    before: {
      approval_status: a0.approval_status,
      is_locked: a0.is_locked,
      approval_chain_id: a0.approval_chain_id ?? null,
    },
    after: {
      approval_status: safeStr(updatedArtifact?.approval_status || "submitted"),
      is_locked: updatedArtifact?.is_locked === true,
      approval_chain_id: safeStr(updatedArtifact?.approval_chain_id || runtimeChainId),
      submitted_at: safeStr(updatedArtifact?.submitted_at || nowIso),
      submitted_by: safeStr(updatedArtifact?.submitted_by || user.id),
      runtime_steps_created: true,
      runtime_artifact_type: safeStr(runtime?.chosenType || normalizeArtifactType(a0.type)),
      runtime_step_count: Array.isArray(runtime?.stepIds) ? runtime.stepIds.length : 0,
    },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
  revalidatePath(`/projects/${projectId}/artifacts`);

  return {
    ok: true,
    artifactId,
    approvalChainId: runtimeChainId,
    recovered: !!activeChain?.id,
    noOp: false,
  };
}

export async function approveStep(projectId: string, artifactId: string) {
  const { supabase, user } = await requireUser();
  if (!projectId || !artifactId) throw new Error("projectId and artifactId are required.");

  const myRole = await requireMemberRole(supabase, projectId, user.id);

  const a0 = await getArtifact(supabase, artifactId);
  if (String(a0.project_id) !== projectId) throw new Error("Artifact does not belong to this project.");

  if (!isApprovalEligibleArtifact(a0.type)) throw new Error("This artifact does not use approvals.");
  if (String(a0.user_id) === user.id) throw new Error("You cannot approve your own artifact.");

  const st = lower(a0.approval_status);
  if (st !== "submitted") throw new Error("Artifact is not currently submitted for approval.");

  const chain = await getActiveApprovalChainForArtifact(supabase, artifactId);
  if (!chain?.id) {
    throw new Error("No active approval chain found for this artifact.");
  }

  const steps = sortApprovalSteps(await listApprovalStepsForChain(supabase, chain.id));
  if (!steps.length) {
    throw new Error("No approval steps found for the active approval chain.");
  }

  const currentStep = getCurrentStep(steps);
  if (!currentStep?.id) {
    throw new Error("No current active approval step found.");
  }

  await assertUserCanActOnCurrentStep(supabase, {
    stepId: currentStep.id,
    userId: user.id,
    myRole,
  });

  const nowIso = new Date().toISOString();

  const currentPos = getStepPosition(currentStep, steps);
  const nextStep = currentPos >= 0 ? steps[currentPos + 1] ?? null : null;

  await markStepApproved(supabase, currentStep.id, user.id, nowIso);

  if (nextStep?.id) {
    await activateStep(supabase, nextStep.id, nowIso);
    await moveArtifactToNextApprovalStep(supabase, {
      artifactId,
      nextStepIndex: Math.max(0, currentPos + 1),
    });

    await writeAuditLog(supabase, {
      project_id: projectId,
      artifact_id: artifactId,
      actor_id: user.id,
      action: "approve_step",
      before: {
        approval_status: a0.approval_status,
        approval_chain_id: chain.id,
        step_id: currentStep.id,
        next_step_id: null,
      },
      after: {
        approval_status: "submitted",
        approval_chain_id: chain.id,
        step_id: currentStep.id,
        step_status: "approved",
        next_step_id: nextStep.id,
        next_step_status: "active",
        approval_step_index: Math.max(0, currentPos + 1),
      },
    });

    revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
    revalidatePath(`/projects/${projectId}/artifacts`);
    return;
  }

  await finalizeArtifactApproval(supabase, {
    artifactId,
    actorId: user.id,
    nowIso,
  });

  const baselineId = await promoteApprovedToBaseline(supabase, {
    projectId,
    approvedArtifactId: artifactId,
    artifactType: a0.type,
    actorId: user.id,
  });

  await closeApprovalChain(supabase, chain.id, {
    status: "approved",
    actorId: user.id,
    nowIso,
  });

  await writeAuditLog(supabase, {
    project_id: projectId,
    artifact_id: artifactId,
    actor_id: user.id,
    action: "approve",
    before: {
      approval_status: a0.approval_status,
      is_locked: a0.is_locked,
      approval_chain_id: chain.id,
      step_id: currentStep.id,
    },
    after: {
      approval_status: "approved",
      approved_by: user.id,
      approved_at: nowIso,
      approval_chain_id: chain.id,
      chain_closed: true,
      step_id: currentStep.id,
      step_status: "approved",
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

/**
 * Backward-compatible export for existing UI/actions
 * while the client wiring is switched to approveStep().
 */
export async function approveArtifact(projectId: string, artifactId: string) {
  return approveStep(projectId, artifactId);
}

export async function requestChangesArtifact(projectId: string, artifactId: string, reason?: string) {
  const { supabase, user } = await requireUser();
  if (!projectId || !artifactId) throw new Error("projectId and artifactId are required.");

  const myRole = await requireMemberRole(supabase, projectId, user.id);

  const a0 = await getArtifact(supabase, artifactId);
  if (String(a0.project_id) !== projectId) throw new Error("Artifact does not belong to this project.");
  if (!isApprovalEligibleArtifact(a0.type)) throw new Error("This artifact does not use approvals.");
  if (String(a0.user_id) === user.id) throw new Error("You cannot request changes on your own artifact.");

  const st = String(a0.approval_status ?? "").toLowerCase();
  if (st !== "submitted") throw new Error("Artifact is not currently submitted for approval.");

  const chain = await getActiveApprovalChainForArtifact(supabase, artifactId);
  const steps = chain?.id ? sortApprovalSteps(await listApprovalStepsForChain(supabase, chain.id)) : [];
  const currentStep = getCurrentStep(steps);

  if (currentStep?.id) {
    await assertUserCanActOnCurrentStep(supabase, {
      stepId: currentStep.id,
      userId: user.id,
      myRole,
    });
  } else if (!canApproveByRole(myRole)) {
    throw new Error("You are not an eligible approver for this project.");
  }

  const nowIso = new Date().toISOString();

  const { error: upErr } = await supabase
    .from("artifacts")
    .update({
      approval_status: "changes_requested",
      rejected_at: nowIso,
      rejected_by: user.id,
      rejection_reason: reason ?? null,
      is_locked: false,
      locked_at: null,
      locked_by: null,
    })
    .eq("id", artifactId);

  if (upErr) throwDb(upErr, "artifacts.update(request_changes)");

  if (chain?.id) {
    if (currentStep?.id) {
      await markActiveChainStepsClosed(supabase, chain.id, nowIso, "changes_requested");
    }
    await closeApprovalChain(supabase, chain.id, {
      status: "changes_requested",
      actorId: user.id,
      nowIso,
      reason: reason ?? null,
    });
  }

  await writeAuditLog(supabase, {
    project_id: projectId,
    artifact_id: artifactId,
    actor_id: user.id,
    action: "request_changes",
    before: {
      approval_status: a0.approval_status,
      is_locked: a0.is_locked,
      approval_chain_id: chain?.id ?? null,
      step_id: currentStep?.id ?? null,
    },
    after: {
      approval_status: "changes_requested",
      reason: reason ?? null,
      is_locked: false,
      approval_chain_id: chain?.id ?? null,
      chain_closed: !!chain?.id,
    },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
  revalidatePath(`/projects/${projectId}/artifacts`);
}

export async function rejectFinalArtifact(projectId: string, artifactId: string, reason?: string) {
  const { supabase, user } = await requireUser();
  if (!projectId || !artifactId) throw new Error("projectId and artifactId are required.");

  const myRole = await requireMemberRole(supabase, projectId, user.id);

  const a0 = await getArtifact(supabase, artifactId);
  if (String(a0.project_id) !== projectId) throw new Error("Artifact does not belong to this project.");
  if (!isApprovalEligibleArtifact(a0.type)) throw new Error("This artifact does not use approvals.");
  if (String(a0.user_id) === user.id) throw new Error("You cannot reject your own artifact.");

  const st = String(a0.approval_status ?? "").toLowerCase();
  if (st !== "submitted") throw new Error("Artifact is not currently submitted for approval.");

  const chain = await getActiveApprovalChainForArtifact(supabase, artifactId);
  const steps = chain?.id ? sortApprovalSteps(await listApprovalStepsForChain(supabase, chain.id)) : [];
  const currentStep = getCurrentStep(steps);

  if (currentStep?.id) {
    await assertUserCanActOnCurrentStep(supabase, {
      stepId: currentStep.id,
      userId: user.id,
      myRole,
    });
  } else if (!canApproveByRole(myRole)) {
    throw new Error("You are not an eligible approver for this project.");
  }

  const nowIso = new Date().toISOString();

  const { error: upErr } = await supabase
    .from("artifacts")
    .update({
      approval_status: "rejected",
      rejected_at: nowIso,
      rejected_by: user.id,
      rejection_reason: reason ?? null,
      is_locked: false,
      locked_at: null,
      locked_by: null,
    })
    .eq("id", artifactId);

  if (upErr) throwDb(upErr, "artifacts.update(reject_final)");

  if (chain?.id) {
    if (currentStep?.id) {
      await markActiveChainStepsClosed(supabase, chain.id, nowIso, "rejected");
    }
    await closeApprovalChain(supabase, chain.id, {
      status: "rejected",
      actorId: user.id,
      nowIso,
      reason: reason ?? null,
    });
  }

  await writeAuditLog(supabase, {
    project_id: projectId,
    artifact_id: artifactId,
    actor_id: user.id,
    action: "reject_final",
    before: {
      approval_status: a0.approval_status,
      is_locked: a0.is_locked,
      approval_chain_id: chain?.id ?? null,
      step_id: currentStep?.id ?? null,
    },
    after: {
      approval_status: "rejected",
      reason: reason ?? null,
      is_locked: false,
      approval_chain_id: chain?.id ?? null,
      chain_closed: !!chain?.id,
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
      locked_at: new Date().toISOString(),
      locked_by: actorId,

      version: (a0.version ?? 1) + 1,
      parent_artifact_id: a0.id,
      root_artifact_id: a0.root_artifact_id ?? a0.id,

      approval_status: "approved",
      approved_at: new Date().toISOString(),
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