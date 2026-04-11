"use server";
// FILE: src/app/timeline/actions.ts

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function norm(x: FormDataEntryValue | null) {
  return safeStr(x).trim();
}
function throwDb(err: any, label: string): never {
  throw new Error(`[${label}] ${err?.message ?? err}`);
}

async function requireAdmin(supabase: any, organisationId: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: mem } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle();
  if (!mem || safeStr(mem.role).toLowerCase() !== "admin")
    throw new Error("Admin access required to modify project dates");
  return user;
}

/* =============================================================================
   shiftProjectDates
   Shifts start_date and finish_date by N days (positive or negative).
   Also shifts all allocations for this project by the same delta.
============================================================================= */
export async function shiftProjectDates(formData: FormData) {
  const supabase       = await createClient();
  const projectId      = norm(formData.get("project_id"));
  const organisationId = norm(formData.get("organisation_id"));
  const shiftDays      = parseInt(norm(formData.get("shift_days")), 10);

  await requireAdmin(supabase, organisationId);

  if (isNaN(shiftDays) || shiftDays === 0) return;

  // Fetch current dates
  const { data: proj, error: fetchErr } = await supabase
    .from("projects")
    .select("start_date, finish_date")
    .eq("id", projectId)
    .maybeSingle();
  if (fetchErr) throwDb(fetchErr, "projects.fetch");
  if (!proj) throw new Error("Project not found");

  function shiftDate(iso: string | null, days: number): string | null {
    if (!iso) return null;
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + days);
    return d.toISOString().split("T")[0];
  }

  const newStart = shiftDate(proj.start_date,  shiftDays);
  const newEnd   = shiftDate(proj.finish_date, shiftDays);

  const { error: updateErr } = await supabase
    .from("projects")
    .update({ start_date: newStart, finish_date: newEnd })
    .eq("id", projectId)
    .eq("organisation_id", organisationId);
  if (updateErr) throwDb(updateErr, "projects.update");

  // Shift all allocations for this project
  const { data: allocs } = await supabase
    .from("allocations")
    .select("id, week_start_date")
    .eq("project_id", projectId);

  for (const a of allocs ?? []) {
    const newWeek = shiftDate(safeStr(a.week_start_date), shiftDays);
    await supabase.from("allocations").update({ week_start_date: newWeek }).eq("id", a.id);
  }

  revalidatePath("/timeline");
}

/* =============================================================================
   resizeProjectDates
   Updates only start_date or finish_date (for edge drag).
============================================================================= */
export async function resizeProjectDates(formData: FormData) {
  const supabase       = await createClient();
  const projectId      = norm(formData.get("project_id"));
  const organisationId = norm(formData.get("organisation_id"));
  const edge           = norm(formData.get("edge")); // "start" | "end"
  const newDate        = norm(formData.get("new_date"));

  await requireAdmin(supabase, organisationId);

  const field = edge === "start" ? "start_date" : "finish_date";

  const { error } = await supabase
    .from("projects")
    .update({ [field]: newDate })
    .eq("id", projectId)
    .eq("organisation_id", organisationId);
  if (error) throwDb(error, "projects.resize");

  revalidatePath("/timeline");
}
