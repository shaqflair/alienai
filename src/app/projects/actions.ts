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

function hasJsonContent(v: any) {
  if (v == null) return false;
  if (typeof v !== "object") return true;
  if (Array.isArray(v)) return v.length > 0;
  return Object.keys(v).length > 0;
}
function nonEmptyText(s: any) {
  const t = safeStr(s).trim();
  return t.length > 0;
}

/**
 * Enterprise guard:
 * - Block delete if any artifact is submitted (approval_status != draft) OR contains info (content/content_json)
 */
async function computeDeleteGuard(supabase: any, projectId: string) {
  const { data, error } = await supabase
    .from("artifacts")
    .select("approval_status, content, content_json, deleted_at")
    .eq("project_id", projectId)
    .is("deleted_at", null);

  if (error) throwDb(error, "artifacts.guard");

  const list = Array.isArray(data) ? data : [];

  let total = 0;
  let submittedCount = 0;
  let contentCount = 0;

  for (const a of list) {
    total += 1;
    const status = safeStr((a as any)?.approval_status).trim().toLowerCase();
    const isSubmittedOrBeyond = !!status && status !== "draft";
    const hasInfo = nonEmptyText((a as any)?.content) || hasJsonContent((a as any)?.content_json);

    if (isSubmittedOrBeyond) submittedCount += 1;
    if (hasInfo) contentCount += 1;
  }

  const reasons: string[] = [];
  if (submittedCount > 0) reasons.push(`${submittedCount} artifact(s) submitted / in workflow`);
  if (contentCount > 0) reasons.push(`${contentCount} artifact(s) contain information`);

  const canDelete = submittedCount === 0 && contentCount === 0;

  return { canDelete, totalArtifacts: total, submittedCount, contentCount, reasons };
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

  const pmRaw = norm(formData.get("project_manager_id"));
  const project_manager_id = pmRaw && isUuid(pmRaw) ? pmRaw : "";

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
    p_finish_date: finish_date || null,
    p_organisation_id: organisation_id,
    p_start_date: start_date,
    p_title: title,
  });

  if (error) throwDb(error, "rpc.create_project_and_owner");

  const projectId =
    typeof data === "string"
      ? data
      : Array.isArray(data)
      ? (data[0] as any)?.id ?? (data[0] as any)
      : (data as any)?.id;

  if (!projectId || typeof projectId !== "string") {
    throw new Error("Project creation succeeded but returned no id.");
  }

  if (project_manager_id) {
    const { error: updErr } = await supabase.from("projects").update({ project_manager_id }).eq("id", projectId);
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

/**
 * ✅ DELETE (guarded)
 * - server enforces enterprise guard (cannot bypass)
 * - redirects with helpful msg codes
 */
export async function deleteProject(formData: FormData) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const project_id = norm(formData.get("project_id"));
  const confirm = norm(formData.get("confirm"));

  if (!project_id) redirect(`/projects${qs({ err: "missing_project" })}`);
  if (confirm !== "DELETE") redirect(`/projects${qs({ err: "delete_confirm", pid: project_id })}`);

  const role = await getMyProjectRole(supabase, project_id, user.id);
  if (!canDelete(role)) redirect(`/projects${qs({ err: "delete_forbidden", pid: project_id })}`);

  const guard = await computeDeleteGuard(supabase, project_id);
  if (!guard.canDelete) {
    redirect(`/projects${qs({ err: "delete_blocked", pid: project_id })}`);
  }

  const { error } = await supabase
    .from("projects")
    .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
    .eq("id", project_id);

  if (error) throwDb(error, "projects.soft_delete");

  revalidatePath("/projects");
  revalidatePath(`/projects/${project_id}`);
  redirect(`/projects${qs({ msg: "deleted", pid: project_id })}`);
}

/**
 * ✅ Enterprise: Abnormal close
 * - constraint-safe: status MUST be 'closed' (projects_status_check)
 * - we use closure_type='abnormal' to preserve semantics
 *
 * If you *must* use an RPC for RLS, update the RPC implementation to set:
 *   status='closed', lifecycle_status='closed', closure_type='abnormal'
 * and then switch the commented block below back on.
 */
export async function abnormalCloseProject(formData: FormData) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const project_id = norm(formData.get("project_id"));
  const confirm = norm(formData.get("confirm"));

  if (!project_id) redirect(`/projects${qs({ err: "missing_project" })}`);
  if (confirm !== "ABNORMAL") redirect(`/projects${qs({ err: "abnormal_confirm", pid: project_id })}`);

  const role = await getMyProjectRole(supabase, project_id, user.id);
  if (!canEdit(role)) redirect(`/projects${qs({ err: "no_permission", pid: project_id })}`);

  // ✅ Direct update (works with your check constraints)
  const patch: any = {
    status: "closed",
    lifecycle_status: "closed",
    closure_type: "abnormal",
    closed_at: new Date().toISOString(),
    closed_by: user.id,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("projects").update(patch).eq("id", project_id);
  if (error) throwDb(error, "projects.abnormal_close");

  // ---- If you require RPC for RLS, use this instead (after fixing the function):
  // const { error } = await supabase.rpc("abnormal_close_project", { pid: project_id });
  // if (error) throwDb(error, "rpc.abnormal_close_project");

  revalidatePath("/projects");
  revalidatePath(`/projects/${project_id}`);
  redirect(`/projects${qs({ msg: "abnormally_closed", pid: project_id })}`);
}
