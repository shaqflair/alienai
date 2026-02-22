// src/app/api/artifacts/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

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

/**
 * Cursor strategy: offset-based
 * nextCursor is a stringified integer offset.
 */
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
  // escape % and _ for ilike
  return q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

/** ✅ computed href (NOT a DB column) */
function buildArtifactHref(a: { project_id?: any; id?: any; type?: any }) {
  const pid = safeStr(a.project_id).trim();
  const aid = safeStr(a.id).trim();
  const t = norm(a.type);

  if (!pid) return "/projects";
  if (t === "raid" || t === "raid_log") return `/projects/${pid}/raid`;
  if (t === "change_requests" || t === "change_request" || t === "change" || t === "changes" || t.includes("change"))
    return `/projects/${pid}/change`;
  if (t === "lessons_learned" || t === "lessons" || t.includes("lesson")) return `/projects/${pid}/lessons`;
  if (aid) return `/projects/${pid}/artifacts/${aid}`;
  return `/projects/${pid}/artifacts`;
}

/* ---------------- shared filters ---------------- */

/**
 * We treat these as “inactive projects” and exclude them.
 * Matches your client-side logic.
 */
function applyExcludeInactiveProjects(query: any) {
  // PostgREST filters on joined table columns use "projects.<col>"
  // We apply NOT ILIKE on each lifecycle column.
  const bad = ["%cancel%", "%close%", "%archive%", "%inactive%", "%complete%", "%done%"];

  const cols = [
    "projects.status",
    "projects.state",
    "projects.lifecycle_status",
    "projects.lifecycle_state",
  ];

  for (const col of cols) {
    for (const pat of bad) {
      query = query.not(col, "ilike", pat);
    }
  }
  return query;
}

/**
 * Exclude “closed/cancelled” artifacts for ACTIVE counts.
 * (We do not exclude from the list unless you want the list to only show open artifacts too.
 * Right now: list shows all artifacts in active projects; activeCount counts only open ones.)
 */
function applyExcludeClosedArtifacts(query: any) {
  const bad = ["%closed%", "%done%", "%complete%", "%completed%", "%cancel%"];
  for (const pat of bad) query = query.not("status", "ilike", pat);
  return query;
}

/* ---------------- route ---------------- */

export async function GET(req: Request) {
  // ✅ IMPORTANT: createClient() is async (Next 16 cookies may be async)
  const supabase = await createClient();

  // ✅ No cache (prevents “deleted but still visible”)
  const noStoreHeaders: HeadersInit = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
  };

  // ✅ Auth gate
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) return jsonErr(authErr.message, 401, undefined, noStoreHeaders);
  if (!auth?.user) return jsonErr("Auth session missing!", 401, undefined, noStoreHeaders);

  const url = new URL(req.url);

  /**
   * ✅ projectId is OPTIONAL:
   * - If provided => project-scoped results
   * - If missing => GLOBAL results across projects the user can read (RLS enforces access)
   */
  const projectId = safeStr(url.searchParams.get("projectId")).trim();

  const q = safeStr(url.searchParams.get("q")).trim();
  const type = safeStr(url.searchParams.get("type")).trim(); // e.g. "wbs"

  const includeTotals = parseBool(url.searchParams.get("includeTotals"));

  const missingEffortOn = parseBool(url.searchParams.get("missingEffort"));
  const stalledOn = parseBool(url.searchParams.get("stalled"));

  const limit = clampInt(url.searchParams.get("limit"), 1, 100, 50);
  const cursor = parseCursor(url.searchParams.get("cursor"));

  try {
    // ---------------- Base query builder (shared filters) ----------------
    const makeBase = () => {
      let query = supabase
        .from("artifacts")
        .select(
          `
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
            projects:projects (
              id,
              title,
              project_code,
              status,
              state,
              lifecycle_status,
              lifecycle_state
            )
          `,
          { count: "exact" }
        )
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false });

      // Optional project scope
      if (projectId) query = query.eq("project_id", projectId);

      // Type filter
      if (type) query = query.eq("type", type);

      // Text search
      if (q) {
        const qq = `%${escapeIlike(q)}%`;
        query = query.or(
          `title.ilike.${qq},type.ilike.${qq},status.ilike.${qq},approval_status.ilike.${qq}`
        );
      }

      // Optional quick filters (only enable if columns exist)
      // if (missingEffortOn) query = query.or("effort.is.null,effort.eq.");
      // if (stalledOn) query = query.eq("stalled", true);
      void missingEffortOn;
      void stalledOn;

      // ✅ Always exclude inactive projects (closed/cancelled/etc)
      query = applyExcludeInactiveProjects(query);

      return query;
    };

    // ---------------- Page query ----------------
    let pageQuery = makeBase();

    // pagination
    const from = cursor;
    const to = cursor + limit - 1;

    const { data, error, count } = await pageQuery.range(from, to);

    if (error) {
      return jsonErr(
        error.message,
        400,
        { code: error.code, hint: error.hint, details: error.details },
        noStoreHeaders
      );
    }

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

      // ✅ computed link (NOT from DB)
      href: buildArtifactHref(r),

      project: r.projects
        ? {
            id: r.projects.id,
            title: r.projects.title,
            project_code: r.projects.project_code,
            status: r.projects.status ?? null,
            state: r.projects.state ?? null,
            lifecycle_status: r.projects.lifecycle_status ?? null,
            lifecycle_state: r.projects.lifecycle_state ?? null,
          }
        : null,
    }));

    const total = typeof count === "number" ? count : items.length;
    const nextCursor = from + items.length < total ? String(from + items.length) : null;

    // facet types (global or project-scoped depending on request)
    const types =
      type && type.length
        ? [type]
        : Array.from(new Set(items.map((x) => safeStr(x.type)).filter(Boolean))).sort((a, b) =>
            a.localeCompare(b)
          );

    // ---------------- Totals (optional) ----------------
    let totalCount: number | null = null;
    let activeCount: number | null = null;
    let activeProjectCount: number | null = null;

    if (includeTotals) {
      // Total count for current view (already excludes inactive projects)
      const { count: totalC, error: totalErr } = await makeBase().range(0, 0); // cheap count
      if (!totalErr && typeof totalC === "number") totalCount = totalC;

      // Active artifacts count (exclude closed/cancelled artifact statuses)
      const activeBase = applyExcludeClosedArtifacts(makeBase());
      const { count: activeC, error: activeErr } = await activeBase.range(0, 0);
      if (!activeErr && typeof activeC === "number") activeCount = activeC;

      // Active project count (distinct project_id across active artifacts)
      // JS de-dupe (capped to 10k rows)
      const { data: pidRows, error: pidErr } = await applyExcludeClosedArtifacts(
        makeBase()
          .select("project_id, projects:projects(id)", { count: "exact" }) // minimal
          .order("project_id", { ascending: true })
      ).range(0, 9999);

      if (!pidErr && Array.isArray(pidRows)) {
        const set = new Set<string>();
        for (const r of pidRows as any[]) {
          const pid = safeStr(r.project_id).trim();
          if (pid) set.add(pid);
        }
        activeProjectCount = set.size;
      }
    }

    return jsonOk(
      {
        items,
        nextCursor,
        facets: { types },
        ...(includeTotals
          ? {
              totalCount,
              activeCount,
              activeProjectCount,
            }
          : {}),
      },
      200,
      noStoreHeaders
    );
  } catch (e: any) {
    return jsonErr(e?.message || "Unknown error", 500, undefined, noStoreHeaders);
  }
}