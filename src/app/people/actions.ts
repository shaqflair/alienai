"use server";
// FILE: src/app/people/actions.ts

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
  throw new Error(
    `[${label}] ${error?.code ?? ""} ${error?.message ?? ""}${error?.hint ? ` | ${error.hint}` : ""}`
  );
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

async function requireOrgMember(supabase: any, userId: string, organisationId: string) {
  const { data, error } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();
  if (error) throwDb(error, "org_members.check");
  if (!data) throw new Error("Not a member of this organisation");
  return String(data.role || "member");
}

/* =============================================================================
   upsertPerson
   Creates or updates a person's profile + org membership.
   Any org member can do this (PMs can add anyone).
   person_id present = update; absent = create (invite or existing user).
============================================================================= */

export async function upsertPerson(formData: FormData) {
  const supabase = await createClient();
  const user     = await requireUser(supabase);

  const organisation_id   = norm(formData.get("organisation_id"));
  const person_id         = norm(formData.get("person_id")) || null; // null = new person
  const full_name         = norm(formData.get("full_name"));
  const job_title         = norm(formData.get("job_title"))    || null;
  const department        = norm(formData.get("department"))   || null;
  const employment_type   = norm(formData.get("employment_type")) || "full_time";
  const cap_raw           = norm(formData.get("default_capacity_days"));
  const default_capacity_days = parseFloat(cap_raw) || 5;
  const rate_card_id      = norm(formData.get("rate_card_id")) || null;
  const available_from    = norm(formData.get("available_from")) || null;
  const is_active         = norm(formData.get("is_active")) !== "false";

  // Validation
  if (!full_name)         throw new Error("Full name is required");
  if (!organisation_id || !isUuid(organisation_id))
                          throw new Error("Invalid organisation");
  if (default_capacity_days < 0.5 || default_capacity_days > 7)
                          throw new Error("Capacity must be between 0.5 and 7");

  // Verify caller is org member
  await requireOrgMember(supabase, user.id, organisation_id);

  if (person_id && isUuid(person_id)) {
    // ── UPDATE existing profile ─────────────────────────────────────────────
    const patch: Record<string, any> = {
      full_name,
      job_title,
      department,
      employment_type,
      default_capacity_days,
      is_active,
      updated_at: new Date().toISOString(),
    };
    if (rate_card_id && isUuid(rate_card_id)) patch.rate_card_id = rate_card_id;
    else patch.rate_card_id = null;
    if (available_from) patch.available_from = available_from;

    const { error: updErr } = await supabase
      .from("profiles")
      .update(patch)
      .eq("user_id", person_id);
    if (updErr) throwDb(updErr, "profiles.update");

  } else {
    // ── CREATE — profile row must already exist (Supabase creates on signup)
    // If person doesn't have a Supabase account yet, we create a placeholder
    // profile row linked to the org. In practice, invite flow handles new users.
    // Here we handle the "add an existing org member's profile details" case.
    //
    // For now: look up by full_name within this org — if found, update.
    // If not found, inform caller to use the invite flow.
    const { data: existing } = await supabase
      .from("profiles")
      .select("user_id")
      .ilike("full_name", full_name)
      .maybeSingle();

    if (existing?.user_id) {
      const patch: Record<string, any> = {
        full_name, job_title, department,
        employment_type, default_capacity_days, is_active,
        updated_at: new Date().toISOString(),
      };
      if (rate_card_id && isUuid(rate_card_id)) patch.rate_card_id = rate_card_id;
      if (available_from) patch.available_from = available_from;

      const { error } = await supabase
        .from("profiles")
        .update(patch)
        .eq("user_id", existing.user_id);
      if (error) throwDb(error, "profiles.update_by_name");

      // Ensure org membership
      await supabase
        .from("organisation_members")
        .upsert(
          { organisation_id, user_id: existing.user_id, role: "member" },
          { onConflict: "organisation_id,user_id" }
        );
    } else {
      // No existing profile — caller should use invite flow
      throw new Error(
        "Person not found. Use the invite flow to add someone who hasn't signed up yet."
      );
    }
  }

  revalidatePath("/people");
  revalidatePath("/heatmap");
}

/* =============================================================================
   togglePersonActive
   Quick toggle from the people list — no full form needed.
============================================================================= */

export async function togglePersonActive(formData: FormData) {
  const supabase = await createClient();
  const user     = await requireUser(supabase);

  const person_id      = norm(formData.get("person_id"));
  const organisation_id = norm(formData.get("organisation_id"));
  const is_active      = norm(formData.get("is_active")) === "true";

  if (!person_id || !isUuid(person_id))      throw new Error("Invalid person_id");
  if (!organisation_id || !isUuid(organisation_id)) throw new Error("Invalid org");

  await requireOrgMember(supabase, user.id, organisation_id);

  const { error } = await supabase
    .from("profiles")
    .update({ is_active, updated_at: new Date().toISOString() })
    .eq("user_id", person_id);

  if (error) throwDb(error, "profiles.toggle_active");

  revalidatePath("/people");
  revalidatePath("/heatmap");
}

/* =============================================================================
   upsertRateCard
   Create or update a rate card for the org.
   Only org admins can manage rate cards.
============================================================================= */

export async function upsertRateCard(formData: FormData) {
  const supabase = await createClient();
  const user     = await requireUser(supabase);

  const organisation_id = norm(formData.get("organisation_id"));
  const rate_card_id    = norm(formData.get("rate_card_id")) || null;
  const label           = norm(formData.get("label"));
  const rate_per_day    = parseFloat(norm(formData.get("rate_per_day")));
  const currency        = norm(formData.get("currency")) || "GBP";
  const notes           = norm(formData.get("notes")) || null;
  const is_active       = norm(formData.get("is_active")) !== "false";

  if (!label)                       throw new Error("Label is required");
  if (!organisation_id || !isUuid(organisation_id)) throw new Error("Invalid org");
  if (isNaN(rate_per_day) || rate_per_day < 0) throw new Error("Invalid rate");

  const role = await requireOrgMember(supabase, user.id, organisation_id);
  if (role !== "admin") throw new Error("Only org admins can manage rate cards");

  if (rate_card_id && isUuid(rate_card_id)) {
    const { error } = await supabase
      .from("rate_cards")
      .update({ label, rate_per_day, currency, notes, is_active,
                updated_at: new Date().toISOString() })
      .eq("id", rate_card_id)
      .eq("organisation_id", organisation_id);
    if (error) throwDb(error, "rate_cards.update");
  } else {
    const { error } = await supabase
      .from("rate_cards")
      .insert({ organisation_id, label, rate_per_day, currency, notes, is_active });
    if (error) throwDb(error, "rate_cards.insert");
  }

  revalidatePath("/people");
}

/* =============================================================================
   deleteRateCard
============================================================================= */

export async function deleteRateCard(formData: FormData) {
  const supabase = await createClient();
  const user     = await requireUser(supabase);

  const rate_card_id    = norm(formData.get("rate_card_id"));
  const organisation_id = norm(formData.get("organisation_id"));

  if (!rate_card_id || !isUuid(rate_card_id)) throw new Error("Invalid rate card");
  if (!organisation_id || !isUuid(organisation_id)) throw new Error("Invalid org");

  const role = await requireOrgMember(supabase, user.id, organisation_id);
  if (role !== "admin") throw new Error("Only org admins can delete rate cards");

  const { error } = await supabase
    .from("rate_cards")
    .delete()
    .eq("id", rate_card_id)
    .eq("organisation_id", organisation_id);

  if (error) throwDb(error, "rate_cards.delete");
  revalidatePath("/people");
}