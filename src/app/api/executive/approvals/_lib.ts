// src/app/api/executive/approvals/_lib.ts
// Shared helpers for all executive API routes.
//
// SIGNATURE COMPATIBILITY:
//   requireUser()           — used by pending/route.ts (creates supabase internally)
//   requireUser(supabase)   — used by who-blocking, sla-radar, risk-signals, portfolio (v1)
//
//   orgIdsForUser(userId)          — used by who-blocking, sla-radar, risk-signals, portfolio (v1)
//   orgIdsForUser(supabase, userId) — legacy calling convention (still works)

import "server-only";
import { createClient } from "@/utils/supabase/server";

// ─── String / number helpers ───────────────────────────────────────────────

export function safeStr(x: any): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export function num(x: any, fallback = 0): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

export function clampDays(x: any, min = 7, max = 60, fallback = 30): number {
  const n = Math.trunc(num(x, fallback));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// ─── requireUser ───────────────────────────────────────────────────────────
//
// Overloaded so it works both ways:
//   const user = await requireUser(supabase)   ← who-blocking / sla-radar / risk-signals
//   const { supabase, user, orgId } = await requireUser()  ← pending/route.ts
//
// In both forms the return value always has `.id` so callers can do user.id.

export async function requireUser(supabase?: any) {
  // If no supabase client was passed, create one (pending/route.ts pattern)
  const sb = supabase ?? (await createClient());

  const {
    data: { user },
    error: userErr,
  } = await sb.auth.getUser();

  if (userErr || !user) throw new Error("Unauthenticated");

  // Auto-assign active org (single-org mode heal)
  const { data: profile, error: pErr } = await sb
    .from("profiles")
    .select("active_organisation_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (pErr) throw pErr;

  let orgId = safeStr(profile?.active_organisation_id) || null;

  if (!orgId) {
    const { data: mem, error: mErr } = await sb
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
      // best-effort persist
      await sb
        .from("profiles")
        .update({ active_organisation_id: picked })
        .eq("user_id", user.id);
      orgId = picked;
    }
  }

  // Return shape that satisfies BOTH calling conventions:
  //   destructured: { supabase, user, orgId }
  //   direct:        user.id works because user object is returned directly
  return { supabase: sb, user, orgId };
}

// ─── orgIdsForUser ─────────────────────────────────────────────────────────
//
// Overloaded so it works both ways:
//   orgIdsForUser(userId)           ← who-blocking, sla-radar, risk-signals, portfolio(v1)
//   orgIdsForUser(supabase, userId) ← legacy callers
//
// Single-org mode: always returns at most one org ID.

export async function orgIdsForUser(
  supabaseOrUserId: any,
  userIdArg?: string
): Promise<string[]> {
  let sb: any;
  let userId: string;

  if (typeof supabaseOrUserId === "string") {
    // Called as orgIdsForUser(userId) — create client internally
    sb = await createClient();
    userId = supabaseOrUserId;
  } else {
    // Called as orgIdsForUser(supabase, userId) — legacy form
    sb = supabaseOrUserId;
    userId = safeStr(userIdArg);
  }

  if (!userId) return [];

  const { data: profile, error } = await sb
    .from("profiles")
    .select("active_organisation_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return [];

  const orgId = safeStr(profile?.active_organisation_id).trim();
  return orgId ? [orgId] : [];
}