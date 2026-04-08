// TEMPORARY DEBUG ROUTE
// src/app/api/portfolio/budget-phasing/debug/route.ts
// Visit /api/portfolio/budget-phasing/debug to see what's in the DB

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: rows } = await supabase
    .from("artifacts")
    .select("id, project_id, type, approval_status, is_current")
    .ilike("type", "%financial%");

  const results = [];
  for (const row of (rows ?? []) as any[]) {
    const { data: full } = await supabase
      .from("artifacts").select("content_json").eq("id", row.id).maybeSingle();
    const cj = (full as any)?.content_json;
    const monthly = cj?.monthly_data ?? cj?.monthlyData ?? {};
    const lines   = cj?.cost_lines   ?? cj?.lines         ?? [];
    const monthKeys = Object.values(monthly).flatMap((v: any) => Object.keys(v ?? {}));
    results.push({
      id: row.id, type: row.type, approval_status: row.approval_status,
      is_current: row.is_current, project_id: row.project_id,
      line_count: lines.length,
      monthly_data_key: cj?.monthly_data ? "monthly_data" : cj?.monthlyData ? "monthlyData" : "MISSING",
      month_keys_sample: [...new Set(monthKeys)].slice(0, 5),
      fy_config: cj?.fy_config ?? null,
    });
  }
const { data: weeklyData, error: weeklyErr } = await supabase
  .from("weekly_timesheet_entries")
  .select("work_date, hours, timesheets!inner(user_id, status, organisation_id)")
  .eq("project_id", projectId)
  .eq("timesheets.status", "approved")
  .gt("hours", 0);

// ADD THESE:
console.log("[debug] weeklyData sample:", JSON.stringify(weeklyData?.[0], null, 2));
console.log("[debug] userIds:", userIds);
console.log("[debug] rateByUser:", JSON.stringify(rateByUser, null, 2));
console.log("[debug] byMonth:", JSON.stringify(byMonth, null, 2));
  return NextResponse.json({ ok: true, artifacts: results });
}
