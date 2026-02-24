// src/app/api/executive/approvals/_lib.ts
import "server-only";
import { createClient } from "@/utils/supabase/server";

export function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export async function requireUser() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) throw new Error("Unauthenticated");

  // Load profile org context
  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("active_organisation_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (pErr) throw pErr;

  let orgId = safeStr(profile?.active_organisation_id) || null;

  // ✅ Auto-assign org if missing
  if (!orgId) {
    const { data: mem, error: mErr } = await supabase
      .from("organisation_members")
      .select("organisation_id")
      .eq("user_id", user.id)
      .is("removed_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (mErr) throw mErr;

    const picked = safeStr(mem?.organisation_id) || null;
    if (picked) {
      // Persist (best-effort)
      await supabase.from("profiles").update({ active_organisation_id: picked }).eq("user_id", user.id);
      orgId = picked;
    }
  }

  return { supabase, user, orgId };
}

/**
 * In single-org mode we still keep this for compatibility,
 * but it's derived from requireUser() and returns at most one org.
 */
export async function orgIdsForUser(supabase: any, userId: string): Promise<string[]> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("active_organisation_id")
    .eq("user_id", userId)
    .maybeSingle();

  const orgId = safeStr(profile?.active_organisation_id);
  return orgId ? [orgId] : [];
}