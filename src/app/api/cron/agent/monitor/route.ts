import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendAgentNotification } from "@/lib/agent/notify";

export const runtime     = "nodejs";
export const dynamic     = "force-dynamic";
export const maxDuration = 120;

// Thresholds for triggering alerts
const HEALTH_AMBER_THRESHOLD = 70;
const GATE_WARNING_DAYS      = 14; // Alert 14 days before a gate review

/**
 * GET /api/cron/agent/monitor
 * Hourly task to detect portfolio anomalies and fire targeted alerts.
 */
export async function GET(req: NextRequest) {
  // 1. Verify cron secret
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }

  const supabase   = createServiceClient();
  const today      = new Date().toISOString().slice(0, 10);
  const alerts: any[] = [];

  // ── 1. Detect Health Drops ──────────────────────────────────────────────
  // Checks for projects where the AI-calculated health score is below threshold
  const { data: healthRows } = await supabase
    .from("project_health")
    .select("project_id, score, rag, computed_at, projects(title, organisation_id, project_code)")
    .lt("score", HEALTH_AMBER_THRESHOLD)
    .gte("computed_at", new Date(Date.now() - 2 * 3600 * 1000).toISOString()) // Scored in last 2h
    .limit(100);

  for (const row of healthRows ?? []) {
    const proj    = (row as any).projects;
    const orgId   = proj?.organisation_id;
    if (!orgId) continue;

    const score   = Math.round(Number(row.score ?? 0));
    const title   = proj?.title ?? "Unknown project";
    const code    = proj?.project_code ? ` (${proj.project_code})` : "";
    
    await sendAgentNotification({
      organisationId: orgId,
      title:          `Health alert: ${title}${code}`,
      body:           `${title} health score has dropped to ${score}% (${row.rag ?? "Red"}). Immediate review recommended. Check RAID items and milestones to identify the root cause.`,
      link:           `/projects/${row.project_id}`,
      type:           "alert",
      emailSubject:   `⚠ Aliena Alert: ${title} health is ${score}%`,
    });

    alerts.push({ type: "health_drop", project_id: row.project_id, score });
  }

  // ── 2. Detect Overdue High-Priority RAID ────────────────────────────────
  // Collects items due today or earlier that are still open and "High" priority
  const { data: overdueRaid } = await supabase
    .from("raid_items")
    .select("id, project_id, title, type, priority, due_date, projects(organisation_id, title)")
    .lte("due_date", today)
    .not("status", "in", '("closed","resolved","done","completed")')
    .eq("priority", "High")
    .limit(50);

  // Group by Org to prevent inbox flooding (1 email per org, not 1 per item)
  const raidByOrg = new Map<string, any[]>();
  for (const item of overdueRaid ?? []) {
    const orgId = (item as any).projects?.organisation_id;
    if (!orgId) continue;
    if (!raidByOrg.has(orgId)) raidByOrg.set(orgId, []);
    raidByOrg.get(orgId)!.push(item);
  }

  for (const [orgId, items] of raidByOrg) {
    const itemLines = items.slice(0, 5).map((i: any) => `• [${i.type}] ${i.title}`).join("\n");
    const extraCount = items.length - 5;

    await sendAgentNotification({
      organisationId: orgId,
      title:          `${items.length} high-priority RAID items overdue`,
      body:           `Attention required for high-priority items:\n\n${itemLines}${extraCount > 0 ? `\n...and ${extraCount} more.` : ""}`,
      link:           "/insights?tab=raid",
      type:           "action_required",
      emailSubject:   `🔴 Aliena: ${items.length} overdue RAID items need attention`,
    });
    alerts.push({ type: "raid_overdue", org_id: orgId, count: items.length });
  }

  // ── 3. Detect Approaching Gate Reviews ──────────────────────────────────
  const warningDate = new Date(Date.now() + GATE_WARNING_DAYS * 86400000).toISOString().slice(0, 10);

  const { data: gateProjects } = await supabase
    .from("projects")
    .select("id, title, project_code, finish_date, organisation_id")
    .lte("finish_date", warningDate)
    .gte("finish_date", today)
    .is("deleted_at", null)
    .limit(50);

  for (const proj of gateProjects ?? []) {
    // Check if Gate 5 (Closure) is passed
    const { data: gate5 } = await supabase
      .from("project_gates")
      .select("passed_at")
      .eq("project_id", proj.id)
      .eq("gate_number", 5)
      .maybeSingle();

    if (gate5?.passed_at) continue;

    const daysLeft = Math.floor((new Date(proj.finish_date).getTime() - Date.now()) / 86400000);

    await sendAgentNotification({
      organisationId: proj.organisation_id,
      title:          `Gate 5 due in ${daysLeft} days: ${proj.title}`,
      body:           `${proj.title} is scheduled for closure in ${daysLeft} days. Gate 5 has not been passed. Review the checklist to avoid delays.`,
      link:           `/projects/${proj.id}`,
      type:           "action_required",
      emailSubject:   `⏰ Aliena: Gate 5 due in ${daysLeft} days — ${proj.title}`,
    });
    alerts.push({ type: "gate_approaching", project_id: proj.id, days_left: daysLeft });
  }

  return NextResponse.json({ ok: true, alerts_sent: alerts.length, alerts });
}
