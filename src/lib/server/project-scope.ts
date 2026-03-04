// src/lib/server/project-scope.ts
// Scope resolution helpers for org-wide portfolio dashboards + safe fallbacks.
//
// Exports:
//  - resolveActiveProjectScope (member-safe)
//  - resolveOrgActiveProjectScope (org-wide project ids)
//  - filterActiveProjectIds (ACTIVE/INACTIVE filter; FAIL-OPEN)
//
// IMPORTANT:
// - Many routes currently call resolveOrgActiveProjectScope(supabase, userId) and expect `organisationId`.
// - Some routes expect filterActiveProjectIds() to return an object { ok, projectIds, error, meta }.
// This file implements those contracts and fixes recursion bugs.

import "server-only";

type SupabaseLike = any;

export type ActiveScope = {
  ok: boolean;
  orgId: string | null;
  organisationId: string | null; // alias for compatibility
  projectIds: string[];
  mode: "org" | "member";
  error?: string | null;
  meta?: any;
};

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

async function getUserId(supabase: SupabaseLike, userId?: string | null): Promise<string | null> {
  if (userId) return safeStr(userId).trim() || null;
  const { data: auth } = await supabase.auth.getUser();
  return auth?.user?.id ? String(auth.user.id) : null;
}

async function getActiveOrgId(supabase: SupabaseLike, userId?: string | null): Promise<string | null> {
  const uid = await getUserId(supabase, userId);
  if (!uid) return null;

  // Your standard: profiles.active_organisation_id, keyed by profiles.id
  // Some schemas use profiles.user_id. We'll try both.
  const tries = [
    { col: "id", val: uid },
    { col: "user_id", val: uid },
  ];

  for (const t of tries) {
    const { data, error } = await supabase
      .from("profiles")
      .select("active_organisation_id")
      .eq(t.col, t.val)
      .maybeSingle();

    if (!error) {
      const v = data?.active_organisation_id;
      const out = v ? String(v) : null;
      if (out) return out;
    }
  }

  return null;
}

async function tryProjectsByOrg(supabase: SupabaseLike, orgId: string): Promise<string[]> {
  // Try common org FK column names
  const orgCols = ["organisation_id", "org_id", "organization_id"];
  for (const col of orgCols) {
    const { data, error } = await supabase.from("projects").select("id").eq(col, orgId).limit(50000);
    if (!error && Array.isArray(data)) return data.map((r: any) => r.id).filter(Boolean);
  }
  return [];
}

/**
 * Member-scope:
 * - Prefer membership tables
 * - Fail-open fallback to org projects if orgId is known
 */
export async function resolveActiveProjectScope(supabase: SupabaseLike, userId?: string | null): Promise<ActiveScope> {
  const uid = await getUserId(supabase, userId);
  const orgId = await getActiveOrgId(supabase, uid);

  const meta: any = { membership: null, fallback: null };

  if (uid) {
    // Try project_memberships (user_id)
    {
      const { data, error } = await supabase.from("project_memberships").select("project_id").eq("user_id", uid).limit(50000);
      if (!error && Array.isArray(data) && data.length) {
        return {
          ok: true,
          orgId,
          organisationId: orgId,
          projectIds: data.map((r: any) => r.project_id).filter(Boolean),
          mode: "member",
          meta: { ...meta, membership: "project_memberships.user_id" },
        };
      }
    }

    // Try project_members (user_id)
    {
      const { data, error } = await supabase.from("project_members").select("project_id").eq("user_id", uid).limit(50000);
      if (!error && Array.isArray(data) && data.length) {
        return {
          ok: true,
          orgId,
          organisationId: orgId,
          projectIds: data.map((r: any) => r.project_id).filter(Boolean),
          mode: "member",
          meta: { ...meta, membership: "project_members.user_id" },
        };
      }
    }

    // Some schemas use member_id/person_id etc — we won't guess further; fail-open to org.
  }

  // Fallback: if we know org, return org projects (better than empty).
  if (orgId) {
    const ids = await tryProjectsByOrg(supabase, orgId);
    return {
      ok: true,
      orgId,
      organisationId: orgId,
      projectIds: ids,
      mode: "member",
      meta: { ...meta, fallback: "org_projects" },
    };
  }

  return {
    ok: false,
    orgId: null,
    organisationId: null,
    projectIds: [],
    mode: "member",
    error: "No user/org context",
    meta,
  };
}

/**
 * ORG-wide scope:
 * returns *all* projects in the user’s active organisation.
 * Fail-open to member scope if orgId missing or schema doesn’t match.
 */
