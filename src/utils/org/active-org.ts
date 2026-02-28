import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";

const COOKIE_NAME = "active_org_id";

export async function getActiveOrgId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value ?? null;
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
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
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
  if (!membership) throw new Error(`User is not a member of organisation ${orgId}.`);

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
