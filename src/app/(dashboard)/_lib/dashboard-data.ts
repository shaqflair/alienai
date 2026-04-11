// FILE: src/app/(dashboard)/_lib/dashboard-data.ts
import "server-only";
import { createClient } from "@/utils/supabase/server";

/* =============================================================================
   TYPES
============================================================================= */

export type DashboardData = {
  fetchedAt: string;

  utilisation: {
    avgPct:           number;
    peakPct:          number;
    overAllocCount:   number;
    underutilCount:   number;
    totalPeople:      number;
    totalAllocDays:   number;
    totalCapDays:     number;
    byPerson: Array<{
      personId:  string;
      fullName:  string;
      dept:      string | null;
      utilPct:   number;
      allocDays: number;
      capDays:   number;
    }>;
  };

  thisWeek: {
    weekStart:    string;
    leaveCount:   number;
    fullDayOffs:  number;
    capacityLost: number;
    leavePeople: Array<{
      personId:      string;
      fullName:      string;
      availableDays: number;
      defaultCap:    number;
      reason:        string;
    }>;
    freeCapacity:  number;
    totalCapacity: number;
  };

  pipeline: Array<{
    projectId:      string;
    title:          string;
    projectCode:    string | null;
    colour:         string;
    winProbability: number;
    startDate:      string | null;
    unfilledRoles:  number;
    totalRoles:     number;
    unfilledDays:   number;
  }>;

  recentActivity: Array<{
    id:            string;
    personName:    string;
    projectTitle:  string;
    projectCode:   string | null;
    colour:        string;
    daysAllocated: number;
    weekStart:     string;
    allocType:     string;
    createdAt:     string;
  }>;

  budgetBurn: Array<{
    projectId:     string;
    title:         string;
    projectCode:   string | null;
    colour:        string;
    budgetDays:    number | null;
    allocatedDays: number;
    burnPct:       number | null;
    weeklyRate:    number;
    status:        string;
  }>;

  headcount: Array<{
    department:  string;
    total:       number;
    active:      number;
    contractors: number;
    avgUtil:     number;
  }>;
};

