import "server-only";

import { createClient } from "@/utils/supabase/server";

/* ─────────────────────────────────────────────────────────────────────────── */
/* Types                                                                        */
/* ─────────────────────────────────────────────────────────────────────────── */

export type Sentiment       = "green" | "amber" | "red" | "neutral";
export type SectionId       = "health" | "risk" | "delivery" | "finance";
export type Trend           = "improving" | "deteriorating" | "stable";
export type Confidence      = "high" | "medium" | "low";
export type DecisionPosture = "act_now" | "monitor" | "hold" | "approve";

export type BriefingSection = {
  id: SectionId;
  title: string;
  body: string;
  sentiment: Sentiment;
  // ── Exec enrichment (new) ──
  trend?: Trend;
  confidence?: Confidence;
  days_in_state?: number;
  next_step?: string;
  business_impact?: string;
  leadership_recommendation?: string;
  decision_posture?: DecisionPosture;
};

export type PortfolioPosture = {
  posture: DecisionPosture;
  rationale: string;
  confidence: Confidence;
};

export type BriefingData = {
  ok: boolean;
  executive_summary?: string;
  // ── New exec fields ──
  portfolio_posture?: PortfolioPosture | null;
  risk_narrative?: string | null;
  // ──────────────────────
  sections?: BriefingSection[];
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

/* ─────────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                      */
/* ─────────────────────────────────────────────────────────────────────────── */

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

function formatCurrency(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `\u00a3${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `\u00a3${(n / 1_000).toFixed(0)}k`;
  return `\u00a3${n.toFixed(0)}`;
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Portfolio Posture derivation                                                 */
/*                                                                              */
/* Priority order:                                                              */
/*   1. act_now  — red projects OR critical RAID (≥5 items) OR overdue approvals */
/*   2. approve  — overdue approvals only (no reds)                            */
/*   3. monitor  — any amber projects OR moderate RAID                         */
/*   4. hold     — all green, no RAID, no approval backlog                     */
/* ─────────────────────────────────────────────────────────────────────────── */

function derivePortfolioPosture(args: {
  redCount: number;
  amberCount: number;
  greenCount: number;
  highRaid: number;
  overdueApprovals: number;
  avgHealth: number;
}): PortfolioPosture {
  const { redCount, amberCount, highRaid, overdueApprovals, avgHealth } = args;

  // act_now: hard blockers present
  if (redCount > 0 || highRaid >= 5 || (overdueApprovals > 0 && highRaid > 0)) {
    const reasons: string[] = [];
    if (redCount > 0)         reasons.push(`${redCount} red project${redCount > 1 ? "s" : ""} need direct intervention`);
    if (highRaid >= 5)        reasons.push(`${highRaid} critical RAID items are open`);
    if (overdueApprovals > 0) reasons.push(`${overdueApprovals} approval${overdueApprovals > 1 ? "s are" : " is"} overdue`);
    return {
      posture:    "act_now",
      rationale:  reasons.join("; ") + ".",
      confidence: redCount > 0 ? "high" : "medium",
    };
  }

  // approve: sign-off backlog is the main blocker
  if (overdueApprovals > 0) {
    return {
      posture:   "approve",
      rationale: `${overdueApprovals} overdue approval${overdueApprovals > 1 ? "s are" : " is"} blocking progress. No red delivery signals.`,
      confidence: "high",
    };
  }

  // monitor: amber signals or moderate RAID
  if (amberCount > 0 || highRaid > 0 || avgHealth < 85) {
    const reasons: string[] = [];
    if (amberCount > 0)   reasons.push(`${amberCount} project${amberCount > 1 ? "s" : ""} in amber`);
    if (highRaid > 0)     reasons.push(`${highRaid} high-priority RAID item${highRaid > 1 ? "s" : ""} open`);
    if (avgHealth < 85)   reasons.push(`portfolio health at ${avgHealth}%`);
    return {
      posture:   "monitor",
      rationale: reasons.join("; ") + ". Trending signals need active oversight.",
      confidence: amberCount > 0 ? "high" : "medium",
    };
  }

  // hold: portfolio healthy
  return {
    posture:   "hold",
    rationale: `Portfolio is healthy at ${avgHealth}% average. All delivery signals are green with no RAID or approval concerns.`,
    confidence: "high",
  };
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Risk Narrative                                                               */
/* ─────────────────────────────────────────────────────────────────────────── */

function buildRiskNarrative(args: {
  dominant: Sentiment;
  redCount: number;
  amberCount: number;
  highRaid: number;
  raidProjectNames: string[];
  overdueApprovals: number;
  avgHealth: number;
}): string {
  const { dominant, redCount, amberCount, highRaid, raidProjectNames, overdueApprovals, avgHealth } = args;

  const parts: string[] = [];

  if (dominant === "red") {
    parts.push(
      `Portfolio carries elevated delivery risk: ${redCount} project${redCount > 1 ? "s are" : " is"} in red, signalling active delivery failure.`
    );
  } else if (dominant === "amber") {
    parts.push(
      `Portfolio risk is moderate: ${amberCount} project${amberCount > 1 ? "s are" : " is"} in amber, indicating conditions that could deteriorate without intervention.`
    );
  } else if (dominant === "green") {
    parts.push(`Portfolio risk is low. Delivery signals are healthy at ${avgHealth}% average health.`);
  } else {
    parts.push(`Portfolio risk is currently unscored — add project health updates to generate a full risk picture.`);
  }

  if (highRaid > 0) {
    const affectedStr = raidProjectNames.length > 0 ? ` affecting ${raidProjectNames.join(", ")}` : "";
    parts.push(
      `${highRaid} high or critical RAID item${highRaid > 1 ? "s" : ""} are open${affectedStr}, representing active risk that requires tracking.`
    );
  }

  if (overdueApprovals > 0) {
    parts.push(
      `${overdueApprovals} approval${overdueApprovals > 1 ? "s are" : " is"} overdue — governance lag can compound delivery risk if unresolved.`
    );
  }

  if (dominant === "green" && highRaid === 0 && overdueApprovals === 0) {
    parts.push("No material risk concentrations are identified at this time.");
  }

  return parts.join(" ");
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Executive summary (unchanged logic)                                          */
/* ─────────────────────────────────────────────────────────────────────────── */

function buildExecutiveSummary(args: {
  dominant: Sentiment;
  redCount: number;
  amberCount: number;
  greenCount: number;
  highRaid: number;
  overdueApprovals: number;
}): string {
  const { dominant, amberCount, greenCount, highRaid, overdueApprovals } = args;
  if (dominant === "red") {
    if (highRaid > 0 || overdueApprovals > 0)
      return "Portfolio requires executive attention. Red delivery signals are present alongside governance or RAID pressure that should be reviewed immediately.";
    return "Portfolio requires executive attention. Red delivery signals are present and should be reviewed immediately.";
  }
  if (dominant === "amber") {
    if (highRaid > 0 || overdueApprovals > 0)
      return "Portfolio is broadly stable, but delivery and governance signals indicate areas that require active monitoring.";
    return "Portfolio is broadly stable, but several delivery signals require monitoring.";
  }
  if (dominant === "green") {
    if (amberCount > 0) return "Portfolio is performing well overall, with most delivery signals on track and a small number of areas to watch.";
    if (greenCount > 0) return "Portfolio is performing well overall, with delivery signals currently on track.";
  }
  return "Portfolio narrative is available, but there is limited scoring data to assess overall health.";
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Section enrichment                                                           */
/*                                                                              */
/* Derives trend, confidence, next_step, business_impact,                      */
/* leadership_recommendation and decision_posture for each section             */
/* purely from the signals already computed.                                   */
/* days_in_state requires persisted history — see note below.                  */
/* ─────────────────────────────────────────────────────────────────────────── */

function enrichHealthSection(args: {
  avgHealth: number;
  redCount: number;
  amberCount: number;
  greenCount: number;
  daysInState?: number;
}): Partial<BriefingSection> {
  const { avgHealth, redCount, amberCount, greenCount, daysInState } = args;

  const sentiment: Sentiment = avgHealth < 70 ? "red" : avgHealth < 85 ? "amber" : "green";

  // Confidence: more projects scored = higher confidence in the signal
  const scoredCount = redCount + amberCount + greenCount;
  const confidence: Confidence = scoredCount >= 5 ? "high" : scoredCount >= 2 ? "medium" : "low";

  // Trend: inferred from balance of reds vs greens (best effort without history)
  const trend: Trend = redCount > greenCount ? "deteriorating" : greenCount > redCount ? "improving" : "stable";

  // Business impact: quantify health as delivery exposure
  const atRiskCount = redCount + amberCount;
  const business_impact = atRiskCount > 0
    ? `${atRiskCount} project${atRiskCount > 1 ? "s" : ""} below threshold — increased cost of delivery failure risk`
    : `All ${greenCount} project${greenCount !== 1 ? "s" : ""} are healthy — delivery exposure is low`;

  const leadership_recommendation =
    sentiment === "red"   ? "Convene a recovery review for all red projects within 48 hours. Assign executive sponsors."
    : sentiment === "amber" ? "Request a written recovery plan from project leads. Review at next portfolio checkpoint."
                            : "No immediate action required. Maintain current cadence.";

  const next_step =
    sentiment === "red"   ? "Schedule red project recovery sessions this week"
    : sentiment === "amber" ? "Request amber project status updates by end of week"
                            : "Review at next scheduled portfolio checkpoint";

  const decision_posture: DecisionPosture =
    sentiment === "red" ? "act_now" : sentiment === "amber" ? "monitor" : "hold";

  return {
    sentiment,
    trend,
    confidence,
    days_in_state: daysInState,
    business_impact,
    leadership_recommendation,
    next_step,
    decision_posture,
  };
}

function enrichRiskSection(args: {
  highRaid: number;
  raidProjectNames: string[];
  daysInState?: number;
}): Partial<BriefingSection> {
  const { highRaid, raidProjectNames, daysInState } = args;

  const sentiment: Sentiment = highRaid === 0 ? "green" : highRaid >= 5 ? "red" : "amber";
  const confidence: Confidence = "high"; // RAID data is authoritative from DB
  const trend: Trend = highRaid === 0 ? "stable" : highRaid >= 5 ? "deteriorating" : "stable";

  const business_impact = highRaid === 0
    ? "No active RAID items — risk exposure is well-controlled"
    : raidProjectNames.length > 0
      ? `Open RAID items on: ${raidProjectNames.join(", ")} — unmitigated risks may impact delivery timelines`
      : `${highRaid} unmitigated high-priority risks in the portfolio`;

  const leadership_recommendation = highRaid === 0
    ? "RAID register is clean. Encourage teams to log emerging risks proactively."
    : highRaid >= 5
      ? `Critical RAID volume (${highRaid} items). Assign a risk owner for each and set resolution deadlines.`
      : `Review the ${highRaid} open RAID item${highRaid > 1 ? "s" : ""} with project leads and confirm mitigation owners.`;

  const next_step = highRaid === 0
    ? "Review RAID register at next portfolio checkpoint"
    : `Assign mitigation owners to all ${highRaid} open RAID item${highRaid > 1 ? "s" : ""} this week`;

  const decision_posture: DecisionPosture =
    sentiment === "red" ? "act_now" : sentiment === "amber" ? "monitor" : "hold";

  return {
    sentiment,
    trend,
    confidence,
    days_in_state: daysInState,
    business_impact,
    leadership_recommendation,
    next_step,
    decision_posture,
  };
}

function enrichDeliverySection(args: {
  redCount: number;
  amberCount: number;
  greenCount: number;
  overdueApprovals: number;
  daysInState?: number;
}): Partial<BriefingSection> {
  const { redCount, amberCount, greenCount, overdueApprovals, daysInState } = args;

  const sentiment: Sentiment =
    redCount > 0   ? "red"
    : amberCount > 0 ? "amber"
    : greenCount > 0 ? "green"
    : "neutral";

  const confidence: Confidence = (redCount + amberCount + greenCount) >= 3 ? "high" : "medium";
  const trend: Trend = redCount > 0 ? "deteriorating" : greenCount > amberCount ? "improving" : "stable";

  const atRisk = redCount + amberCount;
  const business_impact = redCount > 0
    ? `${redCount} project${redCount > 1 ? "s" : ""} at risk of missing committed deliverables`
    : amberCount > 0
      ? `${amberCount} project${amberCount > 1 ? "s" : ""} showing delivery pressure — risk of slippage without intervention`
      : `Delivery pipeline is healthy — all ${greenCount} project${greenCount !== 1 ? "s" : ""} on track`;

  const leadership_recommendation = redCount > 0
    ? "Escalate red projects to executive sponsors immediately. Review against contractual commitments."
    : amberCount > 0
      ? `Direct project leads to produce a recovery plan for the ${amberCount} amber project${amberCount > 1 ? "s" : ""}.`
      : overdueApprovals > 0
        ? `Approve ${overdueApprovals} pending item${overdueApprovals > 1 ? "s" : ""} to unblock delivery.`
        : "Delivery is on track. No escalation required at this time.";

  const next_step = redCount > 0
    ? `Escalate ${redCount} red project${redCount > 1 ? "s" : ""} to exec sponsors — request recovery plan by EOW`
    : amberCount > 0
      ? `Request written recovery plan from ${amberCount} amber project lead${amberCount > 1 ? "s" : ""}`
      : overdueApprovals > 0
        ? `Clear ${overdueApprovals} overdue approval${overdueApprovals > 1 ? "s" : ""} to unblock delivery`
        : "Maintain current delivery cadence";

  const decision_posture: DecisionPosture =
    redCount > 0       ? "act_now"
    : overdueApprovals > 0 ? "approve"
    : amberCount > 0      ? "monitor"
    : "hold";

  return {
    sentiment,
    trend,
    confidence,
    days_in_state: daysInState,
    business_impact,
    leadership_recommendation,
    next_step,
    decision_posture,
  };
}

function enrichFinanceSection(args: {
  baseSentiment: Sentiment;
  totalBudget: number;
  projectsWithBudget: number;
  daysInState?: number;
}): Partial<BriefingSection> {
  const { baseSentiment, totalBudget, projectsWithBudget, daysInState } = args;

  // Confidence is lower when few projects have budget data
  const confidence: Confidence = projectsWithBudget >= 3 ? "high" : projectsWithBudget >= 1 ? "medium" : "low";
  const trend: Trend = "stable"; // no variance data yet

  const business_impact = totalBudget > 0
    ? `${formatCurrency(totalBudget)} total portfolio budget across ${projectsWithBudget} project${projectsWithBudget !== 1 ? "s" : ""}`
    : "Budget data is incomplete — financial exposure cannot be fully assessed";

  const leadership_recommendation = projectsWithBudget === 0
    ? "Request project leads to enter budget plans so financial health can be tracked."
    : baseSentiment === "red"
      ? "Portfolio is over budget. Request a financial recovery plan from the PMO."
      : baseSentiment === "amber"
        ? "Budget pressure is emerging. Forecast to completion before the next board review."
        : "Budget is on track. Ensure projects log forecast-to-complete before next period review.";

  const next_step = projectsWithBudget === 0
    ? "Ask project leads to enter budget data this sprint"
    : "Confirm forecast-to-complete figures ahead of next period close";

  const decision_posture: DecisionPosture =
    baseSentiment === "red" ? "act_now" : baseSentiment === "amber" ? "monitor" : "hold";

  return {
    sentiment: baseSentiment,
    trend,
    confidence,
    days_in_state: daysInState,
    business_impact,
    leadership_recommendation,
    next_step,
    decision_posture,
  };
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* DB helpers (unchanged)                                                       */
/* ─────────────────────────────────────────────────────────────────────────── */

async function countHighRaidWithProjects(args: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  projectIds: string[];
  organisationId: string | null;
}): Promise<{ count: number; projectNames: string[] }> {
  const { supabase, organisationId } = args;
  const openStatuses  = ["Open", "open", "OPEN", "active", "Active"];
  const highPriorities = ["High", "high", "HIGH", "Critical", "critical", "CRITICAL"];
  try {
    let projectIds = args.projectIds.length ? args.projectIds : [];
    if (!projectIds.length && organisationId) {
      const { data: confirmedRows } = await supabase
        .from("projects")
        .select("id")
        .eq("organisation_id", organisationId)
        .is("deleted_at", null)
        .neq("resource_status", "pipeline")
        .neq("status", "closed")
        .limit(2000);
      projectIds = (confirmedRows ?? []).map((r: any) => String(r.id)).filter(Boolean);
    }
    if (!projectIds.length) return { count: 0, projectNames: [] };

    const { data, error } = await supabase
      .from("raid_items")
      .select("id, title, project_id, projects(title, project_code)")
      .in("status", openStatuses)
      .in("priority", highPriorities)
      .in("project_id", projectIds)
      .limit(10);

    if (error) return { count: 0, projectNames: [] };
    const rows = data ?? [];
    const names = new Set<string>();
    for (const row of rows) {
      const proj = (row as any).projects;
      const code  = safeStr(proj?.project_code).trim();
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
}): Promise<{
  body: string;
  sentiment: Sentiment;
  talkingPoint: string | null;
  totalBudget: number;
  projectsWithBudget: number;
}> {
  const { supabase, projectIds, organisationId } = args;
  const noData = {
    body: "No budget data has been entered yet. Add financial plans to your projects to see portfolio-level budget analysis here.",
    sentiment: "neutral" as Sentiment,
    talkingPoint: null,
    totalBudget: 0,
    projectsWithBudget: 0,
  };

  try {
    let ids = projectIds;
    if (!ids.length && organisationId) {
      const { data: projRows } = await supabase
        .from("projects")
        .select("id")
        .eq("organisation_id", organisationId)
        .is("deleted_at", null)
        .neq("resource_status", "pipeline")
        .neq("status", "closed")
        .limit(50);
      ids = (projRows ?? []).map((r: any) => r.id).filter(Boolean);
    }
    if (!ids.length) return noData;

    const { data, error } = await supabase
      .from("projects")
      .select(
        "id, title, project_code, budget_amount, budget_days, " +
        // actual spend — try every common column name; Supabase returns null for missing ones
        "actual_spend, actual_cost, spent_amount, spend_to_date, total_actual, total_spent, actuals"
      )
      .in("id", ids)
      .is("deleted_at", null)
      .limit(50);

    if (error || !data?.length) return noData;

    let totalBudget = 0;
    let totalBudgetDays = 0;
    let totalSpent = 0;
    let projectsWithBudget = 0;

    for (const row of data) {
      const r = row as any;
      const amount = safeNum(r.budget_amount);
      const days   = safeNum(r.budget_days);
      if (amount != null && amount > 0) { totalBudget += amount; projectsWithBudget++; }
      if (days   != null && days   > 0)   totalBudgetDays += days;

      // Pick the first non-null, non-zero spend column
      const spend = safeNum(r.actual_spend)
        ?? safeNum(r.actual_cost)
        ?? safeNum(r.spent_amount)
        ?? safeNum(r.spend_to_date)
        ?? safeNum(r.total_actual)
        ?? safeNum(r.total_spent)
        ?? safeNum(r.actuals)
        ?? null;
      if (spend != null && spend > 0) totalSpent += spend;
    }

    if (projectsWithBudget === 0 && totalBudgetDays === 0) return noData;

    const budgetStr = totalBudget > 0 ? formatCurrency(totalBudget) : null;
    const spentStr  = totalSpent  > 0 ? formatCurrency(totalSpent)  : null;
    const projectCount = data.length;

    // Derive a simple variance sentiment when we have both figures
    let sentiment: Sentiment = "neutral";
    if (budgetStr && spentStr && totalBudget > 0) {
      const variancePct = ((totalSpent - totalBudget) / totalBudget) * 100;
      sentiment = variancePct > 10 ? "red" : variancePct > 0 ? "amber" : "green";
    }

    let body = "";
    if (budgetStr) {
      body = `Total portfolio budget is ${budgetStr} across ${projectCount} project${projectCount !== 1 ? "s" : ""}.`;
    }
    if (spentStr) {
      body += ` ${spentStr} spent to date.`;
    } else if (!spentStr && budgetStr) {
      body += " No actuals recorded yet.";
    }
    if (totalBudgetDays > 0 && !budgetStr) {
      body = `${totalBudgetDays} budget days allocated across ${projectCount} project${projectCount !== 1 ? "s" : ""}.`;
    }
    if (!body) return noData;

    const talkingPoint = budgetStr
      ? `Portfolio budget is ${budgetStr}.${spentStr ? ` ${spentStr} spent to date.` : ""}`
      : `${totalBudgetDays} budget days allocated across the portfolio.`;

    return { body, sentiment, talkingPoint, totalBudget, projectsWithBudget };
  } catch {
    return noData;
  }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* NOTE: days_in_state                                                          */
/*                                                                              */
/* To surface escalation timelines ("14d in amber") you need to persist        */
/* when each section last changed sentiment. Recommended approach:             */
/*                                                                              */
/*   Table: briefing_state_log (organisation_id, section_id, sentiment,        */
/*                               since TIMESTAMPTZ)                            */
/*                                                                              */
/* On each load: upsert a row when sentiment changes, compute days from        */
/* `since` to now. Until then, days_in_state is omitted (undefined).          */
/* ─────────────────────────────────────────────────────────────────────────── */

async function loadDaysInState(args: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  organisationId: string | null;
  sectionSentiments: Record<SectionId, Sentiment>;
  nowIso: string;
}): Promise<Partial<Record<SectionId, number>>> {
  const { supabase, organisationId, sectionSentiments, nowIso } = args;
  if (!organisationId) return {};

  try {
    const { data: rows, error } = await supabase
      .from("briefing_state_log")
      .select("section_id, sentiment, since")
      .eq("organisation_id", organisationId)
      .in("section_id", Object.keys(sectionSentiments))
      .order("since", { ascending: false });

    if (error || !rows?.length) {
      // Table likely doesn't exist yet — upsert current state silently
      await upsertBriefingStateLog({ supabase, organisationId, sectionSentiments, nowIso });
      return {};
    }

    const result: Partial<Record<SectionId, number>> = {};
    const seen = new Set<string>();

    for (const row of rows) {
      const sectionId = safeStr((row as any).section_id) as SectionId;
      if (seen.has(sectionId)) continue;
      seen.add(sectionId);

      const currentSentiment = sectionSentiments[sectionId];
      const rowSentiment     = safeStr((row as any).sentiment) as Sentiment;

      if (currentSentiment === rowSentiment) {
        // Sentiment unchanged — compute age
        const since = new Date((row as any).since).getTime();
        const days  = Math.floor((Date.now() - since) / 86_400_000);
        if (days > 0) result[sectionId] = days;
      }
      // Sentiment changed — upsert new row
      else {
        await supabase.from("briefing_state_log").upsert(
          { organisation_id: organisationId, section_id: sectionId, sentiment: currentSentiment, since: nowIso },
          { onConflict: "organisation_id,section_id" }
        );
      }
    }

    // Upsert any sections not yet logged
    for (const [sectionId, sentiment] of Object.entries(sectionSentiments)) {
      if (!seen.has(sectionId)) {
        await supabase.from("briefing_state_log").upsert(
          { organisation_id: organisationId, section_id: sectionId, sentiment, since: nowIso },
          { onConflict: "organisation_id,section_id" }
        );
      }
    }

    return result;
  } catch {
    return {};
  }
}

async function upsertBriefingStateLog(args: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  organisationId: string;
  sectionSentiments: Record<SectionId, Sentiment>;
  nowIso: string;
}) {
  try {
    const rows = Object.entries(args.sectionSentiments).map(([section_id, sentiment]) => ({
      organisation_id: args.organisationId,
      section_id,
      sentiment,
      since: args.nowIso,
    }));
    await args.supabase
      .from("briefing_state_log")
      .upsert(rows, { onConflict: "organisation_id,section_id", ignoreDuplicates: true });
  } catch {
    /* fail-open — table may not exist yet */
  }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Main export                                                                  */
/* ─────────────────────────────────────────────────────────────────────────── */

export async function loadExecutiveBriefing(args: {
  projectScores?: Record<string, { score: number; rag: "G" | "A" | "R" }>;
  liveRagCounts?: { g: number; a: number; r: number };
  projectIds?: string[];
  organisationId?: string | null;
  liveHealthScore?: number | null;
}): Promise<BriefingData | null> {
  if (args.liveHealthScore == null) return null;

  try {
    const supabase       = await createClient();
    const nowIso         = new Date().toISOString();
    const projectScores  = args.projectScores  ?? {};
    const liveRagCounts  = args.liveRagCounts  ?? { g: 0, a: 0, r: 0 };
    const organisationId = args.organisationId ?? null;

    const scoreEntries = Object.entries(projectScores);
    const derivedProjectIds: string[] = [];
    for (const [projectId] of scoreEntries) {
      const cleanId = safeStr(projectId).trim();
      if (cleanId) derivedProjectIds.push(cleanId);
    }
    const rawProjectIds = uniqNonEmptyStrings([...(args.projectIds ?? []), ...derivedProjectIds]);

    // ── Strip pipeline / closed / deleted projects from the ID list ──
    // projectScores may include pipeline projects from the health engine.
    // Always cross-reference against confirmed projects in the DB so the
    // briefing only reflects the active portfolio.
    let projectIds = rawProjectIds;
    if (rawProjectIds.length && organisationId) {
      try {
        const { data: confirmedRows } = await supabase
          .from("projects")
          .select("id")
          .in("id", rawProjectIds)
          .is("deleted_at", null)
          .neq("resource_status", "pipeline")
          .neq("status", "closed")
          .limit(2000);
        const confirmedIds = (confirmedRows ?? []).map((r: any) => String(r.id)).filter(Boolean);
        if (confirmedIds.length) projectIds = confirmedIds;
      } catch {
        // fail-open: use raw list if DB call fails
      }
    }

    const avgHealth  = Math.round(args.liveHealthScore);
    const projectCount = projectIds.length || scoreEntries.length;

    const [raidResult, overdueApprovals, financeResult] = await Promise.all([
      countHighRaidWithProjects({ supabase, projectIds, organisationId }),
      countOverdueApprovals({ supabase, organisationId, nowIso }),
      loadFinanceSummary({ supabase, projectIds, organisationId }),
    ]);

    const highRaid         = raidResult.count;
    const raidProjectNames = raidResult.projectNames;

    const dominant: Sentiment =
      liveRagCounts.r > 0 ? "red"
      : liveRagCounts.a > 0 ? "amber"
      : liveRagCounts.g > 0 ? "green"
      : "neutral";

    // ── Compute section sentiments first (needed for days_in_state lookup) ──
    const healthSentiment:   Sentiment = avgHealth < 70 ? "red" : avgHealth < 85 ? "amber" : "green";
    const riskSentiment:     Sentiment = highRaid === 0 ? "green" : highRaid >= 5 ? "red" : "amber";
    const deliverySentiment: Sentiment =
      liveRagCounts.r > 0   ? "red"
      : liveRagCounts.a > 0 ? "amber"
      : liveRagCounts.g > 0 ? "green"
      : "neutral";
    const financeSentiment:  Sentiment = financeResult.sentiment;

    const sectionSentiments: Record<SectionId, Sentiment> = {
      health:   healthSentiment,
      risk:     riskSentiment,
      delivery: deliverySentiment,
      finance:  financeSentiment,
    };

    // ── Load escalation timelines (gracefully skipped if table missing) ──
    const daysInState = await loadDaysInState({
      supabase,
      organisationId,
      sectionSentiments,
      nowIso,
    });

    // ── Build enriched sections ──
    const healthEnrichment   = enrichHealthSection({
      avgHealth, redCount: liveRagCounts.r, amberCount: liveRagCounts.a,
      greenCount: liveRagCounts.g, daysInState: daysInState.health,
    });
    const riskEnrichment     = enrichRiskSection({
      highRaid, raidProjectNames, daysInState: daysInState.risk,
    });
    const deliveryEnrichment = enrichDeliverySection({
      redCount: liveRagCounts.r, amberCount: liveRagCounts.a,
      greenCount: liveRagCounts.g, overdueApprovals, daysInState: daysInState.delivery,
    });
    const financeEnrichment  = enrichFinanceSection({
      baseSentiment: financeSentiment,
      totalBudget: financeResult.totalBudget,
      projectsWithBudget: financeResult.projectsWithBudget,
      daysInState: daysInState.finance,
    });

    let raidBody: string;
    if (highRaid === 0) {
      raidBody = "No high or critical RAID items are currently open across the portfolio.";
    } else {
      const itemLabel = highRaid === 1 ? "item is" : "items are";
      raidBody = raidProjectNames.length > 0
        ? `${highRaid} high or critical RAID ${itemLabel} currently open, affecting: ${raidProjectNames.join(", ")}.`
        : `${highRaid} high or critical RAID ${itemLabel} currently open across the portfolio and require attention.`;
    }

    const sections: BriefingSection[] = [
      {
        id: "health",
        title: "Portfolio Health",
        body: `Average portfolio health is ${avgHealth}%. Current mix: ${liveRagCounts.g} green, ${liveRagCounts.a} amber, ${liveRagCounts.r} red.`,
        ...healthEnrichment,
      },
      {
        id: "risk",
        title: "Risk & RAID",
        body: raidBody,
        ...riskEnrichment,
      },
      {
        id: "delivery",
        title: "Delivery",
        body: liveRagCounts.r > 0
          ? "At least one project is in red and may need direct intervention to protect delivery outcomes."
          : liveRagCounts.a > 0
            ? "Some projects are showing amber signals and should be tracked closely."
            : liveRagCounts.g > 0
              ? "Delivery signals are currently healthy across the visible portfolio."
              : "Delivery narrative is available, but live project scoring is still limited.",
        ...deliveryEnrichment,
      },
      {
        id: "finance",
        title: "Finance",
        body: financeResult.body,
        ...financeEnrichment,
      },
    ];

    // ── Portfolio posture (top-level) ──
    const portfolio_posture = derivePortfolioPosture({
      redCount:   liveRagCounts.r,
      amberCount: liveRagCounts.a,
      greenCount: liveRagCounts.g,
      highRaid,
      overdueApprovals,
      avgHealth,
    });

    // ── Risk narrative ──
    const risk_narrative = buildRiskNarrative({
      dominant,
      redCount:   liveRagCounts.r,
      amberCount: liveRagCounts.a,
      highRaid,
      raidProjectNames,
      overdueApprovals,
      avgHealth,
    });

    // ── Executive summary ──
    const executive_summary = buildExecutiveSummary({
      dominant,
      redCount:   liveRagCounts.r,
      amberCount: liveRagCounts.a,
      greenCount: liveRagCounts.g,
      highRaid,
      overdueApprovals,
    });

    // ── Talking points ──
    const talking_points = [
      `Portfolio mix is ${liveRagCounts.g} green / ${liveRagCounts.a} amber / ${liveRagCounts.r} red.`,
      `Average health is ${avgHealth}%.`,
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
      portfolio_posture,
      risk_narrative,
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