"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

/* ==========================================================================
   createOrgAction
========================================================================== */
export async function createOrgAction(
  formData: FormData
): Promise<{ ok: boolean; organisationId: string; error?: string }> {
  const supabase = await createClient();
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) throw new Error("Not authenticated");

  const userId = auth.user.id;
  const name = safeStr(formData.get("name")).trim();
  const timezone = safeStr(formData.get("timezone")).trim() || "Europe/London";

  if (!name) throw new Error("Organisation name is required.");

  const { data: org, error: orgErr } = await supabase
    .from("organisations")
    .insert({
      name,
      created_by: userId,
      timesheet_cutoff_weeks: 2,
      default_daily_hours: 8,
      default_working_days: 5,
    })
    .select("id")
    .single();

  if (orgErr) throw new Error(`Failed to create organisation: ${orgErr.message}`);

  const orgId = org.id as string;

  const { error: memErr } = await supabase.from("organisation_members").insert({
    organisation_id: orgId,
    user_id: userId,
    role: "owner",
    removed_at: null,
  });

  if (memErr) throw new Error(`Failed to create membership: ${memErr.message}`);

  await supabase.from("profiles").upsert(
    {
      id: userId,
      user_id: userId,
      email: auth.user.email ?? null,
      active_organisation_id: orgId,
      employment_type: "full_time",
      is_active: true,
      include_in_capacity: true,
      default_capacity_days: 5,
      skills: [],
      certifications: [],
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  void timezone;

  revalidatePath("/");
  return { ok: true, organisationId: orgId };
}

/* ==========================================================================
   savePersonaliseAction
========================================================================== */
export async function savePersonaliseAction(
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) throw new Error("Not authenticated");

    const orgId = safeStr(formData.get("organisation_id")).trim();
    const logoUrl = safeStr(formData.get("logo_url")).trim() || null;
    const website = safeStr(formData.get("website")).trim() || null;

    if (!orgId) return { ok: true };

    void logoUrl;
    void website;

    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Failed to save branding" };
  }
}

/* ==========================================================================
   saveCapacityAction
========================================================================== */
export async function saveCapacityAction(
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) throw new Error("Not authenticated");

    const orgId = safeStr(formData.get("organisation_id")).trim();
    const dailyHours = Number(formData.get("daily_hours")) || 8;
    const workingDays = Number(formData.get("working_days")) || 5;

    if (!orgId) return { ok: true };

    const { error } = await supabase
      .from("organisations")
      .update({
        default_daily_hours: dailyHours,
        default_working_days: workingDays,
      })
      .eq("id", orgId);

    if (error) return { ok: false, error: error.message };

    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Failed to save capacity" };
  }
}

