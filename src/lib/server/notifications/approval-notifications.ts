// src/lib/server/notifications/approval-notifications.ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  sendApprovalAssignedEmail,
  sendArtifactApprovedEmail,
  sendArtifactRejectedEmail,
  sendChangesRequestedEmail,
  sendChangeApprovalAssignedEmail,
  sendChangeApprovedEmail,
  sendChangeRejectedEmail,
  sendChangeChangesRequestedEmail,
} from "./resend";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function toProjectRef(project: any, fallback: string) {
  const raw = safeStr(project?.project_code).trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return `P-${String(Math.floor(n)).padStart(5, "0")}`;
}

async function getProfileMap(
  supabase: SupabaseClient,
  userIds: string[]
): Promise<Map<string, { name: string | null; email: string | null }>> {
  const map = new Map<string, { name: string | null; email: string | null }>();
  const ids = Array.from(new Set(userIds.map((x) => safeStr(x).trim()).filter(Boolean)));
  if (!ids.length) return map;
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, user_id, full_name, display_name, name, email")
    .or(ids.map((id) => `id.eq.${id},user_id.eq.${id}`).join(","));
  if (error || !profiles) return map;
  for (const p of profiles) {
    const key1 = safeStr((p as any)?.id).trim();
    const key2 = safeStr((p as any)?.user_id).trim();
    const name =
      safeStr((p as any)?.full_name).trim() ||
      safeStr((p as any)?.display_name).trim() ||
      safeStr((p as any)?.name).trim() || null;
    const email = safeStr((p as any)?.email).trim() || null;
    if (key1) map.set(key1, { name, email });
    if (key2) map.set(key2, { name, email });
  }
  return map;
}

function getProjectTitle(project: any) {
  return safeStr(project?.title).trim() || safeStr(project?.name).trim() || "Project";
}

function getArtifactUrl(baseUrl: string, projectRef: string, artifactId: string) {
  return `${baseUrl}/projects/${encodeURIComponent(projectRef)}/artifacts/${encodeURIComponent(artifactId)}`;
}

function getChangeUrl(baseUrl: string, projectRef: string, changeId: string) {
  return `${baseUrl}/projects/${encodeURIComponent(projectRef)}/change/${encodeURIComponent(changeId)}`;
}

async function getStepApprovers(
  supabase: SupabaseClient,
  stepId: string
): Promise<Array<{ user_id: string | null; email: string | null }>> {
  const { data, error } = await supabase
    .from("approval_step_approvers")
    .select("user_id, email")
    .eq("step_id", stepId);
  if (error) throw new Error(`Approval step approvers lookup failed: ${error.message}`);
  return Array.isArray(data) ? (data as Array<{ user_id: string | null; email: string | null }>) : [];
}

async function getFirstArtifactStepId(supabase: SupabaseClient, artifactId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("artifact_approval_steps").select("id")
    .eq("artifact_id", artifactId).eq("step_order", 1).maybeSingle();
  if (error) throw new Error(`First approval step lookup failed: ${error.message}`);
  return safeStr(data?.id).trim() || null;
}

async function getNextArtifactPendingStepId(supabase: SupabaseClient, artifactId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("artifact_approval_steps").select("id, step_order, status")
    .eq("artifact_id", artifactId).eq("status", "pending")
    .order("step_order", { ascending: true }).limit(1).maybeSingle();
  if (error) throw new Error(`Next approval step lookup failed: ${error.message}`);
  return safeStr(data?.id).trim() || null;
}

async function getFirstChangeStepId(supabase: SupabaseClient, changeId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("artifact_approval_steps").select("id")
    .eq("artifact_id", changeId).eq("step_order", 1).maybeSingle();
  if (error) throw new Error(`First change approval step lookup failed: ${error.message}`);
  return safeStr(data?.id).trim() || null;
}