export async function resolveOrgActiveProjectScope(supabase: SupabaseLike, userId?: string | null): Promise<ActiveScope> {
  const uid = await getUserId(supabase, userId);
  const orgId = await getActiveOrgId(supabase, uid);

  const meta: any = { uid: uid || null, orgId: orgId || null, orgColsTried: ["organisation_id", "org_id", "organization_id"] };

  if (!orgId) {
    const member = await resolveActiveProjectScope(supabase, uid);
    return {
      ...member,
      meta: { ...meta, fallback: "member_scope_no_active_org", memberMeta: member.meta ?? null },
    };
  }

  const projectIds = await tryProjectsByOrg(supabase, orgId);

  // If org has no projects or schema differs, fallback to member scope (NOT recursion!)
  if (!projectIds.length) {
    const member = await resolveActiveProjectScope(supabase, uid);
    return {
      ...member,
      orgId,
      organisationId: orgId,
      meta: { ...meta, fallback: "member_scope_no_projects_by_org", memberMeta: member.meta ?? null },
    };
  }

  return {
    ok: true,
    orgId,
    organisationId: orgId,
    projectIds,
    mode: "org",
    meta: { ...meta, scope: "org" },
  };
}

/* =============================================================================
   ACTIVE project filter (used by portfolio endpoints)
   - Excludes deleted/archived/cancelled/closed where detectable
   - FAIL-OPEN: if we can't read columns, return input ids unchanged.
============================================================================= */

function looksMissingRelation(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("relation") || msg.includes("42p01");
}
function looksMissingColumn(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

function isTerminalStatus(s: string) {
  const v = (s || "").toLowerCase();
  if (!v) return false;
  return (
    v.includes("closed") ||
    v.includes("cancel") || // cancel/cancelled/canceled
    v.includes("archiv") || // archive/archived
    v.includes("complete") ||
    v.includes("done") ||
    v.includes("deleted")
  );
}

export async function filterActiveProjectIds(
  supabase: SupabaseLike,
  projectIds: string[],
): Promise<{ ok: boolean; projectIds: string[]; error?: string | null; meta?: any }> {
  const ids = Array.isArray(projectIds) ? projectIds.filter(Boolean) : [];
  if (!ids.length) return { ok: true, projectIds: [], meta: { before: 0, after: 0 } };

  // Try progressively smaller selects to tolerate missing columns
  const selectSets = [
    "id,status,state,lifecycle,deleted_at,archived_at,is_archived,is_deleted,is_active",
    "id,status,state,lifecycle,deleted_at,archived_at,is_archived,is_active",
    "id,status,state,lifecycle,deleted_at,archived_at",
    "id,status,state,deleted_at",
    "id,status,deleted_at",
    "id,deleted_at",
    "id",
  ];

  let rows: any[] = [];
  let usedSelect: string | null = null;
  let lastErr: any = null;

  for (const sel of selectSets) {
    const { data, error } = await supabase.from("projects").select(sel).in("id", ids).limit(50000);
    if (!error && Array.isArray(data)) {
      rows = data;
      usedSelect = sel;
      lastErr = null;
      break;
    }
    lastErr = error;
    // If relation missing, fail-open immediately
    if (looksMissingRelation(error)) break;
    // If missing column, keep trying smaller sets
    if (looksMissingColumn(error)) continue;
    // Any other error: fail-open
    break;
  }

  if (!rows.length) {
    return {
      ok: false,
      projectIds: ids, // FAIL-OPEN
      error: safeStr(lastErr?.message || "Could not evaluate active projects (fail-open)."),
      meta: { before: ids.length, after: ids.length, usedSelect, failOpen: true },
    };
  }

  const active = rows
    .filter((p: any) => {
      const deletedAt = p?.deleted_at ?? null;
      if (deletedAt) return false;

      const archivedAt = p?.archived_at ?? null;
      if (archivedAt) return false;

      const isArchived = p?.is_archived;
      if (isArchived === true) return false;

      const isDeleted = p?.is_deleted;
      if (isDeleted === true) return false;

      const isActive = p?.is_active;
      if (isActive === false) return false;

      const status = safeStr(p?.status);
      const state = safeStr(p?.state);
      const lifecycle = safeStr(p?.lifecycle);

      if (isTerminalStatus(status) || isTerminalStatus(state) || isTerminalStatus(lifecycle)) return false;

      return true;
    })
    .map((p: any) => String(p?.id || "").trim())
    .filter(Boolean);

  return {
    ok: true,
    projectIds: active,
    meta: { before: ids.length, after: active.length, usedSelect, failOpen: false },
  };
}