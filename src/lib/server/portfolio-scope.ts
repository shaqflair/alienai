import "server-only";

import { resolveOrgActiveProjectScope } from "@/lib/server/project-scope";

type ScopeReason =
  | "ok"
  | "auth_error"
  | "no_user"
  | "scope_not_ok"
  | "scope_empty_fallback"
  | "active_filter_zero_fallback"
  | "no_projects_in_scope"
  | "missing_org"
  | "active_filter_zero"
  | "no_memberships_no_org";

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
    typeof (scoped as any)?.ok === "boolean"
      ? Boolean((scoped as any).ok)
      : true;

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

  const rawProjectIds = uniqStrings(
    Array.isArray((scoped as any)?.rawProjectIds)
      ? (scoped as any).rawProjectIds
      : Array.isArray(scopeMeta?.scopedIdsRaw)
        ? scopeMeta.scopedIdsRaw
        : [],
  );

  const activeProjectIds = uniqStrings(
    Array.isArray((scoped as any)?.activeProjectIds)
      ? (scoped as any).activeProjectIds
      : Array.isArray((scoped as any)?.projectIds)
        ? (scoped as any).projectIds
        : [],
  );

  // Deterministic decision:
  // - active > 0 => strict
  // - raw > 0 but active = 0 => explicit fail_open to preserve visibility
  // - raw = 0 => explicit empty
  let effectiveProjectIds: string[] = [];
  let mode: ScopeMode = "strict";
  let reason: ScopeReason = "ok";
  let usedFallback = false;

  if (activeProjectIds.length > 0) {
    effectiveProjectIds = activeProjectIds;
    mode = "strict";
    reason = "ok";
  } else if (rawProjectIds.length > 0) {
    effectiveProjectIds = rawProjectIds;
    mode = "fail_open";
    reason = "active_filter_zero_fallback";
    usedFallback = true;
  } else {
    effectiveProjectIds = [];
    mode = "empty";
    reason =
      (scopeMeta?.reason as ScopeReason | undefined) ?? "no_projects_in_scope";
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