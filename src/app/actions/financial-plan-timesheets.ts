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
  let legacyQuery = supabase
    .from("timesheet_entries")
    .select("resource_id, month_key, approved_days")
    .eq("project_id", projectId)
    .eq("status", "approved")
    .gt("approved_days", 0)
    .order("month_key", { ascending: true });

  // Only filter by resourceIds if provided
  if (resourceIds.length > 0) {
    legacyQuery = legacyQuery.in("resource_id", resourceIds);
  }

  const { data: legacy } = await legacyQuery;

  const legacyEntries: TimesheetEntry[] = (legacy ?? []).map((row) => ({
    resource_id:   String(row.resource_id),
    month_key:     String(row.month_key),
    approved_days: Number(row.approved_days),
  }));

  // --- 2. Weekly timesheet entries ---

  // Step 1: get all weekly entries for this project
  const { data: weeklyRaw, error } = await supabase
    .from("weekly_timesheet_entries")
    .select("timesheet_id, work_date, hours")
    .eq("project_id", projectId)
    .gt("hours", 0);

  if (error) return { ok: false, error: error.message };

  const timesheetIds = [
    ...new Set((weeklyRaw ?? []).map((r: any) => String(r.timesheet_id))),
  ];
  if (timesheetIds.length === 0) return { ok: true, entries: legacyEntries };

  // Step 2: get approved timesheets with user_id
  const { data: approvedTs } = await supabase
    .from("timesheets")
    .select("id, user_id")
    .in("id", timesheetIds)
    .eq("status", "approved");

  if (!approvedTs || approvedTs.length === 0)
    return { ok: true, entries: legacyEntries };

  const approvedMap = new Map<string, string>(); // timesheet_id → user_id
  for (const t of approvedTs) approvedMap.set(String(t.id), String(t.user_id));

  // Step 3: get org_id for this project
  const { data: projRow } = await supabase
    .from("projects")
    .select("organisation_id")
    .eq("id", projectId)
    .maybeSingle();

  const orgId = projRow?.organisation_id
    ? String(projRow.organisation_id)
    : null;

  if (!orgId) return { ok: true, entries: legacyEntries };

  // Step 4: get job titles for all approved users
  // Check profiles first, fall back to organisation_members job_title then role
  const userIds = [
    ...new Set(approvedTs.map((t: any) => String(t.user_id))),
  ];
  const jobTitleByUser = new Map<string, string>();

  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, job_title")
    .in("user_id", userIds);

  for (const p of profiles ?? []) {
    if (p.job_title)
      jobTitleByUser.set(String(p.user_id), String(p.job_title).trim());
  }

  // Fill gaps from organisation_members
  const missingUsers = userIds.filter((id) => !jobTitleByUser.has(id));
  if (missingUsers.length > 0) {
    const { data: members } = await supabase
      .from("organisation_members")
      .select("user_id, job_title, role")
      .eq("organisation_id", orgId)
      .in("user_id", missingUsers);

    for (const m of members ?? []) {
      const title = String(m.job_title || m.role || "").trim();
      if (title) jobTitleByUser.set(String(m.user_id), title);
    }
  }

  // Step 5: get role-based rate cards for THIS org (user_id IS NULL = role rates)
  // Logic: job_title → matches role_label on rate card → rate per day
  const rateByLabel = new Map<string, number>(); // lowercase role_label → rate_per_day

  const { data: rates } = await supabase
    .from("resource_rates")
    .select("role_label, rate, rate_type")
    .eq("organisation_id", orgId) // scoped to this org only
    .is("user_id", null)          // role-based cards only (not person-specific)
    .eq("rate_type", "day_rate"); // day rates only

  for (const r of rates ?? []) {
    if (r.role_label && r.rate) {
      rateByLabel.set(
        String(r.role_label).toLowerCase().trim(),
        Number(r.rate)
      );
    }
  }

  // Helper: user → job_title → rate card match → day rate
  function getDayRate(userId: string): number {
    const jobTitle = jobTitleByUser.get(userId);
    if (!jobTitle) {
      console.warn(
        `[timesheets] No job title found for user ${userId} — cost will be £0`
      );
      return 0;
    }
    const rate = rateByLabel.get(jobTitle.toLowerCase().trim());
    if (!rate) {
      console.warn(
        `[timesheets] No rate card match for job title "${jobTitle}" (user ${userId}) — cost will be £0`
      );
      return 0;
    }
    return rate;
  }

  // Step 6: group weekly entries by user+month
  // approved days × day rate = £ cost
  const costMap = new Map<string, { cost: number; days: number }>();

  for (const row of weeklyRaw ?? []) {
    const tsId = String(row.timesheet_id);
    const userId = approvedMap.get(tsId);
    if (!userId) continue; // not approved, skip

    const mk = String(row.work_date).slice(0, 7); // YYYY-MM
    const days = Number(row.hours) / HOURS_PER_DAY;
    const dayRate = getDayRate(userId);
    const cost = days * dayRate;

    const key = `${mk}__${userId}`;
    const prev = costMap.get(key) ?? { cost: 0, days: 0 };
    costMap.set(key, {
      cost: prev.cost + cost,
      days: prev.days + days,
    });
  }

  // Step 7: collapse to one entry per month, summing across users
  // approved_days stores £ cost (computeActuals uses dayRate=1)
  const mergedByMonth = new Map<string, number>();
  const weeklyMonths = new Set<string>();

  for (const [key, { cost }] of costMap.entries()) {
    const mk = key.split("__")[0];
    weeklyMonths.add(mk);
    mergedByMonth.set(mk, (mergedByMonth.get(mk) ?? 0) + cost);
  }

  const finalWeeklyEntries: TimesheetEntry[] = [
    ...mergedByMonth.entries(),
  ].map(([mk, cost]) => ({
    resource_id:   "__weekly__",
    month_key:     mk,
    approved_days: Math.round(cost * 100) / 100,
  }));

  // Step 8: exclude legacy entries for months already covered by weekly timesheets
  // to avoid double-counting the same period
  const dedupedLegacy = legacyEntries.filter(
    (e) => !weeklyMonths.has(e.month_key)
  );

  return {
    ok: true,
    entries: [...dedupedLegacy, ...finalWeeklyEntries],
  };
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
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
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