// FILE: src/app/timesheet/review/page.tsx
import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import ReviewClient from "./_components/ReviewClient";

export const dynamic  = "force-dynamic";
export const metadata = { title: "Review Timesheets | Aliena" };

function safeStr(x: unknown): string { return typeof x === "string" ? x : ""; }

export type ReviewEntryRow = {
  id:                  string;
  workDate:            string;
  hours:               number;
  description:         string | null;
  projectId:           string | null;
  projectTitle:        string | null;
  projectCode:         string | null;
  nonProjectCategory:  string | null;
};

export type ReviewTimesheetRow = {
  id:               string;
  weekStart:        string;
  status:           string;
  submittedAt:      string | null;
  totalHours:       number;
  personName:       string;
  personEmail:      string;
  userId:           string;
  reviewerNote:     string | null;
  isMyDirectReport: boolean;
  entries:          ReviewEntryRow[];
};

export default async function TimesheetReviewPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }> | { status?: string };
}) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login?next=/timesheet/review");

  const orgId = await getActiveOrgId().catch(() => null);
  if (!orgId) redirect("/?err=no_org");
  const organisationId = String(orgId);

  const { data: mem } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle();

  const myRole  = safeStr(mem?.role).toLowerCase();
  const isAdmin = myRole === "admin" || myRole === "owner";

  const { data: directReports } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("line_manager_id", user.id);

  const directReportIds = new Set((directReports ?? []).map((r: any) => String(r.user_id)));
  const isLineManager   = directReportIds.size > 0;

  if (!isAdmin && !isLineManager) redirect("/timesheet?err=not_authorised");

  const sp           = await (searchParams ?? Promise.resolve({})) as any;
  const statusFilter = safeStr(sp?.status) || "submitted";

  let tsQuery = supabase
    .from("timesheets")
    .select(`
      id, week_start_date, status, submitted_at, reviewer_note, user_id,
      weekly_timesheet_entries(
        id, work_date, hours, description, project_id, non_project_category
      )
    `)
    .eq("organisation_id", organisationId)
    .order("submitted_at", { ascending: false })
    .limit(200);

  if (statusFilter !== "all") tsQuery = tsQuery.eq("status", statusFilter);
  if (!isAdmin && isLineManager) tsQuery = tsQuery.in("user_id", [...directReportIds]);

  const { data: timesheets } = await tsQuery;

  // Collect all project IDs to look up titles
  const allProjectIds = new Set<string>();
  for (const t of timesheets ?? []) {
    for (const e of (t as any).weekly_timesheet_entries ?? []) {
      if (e.project_id) allProjectIds.add(e.project_id);
    }
  }
  const projectsById = new Map<string, { title: string; project_code: string | null }>();
  if (allProjectIds.size > 0) {
    const { data: projects } = await supabase
      .from("projects")
      .select("id, title, project_code")
      .in("id", [...allProjectIds]);
    (projects ?? []).forEach((p: any) => projectsById.set(String(p.id), { title: p.title, project_code: p.project_code ?? null }));
  }

  const userIds = [...new Set((timesheets ?? []).map((t: any) => safeStr(t.user_id)))];
  const profilesById = new Map<string, any>();
  if (userIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, full_name, email, line_manager_id")
      .in("user_id", userIds);
    (profiles ?? []).forEach((p: any) => profilesById.set(String(p.user_id), p));
  }

  const rows: ReviewTimesheetRow[] = (timesheets ?? []).map((t: any) => {
    const profile    = profilesById.get(safeStr(t.user_id)) ?? {};
    const rawEntries = (t.weekly_timesheet_entries ?? []) as any[];
    const totalHours = rawEntries.reduce((sum: number, e: any) => sum + (Number(e.hours) || 0), 0);

    const entries: ReviewEntryRow[] = rawEntries
      .filter((e: any) => Number(e.hours) > 0)
      .sort((a: any, b: any) => safeStr(a.work_date).localeCompare(safeStr(b.work_date)))
      .map((e: any) => {
        const proj = e.project_id ? projectsById.get(String(e.project_id)) : null;
        return {
          id:                 safeStr(e.id),
          workDate:           safeStr(e.work_date),
          hours:              Number(e.hours) || 0,
          description:        e.description ?? null,
          projectId:          e.project_id ?? null,
          projectTitle:       proj?.title ?? null,
          projectCode:        proj?.project_code ?? null,
          nonProjectCategory: e.non_project_category ?? null,
        };
      });

    return {
      id:               safeStr(t.id),
      weekStart:        safeStr(t.week_start_date),
      status:           safeStr(t.status),
      submittedAt:      t.submitted_at ?? null,
      totalHours,
      personName:       safeStr(profile.full_name || profile.email || t.user_id),
      personEmail:      safeStr(profile.email),
      userId:           safeStr(t.user_id),
      reviewerNote:     t.reviewer_note ?? null,
      isMyDirectReport: directReportIds.has(safeStr(t.user_id)),
      entries,
    };
  });

  const exportAllUrl = `/api/timesheet/export?from=${
    new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
  }&to=${new Date().toISOString().slice(0, 10)}`;

  return (
    <ReviewClient
      rows={rows}
      statusFilter={statusFilter}
      exportAllUrl={exportAllUrl}
      isAdmin={isAdmin}
      reviewerName={safeStr(user.email)}
    />
  );
}
