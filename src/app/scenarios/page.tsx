// FILE: src/app/scenarios/page.tsx
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

// Safe supabase query wrapper -- never throws, returns empty array on any error
async function safeQuery<T>(promise: Promise<{ data: T[] | null; error: any }>): Promise<T[]> {
  try {
    const { data } = await promise;
    return data ?? [];
  } catch {
    return [];
  }
}

export default async function ScenariosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/scenarios");

  const orgId = await getActiveOrgId().catch(() => null);
  const organisationId = orgId ? String(orgId) : null;
  if (!organisationId) redirect("/projects?err=missing_org");

  const today       = new Date().toISOString().split("T")[0];
  const thisWeek    = getMondayOf(today);
  const sixMoAhead  = addDays(thisWeek, 182);
  const eightWksAgo = addDays(thisWeek, -56);

  // Fetch member user_ids first, then profiles separately (avoids FK hint issues)
  const memberUserIdRows = await safeQuery(
    supabase
      .from("organisation_members")
      .select("user_id")
      .eq("organisation_id", organisationId)
      .is("removed_at", null)
  );
  const memberUserIds = (memberUserIdRows as any[]).map((r: any) => String(r.user_id)).filter(Boolean);

  const [memberRows, projectRows, allocRows, exceptionRows, scenarioRows] = await Promise.all([
    memberUserIds.length > 0
      ? safeQuery(
          supabase
            .from("profiles")
            .select("user_id, full_name, department, employment_type, default_capacity_days, is_active")
            .in("user_id", memberUserIds)
        )
      : Promise.resolve([]),
    safeQuery(
      supabase
        .from("projects")
        .select("id, title, project_code, colour, start_date, finish_date, resource_status, win_probability")
        .eq("organisation_id", organisationId)
        .in("resource_status", ["confirmed", "pipeline"])
        .is("deleted_at", null)
        .order("title")
    ),
    // Scope allocations to this org's members so we never pull cross-org rows
    // if RLS is misconfigured. Falls back to empty if memberUserIds is empty.
    memberUserIds.length > 0
      ? safeQuery(
          supabase
            .from("allocations")
            .select("id, person_id, project_id, week_start_date, days_allocated, allocation_type, created_at")
            .in("person_id", memberUserIds)
            .gte("week_start_date", eightWksAgo)
            .lte("week_start_date", sixMoAhead)
        )
      : Promise.resolve([]),
    // capacity_exceptions may not exist -- safeQuery handles gracefully
    safeQuery(
      supabase
        .from("capacity_exceptions")
        .select("person_id, week_start_date, available_days")
        .gte("week_start_date", thisWeek)
        .lte("week_start_date", sixMoAhead)
    ),
    // scenarios table may not exist yet
    safeQuery(
      supabase
        .from("scenarios")
        .select("id, name, description, changes, created_at, updated_at")
        .eq("organisation_id", organisationId)
        .order("updated_at", { ascending: false })
        .limit(10)
    ),
  ]);

  // -- Transform people -------------------------------------------------------
  const people: LivePerson[] = (memberRows as any[])
    .map((p: any) => {
      if (!p) return null;
      if (p.is_active === false) return null;
      return {
        personId:     String(p.user_id),
        fullName:     safeStr(p.full_name || "Unknown"),
        department:   p.department ? safeStr(p.department) : null,
        empType:      safeStr(p.employment_type || "full_time"),
        capacityDays: parseFloat(String(p.default_capacity_days ?? p.capacity_days ?? 5)),
      } satisfies LivePerson;
    })
    .filter(Boolean) as LivePerson[];

  people.sort((a, b) => a.fullName.localeCompare(b.fullName));

  // -- Transform projects -----------------------------------------------------
  const projects: LiveProject[] = (projectRows as any[]).map((p: any) => ({
    projectId:   String(p.id),
    title:       safeStr(p.title),
    projectCode: p.project_code ? safeStr(p.project_code) : null,
    colour:      safeStr(p.colour || "#00b8db"),
    startDate:   p.start_date  ? safeStr(p.start_date)  : null,
    endDate:     p.finish_date ? safeStr(p.finish_date) : null,
    status:      safeStr(p.resource_status || "confirmed"),
    winProb:     parseFloat(String(p.win_probability ?? 50)),
  } satisfies LiveProject));

  // -- Transform allocations --------------------------------------------------
  // FIX: normalise weekStart to Monday so allocMap keys match the Monday-keyed
  // weeks produced by weeksInRange() and applyChanges(). Without this, any
  // DB row whose week_start_date isn't already a Monday silently misses every
  // lookup in computeState, leaving the Live heatmap empty.
  const allocations: LiveAllocation[] = (allocRows as any[]).map((a: any) => ({
    id:            String(a.id),
    personId:      String(a.person_id),
    projectId:     String(a.project_id),
    weekStart:     getMondayOf(safeStr(a.week_start_date).slice(0, 10)),
    daysAllocated: parseFloat(String(a.days_allocated ?? 0)),
    allocType:     safeStr(a.allocation_type || "confirmed"),
  } satisfies LiveAllocation));

  // -- Transform exceptions ---------------------------------------------------
  // FIX: same Monday normalisation so exception lookups in computeState match.
  const exceptions: LiveException[] = (exceptionRows as any[]).map((e: any) => ({
    personId:  String(e.person_id),
    weekStart: getMondayOf(safeStr(e.week_start_date).slice(0, 10)),
    availDays: parseFloat(String(e.available_days ?? 0)),
  } satisfies LiveException));

  // -- Transform saved scenarios ----------------------------------------------
  const savedScenarios: Scenario[] = (scenarioRows as any[]).map((s: any) => ({
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