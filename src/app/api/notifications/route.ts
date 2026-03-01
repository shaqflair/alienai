import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { computeAlerts } from "@/app/notifications/_lib/notifications-engine";
import { getActiveOrgId } from "@/utils/org/active-org";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const orgId = await getActiveOrgId().catch(() => null);
    if (!orgId) return NextResponse.json({ error: "No active org" }, { status: 400 });

    const alerts = await computeAlerts(String(orgId));

    return NextResponse.json(
      { alerts, generatedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=120" } }
    );
  } catch (err: any) {
    console.error("[/api/notifications]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
