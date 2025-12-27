"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

async function requireOwner(supabase: any, projectId: string, userId: string) {
  const { data, error } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  const r = String(data?.role ?? "").toLowerCase();
  if (r !== "owner") throw new Error("Only project owners can manage members.");
}

export async function changeMemberRoleAction(formData: FormData) {
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect("/login");

  const projectId = safeParam(formData.get("projectId"));
  const memberId = safeParam(formData.get("memberId"));
  const role = safeParam(formData.get("role"));

  if (!projectId || !memberId) redirect("/projects");
  await requireOwner(supabase, projectId, auth.user.id);

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

  // ✅ Safety: prevent owner from removing themselves
  const { data: target, error: targetErr } = await supabase
    .from("project_members")
    .select("user_id, invited_email, invite_status")
    .eq("id", memberId)
    .eq("project_id", projectId)
    .single();

  if (targetErr) throw targetErr;

  if (target?.user_id && target.user_id === auth.user.id) {
    redirect(`/projects/${projectId}/members?error=${encodeURIComponent("You cannot remove yourself.")}`);
  }

  const { error } = await supabase
    .from("project_members")
    .delete()
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
  const memberId = safeParam(formData.get("memberId"));

  if (!projectId || !memberId) redirect("/projects");
  await requireOwner(supabase, projectId, auth.user.id);

  // ✅ Only revoke if it's an invite row
  const { error } = await supabase
    .from("project_members")
    .delete()
    .eq("id", memberId)
    .eq("project_id", projectId)
    .is("user_id", null);

  if (error) throw error;

  redirect(`/projects/${projectId}/members?revoked=1`);
}

export async function resendInviteAction(formData: FormData) {
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect("/login");

  const projectId = safeParam(formData.get("projectId"));
  const memberId = safeParam(formData.get("memberId"));

  if (!projectId || !memberId) redirect("/projects");
  await requireOwner(supabase, projectId, auth.user.id);

  // ✅ Only resend if it's still an invite row
  const { error } = await supabase
    .from("project_members")
    .update({
      invite_status: "invited",
      invited_at: new Date().toISOString(),
      invited_by: auth.user.id,
    })
    .eq("id", memberId)
    .eq("project_id", projectId)
    .is("user_id", null);

  if (error) throw error;

  redirect(`/projects/${projectId}/members?resent=1`);
}