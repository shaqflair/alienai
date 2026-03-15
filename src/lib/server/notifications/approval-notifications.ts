import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  sendApprovalAssignedEmail,
  sendArtifactApprovedEmail,
  sendArtifactRejectedEmail,
  sendChangesRequestedEmail,
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
      safeStr((p as any)?.name).trim() ||
      null;
    const email = safeStr((p as any)?.email).trim() || null;

    if (key1) map.set(key1, { name, email });
    if (key2) map.set(key2, { name, email });
  }

  return map;
}

function getProjectTitle(project: any) {
  return (
    safeStr(project?.title).trim() ||
    safeStr(project?.name).trim() ||
    "Project"
  );
}

function getArtifactUrl(baseUrl: string, projectRef: string, artifactId: string) {
  return `${baseUrl}/projects/${encodeURIComponent(projectRef)}/artifacts/${encodeURIComponent(artifactId)}`;
}

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

  const { data: firstStep, error: firstStepErr } = await supabase
    .from("artifact_approval_steps")
    .select("id")
    .eq("artifact_id", args.artifactId)
    .eq("step_order", 1)
    .maybeSingle();

  if (firstStepErr) {
    throw new Error(`First approval step lookup failed: ${firstStepErr.message}`);
  }
  if (!firstStep?.id) return;

  const { data: approvers, error: approversErr } = await supabase
    .from("approval_step_approvers")
    .select("user_id, email")
    .eq("step_id", firstStep.id);

  if (approversErr) {
    throw new Error(`Approval step approvers lookup failed: ${approversErr.message}`);
  }

  const rows = Array.isArray(approvers) ? approvers : [];
  if (!rows.length) return;

  const userIds = Array.from(
    new Set(rows.map((r: any) => safeStr(r?.user_id).trim()).filter(Boolean))
  );

  const profileMap = await getProfileMap(supabase, userIds);
  const projectTitle = getProjectTitle(args.project);
  const projectRef = toProjectRef(args.project, args.projectFallbackRef);
  const artifactUrl = getArtifactUrl(baseUrl, projectRef, args.artifactId);

  for (const row of rows) {
    const to = safeStr((row as any)?.email).trim() || profileMap.get(safeStr((row as any)?.user_id).trim())?.email || "";
    const userId = safeStr((row as any)?.user_id).trim();
    if (!to) continue;

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

export async function notifyNextStepApprovers(
  supabase: SupabaseClient,
  args: {
    artifactId: string;
    artifactTitle: string;
    artifactType: string;
    project: any;
    projectFallbackRef: string;
    approvedByName?: string | null;
  }
) {
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("Missing env var: APP_BASE_URL");

  const { data: nextStep, error: nextStepErr } = await supabase
    .from("artifact_approval_steps")
    .select("id, step_order, status")
    .eq("artifact_id", args.artifactId)
    .eq("status", "pending")
    .order("step_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (nextStepErr) {
    throw new Error(`Next approval step lookup failed: ${nextStepErr.message}`);
  }
  if (!nextStep?.id) return;

  const { data: approvers, error: approversErr } = await supabase
    .from("approval_step_approvers")
    .select("user_id, email")
    .eq("step_id", nextStep.id);

  if (approversErr) {
    throw new Error(`Next step approvers lookup failed: ${approversErr.message}`);
  }

  const rows = Array.isArray(approvers) ? approvers : [];
  if (!rows.length) return;

  const userIds = Array.from(
    new Set(rows.map((r: any) => safeStr(r?.user_id).trim()).filter(Boolean))
  );

  const profileMap = await getProfileMap(supabase, userIds);
  const projectTitle = getProjectTitle(args.project);
  const projectRef = toProjectRef(args.project, args.projectFallbackRef);
  const artifactUrl = getArtifactUrl(baseUrl, projectRef, args.artifactId);

  for (const row of rows) {
    const userId = safeStr((row as any)?.user_id).trim();
    const to = safeStr((row as any)?.email).trim() || profileMap.get(userId)?.email || "";
    if (!to) continue;

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
  }
) {
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("Missing env var: APP_BASE_URL");

  const profileMap = await getProfileMap(supabase, [args.artifactAuthorUserId]);
  const author = profileMap.get(args.artifactAuthorUserId);
  const to = author?.email || "";
  if (!to) return;

  const projectTitle = getProjectTitle(args.project);
  const projectRef = toProjectRef(args.project, args.projectFallbackRef);
  const artifactUrl = getArtifactUrl(baseUrl, projectRef, args.artifactId);

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
  }
) {
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("Missing env var: APP_BASE_URL");

  const profileMap = await getProfileMap(supabase, [args.artifactAuthorUserId]);
  const author = profileMap.get(args.artifactAuthorUserId);
  const to = author?.email || "";
  if (!to) return;

  const projectTitle = getProjectTitle(args.project);
  const projectRef = toProjectRef(args.project, args.projectFallbackRef);
  const artifactUrl = getArtifactUrl(baseUrl, projectRef, args.artifactId);

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
  }
) {
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("Missing env var: APP_BASE_URL");

  const profileMap = await getProfileMap(supabase, [args.artifactAuthorUserId]);
  const author = profileMap.get(args.artifactAuthorUserId);
  const to = author?.email || "";
  if (!to) return;

  const projectTitle = getProjectTitle(args.project);
  const projectRef = toProjectRef(args.project, args.projectFallbackRef);
  const artifactUrl = getArtifactUrl(baseUrl, projectRef, args.artifactId);

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