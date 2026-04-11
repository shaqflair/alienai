"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

function safeStr(x: unknown): string { return typeof x === "string" ? x : ""; }
function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test((x || "").trim());
}

export async function submitTimesheetAction(formData: FormData) {
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
  if (ts.status !== "draft") throw new Error("Only draft timesheets can be submitted");

  // Resolve line manager at submit time (snapshot -- in case manager changes later)
  const { data: profile } = await sb
    .from("profiles")
    .select("line_manager_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const lineManagerId = profile?.line_manager_id ?? null;

  const { error } = await sb
    .from("timesheets")
    .update({
      status:          "submitted",
      submitted_at:    new Date().toISOString(),
      line_manager_id: lineManagerId,
    })
    .eq("id", timesheetId);

  if (error) throw new Error(error.message);
  revalidatePath("/timesheet");
  return { submitted: true, routedTo: lineManagerId };
}
