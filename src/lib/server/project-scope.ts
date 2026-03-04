// src/lib/server/project-scope.ts
// Scope resolution helpers for org-wide portfolio dashboards + safe fallbacks.
//
// Exports:
//  - resolveActiveProjectScope (member-safe)
//  - resolveOrgActiveProjectScope (org-wide project ids)
//  - filterActiveProjectIds (active/terminal exclusion; FAIL-OPEN)
//
// NOTE: Routes in this repo expect scoped.organisationId + scoped.projectIds + scoped.meta

import "server-only";

type SupabaseLike = any;

export type ActiveScope = {
  organisationId: string | null;
  projectIds: string[];
  mode: "org" | "member";
  meta?: any;
};

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function uniq(ids: any[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of ids || []) {
    const s = safeStr(v).trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

async function getUserId(supabase: SupabaseLike, userId?: string | null): Promise<string | null> {
  if (userId) return String(userId);
  const { data: auth } = await supabase.auth.getUser();
  return auth?.user?.id ? String(auth.user.id) : null;
}

async function getActiveOrgId(supabase: SupabaseLike, userId: string): Promise<string | null> {
  // 1) profiles.active_organisation_id (try both user_id and id for schema drift)
  {
    const { data, error } = await supabase
      .from("profiles")
      .select("active_organisation_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (!error) {
      const v = data?.active_organisation_id;
      if (v) return String(v);
    }
  }

  {
    const { data, error } = await supabase
      .from("profiles")
      .select("active_organisation_id")
      .eq("id", userId)
      .maybeSingle();

    if (!error) {
      const v = data?.active_organisation_id;
      if (v) return String(v);
    }
  }

    // 2) fallback: first org membership — only if profile had no active_organisation_id
  {
    const { data, error } = await supabase
      .from("organisation_members")
      .select("organisation_id")
      .eq("user_id", userId)
      .is("removed_at", null)
      .order("created_at", { ascending: false })
      .limit(1);

    if (!error && Array.isArray(data) && data[0]?.organisation_id) {
      return String(data[0].organisation_id);
    }
  }

  return null;
}

async function tryProjectsByOrg(supabase: SupabaseLike, orgId: string) {
  // Try common org FK column names in projects table
  const orgCols = ["organisation_id", "org_id", "organization_id"];
  for (const col of orgCols) {
    const { data, error } = await supabase.from("projects").select("id").eq(col, orgId).limit(20000);
    if (!error && Array.isArray(data)) return uniq(data.map((r: any) => r?.id));
  }
  return [];
}

async function tryProjectsByMembership(supabase: SupabaseLike, userId: string) {
  // project_memberships
  {
    const { data, error } = await supabase
      .from("project_memberships")
      .select("project_id")
      .eq("user_id", userId)
      .is("removed_at", null);

    if (!error && Array.isArray(data) && data.length) {
      return uniq(data.map((r: any) => r?.project_id));
    }
  }

  // project_members
  {
    const { data, error } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", userId)
      .is("removed_at", null);

    if (!error && Array.isArray(data) && data.length) {
      return uniq(data.map((r: any) => r?.project_id));
    }
  }

  return [];
}

/**
 * Member-scope:
 * - Prefer membership tables
 * - Fail-open fallback to org projects if orgId is known
 */
export async function resolveActiveProjectScope(
  supabase: SupabaseLike,
  userId?: string | null,
): Promise<ActiveScope> {
  const uid = await getUserId(supabase, userId);
  if (!uid) return { organisationId: null, projectIds: [], mode: "member", meta: { reason: "no_user" } };

  const organisationId = await getActiveOrgId(supabase, uid);

  const memberIds = await tryProjectsByMembership(supabase, uid);
  if (memberIds.length) {
    return {
      organisationId,
      projectIds: memberIds,
      mode: "member",
      meta: { source: "membership", memberCount: memberIds.length },
    };
  }

  // fallback to org projects (better than empty)
  if (organisationId) {
    const orgIds = await tryProjectsByOrg(supabase, organisationId);
    return {
      organisationId,
      projectIds: orgIds,
      mode: "member",
      meta: { source: "org_fallback_from_member", orgCount: orgIds.length },
    };
  }

  return { organisationId: null, projectIds: [], mode: "member", meta: { reason: "no_memberships_no_org" } };
}

/**
 * ORG-wide scope:
 * returns *all* projects in the userâ€™s active organisation.
 * Fail-open to member scope if orgId missing or schema doesnâ€™t match.
 */
export async function resolveOrgActiveProjectScope(
  supabase: SupabaseLike,
  userId?: string | null,
): Promise<ActiveScope> {
  const uid = await getUserId(supabase, userId);
  if (!uid) return { organisationId: null, projectIds: [], mode: "org", meta: { reason: "no_user" } };

  const organisationId = await getActiveOrgId(supabase, uid);
  if (!organisationId) {
    // fallback to membership
    const fallback = await resolveActiveProjectScope(supabase, uid);
    return { ...fallback, meta: { ...(fallback.meta || {}), orgScope: "missing_org" } };
  }

  const orgProjectIds = await tryProjectsByOrg(supabase, organisationId);

  // if schema differs or none found, fallback to membership
  if (!orgProjectIds.length) {
    const fallback = await resolveActiveProjectScope(supabase, uid);
    return {
      ...fallback,
      organisationId,
      meta: { ...(fallback.meta || {}), orgScope: "no_projects_found_or_schema_mismatch" },
    };
  }

  return {
    organisationId,
    projectIds: orgProjectIds,
    mode: "org",
    meta: { source: "org_projects", orgCount: orgProjectIds.length },
  };
}

/**
 * Active-only filter (terminal state exclusion).
 * FAIL-OPEN: if filter can't be applied due to schema drift, return input ids unchanged.
 */
export async function filterActiveProjectIds(supabase: SupabaseLike, projectIds: string[]): Promise<{ projectIds: string[]; error?: any }> {
  const ids = uniq(projectIds);
  if (!ids.length) return { projectIds: [] };

  // Try wide select; fallback to minimal if columns missing.
  const wide =
    "id, deleted_at, removed_at, archived_at, closed_at, completed_at, ended_at, end_date, is_archived, is_live, status, lifecycle_status, delivery_status";
  const minimal = "id";

  let rows: any[] = [];
  try {
    const { data, error } = await supabase.from("projects").select(wide).in("id", ids).limit(20000);
    if (!error && Array.isArray(data)) rows = data;
    else {
      const msg = safeStr(error?.message).toLowerCase();
      if (msg.includes("column") || msg.includes("does not exist")) {
        const { data: d2, error: e2 } = await supabase.from("projects").select(minimal).in("id", ids).limit(20000);
        if (e2 || !Array.isArray(d2)) return { projectIds: ids, error: e2 || error };
        return { projectIds: uniq(d2.map((r: any) => r?.id)) };
      }
      return { projectIds: ids, error };
    }
  } catch (e: any) {
    return { projectIds: ids, error: e };
  }

  const norm = (v: any) => safeStr(v).trim().toLowerCase();
  const isDone = (s: any) => ["done", "closed", "completed", "complete", "cancelled", "canceled", "inactive"].includes(norm(s));

  const active = rows.filter((p: any) => {
    if (!p) return false;

    const deletedAt = p.deleted_at ?? p.removed_at ?? null;
    const archivedAt = p.archived_at ?? null;
    const closedAt = p.closed_at ?? null;
    const completedAt = p.completed_at ?? p.end_date ?? p.ended_at ?? null;

    if (deletedAt || archivedAt || closedAt || completedAt) return false;
    if (p.is_archived === true || norm(p.is_archived) === "true") return false;

    if (p.is_live === false || norm(p.is_live) === "false") return false;

    const statusLike = p.status ?? p.lifecycle_status ?? p.delivery_status ?? null;
    if (statusLike != null && isDone(statusLike)) return false;

    return true;
  });

  const out = uniq(active.map((r: any) => r?.id));
  return { projectIds: out.length ? out : ids };
}

