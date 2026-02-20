//src/app/projects/[id]/members/actions.ts//
"use server";


import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { sendProjectInviteEmail } from "@/lib/email/sendProjectInvite";

/* --------------------------------
   Helpers
-------------------------------- */

function requireNonEmptyString(x: unknown, name: string) {
  if (typeof x !== "string" || !x.trim()) {
    throw new Error(`Invalid ${name}`);
  }
  return x.trim();
}

function requireUuid(x: unknown, name: string) {
  const v = requireNonEmptyString(x, name);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v
    )
  ) {
    throw new Error(`Invalid ${name} (expected uuid)`);
  }
  return v;
}

function normalizeEmail(email: unknown) {
  const v = requireNonEmptyString(email, "email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    throw new Error("Invalid email");
  }
  return v;
}

function requireOrigin() {
  const origin = process.env.APP_ORIGIN || process.env.NEXT_PUBLIC_APP_ORIGIN;
  if (!origin) throw new Error("Missing APP_ORIGIN or NEXT_PUBLIC_APP_ORIGIN");
  return origin.replace(/\/+$/, "");
}

type Role = "owner" | "editor" | "viewer";

/* --------------------------------
   MEMBER ACTIONS (RPC-only)
-------------------------------- */

export async function updateMemberRole(
  projectId: string,
  targetUserId: string,
  newRole: Role
) {
  const supabase = await createClient();

  const pid = requireUuid(projectId, "projectId");
  const uid = requireUuid(targetUserId, "targetUserId");

  const { error } = await supabase.rpc("rpc_update_project_member_role", {
    p_project_id: pid,
    p_target_user_id: uid,
    p_new_role: newRole,
  });

  if (error) throw error;

  revalidatePath(`/projects/${pid}/members`);
  revalidatePath(`/projects/${pid}`);
}

export async function removeMember(projectId: string, targetUserId: string) {
  const supabase = await createClient();

  const pid = requireUuid(projectId, "projectId");
  const uid = requireUuid(targetUserId, "targetUserId");

  const { error } = await supabase.rpc("rpc_remove_project_member", {
    p_project_id: pid,
    p_target_user_id: uid,
  });

  if (error) throw error;

  revalidatePath(`/projects/${pid}/members`);
  revalidatePath(`/projects/${pid}`);
}

export async function restoreMember(projectId: string, targetUserId: string) {
  const supabase = await createClient();

  const pid = requireUuid(projectId, "projectId");
  const uid = requireUuid(targetUserId, "targetUserId");

  const { error } = await supabase.rpc("rpc_restore_project_member", {
    p_project_id: pid,
    p_target_user_id: uid,
  });

  if (error) throw error;

  revalidatePath(`/projects/${pid}/members`);
  revalidatePath(`/projects/${pid}`);
}

/* --------------------------------
   INVITES (project_invites)
-------------------------------- */

export async function inviteMember(projectId: string, email: string, role: Role = "viewer") {
  const supabase = await createClient();

  const pid = requireUuid(projectId, "projectId");
  const eml = normalizeEmail(email);
  const origin = requireOrigin();

  // Auth (for inviter email)
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  // Project title for email
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id,title")
    .eq("id", pid)
    .maybeSingle();

  if (projErr) throw projErr;

  // Create invite + get token
  const { data, error } = await supabase.rpc("rpc_invite_project_member_token", {
    p_project_id: pid,
    p_email: eml,
    p_role: role,
  });

  if (error) throw error;

  const token = typeof data === "string" ? data : "";
  if (!token) throw new Error("Invite token not returned by rpc_invite_project_member_token");

  const inviteUrl = `${origin}/invite/${encodeURIComponent(token)}`;

  // Send email via Resend
  await sendProjectInviteEmail({
    to: eml,
    projectTitle: project?.title || "a project",
    inviterEmail: auth.user.email ?? null,
    inviteUrl,
  });

  revalidatePath(`/projects/${pid}/members`);
  revalidatePath(`/projects/${pid}`);

  return { token };
}

export async function resendInvite(inviteId: string, projectId: string) {
  const supabase = await createClient();

  const iid = requireUuid(inviteId, "inviteId");
  const pid = requireUuid(projectId, "projectId");
  const origin = requireOrigin();

  // Auth (for inviter email)
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  // Update resend timestamps/status via RPC (if you have it)
  const { error: resendErr } = await supabase.rpc("rpc_resend_project_invite", {
    p_invite_id: iid,
  });
  if (resendErr) throw resendErr;

  // Fetch invite details (email + role)
  const { data: invite, error: invErr } = await supabase
    .from("project_invites")
    .select("id, project_id, email, role")
    .eq("id", iid)
    .maybeSingle();

  if (invErr) throw invErr;
  if (!invite) throw new Error("Invite not found");
  if (String(invite.project_id) !== pid) throw new Error("Invite does not belong to project");

  const eml = normalizeEmail(invite.email);

  // Project title for email
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id,title")
    .eq("id", pid)
    .maybeSingle();

  if (projErr) throw projErr;

  // Re-mint token (same RPC)
  const { data: tokenData, error: tokErr } = await supabase.rpc("rpc_invite_project_member_token", {
    p_project_id: pid,
    p_email: eml,
    p_role: (invite.role as Role) ?? "viewer",
  });

  if (tokErr) throw tokErr;

  const token = typeof tokenData === "string" ? tokenData : "";
  if (!token) throw new Error("Invite token not returned for resend");

  const inviteUrl = `${origin}/invite/${encodeURIComponent(token)}`;

  // Send email via Resend
  await sendProjectInviteEmail({
    to: eml,
    projectTitle: project?.title || "a project",
    inviterEmail: auth.user.email ?? null,
    inviteUrl,
  });

  revalidatePath(`/projects/${pid}/members`);
  revalidatePath(`/projects/${pid}`);
}

export async function revokeInvite(inviteId: string, projectId: string) {
  const supabase = await createClient();

  const iid = requireUuid(inviteId, "inviteId");
  const pid = requireUuid(projectId, "projectId");

  const { error } = await supabase.rpc("rpc_revoke_project_invite", {
    p_invite_id: iid,
  });

  if (error) throw error;

  revalidatePath(`/projects/${pid}/members`);
  revalidatePath(`/projects/${pid}`);
}

/* --------------------------------
   INVITEE CLAIM FLOW (token)
-------------------------------- */

export async function acceptInviteByToken(token: string) {
  const supabase = await createClient();

  const tok = requireNonEmptyString(token, "token");

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) {
    redirect(`/login?next=${encodeURIComponent(`/invite/${encodeURIComponent(tok)}`)}`);
  }

  const { data, error } = await supabase.rpc("rpc_accept_project_invite_by_token", {
    p_token: tok,
  });

  if (error) throw error;

  const projectId =
    (typeof data === "string" && data) ||
    (data && typeof data === "object" && !Array.isArray(data) && (data as any).project_id) ||
    (Array.isArray(data) && (data as any)[0]?.project_id) ||
    "";

  const pid = projectId ? requireUuid(String(projectId), "projectId") : "";

  if (pid) {
    revalidatePath(`/projects/${pid}`);
    revalidatePath(`/projects/${pid}/members`);
  }
  revalidatePath(`/projects`);

  return { projectId: pid };
}
