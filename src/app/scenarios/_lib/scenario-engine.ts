// FILE: src/app/scenarios/_lib/scenario-engine.ts
//
// Types match EXACTLY what page.tsx passes in:
//   LiveAllocation  -> weekStart + daysAllocated (one row per week)
//   LiveException   -> weekStart + availDays
//   LiveProject     -> startDate/endDate nullable

/* =============================================================================
   TYPES
============================================================================= */

export type LivePerson = {
  personId:     string;
  fullName:     string;
  capacityDays: number;
  department?:  string | null;
  empType?:     string;
};

export type LiveProject = {
  projectId:    string;
  title:        string;
  colour:       string;
  startDate:    string | null;
  endDate:      string | null;
  projectCode?: string | null;
  status?:      string;
  winProb?:     number;
};

export type LiveAllocation = {
  id:            string;
  personId:      string;
  projectId:     string;
  weekStart:     string;
  daysAllocated: number;
  allocType?:    string;
};

export type LiveException = {
  personId:  string;
  weekStart: string;
  availDays: number;
};

// FIX Bug 3: added optional daysPerWeek to swap_allocation so synthesised rows
// have a real allocation amount instead of always defaulting to 5d.
export type ScenarioChange =
  | { type: "add_allocation";  personId: string; projectId: string; startDate: string; endDate: string; daysPerWeek: number }
  | { type: "swap_allocation"; fromPersonId: string; toPersonId: string; projectId: string; startDate: string; endDate: string; daysPerWeek?: number }
  | { type: "change_capacity"; personId: string; newCapacity: number; startDate: string; endDate: string }
  | { type: "shift_project";   projectId: string; shiftWeeks: number }
  | { type: "add_project";     projectId: string; title: string; colour: string; startDate: string; endDate: string; daysPerWeek: number; personId: string };

export type Scenario = {
  id:           string;
  name:         string;
  description?: string;
  changes:      ScenarioChange[];
  createdAt?:   string;
  updatedAt?:   string;
};

export type PersonDiff = {
  personId:     string;
  fullName:     string;
  capacityDays: number;
  scenarioCap:  number;
  deltaAvg:     number;
  cells: {
    weekStart:   string;
    livePct:     number;
    scenarioPct: number;
    delta:       number;
    changed:     boolean;
  }[];
};

export type ComputedState = {
  conflictScore:  number;
  totalOverAlloc: number;
  warnings:       { message: string; severity: "critical" | "warning" }[];
  personStats:    Map<string, { weeklyPct: Map<string, number>; capacityDays: number }>;
};

export type SuggestedPerson = {
  personId:      string;
  fullName:      string;
  avgAvailDays:  number;
  conflictWeeks: number;
  score:         number;
  canFullyCover: boolean;
};

/* =============================================================================
   HELPERS
============================================================================= */

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

function weeksInDateRange(startDate: string, endDate: string): string[] {
  const weeks: string[] = [];
  let curr = getMondayOf(startDate);
  while (curr <= endDate) {
    weeks.push(curr);
    curr = addWeeks(curr, 1);
  }
  return weeks;
}

/* =============================================================================
   weeksInRange
============================================================================= */

export function weeksInRange(from: string, to: string): string[] {
  const weeks: string[] = [];
  let curr = new Date(getMondayOf(from) + "T00:00:00");
  const stop = new Date(to + "T00:00:00");
  while (curr <= stop) {
    weeks.push(curr.toISOString().split("T")[0]);
    curr.setDate(curr.getDate() + 7);
  }
  return weeks;
}

/* =============================================================================
   applyChanges
============================================================================= */

