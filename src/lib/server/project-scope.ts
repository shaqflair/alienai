// src/lib/server/project-scope.ts
import "server-only";

type ScopeResult = {
  projectIds: string[];
  meta: Record<string, any>;
};

function uniqStrings(xs: any[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs || []) {
    const s = String(x ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function looksMissingRelation(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("relation") || msg.includes("42p01");
}

export async function resolveActiveProjectScope(supabase: any, userId: string): Promise<ScopeResult> {
  // Org-first scope: all projects in user's active organisation
  try {
    const { data: prof, error: profErr } = await supabase
      .from("profiles")
      .select("id, active_organisation_id")
      .eq("id", userId)
      .maybeSingle();
    const orgId = String((prof as any)?.active_organisation_id || "").trim();
    if (!profErr && orgId) {
      const { data: rows, error } = await supabase
        .from("projects")
        .select("id")
        .eq("organisation_id", orgId)
        .limit(10000);
      if (!error) {
        const projectIds = uniqStrings((rows || []).map((r: any) => r?.id));
        return {
          projectIds,
          meta: {
            scope: "org",
            organisation_id: orgId,
            source: "profiles.active_organisation_id → projects.organisation_id",
            count: projectIds.length,
          },
        };
      }
      // If column/table mismatch etc., fall through to membership scope
    }
  } catch {
    // fall through
  }

  // Membership fallback (legacy)
  try {
    for (const table of ["project_memberships", "project_members", "project_membership"] as const) {
      const { data, error } = await supabase.from(table).select("project_id").eq("user_id", userId).limit(10000);
      if (error) {
        if (looksMissingRelation(error)) continue;
        break;
      }
      const projectIds = uniqStrings((data || []).map((r: any) => r?.project_id));
      return {
        projectIds,
        meta: { scope: "membership", source: table, count: projectIds.length },
      };
    }
  } catch {
    // ignore
  }

  return { projectIds: [], meta: { scope: "none", count: 0 } };
}

// ── Aliases & utilities used by portfolio routes ──────────────────────────────

/**
 * Org-scoped variant — identical to resolveActiveProjectScope (which already
 * does org-first resolution). Exported separately so portfolio routes can be
 * explicit about intent.
 */
export const resolveOrgActiveProjectScope = resolveActiveProjectScope;

/**
 * Filter a raw project-rows array down to non-deleted active IDs.
 * Accepts either objects with at least { id } or a plain string[].
 */
export function filterActiveProjectIds(
  rows: Array<{ id: string; deleted_at?: string | null; is_active?: boolean | null } | string>
): string[] {
  return uniqStrings(
    (rows || [])
      .filter((r) => {
        if (typeof r === "string") return true;
        if (r?.deleted_at) return false;
        if (r?.is_active === false) return false;
        return true;
      })
      .map((r) => (typeof r === "string" ? r : r?.id))
  );
}