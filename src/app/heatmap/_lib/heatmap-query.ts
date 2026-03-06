// FILE: src/app/heatmap/_lib/heatmap-query.ts
import "server-only";
import { createClient } from "@/utils/supabase/server";

export type Granularity = "weekly" | "sprint" | "monthly" | "quarterly";

export type PeriodHeader = {
  key:        string;
  label:      string;
  subLabel?:  string;
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
  hasException:   boolean;
};

export type ProjectRow = {
  projectId:     string;
  projectTitle:  string;
  projectCode:   string | null;
  colour:        string;
  roleOnProject: string | null;
  cells:         AllocationCell[];
  totalDays:     number;
};

export type PersonRow = {
  personId:            string;
  fullName:            string;
  jobTitle:            string | null;
  department:          string | null;
  employmentType:      string;
  defaultCapacityDays: number;
  avgUtilisationPct:   number;
  peakUtilisationPct:  number;
  projects:            ProjectRow[];
  summaryCells:        AllocationCell[];
};

export type PipelineGapRow = {
  projectId:      string;
  projectTitle:   string;
  projectCode:    string | null;
  colour:         string;
  winProbability: number;
  cells: {
    periodKey:      string;
    demandDays:     number;
    availableDays:  number;
    gapDays:        number;
    weightedDemand: number;
  }[];
};

export type HeatmapData = {
  periods:      PeriodHeader[];
  people:       PersonRow[];
  pipelineGaps: PipelineGapRow[];
  fetchedAt:    string;
  granularity:  Granularity;
  dateFrom:     string;
  dateTo:       string;
  exceptionCount: number; // debug: how many exception rows loaded
};

export type HeatmapFilters = {
  granularity:    Granularity;
  dateFrom:       string;
  dateTo:         string;
  departments:    string[];
  statuses:       string[];
  personIds:      string[];
  projectIds:     string[];
  organisationId: string;
};

// ── Date helpers ────────────────────────────────────────────────────────────

