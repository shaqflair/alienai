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

export async function loadExecutiveBriefing(args: {
  projectScores?: Record<string, { score: number; rag: "G" | "A" | "R" }>;
  liveRagCounts?: { g: number; a: number; r: number };
  projectIds?: string[];
  organisationId?: string | null;
}): Promise<BriefingData | null> {
  try {
    const supabase = await createClient();

    const projectScores  = args.projectScores  ?? {};
    const liveRagCounts  = args.liveRagCounts  ?? { g: 0, a: 0, r: 0 };
    const projectIds     = args.projectIds     ?? Object.keys(projectScores);
    const organisationId = args.organisationId ?? null;

    const scoreVals = Object.values(projectScores)
      .map((x) => Number(x?.score))
      .filter((n) => Number.isFinite(n));

    const avgHealth =
      scoreVals.length > 0
        ? Math.round(scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length)
        : null;

    const projectCount = Object.keys(projectScores).length;

    // -- Query actual RAID high/critical items --------------------------------
    let highRaid = 0;
    if (projectIds.length > 0) {
      try {
        const { count } = await supabase
          .from("raid_items")
          .select("id", { count: "exact", head: true })
          .in("project_id", projectIds)
          .in("status", ["Open", "open", "OPEN", "active", "Active"])
          .in("priority", ["High", "high", "HIGH", "Critical", "critical", "CRITICAL"]);
        highRaid = count ?? 0;
      } catch {
        // fail-open: keep highRaid = 0 if query errors
      }
    } else if (organisationId) {
      // fallback: query by org if no project IDs
      try {
        const { count } = await supabase
          .from("raid_items")
          .select("id", { count: "exact", head: true })
          .eq("organisation_id", organisationId)
          .in("status", ["Open", "open", "OPEN", "active", "Active"])
          .in("priority", ["High", "high", "HIGH", "Critical", "critical", "CRITICAL"]);
        highRaid = count ?? 0;
      } catch {
        // fail-open
      }
    }

    // -- Query overdue approvals ----------------------------------------------
    let overdueApprovals = 0;
    if (organisationId) {
      try {
        const { count } = await supabase
          .from("approval_chains")
          .select("id", { count: "exact", head: true })
          .eq("organisation_id", organisationId)
          .eq("status", "pending")
          .lt("due_date", new Date().toISOString());
        overdueApprovals = count ?? 0;
      } catch {
        // fail-open: approval table schema may differ
      }
    }

    // -- Derive sentiment -----------------------------------------------------
    const dominant =
      liveRagCounts.r > 0 ? "red"
      : liveRagCounts.a > 0 ? "amber"
      : liveRagCounts.g > 0 ? "green"
      : "neutral";

    const executive_summary =
      dominant === "red"
        ? "Portfolio requires executive attention. Red delivery signals are present and should be reviewed immediately."
        : dominant === "amber"
          ? "Portfolio is broadly stable, but several delivery and governance signals require monitoring."
          : dominant === "green"
            ? "Portfolio is performing well overall, with delivery signals currently on track."
            : "Portfolio narrative is available, but there is limited scoring data to assess overall health.";

    const sections: BriefingData["sections"] = [
      {
        id: "health",
        title: "Health",
        sentiment: dominant,
        body:
          avgHealth != null
            ? `Average portfolio health is ${avgHealth}%. Current mix: ${liveRagCounts.g} green, ${liveRagCounts.a} amber, ${liveRagCounts.r} red.`
            : "Average health is not yet available from live scoring.",
      },
      {
        id: "risk",
        title: "Risk",
        sentiment: highRaid > 0 ? "amber" : "green",
        body:
          highRaid > 0
            ? `${highRaid} high or critical RAID item${highRaid === 1 ? " is" : "s are"} currently open across the portfolio and require attention.`
            : "No high or critical RAID items are currently open across the portfolio.",
      },
      {
        id: "delivery",
        title: "Delivery",
        sentiment: liveRagCounts.r > 0 ? "red" : liveRagCounts.a > 0 ? "amber" : "green",
        body:
          liveRagCounts.r > 0
            ? "At least one project is in red and may need direct intervention to protect delivery outcomes."
            : liveRagCounts.a > 0
              ? "Some projects are showing amber signals and should be tracked closely."
              : "Delivery signals are currently healthy across the visible portfolio.",
      },
      {
        id: "finance",
        title: "Finance",
        sentiment: "neutral",
        body: "Financial narrative can be expanded from budget and variance signals already shown on the homepage.",
      },
    ];

    const talking_points = [
      `Portfolio mix is ${liveRagCounts.g} green / ${liveRagCounts.a} amber / ${liveRagCounts.r} red.`,
      avgHealth != null
        ? `Average health is ${avgHealth}%.`
        : "Average health is still being established from live data.",
      highRaid > 0
        ? `${highRaid} high or critical RAID item${highRaid === 1 ? "" : "s"} require attention.`
        : "No high-priority RAID items are currently flagged.",
      overdueApprovals > 0
        ? `${overdueApprovals} overdue approval${overdueApprovals === 1 ? "" : "s"} need action.`
        : "No major approval backlog is currently highlighted.",
    ];

    return {
      ok: true,
      executive_summary,
      sections,
      talking_points,
      gaps: [],
      signals_summary: {
        project_count:     projectCount,
        rag:               { g: liveRagCounts.g, a: liveRagCounts.a, r: liveRagCounts.r, unscored: 0 },
        avg_health:        avgHealth,
        overdue_approvals: overdueApprovals,
        high_raid:         highRaid,
      },
      generated_at: new Date().toISOString(),
    };
  } catch (e: any) {
    return {
      ok: false,
      error:        safeStr(e?.message || e),
      generated_at: new Date().toISOString(),
    };
  }
}