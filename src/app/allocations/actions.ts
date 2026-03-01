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
   Main action — validates, calls generate_allocations RPC,
   redirects back with result info.
========================= */

export async function createAllocation(formData: FormData) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  // ── Read fields ────────────────────────────────────────────────────────────
  const person_id      = norm(formData.get("person_id"));
  const project_id     = norm(formData.get("project_id"));
  const start_date     = isoDateOrNull(formData.get("start_date"));
  const end_date       = isoDateOrNull(formData.get("end_date"));
  const daysRaw        = norm(formData.get("days_per_week"));
  const days_per_week  = parseFloat(daysRaw) || 0;
  const role_on_project = norm(formData.get("role_on_project")) || null;
  const notes          = norm(formData.get("notes")) || null;
  const allocation_type = norm(formData.get("allocation_type")) || "confirmed";
  const return_to      = norm(formData.get("return_to")) || "/allocations";

  // ── Validation ─────────────────────────────────────────────────────────────
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

  const startTs = new Date(start_date).getTime();
  const endTs   = new Date(end_date).getTime();
  if (endTs < startTs)
    redirect(`/allocations/new${qs({ err: "bad_dates", project_id })}`);

  // ── Permission check — must be editor/owner on the project ─────────────────
  const role = await getMyProjectRole(supabase, project_id, user.id);
  if (role !== "owner" && role !== "editor")
    redirect(`/allocations/new${qs({ err: "no_permission", project_id })}`);

  // ── Call RPC ───────────────────────────────────────────────────────────────
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

  // data shape: { inserted: number, skipped: number, conflicts: [...] }
  const result = data as {
    inserted:  number;
    skipped:   number;
    conflicts: Array<{ week: string; utilisation_pct: number }>;
  };

  const conflictCount = result?.conflicts?.length ?? 0;

  revalidatePath("/allocations");
  revalidatePath(`/projects/${project_id}`);
  revalidatePath("/heatmap");

  // Redirect back to wherever the flow was triggered from
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
   Removes all allocation rows for a person × project
   (or a specific week if week_start_date is provided).
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
   Updates days_allocated for a single person × project × week.
   Used by the inline edit on the heatmap swimlane.
========================= */

export async function updateAllocationWeek(formData: FormData) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const person_id        = norm(formData.get("person_id"));
  const project_id       = norm(formData.get("project_id"));
  const week_start_date  = norm(formData.get("week_start_date"));
  const days_allocated   = parseFloat(norm(formData.get("days_allocated")));
  const return_to        = norm(formData.get("return_to")) || `/projects/${project_id}`;

  if (!person_id || !project_id || !week_start_date)
    redirect(`${return_to}${qs({ err: "missing_ids" })}`);

  if (Number.isNaN(days_allocated) || days_allocated < 0 || days_allocated > 7)
    redirect(`${return_to}${qs({ err: "bad_days" })}`);

  const role = await getMyProjectRole(supabase, project_id, user.id);
  if (role !== "owner" && role !== "editor")
    redirect(`${return_to}${qs({ err: "no_permission" })}`);

  if (days_allocated === 0) {
    // Remove the row entirely rather than storing 0
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
