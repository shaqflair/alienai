import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { fetchDashboardData } from "@/app/(dashboard)/_lib/dashboard-data";
import { getActiveOrgId } from "@/utils/org/active-org";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const orgId = await getActiveOrgId().catch(() => null);
    if (!orgId) return NextResponse.json({ error: "No active org" }, { status: 400 });

    const data = await fetchDashboardData(String(orgId));

    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=25, stale-while-revalidate=60" },
    });
  } catch (err: any) {
    console.error("[/api/dashboard]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
