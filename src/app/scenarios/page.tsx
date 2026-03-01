import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import ScenarioSimulator from "./_components/ScenarioSimulator";
import type {
  LivePerson, LiveProject, LiveAllocation, LiveException, Scenario,
} from "./_lib/scenario-engine";

export const metadata = { title: "What-if Simulator | ResForce" };

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function getMondayOf(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().split("T")[0];
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

export default async function ScenariosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/scenarios");

  const orgId = await getActiveOrgId().catch(() => null);
  const organisationId = orgId ? String(orgId) : null;
  if (!organisationId) redirect("/projects?err=missing_org");

  const today      = new Date().toISOString().split("T")[0];
  const thisWeek   = getMondayOf(today);
  const sixMoAhead = addDays(thisWeek, 182);
  const eightWksAgo = addDays(thisWeek, -56);

  const [memberRes, projectRes, allocRes, exceptionRes, scenarioRes] = await Promise.all([
    supabase
      .from("organisation_members")
      .select(`
        user_id,
        profiles:profiles!organisation_members_user_id_fkey (
          user_id, full_name, department, employment_type,
          default_capacity_days, is_active
        )
      `)
      .eq("organisation_id", organisationId)
      .is("removed_at", null),

    supabase
      .from("projects")
      .select("id, title, project_code, colour, start_date, finish_date, resource_status, win_probability")
      .eq("organisation_id", organisationId)
      .in("resource_status", ["confirmed", "pipeline"])
      .is("deleted_at", null)
      .order("title"),

    supabase
      .from("allocations")
      .select("id, person_id, project_id, week_start_date, days_allocated, allocation_type, created_at")
      .gte("week_start_date", eightWksAgo)
      .lte("week_start_date", sixMoAhead),

    supabase
      .from("capacity_exceptions")
      .select("person_id, week_start_date, available_days")
      .gte("week_start_date", thisWeek)
      .lte("week_start_date", sixMoAhead),

    supabase
      .from("scenarios")
      .select("id, name, description, changes, created_at, updated_at")
      .eq("organisation_id", organisationId)
      .order("updated_at", { ascending: false })
      .limit(10)
      .then(r => r)
      .catch(() => ({ data: [] })),
  ]);

  const people: LivePerson[] = (memberRes.data ?? [])
    .map((m: any) => {
      const p = m.profiles;
      if (!p || p.is_active === false) return null;
      return {
        personId:     String(p.user_id || m.user_id),
        fullName:     safeStr(p.full_name || "Unknown"),
        department:   p.department ? safeStr(p.department) : null,
        empType:      safeStr(p.employment_type || "full_time"),
        capacityDays: parseFloat(String(p.default_capacity_days ?? 5)),
      } satisfies LivePerson;
    })
    .filter(Boolean) as LivePerson[];

  people.sort((a, b) => a.fullName.localeCompare(b.fullName));

  const projects: LiveProject[] = (projectRes.data ?? []).map((p: any) => ({
    projectId:   String(p.id),
    title:       safeStr(p.title),
    projectCode: p.project_code ? safeStr(p.project_code) : null,
    colour:      safeStr(p.colour || "#00b8db"),
    startDate:   p.start_date   ? safeStr(p.start_date)  : null,
    endDate:     p.finish_date  ? safeStr(p.finish_date) : null,
    status:      safeStr(p.resource_status || "confirmed"),
    winProb:     parseFloat(String(p.win_probability ?? 50)),
  } satisfies LiveProject));

  const allocations: LiveAllocation[] = (allocRes.data ?? []).map((a: any) => ({
    id:             String(a.id),
    personId:       String(a.person_id),
    projectId:      String(a.project_id),
    weekStart:      safeStr(a.week_start_date),
    daysAllocated: parseFloat(String(a.days_allocated)),
    allocType:      safeStr(a.allocation_type || "confirmed"),
  } satisfies LiveAllocation));

  const exceptions: LiveException[] = (exceptionRes.data ?? []).map((e: any) => ({
    personId:  String(e.person_id),
    weekStart: safeStr(e.week_start_date),
    availDays: parseFloat(String(e.available_days)),
  } satisfies LiveException));

  const savedScenarios: Scenario[] = ((scenarioRes as any).data ?? []).map((s: any) => ({
    id:          String(s.id),
    name:        safeStr(s.name),
    description: safeStr(s.description || ""),
    changes:     Array.isArray(s.changes) ? s.changes : [],
    createdAt:   safeStr(s.created_at),
    updatedAt:   safeStr(s.updated_at),
  } satisfies Scenario));

  return (
    <ScenarioSimulator
      people={people}
      projects={projects}
      allocations={allocations}
      exceptions={exceptions}
      organisationId={organisationId}
      savedScenarios={savedScenarios}
    />
  );
}
