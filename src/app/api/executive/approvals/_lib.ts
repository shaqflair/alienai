// src/app/api/executive/approvals/_lib.ts
import "server-only";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

export function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
export function num(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

export async function requireUser(supabase: any) {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error(error.message);
  if (!data?.user) throw new Error("Unauthorized");
  return data.user;
}

/**
 * SINGLE-ORG MODE
 * Resolve org from profiles.active_organisation_id.
 * Kept name orgIdsForUser() for backwards compatibility with existing endpoints.
 */
export async function orgIdsForUser(userId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("active_organisation_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const orgId = safeStr(data?.active_organisation_id).trim();
  if (!orgId) return [];

  return [orgId];
}

export function clampDays(v: string | null): 7 | 14 | 30 | 60 {
  const s = safeStr(v).trim().toLowerCase();
  const n = Number(s);
  if (n === 7 || n === 14 || n === 30 || n === 60) return n;
  return 30;
}

export function riskState(nowMs: number, slaDueIso?: string | null) {
  const s = safeStr(slaDueIso).trim();
  if (!s) return { state: "ok" as const, rag: "G" as const, hoursToBreach: null as number | null };

  const due = new Date(s).getTime();
  if (!Number.isFinite(due)) {
    return { state: "ok" as const, rag: "G" as const, hoursToBreach: null as number | null };
  }

  const diffHrs = Math.round((due - nowMs) / 36e5);

  if (nowMs > due) return { state: "breached" as const, rag: "R" as const, hoursToBreach: diffHrs };
  if (diffHrs <= 48) return { state: "at_risk" as const, rag: "A" as const, hoursToBreach: diffHrs };
  return { state: "ok" as const, rag: "G" as const, hoursToBreach: diffHrs };
}

export function daysWaiting(createdAtIso?: string | null) {
  const s = safeStr(createdAtIso).trim();
  if (!s) return 0;
  const t = new Date(s).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 864e5));
}