// src/app/actions/financial-plan-timesheets.ts
// Fetches approved timesheet entries for all resources in a financial plan.
// Returns TimesheetEntry[] shaped for computeActuals().
//
// DB schema assumed:
//   timesheet_entries (
//     id            uuid pk
//     resource_id   text        -- matches Resource.id in the plan JSON
//     project_id    uuid        -- FK → projects.id
//     month_key     text        -- YYYY-MM
//     approved_days numeric
//     status        text        -- 'draft' | 'submitted' | 'approved' | 'rejected'
//     submitted_at  timestamptz
//     approved_at   timestamptz
//     approved_by   uuid        -- FK → auth.users.id
//   )
//
// Only rows with status = 'approved' are returned.

"use server";

import { createClient } from "@/utils/supabase/server";
import type { TimesheetEntry } from "@/components/artifacts/computeActuals";

export type FetchTimesheetResult =
  | { ok: true;  entries: TimesheetEntry[] }
  | { ok: false; error: string };

/**
 * getApprovedTimesheetEntries
 *
 * Fetches all approved timesheet entries for a given project.
 * Pass the full resource list so we can filter to resource_ids that belong
 * to this plan (avoids cross-plan leakage if resource IDs are reused).
 *
 * @param projectId   - The project UUID.
 * @param resourceIds - Array of Resource.id values from the plan JSON.
 */
export async function getApprovedTimesheetEntries(
  projectId: string,
  resourceIds: string[],
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

  if (error) {
    return { ok: false, error: error.message };
  }

  const entries: TimesheetEntry[] = (data ?? []).map(row => ({
    resource_id:   String(row.resource_id),
    month_key:     String(row.month_key),
    approved_days: Number(row.approved_days),
  }));

  return { ok: true, entries };
}

/**
 * submitTimesheetEntry
 *
 * Creates or updates a draft timesheet entry for a resource + month.
 * PM approval is handled separately (approveTimesheetEntry).
 */
export async function submitTimesheetEntry({
  projectId,
  resourceId,
  monthKey,
  days,
}: {
  projectId:  string;
  resourceId: string;
  monthKey:   string;
  days:       number;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("timesheet_entries")
    .upsert(
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

/**
 * approveTimesheetEntry
 *
 * Approves a submitted timesheet entry. Only PMs / owners should call this.
 * After approval the entry will be picked up by getApprovedTimesheetEntries
 * and flow into the actuals computation.
 */
export async function approveTimesheetEntry({
  projectId,
  resourceId,
  monthKey,
}: {
  projectId:  string;
  resourceId: string;
  monthKey:   string;
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
    .eq("project_id",  projectId)
    .eq("resource_id", resourceId)
    .eq("month_key",   monthKey)
    .eq("status",      "submitted"); // safety: only approve if currently submitted

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}