"use server";
import { createClient } from "@/utils/supabase/server";
import type { TimesheetEntry } from "@/components/artifacts/computeActuals";
import type { FetchTimesheetResult } from "./financial-plan-timesheets.shared";

export async function getApprovedTimesheetEntries(
  projectId: string,
  resourceIds: string[]
): Promise<FetchTimesheetResult> {
  if (!projectId) return { ok: true, entries: [] };

  const supabase = await createClient();
  const entries: TimesheetEntry[] = [];

  // Source 1: legacy timesheet_entries (resource-plan linked)
  if (resourceIds.length > 0) {
    const { data: legacyData, error: legacyErr } = await supabase
      .from("timesheet_entries")
      .select("resource_id, month_key, approved_days")
      .eq("project_id", projectId)
      .eq("status", "approved")
      .in("resource_id", resourceIds)
      .gt("approved_days", 0)
      .order("month_key", { ascending: true });
    if (legacyErr) return { ok: false, error: legacyErr.message };
    for (const row of legacyData ?? []) {
      entries.push({
        resource_id:   String(row.resource_id),
        month_key:     String(row.month_key),
        approved_days: Number(row.approved_days),
      });
    }
  }

  // Source 2: weekly_timesheet_entries
  // Join to timesheets to get user_id + filter approved
  // Then look up rate from resource_rates per user
  const { data: weeklyData, error: weeklyErr } = await supabase
    .from("weekly_timesheet_entries")
    .select("work_date, hours, timesheets!inner(user_id, status, organisation_id)")
    .eq("project_id", projectId)
    .eq("timesheets.status", "approved")
    .gt("hours", 0);

  if (weeklyErr) {
    console.warn("[financial-plan-timesheets] weekly fetch error:", weeklyErr.message);
    return { ok: true, entries };
  }

  if (!weeklyData || weeklyData.length === 0) return { ok: true, entries };

  // Collect unique user_ids and org_id
  const userIds = [...new Set(weeklyData.map((r: any) => r.timesheets?.user_id).filter(Boolean))];
  const orgId   = (weeklyData[0] as any).timesheets?.organisation_id ?? null;

  // Look up rates for these users
  const rateByUser: Record<string, number> = {};
  if (userIds.length > 0 && orgId) {
    const { data: rateData } = await supabase
      .from("resource_rates")
      .select("user_id, rate, rate_type")
      .eq("organisation_id", orgId)
      .in("user_id", userIds)
      .order("effective_from", { ascending: false });

    // Take the most recent rate per user (first row wins due to order)
    for (const r of rateData ?? []) {
      if (!rateByUser[r.user_id]) {
        // Normalise to day rate
        const dayRate = r.rate_type === "monthly_cost"
          ? Number(r.rate) / 20
          : Number(r.rate);
        rateByUser[r.user_id] = dayRate;
      }
    }
  }

  // Aggregate cost by month per user
  const byMonth: Record<string, number> = {};
  for (const row of weeklyData) {
    const workDate = String((row as any).work_date ?? "");
    if (!workDate) continue;
    const d = new Date(workDate);
    if (isNaN(d.getTime())) continue;
    const monthKey = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    const days     = (Number((row as any).hours) || 0) / 8;
    const userId   = (row as any).timesheets?.user_id;
    const dayRate  = userId ? (rateByUser[userId] ?? 0) : 0;
    const cost     = days * dayRate;
    byMonth[monthKey] = (byMonth[monthKey] ?? 0) + cost;
  }

  for (const [month_key, totalCost] of Object.entries(byMonth)) {
    if (totalCost > 0) {
      // approved_days carries pre-multiplied cost — computeActuals multiplies by dayRate=1
      entries.push({ resource_id: "__weekly__", month_key, approved_days: Math.round(totalCost * 100) / 100 });
    }
  }

  return { ok: true, entries };
}
