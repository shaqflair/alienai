import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import {
  fetchHeatmapData,
  fetchHeatmapFilterOptions,
} from "./_lib/heatmap-query";
import HeatmapClient from "./_components/HeatmapClient";
import type { Granularity, HeatmapFilters } from "./_lib/heatmap-query";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function norm(x: unknown) {
  return safeStr(x).trim();
}

function defaultDateFrom(): string {
  const d = new Date();
  // Start from the Monday of current week
  const day  = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
}

function defaultDateTo(from: string): string {
  const d = new Date(from);
  d.setMonth(d.getMonth() + 6);
  return d.toISOString().split("T")[0];
}

export default async function HeatmapPage({
  searchParams,
}: {
  searchParams?: Promise<{
    gran?:    string;
    from?:    string;
    to?:      string;
    dept?:    string | string[];
    status?:  string | string[];
    person?:  string | string[];
  }> | {
    gran?:    string;
    from?:    string;
    to?:      string;
    dept?:    string | string[];
    status?:  string | string[];
    person?:  string | string[];
  };
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/heatmap")}`);

  const sp = (await (searchParams as any)) ?? {};

  // -- Resolve org -----------------------------------------------------------
  const orgId = await getActiveOrgId().catch(() => null);
  const organisationId = orgId ? String(orgId) : null;
  if (!organisationId) redirect("/projects?err=missing_org");

  // -- Parse search params ---------------------------------------------------
  const validGran: Granularity[] = ["weekly", "sprint", "monthly", "quarterly"];
  const rawGran = norm(sp?.gran);
  const granularity: Granularity = validGran.includes(rawGran as any)
    ? (rawGran as Granularity)
    : "weekly";

  const dateFrom = norm(sp?.from) || defaultDateFrom();
  const dateTo   = norm(sp?.to)   || defaultDateTo(dateFrom);

  function asArray(v: unknown): string[] {
    if (!v) return [];
    if (Array.isArray(v)) return v.map(String).filter(Boolean);
    const s = String(v).trim();
    return s ? [s] : [];
  }

  const departments = asArray(sp?.dept);
  const statuses    = asArray(sp?.status);
  const personIds   = asArray(sp?.person);

  const filters: HeatmapFilters = {
    granularity,
    dateFrom,
    dateTo,
    departments,
    statuses,
    personIds,
    organisationId: organisationId!,
  };

  // -- Fetch data in parallel ------------------------------------------------
  const [heatmapData, filterOptions] = await Promise.all([
    fetchHeatmapData(filters),
    fetchHeatmapFilterOptions(organisationId!),
  ]);

  return (
    <HeatmapClient
      initialData={heatmapData}
      allPeople={filterOptions.people}
      allDepartments={filterOptions.departments}
      initialFilters={{
        granularity,
        dateFrom,
        dateTo,
        departments,
        statuses,
        personIds,
      }}
    />
  );
}
