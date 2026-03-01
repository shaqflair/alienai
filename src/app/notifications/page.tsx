import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import { computeAlerts } from "./_lib/notifications-engine";
import NotificationsClient from "./_components/NotificationsClient";

export const metadata = { title: "Notifications | ResForce" };
export const revalidate = 60;

export default async function NotificationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/notifications");

  const orgId = await getActiveOrgId().catch(() => null);
  if (!orgId) redirect("/projects?err=missing_org");

  const alerts = await computeAlerts(String(orgId));

  return (
    <NotificationsClient
      initialAlerts={alerts}
      generatedAt={new Date().toISOString()}
    />
  );
}
