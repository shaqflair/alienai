// Weekly governance digest — emails every PM their project summary
// Schedule: Mondays 07:30 UTC (see vercel.json)
import "server-only";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { sendWeeklyDigestEmail, type DigestProject } from "@/lib/server/notifications/weekly-digest-email";

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300; // up to 5 min — we fan-out emails per PM

function jsonOk(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
function jsonErr(error: string, status = 400) {
  const res = NextResponse.json({ ok: false, error }, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
function safeStr(x: any): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function safeNum(x: any): number {
  const n = Number(x); return Number.isFinite(n) ? n : 0;
}

function requireCronSecret(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return;
  const got =
    req.headers.get("x-cron-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (got !== expected) throw new Error("Unauthorized: invalid cron secret");
}

function weekOf(): string {
  const d = new Date();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function baseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}` ||
    "https://aliena.co.uk"
  );
}

/* ── Data loaders ───────────────────────────────────────────────────── */

async function loadPMs(admin: any): Promise<Array<{
  user_id: string; email: string | null; full_name: string | null;
}>> {
  // Get all project members with owner/editor role who have emails
  const { data, error } = await admin
    .from("project_members")
    .select("user_id, role")
    .in("role", ["owner", "editor", "pm"])
    .eq("is_active", true);

  if (error) throw new Error(`PM load failed: ${error.message}`);

  const userIds = [...new Set((data ?? []).map((r: any) => safeStr(r.user_id)).filter(Boolean))];
  if (!userIds.length) return [];

  const { data: profiles } = await admin
    .from("profiles")
    .select("user_id, email, full_name")
    .in("user_id", userIds);

  return (profiles ?? [])
    .filter((p: any) => safeStr(p?.email).trim())
    .map((p: any) => ({
      user_id:   safeStr(p.user_id),
      email:     safeStr(p.email).trim() || null,
      full_name: safeStr(p.full_name).trim() || null,
    }));
}

async function loadProjectsForPM(admin: any, userId: string): Promise<string[]> {
  const { data } = await admin
    .from("project_members")
    .select("project_id")
    .eq("user_id", userId)
    .in("role", ["owner", "editor", "pm"])
    .eq("is_active", true);

  return (data ?? []).map((r: any) => safeStr(r.project_id)).filter(Boolean);
}

async function loadProjectHealth(admin: any, projectIds: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  if (!projectIds.length) return map;

  const { data } = await admin
    .from("project_health_scores")
    .select("project_id, overall_rag, overall_score")
    .in("project_id", projectIds)
    .order("scored_at", { ascending: false });

  // Keep only the latest per project
  for (const row of (data ?? [])) {
    const pid = safeStr(row.project_id);
    if (!map.has(pid)) map.set(pid, row);
  }
  return map;
}

async function loadPendingApprovals(admin: any, projectIds: string[]): Promise<Map<string, { total: number; breaches: number }>> {
  const map = new Map<string, { total: number; breaches: number }>();
  if (!projectIds.length) return map;

  // Count pending artifact approval steps per project
  const { data: artSteps } = await admin
    .from("artifact_approval_steps")
    .select("artifact_id, status, created_at")
    .eq("status", "pending");

  // Map artifact → project
  const artIds = [...new Set((artSteps ?? []).map((r: any) => safeStr(r.artifact_id)).filter(Boolean))];
  if (artIds.length) {
    const { data: arts } = await admin
      .from("artifacts")
      .select("id, project_id")
      .in("id", artIds)
      .in("project_id", projectIds);

    const artProjectMap = new Map<string, string>();
    for (const a of (arts ?? [])) artProjectMap.set(safeStr(a.id), safeStr(a.project_id));

    const now = Date.now();
    for (const step of (artSteps ?? [])) {
      const pid = artProjectMap.get(safeStr(step.artifact_id));
      if (!pid) continue;
      const cur = map.get(pid) ?? { total: 0, breaches: 0 };
      cur.total++;
      // SLA breach: pending > 5 business days (~7 calendar)
      const age = (now - new Date(safeStr(step.created_at)).getTime()) / 86400000;
      if (age > 7) cur.breaches++;
      map.set(pid, cur);
    }
  }

  // Also count pending change request approvals
  const { data: crPending } = await admin
    .from("change_requests")
    .select("project_id, decision_status, created_at")
    .in("project_id", projectIds)
    .eq("decision_status", "submitted");

  const now = Date.now();
  for (const cr of (crPending ?? [])) {
    const pid = safeStr(cr.project_id);
    const cur = map.get(pid) ?? { total: 0, breaches: 0 };
    cur.total++;
    const age = (now - new Date(safeStr(cr.created_at)).getTime()) / 86400000;
    if (age > 7) cur.breaches++;
    map.set(pid, cur);
  }

  return map;
}

async function loadOverdueRaid(admin: any, projectIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!projectIds.length) return map;

  const { data } = await admin
    .from("raid_items")
    .select("project_id, status, due_date, severity")
    .in("project_id", projectIds)
    .not("status", "in", '("closed","resolved","done","cancelled")')
    .lt("due_date", new Date().toISOString().slice(0, 10));

  for (const row of (data ?? [])) {
    const pid = safeStr(row.project_id);
    map.set(pid, (map.get(pid) ?? 0) + 1);
  }
  return map;
}

async function loadMilestonesDue(admin: any, projectIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!projectIds.length) return map;

  const now  = new Date();
  const plus7 = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  const { data } = await admin
    .from("milestones")
    .select("project_id, status, due_date")
    .in("project_id", projectIds)
    .gte("due_date", today)
    .lte("due_date", plus7)
    .not("status", "in", '("completed","done","cancelled","closed")');

  for (const row of (data ?? [])) {
    const pid = safeStr(row.project_id);
    map.set(pid, (map.get(pid) ?? 0) + 1);
  }
  return map;
}

async function loadBudgetVariance(admin: any, projectIds: string[]): Promise<Map<string, number | null>> {
  const map = new Map<string, number | null>();
  if (!projectIds.length) return map;

  // Get latest financial plan artifacts per project
  const { data: arts } = await admin
    .from("artifacts")
    .select("project_id, content_json")
    .in("project_id", projectIds)
    .eq("type", "financial_plan")
    .eq("is_current", true);

  for (const art of (arts ?? [])) {
    const pid     = safeStr(art.project_id);
    const content = (art.content_json as any) ?? {};
    const approved = safeNum(content.total_approved_budget);
    const costLines = Array.isArray(content.cost_lines) ? content.cost_lines : [];
    const forecast  = costLines.reduce((s: number, l: any) => s + safeNum(l.forecast), 0);

    if (approved > 0) {
      const pct = ((forecast - approved) / approved) * 100;
      map.set(pid, Math.round(pct * 10) / 10);
    } else {
      map.set(pid, null);
    }
  }
  return map;
}

async function loadTimesheetForecastAlerts(admin: any, projectIds: string[]): Promise<Set<string>> {
  const alertSet = new Set<string>();
  if (!projectIds.length) return alertSet;

  // Compare approved timesheet days × rate vs forecast from financial plan
  const { data: timesheets } = await admin
    .from("timesheets")
    .select("project_id, user_id, status, week_start_date")
    .in("project_id", projectIds)
    .eq("status", "approved");

  const { data: entries } = await admin
    .from("weekly_timesheet_entries")
    .select("timesheet_id, hours, project_id")
    .in("project_id", projectIds);

  const approvedHoursByProject = new Map<string, number>();
  const tsMap = new Map<string, string>(); // timesheet_id → project_id
  for (const ts of (timesheets ?? [])) {
    tsMap.set(safeStr(ts.id), safeStr(ts.project_id));
  }
  for (const e of (entries ?? [])) {
    const pid = safeStr(e.project_id) || tsMap.get(safeStr(e.timesheet_id)) || "";
    if (!pid) continue;
    approvedHoursByProject.set(pid, (approvedHoursByProject.get(pid) ?? 0) + safeNum(e.hours));
  }

  const { data: arts } = await admin
    .from("artifacts")
    .select("project_id, content_json")
    .in("project_id", projectIds)
    .eq("type", "financial_plan")
    .eq("is_current", true);

  for (const art of (arts ?? [])) {
    const pid     = safeStr(art.project_id);
    const content = (art.content_json as any) ?? {};
    const costLines = Array.isArray(content.cost_lines) ? content.cost_lines : [];
    const peopleForecast = costLines
      .filter((l: any) => safeStr(l.category).toLowerCase().includes("people"))
      .reduce((s: number, l: any) => s + safeNum(l.forecast), 0);

    const approvedHours = approvedHoursByProject.get(pid) ?? 0;
    const approvedDays  = approvedHours / 8;

    const resources = Array.isArray(content.resources) ? content.resources : [];
    const avgRate = resources.length
      ? resources.reduce((s: number, r: any) => s + safeNum(r.day_rate || r.monthly_cost || 0), 0) / resources.length
      : 500; 

    const actualCostEstimate = approvedDays * avgRate;

    if (peopleForecast > 0 && actualCostEstimate > peopleForecast * 1.1) {
      alertSet.add(pid);
    }
  }

  return alertSet;
}

async function loadProjects(admin: any, projectIds: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  if (!projectIds.length) return map;

  const { data } = await admin
    .from("projects")
    .select("id, title, project_code")
    .in("id", projectIds);

  for (const p of (data ?? [])) map.set(safeStr(p.id), p);
  return map;
}

/* ── Main handler ───────────────────────────────────────────────────── */

export async function GET(req: Request) {
  try {
    requireCronSecret(req);

    const admin = createAdminClient();
    const url   = baseUrl();
    const week  = weekOf();

    const pms = await loadPMs(admin);
    if (!pms.length) return jsonOk({ sent: 0, reason: "no PMs found" });

    let sent    = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const pm of pms) {
      if (!pm.email) { skipped++; continue; }

      try {
        const projectIds = await loadProjectsForPM(admin, pm.user_id);
        if (!projectIds.length) { skipped++; continue; }

        const [
          projectsMap,
          healthMap,
          approvalsMap,
          overdueRaidMap,
          milestonesDueMap,
          budgetMap,
          forecastAlerts,
        ] = await Promise.all([
          loadProjects(admin, projectIds),
          loadProjectHealth(admin, projectIds),
          loadPendingApprovals(admin, projectIds),
          loadOverdueRaid(admin, projectIds),
          loadMilestonesDue(admin, projectIds),
          loadBudgetVariance(admin, projectIds),
          loadTimesheetForecastAlerts(admin, projectIds),
        ]);

        const projects: DigestProject[] = projectIds
          .map(pid => {
            const proj      = projectsMap.get(pid);
            if (!proj) return null;
            const health    = healthMap.get(pid);
            const approvals = approvalsMap.get(pid) ?? { total: 0, breaches: 0 };
            const rag       = safeStr(health?.overall_rag || "G").toUpperCase();

            return {
              project_id:          pid,
              project_code:        safeStr(proj.project_code) || null,
              project_title:       safeStr(proj.title) || "Project",
              rag:                 rag === "R" || rag === "A" || rag === "G" ? rag : "G",
              pending_approvals:   approvals.total,
              sla_breaches:        approvals.breaches,
              overdue_raid:        overdueRaidMap.get(pid) ?? 0,
              milestones_due_7d:  milestonesDueMap.get(pid) ?? 0,
              budget_variance_pct: budgetMap.get(pid) ?? null,
              forecast_alert:      forecastAlerts.has(pid),
            } satisfies DigestProject;
          })
          .filter(Boolean) as DigestProject[];

        projects.sort((a, b) => {
          const ragOrder = (r: string) => r === "R" ? 0 : r === "A" ? 1 : 2;
          if (ragOrder(a.rag) !== ragOrder(b.rag)) return ragOrder(a.rag) - ragOrder(b.rag);
          const aAlerts = a.pending_approvals + a.sla_breaches + a.overdue_raid;
          const bAlerts = b.pending_approvals + b.sla_breaches + b.overdue_raid;
          return bAlerts - aAlerts;
        });

        const totalPending   = projects.reduce((s, p) => s + p.pending_approvals, 0);
        const totalBreaches  = projects.reduce((s, p) => s + p.sla_breaches, 0);
        const totalRaid      = projects.reduce((s, p) => s + p.overdue_raid, 0);
        const totalMilestone = projects.reduce((s, p) => s + p.milestones_due_7d, 0);

        const hasAnything = totalPending + totalBreaches + totalRaid + totalMilestone > 0 || projects.length > 0;
        if (!hasAnything) { skipped++; continue; }

        await sendWeeklyDigestEmail({
          to:                    pm.email,
          recipientName:         pm.full_name,
          weekOf:                week,
          baseUrl:               url,
          projects,
          totalPendingApprovals: totalPending,
          totalSlaBreaches:      totalBreaches,
          totalOverdueRaid:      totalRaid,
          totalMilestonesDue:    totalMilestone,
        });

        sent++;
        await new Promise(r => setTimeout(r, 300));

      } catch (pmErr: any) {
        errors.push(`${pm.email}: ${safeStr(pmErr?.message)}`);
        console.error(`[weekly-digest] PM ${pm.email} failed:`, pmErr);
      }
    }

    return jsonOk({
      sent,
      skipped,
      total_pms:    pms.length,
      errors_count: errors.length,
      errors:        errors.slice(0, 10),
    });

  } catch (e: any) {
    console.error("[weekly-digest] FATAL:", e);
    return jsonErr(safeStr(e?.message) || "Digest failed", 500);
  }
}
