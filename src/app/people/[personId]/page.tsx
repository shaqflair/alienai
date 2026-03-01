import "server-only";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import ProfileClient from "./_components/ProfileClient";

export default async function PersonProfilePage({ params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/people/${personId}`);

  const orgId = await getActiveOrgId().catch(() => null);
  const organisationId = orgId ? String(orgId) : null;
  if (!organisationId) redirect("/projects?err=missing_org");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", personId)
    .maybeSingle();

  if (!profile) notFound();

  return (
    <ProfileClient 
      profile={profile as any} 
      availabilityWeeks={[]} 
      projectHistory={[]} 
      utilisationWeeks={[]} 
    />
  );
}