async function getNextChangePendingStepId(supabase: SupabaseClient, changeId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("artifact_approval_steps").select("id, step_order, status")
    .eq("artifact_id", changeId).eq("status", "pending")
    .order("step_order", { ascending: true }).limit(1).maybeSingle();
  if (error) throw new Error(`Next change approval step lookup failed: ${error.message}`);
  return safeStr(data?.id).trim() || null;
}

// ---------------------------------------------------------------------------
// DB notification writer - inserts into notifications table
// ---------------------------------------------------------------------------
async function writeNotification(
  supabase: SupabaseClient,
  row: {
    user_id: string;
    project_id?: string | null;
    artifact_id?: string | null;
    type: string;
    title: string;
    body: string;
    link?: string | null;
    source_type?: string | null;
    source_id?: string | null;
    bucket?: string | null;
    metadata?: any;
  }
) {
  try {
    await supabase.from("notifications").insert({
      ...row,
      is_read: false,
      created_at: new Date().toISOString(),
    });
  } catch (_) {
    // Non-blocking -- never fail the main action over a notification insert
  }
}

// ---------------------------------------------------------------------------
// ARTIFACT NOTIFICATIONS
// ---------------------------------------------------------------------------

export async function notifyFirstStepApprovers(
  supabase: SupabaseClient,
  args: {
    projectId: string;
    artifactId: string;
    artifactTitle: string;
    artifactType: string;
    project: any;
    projectFallbackRef: string;
    submittedByName?: string | null;
  }
) {
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("Missing env var: APP_BASE_URL");

  const firstStepId = await getFirstArtifactStepId(supabase, args.artifactId);
  if (!firstStepId) return;

  const rows = await getStepApprovers(supabase, firstStepId);
  if (!rows.length) return;

  const userIds = Array.from(new Set(rows.map((r) => safeStr(r?.user_id).trim()).filter(Boolean)));
  const profileMap = await getProfileMap(supabase, userIds);
  const projectTitle = getProjectTitle(args.project);
  const projectRef = toProjectRef(args.project, args.projectFallbackRef);
  const artifactUrl = getArtifactUrl(baseUrl, projectRef, args.artifactId);

  for (const row of rows) {
    const userId = safeStr(row?.user_id).trim();
    const to = safeStr(row?.email).trim() || profileMap.get(userId)?.email || "";
    if (!to && !userId) continue;

    // DB notification
    if (userId) {
      void writeNotification(supabase, {
        user_id: userId,
        project_id: args.projectId,
        artifact_id: args.artifactId,
        type: "approval_required",
        title: `Approval required: ${args.artifactTitle}`,
        body: args.submittedByName
          ? `${args.submittedByName} submitted "${args.artifactTitle}" for your approval.`
          : `"${args.artifactTitle}" has been submitted for your approval.`,
        link: artifactUrl,
        source_type: "artifact",
        source_id: args.artifactId,
        bucket: "action_required",
        metadata: { artifactType: args.artifactType, projectTitle },
      });
    }

    // Email
    if (to) {
      await sendApprovalAssignedEmail({
        to,
        approverName: profileMap.get(userId)?.name ?? null,
        artifactTitle: args.artifactTitle,
        artifactType: args.artifactType,
        projectTitle,
        projectRef,
        artifactUrl,
        submittedByName: args.submittedByName ?? null,
      });
    }
  }
}