/* ==========================================================================
   createFirstProjectAction
========================================================================== */
export async function createFirstProjectAction(
  formData: FormData
): Promise<{ ok: boolean; projectId: string; error?: string }> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) throw new Error("Not authenticated");

  const userId = auth.user.id;
  const orgId = safeStr(formData.get("organisation_id")).trim();
  const title = safeStr(formData.get("title")).trim();
  const projectCode = safeStr(formData.get("project_code")).trim() || null;
  const status = safeStr(formData.get("status")).trim() || "confirmed";
  const startDate = safeStr(formData.get("start_date")).trim() || null;
  const finishDate = safeStr(formData.get("finish_date")).trim() || null;

  if (!orgId) throw new Error("Missing organisation_id");
  if (!title) throw new Error("Project title is required.");

  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      title,
      user_id: userId,
      created_by: userId,
      organisation_id: orgId,
      status,
      lifecycle_status: "active",
      project_code: projectCode,
      start_date: startDate || null,
      finish_date: finishDate || null,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create project: ${error.message}`);

  revalidatePath("/");
  return { ok: true, projectId: project.id as string };
}

/* ==========================================================================
   inviteTeamAction
========================================================================== */
export async function inviteTeamAction(
  formData: FormData
): Promise<{ ok: boolean; sent: number; errors: string[]; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) throw new Error("Not authenticated");

    const orgId = safeStr(formData.get("organisation_id")).trim();
    const emailsRaw = safeStr(formData.get("emails")).trim();

    if (!emailsRaw) return { ok: true, sent: 0, errors: [] };

    const emails = emailsRaw
      .split(/[\n,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes("@") && e.includes("."));

    if (!emails.length) return { ok: true, sent: 0, errors: [] };

    const admin = createAdminClient();
    const errors: string[] = [];
    let sent = 0;

    for (const email of emails) {
      try {
        const { error } = await admin.auth.admin.inviteUserByEmail(email, {
          data: { invited_to_org: orgId },
          redirectTo: `${
            process.env.NEXT_PUBLIC_SITE_URL ?? "https://aliena.co.uk"
          }/onboarding`,
        });

        if (error) {
          errors.push(`${email}: ${error.message}`);
        } else {
          sent++;
          await admin
            .from("organisation_members")
            .upsert(
              {
                organisation_id: orgId,
                user_id: email,
                role: "member",
                removed_at: null,
              },
              { onConflict: "organisation_id,user_id", ignoreDuplicates: true }
            )
            .throwOnError()
            .then(() => {})
            .catch(() => {});
        }
      } catch (e: any) {
        errors.push(`${email}: ${e?.message ?? "Unknown error"}`);
      }
    }

    return { ok: true, sent, errors };
  } catch (e: any) {
    return {
      ok: false,
      sent: 0,
      errors: [],
      error: e?.message ?? "Invite failed",
    };
  }
}

/* ==========================================================================
   saveOnboardingProfile
   Saves to BOTH profiles and organisation_members
========================================================================== */
export async function saveOnboardingProfile(
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: auth, error: authErr } = await supabase.auth.getUser();

    if (authErr) return { ok: false, error: authErr.message };
    if (!auth?.user) return { ok: false, error: "Not authenticated" };

    const userId = auth.user.id;

    const fullName = safeStr(formData.get("full_name")).trim();
    const jobTitle = safeStr(formData.get("job_title")).trim();
    const department = safeStr(formData.get("department")).trim();
    const employmentType =
      safeStr(formData.get("employment_type")).trim() || "full_time";
    const location = safeStr(formData.get("location")).trim();
    const bio = safeStr(formData.get("bio")).trim();
    const lineManagerId = safeStr(formData.get("line_manager_id")).trim();

    if (!fullName) return { ok: false, error: "Full name is required." };
    if (!jobTitle) return { ok: false, error: "Job title is required." };

    // 1) Resolve active org from profile first
    const { data: existingProfile, error: profileLookupErr } = await supabase
      .from("profiles")
      .select("active_organisation_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (profileLookupErr) {
      return {
        ok: false,
        error: `Profile lookup failed: ${profileLookupErr.message}`,
      };
    }

    let activeOrgId =
      typeof existingProfile?.active_organisation_id === "string"
        ? existingProfile.active_organisation_id
        : null;

    // 2) Fallback to latest active membership only if profile has no active org
    if (!activeOrgId) {
      const { data: memRow, error: membershipErr } = await supabase
        .from("organisation_members")
        .select("organisation_id")
        .eq("user_id", userId)
        .is("removed_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (membershipErr) {
        return {
          ok: false,
          error: `Membership lookup failed: ${membershipErr.message}`,
        };
      }

      activeOrgId = memRow?.organisation_id ?? null;
    }

    // 3) Save profile
    const { error: upsertErr } = await supabase
      .from("profiles")
      .upsert(
        {
          id: userId,
          user_id: userId,
          full_name: fullName,
          email: auth.user.email ?? null,
          job_title: jobTitle || null,
          department: department || null,
          employment_type: employmentType,
          location: location || null,
          bio: bio || null,
          line_manager_id: lineManagerId || null,
          active_organisation_id: activeOrgId,
          is_active: true,
          include_in_capacity: true,
          default_capacity_days: 5,
          skills: [],
          certifications: [],
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    if (upsertErr) {
      return { ok: false, error: `Profile save failed: ${upsertErr.message}` };
    }

    // 4) Save org-specific fields to the active org membership
    if (activeOrgId) {
      const { data: updatedMembership, error: memberUpdateErr } = await supabase
        .from("organisation_members")
        .update({
          job_title: jobTitle || null,
          department: department || null,
        })
        .eq("organisation_id", activeOrgId)
        .eq("user_id", userId)
        .is("removed_at", null)
        .select("organisation_id, user_id, job_title, department")
        .maybeSingle();

      if (memberUpdateErr) {
        return {
          ok: false,
          error: `Member details save failed: ${memberUpdateErr.message}`,
        };
      }

      if (!updatedMembership) {
        return {
          ok: false,
          error:
            "Profile saved, but no active organisation membership row was updated.",
        };
      }
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