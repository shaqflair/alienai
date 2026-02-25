// src/app/actions/org-admin.ts
"use server";

import "server-only";
import { createClient } from "@/utils/supabase/server";

export type OrgRole = "owner" | "admin" | "member";

function normRole(x: any): OrgRole {
  const r = String(x ?? "").trim().toLowerCase();
  if (r === "owner" || r === "admin" || r === "member") return r;
  return "member";
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