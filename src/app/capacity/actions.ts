"use server";

// FILE: src/app/capacity/actions.ts

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

/* =============================================================================
   UTILITIES
============================================================================= */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function norm(x: FormDataEntryValue | null) {
  return safeStr(x).trim();
}
function throwDb(error: any, label: string): never {
  throw new Error(`[${label}] ${error?.code ?? ""} ${error?.message ?? ""}`);
}
function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
}

async function requireUser(supabase: any) {
  const { data: auth, error } = await supabase.auth.getUser();
  if (error) throwDb(error, "auth.getUser");
  if (!auth?.user) redirect("/login");
  return auth.user;
}

function getMondayOf(dateStr: string): string {
  const d   = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
}

/* =============================================================================
   upsertException
   Creates or updates a capacity exception for a single week.
============================================================================= */

export async function upsertException(formData: FormData) {
  const supabase    = await createClient();
  const user        = await requireUser(supabase);

  const person_id        = norm(formData.get("person_id"))        || user.id;
  const organisation_id  = norm(formData.get("organisation_id"));
  const week_start_raw   = norm(formData.get("week_start_date"));
  const available_days   = parseFloat(norm(formData.get("available_days")));
  const reason           = norm(formData.get("reason"))           || "annual_leave";
  const notes            = norm(formData.get("notes"))            || null;

  if (!week_start_raw)            throw new Error("Week start date is required");
  if (!organisation_id || !isUuid(organisation_id)) throw new Error("Invalid org");
  if (isNaN(available_days) || available_days < 0 || available_days > 7)
    throw new Error("Available days must be 0–7");

  const week_start_date = getMondayOf(week_start_raw);

  if (person_id !== user.id) {
    const { data: mem } = await supabase
      .from("organisation_members")
      .select("role")
      .eq("organisation_id", organisation_id)
      .eq("user_id", user.id)
      .is("removed_at", null)
      .maybeSingle();
    if (!mem) throw new Error("Not an org member");
  }

  const { error } = await supabase
    .from("capacity_exceptions")
    .upsert(
      {
        person_id,
        week_start_date,
        available_days,
        reason,
        notes,
        created_by: user.id,
      },
      { onConflict: "person_id,week_start_date" }
    );

  if (error) throwDb(error, "capacity_exceptions.upsert");

  revalidatePath("/capacity");
  revalidatePath("/heatmap");
}

/* =============================================================================
   upsertExceptionRange
============================================================================= */

export async function upsertExceptionRange(formData: FormData) {
  const supabase   = await createClient();
  const user       = await requireUser(supabase);

  const person_id       = norm(formData.get("person_id"))       || user.id;
  const organisation_id = norm(formData.get("organisation_id"));
  const start_date      = norm(formData.get("start_date"));
  const end_date        = norm(formData.get("end_date"));
  const available_days  = parseFloat(norm(formData.get("available_days")));
  const reason          = norm(formData.get("reason"))          || "annual_leave";
  const notes           = norm(formData.get("notes"))           || null;

  if (!start_date || !end_date) throw new Error("Start and end dates are required");
  if (!organisation_id || !isUuid(organisation_id)) throw new Error("Invalid org");
  if (isNaN(available_days) || available_days < 0 || available_days > 7)
    throw new Error("Available days must be 0–7");

  if (person_id !== user.id) {
    const { data: mem } = await supabase
      .from("organisation_members")
      .select("role")
      .eq("organisation_id", organisation_id)
      .eq("user_id", user.id)
      .is("removed_at", null)
      .maybeSingle();
    if (!mem) throw new Error("Not an org member");
  }

  const rows: any[] = [];
  let cur = new Date(getMondayOf(start_date) + "T00:00:00");
  const endD = new Date(end_date + "T00:00:00");

  while (cur <= endD) {
    rows.push({
      person_id,
      week_start_date: cur.toISOString().split("T")[0],
      available_days,
      reason,
      notes,
      created_by: user.id,
    });
    cur.setDate(cur.getDate() + 7);
  }

  if (!rows.length) throw new Error("No weeks in selected range");

  const { error } = await supabase
    .from("capacity_exceptions")
    .upsert(rows, { onConflict: "person_id,week_start_date" });

  if (error) throwDb(error, "capacity_exceptions.upsert_range");

  revalidatePath("/capacity");
  revalidatePath("/heatmap");
}

/* =============================================================================
   deleteException
============================================================================= */

export async function deleteException(formData: FormData) {
  const supabase = await createClient();
  const user     = await requireUser(supabase);

  const exception_id    = norm(formData.get("exception_id"));
  const person_id       = norm(formData.get("person_id"));
  const organisation_id = norm(formData.get("organisation_id"));

  if (!exception_id || !isUuid(exception_id)) throw new Error("Invalid exception id");

  if (person_id && person_id !== user.id) {
    const { data: mem } = await supabase
      .from("organisation_members")
      .select("role")
      .eq("organisation_id", organisation_id)
      .eq("user_id", user.id)
      .is("removed_at", null)
      .maybeSingle();
    if (!mem) throw new Error("Not an org member");
  }

  const { error } = await supabase
    .from("capacity_exceptions")
    .delete()
    .eq("id", exception_id);

  if (error) throwDb(error, "capacity_exceptions.delete");

  revalidatePath("/capacity");
  revalidatePath("/heatmap");
}
