//
// Single source of truth for the active organisation in server context.
//
// Usage:
//   const orgId = await getActiveOrgId();          // returns null if not set
//   const orgId = await requireOrgId();            // throws if not set — use in actions
//   const { orgId, userId } = await requireOrgContext(); // both at once

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";

const COOKIE_NAME = "active_org_id";

// ── Read active org from cookie (nullable) ────────────────────────────────────

export async function getActiveOrgId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value ?? null;
}

// ── Require active org — throws if missing ────────────────────────────────────
// Use this in any server action or route that must have an org context.

export async function requireOrgId(): Promise<string> {
  const orgId = await getActiveOrgId();
  if (!orgId) {
    throw new Error(
      "No active organisation set. " +
      "Visit /settings to select an organisation before continuing."
    );
  }
  return orgId;
}

// ── Require both authed user + active org ─────────────────────────────────────
// The most common pattern in server actions.
//
// Example:
//   const { orgId, userId, supabase } = await requireOrgContext();
//   const { data } = await supabase
//     .from("artifacts")
//     .select("*")
//     .eq("organisation_id", orgId)   // ← always scoped
//     .eq("project_id", projectId);

export async function requireOrgContext(): Promise<{
  orgId: string;
  userId: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
}> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr) throw new Error(authErr.message);
  if (!user) redirect("/login");

  const orgId = await requireOrgId();

  // Verify the user is actually a member of this org (defence in depth)
  const { data: membership, error: memErr } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", orgId)
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);
  if (!membership) {
    throw new Error(
      `User is not a member of organisation ${orgId}. ` +
      "This request has been blocked."
    );
  }

  return { orgId, userId: user.id, supabase };
}

// ── Require org admin context ─────────────────────────────────────────────────
// Throws if the user is not an admin or owner of the active org.

export async function requireOrgAdminContext(): Promise<{
  orgId: string;
  userId: string;
  role: "admin" | "owner";
  supabase: Awaited<ReturnType<typeof createClient>>;
}> {
  const { orgId, userId, supabase } = await requireOrgContext();

  const { data: membership, error } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", orgId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const role = membership?.role as string;
  if (role !== "admin" && role !== "owner") {
    throw new Error("Admin or owner role required for this action.");
  }

  return { orgId, userId, role: role as "admin" | "owner", supabase };
}