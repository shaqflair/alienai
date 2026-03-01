import "server-only";
import { createClient } from "@/utils/supabase/server";

/* =============================================================================
   TYPES
============================================================================= */

export type ReportFilters = {
  organisationId: string;
  dateFrom:        string;
  dateTo:          string;
  personIds?:      string[];
  projectIds?:     string[];
  departments?:    string[];
};

export type PersonUtilRow = {
  personId:    string;
  fullName:    string;
  department:  string | null;
  empType:     string;
  ratePerDay:  number | null;
  rateLabel:   string | null;
  weeks: Array<{
    weekStart:    string;
    allocated:    number;
    capacity:     number;
    utilPct:      number;
    exceptions:   string | null;
  }>;
  totals: {
    totalAllocated:  number;
    totalCapacity:   number;
    avgUtilPct:      number;
    peakUtilPct:     number;
    overAllocWeeks:  number;
  };
};

export type ProjectUtilRow = {
  projectId:   string;
  title:       string;
  projectCode: string | null;
  colour:      string;
  status:      string;
  startDate:   string | null;
  endDate:     string | null;
  people: Array<{
    personId:      string;
    fullName:      string;
    totalDays:      number;
    weekCount:      number;
    avgDaysPerWk:  number;
  }>;
  totals: {
    totalDays:      number;
    peakWeekDays:  number;
    uniquePeople:  number;
  };
};

export type CostRow = {
  personId:    string;
  fullName:    string;
  department:  string | null;
  ratePerDay:  number | null;
  currency:    string;
  rateLabel:   string | null;
  projects: Array<{
    projectId:   string;
    title:       string;
    projectCode: string | null;
    colour:      string;
    totalDays:   number;
    totalCost:   number | null;
  }>;
  totals: {
    totalDays:  number;
    totalCost:  number | null;
  };
};

export type LeaveRow = {
  personId:    string;
  fullName:    string;
  department:  string | null;
  exceptions: Array<{
    weekStart:    string;
    availDays:    number;
    defaultCap:   number;
    daysLost:     number;
    reason:       string;
    notes:        string | null;
  }>;
  totals: {
    totalDaysLost: number;
    totalWeeks:    number;
    fullDayOffs:   number;
  };
};

export type PipelineRow = {
  projectId:      string;
  title:          string;
  projectCode:    string | null;
  colour:         string;
  winProbability: number;
  startDate:      string | null;
  endDate:        string | null;
  roles: Array<{
    roleTitle:     string;
    daysPerWeek:   number;
    startDate:     string | null;
    endDate:       string | null;
    totalDays:     number;
    isFilled:      boolean;
    filledBy:      string | null;
  }>;
  totals: {
    totalDemandDays:    number;
    weightedDemandDays: number;
    unfilledDays:       number;
    filledDays:         number;
  };
};

/* =============================================================================
   HELPERS
============================================================================= */

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

function weeksOverlap(roleStart: string | null, roleEnd: string | null, from: string, to: string): number {
  const s = roleStart ? getMondayOf(roleStart) : from;
  const e = roleEnd   ? getMondayOf(roleEnd)   : to;
  const overlapStart = s > from ? s : from;
  const overlapEnd   = e < to   ? e : to;
  if (overlapEnd < overlapStart) return 0;
  return weeksInRange(overlapStart, overlapEnd).length;
}

/* =============================================================================
   MAIN DATA FETCHERS
============================================================================= */

