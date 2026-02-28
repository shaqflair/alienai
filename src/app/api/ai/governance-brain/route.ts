// src/app/api/ai/governance-brain/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* =======================
   Helpers
======================= */

function noStoreJson(payload: any, status = 200) {
  const res = NextResponse.json(payload, { status });
  res.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

// ? Hardened: handle Postgres date-only ("YYYY-MM-DD") as LOCAL date (prevents 1-day drift)
function toDate(x: any): Date | null {
  if (!x) return null;

  if (typeof x === "string") {
    const s = x.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [yy, mm, dd] = s.split("-").map((v) => Number(v));
      const dt = new Date(yy, (mm || 1) - 1, dd || 1);
      return Number.isFinite(dt.getTime()) ? dt : null;
    }
  }

  const d = new Date(x);
  return Number.isFinite(d.getTime()) ? d : null;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function daysBetween(a: Date, b: Date) {
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function ragFromScore(score: number): "G" | "A" | "R" {
  if (score <= 40) return "R";
  if (score <= 70) return "A";
  return "G";
}

function parseIntSafe(x: any, fallback: number) {
  const n = Number.parseInt(String(x ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

/* =======================
   Config (v1)
======================= */

const DEFAULT_APPROVAL_SLA_DAYS = 5;
const DEFAULT_CHANGE_SLA_DAYS = 7;
const DEFAULT_IDLE_DAYS = 14;

/* =======================
   Types
======================= */

type BrainScope = "active" | "all";

type ProjectSignals = {
  overdue_approvals: number;
  breached_tasks: number;
  breached_wbs: number;
  blocked_wbs: number;
  breached_changes: number;
  high_raid: number;
  overdue_raid: number;
  idle_days: number;
};

type OrgBrain = {
  org_id: string;
  org_name?: string;

  approvals: {
    total_pending_steps: number; // rows in view (per approver link)
    unique_pending_items: number; // unique artifact_step_id
    overdue_steps: number;
    oldest_pending_days: number;
    blocked_projects: number;
    top_blockers: Array<{
      key: string; // user_id or email
      label: string; // best-effort
      count: number;
      overdue_count: number;
      oldest_days: number;
    }>;
  };

  sla: {
    breached_total: number;
    breached_by_type: Record<string, number>;
  };

  blockers: {
    projects_blocked: number;
    reasons: Array<{ type: string; count: number }>;
  };

  health: {
    portfolio_score: number;
    portfolio_rag: "G" | "A" | "R";
    projects: Array<{
      project_id: string;
      project_code?: string;
      project_title: string;
      score: number;
      rag: "G" | "A" | "R";
      signals: ProjectSignals;
    }>;
  };

  // ? Optional extras (non-breaking) for UI fallback lists
  samples?: {
    sla_breakdown?: Array<{ key: string; count: number }>;
    worst_projects?: Array<{ project_id: string; project_title: string; score: number; rag: "G" | "A" | "R" }>;
  };

  ai_summary: string;
};

type GovernanceBrainResponse = {
  ok: boolean;
  scope: BrainScope;
  generated_at: string;
  config: {
    approval_sla_days: number;
    change_sla_days: number;
    idle_days: number;
  };
  rollup: {
    org_count: number;
    portfolio_score_avg: number;
    overdue_approvals: number;
    breached_total: number;
    blocked_projects: number;
  };
  orgs: OrgBrain[];
};

/* =======================
   Org + membership
======================= */

async function getActiveOrgId(supabase: any, userId: string) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("active_organisation_id")
    .eq("id", userId)
    .maybeSingle();
  return safeStr(profile?.active_organisation_id) || "";
}

async function getMemberOrgIds(supabase: any, userId: string) {
  const { data } = await supabase
    .from("organisation_members")
    .select("organisation_id")
    .eq("user_id", userId);

  const ids = (data ?? [])
    .map((r: any) => safeStr(r.organisation_id))
    .filter(Boolean);

  return uniq(ids);
}

async function getOrgMeta(supabase: any, orgIds: string[]) {
  const map = new Map<string, { name?: string }>();
  if (!orgIds.length) return map;

  const { data } = await supabase
    .from("organisations")
    .select("id,name")
    .in("id", orgIds);

  (data ?? []).forEach((o: any) => {
    map.set(safeStr(o.id), { name: safeStr(o.name) || undefined });
  });

  return map;
}

/* =======================
   Core brain per org
======================= */

async function buildOrgBrain(opts: {
  supabase: any;
  orgId: string;
  orgName?: string;
  scope: BrainScope;
  approvalSlaDays: number;
  changeSlaDays: number;
  idleDays: number;
}): Promise<OrgBrain> {
  const {
    supabase,
    orgId,
    orgName,
    scope,
    approvalSlaDays,
    changeSlaDays,
    idleDays,
  } = opts;

  const now = new Date();

  // -------------------------
  // Projects selection
  // active: LIVE only
  // all: all non-deleted projects in org
  // -------------------------
  let projQ = supabase
    .from("projects")
    .select(
      "id,title,project_code,created_at,updated_at,status,lifecycle_status,deleted_at,organisation_id"
    )
    .eq("organisation_id", orgId)
    .is("deleted_at", null);

  if (scope === "active") {
    projQ = projQ.eq("status", "active").in("lifecycle_status", ["active", "paused"]);
  }

  const { data: projectsRaw } = await projQ;

  const projects = (projectsRaw ?? []).map((p: any) => ({
    id: safeStr(p.id),
    title: safeStr(p.title) || "Untitled project",
    project_code: safeStr(p.project_code) || "",
    created_at: p.created_at,
    updated_at: p.updated_at,
  }));

  const projectIds = projects.map((p: any) => p.id).filter(Boolean);

  if (!projectIds.length) {
    return {
      org_id: orgId,
      org_name: orgName,
      approvals: {
        total_pending_steps: 0,
        unique_pending_items: 0,
        overdue_steps: 0,
        oldest_pending_days: 0,
        blocked_projects: 0,
        top_blockers: [],
      },
      sla: { breached_total: 0, breached_by_type: {} },
      blockers: { projects_blocked: 0, reasons: [] },
      health: { portfolio_score: 100, portfolio_rag: "G", projects: [] },
      samples: { sla_breakdown: [], worst_projects: [] },
      ai_summary:
        scope === "active"
          ? "No live projects found for this organisation."
          : "No projects found for this organisation.",
    };
  }

  // -------------------------
  // Approvals view (pending)
  // -------------------------
  const { data: approvalsRaw } = await supabase
    .from("v_pending_artifact_approvals_all")
    .select(
      [
        "project_id",
        "artifact_id",
        "artifact_type",
        "title",
        "approval_status",
        "artifact_step_id",
        "step_name",
        "step_order",
        "step_status",
        "pending_user_id",
        "pending_email",
        "approver_role",
        "step_pending_since",
      ].join(",")
    )
    .in("project_id", projectIds);

  const approvals = (approvalsRaw ?? []) as any[];
  const totalPendingSteps = approvals.length;

  const uniquePendingItems = uniq(
    approvals.map((r) => safeStr(r.artifact_step_id)).filter(Boolean)
  ).length;

  const approvalAges = approvals
    .map((r) => {
      const d = toDate(r.step_pending_since);
      return d ? Math.max(0, daysBetween(d, now)) : 0;
    })
    .filter((n) => Number.isFinite(n));

  const oldestPendingDays = approvalAges.length ? Math.max(...approvalAges) : 0;

  const overdueApprovalRows = approvals.filter((r) => {
    const d = toDate(r.step_pending_since);
    if (!d) return false;
    return daysBetween(d, now) > approvalSlaDays;
  });

  const blockedProjectIdsByApproval = uniq(
    overdueApprovalRows.map((r) => safeStr(r.project_id)).filter(Boolean)
  );

  const blockerMap = new Map<
    string,
    { label: string; count: number; overdue_count: number; oldest_days: number }
  >();

  for (const r of approvals) {
    const uid = safeStr(r.pending_user_id);
    const em = safeStr(r.pending_email);
    const key = uid || em || "unknown";
    const label = uid ? `user:${uid}` : em || "unknown";

    const pendingSince = toDate(r.step_pending_since);
    const age = pendingSince ? Math.max(0, daysBetween(pendingSince, now)) : 0;
    const isOverdue = age > approvalSlaDays;

    const cur = blockerMap.get(key) ?? {
      label,
      count: 0,
      overdue_count: 0,
      oldest_days: 0,
    };

    cur.count += 1;
    if (isOverdue) cur.overdue_count += 1;
    cur.oldest_days = Math.max(cur.oldest_days, age);

    blockerMap.set(key, cur);
  }

  const topBlockers = Array.from(blockerMap.entries())
    .map(([key, v]) => ({ key, ...v }))
    .sort(
      (a, b) =>
        b.overdue_count - a.overdue_count ||
        b.count - a.count ||
        b.oldest_days - a.oldest_days
    )
    .slice(0, 8);

  // -------------------------
  // Work items (status open)
  // -------------------------
  const { data: workRaw } = await supabase
    .from("work_items")
    .select("id,project_id,title,status,due_date,updated_at,completed_at")
    .in("project_id", projectIds);

  const workItems = (workRaw ?? []) as any[];

  const breachedTasks = workItems.filter((w) => {
    const status = safeStr(w.status).toLowerCase();
    if (status !== "open") return false;
    const due = toDate(w.due_date);
    if (!due) return false;
    return now > due;
  });

  // -------------------------
  // WBS items
  // -------------------------
  const { data: wbsRaw } = await supabase
    .from("wbs_items")
    .select("id,project_id,name,status,due_date,updated_at,owner")
    .in("project_id", projectIds);

  const wbsItems = (wbsRaw ?? []) as any[];

  const breachedWbs = wbsItems.filter((x) => {
    const status = safeStr(x.status).toLowerCase();
    if (status === "done") return false;
    const due = toDate(x.due_date);
    if (!due) return false;
    return now > due;
  });

  const blockedWbs = wbsItems.filter(
    (x) => safeStr(x.status).toLowerCase() === "blocked"
  );

  // -------------------------
  // RAID items
  // -------------------------
  const { data: raidRaw } = await supabase
    .from("raid_items")
    .select(
      "id,project_id,type,status,priority,severity,due_date,updated_at,created_at,title,owner_label,public_id"
    )
    .in("project_id", projectIds);

  const raidItems = (raidRaw ?? []) as any[];

  const highRaid = raidItems.filter((r) => {
    const status = safeStr(r.status);
    if (status === "Closed" || status === "Invalid") return false;

    const type = safeStr(r.type);
    const blockerType =
      type === "Risk" || type === "Issue" || type === "Dependency";

    const pr = safeStr(r.priority);
    const sev = typeof r.severity === "number" ? r.severity : null;

    const isHighPriority = pr === "High" || pr === "Critical";
    const isHighSeverity = sev != null && sev >= 70;

    return blockerType && (isHighPriority || isHighSeverity);
  });

  const overdueRaid = raidItems.filter((r) => {
    const status = safeStr(r.status);
    if (status === "Closed" || status === "Invalid") return false;
    const due = toDate(r.due_date);
    if (!due) return false;
    return now > due;
  });

  // -------------------------
  // Change requests
  // -------------------------
  const { data: changesRaw } = await supabase
    .from("change_requests")
    .select(
      "id,project_id,title,status,decision_status,delivery_status,review_by,created_at,updated_at,public_id,priority"
    )
    .in("project_id", projectIds);

  const changes = (changesRaw ?? []) as any[];

  const pendingChanges = changes.filter((c) => {
    const s = safeStr(c.status);
    const d = safeStr(c.decision_status);
    if (s === "approved" || s === "rejected") return false;
    if (d === "approved" || d === "rejected") return false;
    return true;
  });

  const breachedChanges = pendingChanges.filter((c) => {
    const reviewBy = toDate(c.review_by);
    if (reviewBy) return now > reviewBy;

    const since = toDate(c.updated_at) || toDate(c.created_at);
    if (!since) return false;
    return daysBetween(since, now) > changeSlaDays;
  });

  // -------------------------
  // SLA summary (org-level)
  // -------------------------
  const breachedByType: Record<string, number> = {
    approvals: overdueApprovalRows.length,
    tasks: breachedTasks.length,
    wbs: breachedWbs.length,
    wbs_blocked: blockedWbs.length,
    changes: breachedChanges.length,
    raid_high: highRaid.length,
    raid_overdue: overdueRaid.length,
  };

  const breachedTotal = Object.values(breachedByType).reduce((a, b) => a + b, 0);

  // -------------------------
  // Blockers summary
  // -------------------------
  const blockerReasons: Array<{ type: string; count: number }> = [];

  const projectsWithOverdueTasks = uniq(
    breachedTasks.map((t) => safeStr(t.project_id)).filter(Boolean)
  );
  const projectsWithBlockedWbs = uniq(
    blockedWbs.map((x) => safeStr(x.project_id)).filter(Boolean)
  );
  const projectsWithHighRaid = uniq(
    highRaid.map((x) => safeStr(x.project_id)).filter(Boolean)
  );
  const projectsWithOverdueRaid = uniq(
    overdueRaid.map((x) => safeStr(x.project_id)).filter(Boolean)
  );
  const projectsWithBreachedChanges = uniq(
    breachedChanges.map((x) => safeStr(x.project_id)).filter(Boolean)
  );

  if (blockedProjectIdsByApproval.length)
    blockerReasons.push({ type: "approval", count: blockedProjectIdsByApproval.length });
  if (projectsWithOverdueTasks.length)
    blockerReasons.push({ type: "task", count: projectsWithOverdueTasks.length });
  if (projectsWithBlockedWbs.length)
    blockerReasons.push({ type: "wbs_blocked", count: projectsWithBlockedWbs.length });
  if (projectsWithHighRaid.length)
    blockerReasons.push({ type: "raid_high", count: projectsWithHighRaid.length });
  if (projectsWithOverdueRaid.length)
    blockerReasons.push({ type: "raid_overdue", count: projectsWithOverdueRaid.length });
  if (projectsWithBreachedChanges.length)
    blockerReasons.push({ type: "change", count: projectsWithBreachedChanges.length });

  const blockedProjectIds = uniq([
    ...blockedProjectIdsByApproval,
    ...projectsWithOverdueTasks,
    ...projectsWithBlockedWbs,
    ...projectsWithHighRaid,
    ...projectsWithOverdueRaid,
    ...projectsWithBreachedChanges,
  ]).filter(Boolean);

  // -------------------------
  // Project-level health scoring
  // -------------------------
  const mapCount = (rows: any[]) => {
    const m = new Map<string, number>();
    rows.forEach((r) => {
      const pid = safeStr(r.project_id);
      if (!pid) return;
      m.set(pid, (m.get(pid) ?? 0) + 1);
    });
    return m;
  };

  const byProjOverdueApprovals = mapCount(overdueApprovalRows);
  const byProjBreachedTasks = mapCount(breachedTasks);
  const byProjBreachedWbs = mapCount(breachedWbs);
  const byProjBlockedWbs = mapCount(blockedWbs);
  const byProjBreachedChanges = mapCount(breachedChanges);
  const byProjHighRaid = mapCount(highRaid);
  const byProjOverdueRaid = mapCount(overdueRaid);

  const projectScores = projects.map((p: any) => {
    const overdueApprovalsN = byProjOverdueApprovals.get(p.id) ?? 0;
    const breachedTasksN = byProjBreachedTasks.get(p.id) ?? 0;
    const breachedWbsN = byProjBreachedWbs.get(p.id) ?? 0;
    const blockedWbsN = byProjBlockedWbs.get(p.id) ?? 0;
    const breachedChangesN = byProjBreachedChanges.get(p.id) ?? 0;
    const highRaidN = byProjHighRaid.get(p.id) ?? 0;
    const overdueRaidN = byProjOverdueRaid.get(p.id) ?? 0;

    const updatedAt = toDate(p.updated_at);
    const createdAt = toDate(p.created_at);
    const idle = updatedAt ? Math.max(0, daysBetween(updatedAt, now)) : 0;
    const isNew = createdAt ? daysBetween(createdAt, now) <= idleDays : false;

    let score = 100;

    if (overdueApprovalsN > 0) score -= 10 + Math.min(20, overdueApprovalsN * 2);
    if (breachedTasksN > 0) score -= 10 + Math.min(25, breachedTasksN * 2);
    if (breachedWbsN > 0) score -= 8 + Math.min(20, breachedWbsN * 2);
    if (blockedWbsN > 0) score -= 10 + Math.min(25, blockedWbsN * 3);
    if (breachedChangesN > 0) score -= 8 + Math.min(20, breachedChangesN * 2);
    if (highRaidN > 0) score -= 15 + Math.min(35, highRaidN * 5);
    if (overdueRaidN > 0) score -= 8 + Math.min(25, overdueRaidN * 2);
    if (!isNew && idle > idleDays) score -= 10;

    score = clamp(score, 0, 100);

    const signals: ProjectSignals = {
      overdue_approvals: overdueApprovalsN,
      breached_tasks: breachedTasksN,
      breached_wbs: breachedWbsN,
      blocked_wbs: blockedWbsN,
      breached_changes: breachedChangesN,
      high_raid: highRaidN,
      overdue_raid: overdueRaidN,
      idle_days: idle,
    };

    return {
      project_id: p.id,
      project_code: p.project_code || "",
      project_title: p.title,
      score,
      rag: ragFromScore(score),
      signals,
    };
  });

  const portfolioScore =
    projectScores.length > 0
      ? Math.round(projectScores.reduce((a: any, b: any) => a + b.score, 0) / projectScores.length)
      : 100;

  const portfolioRag = ragFromScore(portfolioScore);

  // -------------------------
  // Executive narrative (deterministic v1)
  // -------------------------
  const healthLine = `Portfolio health is ${
    portfolioRag === "G" ? "GREEN" : portfolioRag === "A" ? "AMBER" : "RED"
  } (score ${portfolioScore}).`;

  const blockedLine = blockedProjectIds.length
    ? `${blockedProjectIds.length} project(s) are blocked across approvals/tasks/WBS/RAID/changes.`
    : `No active blockers detected across projects.`;

  const approvalLine = overdueApprovalRows.length
    ? `${overdueApprovalRows.length} approval step(s) are overdue (SLA ${approvalSlaDays}d).`
    : `No overdue approvals.`;

  const bottleneckLine = topBlockers.length
    ? `Top bottleneck(s): ${topBlockers
        .slice(0, 3)
        .map((b) => `${b.label} (${b.overdue_count || 0} overdue)`)
        .join(", ")}.`
    : `No approval bottlenecks identified.`;

  const aiSummary = [healthLine, blockedLine, approvalLine, bottleneckLine].join(" ");

  return {
    org_id: orgId,
    org_name: orgName,

    approvals: {
      total_pending_steps: totalPendingSteps,
      unique_pending_items: uniquePendingItems,
      overdue_steps: overdueApprovalRows.length,
      oldest_pending_days: oldestPendingDays,
      blocked_projects: blockedProjectIdsByApproval.length,
      top_blockers: topBlockers,
    },

    sla: {
      breached_total: breachedTotal,
      breached_by_type: breachedByType,
    },

    blockers: {
      projects_blocked: blockedProjectIds.length,
      reasons: blockerReasons,
    },

    health: {
      portfolio_score: portfolioScore,
      portfolio_rag: portfolioRag,
      projects: projectScores.sort((a: any, b: any) => a.score - b.score).slice(0, 50),
    },

    samples: {
      sla_breakdown: Object.entries(breachedByType)
        .map(([key, count]) => ({ key, count }))
        .filter((x) => x.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
      worst_projects: projectScores
        .slice()
        .sort((a: any, b: any) => a.score - b.score)
        .slice(0, 8)
        .map((p) => ({
          project_id: p.project_id,
          project_title: p.project_title,
          score: p.score,
          rag: p.rag,
        })),
    },

    ai_summary: aiSummary,
  };
}

/* =======================
   Route
======================= */

function parseScope(req: Request): BrainScope {
  const u = new URL(req.url);
  const s = safeStr(u.searchParams.get("scope")).toLowerCase();
  return s === "all" ? "all" : "active";
}

function parseConfig(req: Request) {
  const u = new URL(req.url);
  const approvalSlaDays = clamp(
    parseIntSafe(u.searchParams.get("approvalSlaDays"), DEFAULT_APPROVAL_SLA_DAYS),
    1,
    60
  );
  const changeSlaDays = clamp(
    parseIntSafe(u.searchParams.get("changeSlaDays"), DEFAULT_CHANGE_SLA_DAYS),
    1,
    60
  );
  const idleDays = clamp(
    parseIntSafe(u.searchParams.get("idleDays"), DEFAULT_IDLE_DAYS),
    3,
    90
  );
  return { approvalSlaDays, changeSlaDays, idleDays };
}

async function handle(req: Request) {
  try {
    const supabase = await createClient();
    const { data: u, error: ue } = await supabase.auth.getUser();
    if (ue || !u?.user) return noStoreJson({ ok: false, error: "Unauthorized" }, 401);

    const scope = parseScope(req);
    const { approvalSlaDays, changeSlaDays, idleDays } = parseConfig(req);

    const userId = safeStr(u.user.id);
    const activeOrgId = await getActiveOrgId(supabase, userId);
    const memberOrgIds = await getMemberOrgIds(supabase, userId);

    const allowedOrgIds = memberOrgIds;

    const targetOrgIds: string[] =
      scope === "all"
        ? allowedOrgIds
        : activeOrgId && allowedOrgIds.includes(activeOrgId)
          ? [activeOrgId]
          : allowedOrgIds.slice(0, 1);

    if (!targetOrgIds.length) {
      const empty: GovernanceBrainResponse = {
        ok: true,
        scope,
        generated_at: new Date().toISOString(),
        config: {
          approval_sla_days: approvalSlaDays,
          change_sla_days: changeSlaDays,
          idle_days: idleDays,
        },
        rollup: {
          org_count: 0,
          portfolio_score_avg: 0,
          overdue_approvals: 0,
          breached_total: 0,
          blocked_projects: 0,
        },
        orgs: [],
      };
      return noStoreJson(empty);
    }

    const meta = await getOrgMeta(supabase, targetOrgIds);

    const orgs: OrgBrain[] = [];
    for (const orgId of targetOrgIds) {
      orgs.push(
        await buildOrgBrain({
          supabase,
          orgId,
          orgName: meta.get(orgId)?.name,
          scope,
          approvalSlaDays,
          changeSlaDays,
          idleDays,
        })
      );
    }

    const rollup = {
      org_count: orgs.length,
      portfolio_score_avg: Math.round(
        orgs.reduce((a, b) => a + (b.health?.portfolio_score ?? 0), 0) / orgs.length
      ),
      overdue_approvals: orgs.reduce((a, b) => a + (b.approvals?.overdue_steps ?? 0), 0),
      breached_total: orgs.reduce((a, b) => a + (b.sla?.breached_total ?? 0), 0),
      blocked_projects: orgs.reduce((a, b) => a + (b.blockers?.projects_blocked ?? 0), 0),
    };

    const out: GovernanceBrainResponse = {
      ok: true,
      scope,
      generated_at: new Date().toISOString(),
      config: {
        approval_sla_days: approvalSlaDays,
        change_sla_days: changeSlaDays,
        idle_days: idleDays,
      },
      rollup,
      orgs,
    };

    return noStoreJson(out);
  } catch (e: any) {
    return noStoreJson(
      { ok: false, error: safeStr(e?.message || e || "Unknown error") },
      500
    );
  }
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}