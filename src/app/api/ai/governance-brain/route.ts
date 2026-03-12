// src/app/api/ai/governance-brain/route.ts — REBUILT v2
// ✅ GB-F1: Shared portfolio scope via resolvePortfolioScope(supabase, userId)
// ✅ GB-F2: Active-only filtering via filterActiveProjectIds with scoped FAIL-OPEN
// ✅ GB-F3: No-store on all responses
// ✅ GB-F4: Governance brain now matches portfolio dashboard project scope
// ✅ GB-F5: scope=all keeps scoped candidates; scope=active applies active filter
// ✅ GB-F6: Removes org-membership-only project resolution drift
// ✅ GB-F7: Returns scope meta / counts for debugging dashboard mismatches

import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";
import { filterActiveProjectIds } from "@/lib/server/project-scope";

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

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function parseIntSafe(x: any, fallback: number) {
  const n = Number.parseInt(String(x ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function ragFromScore(score: number): "G" | "A" | "R" {
  if (score < 70) return "R";
  if (score < 85) return "A";
  return "G";
}

// Hardened: treat YYYY-MM-DD as local date to avoid 1-day drift
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

function daysBetween(a: Date, b: Date) {
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function uniqueStrings(xs: any[]): string[] {
  return Array.from(
    new Set(
      (Array.isArray(xs) ? xs : [])
        .map((x) => safeStr(x).trim())
        .filter(Boolean)
    )
  );
}

async function normalizeActiveIds(supabase: any, rawIds: string[]) {
  const failOpen = (reason: string) => ({
    ids: rawIds,
    ok: false,
    error: reason,
  });

  try {
    const r: any = await filterActiveProjectIds(supabase, rawIds);

    if (Array.isArray(r)) {
      const ids = r.filter(Boolean);
      if (!ids.length && rawIds.length) {
        return failOpen("active filter returned 0 ids; failing open");
      }
      return { ids, ok: true, error: null as string | null };
    }

    const ids = Array.isArray(r?.projectIds) ? r.projectIds.filter(Boolean) : [];
    if (!ids.length && rawIds.length) {
      return failOpen("active filter returned 0 ids; failing open");
    }

    return {
      ids,
      ok: !r?.error,
      error: r?.error ? safeStr(r.error?.message || r.error) : null,
    };
  } catch (e: any) {
    return failOpen(safeStr(e?.message || e || "active filter failed"));
  }
}

/* =======================
   Config
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
    total_pending_steps: number;
    unique_pending_items: number;
    overdue_steps: number;
    oldest_pending_days: number;
    blocked_projects: number;
    top_blockers: Array<{
      key: string;
      label: string;
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

  samples?: {
    sla_breakdown?: Array<{ key: string; count: number }>;
    worst_projects?: Array<{
      project_id: string;
      project_title: string;
      score: number;
      rag: "G" | "A" | "R";
    }>;
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
  meta?: {
    scope_type: "portfolio";
    organisationId: string | null;
    scopeMeta: any;
    scopeCounts: {
      scopedIdsRaw: number;
      scopedIdsSelected: number;
    };
    active_filter_ok: boolean;
    active_filter_error: string | null;
  };
};

/* =======================
   Scope + metadata
======================= */

async function getOrgMetaByIds(supabase: any, orgIds: string[]) {
  const map = new Map<string, { name?: string }>();
  if (!orgIds.length) return map;

  const { data } = await supabase
    .from("organisations")
    .select("id,name")
    .in("id", orgIds);

  for (const o of data ?? []) {
    map.set(safeStr((o as any).id), {
      name: safeStr((o as any).name) || undefined,
    });
  }

  return map;
}

async function loadScopedProjects(args: {
  supabase: any;
  userId: string;
  scope: BrainScope;
}) {
  const { supabase, userId, scope } = args;

  const sharedScope = await resolvePortfolioScope(supabase, userId);
  const organisationId = sharedScope.organisationId ?? null;
  const scopeMeta = sharedScope.meta ?? {};

  const scopedRaw: string[] = Array.isArray(sharedScope.rawProjectIds)
    ? sharedScope.rawProjectIds
    : Array.isArray(sharedScope.projectIds)
      ? sharedScope.projectIds
      : [];

  let selectedIds = scopedRaw;
  let activeMeta = { ok: true, error: null as string | null };

  if (scope === "active") {
    const active = await normalizeActiveIds(supabase, scopedRaw);
    selectedIds = active.ids;
    activeMeta = { ok: active.ok, error: active.error };
  }

  if (!selectedIds.length) {
    return {
      organisationId,
      scopeMeta,
      scopedRaw,
      selectedIds,
      activeMeta,
      projects: [] as Array<{
        id: string;
        title: string;
        project_code: string;
        created_at: any;
        updated_at: any;
        organisation_id: string | null;
      }>,
    };
  }

  const { data: projectsRaw, error } = await supabase
    .from("projects")
    .select("id,title,project_code,created_at,updated_at,organisation_id,deleted_at")
    .in("id", selectedIds)
    .is("deleted_at", null)
    .limit(20000);

  if (error) throw new Error(error.message);

  const orderMap = new Map<string, number>();
  selectedIds.forEach((id, idx) => orderMap.set(id, idx));

  const projects = (projectsRaw ?? [])
    .map((p: any) => ({
      id: safeStr(p.id),
      title: safeStr(p.title) || "Untitled project",
      project_code: safeStr(p.project_code) || "",
      created_at: p.created_at,
      updated_at: p.updated_at,
      organisation_id: safeStr(p.organisation_id) || null,
    }))
    .filter((p) => p.id)
    .sort((a, b) => (orderMap.get(a.id) ?? 999999) - (orderMap.get(b.id) ?? 999999));

  return {
    organisationId,
    scopeMeta,
    scopedRaw,
    selectedIds,
    activeMeta,
    projects,
  };
}

/* =======================
   Brain builder from scoped projects
======================= */

async function buildScopedBrain(opts: {
  supabase: any;
  projects: Array<{
    id: string;
    title: string;
    project_code: string;
    created_at: any;
    updated_at: any;
    organisation_id: string | null;
  }>;
  approvalSlaDays: number;
  changeSlaDays: number;
  idleDays: number;
  preferredOrgId?: string | null;
}): Promise<OrgBrain[]> {
  const {
    supabase,
    projects,
    approvalSlaDays,
    changeSlaDays,
    idleDays,
    preferredOrgId,
  } = opts;

  const now = new Date();
  const projectIds = projects.map((p) => p.id).filter(Boolean);

  if (!projectIds.length) {
    return [
      {
        org_id: preferredOrgId || "portfolio",
        org_name: undefined,
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
        ai_summary: "No projects found for the current portfolio scope.",
      },
    ];
  }

  const orgIds = uniqueStrings(projects.map((p) => p.organisation_id));
  const orgMetaMap = await getOrgMetaByIds(supabase, orgIds);

  const [approvalsRes, workRes, wbsRes, raidRes, changeRes, cronHealthRes] = await Promise.all([
    supabase
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
      .in("project_id", projectIds),

    supabase
      .from("work_items")
      .select("id,project_id,title,status,due_date,updated_at,completed_at")
      .in("project_id", projectIds),

    supabase
      .from("wbs_items")
      .select("id,project_id,name,status,due_date,updated_at,owner")
      .in("project_id", projectIds),

    supabase
      .from("raid_items")
      .select(
        "id,project_id,type,status,priority,severity,due_date,updated_at,created_at,title,owner_label,public_id"
      )
      .in("project_id", projectIds),

    supabase
      .from("change_requests")
      .select(
        "id,project_id,title,status,decision_status,delivery_status,review_by,created_at,updated_at,public_id,priority"
      )
      .in("project_id", projectIds),

    supabase
      .from("project_health")
      .select("project_id, overall_rag")
      .in("project_id", projectIds),
  ]);

  const approvals = (approvalsRes.data ?? []) as any[];
  const workItems = (workRes.data ?? []) as any[];
  const wbsItems = (wbsRes.data ?? []) as any[];
  const raidItems = (raidRes.data ?? []) as any[];
  const changes = (changeRes.data ?? []) as any[];
  const cronHealthRows = (cronHealthRes.data ?? []) as any[];

  const overdueApprovalRows = approvals.filter((r) => {
    const d = toDate(r.step_pending_since);
    if (!d) return false;
    return daysBetween(d, now) > approvalSlaDays;
  });

  const breachedTasks = workItems.filter((w) => {
    const status = safeStr(w.status).toLowerCase();
    if (status !== "open") return false;
    const due = toDate(w.due_date);
    if (!due) return false;
    return now > due;
  });

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

  const pendingChanges = changes.filter((c) => {
    const s = safeStr(c.status).toLowerCase();
    const d = safeStr(c.decision_status).toLowerCase();
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

  const cronHealthMap = new Map<string, string>();
  for (const r of cronHealthRows) {
    if (r?.project_id && r?.overall_rag) {
      cronHealthMap.set(String(r.project_id), String(r.overall_rag));
    }
  }

  function cronRagToScore(rag: string): number | null {
    if (rag === "green") return 90;
    if (rag === "amber") return 75;
    if (rag === "red") return 50;
    return null;
  }

  const approvalAges = approvals
    .map((r) => {
      const d = toDate(r.step_pending_since);
      return d ? Math.max(0, daysBetween(d, now)) : 0;
    })
    .filter((n) => Number.isFinite(n));

  const oldestPendingDays = approvalAges.length ? Math.max(...approvalAges) : 0;

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

  const grouped = new Map<string, typeof projects>();
  for (const p of projects) {
    const orgId = p.organisation_id || preferredOrgId || "portfolio";
    const arr = grouped.get(orgId) ?? [];
    arr.push(p);
    grouped.set(orgId, arr);
  }

  const orgs: OrgBrain[] = [];

  for (const [orgId, orgProjects] of grouped.entries()) {
    const orgProjectIds = new Set(orgProjects.map((p) => p.id));

    const orgApprovals = approvals.filter((r) => orgProjectIds.has(safeStr(r.project_id)));
    const orgOverdueApprovals = overdueApprovalRows.filter((r) =>
      orgProjectIds.has(safeStr(r.project_id))
    );
    const orgBreachedTasks = breachedTasks.filter((r) =>
      orgProjectIds.has(safeStr(r.project_id))
    );
    const orgBreachedWbs = breachedWbs.filter((r) =>
      orgProjectIds.has(safeStr(r.project_id))
    );
    const orgBlockedWbs = blockedWbs.filter((r) =>
      orgProjectIds.has(safeStr(r.project_id))
    );
    const orgHighRaid = highRaid.filter((r) =>
      orgProjectIds.has(safeStr(r.project_id))
    );
    const orgOverdueRaid = overdueRaid.filter((r) =>
      orgProjectIds.has(safeStr(r.project_id))
    );
    const orgBreachedChanges = breachedChanges.filter((r) =>
      orgProjectIds.has(safeStr(r.project_id))
    );

    const totalPendingSteps = orgApprovals.length;
    const uniquePendingItems = uniq(
      orgApprovals.map((r) => safeStr(r.artifact_step_id)).filter(Boolean)
    ).length;

    const blockedProjectIdsByApproval = uniq(
      orgOverdueApprovals.map((r) => safeStr(r.project_id)).filter(Boolean)
    );

    const projectsWithOverdueTasks = uniq(
      orgBreachedTasks.map((t) => safeStr(t.project_id)).filter(Boolean)
    );
    const projectsWithBlockedWbs = uniq(
      orgBlockedWbs.map((x) => safeStr(x.project_id)).filter(Boolean)
    );
    const projectsWithHighRaid = uniq(
      orgHighRaid.map((x) => safeStr(x.project_id)).filter(Boolean)
    );
    const projectsWithOverdueRaid = uniq(
      orgOverdueRaid.map((x) => safeStr(x.project_id)).filter(Boolean)
    );
    const projectsWithBreachedChanges = uniq(
      orgBreachedChanges.map((x) => safeStr(x.project_id)).filter(Boolean)
    );

    const blockerReasons: Array<{ type: string; count: number }> = [];
    if (blockedProjectIdsByApproval.length) {
      blockerReasons.push({ type: "approval", count: blockedProjectIdsByApproval.length });
    }
    if (projectsWithOverdueTasks.length) {
      blockerReasons.push({ type: "task", count: projectsWithOverdueTasks.length });
    }
    if (projectsWithBlockedWbs.length) {
      blockerReasons.push({ type: "wbs_blocked", count: projectsWithBlockedWbs.length });
    }
    if (projectsWithHighRaid.length) {
      blockerReasons.push({ type: "raid_high", count: projectsWithHighRaid.length });
    }
    if (projectsWithOverdueRaid.length) {
      blockerReasons.push({ type: "raid_overdue", count: projectsWithOverdueRaid.length });
    }
    if (projectsWithBreachedChanges.length) {
      blockerReasons.push({ type: "change", count: projectsWithBreachedChanges.length });
    }

    const blockedProjectIds = uniq([
      ...blockedProjectIdsByApproval,
      ...projectsWithOverdueTasks,
      ...projectsWithBlockedWbs,
      ...projectsWithHighRaid,
      ...projectsWithOverdueRaid,
      ...projectsWithBreachedChanges,
    ]).filter(Boolean);

    const breachedByType: Record<string, number> = {
      approvals: orgOverdueApprovals.length,
      tasks: orgBreachedTasks.length,
      wbs: orgBreachedWbs.length,
      wbs_blocked: orgBlockedWbs.length,
      changes: orgBreachedChanges.length,
      raid_high: orgHighRaid.length,
      raid_overdue: orgOverdueRaid.length,
    };

    const breachedTotal = Object.values(breachedByType).reduce((a, b) => a + b, 0);

    const projectScores = orgProjects.map((p) => {
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

      const cronScore = cronRagToScore(cronHealthMap.get(p.id) ?? "");
      if (cronScore !== null) score = Math.round(score * 0.4 + cronScore * 0.6);

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
        ? Math.round(
            projectScores.reduce((a, b) => a + b.score, 0) / projectScores.length
          )
        : 100;

    const portfolioRag = ragFromScore(portfolioScore);

    const healthLine = `Portfolio health is ${
      portfolioRag === "G" ? "GREEN" : portfolioRag === "A" ? "AMBER" : "RED"
    } (score ${portfolioScore}).`;

    const blockedLine = blockedProjectIds.length
      ? `${blockedProjectIds.length} project(s) are blocked across approvals/tasks/WBS/RAID/changes.`
      : `No active blockers detected across projects.`;

    const approvalLine = orgOverdueApprovals.length
      ? `${orgOverdueApprovals.length} approval step(s) are overdue (SLA ${approvalSlaDays}d).`
      : `No overdue approvals.`;

    const bottleneckLine = topBlockers.length
      ? `Top bottleneck(s): ${topBlockers
          .slice(0, 3)
          .map((b) => `${b.label} (${b.overdue_count || 0} overdue)`)
          .join(", ")}.`
      : `No approval bottlenecks identified.`;

    const aiSummary = [healthLine, blockedLine, approvalLine, bottleneckLine].join(" ");

    orgs.push({
      org_id: orgId,
      org_name: orgMetaMap.get(orgId)?.name,
      approvals: {
        total_pending_steps: totalPendingSteps,
        unique_pending_items: uniquePendingItems,
        overdue_steps: orgOverdueApprovals.length,
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
        projects: projectScores
          .sort((a, b) => a.score - b.score)
          .slice(0, 50),
      },
      samples: {
        sla_breakdown: Object.entries(breachedByType)
          .map(([key, count]) => ({ key, count }))
          .filter((x) => x.count > 0)
          .sort((a, b) => b.count - a.count)
          .slice(0, 8),
        worst_projects: projectScores
          .slice()
          .sort((a, b) => a.score - b.score)
          .slice(0, 8)
          .map((p) => ({
            project_id: p.project_id,
            project_title: p.project_title,
            score: p.score,
            rag: p.rag,
          })),
      },
      ai_summary: aiSummary,
    });
  }

  return orgs;
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
    if (ue || !u?.user) {
      return noStoreJson({ ok: false, error: "Unauthorized" }, 401);
    }

    const scope = parseScope(req);
    const { approvalSlaDays, changeSlaDays, idleDays } = parseConfig(req);

    const scoped = await loadScopedProjects({
      supabase,
      userId: safeStr(u.user.id),
      scope,
    });

    const orgs = await buildScopedBrain({
      supabase,
      projects: scoped.projects,
      approvalSlaDays,
      changeSlaDays,
      idleDays,
      preferredOrgId: scoped.organisationId,
    });

    const rollup = {
      org_count: orgs.length,
      portfolio_score_avg: orgs.length
        ? Math.round(
            orgs.reduce((a, b) => a + (b.health?.portfolio_score ?? 0), 0) / orgs.length
          )
        : 0,
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
      meta: {
        scope_type: "portfolio",
        organisationId: scoped.organisationId,
        scopeMeta: scoped.scopeMeta,
        scopeCounts: {
          scopedIdsRaw: scoped.scopedRaw.length,
          scopedIdsSelected: scoped.selectedIds.length,
        },
        active_filter_ok: scoped.activeMeta.ok,
        active_filter_error: scoped.activeMeta.error,
      },
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