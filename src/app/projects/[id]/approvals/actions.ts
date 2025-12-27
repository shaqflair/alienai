// src/app/projects/[id]/approvals/actions.ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

function norm(x: FormDataEntryValue | null) {
  return String(x ?? "").trim();
}

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

function requireOwner(role: string) {
  if (role !== "owner") throw new Error("Only owners can manage approvers.");
}

/**
 * Flat approvers (v1)
 * Primary key: (project_id, user_id)
 */
const PK_CONFLICT = "project_id,user_id";

export async function addProjectApprover(formData: FormData) {
  const { supabase, user } = await requireUser();

  const project_id = norm(formData.get("project_id"));
  const user_id = norm(formData.get("user_id"));
  const job_title = norm(formData.get("job_title")) || null;
  const business_unit = norm(formData.get("business_unit")) || null;

  if (!project_id) throw new Error("project_id is required.");
  if (!user_id) throw new Error("user_id is required.");

  const myRole = await requireMemberRole(supabase, project_id, user.id);
  requireOwner(myRole);

  // Ensure target is a member
  const { data: targetMem, error: tErr } = await supabase
    .from("project_members")
    .select("user_id")
    .eq("project_id", project_id)
    .eq("user_id", user_id)
    .maybeSingle();
  if (tErr) throwDb(tErr, "project_members.select(target)");
  if (!targetMem) throw new Error("Selected user is not a member of this project.");

  // ✅ Atomic upsert
  const { error: upErr } = await supabase
    .from("project_approvers")
    .upsert(
      {
        project_id,
        user_id,
        is_active: true,
        job_title,
        business_unit,
      },
      { onConflict: PK_CONFLICT }
    );

  if (upErr) throwDb(upErr, "project_approvers.upsert");

  revalidatePath(`/projects/${project_id}/approvals`);
  redirect(`/projects/${project_id}/approvals?banner=${encodeURIComponent("Approver_saved")}`);
}

export async function updateProjectApproverDetails(formData: FormData) {
  const { supabase, user } = await requireUser();

  const project_id = norm(formData.get("project_id"));
  const user_id = norm(formData.get("user_id"));
  const job_title = norm(formData.get("job_title")) || null;
  const business_unit = norm(formData.get("business_unit")) || null;

  if (!project_id) throw new Error("project_id is required.");
  if (!user_id) throw new Error("user_id is required.");

  const myRole = await requireMemberRole(supabase, project_id, user.id);
  requireOwner(myRole);

  const { error } = await supabase
    .from("project_approvers")
    .update({ job_title, business_unit })
    .eq("project_id", project_id)
    .eq("user_id", user_id);

  if (error) throwDb(error, "project_approvers.update(details)");

  revalidatePath(`/projects/${project_id}/approvals`);
  redirect(`/projects/${project_id}/approvals?banner=${encodeURIComponent("Approver_updated")}`);
}

export async function toggleProjectApprover(formData: FormData) {
  const { supabase, user } = await requireUser();

  const project_id = norm(formData.get("project_id"));
  const user_id = norm(formData.get("user_id"));
  const next_active = String(formData.get("next_active") ?? "").toLowerCase() === "true";

  if (!project_id) throw new Error("project_id is required.");
  if (!user_id) throw new Error("user_id is required.");

  const myRole = await requireMemberRole(supabase, project_id, user.id);
  requireOwner(myRole);

  const { error } = await supabase
    .from("project_approvers")
    .update({ is_active: next_active })
    .eq("project_id", project_id)
    .eq("user_id", user_id);

  if (error) throwDb(error, "project_approvers.update(toggle)");

  revalidatePath(`/projects/${project_id}/approvals`);
  redirect(
    `/projects/${project_id}/approvals?banner=${encodeURIComponent(
      next_active ? "Approver_enabled" : "Approver_disabled"
    )}`
  );
}

export async function removeProjectApprover(formData: FormData) {
  const { supabase, user } = await requireUser();

  const project_id = norm(formData.get("project_id"));
  const user_id = norm(formData.get("user_id"));

  if (!project_id) throw new Error("project_id is required.");
  if (!user_id) throw new Error("user_id is required.");

  const myRole = await requireMemberRole(supabase, project_id, user.id);
  requireOwner(myRole);

  const { error } = await supabase
    .from("project_approvers")
    .delete()
    .eq("project_id", project_id)
    .eq("user_id", user_id);

  if (error) throwDb(error, "project_approvers.delete");

  revalidatePath(`/projects/${project_id}/approvals`);
  redirect(`/projects/${project_id}/approvals?banner=${encodeURIComponent("Approver_removed")}`);
}
