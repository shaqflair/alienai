import "server-only";
import { createClient } from "@/utils/supabase/server";

/** string helper */
export function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

/** numeric helper */
export function num(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

/** clamp days helper used across exec endpoints */
export function clampDays(x: any, min = 7, max = 60, fallback = 30) {
  const n = Math.trunc(num(x, fallback));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * Auto-assign active org if missing, based on organisation_members.
 * Single-org mode: every request self-heals org context.
 */
export async function requireUser() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) throw new Error("Unauthenticated");

  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("active_organisation_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (pErr) throw pErr;

  let orgId = safeStr(profile?.active_organisation_id) || null;

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
      // persist (best-effort)
      await supabase.from("profiles").update({ active_organisation_id: picked }).eq("user_id", user.id);
      orgId = picked;
    }
  }

  return { supabase, user, orgId };
}

/**
 * Compatibility helper: some routes still call orgIdsForUser().
 * In single-org mode it returns at most one org.
 */
export async function orgIdsForUser(supabase: any, userId: string): Promise<string[]> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("active_organisation_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return [];
  const orgId = safeStr(profile?.active_organisation_id);
  return orgId ? [orgId] : [];
}