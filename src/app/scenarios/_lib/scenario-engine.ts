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
  personStats: Map<string, any>;
};

export type SuggestedPerson = {
  personId: string;
  fullName: string;
  avgAvailDays: number;
  conflictWeeks: number;
  score: number;
  canFullyCover: boolean;
};

export function weeksInRange(from: string, to: string): string[] {
  const weeks: string[] = [];
  let curr = new Date(from + "T00:00:00");
  const stop = new Date(to + "T00:00:00");
  while (curr <= stop) {
    weeks.push(curr.toISOString().split("T")[0]);
    curr.setDate(curr.getDate() + 7);
  }
  return weeks;
}

export function applyChanges(people: LivePerson[], projects: LiveProject[], allocations: LiveAllocation[], exceptions: LiveException[], changes: ScenarioChange[]) {
  let scAllocs = [...allocations];
  let scProjects = [...projects];
  let scenarioCap = new Map<string, number>();
  // Engine logic goes here
  return { allocations: scAllocs, projects: scProjects, scenarioCap };
}

export function computeState(people: LivePerson[], projects: LiveProject[], allocations: LiveAllocation[], exceptions: LiveException[], weeks: string[], capOverrides: Map<string, number>): ComputedState {
  return { conflictScore: 0, totalOverAlloc: 0, personStats: new Map() };
}

export function computeDiff(live: ComputedState, scenario: ComputedState, weeks: string[]): PersonDiff[] {
  return [];
}

export function autoSuggest(people: LivePerson[], allocations: LiveAllocation[], exceptions: LiveException[], start: string, end: string, days: number): SuggestedPerson[] {
  return [];
}
