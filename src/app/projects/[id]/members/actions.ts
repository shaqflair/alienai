"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

/* --------------------------------
   Helpers
-------------------------------- */

function requireNonEmptyString(x: unknown, name: string) {
  if (typeof x !== "string" || !x.trim()) throw new Error(`Invalid ${name}`);
  return x.trim();
}

function requireUuid(x: unknown, name: string) {
  const v = requireNonEmptyString(x, name);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v))
    throw new Error(`Invalid ${name} (expected uuid)`);
  return v;
}

type Role = "owner" | "editor" | "viewer";

/* --------------------------------
   MEMBER ACTIONS (RPC-only)
-------------------------------- */

export async function updateMemberRole(projectId: string, targetUserId: string, newRole: Role) {
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
   ADD MEMBER DIRECTLY FROM ORG
   Replaces invite flow — picks an
   existing org member and inserts
   them straight into project_members
-------------------------------- */

export async function addMemberFromOrg(
  projectId: string,
  targetUserId: string,
  role: Role = "viewer"
) {
  const supabase = await createClient();

  const pid = requireUuid(projectId, "projectId");
  const uid = requireUuid(targetUserId, "targetUserId");

  // Auth check
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  // Verify caller is project owner
  const { data: me } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", pid)
    .eq("user_id", auth.user.id)
    .is("removed_at", null)
    .maybeSingle();

  if (!me || String(me.role).toLowerCase() !== "owner")
    throw new Error("Only project owners can add members");

  // Upsert — handles re-adding a previously removed member
  const { error } = await supabase
    .from("project_members")
    .upsert(
      {
        project_id: pid,
        user_id: uid,
        role,
        removed_at: null,
      },
      { onConflict: "project_id,user_id" }
    );

  if (error) throw error;

  revalidatePath(`/projects/${pid}/members`);
  revalidatePath(`/projects/${pid}`);
}

/* --------------------------------
   KEEP revokeInvite for any
   existing pending invites cleanup
-------------------------------- */

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
   INVITEE CLAIM FLOW (token) — kept
   for any in-flight invite links
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