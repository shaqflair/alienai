// src/app/api/artifacts/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- helpers ---------------- */

function jsonOk(data: any, status = 200, headers?: HeadersInit) {
  return NextResponse.json({ ok: true, ...data }, { status, headers });
}

function jsonErr(error: string, status = 400, meta?: any, headers?: HeadersInit) {
  return NextResponse.json({ ok: false, error, meta }, { status, headers });
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function norm(x: any) {
  return safeStr(x).trim().toLowerCase();
}

function clampInt(n: any, min: number, max: number, fallback: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function parseCursor(raw: string | null) {
  const s = safeStr(raw).trim();
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function parseBool(raw: string | null) {
  const v = safeStr(raw).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "y";
}

function escapeIlike(q: string) {
  return q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function buildArtifactHref(a: { project_id?: any; id?: any; type?: any }) {
  const pid = safeStr(a.project_id).trim();
  const aid = safeStr(a.id).trim();
  const t = norm(a.type);

  if (!pid) return "/projects";
  if (t.includes("raid")) return `/projects/${pid}/raid`;
  if (t.includes("change")) return `/projects/${pid}/change`;
  if (t.includes("lesson")) return `/projects/${pid}/lessons`;
  if (aid) return `/projects/${pid}/artifacts/${aid}`;
  return `/projects/${pid}/artifacts`;
}

/* ---------------- project relation selection ---------------- */

type ProjectRel = "projects_active" | "projects_live" | "projects";

function selectForRel(rel: ProjectRel) {
  return `
    id,
    project_id,
    title,
    type,
    status,
    approval_status,
    is_current,
    version,
    root_artifact_id,
    parent_artifact_id,
    created_at,
    updated_at,
    project:${rel}!inner(
      id,
      title,
      project_code,
      deleted_at,
      lifecycle_status,
      status
    )
  `;
}

function isMissingRelationError(err: any) {
  const msg = safeStr(err?.message);
  const code = safeStr(err?.code);
  return code === "42P01" || /relation .* does not exist/i.test(msg);
}

/* ---------------- auth / access guards ---------------- */

async function requireAuth(supabase: any) {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw Object.assign(new Error(error.message), { status: 401 });
  if (!data?.user) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  return data.user;
}

async function requireProjectMember(supabase: any, projectId: string, userId: string) {
  const pid = safeStr(projectId).trim();
  if (!pid) throw Object.assign(new Error("projectId is required"), { status: 400 });

  const { data, error } = await supabase
    .from("project_members")
    .select("id, role, removed_at")
    .eq("project_id", pid)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw Object.assign(new Error("Forbidden"), { status: 403 });

  return data;
}

async function listAccessibleProjectIds(supabase: any, userId: string) {
  // Enterprise-safe scoping: route-level access scope (defense in depth)
  // Note: we keep this reasonably sized; if you expect > 10k memberships, we’ll switch to server-side RPC.
  const { data, error } = await supabase
    .from("project_members")
    .select("project_id")
    .eq("user_id", userId)
    .is("removed_at", null)
    .limit(5000);

  if (error) throw error;

  const ids = Array.from(
    new Set((data ?? []).map((r: any) => safeStr(r?.project_id).trim()).filter(Boolean))
  );

  return ids;
}

/* ---------------- live-project filters ---------------- */

function applyLiveProjectFilters(query: any) {
  // 🔥 critical: avoid returning artifacts from deleted/closed projects
  return query
    .is("project.deleted_at", null)
    .not("project.lifecycle_status", "ilike", "%closed%")
    .not("project.lifecycle_status", "ilike", "%cancel%")
    .not("project.lifecycle_status", "ilike", "%complete%")
    .not("project.lifecycle_status", "ilike", "%archived%")
    .not("project.status", "ilike", "%closed%")
    .not("project.status", "ilike", "%cancel%")
    .not("project.status", "ilike", "%complete%");
}

/* ---------------- route ---------------- */

export async function GET(req: Request) {
  const supabase = await createClient();

  const noStoreHeaders: HeadersInit = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
  };

  try {
    const user = await requireAuth(supabase);

    const url = new URL(req.url);

    const projectIdRaw = safeStr(url.searchParams.get("projectId")).trim();
    const q = safeStr(url.searchParams.get("q")).trim();
    const type = safeStr(url.searchParams.get("type")).trim();
    const includeTotals = parseBool(url.searchParams.get("includeTotals"));

    const limit = clampInt(url.searchParams.get("limit"), 1, 100, 50);
    const cursor = parseCursor(url.searchParams.get("cursor"));

    const from = cursor;
    const to = cursor + limit - 1;

    // 🔒 Enterprise scoping:
    // - if projectId provided → must be a member of that project
    // - else → restrict to the user’s project memberships
    let scopedProjectIds: string[] | null = null;

    if (projectIdRaw) {
      await requireProjectMember(supabase, projectIdRaw, user.id);
      scopedProjectIds = [projectIdRaw];
    } else {
      const ids = await listAccessibleProjectIds(supabase, user.id);
      scopedProjectIds = ids;
    }

    async function runWithRel(rel: ProjectRel) {
      // If user has zero memberships, return empty (avoid global reads even if RLS is misconfigured)
      if (!scopedProjectIds || scopedProjectIds.length === 0) {
        return {
          items: [],
          nextCursor: null,
          facets: { types: type ? [type] : [] },
          ...(includeTotals
            ? { totalCount: 0, activeCount: 0, activeProjectCount: 0 }
            : {}),
        };
      }

      // Base query
      let query = supabase
        .from("artifacts")
        .select(selectForRel(rel), { count: "exact" })
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false })
        .eq("is_current", true)
        .is("deleted_at", null);

      // Apply live-project filters
      query = applyLiveProjectFilters(query);

      // Apply access scope
      if (scopedProjectIds.length === 1) {
        query = query.eq("project_id", scopedProjectIds[0]);
      } else {
        query = query.in("project_id", scopedProjectIds);
      }

      // Optional type filter
      if (type) query = query.eq("type", type);

      // Optional search
      if (q) {
        const qq = `%${escapeIlike(q)}%`;
        query = query.or(
          `title.ilike.${qq},type.ilike.${qq},status.ilike.${qq},approval_status.ilike.${qq}`
        );
      }

      // Page
      const { data, error, count } = await query.range(from, to);
      if (error) throw error;

      const items = (data ?? []).map((r: any) => ({
        id: r.id,
        project_id: r.project_id,
        title: r.title,
        type: r.type,
        status: r.status,
        approval_status: r.approval_status,
        is_current: r.is_current,
        version: r.version,
        root_artifact_id: r.root_artifact_id,
        parent_artifact_id: r.parent_artifact_id,
        created_at: r.created_at,
        updated_at: r.updated_at,
        href: buildArtifactHref(r),
        project: r.project
          ? {
              id: r.project.id,
              title: r.project.title,
              project_code: r.project.project_code,
            }
          : null,
      }));

      const total = typeof count === "number" ? count : items.length;
      const nextCursor = from + items.length < total ? String(from + items.length) : null;

      const facetsTypes =
        type && type.length
          ? [type]
          : Array.from(new Set(items.map((x: any) => safeStr(x.type)).filter(Boolean))).sort(
              (a, b) => a.localeCompare(b)
            );

      // Totals (enterprise-safe: computed inside the same access scope + same live filters)
      let totalCount: number | null = null;
      let activeCount: number | null = null;
      let activeProjectCount: number | null = null;

      if (includeTotals) {
        // Count within same scope/filters (but without pagination)
        let countQuery = supabase
          .from("artifacts")
          .select("id", { count: "exact", head: true })
          .eq("is_current", true)
          .is("deleted_at", null);

        countQuery = applyLiveProjectFilters(countQuery);

        if (scopedProjectIds.length === 1) {
          countQuery = countQuery.eq("project_id", scopedProjectIds[0]);
        } else {
          countQuery = countQuery.in("project_id", scopedProjectIds);
        }

        if (type) countQuery = countQuery.eq("type", type);

        if (q) {
          const qq = `%${escapeIlike(q)}%`;
          countQuery = countQuery.or(
            `title.ilike.${qq},type.ilike.${qq},status.ilike.${qq},approval_status.ilike.${qq}`
          );
        }

        const { count: totalC, error: countErr } = await countQuery;
        if (countErr) throw countErr;

        totalCount = typeof totalC === "number" ? totalC : 0;
        activeCount = totalCount;

        // Active project count (projects that have at least one matching artifact, within scope)
        // This is still scoped + live-filtered. If you want "all live projects regardless of artifacts",
        // we should compute from projects table instead.
        let pidQuery = supabase
          .from("artifacts")
          .select(`project_id, project:${rel}!inner(id, deleted_at, lifecycle_status, status)`)
          .eq("is_current", true)
          .is("deleted_at", null);

        pidQuery = applyLiveProjectFilters(pidQuery);

        if (scopedProjectIds.length === 1) {
          pidQuery = pidQuery.eq("project_id", scopedProjectIds[0]);
        } else {
          pidQuery = pidQuery.in("project_id", scopedProjectIds);
        }

        if (type) pidQuery = pidQuery.eq("type", type);

        if (q) {
          const qq = `%${escapeIlike(q)}%`;
          pidQuery = pidQuery.or(
            `title.ilike.${qq},type.ilike.${qq},status.ilike.${qq},approval_status.ilike.${qq}`
          );
        }

        const { data: pidRows, error: pidErr } = await pidQuery.limit(5000);
        if (pidErr) throw pidErr;

        const set = new Set<string>();
        for (const r of (pidRows ?? []) as any[]) {
          const pid = safeStr(r?.project_id).trim();
          if (pid) set.add(pid);
        }
        activeProjectCount = set.size;
      }

      return {
        items,
        nextCursor,
        facets: { types: facetsTypes },
        ...(includeTotals ? { totalCount, activeCount, activeProjectCount } : {}),
      };
    }

    // Try project relation views in order, falling back if missing
    try {
      const payload = await runWithRel("projects_active");
      return jsonOk(payload, 200, noStoreHeaders);
    } catch (e1: any) {
      if (!isMissingRelationError(e1)) throw e1;
      try {
        const payload = await runWithRel("projects_live");
        return jsonOk(payload, 200, noStoreHeaders);
      } catch (e2: any) {
        if (!isMissingRelationError(e2)) throw e2;
        const payload = await runWithRel("projects");
        return jsonOk(payload, 200, noStoreHeaders);
      }
    }
  } catch (e: any) {
    const status =
      typeof e?.status === "number" && e.status >= 400 && e.status <= 599 ? e.status : 500;

    const meta =
      e && typeof e === "object"
        ? { code: (e as any).code, hint: (e as any).hint, details: (e as any).details }
        : undefined;

    return jsonErr(e?.message || "Unknown error", status, meta, noStoreHeaders);
  }
}