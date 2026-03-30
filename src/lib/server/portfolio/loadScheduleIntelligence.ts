import "server-only";

import type { PortfolioFilters } from "@/lib/server/home/loadDashboardSummaryData";
import { createClient } from "@/utils/supabase/server";

type LoadArgs = {
  userId: string;
  days?: 7 | 14 | 30 | 60;
  filters?: PortfolioFilters;
  supabase?: Awaited<ReturnType<typeof createClient>>;
};

type Tone = "positive" | "neutral" | "warning";

type MilestoneRow = {
  id: string;
  title?: string | null;
  name?: string | null;
  due_date?: string | null;
  target_date?: string | null;
  date?: string | null;
  status?: string | null;
  project_id?: string | null;
  project?: {
    id?: string | null;
    title?: string | null;
    project_code?: string | null;
  } | null;
  projects?: {
    id?: string | null;
    title?: string | null;
    project_code?: string | null;
  } | null;
};

export type ScheduleIntelligencePayload = {
  ok: true;
  windowDays: 7 | 14 | 30 | 60;
  dueSoon: Array<{
    id: string;
    title: string;
    date: string;
    project_id: string;
    project_title?: string | null;
    project_code?: string | null;
    status?: string | null;
  }>;
  nextMilestone: {
    id: string;
    title: string;
    date: string;
    project_id: string;
    project_title?: string | null;
    project_code?: string | null;
    status?: string | null;
  } | null;
  totalMilestones: number;
  hasAny: boolean;
  signals: {
    hasOverdue: boolean;
    overdueCount: number;
    atRiskCount: number;
  };
  insight: {
    summary: string;
    tone: Tone;
  };
  meta: {
    projectCount: number;
    completeness?: "full" | "partial" | "empty";
    reason?: string | null;
  };
};

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function uniqStrings(input: unknown): string[] {
  const out = new Set<string>();

  const push = (v: unknown) => {
    const s = safeStr(v).trim();
    if (s) out.add(s);
  };

  if (Array.isArray(input)) input.forEach(push);
  else if (typeof input === "string") input.split(",").forEach(push);
  else if (input != null) push(input);

  return Array.from(out);
}

function normalizeWindow(days?: unknown): 7 | 14 | 30 | 60 {
  const n = Number(days ?? 30);
  if (!Number.isFinite(n)) return 30;
  if (n <= 7) return 7;
  if (n <= 14) return 14;
  if (n <= 30) return 30;
  return 60;
}

function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function parseDateLike(value: unknown): Date | null {
  const s = safeStr(value).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function looksMissingColumn(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

function looksMissingRelation(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("relation") ||
    msg.includes("does not exist") ||
    msg.includes("42p01")
  );
}

function milestoneTitle(row: MilestoneRow) {
  return safeStr(row.title || row.name).trim() || "Milestone";
}

function milestoneDateValue(row: MilestoneRow) {
  return safeStr(row.due_date || row.target_date || row.date).trim();
}

function projectJoin(row: MilestoneRow) {
  return row.projects ?? row.project ?? null;
}

function normalizeMilestone(row: MilestoneRow) {
  const joined = projectJoin(row);

  return {
    id: safeStr(row.id).trim(),
    title: milestoneTitle(row),
    date: milestoneDateValue(row),
    project_id: safeStr(row.project_id || joined?.id).trim(),
    project_title: safeStr(joined?.title).trim() || null,
    project_code: safeStr(joined?.project_code).trim() || null,
    status: safeStr(row.status).trim() || null,
  };
}

function buildInsight(args: {
  hasAny: boolean;
  dueSoonCount: number;
  overdueCount: number;
  nextMilestone: ScheduleIntelligencePayload["nextMilestone"];
  windowDays: 7 | 14 | 30 | 60;
}): { summary: string; tone: Tone } {
  const { hasAny, dueSoonCount, overdueCount, nextMilestone, windowDays } = args;

  if (!hasAny) {
    return {
      summary: "No milestones defined — schedule visibility limited.",
      tone: "warning",
    };
  }

  if (overdueCount > 0) {
    return {
      summary: `${overdueCount} milestone(s) overdue — schedule risk detected.`,
      tone: "warning",
    };
  }

  if (dueSoonCount > 0) {
    return {
      summary: `${dueSoonCount} milestone(s) due in the next ${windowDays} days.`,
      tone: "neutral",
    };
  }

  if (nextMilestone) {
    return {
      summary: `No milestones due in the next ${windowDays} days — next milestone scheduled ahead.`,
      tone: "positive",
    };
  }

  return {
    summary: `No milestones due in the next ${windowDays} days — schedule on track.`,
    tone: "positive",
  };
}

async function fetchScopedProjectIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filters?: PortfolioFilters,
): Promise<string[]> {
  const explicitIds = uniqStrings(filters?.projectId);
  if (explicitIds.length) return explicitIds;
  return [];
}