export async function notifyNextStepApprovers(
  supabase: SupabaseClient,
  args: {
    artifactId: string;
    artifactTitle: string;
    artifactType: string;
    project: any;
    projectFallbackRef: string;
    approvedByName?: string | null;
    projectId?: string | null;
  }
) {
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("Missing env var: APP_BASE_URL");

  const nextStepId = await getNextArtifactPendingStepId(supabase, args.artifactId);
  if (!nextStepId) return;

  const rows = await getStepApprovers(supabase, nextStepId);
  if (!rows.length) return;

  const userIds = Array.from(new Set(rows.map((r) => safeStr(r?.user_id).trim()).filter(Boolean)));
  const profileMap = await getProfileMap(supabase, userIds);
  const projectTitle = getProjectTitle(args.project);
  const projectRef = toProjectRef(args.project, args.projectFallbackRef);
  const artifactUrl = getArtifactUrl(baseUrl, projectRef, args.artifactId);

  for (const row of rows) {
    const userId = safeStr(row?.user_id).trim();
    const to = safeStr(row?.email).trim() || profileMap.get(userId)?.email || "";
    if (!to && !userId) continue;

    if (userId) {
      void writeNotification(supabase, {
        user_id: userId,
        project_id: args.projectId ?? null,
        artifact_id: args.artifactId,
        type: "approval_required",
        title: `Approval required: ${args.artifactTitle}`,
        body: `Step approved by ${args.approvedByName ?? "previous approver"}. Your review is now needed.`,
        link: artifactUrl,
        source_type: "artifact",
        source_id: args.artifactId,
        bucket: "action_required",
        metadata: { artifactType: args.artifactType, projectTitle },
      });
    }

    if (to) {
      await sendApprovalAssignedEmail({
        to,
        approverName: profileMap.get(userId)?.name ?? null,
        artifactTitle: args.artifactTitle,
        artifactType: args.artifactType,
        projectTitle,
        projectRef,
        artifactUrl,
        submittedByName: args.approvedByName ?? "Previous approver",
      });
    }
  }
}

export async function notifyArtifactChangesRequested(
  supabase: SupabaseClient,
  args: {
    artifactId: string;
    artifactTitle: string;
    artifactType: string;
    artifactAuthorUserId: string;
    project: any;
    projectFallbackRef: string;
    requestedByName?: string | null;
    reason?: string | null;
    projectId?: string | null;
  }
) {
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("Missing env var: APP_BASE_URL");

  const profileMap = await getProfileMap(supabase, [args.artifactAuthorUserId]);
  const author = profileMap.get(args.artifactAuthorUserId);
  const to = author?.email || "";
  const projectTitle = getProjectTitle(args.project);
  const projectRef = toProjectRef(args.project, args.projectFallbackRef);
  const artifactUrl = getArtifactUrl(baseUrl, projectRef, args.artifactId);

  void writeNotification(supabase, {
    user_id: args.artifactAuthorUserId,
    project_id: args.projectId ?? null,
    artifact_id: args.artifactId,
    type: "approval_pending",
    title: `Changes requested: ${args.artifactTitle}`,
    body: args.reason
      ? `${args.requestedByName ?? "An approver"} requested changes: ${args.reason}`
      : `${args.requestedByName ?? "An approver"} has requested changes to "${args.artifactTitle}".`,
    link: artifactUrl,
    source_type: "artifact",
    source_id: args.artifactId,
    bucket: "action_required",
    metadata: { artifactType: args.artifactType, projectTitle },
  });

  if (!to) return;
  await sendChangesRequestedEmail({
    to,
    recipientName: author?.name ?? null,
    artifactTitle: args.artifactTitle,
    artifactType: args.artifactType,
    projectTitle,
    projectRef,
    artifactUrl,
    requestedByName: args.requestedByName ?? null,
    reason: args.reason ?? null,
  });
}

export async function notifyArtifactFullyApproved(
  supabase: SupabaseClient,
  args: {
    artifactId: string;
    artifactTitle: string;
    artifactType: string;
    artifactAuthorUserId: string;
    project: any;
    projectFallbackRef: string;
    approvedByName?: string | null;
    projectId?: string | null;
  }
) {
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("Missing env var: APP_BASE_URL");

  const profileMap = await getProfileMap(supabase, [args.artifactAuthorUserId]);
  const author = profileMap.get(args.artifactAuthorUserId);
  const to = author?.email || "";
  const projectTitle = getProjectTitle(args.project);
  const projectRef = toProjectRef(args.project, args.projectFallbackRef);
  const artifactUrl = getArtifactUrl(baseUrl, projectRef, args.artifactId);

  void writeNotification(supabase, {
    user_id: args.artifactAuthorUserId,
    project_id: args.projectId ?? null,
    artifact_id: args.artifactId,
    type: "approval_required",
    title: `Approved: ${args.artifactTitle}`,
    body: `"${args.artifactTitle}" has been fully approved${args.approvedByName ? ` by ${args.approvedByName}` : ""}.`,
    link: artifactUrl,
    source_type: "artifact",
    source_id: args.artifactId,
    bucket: "info",
    metadata: { artifactType: args.artifactType, projectTitle },
  });

  if (!to) return;
  await sendArtifactApprovedEmail({
    to,
    recipientName: author?.name ?? null,
    artifactTitle: args.artifactTitle,
    artifactType: args.artifactType,
    projectTitle,
    projectRef,
    artifactUrl,
    approvedByName: args.approvedByName ?? null,
  });
}

