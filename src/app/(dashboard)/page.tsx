// FILE: src/app/(dashboard)/page.tsx
import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import { fetchDashboardData } from "./_lib/dashboard-data";
import DashboardClient from "./_components/DashboardClient";

export const metadata = { title: "Dashboard | ResForce" };

// ISR — keep server-rendered data fresh every 30s
export const revalidate = 30;

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/");

  const orgId = await getActiveOrgId().catch(() => null);
  if (!orgId) redirect("/projects?err=missing_org");

  const data = await fetchDashboardData(String(orgId));

  return <DashboardClient initialData={data} />;
}