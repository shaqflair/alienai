// src/lib/home/getHomeData.ts
import "server-only";

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

function safeNum(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function ragFromHealth(health: number): "G" | "A" | "R" {
  if (health >= 75) return "G";
  if (health >= 55) return "A";
  return "R";
}

function clamp01to100(x: any) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

type HomeOk = {
  ok: true;
  user: { id: string; email?: string | null };
  isExec: boolean;
  roles: string[];
  active_org_id: string | null;
  projects: { id: string; title: string; client_name?: string | null; project_code?: any }[];
  kpis: {
    portfolioHealth: number;
    openRisks: number;
    highRisks: number;
    forecastVariance: number;
    milestonesDue: number;
    openLessons: number;
  };
  approvals: { count: number; items: any[] };
  rag: { project_id: string; title: string; rag: "G" | "A" | "R"; health: number }[];
};

type HomeErr = { ok: false; error: string; meta?: any };

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

/**
 * ✅ Load active projects for org using projects_active view.
 * Falls back to projects table if the view is missing (dev safety).
 */
async function loadActiveProjectsForOrg(supabase: any, orgId: string) {
  // 1) Preferred: projects_active (filters out deleted/closed/cancelled/completed)
  try {
    const { data, error } = await supabase
      .from("projects_active")
      .select("id,title,client_name,project_code,created_at")
      .eq("organisation_id", orgId)
      .order("created_at", { ascending: false })
      .limit(12);

    if (!error && Array.isArray(data)) {
      return data.map((p: any) => ({
        id: String(p?.id || "").trim(),
        title: safeStr(p?.title).trim(),
        client_name: safeStr(p?.client_name).trim() || null,
        project_code: p?.project_code ?? null,
      }));
    }
  } catch {
    // ignore
  }

  // 2) Fallback: projects table (best-effort: at least exclude deleted)
  const { data: projects, error: projErr } = await supabase
    .from("projects")
    .select("id, title, client_name, project_code, created_at, deleted_at")
    .eq("organisation_id", orgId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(12);

  if (projErr) throw new Error(projErr.message || "Failed to load projects");
  const projList = Array.isArray(projects) ? projects : [];
  return projList.map((p: any) => ({
    id: String(p?.id || "").trim(),
    title: safeStr(p?.title).trim(),
    client_name: safeStr(p?.client_name).trim() || null,
    project_code: p?.project_code ?? null,
  }));
}

/**
 * Production-grade homepage loader:
 * - Validates active org cookie against org memberships
 * - Scopes projects + KPIs to active org
 * - Uses projects_active for dashboard-grade filtering
 */
export async function getHomeData(): Promise<HomeOk | HomeErr> {
  const supabase = await createClient();

  // --- Auth
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) return { ok: false, error: authErr.message || "Auth error" };
  const user = auth?.user;
  if (!user) return { ok: false, error: "Not authenticated" };

  // --- Read active org cookie (Next 16: cookies() is async)
  const cookieStore = await cookies();
  const cookieOrgId = safeStr(cookieStore.get("active_org_id")?.value).trim();

  // --- Org memberships (source of truth)
  const { data: orgMems, error: orgMemErr } = await supabase
    .from("organisation_members")
    .select("organisation_id, role, removed_at, created_at")
    .eq("user_id", user.id)
    .is("removed_at", null)
    .order("created_at", { ascending: true })
    .limit(100);

  if (orgMemErr) {
    return { ok: false, error: orgMemErr.message || "Failed to load organisation membership" };
  }

  const memberships = Array.isArray(orgMems) ? orgMems : [];
  const memberOrgIds = new Set(
    memberships.map((m: any) => safeStr(m?.organisation_id).trim()).filter(Boolean)
  );

  // If user has no org membership, return minimal safe payload
  if (memberOrgIds.size === 0) {
    return {
      ok: true,
      user: { id: user.id, email: user.email },
      isExec: false,
      roles: [],
      active_org_id: null,
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

  // --- Resolve active org (cookie must be valid membership)
  let activeOrgId: string | null = null;

  if (cookieOrgId && looksLikeUuid(cookieOrgId) && memberOrgIds.has(cookieOrgId)) {
    activeOrgId = cookieOrgId;
  } else {
    activeOrgId = safeStr(memberships[0]?.organisation_id).trim() || null;
  }

  // --- Roles (exec mode driven by org role)
  const orgRoles = memberships
    .filter((m: any) => safeStr(m?.organisation_id).trim() === activeOrgId)
    .map((m: any) => safeStr(m?.role).toLowerCase())
    .filter(Boolean);

  const roles = Array.from(new Set(orgRoles));
  const isExec = roleIsExec(roles);

  // --- Projects list (ACTIVE ONLY)
  let projList: { id: string; title: string; client_name?: string | null; project_code?: any }[] = [];
  try {
    projList = activeOrgId ? await loadActiveProjectsForOrg(supabase, activeOrgId) : [];
  } catch (e: any) {
    return { ok: false, error: e?.message || "Failed to load projects" };
  }

  const projectIds = projList.map((p: any) => p?.id).filter(Boolean);
  const projectIdsSafe = projectIds.length ? projectIds : [ZERO_UUID];

  // --- Open lessons (scoped to active projects)
  const { count: openLessonsCount } = await supabase
    .from("lessons_learned")
    .select("id", { count: "exact", head: true })
    .in("project_id", projectIdsSafe)
    .eq("status", "Open");

  // --- RAID risks (scoped)
  let openRisks = 0;
  let highRisks = 0;

  try {
    const { count } = await supabase
      .from("raid_items")
      .select("id", { count: "exact", head: true })
      .in("project_id", projectIdsSafe)
      .eq("type", "Risk")
      .in("status", ["Open", "In Progress"]);

    openRisks = safeNum(count);

    // severity might be numeric or text; this can throw, safe-fallback below
    const { count: hi } = await supabase
      .from("raid_items")
      .select("id", { count: "exact", head: true })
      .in("project_id", projectIdsSafe)
      .eq("type", "Risk")
      .in("status", ["Open", "In Progress"])
      .gte("severity", 70);

    highRisks = safeNum(hi);
  } catch {
    openRisks = 0;
    highRisks = 0;
  }

  // --- Approval inbox (pending tasks for user)
  // ✅ Enrich with project_code so HomePage can link using /projects/:project_code/...
  let approvalsCount = 0;
  let approvalItems: any[] = [];

  try {
    const { data: tasks } = await supabase
      .from("change_approvals")
      .select("id, change_id, project_id, approval_role, status, created_at")
      .eq("approver_user_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(10);

    const taskRows = Array.isArray(tasks) ? tasks : [];
    approvalsCount = taskRows.length;

    const changeIds = taskRows.map((t: any) => t?.change_id).filter(Boolean);
    const taskProjectIds = Array.from(
      new Set(taskRows.map((t: any) => String(t?.project_id || "").trim()).filter(Boolean))
    );

    // Load change details
    let changes: any[] = [];
    if (changeIds.length) {
      const { data: changeRows } = await supabase
        .from("change_requests")
        .select("id, title, status, created_at, project_id, priority, amount")
        .in("id", changeIds)
        .order("created_at", { ascending: false });

      changes = Array.isArray(changeRows) ? changeRows : [];
    }

    // Load project meta for link correctness (prefer projects_active but fallback ok)
    let projMeta: any[] = [];
    if (taskProjectIds.length) {
      // Try view first
      try {
        const { data: pm } = await supabase
          .from("projects_active")
          .select("id,title,project_code")
          .in("id", taskProjectIds)
          .limit(200);

        projMeta = Array.isArray(pm) ? pm : [];
      } catch {
        projMeta = [];
      }

      // Fallback if view missing or empty
      if (!projMeta.length) {
        const { data: pm2 } = await supabase
          .from("projects")
          .select("id,title,project_code,deleted_at")
          .in("id", taskProjectIds)
          .is("deleted_at", null)
          .limit(200);

        projMeta = Array.isArray(pm2) ? pm2 : [];
      }
    }

    const projById = new Map<string, any>();
    for (const p of projMeta) projById.set(String(p?.id || "").trim(), p);

    approvalItems = taskRows.slice(0, 6).map((t: any) => {
      const change = changes.find((c) => c.id === t.change_id) || null;
      const pid = String(t?.project_id || change?.project_id || "").trim();
      const pm = pid ? projById.get(pid) : null;

      return {
        ...t,
        change,
        project: pm
          ? {
              id: String(pm?.id || "").trim(),
              title: safeStr(pm?.title).trim() || null,
              project_code: pm?.project_code ?? null,
            }
          : null,
        // convenience fields (optional)
        project_code: pm?.project_code ?? null,
        project_title: safeStr(pm?.title).trim() || null,
      };
    });
  } catch {
    approvalsCount = 0;
    approvalItems = [];
  }

  // --- Portfolio Health / RAG roll-up (lightweight heuristic fallback)
  const rag = projList.slice(0, 8).map((p: any, i: number) => {
    const health = clamp01to100(
      Math.max(
        25,
        Math.min(
          95,
          85 -
            (highRisks ? 8 : 0) -
            (openRisks > 10 ? 10 : 0) -
            (safeNum(openLessonsCount) > 5 ? 6 : 0) -
            i
        )
      )
    );

    return {
      project_id: p.id,
      title: p.title || "Project",
      rag: ragFromHealth(health),
      health,
    };
  });

  const portfolioHealth = rag.length
    ? Math.round(rag.reduce((sum, r) => sum + safeNum(r.health), 0) / rag.length)
    : 0;

  // Keep placeholders as 0 (avoid ghost numbers; UI loads real KPIs from APIs)
  const forecastVariance = 0;
  const milestonesDue = 0;

  return {
    ok: true,
    user: { id: user.id, email: user.email },
    isExec,
    roles,
    active_org_id: activeOrgId,
    projects: projList,
    kpis: {
      portfolioHealth,
      openRisks,
      highRisks,
      forecastVariance,
      milestonesDue,
      openLessons: safeNum(openLessonsCount),
    },
    approvals: {
      count: approvalsCount,
      items: approvalItems,
    },
    rag,
  };
}
