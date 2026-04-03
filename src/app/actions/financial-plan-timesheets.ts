"use server";

import { createClient } from "@/utils/supabase/server";
import type { TimesheetEntry } from "@/components/artifacts/computeActuals";
import type { FetchTimesheetResult } from "./financial-plan-timesheets.shared";

const HOURS_PER_DAY = 8;

export async function getApprovedTimesheetEntries(
  projectId: string,
  resourceIds: string[]
): Promise<FetchTimesheetResult> {
  if (!projectId) return { ok: true, entries: [] };

  const supabase = await createClient();

  // --- 1. Legacy resource-plan entries (timesheet_entries table) ---
  const legacyEntries: TimesheetEntry[] = [];
  if (resourceIds.length > 0) {
    const { data: legacy } = await supabase
      .from("timesheet_entries")
      .select("resource_id, month_key, approved_days")
      .eq("project_id", projectId)
      .eq("status", "approved")
      .in("resource_id", resourceIds)
      .gt("approved_days", 0)
      .order("month_key", { ascending: true });

    for (const row of legacy ?? []) {
      legacyEntries.push({
        resource_id:   String(row.resource_id),
        month_key:     String(row.month_key),
        approved_days: Number(row.approved_days),
      });
    }
  }

  // --- 2. Weekly timesheet entries — two separate queries to avoid join issues ---
  // Step 1: get all weekly entries for this project
  const { data: weeklyRaw, error } = await supabase
    .from("weekly_timesheet_entries")
    .select("timesheet_id, work_date, hours")
    .eq("project_id", projectId)
    .gt("hours", 0);

  if (error) return { ok: false, error: error.message };

  // Step 2: find which of those timesheets are approved
  const timesheetIds = [...new Set((weeklyRaw ?? []).map((r: any) => String(r.timesheet_id)))];
  const approvedIds = new Set<string>();

  if (timesheetIds.length > 0) {
    const { data: approvedTs } = await supabase
      .from("timesheets")
      .select("id")
      .in("id", timesheetIds)
      .eq("status", "approved");
    (approvedTs ?? []).forEach((t: any) => approvedIds.add(String(t.id)));
  }

  // Step 3: group by month, sum hours → days, only approved timesheets
  const monthMap = new Map<string, number>();
  for (const row of weeklyRaw ?? []) {
    if (!approvedIds.has(String(row.timesheet_id))) continue;
    const mk   = String(row.work_date).slice(0, 7); // YYYY-MM
    const days = Number(row.hours) / HOURS_PER_DAY;
    monthMap.set(mk, (monthMap.get(mk) ?? 0) + days);
  }

  const weeklyEntries: TimesheetEntry[] = [...monthMap.entries()].map(([mk, days]) => ({
    resource_id:   "__weekly__",
    month_key:     mk,
    approved_days: Math.round(days * 100) / 100,
  }));

  return { ok: true, entries: [...legacyEntries, ...weeklyEntries] };
}

export async function submitTimesheetEntry({
  projectId,
  resourceId,
  monthKey,
  days,
}: {
  projectId: string;
  resourceId: string;
  monthKey: string;
  days: number;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase.from("timesheet_entries").upsert(
    {
      project_id:    projectId,
      resource_id:   resourceId,
      month_key:     monthKey,
      approved_days: days,
      status:        "submitted",
      submitted_at:  new Date().toISOString(),
      submitted_by:  user.id,
    },
    { onConflict: "project_id,resource_id,month_key" }
  );

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function approveTimesheetEntry({
  projectId,
  resourceId,
  monthKey,
}: {
  projectId: string;
  resourceId: string;
  monthKey: string;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("timesheet_entries")
    .update({
      status:      "approved",
      approved_at: new Date().toISOString(),
      approved_by: user.id,
    })
    .eq("project_id", projectId)
    .eq("resource_id", resourceId)
    .eq("month_key", monthKey)
    .eq("status", "submitted");

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}