"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { sendOrgInviteEmail } from "@/lib/email/sendOrgInviteEmail";
import crypto from "crypto";

/* =============================================================================
    UTILITIES
============================================================================= */
function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function isEmail(x: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
}
function token64() {
  return crypto.randomBytes(32).toString("hex");
}
function expiresAt7Days(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString();
}
function requireOrigin(): string {
  const o =
    process.env.APP_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL;
  if (!o) throw new Error("Missing APP_ORIGIN env var. Please check your .env file.");
  return o.replace(/\/+$/, "");
}

/* =============================================================================
    STEP 1: Create org
============================================================================= */
export async function createOrgAction(formData: FormData) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const name     = safeStr(formData.get("name")).trim();
  const industry = safeStr(formData.get("industry")).trim();
  const timezone = safeStr(formData.get("timezone")).trim() || "Europe/London";

  if (!name) throw new Error("Organisation name is required");

  const { data: org, error: orgErr } = await sb
    .from("organisations")
    .insert({ name, industry: industry || null, timezone })
    .select("id")
    .single();

  if (orgErr) throw new Error(orgErr.message);

  const { error: memErr } = await sb
    .from("organisation_members")
    .insert({
      organisation_id: org.id,
      user_id:         user.id,
      role:            "owner",
    });

  if (memErr) throw new Error(memErr.message);

  revalidatePath("/onboarding");
  return { organisationId: org.id };
}

/* =============================================================================
    STEP 2: Personalise
============================================================================= */
export async function savePersonaliseAction(formData: FormData) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const organisationId = safeStr(formData.get("organisation_id")).trim();
  const logo_url       = safeStr(formData.get("logo_url")).trim()    || null;
  const brand_colour   = safeStr(formData.get("brand_colour")).trim() || null;
  const website        = safeStr(formData.get("website")).trim()      || null;

  if (!organisationId) throw new Error("Missing organisation_id");

  const { error } = await sb
    .from("organisations")
    .update({ logo_url, brand_colour, website })
    .eq("id", organisationId);

  if (error) throw new Error(error.message);
  revalidatePath("/onboarding");
}

/* =============================================================================
    STEP 3: Capacity
============================================================================= */
export async function saveCapacityAction(formData: FormData) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const organisationId = safeStr(formData.get("organisation_id")).trim();
  const daily_hours    = Number(formData.get("daily_hours"))    || 8;
  const working_days   = Number(formData.get("working_days"))   || 5;

  if (!organisationId) throw new Error("Missing organisation_id");

  try {
    await sb
      .from("organisations")
      .update({ default_daily_hours: daily_hours, default_working_days: working_days })
      .eq("id", organisationId);
  } catch (err) {
    console.error("Failed to update capacity defaults:", err);
  }

  revalidatePath("/onboarding");
}

/* =============================================================================
    STEP 4: First Project
============================================================================= */
export async function createFirstProjectAction(formData: FormData) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const organisationId = safeStr(formData.get("organisation_id")).trim();
  const title          = safeStr(formData.get("title")).trim();
  const project_code   = safeStr(formData.get("project_code")).trim() || null;
  const start_date     = safeStr(formData.get("start_date")).trim()   || null;
  const finish_date    = safeStr(formData.get("finish_date")).trim()  || null;
  const status         = safeStr(formData.get("status")).trim()       || "confirmed";

  if (!organisationId) throw new Error("Missing organisation_id");
  if (!title)          throw new Error("Project title is required");

  const { data: project, error } = await sb
    .from("projects")
    .insert({
      organisation_id: organisationId,
      title,
      project_code,
      start_date:      start_date   || null,
      finish_date:     finish_date  || null,
      resource_status: status,
      colour:          "#00b8db",
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/onboarding");
  return { projectId: project.id };
}

/* =============================================================================
    STEP 5: Bulk Invite
============================================================================= */
export async function inviteTeamAction(formData: FormData) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const organisationId = safeStr(formData.get("organisation_id")).trim();
  const rawEmails      = safeStr(formData.get("emails"));
  const role           = "member" as const;

  const emails = rawEmails
    .split(/[\n,;]+/)
    .map(e => e.trim().toLowerCase())
    .filter(e => isEmail(e));

  if (!emails.length) return { sent: 0, errors: [] };

  const { data: org }     = await sb.from("organisations").select("name").eq("id", organisationId).maybeSingle();
  const { data: profile } = await sb.from("profiles").select("full_name").eq("user_id", user.id).maybeSingle();

  const orgName     = safeStr(org?.name || "your organisation");
  const inviterName = safeStr(profile?.full_name || "");
  const origin      = requireOrigin();

  const errors: string[] = [];
  let sent = 0;

  for (const email of emails) {
    try {
      const newToken  = token64();
      const expiresAt = expiresAt7Days();

      const { data: inv, error: invErr } = await sb
        .from("organisation_invites")
        .insert({
          organisation_id: organisationId,
          email,
          role,
          token:      newToken,
          invited_by: user.id,
          status:     "pending",
          expires_at: expiresAt,
        })
        .select("id")
        .single();

      if (invErr) {
        if ((invErr as any)?.code === "23505") {
          errors.push(`${email}: already invited`);
          continue;
        }
        errors.push(`${email}: ${invErr.message}`);
        continue;
      }

      const inviteUrl = `${origin}/organisations/invite/${encodeURIComponent(newToken)}`;

      await sendOrgInviteEmail({
        to:           email,
        orgName,
        inviterName:  inviterName || null,
        inviterEmail: safeStr(user.email) || null,
        role,
        inviteUrl,
        inviteId:     inv.id,
        orgId:        organisationId,
        expiresAt,
      });

      sent++;
    } catch (e: any) {
      errors.push(`${email}: ${e?.message ?? "Failed to send email"}`);
    }
  }

  revalidatePath("/onboarding");
  return { sent, errors };
}

