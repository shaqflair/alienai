import "server-only";
import { createClient } from "@/utils/supabase/server";

export type TimelineProject = {
  projectId:    string;
  title:        string;
  projectCode:  string | null;
  colour:       string;
  status:       string;
  winProb:      number;
  startDate:    string | null;
  endDate:      string | null;
  milestones:   Milestone[];
  dependencies: string[];      // projectIds this depends on
  people: Array<{
    personId:  string;
    fullName:  string;
    weeks:     Array<{ weekStart: string; days: number }>;
  }>;
};

export type Milestone = {
  id:    string;
  label: string;
  date:  string;
  type:  "kickoff" | "delivery" | "review" | "other";
};

export type CapacityPoint = {
  weekStart: string;
  totalCap:  number;
  totalAlloc: number;
  utilPct:   number;
};

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function getMondayOf(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().split("T")[0];
}

function addWeeks(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n * 7);
  return d.toISOString().split("T")[0];
}

function weeksInRange(start: string, end: string): string[] {
  const weeks: string[] = [];
  let cur = getMondayOf(start);
  const endMon = getMondayOf(end);
  while (cur <= endMon && weeks.length < 104) {
    weeks.push(cur);
    cur = addWeeks(cur, 1);
  }
  return weeks;
}

export async function fetchTimelineData(organisationId: string) {
  const supabase = await createClient();

  const today    = new Date().toISOString().split("T")[0];
  const thisWeek = getMondayOf(today);
  const ago8wks  = addWeeks(thisWeek, -8);
  const in26wks  = addWeeks(thisWeek, 26);

  const [projectRes, allocRes, memberRes, milestoneRes, depRes] = await Promise.all([
    supabase
      .from("projects")
      .select("id, title, project_code, colour, resource_status, start_date, finish_date, win_probability")
      .eq("organisation_id", organisationId)
      .in("resource_status", ["confirmed", "pipeline"])
      .is("deleted_at", null)
      .order("start_date", { ascending: true, nullsFirst: false }),

    supabase
      .from("allocations")
      .select("person_id, project_id, week_start_date, days_allocated, profiles:profiles!allocations_person_id_fkey(user_id, full_name)")
      .gte("week_start_date", ago8wks)
      .lte("week_start_date", in26wks),

    supabase
      .from("organisation_members")
      .select("user_id, profiles:profiles!organisation_members_user_id_fkey(user_id, default_capacity_days, is_active)")
      .eq("organisation_id", organisationId)
      .is("removed_at", null),

    // Milestones (graceful fallback if table doesn't exist)
    supabase
      .from("project_milestones")
      .select("id, project_id, label, date, type")
      .gte("date", ago8wks)
      .lte("date", in26wks)
      .then(r => r).catch(() => ({ data: [] })),

    // Dependencies (graceful fallback)
    supabase
      .from("project_dependencies")
      .select("project_id, depends_on_project_id")
      .then(r => r).catch(() => ({ data: [] })),
  ]);

  // People capacity map
  const capMap = new Map<string, number>();
  for (const m of memberRes.data ?? []) {
    const p = (m as any).profiles;
    if (!p || p.is_active === false) continue;
    capMap.set(String(p.user_id || m.user_id), parseFloat(String(p.default_capacity_days ?? 5)));
  }

  // Milestones by project
  const milestonesByProject = new Map<string, Milestone[]>();
  for (const ms of (milestoneRes as any).data ?? []) {
    const pid = String(ms.project_id);
    if (!milestonesByProject.has(pid)) milestonesByProject.set(pid, []);
    milestonesByProject.get(pid)!.push({
      id:    String(ms.id),
      label: safeStr(ms.label),
      date:  safeStr(ms.date),
      type:  (ms.type || "other") as Milestone["type"],
    });
  }

  // Dependencies by project
  const depsByProject = new Map<string, string[]>();
  for (const d of (depRes as any).data ?? []) {
    const pid = String(d.project_id);
    if (!depsByProject.has(pid)) depsByProject.set(pid, []);
    depsByProject.get(pid)!.push(String(d.depends_on_project_id));
  }

  // Allocs by project -> person -> week
  type AllocEntry = Map<string, Map<string, number>>; // personId -> weekStart -> days
  const allocByProject = new Map<string, AllocEntry>();
  const personNames    = new Map<string, string>();

  for (const a of allocRes.data ?? []) {
    const projId  = String(a.project_id);
    const personId = String(a.person_id);
    const week    = safeStr(a.week_start_date);
    const days    = parseFloat(String(a.days_allocated));
    const name    = safeStr((a.profiles as any)?.full_name || "Unknown");

    personNames.set(personId, name);

    if (!allocByProject.has(projId)) allocByProject.set(projId, new Map());
    const byPerson = allocByProject.get(projId)!;
    if (!byPerson.has(personId)) byPerson.set(personId, new Map());
    byPerson.get(personId)!.set(week, (byPerson.get(personId)!.get(week) ?? 0) + days);
  }

  // Build timeline projects
  const projects: TimelineProject[] = (projectRes.data ?? []).map((p: any) => {
    const projId = String(p.id);
    const byPerson = allocByProject.get(projId) ?? new Map();

    const people = Array.from(byPerson.entries()).map(([personId, weekMap]) => ({
      personId,
      fullName: personNames.get(personId) ?? "Unknown",
      weeks:    Array.from(weekMap.entries())
        .map(([weekStart, days]) => ({ weekStart, days }))
        .sort((a, b) => a.weekStart.localeCompare(b.weekStart)),
    })).sort((a, b) => a.fullName.localeCompare(b.fullName));

    return {
      projectId:    projId,
      title:        safeStr(p.title),
      projectCode:  p.project_code ? safeStr(p.project_code) : null,
      colour:       safeStr(p.colour || "#00b8db"),
      status:       safeStr(p.resource_status),
      winProb:      parseFloat(String(p.win_probability ?? 50)),
      startDate:    p.start_date  ? safeStr(p.start_date)  : null,
      endDate:      p.finish_date ? safeStr(p.finish_date) : null,
      milestones:   milestonesByProject.get(projId) ?? [],
      dependencies: depsByProject.get(projId)         ?? [],
      people,
    };
  });

  // Capacity overlay: per-week total alloc vs total cap
  const allWeeks    = weeksInRange(ago8wks, in26wks);
  const totalCapPW  = allWeeks.length * capMap.size > 0
    ? Array.from(capMap.values()).reduce((s, c) => s + c, 0)
    : 0;

  const weekAllocTotals = new Map<string, number>();
  for (const a of allocRes.data ?? []) {
    const w = safeStr(a.week_start_date);
    weekAllocTotals.set(w, (weekAllocTotals.get(w) ?? 0) + parseFloat(String(a.days_allocated)));
  }

  const capacityOverlay: CapacityPoint[] = allWeeks.map(w => {
    const alloc = weekAllocTotals.get(w) ?? 0;
    const pct   = totalCapPW > 0 ? Math.round((alloc / totalCapPW) * 100) : 0;
    return { weekStart: w, totalCap: totalCapPW, totalAlloc: Math.round(alloc * 10) / 10, utilPct: pct };
  });

  return {
    projects,
    capacityOverlay,
    dateRange: { from: ago8wks, to: in26wks },
    today,
  };
}

export type TimelineBundle = Awaited<ReturnType<typeof fetchTimelineData>>;