function getMondayOf(date: Date): Date {
  const d   = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Normalise any ISO date string to its Monday — ensures consistent map keys.
 *  Strips time/timezone before parsing (handles full ISO timestamps from Supabase).
 *  Uses UTC throughout to avoid server timezone shifting the day.
 */
function toMonday(iso: string): string {
  const dateOnly = String(iso ?? "").trim().slice(0, 10); // always "YYYY-MM-DD"
  const d = new Date(dateOnly + "T00:00:00Z");            // force UTC parse
  if (isNaN(d.getTime())) return dateOnly;                // guard invalid input
  const day = d.getUTCDay();                              // 0=Sun, 1=Mon ... 6=Sat
  d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().slice(0, 10);
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
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
}

function formatDate(iso: string, fmt: "short" | "month" | "quarter"): string {
  const d = new Date(iso + "T00:00:00");
  if (fmt === "short")   return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  if (fmt === "month")   return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  return "Q" + (Math.floor(d.getMonth() / 3) + 1) + " " + d.getFullYear();
}

function isoWeekNumber(date: Date): number {
  const d      = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// ── Period generation ────────────────────────────────────────────────────────

export function generatePeriods(dateFrom: string, dateTo: string, granularity: Granularity): PeriodHeader[] {
  const today   = new Date();
  const periods: PeriodHeader[] = [];
  const end     = new Date(dateTo + "T00:00:00");
  let current: Date;

  if (granularity === "weekly") {
    current = getMondayOf(new Date(dateFrom + "T00:00:00"));
    while (current <= end) {
      const pe  = addDays(current, 6);
      const key = toIso(current);
      periods.push({ key, label: formatDate(key, "short"), subLabel: "W" + isoWeekNumber(current), startDate: key, endDate: toIso(pe), isCurrentPeriod: today >= current && today <= pe });
      current = addDays(current, 7);
    }
    return periods;
  }

  if (granularity === "sprint") {
    current = getMondayOf(new Date(dateFrom + "T00:00:00"));
    let sn = 1;
    while (current <= end) {
      const pe  = addDays(current, 13);
      const key = toIso(current);
      periods.push({ key, label: formatDate(key, "short"), subLabel: "S" + sn, startDate: key, endDate: toIso(pe), isCurrentPeriod: today >= current && today <= pe });
      current = addDays(current, 14);
      sn++;
    }
    return periods;
  }

  if (granularity === "monthly") {
    current = new Date(new Date(dateFrom + "T00:00:00").getFullYear(), new Date(dateFrom + "T00:00:00").getMonth(), 1);
    while (current <= end) {
      const pe  = new Date(current.getFullYear(), current.getMonth() + 1, 0);
      const key = toIso(current);
      periods.push({ key, label: formatDate(key, "month"), startDate: key, endDate: toIso(pe), isCurrentPeriod: today.getMonth() === current.getMonth() && today.getFullYear() === current.getFullYear() });
      current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
    }
    return periods;
  }

  // quarterly
  current = getQuarterStart(new Date(dateFrom + "T00:00:00"));
  while (current <= end) {
    const pe  = new Date(current.getFullYear(), current.getMonth() + 3, 0);
    const key = toIso(current);
    periods.push({ key, label: formatDate(key, "quarter"), startDate: key, endDate: toIso(pe), isCurrentPeriod: today >= current && today <= pe });
    current = new Date(current.getFullYear(), current.getMonth() + 3, 1);
  }
  return periods;
}

// ── Aggregation ──────────────────────────────────────────────────────────────

type WeekData = { days: number; capacity: number; ids: string[]; hasException: boolean };

function aggregateIntoPeriods(weeklyRows: Map<string, WeekData>, periods: PeriodHeader[]): AllocationCell[] {
  return periods.map(period => {
    let totalDays = 0, totalCapacity = 0;
    const allIds: string[] = [];
    let periodHasException = false;
    for (const [weekKey, row] of weeklyRows) {
      if (weekKey >= period.startDate && weekKey <= period.endDate) {
        totalDays     += row.days;
        totalCapacity += row.capacity;
        allIds.push(...row.ids);
        if (row.hasException) periodHasException = true;
      }
    }
    const pct = totalCapacity > 0 ? Math.round((totalDays / totalCapacity) * 100) : 0;
    return { periodKey: period.key, daysAllocated: Math.round(totalDays * 10) / 10, capacityDays: Math.round(totalCapacity * 10) / 10, utilisationPct: pct, allocationIds: allIds, hasException: periodHasException };
  });
}

// ── Main fetch ───────────────────────────────────────────────────────────────

export async function fetchHeatmapData(filters: HeatmapFilters): Promise<HeatmapData> {
  const supabase = await createClient();
  const { granularity, dateTo, departments, statuses, personIds, organisationId } = filters;

  // Normalise dateFrom to its Monday so the DB query boundary matches the
  // first period key generated by generatePeriods (which also snaps to Monday).
  // Without this, an allocation on Mon 2026-02-02 is excluded when dateFrom is
  // "2026-02-03" because gte("week_start_date","2026-02-03") skips it.
  const dateFrom = toMonday(filters.dateFrom);

  const periods       = generatePeriods(dateFrom, dateTo, granularity);
  const weeklyPeriods = generatePeriods(dateFrom, dateTo, "weekly");

  // Members
  const { data: memberRows } = await supabase
    .from("organisation_members").select("user_id")
    .eq("organisation_id", organisationId).is("removed_at", null);
  const memberUserIds = (memberRows ?? []).map((r: any) => String(r.user_id)).filter(Boolean);

  // Profiles
  const { data: profileRows } = memberUserIds.length > 0
    ? await supabase.from("profiles")
        .select("user_id, full_name, job_title, department, employment_type, default_capacity_days, is_active")
        .in("user_id", memberUserIds)
    : { data: [] };

  let allPeople = (profileRows ?? [])
    .map((p: any) => {
      if (!p || p.is_active === false) return null;
      return {
        personId:            String(p.user_id),
        fullName:            String(p.full_name || "Unknown"),
        jobTitle:            p.job_title  ? String(p.job_title)  : null,
        department:          p.department ? String(p.department) : null,
        employmentType:      String(p.employment_type || "full_time"),
        defaultCapacityDays: parseFloat(String(p.default_capacity_days ?? 5)),
      };
    })
    .filter(Boolean) as Array<{ personId: string; fullName: string; jobTitle: string | null; department: string | null; employmentType: string; defaultCapacityDays: number }>;

  if (departments.length > 0) allPeople = allPeople.filter(p => p.department && departments.includes(p.department));
  if (personIds.length > 0)   allPeople = allPeople.filter(p => personIds.includes(p.personId));

  const allPersonIds = allPeople.map(p => p.personId);
  if (!allPersonIds.length) {
    return { periods, people: [], pipelineGaps: [], fetchedAt: new Date().toISOString(), granularity, dateFrom, dateTo, exceptionCount: 0 };
  }

  // ── Capacity exceptions ────────────────────────────────────────────────────
  // FIX: normalise week_start_date to Monday via toMonday() so it always
  // matches the Monday-keyed weeklyPeriods.  A raw DB date stored on e.g.
  // Wednesday would never match without this normalisation.
  let exceptionCount = 0;
  const exceptionMap = new Map<string, Map<string, number>>();

  try {
    const { data: exceptionRows, error: exErr } = await supabase
      .from("capacity_exceptions")
      .select("person_id, week_start_date, available_days")
      .in("person_id", allPersonIds)
      .gte("week_start_date", dateFrom)
      .lte("week_start_date", dateTo);

    if (!exErr && exceptionRows) {
      exceptionCount = exceptionRows.length;
      // DEBUG: log raw exception rows and the person IDs we queried
      console.log("[heatmap] exception query returned", exceptionRows.length, "rows");
      console.log("[heatmap] queried personIds:", allPersonIds.slice(0, 5));
      console.log("[heatmap] raw exception rows:", JSON.stringify(exceptionRows.slice(0, 5)));
      for (const ex of exceptionRows) {
        const pid     = String(ex.person_id);
        const rawDate = String(ex.week_start_date);
        const weekKey = toMonday(rawDate);
        // DEBUG: log each exception mapping
        console.log(`[heatmap] exception pid=${pid} rawDate=${rawDate} -> weekKey=${weekKey} avail=${ex.available_days}`);
        if (!exceptionMap.has(pid)) exceptionMap.set(pid, new Map());
        // Use the minimum if multiple exceptions map to same Monday
        const existing = exceptionMap.get(pid)!.get(weekKey);
        const avail    = parseFloat(String(ex.available_days));
        exceptionMap.get(pid)!.set(weekKey, existing !== undefined ? Math.min(existing, avail) : avail);
      }
    } else if (exErr) {
      console.log("[heatmap] exception query error:", exErr.message, exErr.code);
    } else {
      console.log("[heatmap] exception query returned null/empty rows");
    }
  } catch (catchErr: any) {
    // capacity_exceptions table may not exist — silently continue
    console.log("[heatmap] exception query threw:", catchErr?.message);
  }

  // ── Allocations ────────────────────────────────────────────────────────────
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

  const showPipeline  = statuses.length === 0 || statuses.includes("pipeline");
  const showConfirmed = statuses.length === 0 || statuses.includes("confirmed");
  if (!showPipeline)  allocQuery = allocQuery.neq("projects.resource_status", "pipeline");
  if (!showConfirmed) allocQuery = allocQuery.neq("projects.resource_status", "confirmed");
  if (filters.projectIds?.length) allocQuery = allocQuery.in("project_id", filters.projectIds);

  const { data: allocRows } = await allocQuery;

  const personProjectWeeks = new Map<string, Map<string, { project: any; weeks: Map<string, WeekData> }>>();
  const personProjectRole  = new Map<string, string | null>();

  for (const alloc of allocRows ?? []) {
    const pid    = String(alloc.person_id);
    const projId = String(alloc.project_id);
    // FIX: normalise allocation week to Monday for consistent map keys
    const week   = toMonday(String(alloc.week_start_date));
    const days   = parseFloat(String(alloc.days_allocated));
    const proj   = (alloc as any).projects;
    if (!proj) continue;

    const roleKey = pid + "::" + projId;
    if (!personProjectRole.has(roleKey)) personProjectRole.set(roleKey, (alloc as any).role_on_project ?? null);

    if (!personProjectWeeks.has(pid)) personProjectWeeks.set(pid, new Map());
    const byProject = personProjectWeeks.get(pid)!;
    if (!byProject.has(projId)) byProject.set(projId, { project: proj, weeks: new Map() });

    const personData   = allPeople.find(p => p.personId === pid);
    const defaultCap   = personData?.defaultCapacityDays ?? 5;
    const exCap        = exceptionMap.get(pid)?.get(week);
    const capacity     = exCap !== undefined ? exCap : defaultCap;
    const hasException = exCap !== undefined;

    const entry = byProject.get(projId)!;
    if (!entry.weeks.has(week)) entry.weeks.set(week, { days: 0, capacity, ids: [], hasException });
    const wd = entry.weeks.get(week)!;
    wd.days += days;
    wd.ids.push(String(alloc.id));
  }

  // Per-person weekly capacity map
  const personWeekCapacity = new Map<string, Map<string, { capacity: number; hasException: boolean }>>();
  for (const person of allPeople) {
    const capMap = new Map<string, { capacity: number; hasException: boolean }>();
    for (const wp of weeklyPeriods) {
      const exCap = exceptionMap.get(person.personId)?.get(wp.key);
      capMap.set(wp.key, { capacity: exCap !== undefined ? exCap : person.defaultCapacityDays, hasException: exCap !== undefined });
    }
    personWeekCapacity.set(person.personId, capMap);
  }

  const people: PersonRow[] = allPeople.map(person => {
    const byProject = personProjectWeeks.get(person.personId) ?? new Map();

    const projectRows: ProjectRow[] = [];
    for (const [projId, entry] of byProject) {
      const proj = entry.project;
      const cells = aggregateIntoPeriods(entry.weeks, periods);
      projectRows.push({
        projectId:     projId,
        projectTitle:  String(proj.title || ""),
        projectCode:   proj.project_code ? String(proj.project_code) : null,
        colour:        String(proj.colour || "#00b8db"),
        roleOnProject: personProjectRole.get(person.personId + "::" + projId) ?? null,
        cells,
        totalDays: Math.round(cells.reduce((s, c) => s + c.daysAllocated, 0) * 10) / 10,
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
      const { capacity, hasException } = capMap.get(wp.key) ?? { capacity: person.defaultCapacityDays, hasException: false };
      summaryWeekly.set(wp.key, { days: totalAllocated, capacity, ids, hasException });
    }

    const summaryCells = aggregateIntoPeriods(summaryWeekly, periods);
    const utilPcts     = summaryCells.map(c => c.utilisationPct).filter(p => p > 0);

    return {
      personId:            person.personId,
      fullName:            person.fullName,
      jobTitle:            person.jobTitle,
      department:          person.department,
      employmentType:      person.employmentType,
      defaultCapacityDays: person.defaultCapacityDays,
      avgUtilisationPct:   utilPcts.length ? Math.round(utilPcts.reduce((s, p) => s + p, 0) / utilPcts.length) : 0,
      peakUtilisationPct:  utilPcts.length ? Math.max(...utilPcts) : 0,
      projects:            projectRows,
      summaryCells,
    };
  });

  // ── Pipeline gap analysis ────────────────────────────────────────────────
  const { data: pipelineProjects } = await supabase
    .from("projects")
    .select(`id, title, project_code, colour, win_probability, start_date, finish_date,
      role_requirements (id, role_title, seniority_level, required_days_per_week, start_date, end_date)`)
    .eq("organisation_id", organisationId)
    .eq("resource_status", "pipeline")
    .is("deleted_at", null)
    .gte("finish_date", dateFrom)
    .lte("start_date", dateTo);

  const pipelineGaps: PipelineGapRow[] = (pipelineProjects ?? []).map((proj: any) => {
    const winProb = (proj.win_probability ?? 50) / 100;
    const roles   = (proj.role_requirements ?? []) as any[];
    const cells   = periods.map(period => {
      let demandDays = 0;
      for (const role of roles) {
        const rs = role.start_date || proj.start_date;
        const re = role.end_date   || proj.finish_date;
        if (rs > period.endDate || re < period.startDate) continue;
        let wc = getMondayOf(new Date(Math.max(new Date(rs + "T00:00:00").getTime(), new Date(period.startDate + "T00:00:00").getTime())));
        const effEnd = new Date(Math.min(new Date(re + "T00:00:00").getTime(), new Date(period.endDate + "T00:00:00").getTime()));
        while (wc <= effEnd) { demandDays += parseFloat(String(role.required_days_per_week)); wc = addDays(wc, 7); }
      }
      let availableDays = 0;
      for (const p of people) {
        const cell = p.summaryCells.find(c => c.periodKey === period.key);
        availableDays += cell ? Math.max(0, cell.capacityDays - cell.daysAllocated) : 0;
      }
      return { periodKey: period.key, demandDays: Math.round(demandDays * 10) / 10, availableDays: Math.round(availableDays * 10) / 10, gapDays: Math.max(0, demandDays - availableDays), weightedDemand: Math.round(demandDays * winProb * 10) / 10 };
    });
    return { projectId: String(proj.id), projectTitle: String(proj.title), projectCode: proj.project_code ? String(proj.project_code) : null, colour: String(proj.colour || "#7c3aed"), winProbability: proj.win_probability ?? 50, cells };
  });

  return { periods, people, pipelineGaps, fetchedAt: new Date().toISOString(), granularity, dateFrom, dateTo, exceptionCount };
}

// ── Filter options ───────────────────────────────────────────────────────────

export async function fetchHeatmapFilterOptions(organisationId: string) {
  const supabase = await createClient();

  const { data: memberRows } = await supabase
    .from("organisation_members").select("user_id")
    .eq("organisation_id", organisationId).is("removed_at", null);
  const memberUserIds = (memberRows ?? []).map((r: any) => String(r.user_id)).filter(Boolean);

  const [profileRes, projectRes] = await Promise.all([
    memberUserIds.length > 0
      ? supabase.from("profiles").select("user_id, full_name, job_title, department, is_active").in("user_id", memberUserIds)
      : Promise.resolve({ data: [] }),
    supabase.from("projects")
      .select("id, title, project_code, resource_status, colour")
      .eq("organisation_id", organisationId)
      .is("deleted_at", null)
      .in("resource_status", ["confirmed", "pipeline"])
      .order("project_code", { ascending: true, nullsFirst: false }),
  ]);

  const people = ((profileRes as any).data ?? [])
    .filter((p: any) => p && p.is_active !== false)
    .map((p: any) => ({ id: String(p.user_id), name: String(p.full_name || "Unknown"), department: p.department ? String(p.department) : null, jobTitle: p.job_title ? String(p.job_title) : null }));

  const departments = Array.from(new Set(people.map((p: any) => p.department).filter(Boolean))).sort() as string[];
  const roles       = Array.from(new Set(people.map((p: any) => p.jobTitle).filter(Boolean))).sort() as string[];
  const projects    = ((projectRes as any).data ?? []).map((p: any) => ({
    id: String(p.id), title: String(p.title || ""), code: p.project_code ? String(p.project_code) : null,
    status: String(p.resource_status || "confirmed"), colour: String(p.colour || "#00b8db"),
  }));
  const pms = people.filter((p: any) => p.jobTitle && /manager|pm|director|lead|head/i.test(p.jobTitle));

  return { people, departments, roles, projects, pms };
}