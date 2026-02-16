"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

type Role = "owner" | "editor" | "viewer";

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function normRole(x: string): Role {
  const r = String(x || "").trim().toLowerCase();
  return (r === "owner" || r === "editor" || r === "viewer") ? (r as Role) : "viewer";
}

function boolParam(x: unknown): boolean {
  const v = safeParam(x).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

async function requireOwner(supabase: any, projectId: string, userId: string) {
  const { data, error } = await supabase
    .from("project_members")
    .select("role, removed_at")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;

  const removed = !!data?.removed_at;
  const r = String(data?.role ?? "").toLowerCase();

  if (removed) throw new Error("Your membership is not active.");
  if (r !== "owner") throw new Error("Only project owners can manage members.");
}

export async function changeMemberRoleAction(formData: FormData) {
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect("/login");

  const projectId = safeParam(formData.get("projectId"));
  const memberId = safeParam(formData.get("memberId"));
  const role = normRole(safeParam(formData.get("role")));
  const isInvite = boolParam(formData.get("isInvite"));

  if (!projectId || !memberId) redirect("/projects");
  await requireOwner(supabase, projectId, auth.user.id);

  if (isInvite) {
    // Update invite role
    const { error } = await supabase
      .from("project_invites")
      .update({ role })
      .eq("id", memberId)
      .eq("project_id", projectId);

    if (error) throw error;

    redirect(`/projects/${projectId}/members?updated=1`);
  }

  // Update member role
  // Safety: don’t allow demoting the last owner (DB trigger likely exists, but do UX check)
  if (role !== "owner") {
    const { count, error: cErr } = await supabase
      .from("project_members")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId)
      .is("removed_at", null)
      .eq("role", "owner");

    if (cErr) throw cErr;

    const { data: target, error: tErr } = await supabase
      .from("project_members")
      .select("role")
      .eq("id", memberId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (tErr) throw tErr;

    if (String(target?.role).toLowerCase() === "owner" && (count ?? 0) <= 1) {
      redirect(
        `/projects/${projectId}/members?error=${encodeURIComponent("Cannot demote the last owner.")}`
      );
    }
  }

  const { error } = await supabase
    .from("project_members")
    .update({ role })
    .eq("id", memberId)
    .eq("project_id", projectId);

  if (error) throw error;

  redirect(`/projects/${projectId}/members?updated=1`);
}

export async function removeMemberAction(formData: FormData) {
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect("/login");

  const projectId = safeParam(formData.get("projectId"));
  const memberId = safeParam(formData.get("memberId"));

  if (!projectId || !memberId) redirect("/projects");
  await requireOwner(supabase, projectId, auth.user.id);

  // Load target member
  const { data: target, error: targetErr } = await supabase
    .from("project_members")
    .select("id, user_id, role")
    .eq("id", memberId)
    .eq("project_id", projectId)
    .single();

  if (targetErr) throw targetErr;

  // Prevent removing self
  if (target?.user_id && target.user_id === auth.user.id) {
    redirect(
      `/projects/${projectId}/members?error=${encodeURIComponent("You cannot remove yourself.")}`
    );
  }

  // Prevent removing last owner
  if (String(target?.role).toLowerCase() === "owner") {
    const { count, error: cErr } = await supabase
      .from("project_members")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId)
      .is("removed_at", null)
      .eq("role", "owner");

    if (cErr) throw cErr;
    if ((count ?? 0) <= 1) {
      redirect(
        `/projects/${projectId}/members?error=${encodeURIComponent("Cannot remove the last owner.")}`
      );
    }
  }

  // Soft-remove is safer (matches your schema)
  const { error } = await supabase
    .from("project_members")
    .update({ removed_at: new Date().toISOString(), removed_by: auth.user.id })
    .eq("id", memberId)
    .eq("project_id", projectId);

  if (error) throw error;

  redirect(`/projects/${projectId}/members?removed=1`);
}

export async function revokeInviteAction(formData: FormData) {
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect("/login");

  const projectId = safeParam(formData.get("projectId"));
  const inviteId = safeParam(formData.get("inviteId")) || safeParam(formData.get("memberId"));

  if (!projectId || !inviteId) redirect("/projects");
  await requireOwner(supabase, projectId, auth.user.id);

  // Revoke invite (don’t delete; keep audit trail)
  const { error } = await supabase
    .from("project_invites")
    .update({ status: "revoked" })
    .eq("id", inviteId)
    .eq("project_id", projectId)
    .eq("status", "pending");

  if (error) throw error;

  redirect(`/projects/${projectId}/members?revoked=1`);
}

export async function resendInviteAction(formData: FormData) {
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect("/login");

  const projectId = safeParam(formData.get("projectId"));
  const inviteId = safeParam(formData.get("inviteId")) || safeParam(formData.get("memberId"));

  if (!projectId || !inviteId) redirect("/projects");
  await requireOwner(supabase, projectId, auth.user.id);

  // Refresh invite metadata (token stays same unless you explicitly mint a new one)
  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from("project_invites")
    .update({
      status: "pending",
      invited_by: auth.user.id,
      created_at: nowIso,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .eq("id", inviteId)
    .eq("project_id", projectId);

  if (error) throw error;

  // If you want resend to actually email: fetch invite + call sendProjectInviteEmail here (or call your RPC).
  redirect(`/projects/${projectId}/members?resent=1`);
}
