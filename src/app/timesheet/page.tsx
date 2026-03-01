import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import TimesheetClient from "./_components/TimesheetClient";

export const dynamic  = "force-dynamic";
export const metadata = { title: "Timesheet | ResForce" };

function safeStr(x: unknown): string { return typeof x === "string" ? x : ""; }

function toMonday(dateStr?: string): string {
  const d = dateStr ? new Date(dateStr) : new Date();
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type TimesheetProject = {
  id:    string;
  title: string;
  code:  string | null;
  colour: string;
};

export type TimesheetEntry = {
  id:          string;
  projectId:   string | null;
  workDate:    string;
  hours:       number;
  description: string | null;
};

export type TimesheetData = {
  id:          string | null;
  status:      string;
  weekStart:   string;
  entries:     TimesheetEntry[];
};

export default async function TimesheetPage({
  searchParams,
}: {
  searchParams?: Promise<{ week?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login?next=/timesheet");

  const orgId = await getActiveOrgId().catch(() => null);
  if (!orgId) redirect("/?err=no_org");
  const organisationId = String(orgId);

  const sp        = await (searchParams ?? Promise.resolve({}));
  const weekStart = toMonday(safeStr(sp?.week) || undefined);

  // Check admin role
  const { data: mem } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle();

  const myRole  = safeStr(mem?.role).toLowerCase();
  const isAdmin = myRole === "admin" || myRole === "owner";

  // Load projects user is allocated to this week (for the row selector)
  const weekEnd = addDays(weekStart, 6);

  const { data: allocRows } = await supabase
    .from("allocations")
    .select(`
      id, project_id,
      projects:projects!allocations_project_id_fkey(id, title, project_code, colour)
    `)
    .eq("person_id", user.id)
    .gte("week_start_date", weekStart)
    .lte("week_start_date", weekEnd);

  // Also load all active org projects (in case they log time on non-allocated project)
  const { data: allProjects } = await supabase
    .from("projects")
    .select("id, title, project_code, colour")
    .eq("organisation_id", organisationId)
    .is("deleted_at", null)
    .order("title");

  // Deduplicate projects (allocated first, then all)
  const projectMap = new Map<string, TimesheetProject>();
  for (const proj of allProjects ?? []) {
    projectMap.set(safeStr(proj.id), {
      id:      safeStr(proj.id),
      title:   safeStr(proj.title),
      code:    proj.project_code ?? null,
      colour: safeStr(proj.colour) || "#00b8db",
    });
  }
  const allocatedProjectIds = new Set(
    (allocRows ?? []).map((a: any) => safeStr(a.project_id)).filter(Boolean)
  );

  // Sort: allocated first, then others
  const projects: TimesheetProject[] = [
    ...Array.from(projectMap.values()).filter(p => allocatedProjectIds.has(p.id)),
    ...Array.from(projectMap.values()).filter(p => !allocatedProjectIds.has(p.id)),
  ];

  // Load existing timesheet for this week
  const { data: ts } = await supabase
    .from("timesheets")
    .select(`
      id, status, week_start_date,
      timesheet_entries(id, project_id, work_date, hours, description)
    `)
    .eq("organisation_id", organisationId)
    .eq("user_id", user.id)
    .eq("week_start_date", weekStart)
    .maybeSingle();

  const entries: TimesheetEntry[] = ((ts as any)?.timesheet_entries ?? []).map((e: any) => ({
    id:          safeStr(e.id),
    projectId:   e.project_id ?? null,
    workDate:    safeStr(e.work_date),
    hours:       Number(e.hours) || 0,
    description: e.description ?? null,
  }));

  const timesheetData: TimesheetData = {
    id:        ts?.id ?? null,
    status:    safeStr(ts?.status) || "draft",
    weekStart,
    entries,
  };

  // Recent timesheets (last 8 weeks) for navigation
  const { data: recentTs } = await supabase
    .from("timesheets")
    .select("id, week_start_date, status")
    .eq("organisation_id", organisationId)
    .eq("user_id", user.id)
    .order("week_start_date", { ascending: false })
    .limit(10);

  const userName = safeStr(user.email);

  return (
    <TimesheetClient
      weekStart={weekStart}
      projects={projects}
      allocatedProjectIds={[...allocatedProjectIds]}
      timesheetData={timesheetData}
      recentTimesheets={(recentTs ?? []).map((t: any) => ({
        id:        safeStr(t.id),
        weekStart: safeStr(t.week_start_date),
        status:    safeStr(t.status),
      }))}
      isAdmin={isAdmin}
      organisationId={organisationId}
      userId={user.id}
      userName={userName}
    />
  );
}
