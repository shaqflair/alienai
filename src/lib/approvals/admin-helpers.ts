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

/* -------------------------------------------------------------------------------------------------
 * Profiles loader (needed by /api/approvals/org-users and /api/approvals/resolve)
 * ------------------------------------------------------------------------------------------------- */

function looksMissingColumn(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

export type ProfileLite = {
  id: string;
  email?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
};

/**
 * Loads profile rows for a list of auth user IDs.
 * Works with either:
 *  - profiles.id = auth.users.id   (common)
 *  - profiles.user_id = auth.users.id (alternate)
 *
 * Returns a map keyed by user id.
 */
export async function loadProfilesByUserIds(
  supabase: any,
  userIds: string[]
): Promise<Record<string, ProfileLite>> {
  const ids = Array.from(new Set((userIds || []).map(safeStr).filter(Boolean)));
  if (!ids.length) return {};

  // Attempt #1: profiles.id IN (...)
  {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, avatar_url")
      .in("id", ids);

    if (!error) {
      const out: Record<string, ProfileLite> = {};
      for (const p of data || []) {
        const id = safeStr((p as any)?.id);
        if (!id) continue;
        out[id] = {
          id,
          email: (p as any)?.email ?? null,
          full_name: (p as any)?.full_name ?? null,
          avatar_url: (p as any)?.avatar_url ?? null,
        };
      }
      return out;
    }

    // If it's NOT a schema mismatch, surface the error
    if (!looksMissingColumn(error) && !String(error.message || "").toLowerCase().includes("id")) {
      throw new Error(error.message);
    }
    // else fall through to try profiles.user_id
  }

  // Attempt #2: profiles.user_id IN (...)
  {
    const { data, error } = await supabase
      .from("profiles")
      .select("user_id, email, full_name, avatar_url")
      .in("user_id", ids);

    if (error) throw new Error(error.message);

    const out: Record<string, ProfileLite> = {};
    for (const p of data || []) {
      const id = safeStr((p as any)?.user_id);
      if (!id) continue;
      out[id] = {
        id,
        email: (p as any)?.email ?? null,
        full_name: (p as any)?.full_name ?? null,
        avatar_url: (p as any)?.avatar_url ?? null,
      };
    }
    return out;
  }
}
