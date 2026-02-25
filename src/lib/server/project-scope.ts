// src/lib/server/project-scope.ts — REBUILT v2
// Fixes:
//   ✅ FIX-PS1: filterActiveProjectIds — status EXCLUSION LIST instead of allowlist
//              was: if (status && status !== "active") continue;
//              → killed 'planning', 'in_progress', 'on_hold' — all valid active states
//              now: only exclude known terminal states (closed, archived, cancelled, deleted, etc.)
//              This was the ROOT CAUSE of empty dashboards for multi-status orgs.
//              Every route that calls resolveActiveProjectScope() gets this fix for free.

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

// ✅ FIX-PS1: Exclusion list of terminal/inactive states.
// Anything NOT in this set is treated as active (open for project work).
// This preserves: planning, in_progress, on_hold, paused, draft, active, "" (no status set)
const INACTIVE_STATUSES = new Set([
  "closed", "close",
  "archived", "archive",
  "deleted",
  "cancelled", "canceled",
  "inactive",
  "done", "completed", "complete", "finished",
  "suspended",
]);

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
    const { data, error } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", userId);

    if (error) return { ok: false, error: error.message, projectIds: [] as string[] };

    const ids = uniqStrings((data ?? []).map((r: any) => r?.project_id).filter(Boolean));
    return { ok: true, error: null as string | null, projectIds: ids };
  }
}

/**
 * Filter project IDs down to ACTIVE projects.
 *
 * ✅ FIX-PS1: Uses EXCLUSION LIST instead of allowlist.
 * Previously: `if (status && status !== "active") continue;`
 * → silently excluded planning, in_progress, on_hold, paused etc.
 *
 * Now: only exclude known terminal states. A project with status=""
 * or status="in_progress" is kept.
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
      .select("id, status, deleted_at, closed_at, created_at")
      .in("id", ids)
      .limit(10000);

    if (error) {
      if (looksMissingColumn(error) || looksMissingRelation(error)) throw error;
      // RLS etc — can't read projects, return original ids to avoid blank UI
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

      // ✅ FIX-PS1: Only exclude KNOWN terminal states.
      // deleted_at / closed_at timestamps are always disqualifying regardless of status.
      if (deletedAt) continue;
      if (closedAt) continue;
      if (status && INACTIVE_STATUSES.has(status)) continue;

      out.push(id);
    }

    return { ok: true, error: null as string | null, projectIds: uniqStrings(out) };
  } catch {
    // Fallback: confirm the project still exists at minimum
    try {
      const { data, error } = await supabase
        .from("projects")
        .select("id")
        .in("id", ids)
        .limit(10000);

      if (error) return { ok: false, error: error.message, projectIds: ids };

      const out = uniqStrings((data ?? []).map((r: any) => r?.id).filter(Boolean));
      return { ok: true, error: null as string | null, projectIds: out };
    } catch (e: any) {
      return {
        ok: false,
        error: String(e?.message || e || "projects filter failed"),
        projectIds: ids,
      };
    }
  }
}

/**
 * One-call convenience: membership -> active project scope
 *
 * Returns:
 * - ok: boolean
 * - projectIds: string[] — IDs that are both accessible (member) and active (not terminal)
 * - meta: { before, after, membershipOk, filterOk, filterError }
 *         before = raw membership count
 *         after  = post-active-filter count
 */
export async function resolveActiveProjectScope(supabase: any, userId: string) {
  const mem = await fetchMemberProjectIds(supabase, userId);

  if (!mem.ok) {
    return {
      ok: false,
      error: mem.error || "Failed to resolve project membership",
      projectIds: [] as string[],
      meta: {
        before: 0,
        after: 0,
        membershipOk: false,
        filterOk: false,
        filterError: mem.error || null,
      },
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