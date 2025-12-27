// src/app/projects/[id]/artifacts/[artifactId]/approval-actions.ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

/* ---------------------------
   Helpers
---------------------------- */
function throwDb(error: any, label: string): never {
  const code = error?.code ?? "";
  const msg = error?.message ?? "";
  const hint = error?.hint ?? "";
  const details = error?.details ?? "";
  throw new Error(
    `[${label}] ${code} ${msg}${hint ? ` | hint: ${hint}` : ""}${details ? ` | details: ${details}` : ""}`
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
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throwDb(error, "project_members.select");
  if (!mem) throw new Error("Not a project member.");
  return String((mem as any)?.role ?? "viewer").toLowerCase();
}

function requireOwnerOrEditor(role: string) {
  if (!(role === "owner" || role === "editor")) throw new Error("Only owners/editors can do that.");
}

async function isActiveProjectApprover(supabase: any, projectId: string, userId: string) {
  const { data, error } = await supabase
    .from("project_approvers")
    .select("user_id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throwDb(error, "project_approvers.select");
  return !!data;
}

function canSubmitByRole(myRole: string, isAuthor: boolean) {
  // ✅ Owners/editors + author can submit/resubmit.
  // Approvers alone cannot submit/resubmit.
  return isAuthor || myRole === "owner" || myRole === "editor";
}

function clampInt(x: any, min: number, max: number) {
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  const v = Math.trunc(n);
  if (v < min || v > max) return null;
  return v;
}

async function getArtifact(supabase: any, artifactId: string) {
  const { data, error } = await supabase
    .from("artifacts")
    .select(
      "id, project_id, user_id, type, title, content, is_locked, approval_status, submitted_at, submitted_by, approved_at, approved_by, rejected_at, rejected_by, rejection_reason, is_current, is_baseline, root_artifact_id, parent_artifact_id, version, updated_at"
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

/* ---------------------------
   Steps v2
---------------------------- */
type Step = {
  id: string;
  project_id: string;
  step_order: number;
  step_name: string;
  requires_all: boolean;
  min_approvals: number | null;
  is_active: boolean;
};

async function getActiveSteps(supabase: any, projectId: string): Promise<Step[]> {
  const { data, error } = await supabase
    .from("approval_steps")
    .select("id, project_id, step_order, step_name, requires_all, min_approvals, is_active")
    .eq("project_id", projectId)
    .eq("is_active", true)
    .order("step_order", { ascending: true });

  if (error) throwDb(error, "approval_steps.select");
  return (data ?? []) as Step[];
}

async function ensureDefaultStepsIfMissing(supabase: any, projectId: string) {
  const steps = await getActiveSteps(supabase, projectId);
  if (steps.length > 0) return;

  const { error } = await supabase.from("approval_steps").insert([
    {
      project_id: projectId,
      step_order: 1,
      step_name: "Approval",
      requires_all: true,
      min_approvals: null,
      is_active: true,
    },
  ]);
  if (error) throwDb(error, "approval_steps.insert(default)");
}

async function getActiveApproverCount(supabase: any, projectId: string): Promise<number> {
  const { data, error } = await supabase
    .from("project_approvers")
    .select("user_id")
    .eq("project_id", projectId)
    .eq("is_active", true);

  if (error) throwDb(error, "project_approvers.select(active)");
  return (data ?? []).length;
}

async function computeCurrentStep(
  supabase: any,
  projectId: string,
  artifactId: string
): Promise<{ steps: Step[]; current: Step | null; isFinalComplete: boolean }> {
  await ensureDefaultStepsIfMissing(supabase, projectId);
  const steps = await getActiveSteps(supabase, projectId);
  if (steps.length === 0) return { steps, current: null, isFinalComplete: true };

  const approverCount = await getActiveApproverCount(supabase, projectId);

  for (const step of steps) {
    const { data: approvals, error } = await supabase
      .from("approval_decisions")
      .select("approver_user_id")
      .eq("project_id", projectId)
      .eq("artifact_id", artifactId)
      .eq("step_id", step.id)
      .eq("decision", "approved");

    if (error) throwDb(error, "approval_decisions.select(approved)");

    const approvedCount = (approvals ?? []).length;
    const required = step.requires_all ? approverCount : Math.max(1, Number(step.min_approvals ?? 1));
    const isStepComplete = approvedCount >= required;

    if (!isStepComplete) return { steps, current: step, isFinalComplete: false };
  }

  return { steps, current: null, isFinalComplete: true };
}

async function recordDecision(
  supabase: any,
  args: {
    projectId: string;
    artifactId: string;
    stepId: string;
    approverUserId: string;
    decision: "approved" | "rejected";
    reason?: string;
  }
) {
  const { projectId, artifactId, stepId, approverUserId, decision, reason } = args;

  const { error } = await supabase
    .from("approval_decisions")
    .upsert(
      {
        project_id: projectId,
        artifact_id: artifactId,
        step_id: stepId,
        approver_user_id: approverUserId,
        decision,
        reason: reason ?? null,
      },
      { onConflict: "artifact_id,step_id,approver_user_id" }
    );

  if (error) throwDb(error, "approval_decisions.upsert");
}

/* ---------------------------
   Suggestions (approver "edits")
   - Optional range: { start, end } for true inline replace
---------------------------- */
export async function addSuggestion(formData: FormData) {
  const { supabase, user } = await requireUser();

  const projectId = String(formData.get("project_id") ?? "").trim();
  const artifactId = String(formData.get("artifact_id") ?? "").trim();
  const anchor = String(formData.get("anchor") ?? "content").trim() || "content";
  const suggested_text = String(formData.get("suggested_text") ?? "").trim();

  const color = String(formData.get("color") ?? "#2563eb").trim() || "#2563eb";
  const bold = String(formData.get("bold") ?? "").toLowerCase() === "true";
  const italic = String(formData.get("italic") ?? "").toLowerCase() === "true";

  // Optional range (numbers)
  const range_start_raw = formData.get("range_start");
  const range_end_raw = formData.get("range_end");

  if (!projectId || !artifactId) throw new Error("project_id and artifact_id are required.");
  if (!suggested_text) throw new Error("suggested_text is required.");

  const ok = await isActiveProjectApprover(supabase, projectId, user.id);
  if (!ok) throw new Error("Only active approvers can add suggestions.");

  const a0 = await getArtifact(supabase, artifactId);
  if (String(a0.project_id) !== projectId) throw new Error("Artifact does not belong to this project.");

  const style = { color, bold, italic };

  let range: any = null;
  const contentLen = String(a0.content ?? "").length;
  const rs = range_start_raw !== null ? clampInt(range_start_raw, 0, contentLen) : null;
  const re = range_end_raw !== null ? clampInt(range_end_raw, 0, contentLen) : null;

  // Only store range if both are valid and end >= start and anchor is content-ish
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

/* ---------------------------
   Apply / Dismiss suggestions (owners/editors)
   Apply = mark applied + auto-apply into artifact:
   - anchor=title => set artifacts.title = suggested_text
   - anchor=content/general:
       * if range exists => replace substring [start,end) with suggested_text
       * else => append a stamped block (safe)
---------------------------- */
export async function applySuggestion(formData: FormData) {
  const { supabase, user } = await requireUser();

  const projectId = String(formData.get("project_id") ?? "").trim();
  const artifactId = String(formData.get("artifact_id") ?? "").trim();
  const suggestionId = String(formData.get("suggestion_id") ?? "").trim();

  if (!projectId || !artifactId || !suggestionId) {
    throw new Error("project_id, artifact_id, suggestion_id are required.");
  }

  const myRole = await requireMemberRole(supabase, projectId, user.id);
  requireOwnerOrEditor(myRole);

  const { data: s0, error: sErr } = await supabase
    .from("artifact_suggestions")
    .select("id, status, anchor, range, suggested_text, style, actor_user_id, created_at")
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
    throw new Error("You can only apply suggestions into the artifact when it is unlocked (draft or changes requested).");
  }

  const anchor = String((s0 as any).anchor ?? "content").toLowerCase();
  const suggestedText = String((s0 as any).suggested_text ?? "").trim();
  if (!suggestedText) throw new Error("Suggestion is empty.");

  const beforeArtifact = { title: a0.title, content: a0.content };
  const nowIso = new Date().toISOString();

  if (anchor === "title") {
    const { error: upArtErr } = await supabase
      .from("artifacts")
      .update({ title: suggestedText, updated_at: nowIso })
      .eq("id", artifactId);

    if (upArtErr) throwDb(upArtErr, "artifacts.update(apply_title)");
  } else {
    const content = String(a0.content ?? "");
    const range = (s0 as any).range as any;

    let nextContent = content;
    let appliedMode: "range_replace" | "append" = "append";

    // ✅ Range replace if present and valid
    if (range && typeof range === "object") {
      const start = clampInt((range as any).start, 0, content.length);
      const end = clampInt((range as any).end, 0, content.length);

      if (start !== null && end !== null && end >= start) {
        // Replace [start, end)
        nextContent = content.slice(0, start) + suggestedText + content.slice(end);
        appliedMode = "range_replace";
      }
    }

    // Fallback safe append
    if (appliedMode === "append") {
      const stamp = new Date().toISOString().replace("T", " ").replace("Z", " UTC");
      const who = user.email ? ` (${user.email})` : "";
      const block =
        `\n\n---\n` +
        `APPLIED SUGGESTION [${anchor}] by ${user.id}${who} @ ${stamp}\n` +
        `${suggestedText}\n`;

      nextContent = content + block;
    }

    const { error: upArtErr } = await supabase
      .from("artifacts")
      .update({ content: nextContent, updated_at: nowIso })
      .eq("id", artifactId);

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
      suggestion_range: (s0 as any).range ?? null,
      artifact: beforeArtifact,
    },
    after: {
      suggestion_id: suggestionId,
      suggestion_status: "applied",
      anchor,
      applied_to: anchor === "title" ? "title" : "content",
      applied_mode: anchor === "title" ? "replace_title" : "range_or_append",
    },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}

export async function dismissSuggestion(formData: FormData) {
  const { supabase, user } = await requireUser();

  const projectId = String(formData.get("project_id") ?? "").trim();
  const artifactId = String(formData.get("artifact_id") ?? "").trim();
  const suggestionId = String(formData.get("suggestion_id") ?? "").trim();

  if (!projectId || !artifactId || !suggestionId) throw new Error("project_id, artifact_id, suggestion_id are required.");

  const myRole = await requireMemberRole(supabase, projectId, user.id);
  requireOwnerOrEditor(myRole);

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

/* ---------------------------
   Artifact name/title editable (rename)
---------------------------- */
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

  const { error } = await supabase
    .from("artifacts")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", artifactId);

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

/* ---------------------------
   Approvals
---------------------------- */
export async function submitArtifactForApproval(projectId: string, artifactId: string) {
  const { supabase, user } = await requireUser();
  if (!projectId || !artifactId) throw new Error("projectId and artifactId are required.");

  const myRole = await requireMemberRole(supabase, projectId, user.id);
  const a0 = await getArtifact(supabase, artifactId);
  if (String(a0.project_id) !== projectId) throw new Error("Artifact does not belong to this project.");

  const isAuthor = String(a0.user_id) === user.id;

  // ✅ HARD RULE: only author/owner/editor submit/resubmit
  if (!canSubmitByRole(myRole, isAuthor)) {
    throw new Error("Approvers can’t submit/resubmit. Only the author or project owners/editors can submit.");
  }

  const st = String(a0.approval_status ?? "draft").toLowerCase();
  if (!(st === "draft" || st === "changes_requested")) {
    throw new Error(`Cannot submit from status: ${st}`);
  }

  // resubmission resets approval run
  const { error: delErr } = await supabase
    .from("approval_decisions")
    .delete()
    .eq("project_id", projectId)
    .eq("artifact_id", artifactId);
  if (delErr) throwDb(delErr, "approval_decisions.delete(resubmit_reset)");

  await ensureDefaultStepsIfMissing(supabase, projectId);

  const { error: upErr } = await supabase
    .from("artifacts")
    .update({
      approval_status: "submitted",
      submitted_at: new Date().toISOString(),
      submitted_by: user.id,
      is_locked: true,
      locked_at: new Date().toISOString(),
      locked_by: user.id,
      rejected_at: null,
      rejected_by: null,
      rejection_reason: null,
    })
    .eq("id", artifactId);

  if (upErr) throwDb(upErr, "artifacts.update(submit)");

  await writeAuditLog(supabase, {
    project_id: projectId,
    artifact_id: artifactId,
    actor_id: user.id,
    action: st === "changes_requested" ? "resubmit" : "submit",
    before: { approval_status: a0.approval_status, is_locked: a0.is_locked },
    after: { approval_status: "submitted", is_locked: true },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}

export async function approveArtifact(projectId: string, artifactId: string) {
  const { supabase, user } = await requireUser();
  if (!projectId || !artifactId) throw new Error("projectId and artifactId are required.");

  await requireMemberRole(supabase, projectId, user.id);

  const isApprover = await isActiveProjectApprover(supabase, projectId, user.id);
  if (!isApprover) throw new Error("You are not an active approver for this project.");

  const a0 = await getArtifact(supabase, artifactId);
  if (String(a0.project_id) !== projectId) throw new Error("Artifact does not belong to this project.");
  if (String(a0.user_id) === user.id) throw new Error("You cannot approve your own artifact.");

  const st = String(a0.approval_status ?? "").toLowerCase();
  if (st !== "submitted") throw new Error("Artifact is not currently submitted for approval.");

  const { current } = await computeCurrentStep(supabase, projectId, artifactId);
  if (!current) return;

  await recordDecision(supabase, {
    projectId,
    artifactId,
    stepId: current.id,
    approverUserId: user.id,
    decision: "approved",
  });

  await writeAuditLog(supabase, {
    project_id: projectId,
    artifact_id: artifactId,
    actor_id: user.id,
    action: "approve",
    before: { step_id: current.id, step_order: current.step_order, approval_status: a0.approval_status },
    after: { step_id: current.id, step_order: current.step_order, decision: "approved" },
  });

  const post = await computeCurrentStep(supabase, projectId, artifactId);
  if (!post.isFinalComplete) {
    revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
    return;
  }

  const { error: upErr } = await supabase
    .from("artifacts")
    .update({
      approval_status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: user.id,
    })
    .eq("id", artifactId);

  if (upErr) throwDb(upErr, "artifacts.update(final_approve)");

  const baselineId = await promoteApprovedToBaseline(supabase, {
    projectId,
    approvedArtifactId: artifactId,
    artifactType: a0.type,
    actorId: user.id,
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
}

export async function requestChangesArtifact(projectId: string, artifactId: string, reason?: string) {
  const { supabase, user } = await requireUser();
  if (!projectId || !artifactId) throw new Error("projectId and artifactId are required.");

  await requireMemberRole(supabase, projectId, user.id);

  const isApprover = await isActiveProjectApprover(supabase, projectId, user.id);
  if (!isApprover) throw new Error("You are not an active approver for this project.");

  const a0 = await getArtifact(supabase, artifactId);
  if (String(a0.project_id) !== projectId) throw new Error("Artifact does not belong to this project.");
  if (String(a0.user_id) === user.id) throw new Error("You cannot request changes on your own artifact.");

  const st = String(a0.approval_status ?? "").toLowerCase();
  if (st !== "submitted") throw new Error("Artifact is not currently submitted for approval.");

  const { current } = await computeCurrentStep(supabase, projectId, artifactId);

  if (current) {
    await recordDecision(supabase, {
      projectId,
      artifactId,
      stepId: current.id,
      approverUserId: user.id,
      decision: "rejected",
      reason,
    });
  }

  const { error: upErr } = await supabase
    .from("artifacts")
    .update({
      approval_status: "changes_requested",
      rejected_at: new Date().toISOString(),
      rejected_by: user.id,
      rejection_reason: reason ?? null,
      is_locked: false,
      locked_at: null,
      locked_by: null,
    })
    .eq("id", artifactId);

  if (upErr) throwDb(upErr, "artifacts.update(request_changes)");

  await writeAuditLog(supabase, {
    project_id: projectId,
    artifact_id: artifactId,
    actor_id: user.id,
    action: "request_changes",
    before: { step_id: current?.id ?? null, step_order: current?.step_order ?? null, approval_status: a0.approval_status },
    after: { approval_status: "changes_requested", reason: reason ?? null },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}

export async function rejectFinalArtifact(projectId: string, artifactId: string, reason?: string) {
  const { supabase, user } = await requireUser();
  if (!projectId || !artifactId) throw new Error("projectId and artifactId are required.");

  await requireMemberRole(supabase, projectId, user.id);

  const isApprover = await isActiveProjectApprover(supabase, projectId, user.id);
  if (!isApprover) throw new Error("You are not an active approver for this project.");

  const a0 = await getArtifact(supabase, artifactId);
  if (String(a0.project_id) !== projectId) throw new Error("Artifact does not belong to this project.");
  if (String(a0.user_id) === user.id) throw new Error("You cannot reject your own artifact.");

  const st = String(a0.approval_status ?? "").toLowerCase();
  if (st !== "submitted") throw new Error("Artifact is not currently submitted for approval.");

  const { current } = await computeCurrentStep(supabase, projectId, artifactId);

  if (current) {
    await recordDecision(supabase, {
      projectId,
      artifactId,
      stepId: current.id,
      approverUserId: user.id,
      decision: "rejected",
      reason,
    });
  }

  const { error: upErr } = await supabase
    .from("artifacts")
    .update({
      approval_status: "rejected",
      rejected_at: new Date().toISOString(),
      rejected_by: user.id,
      rejection_reason: reason ?? null,
      is_locked: false,
      locked_at: null,
      locked_by: null,
    })
    .eq("id", artifactId);

  if (upErr) throwDb(upErr, "artifacts.update(reject_final)");

  await writeAuditLog(supabase, {
    project_id: projectId,
    artifact_id: artifactId,
    actor_id: user.id,
    action: "reject_final",
    before: { step_id: current?.id ?? null, step_order: current?.step_order ?? null, approval_status: a0.approval_status },
    after: { approval_status: "rejected", reason: reason ?? null },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}

/* ---------------------------
   Baseline promotion (internal)
---------------------------- */
async function promoteApprovedToBaseline(
  supabase: any,
  args: { projectId: string; approvedArtifactId: string; artifactType: string | null; actorId: string }
): Promise<string> {
  const { projectId, approvedArtifactId, artifactType, actorId } = args;
  if (!artifactType) throw new Error("Artifact type is required to create a baseline.");

  // Retire existing baseline (current)
  const { error: retireErr } = await supabase
    .from("artifacts")
    .update({ is_current: false, updated_at: new Date().toISOString() })
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
      content: a0.content,

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
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insErr) throwDb(insErr, "artifacts.insert(baseline)");
  return String(inserted.id);
}