/* =============================================================================
    PROFILE SETUP (ProfileSetupForm)
    Returns { ok, error? } instead of throwing so the real error message
    survives Next.js production mode (which strips thrown error messages).
============================================================================= */
export async function saveOnboardingProfile(
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  const sb = await createClient();
  const { data: { user }, error: authErr } = await sb.auth.getUser();
  if (authErr || !user) return { ok: false, error: "Not authenticated" };

  const fullName       = safeStr(formData.get("full_name")).trim();
  const jobTitle       = safeStr(formData.get("job_title")).trim();
  const department     = safeStr(formData.get("department")).trim();
  const employmentType = safeStr(formData.get("employment_type")).trim() || "full_time";
  const location       = safeStr(formData.get("location")).trim();
  const bio            = safeStr(formData.get("bio")).trim();
  const lineManagerId  = safeStr(formData.get("line_manager_id")).trim();

  if (!fullName) return { ok: false, error: "Full name is required." };
  if (!jobTitle) return { ok: false, error: "Job title is required." };

  // Core fields — always safe to write
  const corePatch: Record<string, any> = {
    full_name:  fullName,
    job_title:  jobTitle,
    updated_at: new Date().toISOString(),
  };

  // Extended fields — added progressively so missing columns don't block save
  const extendedFields: Record<string, any> = {
    department:          department    || null,
    employment_type:     employmentType,
    location:            location      || null,
    bio:                 bio           || null,
    line_manager_id:     lineManagerId || null,
    onboarding_complete: true,
  };

  // Try full patch first
  const fullPatch = { ...corePatch, ...extendedFields };

  async function tryUpdate(patch: Record<string, any>): Promise<string | null> {
    // Try upsert by user_id
    const { error: e1 } = await sb
      .from("profiles")
      .upsert({ user_id: user!.id, ...patch }, { onConflict: "user_id" });
    if (!e1) return null;

    // Fallback: update by user_id
    const { error: e2 } = await sb
      .from("profiles").update(patch).eq("user_id", user!.id);
    if (!e2) return null;

    // Fallback: update by id
    const { error: e3 } = await sb
      .from("profiles").update(patch).eq("id", user!.id);
    if (!e3) return null;

    return e3.message;
  }

  // Attempt 1: full patch
  let errMsg = await tryUpdate(fullPatch);

  // Attempt 2: core only (in case extended columns don't exist yet)
  if (errMsg) {
    errMsg = await tryUpdate(corePatch);
  }

  if (errMsg) return { ok: false, error: `Profile save failed: ${errMsg}` };

  // Update auth display name (non-fatal)
  try {
    await sb.auth.updateUser({ data: { full_name: fullName } });
  } catch { /* ignore */ }

  revalidatePath("/");
  revalidatePath("/onboarding");
  return { ok: true };
}