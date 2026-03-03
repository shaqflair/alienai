"use server";
// FILE: src/app/allocations/actions.ts

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
  throw new Error(
    `[${label}] ${error?.code ?? ""} ${error?.message ?? ""}${
      error?.hint ? ` | hint: ${error.hint}` : ""
    }`
  );
}
function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
}
function isoDateOrNull(raw: FormDataEntryValue | null) {
  const s = norm(raw);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return s;
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

/* =========================
   createAllocation
========================= */

export async function createAllocation(formData: FormData) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const person_id       = norm(formData.get("person_id"));
  const project_id      = norm(formData.get("project_id"));
  const start_date      = isoDateOrNull(formData.get("start_date"));
  const end_date        = isoDateOrNull(formData.get("end_date"));
  const daysRaw         = norm(formData.get("days_per_week"));
  const days_per_week   = parseFloat(daysRaw) || 0;
  const role_on_project = norm(formData.get("role_on_project")) || null;
  const notes           = norm(formData.get("notes")) || null;
  const allocation_type = norm(formData.get("allocation_type")) || "confirmed";
  const return_to       = norm(formData.get("return_to")) || "/allocations";

  if (!person_id || !isUuid(person_id))
    redirect(`/allocations/new${qs({ err: "missing_person" })}`);
  if (!project_id || !isUuid(project_id))
    redirect(`/allocations/new${qs({ err: "missing_project" })}`);
  if (!start_date)
    redirect(`/allocations/new${qs({ err: "missing_start", project_id })}`);
  if (!end_date)
    redirect(`/allocations/new${qs({ err: "missing_end", project_id })}`);
  if (days_per_week <= 0 || days_per_week > 7)
    redirect(`/allocations/new${qs({ err: "bad_days", project_id })}`);
  if (new Date(end_date).getTime() < new Date(start_date).getTime())
    redirect(`/allocations/new${qs({ err: "bad_dates", project_id })}`);

  const role = await getMyProjectRole(supabase, project_id, user.id);
  if (role !== "owner" && role !== "editor")
    redirect(`/allocations/new${qs({ err: "no_permission", project_id })}`);

  const { data, error } = await supabase.rpc("generate_allocations", {
    p_person_id:       person_id,
    p_project_id:      project_id,
    p_start_date:      start_date,
    p_end_date:        end_date,
    p_days_per_week:   days_per_week,
    p_role_on_project: role_on_project,
    p_notes:           notes,
    p_allocation_type: allocation_type,
  });

  if (error) throwDb(error, "rpc.generate_allocations");

  const result = data as {
    inserted: number;
    skipped: number;
    conflicts: Array<{ week: string; utilisation_pct: number }>;
  };
  const conflictCount = result?.conflicts?.length ?? 0;

  revalidatePath("/allocations");
  revalidatePath(`/projects/${project_id}`);
  revalidatePath("/heatmap");

  const dest = safeStr(return_to) || `/projects/${project_id}`;
  redirect(
    `${dest}${qs({
      msg:       "allocated",
      inserted:  String(result.inserted),
      conflicts: conflictCount > 0 ? String(conflictCount) : undefined,
    })}`
  );
}

/* =========================
   deleteAllocation
========================= */

export async function deleteAllocation(formData: FormData) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const person_id  = norm(formData.get("person_id"));
  const project_id = norm(formData.get("project_id"));
  const week       = norm(formData.get("week_start_date")) || null;
  const return_to  = norm(formData.get("return_to")) || `/projects/${project_id}`;

  if (!person_id || !project_id)
    redirect(`${return_to}${qs({ err: "missing_ids" })}`);

  const role = await getMyProjectRole(supabase, project_id, user.id);
  if (role !== "owner" && role !== "editor")
    redirect(`${return_to}${qs({ err: "no_permission" })}`);

  let query = supabase
    .from("allocations")
    .delete()
    .eq("person_id", person_id)
    .eq("project_id", project_id);

  if (week) query = query.eq("week_start_date", week);

  const { error } = await query;
  if (error) throwDb(error, "allocations.delete");

  revalidatePath("/allocations");
  revalidatePath(`/projects/${project_id}`);
  revalidatePath("/heatmap");

  redirect(`${return_to}${qs({ msg: week ? "week_removed" : "allocation_removed" })}`);
}

/* =========================
   updateAllocationWeek
========================= */

