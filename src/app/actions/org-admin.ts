"use server";
// src/app/actions/org-admin.ts
import "server-only";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";

export type OrgRole = "owner" | "admin" | "member";

function normRole(x: any): OrgRole {
  const r = String(x ?? "").trim().toLowerCase();
  if (r === "owner" || r === "admin" || r === "member") return r;
  return "member";
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

/**
 * Returns your active role in the org, or null if not a current member.
 */
export async function getMyOrgRole(organisationId: string): Promise<OrgRole | null> {
  const sb = await createClient();
  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) return null;

  const { data, error } = await sb
    .from("organisation_members")
    .select("role, removed_at")
    .eq("organisation_id", organisationId)
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
  const role = await getMyOrgRole(organisationId);
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
/* Server Actions used by src/app/settings/page.tsx                    */
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

  const name = safeStr(formData.get("name")).trim();
  if (!name) throw new Error("Organisation name is required");

  const { data: org, error: orgErr } = await sb
    .from("organisations")
    .insert({ name })
    .select("id")
    .single();

  if (orgErr) throw new Error(orgErr.message);

  const { error: memErr } = await sb
    .from("organisation_members")
    .insert({ organisation_id: org.id, user_id: auth.user.id, role: "owner" });

  if (memErr) throw new Error(memErr.message);

  redirect("/settings");
}

/**
 * Rename the active organisation.
 * Form fields: org_id (string), name (string)
 */
export async function renameOrganisation(formData: FormData) {
  const sb = await createClient();

  const orgId = safeStr(formData.get("org_id")).trim();
  const name  = safeStr(formData.get("name")).trim();

  if (!orgId) throw new Error("org_id is required");
  if (!name)  throw new Error("Organisation name is required");

  await requireOrgAdmin(orgId);

  const { error } = await sb
    .from("organisations")
    .update({ name })
    .eq("id", orgId);

  if (error) throw new Error(error.message);

  redirect("/settings");
}

/**
 * Invite a user to the active organisation by email.
 * Form fields: org_id (string), email (string), role ("member" | "admin")
 *
 * NOTE: Requires an invites table or Supabase Auth invite flow.
 * Currently inserts into organisation_invites - wire up email sending separately.
 */
export async function inviteToOrganisation(formData: FormData) {
  const sb = await createClient();

  const orgId = safeStr(formData.get("org_id")).trim();
  const email = safeStr(formData.get("email")).trim().toLowerCase();
  const role  = normRole(formData.get("role"));

  if (!orgId) throw new Error("org_id is required");
  if (!email) throw new Error("Email is required");

  await requireOrgAdmin(orgId);

  const { data: auth } = await sb.auth.getUser();
  const invitedBy = auth?.user?.id ?? null;

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

  redirect("/settings");
}