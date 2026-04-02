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

  const { data: weeklyData, error: weeklyErr } = await supabase
    .from("weekly_timesheet_entries")
    .select(`
      id,
      total_hours,
      week_start,
      weekly_timesheets!inner (
        project_id,
        status,
        week_start
      )
    `)
    .eq("weekly_timesheets.project_id", projectId)
    .eq("weekly_timesheets.status", "approved")
    .gt("total_hours", 0);

  if (weeklyErr) {
    console.warn("[financial-plan-timesheets] weekly fetch error:", weeklyErr.message);
  } else {
    const byMonth: Record<string, number> = {};
    for (const row of weeklyData ?? []) {
      const weekStart: string =
        (row as any).week_start ??
        (row as any).weekly_timesheets?.week_start;
      if (!weekStart) continue;
      const d = new Date(weekStart);
      if (isNaN(d.getTime())) continue;
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const days = (Number((row as any).total_hours) || 0) / 8;
      byMonth[monthKey] = (byMonth[monthKey] ?? 0) + days;
    }
    for (const [month_key, approved_days] of Object.entries(byMonth)) {
      if (approved_days > 0) {
        entries.push({ resource_id: "__weekly__", month_key, approved_days: Math.round(approved_days * 100) / 100 });
      }
    }
  }

  return { ok: true, entries };
}
