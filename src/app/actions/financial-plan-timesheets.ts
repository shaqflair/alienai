"use server";

// src/app/actions/financial-plan-timesheets.ts
// Fetches approved timesheet entries for all resources in a financial plan.
// Returns TimesheetEntry[] shaped for computeActuals().

import { createClient } from "@/utils/supabase/server";
import type { TimesheetEntry } from "@/components/artifacts/computeActuals";
import type { FetchTimesheetResult } from "./financial-plan-timesheets.shared";

export async function getApprovedTimesheetEntries(
  projectId: string,
  resourceIds: string[]
): Promise<FetchTimesheetResult> {
  if (!projectId || resourceIds.length === 0) {
    return { ok: true, entries: [] };
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("timesheet_entries")
    .select("resource_id, month_key, approved_days")
    .eq("project_id", projectId)
    .eq("status", "approved")
    .in("resource_id", resourceIds)
    .gt("approved_days", 0)
    .order("month_key", { ascending: true });

  if (error) return { ok: false, error: error.message };

  const entries: TimesheetEntry[] = (data ?? []).map((row: any) => ({
    resource_id: String(row.resource_id),
    month_key: String(row.month_key),
    approved_days: Number(row.approved_days),
  }));

  return { ok: true, entries };
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

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase.from("timesheet_entries").upsert(
    {
      project_id: projectId,
      resource_id: resourceId,
      month_key: monthKey,
      approved_days: days,
      status: "submitted",
      submitted_at: new Date().toISOString(),
      submitted_by: user.id,
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

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("timesheet_entries")
    .update({
      status: "approved",
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