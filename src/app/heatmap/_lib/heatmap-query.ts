import "server-only";
import { createClient } from "@/utils/supabase/server";

/* =============================================================================
    TYPES
============================================================================= */

export type Granularity = "weekly" | "sprint" | "monthly" | "quarterly";

export type PeriodHeader = {
  key:        string;   // ISO date of period start
  label:      string;   // "3 Mar", "Mar 2025", "Q1 2025"
  subLabel?:  string;   // "W9" for weekly, "S4" for sprint
  startDate:  string;
  endDate:    string;
  isCurrentPeriod: boolean;
};

export type AllocationCell = {
  periodKey:      string;
  daysAllocated:  number;
  capacityDays:   number;
  utilisationPct: number;
  allocationIds:  string[];
};

export type ProjectRow = {
  projectId:    string;
  projectTitle: string;
  projectCode:  string | null;
  colour:        string;
  roleOnProject: string | null;
  cells:        AllocationCell[];
  totalDays:    number;
};

export type PersonRow = {
  personId:      string;
  fullName:      string;
  jobTitle:      string | null;
  department:    string | null;
  employmentType: string;
  defaultCapacityDays: number;
  avgUtilisationPct:   number;
  peakUtilisationPct:  number;
  projects:            ProjectRow[];
  summaryCells:        AllocationCell[]; 
};

export type PipelineGapRow = {
  projectId:    string;
  projectTitle: string;
  projectCode:  string | null;
  colour:        string;
  winProbability: number;
  cells: {
    periodKey:        string;
    demandDays:       number;
    availableDays:    number;
    gapDays:          number;
    weightedDemand:   number;
  }[];
};

export type HeatmapData = {
  periods:        PeriodHeader[];
  people:          PersonRow[];
  pipelineGaps:    PipelineGapRow[];
  fetchedAt:       string;
  granularity:     Granularity;
  dateFrom:        string;
  dateTo:          string;
};

export type HeatmapFilters = {
  granularity:     Granularity;
  dateFrom:        string;
  dateTo:          string;
  departments:     string[];
  statuses:        string[];  // "confirmed" | "pipeline" | "all"
  personIds:       string[];
  organisationId:  string;
};

/* =============================================================================
    DATE UTILITIES
============================================================================= */