async function getMilestoneRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectIds: string[],
): Promise<MilestoneRow[]> {
  if (!projectIds.length) return [];

  const selectSets = [
    "id, title, due_date, status, project_id, projects:project_id (id, title, project_code)",
    "id, name, due_date, status, project_id, projects:project_id (id, title, project_code)",
    "id, title, target_date, status, project_id, projects:project_id (id, title, project_code)",
    "id, title, due_date, project_id, projects:project_id (id, title, project_code)",
    "id, title, due_date, status, project_id",
    "id, name, due_date, status, project_id",
    "id, title, target_date, status, project_id"
  ];

  let lastError: any = null;

  for (const sel of selectSets) {
    const { data, error } = await supabase
      .from("schedule_milestones")
      .select(sel)
      .in("project_id", projectIds)
      .limit(5000);

    if (!error && Array.isArray(data)) {
      return data as MilestoneRow[];
    }

    lastError = error;
    if (!(looksMissingColumn(error) || looksMissingRelation(error))) break;
  }

  console.warn("[loadScheduleIntelligence] failed to load schedule_milestones", {
    projectCount: projectIds.length,
    error: safeStr(lastError?.message || lastError),
  });

  return [];
}

export async function loadScheduleIntelligence(
  args: LoadArgs,
): Promise<ScheduleIntelligencePayload> {
  const supabase = args.supabase ?? (await createClient());
  const windowDays = normalizeWindow(args.days);
  const projectIds = await fetchScopedProjectIds(supabase, args.filters);

  if (!projectIds.length) {
    return {
      ok: true,
      windowDays,
      dueSoon: [],
      nextMilestone: null,
      totalMilestones: 0,
      hasAny: false,
      signals: {
        hasOverdue: false,
        overdueCount: 0,
        atRiskCount: 0,
      },
      insight: {
        summary: "No active projects in scope — schedule visibility unavailable.",
        tone: "neutral",
      },
      meta: {
        projectCount: 0,
        completeness: "empty",
        reason: "NO_PROJECT_SCOPE",
      },
    };
  }

  const rows = await getMilestoneRows(supabase, projectIds);
  const normalized = rows
    .map(normalizeMilestone)
    .filter((m) => m.id && m.date);

  const today = startOfTodayUtc();
  const windowEnd = addDays(today, windowDays);

  const dated = normalized
    .map((m) => ({
      ...m,
      _date: parseDateLike(m.date),
    }))
    .filter((m) => m._date);

  const dueSoon = dated
    .filter((m) => m._date! >= today && m._date! <= windowEnd)
    .sort((a, b) => a._date!.getTime() - b._date!.getTime())
    .map(({ _date, ...m }) => m);

  const futureMilestones = dated
    .filter((m) => m._date! > windowEnd)
    .sort((a, b) => a._date!.getTime() - b._date!.getTime());

  const nextMilestone =
    dueSoon[0] ??
    (futureMilestones[0]
      ? (() => {
          const { _date, ...m } = futureMilestones[0];
          return m;
        })()
      : null);

  const overdueCount = dated.filter((m) => m._date! < today).length;
  const hasAny = normalized.length > 0;

  const insight = buildInsight({
    hasAny,
    dueSoonCount: dueSoon.length,
    overdueCount,
    nextMilestone,
    windowDays,
  });

  return {
    ok: true,
    windowDays,
    dueSoon,
    nextMilestone,
    totalMilestones: normalized.length,
    hasAny,
    signals: {
      hasOverdue: overdueCount > 0,
      overdueCount,
      atRiskCount: 0,
    },
    insight,
    meta: {
      projectCount: projectIds.length,
      completeness: hasAny ? "full" : "empty",
      reason: hasAny ? null : "NO_MILESTONES_DEFINED",
    },
  };
}

export default loadScheduleIntelligence;
