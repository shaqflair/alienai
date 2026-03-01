import "server-only";
import { createClient } from "@/utils/supabase/server";

/* =============================================================================
   TYPES
============================================================================= */

export type ProjectResourceData = {
  project: {
    id:               string;
    title:            string;
    project_code:      string | null;
    colour:            string;
    start_date:        string | null;
    finish_date:       string | null;
    budget_days:       number | null;
    budget_amount:     number | null;
    resource_status:  string;
    win_probability:  number;
    department:        string | null;
  };
  teamMembers: TeamMember[];
  allocations: AllocationRow[];
  roleRequirements: RoleRequirement[];
  budgetSummary: BudgetSummary;
};

export type TeamMember = {
  personId:             string;
  fullName:             string;
  jobTitle:             string | null;
  department:           string | null;
  employmentType:       string;
  defaultCapacityDays: number;
  totalDaysAllocated:  number;
  avgUtilisationPct:   number;
  roleOnProject:       string | null;
  allocationType:      string;
  weekCount:           number;
};

export type AllocationRow = {
  id:               string;
  personId:         string;
  fullName:         string;
  weekStartDate:    string;
  daysAllocated:    number;
  capacityDays:     number;
  utilisationPct:   number;
  allocationType:   string;
  roleOnProject:   string | null;
};

export type RoleRequirement = {
  id:                    string;
  roleTitle:             string;
  seniorityLevel:        string;
  requiredDaysPerWeek:  number;
  startDate:             string;
  endDate:               string;
  filledByPersonId:      string | null;
  filledByName:          string | null;
  notes:                 string | null;
  totalDemandDays:       number;
  isFilled:              boolean;
};

export type BudgetSummary = {
  budgetDays:       number | null;
  budgetAmount:      number | null;
  allocatedDays:     number;
  remainingDays:     number | null;
  utilisationPct:    number | null;
  projectedCost:     number | null;
  weeklyBurnRate:    number;
};

export type WeekPeriod = {
  key:   string;
  label: string;
};

/* =============================================================================
   HELPERS
============================================================================= */

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function weeksInRange(start: string, end: string): number {
  if (!start || !end) return 0;
  const s = new Date(start + "T00:00:00");
  const e = new Date(end   + "T00:00:00");
  return Math.max(0, Math.ceil((e.getTime() - s.getTime()) / (7 * 24 * 60 * 60 * 1000)));
}

