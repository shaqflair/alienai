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

  // Source 2: weekly_timesheet_entries joined to timesheets
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

  const userIds = [...new Set(weeklyData.map((r: any) => r.timesheets?.user_id).filter(Boolean))];
  const orgId   = (weeklyData[0] as any).timesheets?.organisation_id ?? null;

  const rateByUser: Record<string, number> = {};

  if (userIds.length > 0 && orgId) {
    // Get job_title from profiles (primary source of truth)
    const { data: profileData } = await supabase
      .from("profiles")
      .select("user_id, job_title")
      .in("user_id", userIds);

    // Fallback: organisation_members
    const { data: memberData } = await supabase
      .from("organisation_members")
      .select("user_id, job_title")
      .eq("organisation_id", orgId)
      .in("user_id", userIds);

    const jobTitleByUser: Record<string, string> = {};
    for (const m of memberData ?? []) {
      if (m.user_id && m.job_title) jobTitleByUser[m.user_id] = m.job_title;
    }
    for (const p of profileData ?? []) {
      if (p.user_id && p.job_title) jobTitleByUser[p.user_id] = p.job_title;
    }

    // Get all rates for this org
    const { data: rateData } = await supabase
      .from("resource_rates")
      .select("user_id, role_label, rate, rate_type")
      .eq("organisation_id", orgId)
      .order("effective_from", { ascending: false });

    const ratesByUserId:    Record<string, number> = {};
    const ratesByRoleLabel: Record<string, number> = {};

    for (const r of rateData ?? []) {
      const dayRate = r.rate_type === "monthly_cost" ? Number(r.rate) / 20 : Number(r.rate);
      if (r.user_id && !ratesByUserId[r.user_id])           ratesByUserId[r.user_id]                   = dayRate;
      if (r.role_label && !ratesByRoleLabel[r.role_label.toLowerCase()]) ratesByRoleLabel[r.role_label.toLowerCase()] = dayRate;
    }

    for (const userId of userIds) {
      if (ratesByUserId[userId]) {
        rateByUser[userId] = ratesByUserId[userId];
      } else {
        const jt = jobTitleByUser[userId];
        if (jt && ratesByRoleLabel[jt.toLowerCase()]) {
          rateByUser[userId] = ratesByRoleLabel[jt.toLowerCase()];
        } else {
          console.warn("[financial-plan-timesheets] no rate for user:", userId, "job_title:", jt ?? "unknown");
        }
      }
    }
  }

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
    if (dayRate === 0) continue;
    byMonth[monthKey] = (byMonth[monthKey] ?? 0) + (days * dayRate);
  }

  for (const [month_key, totalCost] of Object.entries(byMonth)) {
    if (totalCost > 0) {
      entries.push({ resource_id: "__weekly__", month_key, approved_days: Math.round(totalCost * 100) / 100 });
    }
  }

  return { ok: true, entries };
}
