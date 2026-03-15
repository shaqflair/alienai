// src/app/onboarding/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export async function saveOnboardingProfile(
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return { ok: false, error: authErr.message };
    if (!auth?.user) return { ok: false, error: "Not authenticated" };

    const userId = auth.user.id;

    const fullName       = safeStr(formData.get("full_name")).trim();
    const jobTitle       = safeStr(formData.get("job_title")).trim();
    const department     = safeStr(formData.get("department")).trim();
    const employmentType = safeStr(formData.get("employment_type")).trim() || "full_time";
    const location       = safeStr(formData.get("location")).trim();
    const bio            = safeStr(formData.get("bio")).trim();
    const lineManagerId  = safeStr(formData.get("line_manager_id")).trim();

    if (!fullName) return { ok: false, error: "Full name is required." };
    if (!jobTitle)  return { ok: false, error: "Job title is required." };

    // Resolve active org for this user
    const { data: memRow } = await supabase
      .from("organisation_members")
      .select("organisation_id")
      .eq("user_id", userId)
      .is("removed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const activeOrgId = memRow?.organisation_id ?? null;

    // profiles.id must equal auth user id (FK to auth.users.id)
    const profilePatch: Record<string, any> = {
      id:                   userId,
      user_id:              userId,
      full_name:            fullName,
      email:                auth.user.email ?? null,
      job_title:            jobTitle || null,
      department:           department || null,
      employment_type:      employmentType,
      location:             location || null,
      bio:                  bio || null,
      line_manager_id:      lineManagerId || null,
      active_organisation_id: activeOrgId,
      is_active:            true,
      include_in_capacity:  true,
      default_capacity_days: 5,
      skills:               [],
      certifications:       [],
      updated_at:           new Date().toISOString(),
    };

    const { error: upsertErr } = await supabase
      .from("profiles")
      .upsert(profilePatch, { onConflict: "user_id" });

    if (upsertErr) {
      return { ok: false, error: `Profile save failed: ${upsertErr.message}` };
    }

    try {
      await supabase.auth.updateUser({ data: { full_name: fullName } });
    } catch {
      // non-fatal
    }

    revalidatePath("/");
    revalidatePath("/onboarding");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Profile save failed" };
  }
}