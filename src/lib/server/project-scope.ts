import "server-only";

/* ---------------- small utils ---------------- */

function uniqStrings(xs: any[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs || []) {
    const s = String(x || "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function looksMissingRelation(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("relation") || msg.includes("42p01");
}

function looksMissingColumn(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

/**
 * Fetch project_ids from project_members for a user.
 * Best-effort:
 * - Prefer removed_at filter if column exists
 * - Fallback if removed_at doesn't exist
 */
export async function fetchMemberProjectIds(supabase: any, userId: string) {
  try {
    const { data, error } = await supabase
      .from("project_members")
      .select("project_id, removed_at")
      .eq("user_id", userId)
      .is("removed_at", null);

    if (error) {
      if (looksMissingColumn(error)) throw error;
      return { ok: false, error: error.message, projectIds: [] as string[] };
    }

    const ids = uniqStrings((data ?? []).map((r: any) => r?.project_id).filter(Boolean));
    return { ok: true, error: null as string | null, projectIds: ids };
  } catch {
    const { data, error } = await supabase.from("project_members").select("project_id").eq("user_id", userId);
    if (error) return { ok: false, error: error.message, projectIds: [] as string[] };

    const ids = uniqStrings((data ?? []).map((r: any) => r?.project_id).filter(Boolean));
    return { ok: true, error: null as string | null, projectIds: ids };
  }
}

/**
 * Filter project IDs down to ACTIVE projects.
 * Your schema:
 * - projects.status: 'active' | 'closed'
 * - projects.deleted_at: timestamp|null
 * - projects.closed_at: timestamp|null
 *
 * Best-effort:
 * - If projects query fails due to RLS, return original ids (don't blank UI)
 * - If columns missing, fall back to existence check
 */
export async function filterActiveProjectIds(supabase: any, projectIds: string[]) {
  const ids = uniqStrings(projectIds);
  if (!ids.length) return { ok: true, error: null as string | null, projectIds: [] as string[] };

  try {
    const { data, error } = await supabase
      .from("projects")
      .select("id, status, deleted_at, closed_at")
      .in("id", ids)
      .limit(10000);

    if (error) {
      if (looksMissingColumn(error) || looksMissingRelation(error)) throw error;
      return { ok: false, error: error.message, projectIds: ids };
    }

    const rows = Array.isArray(data) ? data : [];
    const out: string[] = [];

    for (const r of rows) {
      const id = String((r as any)?.id || "").trim();
      if (!id) continue;

      const status = String((r as any)?.status || "").trim().toLowerCase();
      const deletedAt = (r as any)?.deleted_at;
      const closedAt = (r as any)?.closed_at;

      // Treat these as out-of-scope
      if (deletedAt) continue;
      if (closedAt) continue;
      if (status && status !== "active") continue;

      out.push(id);
    }

    return { ok: true, error: null as string | null, projectIds: uniqStrings(out) };
  } catch {
    // Fallback: confirm the project still exists
    try {
      const { data, error } = await supabase.from("projects").select("id").in("id", ids).limit(10000);
      if (error) return { ok: false, error: error.message, projectIds: ids };

      const out = uniqStrings((data ?? []).map((r: any) => r?.id).filter(Boolean));
      return { ok: true, error: null as string | null, projectIds: out };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e || "projects filter failed"), projectIds: ids };
    }
  }
}

/**
 * One-call convenience: membership -> active project scope
 */
export async function resolveActiveProjectScope(supabase: any, userId: string) {
  const mem = await fetchMemberProjectIds(supabase, userId);
  if (!mem.ok) {
    return {
      ok: false,
      error: mem.error || "Failed to resolve project membership",
      projectIds: [] as string[],
      meta: { before: 0, after: 0, membershipOk: false, filterOk: false, filterError: mem.error || null },
    };
  }

  const filtered = await filterActiveProjectIds(supabase, mem.projectIds);
  return {
    ok: filtered.ok,
    error: filtered.error || null,
    projectIds: filtered.projectIds,
    meta: {
      before: mem.projectIds.length,
      after: filtered.projectIds.length,
      membershipOk: mem.ok,
      filterOk: filtered.ok,
      filterError: filtered.error || null,
    },
  };
}