export function applyChanges(
  people:      LivePerson[],
  projects:    LiveProject[],
  allocations: LiveAllocation[],
  exceptions:  LiveException[],
  changes:     ScenarioChange[]
): { allocations: LiveAllocation[]; projects: LiveProject[]; scenarioCap: Map<string, number> } {
  let scAllocs:   LiveAllocation[] = allocations.map(a => ({ ...a }));
  let scProjects: LiveProject[]    = projects.map(p => ({ ...p }));
  const scenarioCap = new Map<string, number>();

  for (const change of changes) {

    if (change.type === "add_allocation") {
      for (const w of weeksInDateRange(change.startDate, change.endDate)) {
        scAllocs.push({
          id: `sc_add_${change.personId}_${change.projectId}_${w}`,
          personId: change.personId,
          projectId: change.projectId,
          weekStart: w,
          daysAllocated: change.daysPerWeek,
          allocType: "scenario",
        });
      }
    }

    // FIX Bug 3: swap only mutated existing rows, so if fromPerson had no
    // allocation row for a given week, toPerson got nothing and never appeared
    // in the heatmap. Now we track which weeks were mutated and synthesise rows
    // for any week that had no source row to mutate.
    else if (change.type === "swap_allocation") {
      const swapWeeks = new Set(weeksInDateRange(change.startDate, change.endDate));
      const mutatedWeeks = new Set<string>();

      scAllocs = scAllocs.map(a => {
        if (
          a.personId === change.fromPersonId &&
          a.projectId === change.projectId &&
          swapWeeks.has(a.weekStart)
        ) {
          mutatedWeeks.add(a.weekStart);
          return { ...a, personId: change.toPersonId, allocType: "scenario" };
        }
        return a;
      });

      // Synthesise rows for weeks where fromPerson had no existing allocation
      for (const w of swapWeeks) {
        if (!mutatedWeeks.has(w)) {
          scAllocs.push({
            id: `sc_swap_${change.toPersonId}_${change.projectId}_${w}`,
            personId:      change.toPersonId,
            projectId:     change.projectId,
            weekStart:     w,
            // Use the explicit daysPerWeek if the form provided it, else fall
            // back to the org standard of 5d
            daysAllocated: change.daysPerWeek ?? 5,
            allocType:     "scenario",
          });
        }
      }
    }

    else if (change.type === "change_capacity") {
      for (const w of weeksInDateRange(change.startDate, change.endDate)) {
        scenarioCap.set(`${change.personId}::${w}`, change.newCapacity);
      }
    }

    else if (change.type === "shift_project") {
      scProjects = scProjects.map(p =>
        p.projectId === change.projectId
          ? {
              ...p,
              startDate: p.startDate ? addWeeks(p.startDate, change.shiftWeeks) : null,
              endDate:   p.endDate   ? addWeeks(p.endDate,   change.shiftWeeks) : null,
            }
          : p
      );
      scAllocs = scAllocs.map(a =>
        a.projectId === change.projectId
          ? { ...a, weekStart: addWeeks(a.weekStart, change.shiftWeeks), allocType: "scenario" }
          : a
      );
    }

    else if (change.type === "add_project") {
      scProjects.push({
        projectId: change.projectId,
        title:     change.title,
        colour:    change.colour,
        startDate: change.startDate,
        endDate:   change.endDate,
      });
      for (const w of weeksInDateRange(change.startDate, change.endDate)) {
        scAllocs.push({
          id: `sc_proj_${change.projectId}_${w}`,
          personId: change.personId,
          projectId: change.projectId,
          weekStart: w,
          daysAllocated: change.daysPerWeek,
          allocType: "scenario",
        });
      }
    }
  }

  return { allocations: scAllocs, projects: scProjects, scenarioCap };
}

/* =============================================================================
   computeState
============================================================================= */

export function computeState(
  people:       LivePerson[],
  projects:     LiveProject[],
  allocations:  LiveAllocation[],
  exceptions:   LiveException[],
  weeks:        string[],
  capOverrides: Map<string, number>
): ComputedState {
  const exMap = new Map<string, number>();
  for (const ex of exceptions) {
    exMap.set(`${ex.personId}::${ex.weekStart}`, ex.availDays);
  }

  const allocMap = new Map<string, number>();
  for (const a of allocations) {
    const key = `${a.personId}::${a.weekStart}`;
    allocMap.set(key, (allocMap.get(key) ?? 0) + a.daysAllocated);
  }

  const personStats = new Map<string, { weeklyPct: Map<string, number>; capacityDays: number }>();
  const warnings: ComputedState["warnings"] = [];
  let totalOverAlloc = 0;

  for (const person of people) {
    const weeklyPct = new Map<string, number>();

    for (const week of weeks) {
      const key = `${person.personId}::${week}`;
      const cap = capOverrides.get(key) ?? exMap.get(key) ?? person.capacityDays;
      if (cap <= 0) { weeklyPct.set(week, 0); continue; }
      const allocated = allocMap.get(key) ?? 0;
      if (allocated === 0) { weeklyPct.set(week, 0); continue; }
      const pct = Math.round((allocated / cap) * 100);
      weeklyPct.set(week, pct);
      // FIX Bug 2: was pct > 100, missing the exactly-at-limit case
      if (pct >= 100) totalOverAlloc++;
    }

    personStats.set(person.personId, { weeklyPct, capacityDays: person.capacityDays });

    const critWeeks = [...weeklyPct.values()].filter(p => p > 110).length;
    const overWeeks = [...weeklyPct.values()].filter(p => p > 100 && p <= 110).length;
    if (critWeeks > 0)
      warnings.push({ severity: "critical", message: `${person.fullName} >110% for ${critWeeks}w` });
    else if (overWeeks > 0)
      warnings.push({ severity: "warning", message: `${person.fullName} over-allocated ${overWeeks}w` });
  }

  const allPcts  = [...personStats.values()].flatMap(s => [...s.weeklyPct.values()]);
  // FIX Bug 2: was > 100, so exactly-100% allocations were invisible to the
  // conflict scorer, keeping the score at 0 even for fully-loaded teams.
  const overPcts = allPcts.filter(p => p >= 100);
  let conflictScore = 0;
  if (allPcts.length > 0 && overPcts.length > 0) {
    const avgOver = overPcts.reduce((s, p) => s + (p - 100), 0) / overPcts.length;
    const breadth = overPcts.length / allPcts.length;
    conflictScore = Math.min(100, Math.round(breadth * 60 + (avgOver / 50) * 40));
  }

  return { conflictScore, totalOverAlloc, warnings, personStats };
}