/* =============================================================================
   HELPERS
============================================================================= */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function getMondayOf(date: Date): string {
  const d   = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split("T")[0];
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

function weeksInRange(start: string, end: string): number {
  if (!start || !end) return 0;
  const ms = new Date(end + "T00:00:00").getTime() - new Date(start + "T00:00:00").getTime();
  return Math.max(1, Math.ceil(ms / (7 * 86400000)));
}

/** Parse financial plan content from either content_json (new) or content (legacy camelCase) */
function parsePlanContent(artifact: any): any | null {
  if (!artifact) return null;
  // Prefer content_json (new snake_case schema)
  if (artifact.content_json && typeof artifact.content_json === "object") return artifact.content_json;
  // Fall back to content column — may be object or JSON string
  const raw = artifact.content;
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try { return JSON.parse(String(raw)); } catch { return null; }
}

/** Sum resources[].planned_days from a plan content object.
 *  Handles both snake_case (new) and camelCase (legacy) resource field names. */
function sumPlannedDays(plan: any): number {
  const resources = Array.isArray(plan?.resources) ? plan.resources : [];
  return resources.reduce((sum: number, r: any) => {
    const d = Number(r?.planned_days ?? r?.plannedDays);
    return sum + (Number.isFinite(d) && d > 0 ? d : 0);
  }, 0);
}

/* =============================================================================
   MAIN FETCH
============================================================================= */

export async function fetchDashboardData(organisationId: string): Promise<DashboardData> {
  const supabase = await createClient();

  const now       = new Date();
  const thisWeek  = getMondayOf(now);
  const nextWeek  = addDays(thisWeek, 7);
  const eightWksAgo = addDays(thisWeek, -56);
  const sixMoAhead  = addDays(thisWeek, 182);

  // -- Parallel fetches -------------------------------------------------------
  const [
    memberRes,
    allocRes,
    exceptionRes,
    projectRes,
    roleRes,
    recentAllocRes,
    artRes,           // ← financial plan artifacts for budget_days fallback
  ] = await Promise.all([

    // 1. All active org members + profiles
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

    // 2. Allocations for last 8 weeks (utilisation + budget burn)
    supabase
      .from("allocations")
      .select(`
        person_id, project_id, week_start_date, days_allocated,
        allocation_type, created_at,
        projects:projects!allocations_project_id_fkey (
          id, title, project_code, colour, budget_days,
          resource_status, start_date, finish_date
        )
      `)
      .gte("week_start_date", eightWksAgo)
      .lte("week_start_date", sixMoAhead)
      .is("projects.deleted_at", null),

    // 3. This week's capacity exceptions
    supabase
      .from("capacity_exceptions")
      .select(`
        person_id, available_days, reason,
        profiles:profiles!capacity_exceptions_person_id_fkey (
          full_name, default_capacity_days
        )
      `)
      .eq("week_start_date", thisWeek),

    // 4. Active + pipeline projects
    supabase
      .from("projects")
      .select(`
        id, title, project_code, colour, win_probability,
        resource_status, start_date, finish_date, budget_days
      `)
      .eq("organisation_id", organisationId)
      .in("resource_status", ["confirmed", "pipeline"])
      .is("deleted_at", null),

    // 5. Role requirements for pipeline gap analysis
    supabase
      .from("role_requirements")
      .select(`
        id, project_id, role_title, required_days_per_week,
        start_date, end_date, filled_by_person_id
      `)
      .is("filled_by_person_id", null),   // only unfilled

    // 6. Recent allocation activity (last 20)
    supabase
      .from("allocations")
      .select(`
        id, person_id, week_start_date, days_allocated,
        allocation_type, created_at,
        profiles:profiles!allocations_person_id_fkey ( full_name ),
        projects:projects!allocations_project_id_fkey (
          title, project_code, colour
        )
      `)
      .order("created_at", { ascending: false })
      .limit(20),

    // 7. Latest financial plan artifact per project (budget_days fallback)
    //    Reads both content_json (new) and content (legacy) to handle pre-migration data.
    supabase
      .from("artifacts")
      .select("project_id, content_json, content")
      .eq("organisation_id", organisationId)
      .eq("type", "financial_plan")
      .order("updated_at", { ascending: false })
      .limit(500),
  ]);

  // -- Build financial plan budget_days fallback map -------------------------
  // Keep only the FIRST (most recent) artifact per project.
  const fpBudgetDaysByProject = new Map<string, number>();
  for (const art of artRes.data ?? []) {
    const pid = String((art as any)?.project_id || "").trim();
    if (!pid || fpBudgetDaysByProject.has(pid)) continue;
    const plan = parsePlanContent(art);
    if (!plan) continue;
    const days = sumPlannedDays(plan);
    if (days > 0) fpBudgetDaysByProject.set(pid, days);
  }

  // -- Build people map ------------------------------------------------------
  type PersonMeta = {
    personId:   string;
    fullName:   string;
    dept:       string | null;
    empType:    string;
    defaultCap: number;
    isActive:   boolean;
  };

  const peopleMap = new Map<string, PersonMeta>();
  for (const m of memberRes.data ?? []) {
    const p = (m as any).profiles;
    if (!p || p.is_active === false) continue;
    peopleMap.set(String(p.user_id || m.user_id), {
      personId:   String(p.user_id || m.user_id),
      fullName:   safeStr(p.full_name || "Unknown"),
      dept:       p.department ? safeStr(p.department) : null,
      empType:    safeStr(p.employment_type || "full_time"),
      defaultCap: parseFloat(String(p.default_capacity_days ?? 5)),
      isActive:   true,
    });
  }

  // -- 1. Utilisation (last 4 weeks) -----------------------------------------
  const fourWksAgo = addDays(thisWeek, -28);
  const recentAllocs = (allocRes.data ?? []).filter((a: any) =>
    a.week_start_date >= fourWksAgo && a.week_start_date < thisWeek
  );

  const utilByPerson = new Map<string, { alloc: number; cap: number }>();
  for (const a of recentAllocs) {
    const pid  = String(a.person_id);
    const days = parseFloat(String(a.days_allocated));
    const meta = peopleMap.get(pid);
    if (!meta) continue;
    if (!utilByPerson.has(pid)) utilByPerson.set(pid, { alloc: 0, cap: meta.defaultCap * 4 });
    utilByPerson.get(pid)!.alloc += days;
  }

  const utilRows = Array.from(utilByPerson.entries()).map(([pid, { alloc, cap }]) => {
    const meta = peopleMap.get(pid)!;
    return {
      personId:  pid,
      fullName:  meta.fullName,
      dept:      meta.dept,
      utilPct:   cap > 0 ? Math.round((alloc / cap) * 100) : 0,
      allocDays: Math.round(alloc * 10) / 10,
      capDays:   Math.round(cap * 10) / 10,
    };
  }).sort((a, b) => b.utilPct - a.utilPct);

  const utils = utilRows.map(r => r.utilPct);
  const avgPct  = utils.length ? Math.round(utils.reduce((s, u) => s + u, 0) / utils.length) : 0;
  const peakPct = utils.length ? Math.max(...utils) : 0;

  // -- 2. This week's leave --------------------------------------------------
  const leavePeople = (exceptionRes.data ?? []).map((e: any) => ({
    personId:      String(e.person_id),
    fullName:      safeStr((e.profiles as any)?.full_name || "Unknown"),
    availableDays: parseFloat(String(e.available_days)),
    defaultCap:    parseFloat(String((e.profiles as any)?.default_capacity_days ?? 5)),
    reason:        safeStr(e.reason || "annual_leave"),
  }));

  const capacityLost = leavePeople.reduce((s, p) => s + (p.defaultCap - p.availableDays), 0);
  const totalCap     = Array.from(peopleMap.values()).reduce((s, p) => s + p.defaultCap, 0);
  const thisWeekAlloc = (allocRes.data ?? [])
    .filter((a: any) => a.week_start_date === thisWeek)
    .reduce((s: number, a: any) => s + parseFloat(String(a.days_allocated)), 0);
  const freeCapacity = Math.max(0, (totalCap - capacityLost) - thisWeekAlloc);

  // -- 3. Pipeline at risk ---------------------------------------------------
  const pipelineProjects = (projectRes.data ?? []).filter((p: any) => p.resource_status === "pipeline");
  const unfilledByProject = new Map<string, { count: number; days: number }>();

  for (const role of roleRes.data ?? []) {
    const pid = String(role.project_id);
    if (!unfilledByProject.has(pid)) unfilledByProject.set(pid, { count: 0, days: 0 });
    const wks = weeksInRange(safeStr(role.start_date), safeStr(role.end_date));
    unfilledByProject.get(pid)!.count += 1;
    unfilledByProject.get(pid)!.days  += parseFloat(String(role.required_days_per_week)) * wks;
  }

  const { data: allRoles } = await supabase
    .from("role_requirements")
    .select("project_id")
    .in("project_id", pipelineProjects.map((p: any) => p.id));

  const totalRolesByProject = new Map<string, number>();
  for (const r of allRoles ?? []) {
    const pid = String(r.project_id);
    totalRolesByProject.set(pid, (totalRolesByProject.get(pid) ?? 0) + 1);
  }

  const pipeline = pipelineProjects
    .map((p: any) => {
      const unfilled = unfilledByProject.get(String(p.id));
      return {
        projectId:      String(p.id),
        title:          safeStr(p.title),
        projectCode:    p.project_code ? safeStr(p.project_code) : null,
        colour:         safeStr(p.colour || "#7c3aed"),
        winProbability: parseFloat(String(p.win_probability ?? 50)),
        startDate:      p.start_date ? safeStr(p.start_date) : null,
        unfilledRoles:  unfilled?.count ?? 0,
        totalRoles:     totalRolesByProject.get(String(p.id)) ?? 0,
        unfilledDays:   Math.round((unfilled?.days ?? 0) * 10) / 10,
      };
    })
    .filter(p => p.unfilledRoles > 0)
    .sort((a, b) => b.winProbability - a.winProbability)
    .slice(0, 6);

  // -- 4. Recent activity ----------------------------------------------------
  const recentActivity = (recentAllocRes.data ?? []).map((a: any) => ({
    id:            String(a.id),
    personName:    safeStr((a.profiles as any)?.full_name || "Unknown"),
    projectTitle:  safeStr((a.projects as any)?.title || "Unknown"),
    projectCode:   (a.projects as any)?.project_code
                     ? safeStr((a.projects as any).project_code) : null,
    colour:        safeStr((a.projects as any)?.colour || "#00b8db"),
    daysAllocated: parseFloat(String(a.days_allocated)),
    weekStart:     safeStr(a.week_start_date),
    allocType:     safeStr(a.allocation_type || "confirmed"),
    createdAt:     safeStr(a.created_at),
  }));

  // -- 5. Budget burn --------------------------------------------------------
  const confirmedProjects = (projectRes.data ?? []).filter((p: any) => p.resource_status === "confirmed");
  const allocByProject = new Map<string, number>();
  for (const a of allocRes.data ?? []) {
    const pid  = String((a as any).project_id);
    const days = parseFloat(String((a as any).days_allocated));
    allocByProject.set(pid, (allocByProject.get(pid) ?? 0) + days);
  }

  const budgetBurn = confirmedProjects
    .map((p: any) => {
      const pid       = String(p.id);
      const allocated = allocByProject.get(pid) ?? 0;

      // Prefer projects.budget_days; fall back to financial plan artifact
      const budget = p.budget_days
        ? parseFloat(String(p.budget_days))
        : fpBudgetDaysByProject.get(pid) ?? null;

      const wks = weeksInRange(safeStr(p.start_date), safeStr(p.finish_date)) || 1;
      return {
        projectId:     pid,
        title:         safeStr(p.title),
        projectCode:   p.project_code ? safeStr(p.project_code) : null,
        colour:        safeStr(p.colour || "#00b8db"),
        budgetDays:    budget,
        allocatedDays: Math.round(allocated * 10) / 10,
        burnPct:       budget ? Math.round((allocated / budget) * 100) : null,
        weeklyRate:    Math.round((allocated / wks) * 10) / 10,
        status:        safeStr(p.resource_status),
      };
    })
    .filter(p => p.allocatedDays > 0)
    .sort((a, b) => (b.burnPct ?? 0) - (a.burnPct ?? 0))
    .slice(0, 8);

  // -- 6. Headcount by department --------------------------------------------
  const deptMap = new Map<string, {
    total: number; active: number; contractors: number; utils: number[];
  }>();

  for (const [, person] of peopleMap) {
    const dept = person.dept || "Other";
    if (!deptMap.has(dept)) deptMap.set(dept, { total: 0, active: 0, contractors: 0, utils: [] });
    const entry = deptMap.get(dept)!;
    entry.total++;
    if (person.isActive) entry.active++;
    if (person.empType === "contractor") entry.contractors++;
    const util = utilByPerson.get(person.personId);
    if (util) entry.utils.push(util.cap > 0 ? Math.round((util.alloc / util.cap) * 100) : 0);
  }

  const headcount = Array.from(deptMap.entries())
    .map(([dept, d]) => ({
      department:  dept,
      total:       d.total,
      active:      d.active,
      contractors: d.contractors,
      avgUtil:     d.utils.length
        ? Math.round(d.utils.reduce((s, u) => s + u, 0) / d.utils.length)
        : 0,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    fetchedAt: new Date().toISOString(),
    utilisation: {
      avgPct,
      peakPct,
      overAllocCount: utilRows.filter(r => r.utilPct > 100).length,
      underutilCount: utilRows.filter(r => r.utilPct < 50 && r.utilPct > 0).length,
      totalPeople:    peopleMap.size,
      totalAllocDays: Math.round(utilRows.reduce((s, r) => s + r.allocDays, 0) * 10) / 10,
      totalCapDays:   Math.round(utilRows.reduce((s, r) => s + r.capDays, 0) * 10) / 10,
      byPerson:       utilRows.slice(0, 8),
    },
    thisWeek: {
      weekStart: thisWeek,
      leaveCount: leavePeople.length,
      fullDayOffs: leavePeople.filter(p => p.availableDays === 0).length,
      capacityLost: Math.round(capacityLost * 10) / 10,
      leavePeople,
      freeCapacity: Math.round(freeCapacity * 10) / 10,
      totalCapacity: Math.round(totalCap * 10) / 10,
    },
    pipeline,
    recentActivity,
    budgetBurn,
    headcount,
  };
}