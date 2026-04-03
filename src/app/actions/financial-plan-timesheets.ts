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

  // --- 2. Weekly timesheet entries — two separate queries ---
  // Step 1: get all weekly entries for this project
  const { data: weeklyRaw, error } = await supabase
    .from("weekly_timesheet_entries")
    .select("timesheet_id, work_date, hours")
    .eq("project_id", projectId)
    .gt("hours", 0);

  if (error) return { ok: false, error: error.message };

  const timesheetIds = [...new Set((weeklyRaw ?? []).map((r: any) => String(r.timesheet_id)))];
  if (timesheetIds.length === 0) return { ok: true, entries: legacyEntries };

  // Step 2: get approved timesheets with user_id
  const { data: approvedTs } = await supabase
    .from("timesheets")
    .select("id, user_id")
    .in("id", timesheetIds)
    .eq("status", "approved");

  if (!approvedTs || approvedTs.length === 0) return { ok: true, entries: legacyEntries };

  const approvedMap = new Map<string, string>(); // timesheet_id → user_id
  for (const t of approvedTs) approvedMap.set(String(t.id), String(t.user_id));

  // Step 3: get org_id for this project (to look up rate cards)
  const { data: projRow } = await supabase
    .from("projects")
    .select("organisation_id")
    .eq("id", projectId)
    .maybeSingle();

  const orgId = projRow?.organisation_id ? String(projRow.organisation_id) : null;

  // Step 4: get job titles for all users from organisation_members
  const userIds = [...new Set(approvedTs.map((t: any) => String(t.user_id)))];
  const jobTitleByUser = new Map<string, string>();

  if (orgId && userIds.length > 0) {
    const { data: members } = await supabase
      .from("organisation_members")
      .select("user_id, job_title, role")
      .eq("organisation_id", orgId)
      .in("user_id", userIds);

    for (const m of members ?? []) {
      const title = String(m.job_title || m.role || "").trim();
      if (title) jobTitleByUser.set(String(m.user_id), title);
    }
  }

  // Step 5: get rate cards for org — match by label (job title)
  const rateByLabel = new Map<string, number>(); // lowercase label → rate_per_day

  if (orgId) {
    const { data: rates } = await supabase
      .from("resource_rates")
      .select("role_label, rate")
      .eq("organisation_id", orgId)
      .eq("rate_type", "day_rate");

    for (const r of rates ?? []) {
      if (r.role_label && r.rate) {
        rateByLabel.set(String(r.role_label).toLowerCase().trim(), Number(r.rate));
      }
    }
  }

  // Helper: get day rate for a user
  function getDayRate(userId: string): number {
    const jobTitle = jobTitleByUser.get(userId);
    if (jobTitle) {
      const rate = rateByLabel.get(jobTitle.toLowerCase().trim());
      if (rate) return rate;
    }
    return 0; // unknown rate — will show as £0, better than wrong number
  }

  // Step 6: group by user+month, compute £ cost = days × rate
  // Store cost as approved_days with dayRate=1 in computeActuals
  type MonthUserKey = string;
  const costMap = new Map<MonthUserKey, { cost: number; days: number; userId: string }>();

  for (const row of weeklyRaw ?? []) {
    const tsId = String(row.timesheet_id);
    const userId = approvedMap.get(tsId);
    if (!userId) continue; // not approved

    const mk = String(row.work_date).slice(0, 7); // YYYY-MM
    const days = Number(row.hours) / HOURS_PER_DAY;
    const rate = getDayRate(userId);
    const cost = days * rate;

    const key = `${mk}__${userId}`;
    const existing = costMap.get(key) ?? { cost: 0, days: 0, userId };
    costMap.set(key, { cost: existing.cost + cost, days: existing.days + days, userId });
  }

  // Step 7: build entries — approved_days holds £ cost, computeActuals uses dayRate=1
  const weeklyEntries: TimesheetEntry[] = [];
  for (const [key, { cost, days }] of costMap.entries()) {
    const mk = key.split("__")[0];
    weeklyEntries.push({
      resource_id:   "__weekly__",
      month_key:     mk,
      approved_days: Math.round(cost * 100) / 100, // £ cost stored here
    });
  }

  // Also store total approved days separately for display
  // Merge by month_key
  const mergedByMonth = new Map<string, number>();
  for (const e of weeklyEntries) {
    mergedByMonth.set(e.month_key, (mergedByMonth.get(e.month_key) ?? 0) + e.approved_days);
  }

  const finalWeeklyEntries: TimesheetEntry[] = [...mergedByMonth.entries()].map(([mk, cost]) => ({
    resource_id:   "__weekly__",
    month_key:     mk,
    approved_days: Math.round(cost * 100) / 100,
  }));

  return { ok: true, entries: [...legacyEntries, ...finalWeeklyEntries] };
}

export async function submitTimesheetEntry({
  projectId, resourceId, monthKey, days,
}: { projectId: string; resourceId: string; monthKey: string; days: number; }): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase.from("timesheet_entries").upsert(
    { project_id: projectId, resource_id: resourceId, month_key: monthKey, approved_days: days, status: "submitted", submitted_at: new Date().toISOString(), submitted_by: user.id },
    { onConflict: "project_id,resource_id,month_key" }
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function approveTimesheetEntry({
  projectId, resourceId, monthKey,
}: { projectId: string; resourceId: string; monthKey: string; }): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("timesheet_entries")
    .update({ status: "approved", approved_at: new Date().toISOString(), approved_by: user.id })
    .eq("project_id", projectId).eq("resource_id", resourceId).eq("month_key", monthKey).eq("status", "submitted");
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}