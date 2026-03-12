import "server-only";

import { createClient } from "@/utils/supabase/server";
import {
  resolveOrgActiveProjectScope,
  filterActiveProjectIds,
} from "@/lib/server/project-scope";

export async function resolvePortfolioScope(userId?: string | null) {
  const supabase = await createClient();

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
        meta: { reason: "auth_error", detail: error.message },
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
      meta: { reason: "no_user" },
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

  const rawProjectIds = Array.isArray((scoped as any)?.projectIds)
    ? (scoped as any).projectIds
    : Array.isArray(scopeMeta?.scopedIdsRaw)
      ? scopeMeta.scopedIdsRaw
      : [];

  const activeProjectIds = await filterActiveProjectIds(supabase, rawProjectIds);

  return {
    ok: true,
    organisationId,
    rawProjectIds,
    activeProjectIds,
    meta: {
      ...scopeMeta,
      rawCount: rawProjectIds.length,
      activeCount: activeProjectIds.length,
    },
    supabase,
    userId: uid,
  };
}