export async function updateAllocationWeek(formData: FormData) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const person_id       = norm(formData.get("person_id"));
  const project_id      = norm(formData.get("project_id"));
  const week_start_date = norm(formData.get("week_start_date"));
  const days_allocated  = parseFloat(norm(formData.get("days_allocated")));
  const return_to       = norm(formData.get("return_to")) || `/projects/${project_id}`;

  if (!person_id || !project_id || !week_start_date)
    redirect(`${return_to}${qs({ err: "missing_ids" })}`);
  if (Number.isNaN(days_allocated) || days_allocated < 0 || days_allocated > 7)
    redirect(`${return_to}${qs({ err: "bad_days" })}`);

  const role = await getMyProjectRole(supabase, project_id, user.id);
  if (role !== "owner" && role !== "editor")
    redirect(`${return_to}${qs({ err: "no_permission" })}`);

  if (days_allocated === 0) {
    const { error } = await supabase
      .from("allocations")
      .delete()
      .eq("person_id", person_id)
      .eq("project_id", project_id)
      .eq("week_start_date", week_start_date);
    if (error) throwDb(error, "allocations.delete_zero");
  } else {
    const { error } = await supabase
      .from("allocations")
      .upsert(
        {
          person_id,
          project_id,
          week_start_date,
          days_allocated,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "person_id,project_id,week_start_date" }
      );
    if (error) throwDb(error, "allocations.upsert");
  }

  revalidatePath("/allocations");
  revalidatePath(`/projects/${project_id}`);
  revalidatePath("/heatmap");

  redirect(`${return_to}${qs({ msg: "week_updated" })}`);
}

/* =========================
   updateAllocation
   FIX: Only delete/replace weeks WITHIN the new date range.
   Previously deleted ALL weeks for person↔project, wiping allocations
   on other periods (e.g. editing week 5 would delete weeks 1-4 and 6+).
========================= */

export async function updateAllocation(formData: FormData): Promise<{ ok: true }> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const person_id     = norm(formData.get("person_id"));
  const project_id    = norm(formData.get("project_id"));
  const new_start     = norm(formData.get("start_date"));
  const new_end       = norm(formData.get("end_date"));
  const days_per_week = parseFloat(norm(formData.get("days_per_week")));
  const alloc_type    = norm(formData.get("allocation_type")) || "confirmed";

  if (!person_id || !project_id || !new_start || !new_end)
    throw new Error("Missing required fields.");
  if (Number.isNaN(days_per_week) || days_per_week < 0.5 || days_per_week > 7)
    throw new Error("Days per week must be between 0.5 and 7.");
  if (new_start > new_end)
    throw new Error("Start date must be before end date.");

  const role = await getMyProjectRole(supabase, project_id, user.id);
  if (role !== "owner" && role !== "editor")
    throw new Error("You don't have permission to edit this allocation.");

  // Build new weekly rows
  const rows: {
    person_id: string;
    project_id: string;
    week_start_date: string;
    days_allocated: number;
    allocation_type: string;
  }[] = [];

  const start = new Date(new_start + "T00:00:00Z");
  const end   = new Date(new_end   + "T00:00:00Z");

  // Snap start to Monday
  const day = start.getUTCDay();
  if (day !== 1) start.setUTCDate(start.getUTCDate() + (day === 0 ? -6 : 1 - day));

  const cur = new Date(start);
  while (cur <= end) {
    rows.push({
      person_id,
      project_id,
      week_start_date: cur.toISOString().slice(0, 10),
      days_allocated:  days_per_week,
      allocation_type: alloc_type,
    });
    cur.setUTCDate(cur.getUTCDate() + 7);
  }

  if (rows.length === 0)
    throw new Error("No weeks found in the selected date range.");

  // KEY FIX: only delete the specific weeks we are about to replace,
  // not the entire person↔project allocation history.
  const weekKeys = rows.map(r => r.week_start_date);

  const { error: delErr } = await supabase
    .from("allocations")
    .delete()
    .eq("person_id", person_id)
    .eq("project_id", project_id)
    .in("week_start_date", weekKeys);

  if (delErr) throw new Error(`Failed to clear existing weeks: ${delErr.message}`);

  const { error: insErr } = await supabase
    .from("allocations")
    .insert(rows);

  if (insErr) throw new Error(`Failed to save allocation: ${insErr.message}`);

  revalidatePath(`/projects/${project_id}`);
  revalidatePath("/heatmap");

  return { ok: true };
}

/* =========================
   deleteAllocationDirect
========================= */

export async function deleteAllocationDirect(formData: FormData): Promise<{ ok: true }> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const person_id  = norm(formData.get("person_id"));
  const project_id = norm(formData.get("project_id"));

  if (!person_id || !project_id)
    throw new Error("Missing person or project.");

  const role = await getMyProjectRole(supabase, project_id, user.id);
  if (role !== "owner" && role !== "editor")
    throw new Error("You don't have permission to remove this allocation.");

  const { error } = await supabase
    .from("allocations")
    .delete()
    .eq("person_id", person_id)
    .eq("project_id", project_id);

  if (error) throw new Error(`Failed to remove allocation: ${error.message}`);

  revalidatePath(`/projects/${project_id}`);
  revalidatePath("/heatmap");

  return { ok: true };
}