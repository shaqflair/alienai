"use server";
// FILE: src/app/timesheet/actions.ts

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";

function safeStr(x: unknown): string { return typeof x === "string" ? x : ""; }
function safeNum(x: unknown): number { const n = Number(x); return isNaN(n) ? 0 : n; }
function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test((x||"").trim());
}

function toMonday(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function weekIsWithinCutoff(weekStart: string, cutoffWeeks: number): boolean {
  const week   = new Date(weekStart).getTime();
  const cutoff = Date.now() - cutoffWeeks * 7 * 24 * 60 * 60 * 1000;
  return week >= cutoff;
}

async function getOrgCutoffWeeks(sb: any, organisationId: string): Promise<number> {
  const { data } = await sb
    .from("organisations")
    .select("timesheet_cutoff_weeks")
    .eq("id", organisationId)
    .maybeSingle();
  return data?.timesheet_cutoff_weeks ?? 4;
}

async function requireAdminOrLineManager(
  sb: any,
  organisationId: string,
  reviewerId: string,
  timesheetUserId: string
) {
  const { data: mem } = await sb
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", reviewerId)
    .is("removed_at", null)
    .maybeSingle();

  const role = safeStr(mem?.role).toLowerCase();
  if (role === "admin" || role === "owner") return "admin";

  const { data: profile } = await sb
    .from("profiles")
    .select("line_manager_id")
    .eq("user_id", timesheetUserId)
    .maybeSingle();

  if (profile?.line_manager_id === reviewerId) return "line_manager";
  throw new Error("You don't have permission to review this timesheet");
}

/* =============================================================================
   GET OR CREATE TIMESHEET
============================================================================= */
export async function getOrCreateTimesheetAction(formData: FormData) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const orgId = await getActiveOrgId().catch(() => null);
  if (!orgId) throw new Error("No active organisation");
  const organisationId = String(orgId);

  const weekRaw   = safeStr(formData.get("week_start_date")).trim();
  const weekStart = toMonday(weekRaw || new Date().toISOString().slice(0, 10));

  const cutoffWeeks = await getOrgCutoffWeeks(sb, organisationId);
  if (!weekIsWithinCutoff(weekStart, cutoffWeeks)) {
    throw new Error(`This week is beyond the ${cutoffWeeks}-week window and is locked.`);
  }

  const { data: existing } = await sb
    .from("timesheets")
    .select("id, status")
    .eq("organisation_id", organisationId)
    .eq("user_id", user.id)
    .eq("week_start_date", weekStart)
    .maybeSingle();

  if (existing) return { timesheetId: existing.id, status: existing.status, weekStart };

  const { data, error } = await sb
    .from("timesheets")
    .insert({
      organisation_id: organisationId,
      user_id:         user.id,
      week_start_date: weekStart,
      status:          "draft",
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return { timesheetId: data.id, status: "draft", weekStart };
}

/* =============================================================================
   SAVE TIMESHEET ENTRIES — supports project rows AND non-project category rows
============================================================================= */
export async function saveTimesheetEntriesAction(formData: FormData) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const timesheetId = safeStr(formData.get("timesheet_id")).trim();
  if (!isUuid(timesheetId)) throw new Error("Invalid timesheet_id");

  const { data: ts } = await sb
    .from("timesheets")
    .select("id, status, user_id, organisation_id, week_start_date")
    .eq("id", timesheetId)
    .maybeSingle();

  if (!ts || ts.user_id !== user.id) throw new Error("Timesheet not found");
  if (ts.status !== "draft") throw new Error("Can only edit draft timesheets");

  const cutoffWeeks = await getOrgCutoffWeeks(sb, String(ts.organisation_id));
  if (!weekIsWithinCutoff(safeStr(ts.week_start_date), cutoffWeeks)) {
    throw new Error("This timesheet is locked — beyond the submission window");
  }

  const VALID_CATEGORIES = new Set([
    "annual_leave", "public_holiday", "sick_leave", "training", "other_admin",
  ]);

  const entries: Array<{
    timesheet_id:         string;
    project_id:           string | null;
    non_project_category: string | null;
    work_date:            string;
    hours:                number;
    description:          string | null;
  }> = [];

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("entry_")) continue;
    const withoutPrefix = key.slice(6);
    const workDate      = withoutPrefix.slice(-10);
    const rowKey        = withoutPrefix.slice(0, withoutPrefix.length - 11);

    if (!workDate.match(/^\d{4}-\d{2}-\d{2}$/)) continue;
    const hours = Math.max(0, Math.min(24, safeNum(value)));

    let projectId: string | null = null;
    let category: string | null  = null;

    if (isUuid(rowKey))            { projectId = rowKey; }
    else if (VALID_CATEGORIES.has(rowKey)) { category  = rowKey; }
    else continue;

    entries.push({
      timesheet_id:         timesheetId,
      project_id:           projectId,
      non_project_category: category,
      work_date:            workDate,
      hours,
      description: safeStr(formData.get(`desc_${rowKey}_${workDate}`)) || null,
    });
  }

  await sb.from("weekly_timesheet_entries").delete().eq("timesheet_id", timesheetId);
  const toInsert = entries.filter(e => e.hours > 0);
  if (toInsert.length > 0) {
    const { error } = await sb.from("weekly_timesheet_entries").insert(toInsert);
    if (error) throw new Error(error.message);
  }

  revalidatePath("/timesheet");
  return { saved: toInsert.length };
}

