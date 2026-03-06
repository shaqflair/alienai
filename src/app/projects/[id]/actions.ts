"use server";

import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";

export async function generatePID(projectId: string) {
  if (!projectId) return;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  if (!auth?.user) redirect("/login");

  await supabase.from("artifacts").insert({
    project_id: projectId,
    user_id: auth.user.id,
    type: "PID",
    content: "Placeholder PID content – AI will generate this later.",
  });
}

export async function insertRoleRequirements(formData: FormData) {
  "use server";
  const { createClient } = await import("@/utils/supabase/server");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect("/login");

  const projectId = String(formData.get("project_id") || "").trim();
  if (!projectId) throw new Error("Missing project_id");

  // roles is JSON array of role objects
  const rolesRaw = String(formData.get("roles_json") || formData.get("roles") || "[]");
  let roles: any[] = [];
  try { roles = JSON.parse(rolesRaw); } catch { throw new Error("Invalid roles JSON"); }

  const valid = roles.filter((r: any) => r.role_title && r.start_date && r.end_date);
  if (!valid.length) throw new Error("No valid roles to insert");

  const rows = valid.map((r: any) => ({
    project_id:            projectId,
    role_title:            String(r.role_title).trim(),
    seniority_level:       String(r.seniority_level || "Senior").trim(),
    required_days_per_week: parseFloat(String(r.required_days_per_week)) || 3,
    start_date:            String(r.start_date),
    end_date:              String(r.end_date),
    notes:                 r.notes ? String(r.notes).trim() : null,
    filled_by_person_id:   null,
  }));

  const { error } = await supabase.from("role_requirements").insert(rows);
  if (error) throw new Error(error.message);
}