export async function fetchReportData(filters: ReportFilters) {
  const supabase = await createClient();
  const { organisationId, dateFrom, dateTo } = filters;

  const [memberRes, allocRes, exceptionRes, projectRes, roleRes] = await Promise.all([
    supabase
      .from("organisation_members")
      .select(`
        user_id,
        profiles:profiles!organisation_members_user_id_fkey (
          user_id, full_name, department, employment_type,
          default_capacity_days, is_active,
          rate_cards:rate_cards!profiles_rate_card_id_fkey (
            label, rate_per_day, currency
          )
        )
      `)
      .eq("organisation_id", organisationId)
      .is("removed_at", null),

    supabase
      .from("allocations")
      .select(`
        person_id, project_id, week_start_date, days_allocated,
        projects:projects!allocations_project_id_fkey (
          id, title, project_code, colour, resource_status,
          start_date, finish_date
        )
      `)
      .gte("week_start_date", dateFrom)
      .lte("week_start_date", dateTo),

    supabase
      .from("capacity_exceptions")
      .select("person_id, week_start_date, available_days, reason, notes")
      .gte("week_start_date", dateFrom)
      .lte("week_start_date", dateTo),

    supabase
      .from("projects")
      .select("id, title, project_code, colour, resource_status, start_date, finish_date, win_probability")
      .eq("organisation_id", organisationId)
      .in("resource_status", ["confirmed", "pipeline"])
      .is("deleted_at", null),

    supabase
      .from("role_requirements")
      .select("project_id, role_title, required_days_per_week, start_date, end_date, filled_by_person_id")
      .then(r => r).catch(() => ({ data: [] })),
  ]);

  type PersonMeta = {
    personId:   string;
    fullName:   string;
    department: string | null;
    empType:    string;
    defaultCap: number;
    isActive:   boolean;
    ratePerDay: number | null;
    currency:   string;
    rateLabel:  string | null;
  };

  const peopleMap = new Map<string, PersonMeta>();
  for (const m of memberRes.data ?? []) {
    const p = (m as any).profiles;
    if (!p) continue;
    const rc = p.rate_cards;
    peopleMap.set(String(p.user_id || m.user_id), {
      personId:   String(p.user_id || m.user_id),
      fullName:   safeStr(p.full_name || "Unknown"),
      department: p.department ? safeStr(p.department) : null,
      empType:    safeStr(p.employment_type || "full_time"),
      defaultCap: parseFloat(String(p.default_capacity_days ?? 5)),
      isActive:   p.is_active !== false,
      ratePerDay: rc?.rate_per_day ? parseFloat(String(rc.rate_per_day)) : null,
      currency:   safeStr(rc?.currency || "GBP"),
      rateLabel:  rc?.label ? safeStr(rc.label) : null,
    });
  }

  const filteredPeople = filters.personIds?.length
    ? Array.from(peopleMap.values()).filter(p => filters.personIds!.includes(p.personId))
    : Array.from(peopleMap.values()).filter(p => p.isActive);

  const activePeople = filters.departments?.length
    ? filteredPeople.filter(p => p.department && filters.departments!.includes(p.department))
    : filteredPeople;

  const weeks = weeksInRange(dateFrom, dateTo);

  type ExMeta = { availDays: number; reason: string; notes: string | null };
  const exMap = new Map<string, Map<string, ExMeta>>();
  for (const e of exceptionRes.data ?? []) {
    const pid = String(e.person_id);
    if (!exMap.has(pid)) exMap.set(pid, new Map());
    exMap.get(pid)!.set(safeStr(e.week_start_date), {
      availDays: parseFloat(String(e.available_days)),
      reason:    safeStr(e.reason),
      notes:      e.notes ? safeStr(e.notes) : null,
    });
  }

  const allocByPerson = new Map<string, Map<string, Map<string, number>>>();
  const allocByProject = new Map<string, Map<string, Map<string, number>>>();

  for (const a of allocRes.data ?? []) {
    const pid  = String(a.person_id);
    const proj = String(a.project_id);
    const week = safeStr(a.week_start_date);
    const days = parseFloat(String(a.days_allocated));

    if (!allocByPerson.has(pid)) allocByPerson.set(pid, new Map());
    if (!allocByPerson.get(pid)!.has(proj)) allocByPerson.get(pid)!.set(proj, new Map());
    allocByPerson.get(pid)!.get(proj)!.set(week, (allocByPerson.get(pid)!.get(proj)!.get(week) ?? 0) + days);

    if (!allocByProject.has(proj)) allocByProject.set(proj, new Map());
    if (!allocByProject.get(proj)!.has(pid)) allocByProject.get(proj)!.set(pid, new Map());
    allocByProject.get(proj)!.get(pid)!.set(week, (allocByProject.get(proj)!.get(pid)!.get(week) ?? 0) + days);
  }

  const projectMetaFromAlloc = new Map<string, any>();
  for (const a of allocRes.data ?? []) {
    if (a.projects && !projectMetaFromAlloc.has(String(a.project_id))) {
      projectMetaFromAlloc.set(String(a.project_id), a.projects);
    }
  }

  const utilisationByPerson: PersonUtilRow[] = activePeople.map(person => {
    const pid = person.personId;
    const personExceptions = exMap.get(pid) ?? new Map();
    const personAllocs = allocByPerson.get(pid) ?? new Map();

    const weekRows = weeks.map(w => {
      const ex = personExceptions.get(w);
      const capacity = ex !== undefined ? ex.availDays : person.defaultCap;
      const allocated = Array.from(personAllocs.values())
        .reduce((s, wm) => s + (wm.get(w) ?? 0), 0);
      const utilPct = capacity > 0 ? Math.round((allocated / capacity) * 100) : 0;
      return {
        weekStart:  w,
        allocated:  Math.round(allocated * 10) / 10,
        capacity:   Math.round(capacity * 10) / 10,
        utilPct,
        exceptions: ex ? `${ex.reason} (${ex.availDays}d)` : null,
      };
    });

    const nonZero = weekRows.filter(r => r.utilPct > 0);
    const totalAlloc = weekRows.reduce((s, r) => s + r.allocated, 0);
    const totalCap   = weekRows.reduce((s, r) => s + r.capacity, 0);

    return {
      personId:    pid,
      fullName:    person.fullName,
      department: person.department,
      empType:     person.empType,
      ratePerDay: person.ratePerDay,
      rateLabel:   person.rateLabel,
      weeks: weekRows,
      totals: {
        totalAllocated:  Math.round(totalAlloc * 10) / 10,
        totalCapacity:   Math.round(totalCap * 10) / 10,
        avgUtilPct:      nonZero.length ? Math.round(nonZero.reduce((s, r) => s + r.utilPct, 0) / nonZero.length) : 0,
        peakUtilPct:     nonZero.length ? Math.max(...nonZero.map(r => r.utilPct)) : 0,
        overAllocWeeks:  weekRows.filter(r => r.utilPct > 100).length,
      },
    };
  }).sort((a, b) => a.fullName.localeCompare(b.fullName));

  const confirmedProjects = (projectRes.data ?? []).filter((p: any) =>
    p.resource_status === "confirmed"
  );

  const utilisationByProject: ProjectUtilRow[] = confirmedProjects.map((proj: any) => {
    const projectId = String(proj.id);
    const projAllocs = allocByProject.get(projectId) ?? new Map();
    const weekTotals = new Map<string, number>();
    const peopleOnProject: ProjectUtilRow["people"] = [];

    for (const [pid, weekMap] of projAllocs) {
      const personMeta = peopleMap.get(pid);
      if (!personMeta) continue;
      const totalDays = Array.from(weekMap.values()).reduce((s, d) => s + d, 0);
      const weekCount = weekMap.size;
      peopleOnProject.push({
        personId:      pid,
        fullName:      personMeta.fullName,
        totalDays:     Math.round(totalDays * 10) / 10,
        weekCount,
        avgDaysPerWk: weekCount > 0 ? Math.round((totalDays / weekCount) * 10) / 10 : 0,
      });
      for (const [w, d] of weekMap) {
        weekTotals.set(w, (weekTotals.get(w) ?? 0) + d);
      }
    }

    const totalDays = peopleOnProject.reduce((s, p) => s + p.totalDays, 0);
    const peakWeekDays = weekTotals.size > 0 ? Math.max(...weekTotals.values()) : 0;

    return {
      projectId,
      title:        safeStr(proj.title),
      projectCode: proj.project_code ? safeStr(proj.project_code) : null,
      colour:       safeStr(proj.colour || "#00b8db"),
      status:       safeStr(proj.resource_status),
      startDate:    proj.start_date  ? safeStr(proj.start_date)  : null,
      endDate:      proj.finish_date ? safeStr(proj.finish_date) : null,
      people:       peopleOnProject.sort((a, b) => b.totalDays - a.totalDays),
      totals: {
        totalDays:     Math.round(totalDays * 10) / 10,
        peakWeekDays: Math.round(peakWeekDays * 10) / 10,
        uniquePeople: peopleOnProject.length,
      },
    };
  }).filter(r => r.totals.totalDays > 0)
    .sort((a, b) => b.totals.totalDays - a.totals.totalDays);

  const costReport: CostRow[] = activePeople.map(person => {
    const pid = person.personId;
    const personAllocs = allocByPerson.get(pid) ?? new Map();
    const projects: CostRow["projects"] = [];
    for (const [projectId, weekMap] of personAllocs) {
      const totalDays = Array.from(weekMap.values()).reduce((s, d) => s + d, 0);
      if (totalDays === 0) continue;
      const projMeta = projectMetaFromAlloc.get(projectId);
      projects.push({
        projectId,
        title:        projMeta ? safeStr(projMeta.title) : "Unknown",
        projectCode: projMeta?.project_code ? safeStr(projMeta.project_code) : null,
        colour:       projMeta ? safeStr(projMeta.colour || "#00b8db") : "#00b8db",
        totalDays:    Math.round(totalDays * 10) / 10,
        totalCost:    person.ratePerDay != null
          ? Math.round(totalDays * person.ratePerDay * 100) / 100
          : null,
      });
    }
    projects.sort((a, b) => b.totalDays - a.totalDays);
    const totalDays = projects.reduce((s, p) => s + p.totalDays, 0);
    const totalCost = person.ratePerDay != null
      ? projects.reduce((s, p) => s + (p.totalCost ?? 0), 0)
      : null;

    return {
      personId:    pid,
      fullName:    person.fullName,
      department: person.department,
      ratePerDay: person.ratePerDay,
      currency:    person.currency,
      rateLabel:   person.rateLabel,
      projects,
      totals: {
        totalDays:  Math.round(totalDays * 10) / 10,
        totalCost:  totalCost != null ? Math.round(totalCost * 100) / 100 : null,
      },
    };
  }).filter(r => r.totals.totalDays > 0)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  const leaveSummary: LeaveRow[] = activePeople.map(person => {
    const pid = person.personId;
    const personExceptions = exMap.get(pid) ?? new Map();
    const exceptions: LeaveRow["exceptions"] = Array.from(personExceptions.entries())
      .map(([weekStart, ex]) => ({
        weekStart,
        availDays:  ex.availDays,
        defaultCap: person.defaultCap,
        daysLost:   Math.max(0, person.defaultCap - ex.availDays),
        reason:     ex.reason,
        notes:      ex.notes,
      }))
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    const totalDaysLost = exceptions.reduce((s, e) => s + e.daysLost, 0);
    return {
      personId:    pid,
      fullName:    person.fullName,
      department: person.department,
      exceptions,
      totals: {
        totalDaysLost: Math.round(totalDaysLost * 10) / 10,
        totalWeeks:    exceptions.length,
        fullDayOffs:   exceptions.filter(e => e.availDays === 0).length,
      },
    };
  }).filter(r => r.exceptions.length > 0)
    .sort((a, b) => b.totals.totalDaysLost - a.totals.totalDaysLost);

  const pipelineProjects = (projectRes.data ?? []).filter((p: any) => p.resource_status === "pipeline");
  const filledByNames = new Map<string, string>();
  for (const r of (roleRes as any).data ?? []) {
    if (r.filled_by_person_id) {
      const p = peopleMap.get(String(r.filled_by_person_id));
      if (p) filledByNames.set(String(r.filled_by_person_id), p.fullName);
    }
  }

  const pipelineForecast: PipelineRow[] = pipelineProjects.map((proj: any) => {
    const projectId = String(proj.id);
    const projRoles = ((roleRes as any).data ?? []).filter((r: any) => String(r.project_id) === projectId);
    const roles: PipelineRow["roles"] = projRoles.map((r: any) => {
      const wks = weeksOverlap(r.start_date, r.end_date, dateFrom, dateTo);
      const dpw  = parseFloat(String(r.required_days_per_week ?? 0));
      return {
        roleTitle:   safeStr(r.role_title || "TBD"),
        daysPerWeek: dpw,
        startDate:   r.start_date ? safeStr(r.start_date) : null,
        endDate:     r.end_date   ? safeStr(r.end_date)   : null,
        totalDays:   Math.round(dpw * wks * 10) / 10,
        isFilled:    !!r.filled_by_person_id,
        filledBy:    r.filled_by_person_id ? (filledByNames.get(String(r.filled_by_person_id)) ?? null) : null,
      };
    });
    const totalDemand    = roles.reduce((s, r) => s + r.totalDays, 0);
    const filledDays     = roles.filter(r => r.isFilled).reduce((s, r) => s + r.totalDays, 0);
    const unfilledDays   = roles.filter(r => !r.isFilled).reduce((s, r) => s + r.totalDays, 0);
    const winProb        = parseFloat(String(proj.win_probability ?? 50)) / 100;
    return {
      projectId,
      title:          safeStr(proj.title),
      projectCode:    proj.project_code ? safeStr(proj.project_code) : null,
      colour:         safeStr(proj.colour || "#7c3aed"),
      winProbability: Math.round(winProb * 100),
      startDate:      proj.start_date  ? safeStr(proj.start_date)  : null,
      endDate:        proj.finish_date ? safeStr(proj.finish_date) : null,
      roles,
      totals: {
        totalDemandDays:    Math.round(totalDemand * 10) / 10,
        weightedDemandDays: Math.round(totalDemand * winProb * 10) / 10,
        unfilledDays:       Math.round(unfilledDays * 10) / 10,
        filledDays:         Math.round(filledDays * 10) / 10,
      },
    };
  }).filter(r => r.roles.length > 0)
    .sort((a, b) => b.winProbability - a.winProbability);

  return {
    utilisationByPerson,
    utilisationByProject,
    costReport,
    leaveSummary,
    pipelineForecast,
    meta: {
      dateFrom,
      dateTo,
      generatedAt: new Date().toISOString(),
      weeks:       weeks.length,
      peopleCount: activePeople.length,
    },
  };
}

export type ReportBundle = Awaited<ReturnType<typeof fetchReportData>>;
