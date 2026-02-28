// src/app/api/executive/approvals/_lib.ts
// Shared helpers for all executive API routes.
//
// SIGNATURE COMPATIBILITY:
//   requireUser()            — returns { supabase, user, orgId }
//   requireUser(supabase)    — returns { supabase, user, orgId }
//   orgIdsForUser(userId)            — single-org mode: returns [activeOrgId] or []
//   orgIdsForUser(supabase, userId)  — legacy calling convention (still works)

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

// ─── Internal: read active org + heal if missing ───────────────────────────
//
// Single-org mode "heal":
// - read profiles.active_organisation_id
// - if missing: pick earliest organisation_members row
// - best-effort persist back to profiles.active_organisation_id

async function getOrHealActiveOrgId(sb: any, userId: string): Promise<string | null> {
  const uid = safeStr(userId).trim();
  if (!uid) return null;

  // 1) Try profile
  try {
    const { data: profile, error: pErr } = await sb
      .from("profiles")
      .select("id, active_organisation_id")
      .eq("id", uid)
      .maybeSingle();

    if (!pErr) {
      const orgId = safeStr(profile?.active_organisation_id).trim();
      if (orgId) return orgId;
    }
  } catch {
    // ignore and try membership heal
  }

  // 2) Heal from membership
  const { data: mem, error: mErr } = await sb
    .from("organisation_members")
    .select("organisation_id")
    .eq("user_id", uid)
    .is("removed_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (mErr) throw mErr;

  const picked = safeStr(mem?.organisation_id).trim();
  if (!picked) return null;

  // 3) Best-effort persist (don’t crash if blocked by RLS / missing row)
  try {
    await sb.from("profiles").update({ active_organisation_id: picked }).eq("id", uid);
  } catch {
    // ignore
  }

  return picked;
}

// ─── requireUser ───────────────────────────────────────────────────────────
//
// Returns: { supabase, user, orgId }
//
// Many routes use:
//   const _auth = await requireUser(supabase); const user = (_auth as any)?.user ?? _auth;
// so we keep returning an object with `.user`.

export async function requireUser(supabase?: any) {
  const sb = supabase ?? (await createClient());

  const {
    data: { user },
    error: userErr,
  } = await sb.auth.getUser();

  if (userErr || !user) throw new Error("Unauthenticated");

  const orgId = await getOrHealActiveOrgId(sb, user.id);

  return { supabase: sb, user, orgId };
}

// ─── orgIdsForUser ─────────────────────────────────────────────────────────
//
// Overloaded:
//   orgIdsForUser(userId)            — creates client internally
//   orgIdsForUser(supabase, userId)  — uses provided client
//
// Single-org mode: always returns at most one org ID.
// ✅ Now uses the SAME heal logic as requireUser().

export async function orgIdsForUser(
  supabaseOrUserId: any,
  userIdArg?: string
): Promise<string[]> {
  let sb: any;
  let userId: string;

  if (typeof supabaseOrUserId === "string") {
    sb = await createClient();
    userId = supabaseOrUserId;
  } else {
    sb = supabaseOrUserId;
    userId = safeStr(userIdArg);
  }

  userId = safeStr(userId).trim();
  if (!userId) return [];

  const orgId = await getOrHealActiveOrgId(sb, userId);
  return orgId ? [orgId] : [];
}