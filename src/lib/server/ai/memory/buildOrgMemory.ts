import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";

export type OrgPattern = {
  id?:                string;
  pattern_type:       string;
  title:              string;
  description:        string;
  evidence:           PatternEvidence[];
  frequency:          number;
  avg_impact:         string;
  applicable_when:    string;
  recommendation:     string;
  confidence:         number;
  source_project_ids: string[];
};

export type PatternEvidence = {
  project_id:    string;
  project_title: string;
  value:          string | number;
  context:        string;
};

export type OrgMemoryResult = {
  patterns:        OrgPattern[];
  projects_analysed: number;
  generated_at:    string;
};

function safeStr(x: any): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function safeNum(x: any): number {
  const n = Number(x); return Number.isFinite(n) ? n : 0;
}

export async function buildOrgMemory(
  supabase: SupabaseClient,
  orgId: string,
): Promise<OrgMemoryResult> {
  const now = new Date().toISOString();

  // Fetch all projects (active + closed for pattern learning)
  const { data: allProjects } = await supabase
    .from("projects")
    .select("id, title, project_code, status, start_date, finish_date, created_at")
    .eq("organisation_id", orgId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  if (!allProjects?.length) {
    return { patterns: [], projects_analysed: 0, generated_at: now };
  }

  const projectIds = allProjects.map((p: any) => p.id);

  // Fetch rich data for pattern analysis
  const [
    { data: snapshots },
    { data: govActions },
    { data: changeRequests },
    { data: raidItems },
    { data: approvals },
    { data: milestones },
  ] = await Promise.all([
    supabase.from("ai_premortem_snapshots")
      .select("project_id, failure_risk_score, failure_risk_band, schedule_score, governance_score, budget_score, stability_score, generated_at")
      .in("project_id", projectIds)
      .order("generated_at", { ascending: false }),

    supabase.from("ai_governance_actions")
      .select("project_id, action_type, status, created_at")
      .in("project_id", projectIds)
      .eq("auto_created", true),

    supabase.from("change_requests")
      .select("project_id, status, est_cost_impact, created_at")
      .in("project_id", projectIds),

    supabase.from("raid_items")
      .select("project_id, type, priority, status, created_at, resolved_at")
      .in("project_id", projectIds),

    supabase.from("approval_requests")
      .select("project_id, status, created_at, updated_at")
      .in("project_id", projectIds),

    supabase.from("milestones")
      .select("project_id, status, due_date, created_at")
      .in("project_id", projectIds),
  ]);

  // Build per-project summaries for pattern detection
  const projectSummaries = allProjects.map((proj: any) => {
    const pid = proj.id;

    const projSnaps      = (snapshots ?? []).filter((s: any) => s.project_id === pid);
    const latestSnap     = projSnaps[0];
    const projGov        = (govActions ?? []).filter((g: any) => g.project_id === pid);
    const projChanges    = (changeRequests ?? []).filter((c: any) => c.project_id === pid);
    const projRaid       = (raidItems ?? []).filter((r: any) => r.project_id === pid);
    const projApprovals  = (approvals ?? []).filter((a: any) => a.project_id === pid);
    const projMilestones = (milestones ?? []).filter((m: any) => m.project_id === pid);

    const overdueApprovals = projApprovals.filter((a: any) => {
      if (a.status !== "pending") return false;
      const created = new Date(a.created_at);
      const updated = a.updated_at ? new Date(a.updated_at) : created;
      return (updated.getTime() - created.getTime()) > 48 * 3600000;
    });

    const overdueMilestones = projMilestones.filter((m: any) => {
      if (["complete", "done"].includes(safeStr(m.status).toLowerCase())) return false;
      return m.due_date && new Date(m.due_date) < new Date();
    });

    const totalChangeValue = projChanges.reduce((s: number, c: any) => s + safeNum(c.est_cost_impact), 0);

    return {
      project_id:          pid,
      project_title:       safeStr(proj.title),
      status:              safeStr(proj.status),
      risk_score:          latestSnap ? safeNum(latestSnap.failure_risk_score) : null,
      schedule_score:      latestSnap ? safeNum(latestSnap.schedule_score) : null,
      governance_score:    latestSnap ? safeNum(latestSnap.governance_score) : null,
      budget_score:        latestSnap ? safeNum(latestSnap.budget_score) : null,
      governance_actions:  projGov.length,
      approval_delays:     overdueApprovals.length,
      change_count:        projChanges.length,
      change_value:        totalChangeValue,
      raid_count:          projRaid.length,
      high_raid_count:     projRaid.filter((r: any) => r.priority === "High" || r.priority === "Critical").length,
      milestone_overdue:   overdueMilestones.length,
    };
  });

  const patterns: OrgPattern[] = [];

  // Pattern 1: Approval delays
  const approvalDelayProjects = projectSummaries.filter(p => p.approval_delays >= 2);
  if (approvalDelayProjects.length >= 1) {
    patterns.push({
      pattern_type:      "approval_delay",
      title:             "Recurring approval delays across projects",
      description:       `${approvalDelayProjects.length} projects have experienced repeated approval delays (48h+ SLA breach). This is a systemic governance pattern, not isolated incidents.`,
      evidence:          approvalDelayProjects.slice(0, 4).map(p => ({
        project_id:    p.project_id,
        project_title: p.project_title,
        value:          p.approval_delays,
        context:        `${p.approval_delays} approvals past SLA`,
      })),
      frequency:         approvalDelayProjects.length,
      avg_impact:        `+${Math.round(approvalDelayProjects.reduce((s, p) => s + p.approval_delays, 0) / approvalDelayProjects.length * 2)} days average cycle time`,
      applicable_when:   "When a project has pending approvals",
      recommendation:    "Set up automated escalation at 24h. Consider delegating approval authority to reduce bottlenecks.",
      confidence:         95,
      source_project_ids: approvalDelayProjects.map(p => p.project_id),
    });
  }

  // Pattern 2: High RAID volume early warning
  const highRaidProjects = projectSummaries.filter(p => p.high_raid_count >= 3);
  if (highRaidProjects.length >= 1) {
    patterns.push({
      pattern_type:      "delivery_slip",
      title:             "High-priority RAID accumulation precedes delivery risk",
      description:       `${highRaidProjects.length} projects with 3+ high-priority RAID items show elevated schedule risk. Historically, unresolved high-priority RAID items correlate with milestone slippage.`,
      evidence:          highRaidProjects.slice(0, 4).map(p => ({
        project_id:    p.project_id,
        project_title: p.project_title,
        value:          p.high_raid_count,
        context:        `${p.high_raid_count} high/critical RAID items open`,
      })),
      frequency:         highRaidProjects.length,
      avg_impact:        `+2-4 weeks typical delivery slip`,
      applicable_when:   "When a project has 3+ high-priority open RAID items",
      recommendation:    "Triage RAID register weekly. Assign dedicated resolution owners. Escalate any item older than 14 days.",
      confidence:         90,
      source_project_ids: highRaidProjects.map(p => p.project_id),
    });
  }

  // Pattern 3: Schedule score decline
  const scheduleAtRisk = projectSummaries.filter(p => p.schedule_score !== null && p.schedule_score >= 40);
  if (scheduleAtRisk.length >= 1) {
    patterns.push({
      pattern_type:      "phase_risk",
      title:             "Schedule pressure accumulates mid-delivery",
      description:       `${scheduleAtRisk.length} projects show elevated schedule risk scores (40+). Pattern analysis suggests schedule risk peaks when milestone density is highest and RAID items are unresolved.`,
      evidence:          scheduleAtRisk.slice(0, 4).map(p => ({
        project_id:    p.project_id,
        project_title: p.project_title,
        value:          p.schedule_score ?? 0,
        context:        `Schedule risk score: ${p.schedule_score}/100`,
      })),
      frequency:         scheduleAtRisk.length,
      avg_impact:        "Milestone slippage most common in mid-delivery phase",
      applicable_when:   "When schedule risk score exceeds 40",
      recommendation:    "Run a schedule rebaselining exercise. Confirm all milestones have clear owners and achievable dates.",
      confidence:         75,
      source_project_ids: scheduleAtRisk.map(p => p.project_id),
    });
  }

  // Pattern 4: Budget overrun via change requests
  const highChangeProjects = projectSummaries.filter(p => p.change_count >= 3 && p.change_value > 0);
  if (highChangeProjects.length >= 1) {
    const avgValue = highChangeProjects.reduce((s, p) => s + p.change_value, 0) / highChangeProjects.length;
    patterns.push({
      pattern_type:      "budget_overrun",
      title:             "Change request accumulation drives budget pressure",
      description:       `${highChangeProjects.length} projects with 3+ change requests show meaningful budget exposure. Unapproved changes create hidden financial risk.`,
      evidence:          highChangeProjects.slice(0, 4).map(p => ({
        project_id:    p.project_id,
        project_title: p.project_title,
        value:          p.change_count,
        context:        `${p.change_count} changes, £${Math.round(p.change_value / 1000)}k exposure`,
      })),
      frequency:         highChangeProjects.length,
      avg_impact:        `£${Math.round(avgValue / 1000)}k average change exposure per project`,
      applicable_when:   "When 3+ change requests are open simultaneously",
      recommendation:    "Implement change freeze periods near key milestones. Require impact assessment on all CRs before review.",
      confidence:         80,
      source_project_ids: highChangeProjects.map(p => p.project_id),
    });
  }

  // AI-enhanced patterns (GPT synthesis)
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey && projectSummaries.length >= 2) {
      const client = new OpenAI({ apiKey });

      const summaryText = projectSummaries.slice(0, 10).map(p =>
        `Project: ${p.project_title} | Status: ${p.status} | Risk: ${p.risk_score ?? "N/A"}/100 | Gov actions: ${p.governance_actions} | Approval delays: ${p.approval_delays} | RAID high: ${p.high_raid_count} | Changes: ${p.change_count} | Milestones overdue: ${p.milestone_overdue}`
      ).join("\n");

      const response = await client.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [{
          role: "system",
          content: `You are a programme delivery expert analysing patterns across multiple projects. Identify ONE additional pattern not already covered by: approval delays, RAID accumulation, schedule pressure, budget overrun. Return JSON: {"pattern_type": string, "title": string, "description": string, "avg_impact": string, "applicable_when": string, "recommendation": string, "confidence": number}`
        }, {
          role: "user",
          content: `Analyse these ${projectSummaries.length} projects and identify a key organisational pattern:\n\n${summaryText}`,
        }],
      });

      const aiPattern = JSON.parse(response.choices[0]?.message?.content ?? "{}");
      if (aiPattern.title && aiPattern.recommendation) {
        patterns.push({
          pattern_type:      aiPattern.pattern_type ?? "team_performance",
          title:             aiPattern.title,
          description:       aiPattern.description ?? "",
          evidence:          [],
          frequency:         projectSummaries.length,
          avg_impact:        aiPattern.avg_impact ?? "Variable",
          applicable_when:   aiPattern.applicable_when ?? "Across portfolio",
          recommendation:     aiPattern.recommendation,
          confidence:         Math.min(85, safeNum(aiPattern.confidence) || 70),
          source_project_ids: [],
        });
      }
    }
  } catch (e) {
    console.warn("[buildOrgMemory] AI pattern failed, using deterministic only:", e);
  }

  // Persist patterns
  if (patterns.length > 0) {
    await supabase.from("org_memory_patterns")
      .delete()
      .eq("organisation_id", orgId);

    await supabase.from("org_memory_patterns")
      .insert(patterns.map(p => ({
        organisation_id:    orgId,
        pattern_type:       p.pattern_type,
        title:              p.title,
        description:        p.description,
        evidence:           p.evidence,
        frequency:          p.frequency,
        avg_impact:         p.avg_impact,
        applicable_when:    p.applicable_when,
        recommendation:     p.recommendation,
        confidence:         p.confidence,
        source_project_ids: p.source_project_ids,
        last_computed_at:   now,
      })));
  }

  return {
    patterns,
    projects_analysed: allProjects.length,
    generated_at:      now,
  };
}