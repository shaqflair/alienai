import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import SettingsLayoutClient from "./_components/SettingsLayoutClient";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  
  if (error || !user) {
    redirect("/login?next=/settings");
  }

  const orgId = await getActiveOrgId().catch(() => null);
  const organisationId = orgId ? String(orgId) : null;

  let orgName = "Your organisation";
  let myRole = "member";
  let memberCount = 0;
  let pendingInvites = 0;

  if (organisationId) {
    // Execute multiple lookups in parallel to keep the page snappy
    const [orgRes, memRes, invRes, countRes] = await Promise.all([
      supabase.from("organisations").select("name").eq("id", organisationId).maybeSingle(),
      supabase.from("organisation_members").select("role").eq("organisation_id", organisationId).eq("user_id", user.id).is("removed_at", null).maybeSingle(),
      supabase.from("organisation_invites").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId).eq("status", "pending"),
      supabase.from("organisation_members").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId).is("removed_at", null)
    ]);

    orgName = String(orgRes.data?.name || "Your organisation");
    myRole = String(memRes.data?.role || "member").toLowerCase();
    memberCount = countRes.count ?? 0;
    pendingInvites = invRes.count ?? 0;
  }

  const isAdmin = myRole === "admin" || myRole === "owner";

  return (
    <SettingsLayoutClient
      orgName={orgName}
      myRole={myRole}
      isAdmin={isAdmin}
      memberCount={memberCount}
      pendingInvites={pendingInvites}
      organisationId={organisationId}
      userEmail={user.email ?? ""}
    >
      {children}
    </SettingsLayoutClient>
  );
}
