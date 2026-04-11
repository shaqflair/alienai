// src/app/(app)/executive/page.tsx
import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import ExecutiveCockpitClient from "@/components/executive/ExecutiveCockpitClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function getExecutivePageProps() {
  const supabase = await createClient();

  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) redirect("/login");

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

  if (!orgId) return { orgId: null, memberProjectIds: [], isAdmin: false };

  const { data: orgMember } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", orgId)
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle();

  const orgRole = (orgMember?.role ?? "").toLowerCase();
  const isAdmin = orgRole === "owner" || orgRole === "admin";

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
