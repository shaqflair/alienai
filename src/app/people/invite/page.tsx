// FILE: src/app/people/invite/page.tsx
import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import InviteClient, { type OrgInvite } from "./_components/InviteClient";

export const metadata = { title: "Invite people | Aliena" };
export const dynamic  = "force-dynamic";

export default async function InvitePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/people/invite");

  const orgId = await getActiveOrgId().catch(() => null);
  if (!orgId) redirect("/projects?err=missing_org");

  const organisationId = String(orgId);

  const { data: mem } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle();

  if (!mem || String(mem.role).toLowerCase() !== "admin") {
    redirect("/people?err=not_admin");
  }

  const { data: invites } = await supabase
    .from("organisation_invites")
    .select("id, email, role, status, created_at, accepted_at, expires_at")
    .eq("organisation_id", organisationId)
    .order("created_at", { ascending: false });

  return (
    <InviteClient
      organisationId={organisationId}
      initialInvites={(invites ?? []) as OrgInvite[]}
    />
  );
}