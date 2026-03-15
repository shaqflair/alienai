// src/lib/audit/allocation-audit.ts
// Audit logging for heatmap / resource plan allocation changes.
// Writes to allocation_audit_log via admin client (bypasses RLS).

import { createAdminClient } from "@/utils/supabase/admin";

/* -------------------------------------------------------------
   ACTION TYPES
------------------------------------------------------------- */
export type AllocationAction =
  | "allocation.created"      // new person?project assignment
  | "allocation.updated"      // dates or days/week changed
  | "allocation.deleted"      // entire person?project removed
  | "allocation.week_updated" // single week days_allocated changed
  | "allocation.week_deleted" // single week removed (days ? 0)
  | string;

/* -------------------------------------------------------------
   WRITE
------------------------------------------------------------- */
export type WriteAllocationAuditArgs = {
  organisationId: string;
  projectId:      string;
  personId:       string;
  actorId:        string;
  action:         AllocationAction;
  before?:        Record<string, any> | null;
  after?:         Record<string, any> | null;
};

export async function writeAllocationAudit(args: WriteAllocationAuditArgs): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("allocation_audit_log").insert({
      organisation_id: args.organisationId,
      project_id:      args.projectId,
      person_id:       args.personId,
      actor_id:        args.actorId,
      action:          args.action,
      before:          args.before  ?? null,
      after:           args.after   ?? null,
    });
    if (error) console.warn("[writeAllocationAudit] failed:", error.message);
  } catch (e) {
    console.warn("[writeAllocationAudit] exception:", e);
  }
}

/* -------------------------------------------------------------
   DIFF HELPERS
------------------------------------------------------------- */

export function buildCreatedPayload(args: {
  personName?:     string | null;
  projectTitle?:   string | null;
  projectCode?:    string | null;
  startDate:       string;
  endDate:         string;
  daysPerWeek:     number;
  weeksInserted:   number;
  conflictCount:   number;
  roleOnProject?:  string | null;
  allocationType:  string;
}): Record<string, any> {
  return {
    person_name:      args.personName    ?? null,
    project_title:    args.projectTitle  ?? null,
    project_code:     args.projectCode   ?? null,
    start_date:       args.startDate,
    end_date:         args.endDate,
    days_per_week:    args.daysPerWeek,
    weeks_inserted:   args.weeksInserted,
    conflict_count:   args.conflictCount,
    role_on_project:  args.roleOnProject ?? null,
    allocation_type:  args.allocationType,
    total_days:       Math.round(args.daysPerWeek * args.weeksInserted * 10) / 10,
    summary: `${args.daysPerWeek}d/wk ? ${args.weeksInserted} weeks = ${Math.round(args.daysPerWeek * args.weeksInserted * 10) / 10}d total`,
  };
}

export function buildUpdatedDiff(
  before: {
    startDate: string; endDate: string; daysPerWeek: number;
    roleOnProject?: string | null; allocationType?: string;
  },
  after: {
    startDate: string; endDate: string; daysPerWeek: number; weeksUpdated: number;
    roleOnProject?: string | null; allocationType?: string;
  }
) {
  const changes: string[] = [];
  if (before.startDate   !== after.startDate)   changes.push(`start ${before.startDate} ? ${after.startDate}`);
  if (before.endDate     !== after.endDate)     changes.push(`end ${before.endDate} ? ${after.endDate}`);
  if (before.daysPerWeek !== after.daysPerWeek) changes.push(`${before.daysPerWeek}d/wk ? ${after.daysPerWeek}d/wk`);

  return {
    before: { start_date: before.startDate, end_date: before.endDate, days_per_week: before.daysPerWeek, role_on_project: before.roleOnProject ?? null, allocation_type: before.allocationType ?? null },
    after:  { start_date: after.startDate,  end_date: after.endDate,  days_per_week: after.daysPerWeek,  weeks_updated: after.weeksUpdated, role_on_project: after.roleOnProject ?? null, allocation_type: after.allocationType ?? null, summary: changes.join(", ") || "No changes detected" },
  };
}