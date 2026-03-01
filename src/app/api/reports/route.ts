import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { fetchReportData } from "@/app/reports/_lib/reports-data";
import { getActiveOrgId } from "@/utils/org/active-org";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const orgId = await getActiveOrgId().catch(() => null);
    if (!orgId) return NextResponse.json({ error: "No active org" }, { status: 400 });

    const sp           = req.nextUrl.searchParams;
    
    // Default to a 3-month window if dates aren't provided
    const defaultFrom = () => { 
        const d = new Date(); 
        d.setMonth(d.getMonth() - 3); 
        return d.toISOString().split("T")[0]; 
    };

    const dateFrom   = sp.get("from")  || defaultFrom();
    const dateTo     = sp.get("to")    || new Date().toISOString().split("T")[0];
    const personIds  = sp.getAll("person");
    const depts      = sp.getAll("dept");

    const data = await fetchReportData({
      organisationId: String(orgId),
      dateFrom,
      dateTo,
      personIds:   personIds.length  ? personIds  : undefined,
      departments: depts.length      ? depts      : undefined,
    });

    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=120" },
    });
  } catch (err: any) {
    console.error("[/api/reports]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
