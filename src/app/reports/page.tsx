import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import { fetchReportData } from "./_lib/reports-data";
import ReportsClient from "./_components/ReportsClient";

export const metadata = { title: "Reports | ResForce" };

function defaultFrom() {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toISOString().split("T")[0];
}

function defaultTo() {
  return new Date().toISOString().split("T")[0];
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams?: Promise<{ from?: string; to?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/reports");

  const orgId = await getActiveOrgId().catch(() => null);
  if (!orgId) redirect("/projects?err=missing_org");

  const sp       = (await searchParams) ?? {};
  const dateFrom = sp?.from || defaultFrom();
  const dateTo   = sp?.to   || defaultTo();

  const data = await fetchReportData({
    organisationId: String(orgId),
    dateFrom,
    dateTo,
  });

  return (
    <ReportsClient
      initialData={data}
      initialFrom={dateFrom}
      initialTo={dateTo}
    />
  );
}