/* =============================================================================
   computeDiff
============================================================================= */

export function computeDiff(
  live:     ComputedState,
  scenario: ComputedState,
  weeks:    string[],
  people?:  LivePerson[]
): PersonDiff[] {
  const diffs: PersonDiff[] = [];
  const allIds = new Set([...live.personStats.keys(), ...scenario.personStats.keys()]);

  for (const personId of allIds) {
    const liveStats = live.personStats.get(personId);
    const scStats   = scenario.personStats.get(personId);
    if (!liveStats && !scStats) continue;

    const capacityDays = liveStats?.capacityDays ?? scStats?.capacityDays ?? 5;
    const cells: PersonDiff["cells"] = [];
    let deltaSum = 0, deltaCount = 0;

    for (const week of weeks) {
      const livePct     = liveStats?.weeklyPct.get(week) ?? 0;
      const scenarioPct = scStats?.weeklyPct.get(week)   ?? 0;
      const delta       = scenarioPct - livePct;
      const changed     = delta !== 0;
      cells.push({ weekStart: week, livePct, scenarioPct, delta, changed });
      if (changed) { deltaSum += delta; deltaCount++; }
    }

    if (!cells.some(c => c.livePct > 0 || c.scenarioPct > 0)) continue;

    diffs.push({
      personId,
      fullName:     people?.find(p => p.personId === personId)?.fullName ?? personId,
      capacityDays,
      scenarioCap:  capacityDays,
      deltaAvg:     deltaCount > 0 ? Math.round(deltaSum / deltaCount) : 0,
      cells,
    });
  }

  return diffs;
}

/* =============================================================================
   autoSuggest
============================================================================= */

export function autoSuggest(
  people:      LivePerson[],
  allocations: LiveAllocation[],
  exceptions:  LiveException[],
  start:       string,
  end:         string,
  daysNeeded:  number
): SuggestedPerson[] {
  const weeks = weeksInDateRange(start, end);

  const exMap = new Map<string, number>();
  for (const ex of exceptions) exMap.set(`${ex.personId}::${ex.weekStart}`, ex.availDays);

  const allocMap = new Map<string, number>();
  for (const a of allocations) {
    const key = `${a.personId}::${a.weekStart}`;
    allocMap.set(key, (allocMap.get(key) ?? 0) + a.daysAllocated);
  }

  return people
    .map(person => {
      let totalAvail = 0, conflictWeeks = 0, fullCoverWeeks = 0;
      for (const week of weeks) {
        const key   = `${person.personId}::${week}`;
        const cap   = exMap.get(key) ?? person.capacityDays;
        const alloc = allocMap.get(key) ?? 0;
        const avail = Math.max(0, cap - alloc);
        totalAvail += avail;
        if (avail < daysNeeded) conflictWeeks++;
        else fullCoverWeeks++;
      }
      const avgAvailDays  = weeks.length > 0 ? Math.round((totalAvail / weeks.length) * 10) / 10 : 0;
      const canFullyCover = fullCoverWeeks === weeks.length;
      const score         = Math.round(
        (avgAvailDays / Math.max(1, person.capacityDays)) * 60 +
        ((weeks.length - conflictWeeks) / Math.max(1, weeks.length)) * 40
      );
      return { personId: person.personId, fullName: person.fullName, avgAvailDays, conflictWeeks, score, canFullyCover };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}