export type Phase = { id: string; name: string };

export type ItemType = "task" | "milestone" | "deliverable";

export type Item = {
  id: string;
  phaseId: string | null;
  type: ItemType;
  name: string;
  start: Date;
  end?: Date | null;
  status?: string | null;
  progress?: number | null;
  dependencies?: string[];
  notes?: string | null;
};

export type NormalizedSchedule = {
  phases: Phase[];
  items: Item[];
};

export type WeekSeg = {
  start: Date;
  endExclusive: Date;
  label: string;
  dateRange: string;
};

export type TimeWindow = {
  start: Date;
  endExclusive: Date;
  weekSegs: WeekSeg[];
  label: string;
};

export type LaneAssignment = {
  laneOf: Record<string, number>;
  lanesCount: number;
};