function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toIso(d: Date): string {
  return d.toISOString().split("T")[0];
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function getQuarterStart(d: Date): Date {
  const month = d.getMonth();
  const qMonth = Math.floor(month / 3) * 3;
  return new Date(d.getFullYear(), qMonth, 1);
}

function getMonthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function formatDate(iso: string, fmt: "short" | "month" | "quarter"): string {
  const d = new Date(iso + "T00:00:00");
  if (fmt === "short") {
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }
  if (fmt === "month") {
    return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  }
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} ${d.getFullYear()}`;
}

function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/* =============================================================================
    PERIOD GENERATION
============================================================================= */

export function generatePeriods(
  dateFrom: string,
  dateTo: string,
  granularity: Granularity
): PeriodHeader[] {
  const today = new Date();
  const periods: PeriodHeader[] = [];
  let current: Date;
  const end = new Date(dateTo + "T00:00:00");

  if (granularity === "weekly") {
    current = getMondayOf(new Date(dateFrom + "T00:00:00"));
    while (current <= end) {
      const periodEnd = addDays(current, 6);
      const key = toIso(current);
      const wn = isoWeekNumber(current);
      periods.push({
        key,
        label:     formatDate(key, "short"),
        subLabel: `W${wn}`,
        startDate: key,
        endDate:   toIso(periodEnd),
        isCurrentPeriod: today >= current && today <= periodEnd,
      });
      current = addDays(current, 7);
    }
    return periods;
  }

  if (granularity === "sprint") {
    current = getMondayOf(new Date(dateFrom + "T00:00:00"));
    let sprintNum = 1;
    while (current <= end) {
      const periodEnd = addDays(current, 13);
      const key = toIso(current);
      periods.push({
        key,
        label:     formatDate(key, "short"),
        subLabel: `S${sprintNum}`,
        startDate: key,
        endDate:   toIso(periodEnd),
        isCurrentPeriod: today >= current && today <= periodEnd,
      });
      current = addDays(current, 14);
      sprintNum++;
    }
    return periods;
  }

  if (granularity === "monthly") {
    current = getMonthStart(new Date(dateFrom + "T00:00:00"));
    while (current <= end) {
      const periodEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
      const key = toIso(current);
      periods.push({
        key,
        label:     formatDate(key, "month"),
        startDate: key,
        endDate:   toIso(periodEnd),
        isCurrentPeriod:
          today.getMonth() === current.getMonth() &&
          today.getFullYear() === current.getFullYear(),
      });
      current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
    }
    return periods;
  }

  current = getQuarterStart(new Date(dateFrom + "T00:00:00"));
  while (current <= end) {
    const periodEnd = new Date(current.getFullYear(), current.getMonth() + 3, 0);
    const key = toIso(current);
    periods.push({
      key,
      label:     formatDate(key, "quarter"),
      startDate: key,
      endDate:   toIso(periodEnd),
      isCurrentPeriod: today >= current && today <= periodEnd,
    });
    current = new Date(current.getFullYear(), current.getMonth() + 3, 1);
  }
  return periods;
}

/* =============================================================================
    AGGREGATE WEEK ROWS INTO PERIODS
============================================================================= */

function aggregateIntoPeriods(
  weeklyRows: Map<string, { days: number; capacity: number; ids: string[] }>,
  periods: PeriodHeader[]
): AllocationCell[] {
  return periods.map(period => {
    let totalDays     = 0;
    let totalCapacity = 0;
    const allIds: string[] = [];

    for (const [weekKey, row] of weeklyRows) {
      if (weekKey >= period.startDate && weekKey <= period.endDate) {
        totalDays     += row.days;
        totalCapacity += row.capacity;
        allIds.push(...row.ids);
      }
    }

    const pct = totalCapacity > 0
      ? Math.round((totalDays / totalCapacity) * 100)
      : 0;

    return {
      periodKey:      period.key,
      daysAllocated:  Math.round(totalDays * 10) / 10,
      capacityDays:   Math.round(totalCapacity * 10) / 10,
      utilisationPct: pct,
      allocationIds:  allIds,
    };
  });
}

/* =============================================================================
    MAIN QUERY + TRANSFORM
============================================================================= */

export async function fetchHeatmapData(
  filters: HeatmapFilters
): Promise<HeatmapData> {
  const supabase = await createClient();
  const { granularity, dateFrom, dateTo, departments, statuses, personIds, organisationId } = filters;

  const periods = generatePeriods(dateFrom, dateTo, granularity);
  const weeklyPeriods = generatePeriods(dateFrom, dateTo, "weekly");

  let peopleQuery = supabase
    .from("organisation_members")
    .select(`
      user_id,
      profiles:profiles!organisation_members_user_id_fkey (
        user_id, full_name, job_title, department,
        employment_type, default_capacity_days, is_active
      )
    `)
    .eq("organisation_id", organisationId)
    .is("removed_at", null);

  const { data: memberRows } = await peopleQuery;

  let allPeople = (memberRows ?? [])
    .map((r: any) => {
      const p = r.profiles;
      if (!p || p.is_active === false) return null;
      return {
        personId:            String(p.user_id || r.user_id),
        fullName:            String(p.full_name || "Unknown"),
        jobTitle:            p.job_title   ? String(p.job_title)   : null,
        department:          p.department  ? String(p.department)  : null,
        employmentType:      String(p.employment_type || "full_time"),
        defaultCapacityDays: parseFloat(String(p.default_capacity_days ?? 5)),
      };
    })
    .filter(Boolean) as any[];

  if (departments.length > 0) {
    allPeople = allPeople.filter(p => p.department && departments.includes(p.department));
  }

  if (personIds.length > 0) {
    allPeople = allPeople.filter(p => personIds.includes(p.personId));
  }

  const allPersonIds = allPeople.map(p => p.personId);
  if (!allPersonIds.length) {
    return {
      periods, people: [], pipelineGaps: [],
      fetchedAt: new Date().toISOString(),
      granularity, dateFrom, dateTo,
    };
  }

  const { data: exceptionRows } = await supabase
    .from("capacity_exceptions")
    .select("person_id, week_start_date, available_days")
    .in("person_id", allPersonIds)
    .gte("week_start_date", dateFrom)
    .lte("week_start_date", dateTo);

  const exceptionMap = new Map<string, Map<string, number>>();
  for (const ex of exceptionRows ?? []) {
    const pid = String(ex.person_id);
    if (!exceptionMap.has(pid)) exceptionMap.set(pid, new Map());
    exceptionMap.get(pid)!.set(String(ex.week_start_date), parseFloat(String(ex.available_days)));
  }

  let allocQuery = supabase
    .from("allocations")
    .select(`
      id, person_id, project_id, week_start_date,
      days_allocated, allocation_type, role_on_project,
      projects:projects!allocations_project_id_fkey (
        id, title, project_code, colour, resource_status, win_probability
      )
    `)
    .in("person_id", allPersonIds)
    .gte("week_start_date", dateFrom)
    .lte("week_start_date", dateTo)
    .is("projects.deleted_at", null);

  const showPipeline = statuses.length === 0 || statuses.includes("pipeline");
  const showConfirmed = statuses.length === 0 || statuses.includes("confirmed");
  if (!showPipeline) allocQuery = allocQuery.neq("projects.resource_status", "pipeline");
  if (!showConfirmed) allocQuery = allocQuery.neq("projects.resource_status", "confirmed");

  const { data: allocRows } = await allocQuery;

  type WeekData = { days: number; capacity: number; ids: string[] };
  const personProjectWeeks = new Map<string, Map<string, { project: any; weeks: Map<string, WeekData> }>>();

  for (const alloc of allocRows ?? []) {
    const pid     = String(alloc.person_id);
    const projId  = String(alloc.project_id);
    const week    = String(alloc.week_start_date);
    const days    = parseFloat(String(alloc.days_allocated));
    const proj    = (alloc as any).projects;
    if (!proj) continue;

    if (!personProjectWeeks.has(pid)) personProjectWeeks.set(pid, new Map());
    const byProject = personProjectWeeks.get(pid)!;

    if (!byProject.has(projId)) byProject.set(projId, { project: proj, weeks: new Map() });
    const entry = byProject.get(projId)!;

    const personData  = allPeople.find(p => p.personId === pid);
    const defaultCap  = personData?.defaultCapacityDays ?? 5;
    const exCap       = exceptionMap.get(pid)?.get(week);
    const capacity    = exCap !== undefined ? exCap : defaultCap;

    if (!entry.weeks.has(week)) {
      entry.weeks.set(week, { days: 0, capacity, ids: [] });
    }
    const wd = entry.weeks.get(week)!;
    wd.days += days;
    wd.ids.push(String(alloc.id));
  }

  const personWeekCapacity = new Map<string, Map<string, number>>();
  for (const person of allPeople) {
    const capMap = new Map<string, number>();
    for (const wp of weeklyPeriods) {
      const exCap = exceptionMap.get(person.personId)?.get(wp.key);
      capMap.set(wp.key, exCap !== undefined ? exCap : person.defaultCapacityDays);
    }
    personWeekCapacity.set(person.personId, capMap);
  }

  const people: PersonRow[] = allPeople.map(person => {
    const byProject = personProjectWeeks.get(person.personId) ?? new Map();
    const projectRows: ProjectRow[] = [];

    for (const [projId, entry] of byProject) {
      const proj = entry.project;
      const cells = aggregateIntoPeriods(entry.weeks, periods);
      const totalDays = cells.reduce((s, c) => s + c.daysAllocated, 0);

      projectRows.push({
        projectId: projId,
        projectTitle: String(proj.title || ""),
        projectCode: proj.project_code ? String(proj.project_code) : null,
        colour: String(proj.colour || "#00b8db"),
        roleOnProject: null,
        cells,
        totalDays: Math.round(totalDays * 10) / 10,
      });
    }

    projectRows.sort((a, b) => b.totalDays - a.totalDays);

    const summaryWeekly = new Map<string, WeekData>();
    const capMap = personWeekCapacity.get(person.personId)!;

    for (const wp of weeklyPeriods) {
      let totalAllocated = 0;
      const ids: string[] = [];
      for (const [, entry] of byProject) {
        const wd = entry.weeks.get(wp.key);
        if (wd) { totalAllocated += wd.days; ids.push(...wd.ids); }
      }
      const capacity = capMap.get(wp.key) ?? person.defaultCapacityDays;
      summaryWeekly.set(wp.key, { days: totalAllocated, capacity, ids });
    }

    const summaryCells = aggregateIntoPeriods(summaryWeekly, periods);
    const utilPcts = summaryCells.map(c => c.utilisationPct).filter(p => p > 0);
    const avgUtil  = utilPcts.length ? Math.round(utilPcts.reduce((s, p) => s + p, 0) / utilPcts.length) : 0;
    const peakUtil = utilPcts.length ? Math.max(...utilPcts) : 0;

    return {
      personId: person.personId,
      fullName: person.fullName,
      jobTitle: person.jobTitle,
      department: person.department,
      employmentType: person.employmentType,
      defaultCapacityDays: person.defaultCapacityDays,
      avgUtilisationPct: avgUtil,
      peakUtilisationPct: peakUtil,
      projects: projectRows,
      summaryCells,
    };
  });

  const { data: pipelineProjects } = await supabase
    .from("projects")
    .select(`
      id, title, project_code, colour, win_probability, start_date, finish_date,
      role_requirements (
        id, role_title, seniority_level,
        required_days_per_week, start_date, end_date
      )
    `)
    .eq("organisation_id", organisationId)
    .eq("resource_status", "pipeline")
    .is("deleted_at", null)
    .gte("finish_date", dateFrom)
    .lte("start_date", dateTo);

  const pipelineGaps: PipelineGapRow[] = (pipelineProjects ?? []).map((proj: any) => {
    const winProb = (proj.win_probability ?? 50) / 100;
    const roles   = (proj.role_requirements ?? []) as any[];

    const cells = periods.map(period => {
      let demandDays = 0;
      for (const role of roles) {
        const roleStart = role.start_date || proj.start_date;
        const roleEnd   = role.end_date   || proj.finish_date;
        if (roleStart > period.endDate || roleEnd < period.startDate) continue;

        let weekCursor = getMondayOf(new Date(Math.max(new Date(roleStart + "T00:00:00").getTime(), new Date(period.startDate + "T00:00:00").getTime())));
        const periodEndDate = new Date(period.endDate + "T00:00:00");
        const roleEndDate   = new Date(roleEnd + "T00:00:00");
        const effectiveEnd  = roleEndDate < periodEndDate ? roleEndDate : periodEndDate;

        while (weekCursor <= effectiveEnd) {
          demandDays += parseFloat(String(role.required_days_per_week));
          weekCursor = addDays(weekCursor, 7);
        }
      }

      let availableDays = 0;
      for (const p of people) {
        const cell = p.summaryCells.find(c => c.periodKey === period.key);
        availableDays += cell ? Math.max(0, cell.capacityDays - cell.daysAllocated) : 0;
      }

      return {
        periodKey:      period.key,
        demandDays:     Math.round(demandDays * 10) / 10,
        availableDays:  Math.round(availableDays * 10) / 10,
        gapDays:        Math.max(0, demandDays - availableDays),
        weightedDemand: Math.round(demandDays * winProb * 10) / 10,
      };
    });

    return {
      projectId: String(proj.id),
      projectTitle: String(proj.title),
      projectCode: proj.project_code ? String(proj.project_code) : null,
      colour: String(proj.colour || "#7c3aed"),
      winProbability: proj.win_probability ?? 50,
      cells,
    };
  });

  return { periods, people, pipelineGaps, fetchedAt: new Date().toISOString(), granularity, dateFrom, dateTo };
}

export async function fetchHeatmapFilterOptions(organisationId: string) {
  const supabase = await createClient();
  const { data: memberRows } = await supabase
    .from("organisation_members")
    .select(`profiles:profiles!organisation_members_user_id_fkey (
      user_id, full_name, department, is_active
    )`)
    .eq("organisation_id", organisationId)
    .is("removed_at", null);

  const people = (memberRows ?? [])
    .map((r: any) => r.profiles)
    .filter((p: any) => p && p.is_active !== false)
    .map((p: any) => ({
      id: String(p.user_id),
      name: String(p.full_name || "Unknown"),
      department: p.department ? String(p.department) : null,
    }));

  const departments = Array.from(new Set(people.map((p: any) => p.department).filter(Boolean))).sort() as string[];
  return { people, departments };
}
