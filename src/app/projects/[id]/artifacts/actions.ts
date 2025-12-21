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

function requireEditorOrOwner(role: string) {
  const can = role === "owner" || role === "editor";
  if (!can) throw new Error("You do not have permission to perform this action.");
}

const ALLOWED_TYPES = new Set(["PID", "RAID", "SOW", "STATUS", "RISKS", "ASSUMPTIONS", "ACTIONS"]);

export async function createArtifact(formData: FormData) {
  const { supabase, user } = await requireUser();

  const project_id = norm(formData.get("project_id"));
  const type = norm(formData.get("type")).toUpperCase();
  const title = norm(formData.get("title")) || type || "Untitled";
  const content = norm(formData.get("content")) || "";

  if (!project_id) throw new Error("project_id is required.");
  if (!type) throw new Error("type is required.");
  if (!ALLOWED_TYPES.has(type)) throw new Error(`Invalid artifact type: ${type}`);

  // Member required (viewer allowed to create? your call; keep member check only)
  await requireMemberRole(supabase, project_id, user.id);

  // 1) Demote any current artifact for same project+type
  const { error: demoteErr } = await supabase
    .from("artifacts")
    .update({ is_current: false })
    .eq("project_id", project_id)
    .eq("type", type)
    .eq("is_current", true);

  if (demoteErr) throwDb(demoteErr, "artifacts.demote_current");

  // 2) Insert new as current
  const { data: row, error: insErr } = await supabase
    .from("artifacts")
    .insert({
      project_id,
      user_id: user.id,
      type,
      title,
      content,
      is_locked: false,
      is_current: true,
    })
    .select("id")
    .maybeSingle();

  if (insErr) throwDb(insErr, "artifacts.insert");
  if (!row?.id) throw new Error("Artifact created but no id returned.");

  revalidatePath(`/projects/${project_id}/artifacts`);
  redirect(`/projects/${project_id}/artifacts/${row.id}`);
}

export async function updateArtifact(formData: FormData) {
  const { supabase, user } = await requireUser();

  const project_id = norm(formData.get("project_id"));
  const artifact_id = norm(formData.get("artifact_id"));
  const title = norm(formData.get("title"));
  const content = String(formData.get("content") ?? "");

  if (!project_id) throw new Error("project_id is required.");
  if (!artifact_id) throw new Error("artifact_id is required.");

  const role = await requireMemberRole(supabase, project_id, user.id);
  requireEditorOrOwner(role);

  const { data: current, error: curErr } = await supabase
    .from("artifacts")
    .select("id,is_locked")
    .eq("id", artifact_id)
    .eq("project_id", project_id)
    .maybeSingle();
  if (curErr) throwDb(curErr, "artifacts.select");
  if (!current) throw new Error("Artifact not found.");
  if ((current as any)?.is_locked) throw new Error("Artifact is locked (submitted).");

  const patch: any = {};
  if (title !== "") patch.title = title;
  patch.content = content;

  const { error: updErr } = await supabase
    .from("artifacts")
    .update(patch)
    .eq("id", artifact_id)
    .eq("project_id", project_id);

  if (updErr) throwDb(updErr, "artifacts.update");

  revalidatePath(`/projects/${project_id}/artifacts`);
  revalidatePath(`/projects/${project_id}/artifacts/${artifact_id}`);
}

export async function submitArtifact(formData: FormData) {
  const { supabase, user } = await requireUser();

  const project_id = norm(formData.get("project_id"));
  const artifact_id = norm(formData.get("artifact_id"));
  if (!project_id) throw new Error("project_id is required.");
  if (!artifact_id) throw new Error("artifact_id is required.");

  const role = await requireMemberRole(supabase, project_id, user.id);
  requireEditorOrOwner(role);

  const { data: current, error: curErr } = await supabase
    .from("artifacts")
    .select("id,is_locked")
    .eq("id", artifact_id)
    .eq("project_id", project_id)
    .maybeSingle();
  if (curErr) throwDb(curErr, "artifacts.select");
  if (!current) throw new Error("Artifact not found.");
  if ((current as any)?.is_locked) throw new Error("Artifact already submitted.");

  const { error: lockErr } = await supabase
    .from("artifacts")
    .update({
      is_locked: true,
      locked_at: new Date().toISOString(),
      locked_by: user.id,
    })
    .eq("id", artifact_id)
    .eq("project_id", project_id);

  if (lockErr) throwDb(lockErr, "artifacts.lock");

  revalidatePath(`/projects/${project_id}/artifacts`);
  revalidatePath(`/projects/${project_id}/artifacts/${artifact_id}`);
}
