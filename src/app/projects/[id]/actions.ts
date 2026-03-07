"use server";

import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export async function generatePID(formData: FormData) {
  const projectId = safeStr(formData.get("project_id")).trim();
  const returnTo  = safeStr(formData.get("return_to")).trim();

  if (!projectId) throw new Error("Missing project_id");

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect("/login");

  const { error } = await supabase.from("artifacts").insert({
    project_id: projectId,
    user_id:    auth.user.id,
    type:       "PID",
    content:    "Placeholder PID content – AI will generate this later.",
  });

  if (error) throw new Error(error.message);

  redirect(returnTo || `/projects/${projectId}?msg=pid_created`);
}

export async function insertRoleRequirements(formData: FormData) {
  const projectId = safeStr(formData.get("project_id")).trim();
  const returnTo  = safeStr(formData.get("return_to")).trim();

  if (!projectId) throw new Error("Missing project_id");

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect("/login");

  const rolesRaw = safeStr(
    formData.get("roles_json") || formData.get("roles") || "[]"
  );

  let roles: any[] = [];
  try {
    roles = JSON.parse(rolesRaw);
  } catch {
    throw new Error("Invalid roles JSON");
  }

  const valid = roles.filter(
    (r: any) => r.role_title && r.start_date && r.end_date
  );
  if (!valid.length) throw new Error("No valid roles to insert");

  const rows = valid.map((r: any) => ({
    project_id:             projectId,
    role_title:             safeStr(r.role_title).trim(),
    seniority_level:        safeStr(r.seniority_level || "Senior").trim(),
    required_days_per_week: parseFloat(safeStr(r.required_days_per_week)) || 3,
    start_date:             safeStr(r.start_date),
    end_date:               safeStr(r.end_date),
    notes:                  r.notes ? safeStr(r.notes).trim() : null,
    filled_by_person_id:    null,
  }));

  const { error } = await supabase.from("role_requirements").insert(rows);
  if (error) throw new Error(error.message);

  redirect(returnTo || `/projects/${projectId}?msg=roles_saved`);
}