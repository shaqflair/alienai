// FILE: src/app/timesheet/page.tsx
import "server-only";

import { redirect }        from "next/navigation";
import { createClient }    from "@/utils/supabase/server";
import { getActiveOrgId }  from "@/utils/org/active-org";
import TimesheetClient     from "./_components/TimesheetClient";

export const dynamic  = "force-dynamic";
export const metadata = { title: "Timesheet | Aliena" };

function safeStr(x: unknown): string { return typeof x === "string" ? x : ""; }

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function toMonday(dateStr: string): string {
  const d   = new Date(dateStr);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}

function weekIsWithinCutoff(weekStart: string, cutoffWeeks: number): boolean {
  return new Date(weekStart).getTime() >= Date.now() - cutoffWeeks * 7 * 86400000;
}

export type TimesheetProject = {
  id: string; title: string; code: string | null; colour: string;
  allocatedDaysThisWeek: number | null;
};

export type TimesheetEntry = {
  id:                  string;
  projectId:           string | null;
  nonProjectCategory:  string | null;
  workDate:            string;
  hours:               number;
  description:         string | null;
};

export type TimesheetData = {
  id:           string | null;
  status:       string;
  weekStart:    string;
  entries:      TimesheetEntry[];
  reviewerNote: string | null;
};

export default async function TimesheetPage({
  searchParams,
}: {
  searchParams?: Promise<{ week?: string }> | { week?: string };
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/timesheet");

  const orgId = await getActiveOrgId().catch(() => null);
  if (!orgId) redirect("/projects?err=missing_org");
  const organisationId = String(orgId);

  const sp        = await (searchParams as any ?? {});
  const raw       = safeStr(sp?.week);
  const weekStart = toMonday(raw || new Date().toISOString().slice(0, 10));
  const weekEnd   = addDays(weekStart, 6);

  // Org role + cutoff setting
  const [memberRes, orgRes] = await Promise.all([
    supabase
      .from("organisation_members")
      .select("role")
      .eq("organisation_id", organisationId)
      .eq("user_id", user.id)
      .is("removed_at", null)
      .maybeSingle(),
    supabase
      .from("organisations")
      .select("timesheet_cutoff_weeks")
      .eq("id", organisationId)
      .maybeSingle(),
  ]);

  const myRole      = safeStr(memberRes.data?.role).toLowerCase();
  const isAdmin     = myRole === "admin" || myRole === "owner";
  const cutoffWeeks = (orgRes.data?.timesheet_cutoff_weeks as number) ?? 4;
  const isLocked    = !weekIsWithinCutoff(weekStart, cutoffWeeks);

  // ─── PROJECTS ───────────────────────────────────────────────────────────────
  // Fetch ALL allocations for this user (any week), plus this-week allocations
  // separately so we can badge "ALLOC" on the current week's rows.
  const { data: allocRows } = await supabase
    .from("allocations")
    .select(`
      project_id,
      week_start_date,
      start_date,
      end_date,
      days_per_week,
      projects:projects!allocations_project_id_fkey(
        id, title, project_code, colour, resource_status, deleted_at
      )
    `)
    .eq("person_id", user.id)
    .eq("organisation_id", organisationId);   // ← added org filter

  const projectMap           = new Map<string, TimesheetProject>();
  const allocatedThisWeekIds = new Set<string>();
  const allocDaysPerWeek     = new Map<string, number>();

  for (const a of allocRows ?? []) {
    const p = (a as any).projects;
    if (!p || p.deleted_at) continue;

    // Exclude closed/cancelled/completed projects only
    const rs = safeStr(p.resource_status).toLowerCase();
    if (["closed","cancelled","canceled","completed","inactive","archived","on_hold","on hold","paused","suspended","deferred"].includes(rs)) continue;

    const pid = safeStr(p.id);

    projectMap.set(pid, {
      id:     pid,
      title:  safeStr(p.title),
      code:   p.project_code ?? null,
      colour: safeStr(p.colour) || "#00b8db",
      allocatedDaysThisWeek: null,
    });

    // Check if this allocation covers the viewed week.
    // Support both week_start_date rows AND date-range allocations.
    const allocWeekStart = safeStr((a as any).week_start_date);
    const allocStart     = safeStr((a as any).start_date);
    const allocEnd       = safeStr((a as any).end_date);

    const coversThisWeek =
      // Row-per-week style: week_start_date falls within Mon–Sun
      (allocWeekStart && allocWeekStart >= weekStart && allocWeekStart <= weekEnd) ||
      // Date-range style: allocation overlaps the viewed week
      (allocStart && allocEnd && allocStart <= weekEnd && allocEnd >= weekStart) ||
      // Date-range without end (open-ended)
      (allocStart && !allocEnd && allocStart <= weekEnd);

    if (coversThisWeek) {
      allocatedThisWeekIds.add(pid);
      // Store days_per_week — keep max if multiple allocations
      const dpw = Number((a as any).days_per_week) || 0;
      if (dpw > 0) {
        const existing = allocDaysPerWeek.get(pid) ?? 0;
        allocDaysPerWeek.set(pid, Math.max(existing, dpw));
      }
    }
  }

  // Fix: also load projects via project_members (users may be members without allocations)
  if (projectMap.size === 0) {
    const { data: memberProjectRows } = await supabase
      .from("project_members")
      .select("project_id, projects:projects!project_members_project_id_fkey(id, title, project_code, colour, resource_status, deleted_at, organisation_id)")
      .eq("user_id", user.id)
      .is("removed_at", null);

    for (const r of memberProjectRows ?? []) {
      const p = (r as any).projects;
      if (!p || p.deleted_at) continue;
      if (safeStr(p.organisation_id) !== organisationId) continue;
      const rs = safeStr(p.resource_status).toLowerCase();
      if (["closed","cancelled","canceled","completed","inactive","archived","on_hold","on hold","paused","suspended","deferred"].includes(rs)) continue;
      const pid = safeStr(p.id);
      if (!projectMap.has(pid)) {
        projectMap.set(pid, {
          id: pid,
          title: safeStr(p.title),
          code: p.project_code ?? null,
          colour: safeStr(p.colour) || "#00b8db",
        });
        // Mark as covering this week since they're a member
        allocatedThisWeekIds.add(pid);
      }
    }
  }

  // Enrich with allocated days
  for (const [pid, dpw] of allocDaysPerWeek) {
    const proj = projectMap.get(pid);
    if (proj) proj.allocatedDaysThisWeek = dpw;
  }

  // Sort: this-week allocations first, then the rest alphabetically
  const allProjectsList = Array.from(projectMap.values());
  const projects: TimesheetProject[] = [
    ...allProjectsList.filter(p => allocatedThisWeekIds.has(p.id))
                      .sort((a, b) => a.title.localeCompare(b.title)),
    ...allProjectsList.filter(p => !allocatedThisWeekIds.has(p.id))
                      .sort((a, b) => a.title.localeCompare(b.title)),
  ];

  // Load existing timesheet
  const { data: ts } = await supabase
    .from("timesheets")
    .select(`
      id, status, week_start_date, reviewer_note,
      timesheet_entries(id, project_id, non_project_category, work_date, hours)
    `)
    .eq("organisation_id", organisationId)
    .eq("user_id", user.id)
    .eq("week_start_date", weekStart)
    .maybeSingle();

  const entries: TimesheetEntry[] = ((ts as any)?.timesheet_entries ?? []).map((e: any) => ({
    id:                 safeStr(e.id),
    projectId:          e.project_id ?? null,
    nonProjectCategory: e.non_project_category ?? null,
    workDate:           safeStr(e.work_date),
    hours:              Number(e.hours) || 0,
    description:        null,
  }));

  const timesheetData: TimesheetData = {
    id:           ts?.id ?? null,
    status:       safeStr(ts?.status) || "draft",
    weekStart,
    entries,
    reviewerNote: (ts as any)?.reviewer_note ?? null,
  };

  // Build recent weeks sidebar
  const { data: recentTs } = await supabase
    .from("timesheets")
    .select("id, week_start_date, status")
    .eq("organisation_id", organisationId)
    .eq("user_id", user.id)
    .order("week_start_date", { ascending: false })
    .limit(12);

  const seenWeeks = new Set<string>();
  const allWeeks: { weekStart: string; status: string; id: string | null }[] = [];

  for (const t of recentTs ?? []) {
    const ws = safeStr(t.week_start_date);
    seenWeeks.add(ws);
    allWeeks.push({ weekStart: ws, status: safeStr(t.status), id: safeStr(t.id) });
  }

  for (let w = 0; w <= cutoffWeeks; w++) {
    const ws = toMonday(addDays(new Date().toISOString().slice(0, 10), -w * 7));
    if (!seenWeeks.has(ws)) {
      allWeeks.push({ weekStart: ws, status: "draft", id: null });
      seenWeeks.add(ws);
    }
  }

  allWeeks.sort((a, b) => b.weekStart.localeCompare(a.weekStart));

  return (
    <TimesheetClient
      weekStart={weekStart}
      projects={projects}
      allocatedProjectIds={[...allocatedThisWeekIds]}
      timesheetData={timesheetData}
      recentTimesheets={allWeeks.slice(0, 12)}
      isAdmin={isAdmin}
      isLocked={isLocked}
      cutoffWeeks={cutoffWeeks}
      organisationId={organisationId}
      userId={user.id}
      userName={safeStr(user.email)}
    />
  );
}
