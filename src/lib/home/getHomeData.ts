// src/lib/home/getHomeData.ts
import "server-only";

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

type RagLetter = "G" | "A" | "R";

type ProjectRow = {
  id: string;
  title: string;
  client_name?: string | null;
  project_code?: any;
  department?: string | null;
  
};

type HomeOk = {
  ok: true;
  user: { id: string; email?: string | null };
  isExec: boolean;
  roles: string[];
  active_org_id: string | null;
  projects: ProjectRow[];
  kpis: {
    portfolioHealth: number;
    openRisks: number;
    highRisks: number;
    forecastVariance: number;
    milestonesDue: number;
    openLessons: number;
  };
  approvals: { count: number; items: any[] };
  rag: { project_id: string; title: string; rag: RagLetter; health: number }[];
};

type HomeErr = { ok: false; error: string; meta?: any };

function safeNum(x: unknown) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim(),
  );
}

function ragFromHealth(health: number): RagLetter {
  if (health >= 75) return "G";
  if (health >= 55) return "A";
  return "R";
}

function clamp01to100(x: unknown) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function roleIsExec(roles: string[]) {
  const set = new Set(roles.map((r) => String(r || "").toLowerCase()));
  return (
    set.has("owner") ||
    set.has("admin") ||
    set.has("portfolio") ||
    set.has("pmo") ||
    set.has("exec")
  );
}

function emptyHome(user: { id: string; email?: string | null }, activeOrgId: string | null): HomeOk {
  return {
    ok: true,
    user,
    isExec: false,
    roles: [],
    active_org_id: activeOrgId,
    projects: [],
    kpis: {
      portfolioHealth: 0,
      openRisks: 0,
      highRisks: 0,
      forecastVariance: 0,
      milestonesDue: 0,
      openLessons: 0,
    },
    approvals: { count: 0, items: [] },
    rag: [],
  };
}

function mapProjectRow(p: any): ProjectRow {
  return {
    id: safeStr(p?.id).trim(),
    title: safeStr(p?.title).trim(),
    client_name: safeStr(p?.client_name).trim() || null,
    project_code: p?.project_code ?? null,
    department: safeStr(p?.department).trim() || null,
  };
}

async function loadActiveProjectsForOrg(supabase: any, orgId: string): Promise<ProjectRow[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("id,title,client_name,project_code,department,created_at,deleted_at,status")
    .eq("organisation_id", orgId)
    .is("deleted_at", null)
    .neq("status", "closed")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw new Error(error.message || "Failed to load projects");

  return (Array.isArray(data) ? data : []).map(mapProjectRow).filter((p) => p.id);
}

async function loadMemberships(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("organisation_members")
    .select("organisation_id, role, removed_at, created_at")
    .eq("user_id", userId)
    .is("removed_at", null)
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) throw new Error(error.message || "Failed to load organisation membership");

  return Array.isArray(data) ? data : [];
}

function resolveActiveOrgId(memberships: any[], cookieOrgId: string): string | null {
  const memberOrgIds = new Set(
    memberships.map((m: any) => safeStr(m?.organisation_id).trim()).filter(Boolean),
  );

  if (cookieOrgId && looksLikeUuid(cookieOrgId) && memberOrgIds.has(cookieOrgId)) {
    return cookieOrgId;
  }

  return safeStr(memberships[0]?.organisation_id).trim() || null;
}

function resolveOrgRoles(memberships: any[], activeOrgId: string | null): string[] {
  if (!activeOrgId) return [];

  return Array.from(
    new Set(
      memberships
        .filter((m: any) => safeStr(m?.organisation_id).trim() === activeOrgId)
        .map((m: any) => safeStr(m?.role).toLowerCase().trim())
        .filter(Boolean),
    ),
  );
}

async function loadOpenLessonsCount(supabase: any, projectIds: string[]) {
  const { count } = await supabase
    .from("lessons_learned")
    .select("id", { count: "exact", head: true })
    .in("project_id", projectIds)
    .eq("status", "Open");

  return safeNum(count);
}

async function loadRaidCounts(supabase: any, projectIds: string[]) {
  let openRisks = 0;
  let highRisks = 0;

  try {
    const { count: openCount } = await supabase
      .from("raid_items")
      .select("id", { count: "exact", head: true })
      .in("project_id", projectIds)
      .eq("type", "Risk")
      .in("status", ["Open", "In Progress"]);

    openRisks = safeNum(openCount);

    const { count: highCount } = await supabase
      .from("raid_items")
      .select("id", { count: "exact", head: true })
      .in("project_id", projectIds)
      .eq("type", "Risk")
      .in("status", ["Open", "In Progress"])
      .gte("severity", 70);

    highRisks = safeNum(highCount);
  } catch {
    openRisks = 0;
    highRisks = 0;
  }

  return { openRisks, highRisks };
}

