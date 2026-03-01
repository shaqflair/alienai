import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { fetchHeatmapData } from "@/app/heatmap/_lib/heatmap-query";
import type { HeatmapFilters, Granularity } from "@/app/heatmap/_lib/heatmap-query";
import { getActiveOrgId } from "@/utils/org/active-org";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const sp = req.nextUrl.searchParams;

  const orgId = await getActiveOrgId().catch(() => null);
  const organisationId = orgId ? String(orgId) : null;
  if (!organisationId) {
    return NextResponse.json({ error: "No active organisation" }, { status: 400 });
  }

  const granularity  = (sp.get("granularity") ?? "weekly") as Granularity;
  const dateFrom      = sp.get("dateFrom")     ?? new Date().toISOString().split("T")[0];
  const dateTo       = sp.get("dateTo")       ?? "";
  const departments  = sp.getAll("dept");
  const statuses     = sp.getAll("status");
  const personIds    = sp.getAll("person");

  // Default dateTo = 6 months from dateFrom
  const resolvedDateTo = dateTo || (() => {
    const d = new Date(dateFrom);
    d.setMonth(d.getMonth() + 6);
    return d.toISOString().split("T")[0];
  })();

  const filters: HeatmapFilters = {
    granularity,
    dateFrom,
    dateTo:        resolvedDateTo,
    departments,
    statuses,
    personIds,
    organisationId,
  };

  try {
    const data = await fetchHeatmapData(filters);
    return NextResponse.json(data, {
      headers: {
        // Cache for 30 seconds — stale-while-revalidate for snappy feel
        "Cache-Control": "private, max-age=30, stale-while-revalidate=60",
      },
    });
  } catch (err: any) {
    console.error("[heatmap/data]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