export async function notifyArtifactRejected(
  supabase: SupabaseClient,
  args: {
    artifactId: string;
    artifactTitle: string;
    artifactType: string;
    artifactAuthorUserId: string;
    project: any;
    projectFallbackRef: string;
    rejectedByName?: string | null;
    reason?: string | null;
    projectId?: string | null;
  }
) {
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("Missing env var: APP_BASE_URL");

  const profileMap = await getProfileMap(supabase, [args.artifactAuthorUserId]);
  const author = profileMap.get(args.artifactAuthorUserId);
  const to = author?.email || "";
  const projectTitle = getProjectTitle(args.project);
  const projectRef = toProjectRef(args.project, args.projectFallbackRef);
  const artifactUrl = getArtifactUrl(baseUrl, projectRef, args.artifactId);

  void writeNotification(supabase, {
    user_id: args.artifactAuthorUserId,
    project_id: args.projectId ?? null,
    artifact_id: args.artifactId,
    type: "approval_pending",
    title: `Rejected: ${args.artifactTitle}`,
    body: args.reason
      ? `${args.rejectedByName ?? "An approver"} rejected "${args.artifactTitle}": ${args.reason}`
      : `"${args.artifactTitle}" was rejected${args.rejectedByName ? ` by ${args.rejectedByName}` : ""}.`,
    link: artifactUrl,
    source_type: "artifact",
    source_id: args.artifactId,
    bucket: "action_required",
    metadata: { artifactType: args.artifactType, projectTitle },
  });

  if (!to) return;
  await sendArtifactRejectedEmail({
    to,
    recipientName: author?.name ?? null,
    artifactTitle: args.artifactTitle,
    artifactType: args.artifactType,
    projectTitle,
    projectRef,
    artifactUrl,
    rejectedByName: args.rejectedByName ?? null,
    reason: args.reason ?? null,
  });
}

// ---------------------------------------------------------------------------
// CHANGE REQUEST NOTIFICATIONS
// ---------------------------------------------------------------------------

export async function notifyFirstChangeStepApprovers(
  supabase: SupabaseClient,
  args: {
    projectId: string;
    changeId: string;
    changeTitle: string;
    changeType: string;
    project: any;
    projectFallbackRef: string;
    submittedByName?: string | null;
  }
) {
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("Missing env var: APP_BASE_URL");

  const firstStepId = await getFirstChangeStepId(supabase, args.changeId);
  if (!firstStepId) return;

  const rows = await getStepApprovers(supabase, firstStepId);
  if (!rows.length) return;

  const userIds = Array.from(new Set(rows.map((r) => safeStr(r?.user_id).trim()).filter(Boolean)));
  const profileMap = await getProfileMap(supabase, userIds);
  const projectTitle = getProjectTitle(args.project);
  const projectRef = toProjectRef(args.project, args.projectFallbackRef);
  const changeUrl = getChangeUrl(baseUrl, projectRef, args.changeId);

  for (const row of rows) {
    const userId = safeStr(row?.user_id).trim();
    const to = safeStr(row?.email).trim() || profileMap.get(userId)?.email || "";
    if (!to && !userId) continue;

    if (userId) {
      void writeNotification(supabase, {
        user_id: userId,
        project_id: args.projectId,
        artifact_id: null,
        type: "approval_required",
        title: `Change approval required: ${args.changeTitle}`,
        body: args.submittedByName
          ? `${args.submittedByName} submitted a change request for your approval.`
          : `A change request "${args.changeTitle}" requires your approval.`,
        link: changeUrl,
        source_type: "change_request",
        source_id: args.changeId,
        bucket: "action_required",
        metadata: { changeType: args.changeType, projectTitle },
      });
    }

    if (to) {
      await sendChangeApprovalAssignedEmail({
        to,
        approverName: profileMap.get(userId)?.name ?? null,
        changeTitle: args.changeTitle,
        changeType: args.changeType,
        projectTitle,
        projectRef,
        changeUrl,
        submittedByName: args.submittedByName ?? null,
      });
    }
  }
}

