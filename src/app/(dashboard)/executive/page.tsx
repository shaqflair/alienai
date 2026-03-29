import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import ExecutiveCockpitClient from "@/components/executive/ExecutiveCockpitClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function getExecutivePageProps() {
  const supabase = await createClient();

  // ── 1. Auth ──────────────────────────────────────────────────────────────
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) redirect("/login");

  // ── 2. Active org ─────────────────────────────────────────────────────────
  //   Try profile.active_organisation_id first, fall back to earliest membership
  let orgId: string | null = null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("active_organisation_id")
    .eq("id", user.id)
    .maybeSingle();

  orgId = profile?.active_organisation_id ?? null;

  if (!orgId) {
    const { data: mem } = await supabase
      .from("organisation_members")
      .select("organisation_id")
      .eq("user_id", user.id)
      .is("removed_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    orgId = mem?.organisation_id ?? null;
  }

  if (!orgId) {
    // User has no org — render the cockpit with empty state rather than crashing
    return { orgId: null, memberProjectIds: [], isAdmin: false };
  }

  // ── 3. Admin check ────────────────────────────────────────────────────────
  //   "admin" = org-level role of owner/admin, OR project owner on ≥1 project
  const { data: orgMember } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", orgId)
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle();

  const orgRole = (orgMember?.role ?? "").toLowerCase();
  const isAdmin = orgRole === "owner" || orgRole === "admin";

  // ── 4. Member project IDs ─────────────────────────────────────────────────
  //   All projects in this org the user is a member of (non-removed)
  //   Used by the drawer to gate "Open" links
  const { data: projectMemberships } = await supabase
    .from("project_members")
    .select("project_id, projects!inner(organisation_id)")
    .eq("user_id", user.id)
    .is("removed_at", null)
    .eq("projects.organisation_id", orgId);

  const memberProjectIds: string[] = (projectMemberships ?? [])
    .map((m: any) => String(m?.project_id ?? "").trim())
    .filter(Boolean);

  return { orgId, memberProjectIds, isAdmin };
}

export default async function ExecutivePage() {
  const { orgId, memberProjectIds, isAdmin } = await getExecutivePageProps();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <ExecutiveCockpitClient
        orgId={orgId ?? undefined}
        memberProjectIds={memberProjectIds}
        isAdmin={isAdmin}
      />
    </main>
  );
}
