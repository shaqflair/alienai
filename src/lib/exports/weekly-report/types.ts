export type Rag = "green" | "amber" | "red";

export type WeeklyReportProject = {
  id?: string | null;
  code?: string | null;
  name?: string | null;
  managerName?: string | null;
  managerEmail?: string | null;
};

export type WeeklyReportV1 = {
  version: 1;
  project?: WeeklyReportProject;

  period: { from: string; to: string }; // ISO yyyy-mm-dd
  summary: { rag: Rag; headline: string; narrative: string };

  delivered: Array<{ text: string }>;
  planNextWeek: Array<{ text: string }>;

  resourceSummary?: Array<{ text: string }>;
  keyDecisions?: Array<{ text: string; link?: string | null }>;
  blockers?: Array<{ text: string; link?: string | null }>;

  // optional extra lists (even if not shown in editor sections)
  milestones?: Array<{ name: string; due: string | null; status: string | null; critical?: boolean }>;
  changes?: Array<{ title: string; status: string | null; link?: string | null }>;
  raid?: Array<{ title: string; type?: string | null; status?: string | null; due?: string | null; owner?: string | null }>;

  metrics?: { milestonesDone?: number; wbsDone?: number; changesClosed?: number; raidClosed?: number };
  meta?: { generated_at?: string; sources?: any };
};