async function loadApprovalInbox(supabase: any, userId: string) {
  let approvalsCount = 0;
  let approvalItems: any[] = [];

  try {
    const { data: tasks } = await supabase
      .from("change_approvals")
      .select("id, change_id, project_id, approval_role, status, created_at")
      .eq("approver_user_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(10);

    const taskRows = Array.isArray(tasks) ? tasks : [];
    approvalsCount = taskRows.length;

    const changeIds = taskRows.map((t: any) => t?.change_id).filter(Boolean);
    const taskProjectIds = Array.from(
      new Set(taskRows.map((t: any) => safeStr(t?.project_id).trim()).filter(Boolean)),
    );

    let changes: any[] = [];
    if (changeIds.length) {
      const { data: changeRows } = await supabase
        .from("change_requests")
        .select("id, title, status, created_at, project_id, priority, amount")
        .in("id", changeIds)
        .order("created_at", { ascending: false });

      changes = Array.isArray(changeRows) ? changeRows : [];
    }

    let projectMeta: any[] = [];
    if (taskProjectIds.length) {
      const { data: pm } = await supabase
        .from("projects")
        .select("id,title,project_code,deleted_at")
        .in("id", taskProjectIds)
        .is("deleted_at", null)
        .limit(200);

      projectMeta = Array.isArray(pm) ? pm : [];
    }

    const projectById = new Map<string, any>();
    for (const p of projectMeta) {
      projectById.set(safeStr(p?.id).trim(), p);
    }

    approvalItems = taskRows.slice(0, 6).map((t: any) => {
      const change = changes.find((c) => c.id === t.change_id) || null;
      const pid = safeStr(t?.project_id || change?.project_id).trim();
      const project = pid ? projectById.get(pid) : null;

      return {
        ...t,
        change,
        project: project
          ? {
              id: safeStr(project?.id).trim(),
              title: safeStr(project?.title).trim() || null,
              project_code: project?.project_code ?? null,
            }
          : null,
        project_code: project?.project_code ?? null,
        project_title: safeStr(project?.title).trim() || null,
      };
    });
  } catch {
    approvalsCount = 0;
    approvalItems = [];
  }

  return { count: approvalsCount, items: approvalItems };
}

function buildRag(
  projects: ProjectRow[],
  openRisks: number,
  highRisks: number,
  openLessons: number,
) {
  return projects.slice(0, 8).map((p, i) => {
    const health = clamp01to100(
      Math.max(
        25,
        Math.min(
          95,
          85 -
            (highRisks ? 8 : 0) -
            (openRisks > 10 ? 10 : 0) -
            (openLessons > 5 ? 6 : 0) -
            i,
        ),
      ),
    );

    return {
      project_id: p.id,
      title: p.title || "Project",
      rag: ragFromHealth(health),
      health,
    };
  });
}

export async function getHomeData(): Promise<HomeOk | HomeErr> {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();

  if (authErr) return { ok: false, error: authErr.message || "Auth error" };

  const user = auth?.user;
  if (!user) return { ok: false, error: "Not authenticated" };

  const cookieStore = await cookies();
  const cookieOrgId = safeStr(cookieStore.get("active_org_id")?.value).trim();

  let memberships: any[] = [];
  try {
    memberships = await loadMemberships(supabase, user.id);
  } catch (e: any) {
    return { ok: false, error: e?.message || "Failed to load organisation membership" };
  }

  if (memberships.length === 0) {
    return emptyHome({ id: user.id, email: user.email }, null);
  }

  const activeOrgId = resolveActiveOrgId(memberships, cookieOrgId);
  const roles = resolveOrgRoles(memberships, activeOrgId);
  const isExec = roleIsExec(roles);

  let projects: ProjectRow[] = [];
  try {
    projects = activeOrgId ? await loadActiveProjectsForOrg(supabase, activeOrgId) : [];
  } catch {
    projects = [];
  }

  const projectIds = projects.map((p) => p.id).filter(Boolean);
  if (projectIds.length === 0) return emptyHome({ id: user.id, email: user.email }, activeOrgId);

  const [openLessons, raidCounts, approvals] = await Promise.all([
    loadOpenLessonsCount(supabase, projectIds),
    loadRaidCounts(supabase, projectIds),
    loadApprovalInbox(supabase, user.id),
  ]);

  const rag = buildRag(projects, raidCounts.openRisks, raidCounts.highRisks, openLessons);

  const portfolioHealth = rag.length
    ? Math.round(rag.reduce((sum, r) => sum + safeNum(r.health), 0) / rag.length)
    : 0;

  return {
    ok: true,
    user: { id: user.id, email: user.email },
    isExec,
    roles,
    active_org_id: activeOrgId,
    projects,
    kpis: {
      portfolioHealth,
      openRisks: raidCounts.openRisks,
      highRisks: raidCounts.highRisks,
      forecastVariance: 0,
      milestonesDue: 0,
      openLessons,
    },
    approvals,
    rag,
  };
}