import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import { fetchTimelineData } from "./_lib/timeline-data";
import GanttClient from "./_components/GanttClient";

export const metadata = { title: "Timeline | Aliena" };
export const revalidate = 60;

export default async function TimelinePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/timeline");

  const orgId = await getActiveOrgId().catch(() => null);
  if (!orgId) redirect("/projects?err=missing_org");

  const organisationId = String(orgId);

  // Admin check
  const { data: mem } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle();

  const isAdmin = (mem?.role ?? "").toLowerCase() === "admin";

  const bundle = await fetchTimelineData(organisationId);

  return (
    <GanttClient
      bundle={bundle}
      organisationId={organisationId}
      isAdmin={isAdmin}
    />
  );
}
