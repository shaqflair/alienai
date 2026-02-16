import "server-only";
import { createClient } from "@/utils/supabase/server";

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

/**
 * ✅ org membership guard
 * NOTE: organisation_members does NOT have is_active in your schema,
 * so we only read "role".
 */
export async function requireOrgMember(supabase: any, orgId: string, userId: string) {
  const { data, error } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");

  return data;
}

export async function requireOrgAdmin(supabase: any, orgId: string, userId: string) {
  const mem = await requireOrgMember(supabase, orgId, userId);
  const role = String((mem as any)?.role ?? "").toLowerCase();
  if (role !== "admin") throw new Error("Forbidden");
  return mem;
}
