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

// Monday of any given date string
function toMonday(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

async function requireOrgMember(sb: any, organisationId: string, userId: string) {
  const { data } = await sb
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();
  if (!data) throw new Error("Not a member of this organisation");
  return safeStr(data.role).toLowerCase() as "owner" | "admin" | "member";
}

async function requireAdmin(sb: any, organisationId: string, userId: string) {
  const role = await requireOrgMember(sb, organisationId, userId);
  if (role !== "admin" && role !== "owner") throw new Error("Admin access required");
}

/* =============================================================================
   GET OR CREATE TIMESHEET for a given week
============================================================================= */
export async function getOrCreateTimesheetAction(formData: FormData) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const orgId     = await getActiveOrgId().catch(() => null);
  if (!orgId) throw new Error("No active organisation");

  const weekRaw   = safeStr(formData.get("week_start_date")).trim();
  const weekStart = toMonday(weekRaw || new Date().toISOString().slice(0, 10));

  const { data: existing } = await sb
    .from("timesheets")
    .select("id, status")
    .eq("organisation_id", String(orgId))
    .eq("user_id", user.id)
    .eq("week_start_date", weekStart)
    .maybeSingle();

  if (existing) return { timesheetId: existing.id, status: existing.status, weekStart };

  const { data, error } = await sb
    .from("timesheets")
    .insert({
      organisation_id: String(orgId),
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
   SAVE TIMESHEET ENTRIES (upsert all entries for the week grid)
============================================================================= */
export async function saveTimesheetEntriesAction(formData: FormData) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const timesheetId = safeStr(formData.get("timesheet_id")).trim();
  if (!isUuid(timesheetId)) throw new Error("Invalid timesheet_id");

  // Verify ownership + draft status
  const { data: ts } = await sb
    .from("timesheets")
    .select("id, status, user_id")
    .eq("id", timesheetId)
    .maybeSingle();

  if (!ts || ts.user_id !== user.id) throw new Error("Timesheet not found");
  if (ts.status !== "draft") throw new Error("Can only edit draft timesheets");

  // Parse entries from formData: entries[projectId][date] = hours
  // Field names: entry_{projectId}_{date}
  const entries: Array<{
    timesheet_id:  string;
    project_id:    string | null;
    work_date:     string;
    hours:         number;
    description:   string | null;
  }> = [];

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("entry_")) continue;
    const parts = key.split("_");
    if (parts.length < 3) continue;

    const projectId = parts[1] === "none" ? null : parts[1];
    const workDate  = parts.slice(2).join("-");  // e.g. 2025-03-10
    const hours     = Math.max(0, Math.min(24, safeNum(value)));

    if (!workDate.match(/^\d{4}-\d{2}-\d{2}$/)) continue;

    entries.push({
      timesheet_id:  timesheetId,
      project_id:    projectId && isUuid(projectId) ? projectId : null,
      work_date:     workDate,
      hours,
      description:   safeStr(formData.get(`desc_${projectId ?? "none"}_${workDate}`)) || null,
    });
  }

  // Delete existing entries then re-insert
  await sb.from("timesheet_entries").delete().eq("timesheet_id", timesheetId);

  const toInsert = entries.filter(e => e.hours > 0);
  if (toInsert.length > 0) {
    const { error } = await sb.from("timesheet_entries").insert(toInsert);
    if (error) throw new Error(error.message);
  }

  revalidatePath("/timesheet");
  return { saved: toInsert.length };
}

/* =============================================================================
   SUBMIT TIMESHEET FOR APPROVAL
============================================================================= */
export async function submitTimesheetAction(formData: FormData) {
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

  if (!ts || ts.user_id !== user.id) throw new Error("Timesheet not found");
  if (ts.status !== "draft") throw new Error("Only draft timesheets can be submitted");

  const { error } = await sb
    .from("timesheets")
    .update({ status: "submitted", submitted_at: new Date().toISOString() })
    .eq("id", timesheetId);

  if (error) throw new Error(error.message);
  revalidatePath("/timesheet");
  return { submitted: true };
}

/* =============================================================================
   RECALL SUBMITTED TIMESHEET (back to draft)
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
    .update({ status: "draft", submitted_at: null })
    .eq("id", timesheetId);

  if (error) throw new Error(error.message);
  revalidatePath("/timesheet");
}

/* =============================================================================
   APPROVE / REJECT TIMESHEET (admin)
============================================================================= */
export async function reviewTimesheetAction(formData: FormData) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const timesheetId = safeStr(formData.get("timesheet_id")).trim();
  const action      = safeStr(formData.get("action")).trim();  // approve | reject
  const note        = safeStr(formData.get("reviewer_note")).trim() || null;

  if (!isUuid(timesheetId)) throw new Error("Invalid timesheet_id");
  if (action !== "approve" && action !== "reject") throw new Error("Invalid action");

  const { data: ts } = await sb
    .from("timesheets")
    .select("id, status, organisation_id")
    .eq("id", timesheetId)
    .maybeSingle();

  if (!ts) throw new Error("Timesheet not found");
  if (ts.status !== "submitted") throw new Error("Can only review submitted timesheets");

  const orgId = String(ts.organisation_id);
  await requireAdmin(sb, orgId, user.id);

  const newStatus = action === "approve" ? "approved" : "rejected";
  const { error } = await sb
    .from("timesheets")
    .update({
      status:        newStatus,
      reviewed_at:   new Date().toISOString(),
      reviewed_by:   user.id,
      reviewer_note: note,
    })
    .eq("id", timesheetId);

  if (error) throw new Error(error.message);
  revalidatePath("/timesheet");
  revalidatePath("/timesheet/review");
  return { status: newStatus };
}
