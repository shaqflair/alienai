import "server-only";

import { createClient } from "@/utils/supabase/server";

export type Sentiment = "green" | "amber" | "red" | "neutral";
export type SectionId = "health" | "risk" | "delivery" | "finance";

export type BriefingData = {
  ok: boolean;
  executive_summary?: string;
  sections?: {
    id: SectionId;
    title: string;
    body: string;
    sentiment: Sentiment;
  }[];
  talking_points?: string[];
  gaps?: {
    severity: "high" | "medium" | "low";
    type: string;
    detail: string;
    project?: string;
    href?: string;
  }[];
  signals_summary?: {
    project_count: number;
    rag: { g: number; a: number; r: number; unscored: number };
    avg_health: number | null;
    overdue_approvals?: number;
    high_raid?: number;
  };
  generated_at?: string;
  error?: string;
};

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function safeNum(x: unknown): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function uniqNonEmptyStrings(values: unknown[]): string[] {
  const out = new Set<string>();
  for (const v of values) {
    const s = safeStr(v).trim();
    if (s) out.add(s);
  }
  return Array.from(out);
}

function averageRounded(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round(values.reduce((sum, n) => sum + n, 0) / values.length);
}

function formatCurrency(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `\u00a3${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `\u00a3${(n / 1_000).toFixed(0)}k`;
  return `\u00a3${n.toFixed(0)}`;
}

function buildExecutiveSummary(args: {
  dominant: Sentiment;
  redCount: number;
  amberCount: number;
  greenCount: number;
  highRaid: number;
  overdueApprovals: number;
}): string {
  const { dominant, redCount, amberCount, greenCount, highRaid, overdueApprovals } = args;
  if (dominant === "red") {
    if (highRaid > 0 || overdueApprovals > 0) return "Portfolio requires executive attention. Red delivery signals are present alongside governance or RAID pressure that should be reviewed immediately.";
    return "Portfolio requires executive attention. Red delivery signals are present and should be reviewed immediately.";
  }
  if (dominant === "amber") {
    if (highRaid > 0 || overdueApprovals > 0) return "Portfolio is broadly stable, but delivery and governance signals indicate areas that require active monitoring.";
    return "Portfolio is broadly stable, but several delivery signals require monitoring.";
  }
  if (dominant === "green") {
    if (amberCount > 0) return "Portfolio is performing well overall, with most delivery signals on track and a small number of areas to watch.";
    if (greenCount > 0) return "Portfolio is performing well overall, with delivery signals currently on track.";
  }
  return "Portfolio narrative is available, but there is limited scoring data to assess overall health.";
}

async function countHighRaidWithProjects(args: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  projectIds: string[];
  organisationId: string | null;
}): Promise<{ count: number; projectNames: string[] }> {
  const { supabase, projectIds, organisationId } = args;
  const openStatuses = ["Open", "open", "OPEN", "active", "Active"];
  const highPriorities = ["High", "high", "HIGH", "Critical", "critical", "CRITICAL"];
  try {
    let query = supabase
      .from("raid_items")
      .select("id, title, project_id, projects(title, project_code)")
      .in("status", openStatuses)
      .in("priority", highPriorities)
      .limit(10);
    if (projectIds.length > 0) query = query.in("project_id", projectIds);
    else if (organisationId) query = query.eq("organisation_id", organisationId);
    else return { count: 0, projectNames: [] };
    const { data, error } = await query;
    if (error) return { count: 0, projectNames: [] };
    const rows = data ?? [];
    const names = new Set<string>();
    for (const row of rows) {
      const proj = (row as any).projects;
      const code = safeStr(proj?.project_code).trim();
      const title = safeStr(proj?.title).trim();
      if (code) names.add(code);
      else if (title) names.add(title);
    }
    return { count: rows.length, projectNames: Array.from(names) };
  } catch {
    return { count: 0, projectNames: [] };
  }
}

async function countOverdueApprovals(args: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  organisationId: string | null;
  nowIso: string;
}): Promise<number> {
  const { supabase, organisationId, nowIso } = args;
  if (!organisationId) return 0;
  try {
    const { count, error } = await supabase
      .from("approval_chains")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .eq("status", "pending")
      .lt("due_date", nowIso);
    if (!error) return count ?? 0;
  } catch { /* fail-open */ }
  return 0;
}

async function loadFinanceSummary(args: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  projectIds: string[];
  organisationId: string | null;
}): Promise<{ body: string; sentiment: Sentiment; talkingPoint: string | null }> {
  const { supabase, projectIds, organisationId } = args;
  const noData = { body: "No budget data has been entered yet. Add financial plans to your projects to see portfolio-level budget analysis here.", sentiment: "neutral" as Sentiment, talkingPoint: null };
  try {
    let ids = projectIds;
    if (!ids.length && organisationId) {
      const { data: projRows } = await supabase.from("projects").select("id").eq("organisation_id", organisationId).is("deleted_at", null).limit(50);
      ids = (projRows ?? []).map((r: any) => r.id).filter(Boolean);
    }
    if (!ids.length) return noData;

    // Query budget_amount and budget_days directly from projects table
    const { data, error } = await supabase
      .from("projects")
      .select("id, title, project_code, budget_amount, budget_days")
      .in("id", ids)
      .is("deleted_at", null)
      .limit(50);

    if (error || !data?.length) return noData;

    let totalBudget = 0;
    let totalBudgetDays = 0;
    let projectsWithBudget = 0;

    for (const row of data) {
      const amount = safeNum((row as any).budget_amount);
      const days = safeNum((row as any).budget_days);
      if (amount != null && amount > 0) {
        totalBudget += amount;
        projectsWithBudget++;
      }
      if (days != null && days > 0) totalBudgetDays += days;
    }

    if (projectsWithBudget === 0 && totalBudgetDays === 0) return noData;

    const budgetStr = totalBudget > 0 ? formatCurrency(totalBudget) : null;
    const projectCount = data.length;

    let body = "";
    if (budgetStr) {
      body = `Total portfolio budget is ${budgetStr} across ${projectCount} project${projectCount !== 1 ? "s" : ""}.`;
    }
    if (totalBudgetDays > 0) {
      body += body ? ` ${totalBudgetDays} budget days allocated.` : `${totalBudgetDays} budget days allocated across ${projectCount} project${projectCount !== 1 ? "s" : ""}.`;
    }
    if (!body) return noData;

    const sentiment: Sentiment = "neutral";
    const talkingPoint = budgetStr
      ? `Portfolio budget is ${budgetStr}.${totalBudgetDays > 0 ? ` ${totalBudgetDays} days budgeted.` : ""}`
      : `${totalBudgetDays} budget days allocated across the portfolio.`;

    return { body, sentiment, talkingPoint };
  } catch {
    return noData;
  }
}

export async function loadExecutiveBriefing(args: {
  projectScores?: Record<string, { score: number; rag: "G" | "A" | "R" }>;
  liveRagCounts?: { g: number; a: number; r: number };
  projectIds?: string[];
  organisationId?: string | null;
  liveHealthScore?: number | null;
}): Promise<BriefingData | null> {
  try {
    const supabase = await createClient();
    const nowIso = new Date().toISOString();
    const projectScores  = args.projectScores  ?? {};
    const liveRagCounts  = args.liveRagCounts  ?? { g: 0, a: 0, r: 0 };
    const organisationId = args.organisationId ?? null;

    const scoreEntries = Object.entries(projectScores);
    const scoreVals: number[] = [];
    const derivedProjectIds: string[] = [];
    for (const [projectId, value] of scoreEntries) {
      const cleanId = safeStr(projectId).trim();
      if (cleanId) derivedProjectIds.push(cleanId);
      const score = safeNum(value?.score);
      if (score != null) scoreVals.push(score);
    }

    const projectIds = uniqNonEmptyStrings([...(args.projectIds ?? []), ...derivedProjectIds]);

    // Use the live portfolio API score if passed, otherwise average from project scores
    const avgHealth = args.liveHealthScore != null
      ? Math.round(args.liveHealthScore)
      : averageRounded(scoreVals);

    const projectCount = projectIds.length || scoreEntries.length;

    const [raidResult, overdueApprovals, financeResult] = await Promise.all([
      countHighRaidWithProjects({ supabase, projectIds, organisationId }),
      countOverdueApprovals({ supabase, organisationId, nowIso }),
      loadFinanceSummary({ supabase, projectIds, organisationId }),
    ]);

    const highRaid = raidResult.count;
    const raidProjectNames = raidResult.projectNames;

    const dominant: Sentiment =
      liveRagCounts.r > 0 ? "red"
      : liveRagCounts.a > 0 ? "amber"
      : liveRagCounts.g > 0 ? "green"
      : "neutral";

    const executive_summary = buildExecutiveSummary({
      dominant,
      redCount:   liveRagCounts.r,
      amberCount: liveRagCounts.a,
      greenCount: liveRagCounts.g,
      highRaid,
      overdueApprovals,
    });

    const healthSentiment: Sentiment =
      avgHealth == null ? dominant : avgHealth < 70 ? "red" : avgHealth < 85 ? "amber" : "green";

    const riskSentiment: Sentiment =
      highRaid > 0 ? (highRaid >= 5 ? "red" : "amber") : "green";

    const deliverySentiment: Sentiment =
      liveRagCounts.r > 0 ? "red" : liveRagCounts.a > 0 ? "amber" : liveRagCounts.g > 0 ? "green" : "neutral";

    // Build RAID body with project names
    let raidBody: string;
    if (highRaid === 0) {
      raidBody = "No high or critical RAID items are currently open across the portfolio.";
    } else {
      const itemLabel = highRaid === 1 ? "item is" : "items are";
      raidBody = raidProjectNames.length > 0
        ? `${highRaid} high or critical RAID ${itemLabel} currently open, affecting: ${raidProjectNames.join(", ")}.`
        : `${highRaid} high or critical RAID ${itemLabel} currently open across the portfolio and require attention.`;
    }

    const sections: BriefingData["sections"] = [
      {
        id: "health",
        title: "Health",
        sentiment: healthSentiment,
        body: avgHealth != null
          ? `Average portfolio health is ${avgHealth}%. Current mix: ${liveRagCounts.g} green, ${liveRagCounts.a} amber, ${liveRagCounts.r} red.`
          : "Average health is not yet available from live scoring.",
      },
      {
        id: "risk",
        title: "Risk",
        sentiment: riskSentiment,
        body: raidBody,
      },
      {
        id: "delivery",
        title: "Delivery",
        sentiment: deliverySentiment,
        body: liveRagCounts.r > 0
          ? "At least one project is in red and may need direct intervention to protect delivery outcomes."
          : liveRagCounts.a > 0
            ? "Some projects are showing amber signals and should be tracked closely."
            : liveRagCounts.g > 0
              ? "Delivery signals are currently healthy across the visible portfolio."
              : "Delivery narrative is available, but live project scoring is still limited.",
      },
      {
        id: "finance",
        title: "Finance",
        sentiment: financeResult.sentiment,
        body: financeResult.body,
      },
    ];

    const talking_points = [
      `Portfolio mix is ${liveRagCounts.g} green / ${liveRagCounts.a} amber / ${liveRagCounts.r} red.`,
      avgHealth != null ? `Average health is ${avgHealth}%.` : "Average health is still being established from live data.",
      highRaid > 0
        ? `${highRaid} high or critical RAID item${highRaid === 1 ? "" : "s"} require attention${raidProjectNames.length > 0 ? ` (${raidProjectNames.join(", ")})` : ""}.`
        : "No high-priority RAID items are currently flagged.",
      overdueApprovals > 0
        ? `${overdueApprovals} overdue approval${overdueApprovals === 1 ? "" : "s"} need action.`
        : "No major approval backlog is currently highlighted.",
      ...(financeResult.talkingPoint ? [financeResult.talkingPoint] : []),
    ];

    return {
      ok: true,
      executive_summary,
      sections,
      talking_points,
      gaps: [],
      signals_summary: {
        project_count: projectCount,
        rag: {
          g: liveRagCounts.g,
          a: liveRagCounts.a,
          r: liveRagCounts.r,
          unscored: Math.max(0, projectCount - (liveRagCounts.g + liveRagCounts.a + liveRagCounts.r)),
        },
        avg_health: avgHealth,
        overdue_approvals: overdueApprovals,
        high_raid: highRaid,
      },
      generated_at: nowIso,
    };
  } catch (e: any) {
    return {
      ok: false,
      error: safeStr(e?.message || e),
      generated_at: new Date().toISOString(),
    };
  }
}