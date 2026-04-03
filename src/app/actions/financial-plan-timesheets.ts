"use server";

// src/app/actions/financial-plan-timesheets.ts
// Fetches approved timesheet hours for a project from weekly_timesheet_entries.
// No resource matching required — anyone who logs approved time against a project
// contributes to that project's People actuals.

import { createClient } from "@/utils/supabase/server";
import type { TimesheetEntry } from "@/components/artifacts/computeActuals";
import type { FetchTimesheetResult } from "./financial-plan-timesheets.shared";

const HOURS_PER_DAY = 8;

// Main function called by the financial plan artifact page.
// Returns TimesheetEntry[] shaped for computeActuals().
// Uses a synthetic resource_id "__weekly__{costLineId}" so computeActuals
// can map hours to the correct people cost line without needing heatmap resources.
export async function getApprovedTimesheetEntries(
  projectId: string,
  resourceIds: string[]  // kept for API compatibility but no longer required
): Promise<FetchTimesheetResult> {
  if (!projectId) return { ok: true, entries: [] };

  const supabase = await createClient();

  // --- 1. Legacy: resource-plan-linked entries (timesheet_entries table) ---
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

  // --- 2. New: weekly timesheet entries (weekly_timesheet_entries table) ---
  // Join weekly_timesheet_entries -> timesheets to get only approved timesheets
  // for this project, then group by month and sum hours -> days.
  const { data: weeklyRaw, error } = await supabase
    .from("weekly_timesheet_entries")
    .select(`
      work_date,
      hours,
      timesheets!inner(status, organisation_id)
    `)
    .eq("project_id", projectId)
    .gt("hours", 0);

  if (error) return { ok: false, error: error.message };

  // Group by month_key, only count approved timesheets
  const monthMap = new Map<string, number>(); // month_key -> total_days
  for (const row of weeklyRaw ?? []) {
    const ts = (row as any).timesheets;
    if (!ts || ts.status !== "approved") continue;
    const mk   = String(row.work_date).slice(0, 7); // YYYY-MM
    const days = Number(row.hours) / HOURS_PER_DAY;
    monthMap.set(mk, (monthMap.get(mk) ?? 0) + days);
  }

  // Use synthetic resource_id "__weekly__" — computeActuals will handle this
  const weeklyEntries: TimesheetEntry[] = [...monthMap.entries()].map(([mk, days]) => ({
    resource_id:   "__weekly__",
    month_key:     mk,
    approved_days: Math.round(days * 100) / 100,
  }));

  // Merge: if same month has both legacy and weekly, keep both (they're additive)
  const allEntries = [...legacyEntries, ...weeklyEntries];

  return { ok: true, entries: allEntries };
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
