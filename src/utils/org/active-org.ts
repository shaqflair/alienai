import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";

const COOKIE_NAME = "active_org_id";

async function setActiveOrgCookie(orgId: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, orgId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
  });
}

async function clearActiveOrgCookie() {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, "", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  });
}

async function getUserFromSupabase() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) throw new Error(error.message);
  if (!user) redirect("/login");

  return { supabase, user };
}

async function userHasMembership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  orgId: string
) {
  const { data, error } = await supabase
    .from("organisation_members")
    .select("organisation_id")
    .eq("organisation_id", orgId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return !!data;
}

export async function getActiveOrgId(): Promise<string | null> {
  const cookieStore = await cookies();
  const cookieOrgId = cookieStore.get(COOKIE_NAME)?.value ?? null;

  const { supabase, user } = await getUserFromSupabase();

  // 1) cookie first, but only if valid membership still exists
  if (cookieOrgId) {
    const valid = await userHasMembership(supabase, user.id, cookieOrgId);
    if (valid) return cookieOrgId;
    await clearActiveOrgCookie();
  }

  // 2) profile active org fallback
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("active_organisation_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileErr) throw new Error(profileErr.message);

  const profileOrgId = profile?.active_organisation_id ?? null;

  if (profileOrgId) {
    const valid = await userHasMembership(supabase, user.id, profileOrgId);
    if (valid) {
      await setActiveOrgCookie(profileOrgId);
      return profileOrgId;
    }
  }

  // 3) single-membership auto-bind fallback
  const { data: memberships, error: memErr } = await supabase
    .from("organisation_members")
    .select("organisation_id")
    .eq("user_id", user.id)
    .is("removed_at", null);

  if (memErr) throw new Error(memErr.message);

  const uniqueOrgIds = Array.from(
    new Set((memberships ?? []).map((m) => m.organisation_id).filter(Boolean))
  );

  if (uniqueOrgIds.length === 1) {
    const orgId = uniqueOrgIds[0];

    const { error: updateErr } = await supabase
      .from("profiles")
      .update({ active_organisation_id: orgId })
      .eq("user_id", user.id);

    if (updateErr) {
      console.warn("Failed to persist active_organisation_id:", updateErr.message);
    }

    await setActiveOrgCookie(orgId);
    return orgId;
  }

  // 4) no org or multi-org without explicit selection
  return null;
}

export async function requireOrgId(): Promise<string> {
  const orgId = await getActiveOrgId();
  if (!orgId) {
    throw new Error(
      "No active organisation set. Visit /settings to select an organisation before continuing."
    );
  }
  return orgId;
}

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

  const { data: membership, error: memErr } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", orgId)
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);
  if (!membership) {
    throw new Error(`User is not a member of organisation ${orgId}.`);
  }

  return { orgId, userId: user.id, supabase };
}

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