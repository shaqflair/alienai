// src/lib/server/project-scope.ts
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
    if (!s || seen.has(s)) continue;
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
  {
    const { data, error } = await supabase
      .from("profiles")
      .select("active_organisation_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!error && data?.active_organisation_id) return String(data.active_organisation_id);
  }
  {
    const { data, error } = await supabase
      .from("profiles")
      .select("active_organisation_id")
      .eq("id", userId)
      .maybeSingle();
    if (!error && data?.active_organisation_id) return String(data.active_organisation_id);
  }
  {
    const { data, error } = await supabase
      .from("organisation_members")
      .select("organisation_id")
      .eq("user_id", userId)
      .is("removed_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    if (!error && Array.isArray(data) && data[0]?.organisation_id) return String(data[0].organisation_id);
  }
  return null;
}

async function tryProjectsByOrg(supabase: SupabaseLike, orgId: string) {
  const orgCols = ["organisation_id", "org_id", "organization_id"];
  const notes: string[] = [];
  for (const col of orgCols) {
    const { data, error } = await supabase.from("projects").select("id").eq(col, orgId).limit(20000);
    if (!error && Array.isArray(data)) return { ids: uniq(data.map((r: any) => r?.id)), meta: { sourceColumn: col, notes } };
    if (error) notes.push(`${col}: ${error.message}`);
  }
  return { ids: [], meta: { sourceColumn: null, notes } };
}

async function tryProjectsByMembership(supabase: SupabaseLike, userId: string) {
  {
    const { data, error } = await supabase.from("project_memberships").select("project_id").eq("user_id", userId).is("removed_at", null);
    if (!error && Array.isArray(data) && data.length) return uniq(data.map((r: any) => r?.project_id));
  }
  {
    const { data, error } = await supabase.from("project_members").select("project_id").eq("user_id", userId).is("removed_at", null);
    if (!error && Array.isArray(data) && data.length) return uniq(data.map((r: any) => r?.project_id));
  }
  return [];
}

export async function resolveActiveProjectScope(supabase: SupabaseLike, userId?: string | null): Promise<ActiveScope> {
  const uid = await getUserId(supabase, userId);
  if (!uid) return { organisationId: null, projectIds: [], mode: "member", meta: { reason: "no_user", scopedIdsRaw: [] } };
  const organisationId = await getActiveOrgId(supabase, uid);
  const memberIds = await tryProjectsByMembership(supabase, uid);
  if (memberIds.length) return { organisationId, projectIds: memberIds, mode: "member", meta: { source: "membership", memberCount: memberIds.length, scopedIdsRaw: memberIds } };
  if (organisationId) {
    const org = await tryProjectsByOrg(supabase, organisationId);
    return { organisationId, projectIds: org.ids, mode: "member", meta: { source: "org_fallback_from_member", orgCount: org.ids.length, scopedIdsRaw: org.ids, orgColumn: org.meta.sourceColumn, orgNotes: org.meta.notes } };
  }
  return { organisationId: null, projectIds: [], mode: "member", meta: { reason: "no_memberships_no_org", scopedIdsRaw: [] } };
}

export async function resolveOrgActiveProjectScope(supabase: SupabaseLike, userId?: string | null): Promise<ActiveScope> {
  const uid = await getUserId(supabase, userId);
  if (!uid) return { organisationId: null, projectIds: [], mode: "org", meta: { reason: "no_user", scopedIdsRaw: [] } };
  const organisationId = await getActiveOrgId(supabase, uid);
  if (!organisationId) return { organisationId: null, projectIds: [], mode: "org", meta: { reason: "missing_org", scopedIdsRaw: [] } };
  const org = await tryProjectsByOrg(supabase, organisationId);
  return { organisationId, projectIds: org.ids, mode: "org", meta: { source: "org_projects", orgCount: org.ids.length, scopedIdsRaw: org.ids, orgColumn: org.meta.sourceColumn, orgNotes: org.meta.notes, orgScope: "strict_org" } };
}

/**
 * Active-only filter (terminal state exclusion).
 * Excludes: deleted, archived, closed, completed, ended, pipeline projects.
 * FAIL-OPEN if schema drift prevents filtering.
 */
export async function filterActiveProjectIds(
  supabase: SupabaseLike,
  projectIds: string[],
): Promise<string[]> {
  const ids = uniq(projectIds);
  if (!ids.length) return [];

  // Include resource_status to exclude pipeline projects
  const wide =
    "id, deleted_at, removed_at, archived_at, closed_at, completed_at, ended_at, is_archived, is_live, status, lifecycle_status, delivery_status, resource_status";
  const minimal = "id";

  let rows: any[] = [];
  try {
    const { data, error } = await supabase.from("projects").select(wide).in("id", ids).limit(20000);
    if (!error && Array.isArray(data)) {
      rows = data;
    } else {
      const msg = safeStr(error?.message).toLowerCase();
      if (msg.includes("column") || msg.includes("does not exist")) {
        const { data: d2, error: e2 } = await supabase.from("projects").select(minimal).in("id", ids).limit(20000);
        if (e2 || !Array.isArray(d2)) return ids;
        return uniq(d2.map((r: any) => r?.id));
      }
      return ids;
    }
  } catch {
    return ids;
  }

  const norm = (v: any) => safeStr(v).trim().toLowerCase();

  const isTerminalStatus = (s: any) => {
    const x = norm(s);
    return (
      x === "closed" || x === "done" || x === "completed" || x === "complete" ||
      x === "cancelled" || x === "canceled" || x === "inactive" || x === "archived" ||
      x === "pipeline"
    );
  };

  const active = rows.filter((p: any) => {
    if (!p) return false;

    // Exclude pipeline projects from health scoring
    if (norm(p.resource_status) === "pipeline") return false;

    const deletedAt = p.deleted_at ?? p.removed_at ?? null;
    const archivedAt = p.archived_at ?? null;
    const closedAt = p.closed_at ?? null;
    const completedAt = p.completed_at ?? null;
    const endedAt = p.ended_at ?? null;

    if (deletedAt || archivedAt || closedAt || completedAt || endedAt) return false;
    if (p.is_archived === true || norm(p.is_archived) === "true") return false;
    if (p.is_live === false || norm(p.is_live) === "false") return false;

    const statusLike = p.status ?? p.lifecycle_status ?? p.delivery_status ?? null;
    if (statusLike != null && isTerminalStatus(statusLike)) return false;

    return true;
  });

  const out = uniq(active.map((r: any) => r?.id));
  // Do NOT fail-open back to all ids — that would re-include pipeline/excluded projects
  return out;
}