function getMondayOf(date: Date): Date {
  const d   = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function toIso(d: Date): string {
  return d.toISOString().split("T")[0];
}

export function projectWeekPeriods(
  startDate: string | null,
  finishDate: string | null
): WeekPeriod[] {
  if (!startDate) return [];
  const start  = getMondayOf(new Date(startDate  + "T00:00:00"));
  const end    = finishDate
    ? new Date(finishDate + "T00:00:00")
    : new Date(start.getTime() + 26 * 7 * 24 * 60 * 60 * 1000);

  const periods: WeekPeriod[] = [];
  let cur = new Date(start);

  while (cur <= end && periods.length < 52) {
    const iso = toIso(cur);
    periods.push({
      key:   iso,
      label: cur.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    });
    cur.setDate(cur.getDate() + 7);
  }
  return periods;
}

/* =============================================================================
   MAIN FETCH
============================================================================= */

export async function fetchProjectResourceData(
  projectId: string
): Promise<ProjectResourceData> {
  const supabase = await createClient();

  const { data: proj, error: projErr } = await supabase
    .from("projects")
    .select(`
      id, title, project_code, colour, start_date, finish_date,
      budget_days, budget_amount, resource_status, win_probability, department
    `)
    .eq("id", projectId)
    .single();

  if (projErr || !proj) throw projErr ?? new Error("Project not found");

  const { data: allocRows, error: allocErr } = await supabase
    .from("allocations")
    .select(`
      id, person_id, week_start_date, days_allocated,
      allocation_type, role_on_project,
      profiles:profiles!allocations_person_id_fkey (
        user_id, full_name, job_title, department,
        employment_type, default_capacity_days
      )
    `)
    .eq("project_id", projectId)
    .order("week_start_date", { ascending: true });

  if (allocErr) throw allocErr;

  const personIds = Array.from(
    new Set((allocRows ?? []).map((r: any) => String(r.person_id)))
  );

  let exceptionMap = new Map<string, Map<string, number>>();
  if (personIds.length) {
    const { data: exRows } = await supabase
      .from("capacity_exceptions")
      .select("person_id, week_start_date, available_days")
      .in("person_id", personIds)
      .gte("week_start_date", proj.start_date ?? "2020-01-01")
      .lte("week_start_date", proj.finish_date ?? "2099-12-31");

    for (const ex of exRows ?? []) {
      const pid = String(ex.person_id);
      if (!exceptionMap.has(pid)) exceptionMap.set(pid, new Map());
      exceptionMap.get(pid)!.set(
        String(ex.week_start_date),
        parseFloat(String(ex.available_days))
      );
    }
  }

  const { data: roleRows, error: roleErr } = await supabase
    .from("role_requirements")
    .select(`
      id, role_title, seniority_level, required_days_per_week,
      start_date, end_date, filled_by_person_id, notes,
      filled_by:profiles!role_requirements_filled_by_person_id_fkey (
        full_name
      )
    `)
    .eq("project_id", projectId)
    .order("start_date", { ascending: true });

  if (roleErr) {
    console.warn("[resource-data] role_requirements query failed:", roleErr.message);
  }

  const allocationRows: AllocationRow[] = (allocRows ?? []).map((r: any) => {
    const profile    = r.profiles;
    const pid        = String(r.person_id);
    const week       = String(r.week_start_date);
    const days       = parseFloat(String(r.days_allocated));
    const defaultCap = parseFloat(String(profile?.default_capacity_days ?? 5));
    const exCap      = exceptionMap.get(pid)?.get(week);
    const capacity   = exCap !== undefined ? exCap : defaultCap;
    const util       = capacity > 0 ? Math.round((days / capacity) * 100) : 0;

    return {
      id:               String(r.id),
      personId:        pid,
      fullName:        safeStr(profile?.full_name || "Unknown"),
      weekStartDate:  week,
      daysAllocated:  days,
      capacityDays:   capacity,
      utilisationPct: util,
      allocationType: safeStr(r.allocation_type || "confirmed"),
      roleOnProject:  r.role_on_project ? safeStr(r.role_on_project) : null,
    };
  });

  const personMap = new Map<string, { profile: any; rows: AllocationRow[] }>();
  for (const row of allocationRows) {
    if (!personMap.has(row.personId)) {
      const raw = (allocRows ?? []).find((r: any) => String(r.person_id) === row.personId);
      personMap.set(row.personId, { profile: raw?.profiles, rows: [] });
    }
    personMap.get(row.personId)!.rows.push(row);
  }

  const teamMembers: TeamMember[] = Array.from(personMap.entries()).map(([pid, entry]) => {
    const p            = entry.profile;
    const rows         = entry.rows;
    const totalDays    = rows.reduce((s, r) => s + r.daysAllocated, 0);
    const utils        = rows.map(r => r.utilisationPct).filter(u => u > 0);
    const avgUtil      = utils.length
      ? Math.round(utils.reduce((s, u) => s + u, 0) / utils.length)
      : 0;
    const roleOnProj   = rows.find(r => r.roleOnProject)?.roleOnProject ?? null;
    const allocType    = rows[0]?.allocationType ?? "confirmed";

    return {
      personId:            pid,
      fullName:            safeStr(p?.full_name || "Unknown"),
      jobTitle:            p?.job_title ? safeStr(p.job_title) : null,
      department:          p?.department ? safeStr(p.department) : null,
      employmentType:      safeStr(p?.employment_type || "full_time"),
      defaultCapacityDays: parseFloat(String(p?.default_capacity_days ?? 5)),
      totalDaysAllocated:  Math.round(totalDays * 10) / 10,
      avgUtilisationPct:   avgUtil,
      roleOnProject:       roleOnProj,
      allocationType:      allocType,
      weekCount:           new Set(rows.map(r => r.weekStartDate)).size,
    };
  });

  teamMembers.sort((a, b) => b.totalDaysAllocated - a.totalDaysAllocated);

  const roleRequirements: RoleRequirement[] = (roleRows ?? []).map((r: any) => {
    const wks  = weeksInRange(
      safeStr(r.start_date  || proj.start_date),
      safeStr(r.end_date    || proj.finish_date)
    );
    const totalDemand = parseFloat(String(r.required_days_per_week)) * wks;

    return {
      id:                  String(r.id),
      roleTitle:           safeStr(r.role_title),
      seniorityLevel:      safeStr(r.seniority_level || "Senior"),
      requiredDaysPerWeek: parseFloat(String(r.required_days_per_week)),
      startDate:           safeStr(r.start_date || proj.start_date),
      endDate:             safeStr(r.end_date   || proj.finish_date),
      filledByPersonId:    r.filled_by_person_id ? String(r.filled_by_person_id) : null,
      filledByName:        (r.filled_by as any)?.full_name ? safeStr((r.filled_by as any).full_name) : null,
      notes:               r.notes ? safeStr(r.notes) : null,
      totalDemandDays:     Math.round(totalDemand * 10) / 10,
      isFilled:            !!r.filled_by_person_id,
    };
  });

  const allocatedDays   = teamMembers.reduce((s, m) => s + m.totalDaysAllocated, 0);
  const budgetDays      = proj.budget_days   ? parseFloat(String(proj.budget_days))   : null;
  const budgetAmount    = proj.budget_amount ? parseFloat(String(proj.budget_amount)) : null;
  const remainingDays   = budgetDays != null ? budgetDays - allocatedDays : null;
  const utilisationPct  = budgetDays != null && budgetDays > 0
    ? Math.round((allocatedDays / budgetDays) * 100)
    : null;

  const avgRatePerDay   = 650;
  const projectedCost   = budgetAmount != null ? allocatedDays * avgRatePerDay : null;
  const projectWeeks    = weeksInRange(safeStr(proj.start_date), safeStr(proj.finish_date)) || 1;
  const weeklyBurnRate  = Math.round((allocatedDays / projectWeeks) * 10) / 10;

  return {
    project: {
      id:               String(proj.id),
      title:            safeStr(proj.title),
      project_code:     proj.project_code ? safeStr(proj.project_code) : null,
      colour:           safeStr(proj.colour || "#00b8db"),
      start_date:       proj.start_date   ? safeStr(proj.start_date)   : null,
      finish_date:      proj.finish_date  ? safeStr(proj.finish_date)  : null,
      budget_days:      budgetDays,
      budget_amount:    budgetAmount,
      resource_status:  safeStr(proj.resource_status || "confirmed"),
      win_probability:  parseFloat(String(proj.win_probability ?? 100)),
      department:       proj.department ? safeStr(proj.department) : null,
    },
    teamMembers,
    allocations:       allocationRows,
    roleRequirements,
    budgetSummary: {
      budgetDays,
      budgetAmount,
      allocatedDays:   Math.round(allocatedDays * 10) / 10,
      remainingDays:   remainingDays != null ? Math.round(remainingDays * 10) / 10 : null,
      utilisationPct,
      projectedCost,
      weeklyBurnRate,
    },
  };
}
