"use server";
// src/app/actions/org-admin.ts

import "server-only";

import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { redirect } from "next/navigation";

export type OrgRole = "owner" | "admin" | "member";
type InviteRole = "admin" | "member";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(x || "").trim()
  );
}

function normRole(x: unknown): OrgRole {
  const r = safeStr(x).trim().toLowerCase();
  if (r === "owner" || r === "admin" || r === "member") return r;
  return "member";
}

function normInviteRole(x: unknown): InviteRole {
  const r = safeStr(x).trim().toLowerCase();
  return r === "admin" ? "admin" : "member";
}

function isEmailLike(v: string) {
  const s = safeStr(v).trim();
  return s.includes("@") && s.includes(".");
}

function sbErrText(e: any) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (typeof e?.message === "string") return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

async function updateActiveOrganisationInProfile(
  sb: any,
  userId: string,
  organisationId: string | null
) {
  const first = await sb
    .from("profiles")
    .update({ active_organisation_id: organisationId })
    .eq("user_id", userId);

  if (!first.error) return;

  const msg = sbErrText(first.error).toLowerCase();
  const looksLikeColumnMismatch =
    msg.includes("column") ||
    msg.includes("user_id") ||
    msg.includes("schema") ||
    msg.includes("does not exist");

  if (!looksLikeColumnMismatch) {
    throw new Error(sbErrText(first.error));
  }

  const second = await sb
    .from("profiles")
    .update({ active_organisation_id: organisationId })
    .eq("id", userId);

  if (second.error) {
    throw new Error(sbErrText(second.error));
  }
}

/**
 * Returns your active role in the org, or null if not a current member.
 */
export async function getMyOrgRole(organisationId: string): Promise<OrgRole | null> {
  const orgId = safeStr(organisationId).trim();
  if (!orgId || !isUuid(orgId)) return null;

  const sb = await createClient();
  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) return null;

  const { data, error } = await sb
    .from("organisation_members")
    .select("role, removed_at")
    .eq("organisation_id", orgId)
    .eq("user_id", auth.user.id)
    .is("removed_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return normRole(data.role);
}

/**
 * Throws if the current user is not owner/admin of the org.
 */
export async function requireOrgAdmin(organisationId: string) {
  const orgId = safeStr(organisationId).trim();
  if (!orgId || !isUuid(orgId)) throw new Error("Invalid organisation id");

  const role = await getMyOrgRole(orgId);
  if (!role) throw new Error("Not a member of this organisation");
  if (!(role === "owner" || role === "admin")) throw new Error("Admin permission required");

  return { role };
}

/**
 * Convenience boolean check.
 */
export async function isOrgAdmin(organisationId: string): Promise<boolean> {
  try {
    await requireOrgAdmin(organisationId);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Server Actions                                                      */
/* ------------------------------------------------------------------ */

/**
 * Create a new organisation and add the current user as owner.
 * Form field: name (string)
 */
export async function createOrganisation(formData: FormData) {
  const sb = await createClient();

  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) throw new Error("Not authenticated");

  const userId = safeStr(auth.user.id).trim();
  if (!userId || !isUuid(userId)) throw new Error("Invalid authenticated user");

  const name = safeStr(formData.get("name")).trim();
  if (!name) throw new Error("Organisation name is required");
  if (name.length > 120) throw new Error("Organisation name is too long");

  const { data: org, error: orgErr } = await sb
    .from("organisations")
    .insert({ name, created_by: userId })
    .select("id")
    .single();

  if (orgErr) throw new Error(orgErr.message);
  if (!org?.id) throw new Error("Failed to create organisation");

  const { error: memErr } = await sb.from("organisation_members").insert({
    organisation_id: org.id,
    user_id: userId,
    role: "owner",
    removed_at: null,
  });

  if (memErr) {
    await sb.from("organisations").delete().eq("id", org.id);
    throw new Error(`Organisation created but owner membership failed: ${memErr.message}`);
  }

  await updateActiveOrganisationInProfile(sb, userId, org.id);

  redirect("/settings");
}

/**
 * Rename organisation.
 * Form fields: org_id (string), name (string)
 */
export async function renameOrganisation(formData: FormData) {
  const sb = await createClient();

  const orgId = safeStr(formData.get("org_id")).trim();
  const name = safeStr(formData.get("name")).trim();

  if (!orgId || !isUuid(orgId)) throw new Error("org_id is required");
  if (!name) throw new Error("Organisation name is required");
  if (name.length > 120) throw new Error("Organisation name is too long");

  await requireOrgAdmin(orgId);

  const { error } = await sb
    .from("organisations")
    .update({ name })
    .eq("id", orgId);

  if (error) throw new Error(error.message);

  redirect("/settings");
}

/**
 * Invite a user to an organisation by email.
 * Form fields: org_id (string), email (string), role ("member" | "admin")
 *
 * 1. Inserts into organisation_invites table
 * 2. Sends Supabase auth invite email via admin client so the user gets a
 *    magic link that lands them on /auth/reset to set their password.
 *    This is non-fatal — if the user already exists in auth, it just logs a warning.
 */
export async function inviteToOrganisation(formData: FormData) {
  const sb = await createClient();

  const orgId = safeStr(formData.get("org_id")).trim();
  const email = safeStr(formData.get("email")).trim().toLowerCase();
  const role = normInviteRole(formData.get("role"));

  if (!orgId || !isUuid(orgId)) throw new Error("org_id is required");
  if (!email) throw new Error("Email is required");
  if (!isEmailLike(email)) throw new Error("Valid email is required");

  await requireOrgAdmin(orgId);

  const { data: { user }, error: authErr } = await sb.auth.getUser();
  if (authErr) throw authErr;
  if (!user) throw new Error("Not authenticated");

  const invitedBy = safeStr(user.id).trim() || null;

  // 1. Insert into organisation_invites
  const { error } = await sb
    .from("organisation_invites")
    .insert({
      organisation_id: orgId,
      email,
      role,
      invited_by: invitedBy,
      status: "pending",
    });

  if (error) throw new Error(error.message);

  // 2. Send Supabase auth invite email so user can set password on first login.
  //    Uses admin client (service role) to call inviteUserByEmail.
  //    The redirectTo lands them on /auth/reset (set-password page).
  //    Non-fatal: if user already exists in Supabase auth, we just skip.
  try {
    const admin = createAdminClient();
    const baseUrl = process.env.NEXT_PUBLIC_APP_BASE_URL || "https://aliena.co.uk";
    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${baseUrl}/auth/reset`,
      data: {
        organisation_id: orgId,
        invited_by: invitedBy,
        role,
      },
    });
    if (inviteErr) {
      // User may already exist — not a hard failure
      console.warn("[inviteToOrganisation] Supabase invite email warning:", inviteErr.message);
    }
  } catch (inviteErr: any) {
    console.warn("[inviteToOrganisation] Supabase invite email failed:", inviteErr?.message);
  }

  redirect("/settings");
}