export async function notifyNextChangeStepApprovers(
  supabase: SupabaseClient,
  args: {
    changeId: string;
    changeTitle: string;
    changeType: string;
    project: any;
    projectFallbackRef: string;
    approvedByName?: string | null;
    projectId?: string | null;
  }
) {
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("Missing env var: APP_BASE_URL");

  const nextStepId = await getNextChangePendingStepId(supabase, args.changeId);
  if (!nextStepId) return;

  const rows = await getStepApprovers(supabase, nextStepId);
  if (!rows.length) return;

  const userIds = Array.from(new Set(rows.map((r) => safeStr(r?.user_id).trim()).filter(Boolean)));
  const profileMap = await getProfileMap(supabase, userIds);
  const projectTitle = getProjectTitle(args.project);
  const projectRef = toProjectRef(args.project, args.projectFallbackRef);
  const changeUrl = getChangeUrl(baseUrl, projectRef, args.changeId);

  for (const row of rows) {
    const userId = safeStr(row?.user_id).trim();
    const to = safeStr(row?.email).trim() || profileMap.get(userId)?.email || "";
    if (!to && !userId) continue;

    if (userId) {
      void writeNotification(supabase, {
        user_id: userId,
        project_id: args.projectId ?? null,
        artifact_id: null,
        type: "approval_required",
        title: `Change approval required: ${args.changeTitle}`,
        body: `Step approved by ${args.approvedByName ?? "previous approver"}. Your review is now needed.`,
        link: changeUrl,
        source_type: "change_request",
        source_id: args.changeId,
        bucket: "action_required",
        metadata: { changeType: args.changeType, projectTitle },
      });
    }

    if (to) {
      await sendChangeApprovalAssignedEmail({
        to,
        approverName: profileMap.get(userId)?.name ?? null,
        changeTitle: args.changeTitle,
        changeType: args.changeType,
        projectTitle,
        projectRef,
        changeUrl,
        submittedByName: args.approvedByName ?? "Previous approver",
      });
    }
  }
}

export async function notifyChangeChangesRequested(
  supabase: SupabaseClient,
  args: {
    changeId: string;
    changeTitle: string;
    changeType: string;
    changeAuthorUserId: string;
    project: any;
    projectFallbackRef: string;
    requestedByName?: string | null;
    reason?: string | null;
    projectId?: string | null;
  }
) {
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("Missing env var: APP_BASE_URL");

  const profileMap = await getProfileMap(supabase, [args.changeAuthorUserId]);
  const author = profileMap.get(args.changeAuthorUserId);
  const to = author?.email || "";
  const projectTitle = getProjectTitle(args.project);
  const projectRef = toProjectRef(args.project, args.projectFallbackRef);
  const changeUrl = getChangeUrl(baseUrl, projectRef, args.changeId);

  void writeNotification(supabase, {
    user_id: args.changeAuthorUserId,
    project_id: args.projectId ?? null,
    artifact_id: null,
    type: "approval_pending",
    title: `Changes requested: ${args.changeTitle}`,
    body: args.reason
      ? `${args.requestedByName ?? "An approver"} requested changes: ${args.reason}`
      : `${args.requestedByName ?? "An approver"} requested changes to "${args.changeTitle}".`,
    link: changeUrl,
    source_type: "change_request",
    source_id: args.changeId,
    bucket: "action_required",
    metadata: { changeType: args.changeType, projectTitle },
  });

  if (!to) return;
  await sendChangeChangesRequestedEmail({
    to,
    recipientName: author?.name ?? null,
    changeTitle: args.changeTitle,
    changeType: args.changeType,
    projectTitle,
    projectRef,
    changeUrl,
    requestedByName: args.requestedByName ?? null,
    reason: args.reason ?? null,
  });
}