/* =============================================================================
   SUBMIT FOR APPROVAL — routes to line manager, falls back to org admins
============================================================================= */
export async function submitTimesheetAction(formData: FormData) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const timesheetId = safeStr(formData.get("timesheet_id")).trim();
  if (!isUuid(timesheetId)) throw new Error("Invalid timesheet_id");

  const { data: ts } = await sb
    .from("timesheets")
    .select("id, status, user_id, organisation_id, week_start_date")
    .eq("id", timesheetId)
    .maybeSingle();

  if (!ts || ts.user_id !== user.id) throw new Error("Timesheet not found");
  if (ts.status !== "draft") throw new Error("Only draft timesheets can be submitted");

  const cutoffWeeks = await getOrgCutoffWeeks(sb, String(ts.organisation_id));
  if (!weekIsWithinCutoff(safeStr(ts.week_start_date), cutoffWeeks)) {
    throw new Error("This timesheet is locked — beyond the submission window");
  }

  const { data: profile } = await sb
    .from("profiles")
    .select("line_manager_id, full_name")
    .eq("user_id", user.id)
    .maybeSingle();

  const lineManagerId: string | null = profile?.line_manager_id ?? null;

  const { error } = await sb
    .from("timesheets")
    .update({
      status:              "submitted",
      submitted_at:        new Date().toISOString(),
      line_manager_id: lineManagerId ?? null,
    })
    .eq("id", timesheetId);

  if (error) throw new Error(error.message);

  // Notification — fire and forget
  try {
    const orgId        = String(ts.organisation_id);
    const submitter    = safeStr(profile?.full_name || user.email);
    const weekStr      = safeStr(ts.week_start_date);
    const notifPayload = {
      organisation_id: orgId,
      type:            "timesheet_submitted",
      title:           "Timesheet awaiting your approval",
      body:            `${submitter} submitted their timesheet for w/c ${weekStr}`,
      link:            "/timesheet/review",
      read:            false,
    };

    if (lineManagerId) {
      await sb.from("notifications").insert({ ...notifPayload, user_id: lineManagerId });
    } else {
      const { data: admins } = await sb
        .from("organisation_members")
        .select("user_id")
        .eq("organisation_id", orgId)
        .in("role", ["admin", "owner"])
        .is("removed_at", null);
      if (admins?.length) {
        await sb.from("notifications").insert(
          admins.map((a: any) => ({ ...notifPayload, user_id: a.user_id }))
        );
      }
    }
  } catch { /* silent */ }

  revalidatePath("/timesheet");
  return { submitted: true, lineManagerId };
}

/* =============================================================================
   RECALL (submitted → draft, user-initiated)
============================================================================= */
export async function recallTimesheetAction(formData: FormData) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const timesheetId = safeStr(formData.get("timesheet_id")).trim();
  if (!isUuid(timesheetId)) throw new Error("Invalid timesheet_id");

  const { data: ts } = await sb
    .from("timesheets")
    .select("id, status, user_id")
    .eq("id", timesheetId)
    .maybeSingle();

  if (!ts || ts.user_id !== user.id) throw new Error("Not your timesheet");
  if (ts.status !== "submitted") throw new Error("Only submitted timesheets can be recalled");

  const { error } = await sb
    .from("timesheets")
    .update({ status: "draft", submitted_at: null, approved_by_user_id: null })
    .eq("id", timesheetId);

  if (error) throw new Error(error.message);
  revalidatePath("/timesheet");
}

/* =============================================================================
   REWORK REJECTED TIMESHEET (rejected → draft, user-initiated)
============================================================================= */
export async function reworkTimesheetAction(formData: FormData) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const timesheetId = safeStr(formData.get("timesheet_id")).trim();
  if (!isUuid(timesheetId)) throw new Error("Invalid timesheet_id");

  const { data: ts } = await sb
    .from("timesheets")
    .select("id, status, user_id, organisation_id, week_start_date")
    .eq("id", timesheetId)
    .maybeSingle();

  if (!ts || ts.user_id !== user.id) throw new Error("Not your timesheet");
  if (ts.status !== "rejected") throw new Error("Only rejected timesheets can be reworked");

  const cutoffWeeks = await getOrgCutoffWeeks(sb, String(ts.organisation_id));
  if (!weekIsWithinCutoff(safeStr(ts.week_start_date), cutoffWeeks)) {
    throw new Error("This timesheet is outside the submission window. Ask your manager to unlock it.");
  }

  const { error } = await sb
    .from("timesheets")
    .update({
      status:        "draft",
      submitted_at:  null,
      reviewed_at:   null,
      reviewer_note: null,
      reviewed_by:   null,
    })
    .eq("id", timesheetId);

  if (error) throw new Error(error.message);
  revalidatePath("/timesheet");
  return { reworked: true };
}

