// FILE: src/app/scenarios/_lib/scenario-engine.ts

export type LivePerson = { personId: string; fullName: string; capacityDays: number };
export type LiveProject = { projectId: string; title: string; colour: string; startDate: string; endDate: string };
export type LiveAllocation = { personId: string; projectId: string; daysPerWeek: number; startDate: string; endDate: string };
export type LiveException = { personId: string; weekStart: string; capacityOverride: number };
export type ScenarioChange =
  | { type: "add_allocation"; personId: string; projectId: string; startDate: string; endDate: string; daysPerWeek: number }
  | { type: "swap_allocation"; fromPersonId: string; toPersonId: string; projectId: string; startDate: string; endDate: string }
  | { type: "change_capacity"; personId: string; newCapacity: number; startDate: string; endDate: string }
  | { type: "shift_project"; projectId: string; shiftWeeks: number }
  | { type: "add_project"; projectId: string; title: string; colour: string; startDate: string; endDate: string; daysPerWeek: number; personId: string };
export type Scenario = { id: string; name: string; changes: ScenarioChange[] };
export type PersonDiff = {
  personId: string;
  fullName: string;
  capacityDays: number;
  scenarioCap: number;
  deltaAvg: number;
  cells: { weekStart: string; livePct: number; scenarioPct: number; delta: number; changed: boolean }[];
};
export type ComputedState = {
  conflictScore: number;
  totalOverAlloc: number;
  warnings: { message: string; severity: "critical" | "warning" }[];
  personStats: Map<string, { weeklyPct: Map<string, number>; capacityDays: number; scenarioCap?: number }>;
};
export type SuggestedPerson = {
  personId: string;
  fullName: string;
  avgAvailDays: number;
  conflictWeeks: number;
  score: number;
  canFullyCover: boolean;
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */

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

/** Returns true if week [weekStart, weekStart+6] overlaps [start, end] */
function weekOverlaps(weekStart: string, allocStart: string, allocEnd: string): boolean {
  const wEnd = addWeeks(weekStart, 1);
  return weekStart < allocEnd && wEnd > allocStart;
}

/* ── weeksInRange ────────────────────────────────────────────────────────── */

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

/* ── applyChanges ────────────────────────────────────────────────────────── */

export function applyChanges(
  people: LivePerson[],
  projects: LiveProject[],
  allocations: LiveAllocation[],
  exceptions: LiveException[],
  changes: ScenarioChange[]
): { allocations: LiveAllocation[]; projects: LiveProject[]; scenarioCap: Map<string, number> } {
  let scAllocs: LiveAllocation[] = allocations.map(a => ({ ...a }));
  let scProjects: LiveProject[]  = projects.map(p => ({ ...p }));
  const scenarioCap = new Map<string, number>();

  for (const change of changes) {
    if (change.type === "add_allocation") {
      scAllocs.push({
        personId:   change.personId,
        projectId:  change.projectId,
        daysPerWeek: change.daysPerWeek,
        startDate:  change.startDate,
        endDate:    change.endDate,
      });
    }

    else if (change.type === "swap_allocation") {
      scAllocs = scAllocs.map(a => {
        if (
          a.personId  === change.fromPersonId &&
          a.projectId === change.projectId &&
          a.startDate <= change.endDate &&
          a.endDate   >= change.startDate
        ) {
          return { ...a, personId: change.toPersonId };
        }
        return a;
      });
    }

    else if (change.type === "change_capacity") {
      // Store per-person-week capacity overrides
      const weeks = weeksInRange(change.startDate, change.endDate);
      for (const w of weeks) {
        scenarioCap.set(`${change.personId}::${w}`, change.newCapacity);
      }
    }

    else if (change.type === "shift_project") {
      scProjects = scProjects.map(p => {
        if (p.projectId !== change.projectId) return p;
        const newStart = addWeeks(p.startDate, change.shiftWeeks);
        const newEnd   = addWeeks(p.endDate,   change.shiftWeeks);
        return { ...p, startDate: newStart, endDate: newEnd };
      });
      // Also shift allocations on that project
      scAllocs = scAllocs.map(a => {
        if (a.projectId !== change.projectId) return a;
        return {
          ...a,
          startDate: addWeeks(a.startDate, change.shiftWeeks),
          endDate:   addWeeks(a.endDate,   change.shiftWeeks),
        };
      });
    }

    else if (change.type === "add_project") {
      scProjects.push({
        projectId: change.projectId,
        title:     change.title,
        colour:    change.colour,
        startDate: change.startDate,
        endDate:   change.endDate,
      });
      scAllocs.push({
        personId:    change.personId,
        projectId:   change.projectId,
        daysPerWeek: change.daysPerWeek,
        startDate:   change.startDate,
        endDate:     change.endDate,
      });
    }
  }

  return { allocations: scAllocs, projects: scProjects, scenarioCap };
}

/* ── computeState ────────────────────────────────────────────────────────── */

export function computeState(
  people: LivePerson[],
  projects: LiveProject[],
  allocations: LiveAllocation[],
  exceptions: LiveException[],
  weeks: string[],
  capOverrides: Map<string, number>
): ComputedState {
  // Build exception lookup: personId::weekStart -> overrideCapacity
  const exMap = new Map<string, number>();
  for (const ex of exceptions) {
    exMap.set(`${ex.personId}::${ex.weekStart}`, ex.capacityOverride);
  }

  const personStats = new Map<string, {
    weeklyPct: Map<string, number>;
    capacityDays: number;
    scenarioCap?: number;
  }>();

  let totalOverAlloc = 0;
  const warnings: ComputedState["warnings"] = [];

  for (const person of people) {
    const weeklyPct = new Map<string, number>();

    for (const week of weeks) {
      // Resolve capacity for this person+week
      const scenCapKey = `${person.personId}::${week}`;
      const cap =
        capOverrides.get(scenCapKey) ??
        exMap.get(scenCapKey) ??
        person.capacityDays;

      if (cap === 0) {
        weeklyPct.set(week, 0);
        continue;
      }

      // Sum allocated days across all overlapping allocations
      let allocatedDays = 0;
      for (const alloc of allocations) {
        if (alloc.personId !== person.personId) continue;
        if (!weekOverlaps(week, alloc.startDate, alloc.endDate)) continue;
        allocatedDays += alloc.daysPerWeek;
      }

      const pct = Math.round((allocatedDays / cap) * 100);
      weeklyPct.set(week, pct);

      if (pct > 100) totalOverAlloc++;
    }

    personStats.set(person.personId, {
      weeklyPct,
      capacityDays: person.capacityDays,
    });
  }

  // Conflict score: weighted over-allocation metric (0-100)
  const allPcts: number[] = [];
  for (const [, stats] of personStats) {
    for (const [, pct] of stats.weeklyPct) {
      allPcts.push(pct);
    }
  }

  const overAllocPcts = allPcts.filter(p => p > 100);
  let conflictScore = 0;
  if (allPcts.length > 0 && overAllocPcts.length > 0) {
    const avgOver = overAllocPcts.reduce((s, p) => s + (p - 100), 0) / overAllocPcts.length;
    const breadth = overAllocPcts.length / allPcts.length; // 0..1
    conflictScore = Math.min(100, Math.round(breadth * 60 + (avgOver / 50) * 40));
  }

  // Generate warnings
  for (const [personId, stats] of personStats) {
    const person = people.find(p => p.personId === personId);
    if (!person) continue;
    const critWeeks = [...stats.weeklyPct.values()].filter(p => p > 110).length;
    const overWeeks = [...stats.weeklyPct.values()].filter(p => p > 100).length;
    if (critWeeks > 0) {
      warnings.push({
        severity: "critical",
        message: `${person.fullName} is >110% for ${critWeeks} week${critWeeks > 1 ? "s" : ""}`,
      });
    } else if (overWeeks > 0) {
      warnings.push({
        severity: "warning",
        message: `${person.fullName} is over-allocated for ${overWeeks} week${overWeeks > 1 ? "s" : ""}`,
      });
    }
  }

  return { conflictScore, totalOverAlloc, warnings, personStats };
}

/* ── computeDiff ─────────────────────────────────────────────────────────── */

export function computeDiff(
  live: ComputedState,
  scenario: ComputedState,
  weeks: string[],
  people?: LivePerson[]
): PersonDiff[] {
  const diffs: PersonDiff[] = [];

  // Union of all personIds across both states
  const allPersonIds = new Set([
    ...live.personStats.keys(),
    ...scenario.personStats.keys(),
  ]);

  for (const personId of allPersonIds) {
    const liveStats = live.personStats.get(personId);
    const scStats   = scenario.personStats.get(personId);
    if (!liveStats && !scStats) continue;

    const capacityDays = liveStats?.capacityDays ?? scStats?.capacityDays ?? 5;
    const scenarioCap  = scStats?.capacityDays   ?? capacityDays;

    const cells: PersonDiff["cells"] = [];
    let deltaSum = 0;
    let deltaCount = 0;

    for (const week of weeks) {
      const livePct     = liveStats?.weeklyPct.get(week) ?? 0;
      const scenarioPct = scStats?.weeklyPct.get(week)   ?? 0;
      const delta       = scenarioPct - livePct;
      const changed     = delta !== 0;

      cells.push({ weekStart: week, livePct, scenarioPct, delta, changed });

      if (changed) {
        deltaSum += delta;
        deltaCount++;
      }
    }

    const deltaAvg = deltaCount > 0 ? Math.round(deltaSum / deltaCount) : 0;

    // Only include people who appear in the scenario state (have allocations)
    // or have changes relative to live
    const hasAnyAlloc = cells.some(c => c.scenarioPct > 0 || c.livePct > 0);
    if (!hasAnyAlloc) continue;

    // We need fullName — look it up from scenario stats first, then live
    // The personStats map doesn't store fullName, so we resolve it from the change
    // The caller (component) will map personId -> fullName via people prop
    // We include personId and will resolve below
    diffs.push({
      personId,
      fullName: people?.find(p => p.personId === personId)?.fullName ?? personId,
      capacityDays,
      scenarioCap,
      deltaAvg,
      cells,
    });
  }

  return diffs;
}

/* ── autoSuggest ─────────────────────────────────────────────────────────── */

export function autoSuggest(
  people: LivePerson[],
  allocations: LiveAllocation[],
  exceptions: LiveException[],
  start: string,
  end: string,
  daysNeeded: number
): SuggestedPerson[] {
  const weeks = weeksInRange(start, end);
  const exMap = new Map<string, number>();
  for (const ex of exceptions) {
    exMap.set(`${ex.personId}::${ex.weekStart}`, ex.capacityOverride);
  }

  const results: SuggestedPerson[] = [];

  for (const person of people) {
    let totalAvail = 0;
    let conflictWeeks = 0;
    let fullCoverWeeks = 0;

    for (const week of weeks) {
      const cap = exMap.get(`${person.personId}::${week}`) ?? person.capacityDays;
      let allocated = 0;
      for (const alloc of allocations) {
        if (alloc.personId !== person.personId) continue;
        if (!weekOverlaps(week, alloc.startDate, alloc.endDate)) continue;
        allocated += alloc.daysPerWeek;
      }
      const avail = Math.max(0, cap - allocated);
      totalAvail += avail;
      if (avail < daysNeeded) conflictWeeks++;
      if (avail >= daysNeeded) fullCoverWeeks++;
    }

    const avgAvailDays = weeks.length > 0 ? Math.round((totalAvail / weeks.length) * 10) / 10 : 0;
    const canFullyCover = fullCoverWeeks === weeks.length;

    // Score: higher = better fit. Penalise conflicts, reward availability.
    const score = Math.round(
      (avgAvailDays / Math.max(1, person.capacityDays)) * 60 +
      ((weeks.length - conflictWeeks) / Math.max(1, weeks.length)) * 40
    );

    results.push({
      personId:    person.personId,
      fullName:    person.fullName,
      avgAvailDays,
      conflictWeeks,
      score,
      canFullyCover,
    });
  }

  // Sort by score descending
  return results.sort((a, b) => b.score - a.score).slice(0, 5);
}