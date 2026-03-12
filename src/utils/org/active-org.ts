import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";

const COOKIE_NAME = "active_org_id";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(x || "").trim()
  );
}

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
  if (!isUuid(orgId)) return false;

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

async function getProfileActiveOrgId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<string | null> {
  const byUserId = await supabase
    .from("profiles")
    .select("active_organisation_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!byUserId.error) {
    const orgId = safeStr(byUserId.data?.active_organisation_id).trim();
    return isUuid(orgId) ? orgId : null;
  }

  const msg = String(byUserId.error?.message ?? "").toLowerCase();
  const looksLikeSchemaMismatch =
    msg.includes("column") ||
    msg.includes("user_id") ||
    msg.includes("schema") ||
    msg.includes("does not exist");

  if (!looksLikeSchemaMismatch) {
    throw new Error(byUserId.error.message);
  }

  const byId = await supabase
    .from("profiles")
    .select("active_organisation_id")
    .eq("id", userId)
    .maybeSingle();

  if (byId.error) throw new Error(byId.error.message);

  const orgId = safeStr(byId.data?.active_organisation_id).trim();
  return isUuid(orgId) ? orgId : null;
}

async function persistProfileActiveOrg(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  orgId: string
) {
  const first = await supabase
    .from("profiles")
    .update({ active_organisation_id: orgId })
    .eq("user_id", userId);

  if (!first.error) return;

  const msg = String(first.error?.message ?? "").toLowerCase();
  const looksLikeSchemaMismatch =
    msg.includes("column") ||
    msg.includes("user_id") ||
    msg.includes("schema") ||
    msg.includes("does not exist");

  if (!looksLikeSchemaMismatch) {
    throw new Error(first.error.message);
  }

  const second = await supabase
    .from("profiles")
    .update({ active_organisation_id: orgId })
    .eq("id", userId);

  if (second.error) throw new Error(second.error.message);
}

export async function getActiveOrgId(): Promise<string | null> {
  const cookieStore = await cookies();
  const cookieOrgId = safeStr(cookieStore.get(COOKIE_NAME)?.value).trim() || null;

  const { supabase, user } = await getUserFromSupabase();

  // 1) Canonical source: profile active org
  const profileOrgId = await getProfileActiveOrgId(supabase, user.id);

  if (profileOrgId) {
    const valid = await userHasMembership(supabase, user.id, profileOrgId);
    if (valid) {
      if (cookieOrgId !== profileOrgId) {
        await setActiveOrgCookie(profileOrgId);
      }
      return profileOrgId;
    }
  }

  // 2) Cookie fallback only if profile is empty/invalid
  if (cookieOrgId) {
    const valid = await userHasMembership(supabase, user.id, cookieOrgId);
    if (valid) {
      await persistProfileActiveOrg(supabase, user.id, cookieOrgId);
      await setActiveOrgCookie(cookieOrgId);
      return cookieOrgId;
    }
    await clearActiveOrgCookie();
  }

  // 3) Single-membership auto-bind fallback
  const { data: memberships, error: memErr } = await supabase
    .from("organisation_members")
    .select("organisation_id")
    .eq("user_id", user.id)
    .is("removed_at", null);

  if (memErr) throw new Error(memErr.message);

  const uniqueOrgIds = Array.from(
    new Set((memberships ?? []).map((m) => m.organisation_id).filter(Boolean))
  ).filter((x): x is string => isUuid(String(x)));

  if (uniqueOrgIds.length === 1) {
    const orgId = uniqueOrgIds[0];
    await persistProfileActiveOrg(supabase, user.id, orgId);
    await setActiveOrgCookie(orgId);
    return orgId;
  }

  // 4) No org or multi-org without explicit selection
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

  const role = String(membership?.role || "").toLowerCase();
  if (role !== "admin" && role !== "owner") {
    throw new Error("Admin or owner role required for this action.");
  }

  return { orgId, userId, role: role as "admin" | "owner", supabase };
}