/* =============================================================================
   APPROVE / REJECT — accessible to line managers AND org admins
============================================================================= */
export async function reviewTimesheetAction(formData: FormData) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const timesheetId = safeStr(formData.get("timesheet_id")).trim();
  const action      = safeStr(formData.get("action")).trim();
  const note        = safeStr(formData.get("reviewer_note")).trim() || null;

  if (!isUuid(timesheetId)) throw new Error("Invalid timesheet_id");
  if (action !== "approve" && action !== "reject") throw new Error("Invalid action");

  const { data: ts } = await sb
    .from("timesheets")
    .select("id, status, organisation_id, user_id")
    .eq("id", timesheetId)
    .maybeSingle();

  if (!ts) throw new Error("Timesheet not found");
  if (ts.status !== "submitted") throw new Error("Can only review submitted timesheets");

  await requireAdminOrLineManager(sb, String(ts.organisation_id), user.id, String(ts.user_id));

  const newStatus = action === "approve" ? "approved" : "rejected";
  const { error } = await sb
    .from("timesheets")
    .update({
      status:               newStatus,
      reviewed_at:          new Date().toISOString(),
      reviewed_by:          user.id,
      reviewer_note:        note,
      approved_by_user_id:  action === "approve" ? user.id : null,
    })
    .eq("id", timesheetId);

  if (error) throw new Error(error.message);

  // Notify the submitter
  try {
    const { data: reviewer } = await sb
      .from("profiles").select("full_name").eq("user_id", user.id).maybeSingle();
    const reviewerName = safeStr(reviewer?.full_name || "Your manager");
    await sb.from("notifications").insert({
      organisation_id: String(ts.organisation_id),
      user_id:         String(ts.user_id),
      type:            action === "approve" ? "timesheet_approved" : "timesheet_rejected",
      title:           action === "approve" ? "Timesheet approved ✓" : "Timesheet needs rework",
      body:            action === "approve"
        ? `${reviewerName} approved your timesheet`
        : `${reviewerName} rejected your timesheet${note ? ` — "${note}"` : ""}. Please rework and resubmit.`,
      link:  "/timesheet",
      read:  false,
    });
  } catch { /* silent */ }

  revalidatePath("/timesheet");
  revalidatePath("/timesheet/review");

  // Bridge: when approved, sync hours -> financial plan timesheet_entries
  if (action === "approve") {
    try {
      const { data: weekEntries } = await sb
        .from("weekly_timesheet_entries")
        .select("project_id, work_date, hours")
        .eq("timesheet_id", timesheetId)
        .gt("hours", 0);
      if (weekEntries && weekEntries.length > 0) {
        const grouped = new Map<string, { project_id: string; month_key: string; total_days: number }>();
        for (const e of weekEntries) {
          if (!e.project_id) continue;
          const mk  = String(e.work_date).slice(0, 7);
          const key = `${e.project_id}__${mk}`;
          if (!grouped.has(key)) grouped.set(key, { project_id: e.project_id, month_key: mk, total_days: 0 });
          grouped.get(key)!.total_days += Number(e.hours) / 8;
        }
        const projectIds = [...new Set([...grouped.values()].map((g) => g.project_id))];
        for (const projectId of projectIds) {
          const { data: artifact } = await sb
            .from("artifacts")
            .select("id, content_json")
            .eq("project_id", projectId)
            .eq("artifact_type", "financial_plan")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (!artifact) continue;
          const resources = (artifact.content_json as any)?.resources ?? [];
          const matched   = resources.find((r: any) => r.user_id === String(ts.user_id));
          if (!matched) continue;
          const upserts = [...grouped.values()]
            .filter((g) => g.project_id === projectId)
            .map((g) => ({
              project_id:    g.project_id,
              resource_id:   String(matched.id),
              month_key:     g.month_key,
              approved_days: Math.round(g.total_days * 100) / 100,
              status:        "approved",
              approved_at:   new Date().toISOString(),
              approved_by:   user.id,
            }));
          if (upserts.length > 0) {
            await sb.from("timesheet_entries")
              .upsert(upserts, { onConflict: "project_id,resource_id,month_key" });
          }
        }
      }
    } catch { /* silent */ }
  }

  return { status: newStatus };
}
