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

export async function createProject(formData: FormData) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throwDb(authErr, "auth.getUser");
  if (!auth?.user) redirect("/login");

  const title = norm(formData.get("title"));
  const delivery_type = norm(formData.get("delivery_type"));
  if (!title) throw new Error("Title is required.");
  if (!delivery_type) throw new Error("Delivery type is required.");

  // ✅ Create project (force return exactly one row)
  const { data: proj, error: projErr } = await supabase
    .from("projects")
    .insert({ title, delivery_type })
    .select("id")
    .single();

  if (projErr) throwDb(projErr, "projects.insert");
  if (!proj?.id) throw new Error("Project insert succeeded but returned no id.");

  // Add creator as owner
  const { error: memErr } = await supabase.from("project_members").insert({
    project_id: proj.id,
    user_id: auth.user.id,
    role: "owner",
  });

  // If your DB already adds owner via trigger, you may get a duplicate key here.
  // In that case, ignore only that specific error.
  if (memErr) {
    const msg = String(memErr.message ?? "").toLowerCase();
    const code = String((memErr as any).code ?? "");
    const isDuplicate =
      code === "23505" || msg.includes("duplicate key") || msg.includes("unique constraint");
    if (!isDuplicate) throwDb(memErr, "project_members.insert");
  }

  revalidatePath("/projects");
  redirect(`/projects/${proj.id}`);
}

export async function updateProjectTitle(formData: FormData) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throwDb(authErr, "auth.getUser");
  if (!auth?.user) redirect("/login");

  const project_id = norm(formData.get("project_id"));
  const title = norm(formData.get("title"));
  if (!project_id) throw new Error("project_id is required.");
  if (!title) throw new Error("Title is required.");

  // Gate: only owner/editor can rename
  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", project_id)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (memErr) throwDb(memErr, "project_members.select");

  const role = String((mem as any)?.role ?? "").toLowerCase();
  if (!(role === "owner" || role === "editor")) {
    throw new Error("You do not have permission to rename this project.");
  }

  const { error: updErr } = await supabase.from("projects").update({ title }).eq("id", project_id);
  if (updErr) throwDb(updErr, "projects.update");

  revalidatePath("/projects");
  revalidatePath(`/projects/${project_id}`);
}
