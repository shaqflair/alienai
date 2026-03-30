import "server-only";

import {
  resolveOrgActiveProjectScope,
  filterActiveProjectIds,
} from "@/lib/server/project-scope";

type ScopeReason =
  | "ok"
  | "auth_error"
  | "no_user"
  | "scope_not_ok"
  | "scope_empty_fallback"
  | "active_filter_zero_fallback"
  | "no_projects_in_scope";

type ScopeMode =
  | "strict"
  | "fail_open"
  | "empty"
  | "error";

function uniqStrings(values: unknown[]): string[] {
  const out = new Set<string>();
  for (const v of values) {
    if (typeof v === "string" && v.trim()) out.add(v.trim());
  }
  return [...out];
}

export async function resolvePortfolioScope(
  supabase: any,
  userId?: string | null,
) {
  let uid = userId ?? null;

  if (!uid) {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) {
      return {
        ok: false,
        organisationId: null,
        rawProjectIds: [] as string[],
        activeProjectIds: [] as string[],
        projectIds: [] as string[],
        meta: {
          reason: "auth_error" as ScopeReason,
          mode: "error" as ScopeMode,
          detail: error.message,
          rawCount: 0,
          activeCount: 0,
          effectiveCount: 0,
          usedFallback: false,
        },
        supabase,
        userId: null,
      };
    }

    uid = user?.id ?? null;
  }

  if (!uid) {
    return {
      ok: false,
      organisationId: null,
      rawProjectIds: [] as string[],
      activeProjectIds: [] as string[],
      projectIds: [] as string[],
      meta: {
        reason: "no_user" as ScopeReason,
        mode: "error" as ScopeMode,
        rawCount: 0,
        activeCount: 0,
        effectiveCount: 0,
        usedFallback: false,
      },
      supabase,
      userId: null,
    };
  }

  const scoped = await resolveOrgActiveProjectScope(supabase, uid);
  const scopeMeta = (scoped as any)?.meta ?? {};

  const organisationId =
    (scoped as any)?.organisationId ??
    scopeMeta?.organisationId ??
    null;

  const scopedOk =
    typeof (scoped as any)?.ok === "boolean" ? Boolean((scoped as any).ok) : true;

  const rawProjectIds = uniqStrings(
    Array.isArray((scoped as any)?.projectIds)
      ? (scoped as any).projectIds
      : Array.isArray(scopeMeta?.scopedIdsRaw)
        ? scopeMeta.scopedIdsRaw
        : [],
  );

  // If the underlying scope resolver explicitly failed, surface it cleanly.
  if (!scopedOk) {
    return {
      ok: false,
      organisationId,
      rawProjectIds: [] as string[],
      activeProjectIds: [] as string[],
      projectIds: [] as string[],
      meta: {
        ...scopeMeta,
        reason: "scope_not_ok" as ScopeReason,
        mode: "error" as ScopeMode,
        rawCount: 0,
        activeCount: 0,
        effectiveCount: 0,
        usedFallback: false,
      },
      supabase,
      userId: uid,
    };
  }

  const activeFiltered = await filterActiveProjectIds(supabase, rawProjectIds);

  const activeProjectIds = uniqStrings(
    Array.isArray(activeFiltered)
      ? activeFiltered
      : Array.isArray((activeFiltered as any)?.projectIds)
        ? (activeFiltered as any).projectIds
        : rawProjectIds,
  );

  // Deterministic decision:
  // - raw + active > 0 => strict OK
  // - raw > 0 but active = 0 => fallback to raw, never silently empty
  // - raw = 0 => explicit empty state
  let effectiveProjectIds: string[] = [];
  let mode: ScopeMode = "strict";
  let reason: ScopeReason = "ok";
  let usedFallback = false;

  if (rawProjectIds.length === 0) {
    effectiveProjectIds = [];
    mode = "empty";
    reason = "no_projects_in_scope";
  } else if (activeProjectIds.length === 0) {
    effectiveProjectIds = rawProjectIds;
    mode = "fail_open";
    reason = "active_filter_zero_fallback";
    usedFallback = true;
  } else {
    effectiveProjectIds = activeProjectIds;
    mode = "strict";
    reason = "ok";
  }

  return {
    ok: true,
    organisationId,
    rawProjectIds,
    activeProjectIds,
    projectIds: effectiveProjectIds,
    meta: {
      ...scopeMeta,
      reason,
      mode,
      rawCount: rawProjectIds.length,
      activeCount: activeProjectIds.length,
      effectiveCount: effectiveProjectIds.length,
      usedFallback,
    },
    supabase,
    userId: uid,
  };
}