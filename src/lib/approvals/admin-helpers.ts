// src/lib/approvals/admin-helpers.ts
import "server-only";

import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

export function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export async function sb() {
  return await createClient();
}

export async function requireAuth(supabase: any) {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error(error.message);
  if (!data?.user) throw new Error("Unauthorized");
  return data.user;
}

export async function requireOrgMember(supabase: any, organisationId: string, userId: string) {
  const { data, error } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
  return { role: String((data as any)?.role ?? "").toLowerCase() || "member" };
}

/**
 * Legacy: org admin check (still useful elsewhere),
 * but NOT used for approvals writes in enterprise mode (B).
 */
export async function requireOrgAdmin(supabase: any, organisationId: string, userId: string) {
  const { role } = await requireOrgMember(supabase, organisationId, userId);
  if (role !== "admin") throw new Error("Forbidden");
  return { role };
}

export async function requirePlatformAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
  return true;
}

/**
 * ✅ ENTERPRISE MODE (B)
 * Approvals configuration is writable by platform admins only.
 *
 * Optional extra safety: also require org membership so platform admins
 * must at least be members of the org they are changing.
 */
export async function requireApprovalsWriter(supabase: any, organisationId: string, userId: string) {
  await requirePlatformAdmin(supabase, userId);

  // Optional but recommended: prevent “global admin editing random org” unless they’re a member.
  await requireOrgMember(supabase, organisationId, userId);

  return true;
}