export async function notifyChangeFullyApproved(
  supabase: SupabaseClient,
  args: {
    changeId: string;
    changeTitle: string;
    changeType: string;
    changeAuthorUserId: string;
    project: any;
    projectFallbackRef: string;
    approvedByName?: string | null;
    projectId?: string | null;
  }
) {
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("Missing env var: APP_BASE_URL");

  const profileMap = await getProfileMap(supabase, [args.changeAuthorUserId]);
  const author = profileMap.get(args.changeAuthorUserId);
  const to = author?.email || "";
  const projectTitle = getProjectTitle(args.project);
  const projectRef = toProjectRef(args.project, args.projectFallbackRef);
  const changeUrl = getChangeUrl(baseUrl, projectRef, args.changeId);

  void writeNotification(supabase, {
    user_id: args.changeAuthorUserId,
    project_id: args.projectId ?? null,
    artifact_id: null,
    type: "approval_required",
    title: `Change approved: ${args.changeTitle}`,
    body: `"${args.changeTitle}" has been fully approved${args.approvedByName ? ` by ${args.approvedByName}` : ""}.`,
    link: changeUrl,
    source_type: "change_request",
    source_id: args.changeId,
    bucket: "info",
    metadata: { changeType: args.changeType, projectTitle },
  });

  if (!to) return;
  await sendChangeApprovedEmail({
    to,
    recipientName: author?.name ?? null,
    changeTitle: args.changeTitle,
    changeType: args.changeType,
    projectTitle,
    projectRef,
    changeUrl,
    approvedByName: args.approvedByName ?? null,
  });
}

export async function notifyChangeRejected(
  supabase: SupabaseClient,
  args: {
    changeId: string;
    changeTitle: string;
    changeType: string;
    changeAuthorUserId: string;
    project: any;
    projectFallbackRef: string;
    rejectedByName?: string | null;
    reason?: string | null;
    projectId?: string | null;
  }
) {
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("Missing env var: APP_BASE_URL");

  const profileMap = await getProfileMap(supabase, [args.changeAuthorUserId]);
  const author = profileMap.get(args.changeAuthorUserId);
  const to = author?.email || "";
  const projectTitle = getProjectTitle(args.project);
  const projectRef = toProjectRef(args.project, args.projectFallbackRef);
  const changeUrl = getChangeUrl(baseUrl, projectRef, args.changeId);

  void writeNotification(supabase, {
    user_id: args.changeAuthorUserId,
    project_id: args.projectId ?? null,
    artifact_id: null,
    type: "approval_pending",
    title: `Change rejected: ${args.changeTitle}`,
    body: args.reason
      ? `${args.rejectedByName ?? "An approver"} rejected "${args.changeTitle}": ${args.reason}`
      : `"${args.changeTitle}" was rejected${args.rejectedByName ? ` by ${args.rejectedByName}` : ""}.`,
    link: changeUrl,
    source_type: "change_request",
    source_id: args.changeId,
    bucket: "action_required",
    metadata: { changeType: args.changeType, projectTitle },
  });

  if (!to) return;
  await sendChangeRejectedEmail({
    to,
    recipientName: author?.name ?? null,
    changeTitle: args.changeTitle,
    changeType: args.changeType,
    projectTitle,
    projectRef,
    changeUrl,
    rejectedByName: args.rejectedByName ?? null,
    reason: args.reason ?? null,
  });
}