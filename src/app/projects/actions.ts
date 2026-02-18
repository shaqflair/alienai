// src/app/projects/actions.ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

/* =========================
   Utilities
========================= */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function norm(x: FormDataEntryValue | null) {
  return safeStr(x).trim();
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

function isoDateOrNull(raw: FormDataEntryValue | null) {
  const s = norm(raw);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return s; // YYYY-MM-DD
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
}

function qs(params: Record<string, string | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const s = safeStr(v).trim();
    if (s) sp.set(k, s);
  }
  const out = sp.toString();
  return out ? `?${out}` : "";
}

async function requireUser(supabase: any) {
  const { data: auth, error } = await supabase.auth.getUser();
  if (error) throwDb(error, "auth.getUser");
  if (!auth?.user) redirect("/login");
  return auth.user;
}

// ✅ robust role gate: handles duplicates safely (owner/editor wins)
async function getMyProjectRole(
  supabase: any,
  projectId: string,
  userId: string
): Promise<"" | "owner" | "editor" | "viewer"> {
  const { data, error } = await supabase
    .from("project_members")
    .select("role, is_active")
    .eq("project_id", projectId)
    .eq("user_id", userId);

  if (error) throwDb(error, "project_members.select");

  const roles = (data ?? [])
    .filter((r: any) => r?.is_active !== false)
    .map((r: any) => String(r?.role ?? "").toLowerCase())
    .filter(Boolean);

  if (!roles.length) return "";
  if (roles.includes("owner")) return "owner";
  if (roles.includes("editor")) return "editor";
  if (roles.includes("viewer")) return "viewer";
  return (roles[0] as any) || "";
}

function canEdit(role: string) {
  return role === "owner" || role === "editor";
}
function canDelete(role: string) {
  return role === "owner";
}

/* =========================
   Actions
========================= */

export async function createProject(formData: FormData) {
  const supabase = await createClient();
  await requireUser(supabase);

  const title = norm(formData.get("title"));
  const start_date = isoDateOrNull(formData.get("start_date"));
  const finish_date = isoDateOrNull(formData.get("finish_date"));
  const organisation_id = norm(formData.get("organisation_id"));

  // ✅ Enterprise: optional PM (stored as auth user id, which equals profiles.id in your schema)
  const pmRaw = norm(formData.get("project_manager_id"));
  const project_manager_id = pmRaw && isUuid(pmRaw) ? pmRaw : "";

  // ✅ user-input validation should not crash the whole page:
  if (!title) redirect(`/projects${qs({ err: "missing_title" })}`);
  if (!start_date) redirect(`/projects${qs({ err: "missing_start" })}`);
  if (!organisation_id) redirect(`/projects${qs({ err: "missing_org" })}`);
  if (!isUuid(organisation_id)) redirect(`/projects${qs({ err: "bad_org" })}`);

  if (finish_date) {
    const a = new Date(start_date).getTime();
    const b = new Date(finish_date).getTime();
    if (Number.isNaN(a) || Number.isNaN(b) || b < a) {
      redirect(`/projects${qs({ err: "bad_finish" })}`);
    }
  }

  // ✅ If PM provided, ensure PM is an active org member (removed_at is null)
  if (project_manager_id) {
    const { data: pmMem, error: pmErr } = await supabase
      .from("organisation_members")
      .select("user_id, removed_at")
      .eq("organisation_id", organisation_id)
      .eq("user_id", project_manager_id)
      .is("removed_at", null)
      .maybeSingle();

    if (pmErr) throwDb(pmErr, "organisation_members.pm_check");
    if (!pmMem?.user_id) redirect(`/projects${qs({ err: "bad_pm" })}`);
  }

  const { data, error } = await supabase.rpc("create_project_and_owner", {
    p_title: title,
    p_start_date: start_date,
    p_finish_date: finish_date || null,
    p_organisation_id: organisation_id,
  });

  if (error) throwDb(error, "rpc.create_project_and_owner");

  const row = Array.isArray(data) ? data[0] : data;
  const projectId = row?.id as string | undefined;
  if (!projectId) throw new Error("Project creation succeeded but returned no id.");

  // ✅ Set PM (optional) AFTER creation (keeps RPC unchanged)
  if (project_manager_id) {
    const { error: updErr } = await supabase
      .from("projects")
      .update({ project_manager_id })
      .eq("id", projectId);

    if (updErr) throwDb(updErr, "projects.set_project_manager");
  }

  revalidatePath("/projects");
  redirect(`/projects/${projectId}`);
}

export async function updateProjectTitle(formData: FormData) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const project_id = norm(formData.get("project_id"));
  const title = norm(formData.get("title"));

  if (!project_id) redirect(`/projects${qs({ err: "missing_project" })}`);
  if (!title) redirect(`/projects${qs({ err: "missing_title" })}`);

  const role = await getMyProjectRole(supabase, project_id, user.id);
  if (!canEdit(role)) redirect(`/projects${qs({ err: "no_permission", pid: project_id })}`);

  const { error: updErr } = await supabase.from("projects").update({ title }).eq("id", project_id);
  if (updErr) throwDb(updErr, "projects.update");

  revalidatePath("/projects");
  revalidatePath(`/projects/${project_id}`);
  redirect(`/projects${qs({ msg: "renamed", pid: project_id })}`);
}

export async function closeProject(formData: FormData) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const project_id = norm(formData.get("project_id"));
  if (!project_id) redirect(`/projects${qs({ err: "missing_project" })}`);

  const role = await getMyProjectRole(supabase, project_id, user.id);
  if (!canEdit(role)) redirect(`/projects${qs({ err: "no_permission", pid: project_id })}`);

  const { error } = await supabase.rpc("close_project", { pid: project_id });
  if (error) throwDb(error, "rpc.close_project");

  revalidatePath("/projects");
  revalidatePath(`/projects/${project_id}`);
  redirect(`/projects${qs({ msg: "closed", pid: project_id })}`);
}

export async function reopenProject(formData: FormData) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const project_id = norm(formData.get("project_id"));
  if (!project_id) redirect(`/projects${qs({ err: "missing_project" })}`);

  const role = await getMyProjectRole(supabase, project_id, user.id);
  if (!canEdit(role)) redirect(`/projects${qs({ err: "no_permission", pid: project_id })}`);

  const { error } = await supabase.rpc("reopen_project", { pid: project_id });
  if (error) throwDb(error, "rpc.reopen_project");

  revalidatePath("/projects");
  revalidatePath(`/projects/${project_id}`);
  redirect(`/projects${qs({ msg: "reopened", pid: project_id })}`);
}

export async function deleteProject(formData: FormData) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const project_id = norm(formData.get("project_id"));
  const confirm = norm(formData.get("confirm"));

  if (!project_id) redirect(`/projects${qs({ err: "missing_project" })}`);

  if (confirm !== "DELETE") {
    redirect(`/projects${qs({ err: "delete_confirm", pid: project_id })}`);
  }

  const role = await getMyProjectRole(supabase, project_id, user.id);
  if (!canDelete(role)) redirect(`/projects${qs({ err: "delete_forbidden", pid: project_id })}`);

  const { error } = await supabase
    .from("projects")
    .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
    .eq("id", project_id);

  if (error) throwDb(error, "projects.soft_delete");

  revalidatePath("/projects");
  revalidatePath(`/projects/${project_id}`);
  redirect(`/projects${qs({ msg: "deleted", pid: project_id })}`);
}
