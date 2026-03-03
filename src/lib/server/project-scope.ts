// src/lib/server/project-scope.ts
// Scope resolution helpers for org-wide portfolio dashboards + safe fallbacks.
//
// Exports:
//  - resolveActiveProjectScope (existing contract, keep)
//  - resolveOrgActiveProjectScope (org-wide project ids)
//  - filterActiveProjectIds (optional filtering helper; safe no-op degradation)

import "server-only";

type SupabaseLike = any;

type ActiveScope = {
  orgId: string | null;
  projectIds: string[];
  mode: "org" | "member";
};

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

async function tryProjectsByOrg(supabase: SupabaseLike, orgId: string) {
  // Try common org FK column names
  const orgCols = ["organisation_id", "org_id", "organization_id"];
  for (const col of orgCols) {
    const { data, error } = await supabase.from("projects").select("id").eq(col, orgId);
    if (!error && Array.isArray(data)) return data.map((r: any) => r.id).filter(Boolean);
  }
  return [];
}

async function getActiveOrgId(supabase: SupabaseLike): Promise<string | null> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) return null;

  // profiles.active_organisation_id is your standard
  const { data, error } = await supabase
    .from("profiles")
    .select("active_organisation_id")
    .eq("id", userId)
    .maybeSingle();

  if (error) return null;
  const v = data?.active_organisation_id;
  return v ? String(v) : null;
}

/**
 * Existing helper (keep name/signature expectation).
 * Member-scope: returns projects the user can see (via membership tables or their active project).
 * This implementation is conservative + tolerant; if you already had a better one, keep yours
 * and only add the missing exports below.
 */
export async function resolveActiveProjectScope(supabase: SupabaseLike): Promise<ActiveScope> {
  const orgId = await getActiveOrgId(supabase);

  // Best effort: project_memberships / project_members (common names)
  // If these tables don’t exist, we degrade to org projects if orgId is known.
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;

  if (userId) {
    // Try project_memberships
    {
      const { data, error } = await supabase
        .from("project_memberships")
        .select("project_id")
        .eq("user_id", userId);
      if (!error && Array.isArray(data) && data.length) {
        return {
          orgId,
          projectIds: data.map((r: any) => r.project_id).filter(Boolean),
          mode: "member",
        };
      }
    }
    // Try project_members
    {
      const { data, error } = await supabase.from("project_members").select("project_id").eq("user_id", userId);
      if (!error && Array.isArray(data) && data.length) {
        return {
          orgId,
          projectIds: data.map((r: any) => r.project_id).filter(Boolean),
          mode: "member",
        };
      }
    }
  }

  // Fallback: if we know org, return org projects (better than empty).
  if (orgId) {
    const ids = await tryProjectsByOrg(supabase, orgId);
    return { orgId, projectIds: ids, mode: "member" };
  }

  return { orgId: null, projectIds: [], mode: "member" };
}

/**
 * ORG-wide scope: returns *all* projects in the user’s active organisation.
 * This is what your portfolio dashboard endpoints should use.
 */
export async function resolveOrgActiveProjectScope(supabase: SupabaseLike): Promise<ActiveScope> {
  const orgId = await getActiveOrgId(supabase);
  if (!orgId) {
    // If user has no active org, fallback to member scope.
    return resolveActiveProjectScope(supabase);
  }

  const projectIds = await tryProjectsByOrg(supabase, orgId);

  // If org has no projects or schema differs, fallback to member scope.
  if (!projectIds.length) {
    return resolveActiveProjectScope(supabase);
  }

  return { orgId, projectIds, mode: "org" };
}

/**
 * Optional helper used by some routes.
 * If filters are provided, we *try* to apply them server-side; otherwise return ids unchanged.
 * Degrades gracefully to “no-op” if schema doesn’t support requested filters.
 */
export async function filterActiveProjectIds(
  supabase: SupabaseLike,
  projectIds: string[],
  filters?: Record<string, any> | null,
): Promise<string[]> {
  const ids = Array.isArray(projectIds) ? projectIds.filter(Boolean) : [];
  if (!ids.length) return [];
  const f = filters ?? {};
  if (!f || Object.keys(f).length === 0) return ids;

  try {
    // Very conservative: only apply a couple of common filters if present.
    let q = supabase.from("projects").select("id").in("id", ids);

    if (Array.isArray(f.status) && f.status.length) q = q.in("status", f.status);
    if (Array.isArray(f.rag) && f.rag.length) q = q.in("rag", f.rag);

    const { data, error } = await q;
    if (error || !Array.isArray(data)) return ids;

    const out = data.map((r: any) => r.id).filter(Boolean);
    return out.length ? out : ids;
  } catch {
    return ids;
  }
}