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
  if (t === "raid" || t === "raid_log") return `/projects/${pid}/raid`;
  if (
    t === "change_requests" ||
    t === "change_request" ||
    t === "change" ||
    t === "changes" ||
    t.includes("change")
  )
    return `/projects/${pid}/change`;
  if (t === "lessons_learned" || t === "lessons" || t.includes("lesson"))
    return `/projects/${pid}/lessons`;
  if (aid) return `/projects/${pid}/artifacts/${aid}`;
  return `/projects/${pid}/artifacts`;
}

/* ---------------- schema-adaptive project columns ---------------- */

const PROJECT_COL_CANDIDATES = ["status", "state", "lifecycle_status", "lifecycle_state"] as const;
type ProjectCol = (typeof PROJECT_COL_CANDIDATES)[number];

let projectColsResolved: ProjectCol[] | null = null;

function parseMissingProjectColFromError(err: any): ProjectCol | null {
  const msg = safeStr(err?.message || "");
  const code = safeStr(err?.code || "");
  if (code && code !== "42703") return null;

  const m = msg.match(/projects(?:_1)?\.(\w+)\b/i);
  const col = (m?.[1] || "").toLowerCase();
  if ((PROJECT_COL_CANDIDATES as readonly string[]).includes(col)) return col as ProjectCol;
  return null;
}

function buildProjectsSelect(cols: ProjectCol[]) {
  const base = ["id", "title", "project_code", "deleted_at", ...cols];
  return `projects:projects (${base.join(",")})`;
}

function applyExcludeInactiveProjects(query: any, cols: ProjectCol[]) {
  // Always exclude soft-deleted projects
  query = query.is("projects.deleted_at", null);

  // ✅ Be tolerant to casing / enums:
  // - Prefer active (case-insensitive) when those columns exist
  // - Always exclude obvious inactive words (closed/cancelled/completed/archived/rejected)
  const bad = ["%closed%", "%complete%", "%completed%", "%cancel%", "%cancelled%", "%archiv%", "%reject%"];

  // Prefer "active" (case-insensitive) where available
  if (cols.includes("status")) {
    query = query.ilike("projects.status", "active");
    for (const pat of bad) query = query.not("projects.status", "ilike", pat);
  } else if (cols.includes("state")) {
    query = query.ilike("projects.state", "active");
    for (const pat of bad) query = query.not("projects.state", "ilike", pat);
  }

  if (cols.includes("lifecycle_status")) {
    query = query.ilike("projects.lifecycle_status", "active");
    for (const pat of bad) query = query.not("projects.lifecycle_status", "ilike", pat);
  } else if (cols.includes("lifecycle_state")) {
    query = query.ilike("projects.lifecycle_state", "active");
    for (const pat of bad) query = query.not("projects.lifecycle_state", "ilike", pat);
  }

  // If only one of the fields exists, still block inactive keywords on any other available field
  // (helps if schema uses "state" but has "lifecycle_status" too)
  if (cols.includes("status")) {
    for (const pat of bad) query = query.not("projects.status", "ilike", pat);
  }
  if (cols.includes("state")) {
    for (const pat of bad) query = query.not("projects.state", "ilike", pat);
  }
  if (cols.includes("lifecycle_status")) {
    for (const pat of bad) query = query.not("projects.lifecycle_status", "ilike", pat);
  }
  if (cols.includes("lifecycle_state")) {
    for (const pat of bad) query = query.not("projects.lifecycle_state", "ilike", pat);
  }

  return query;
}

function applyExcludeClosedArtifacts(query: any) {
  // Artifact.status may be used for portfolio health/labels; exclude closed-ish ones from this API
  const bad = ["%closed%", "%done%", "%complete%", "%completed%", "%cancel%", "%cancelled%"];
  for (const pat of bad) query = query.not("status", "ilike", pat);
  return query;
}

async function withProjectColsRetry<T>(
  run: (cols: ProjectCol[]) => Promise<T>,
  maxAttempts = 3
): Promise<{ result: T; cols: ProjectCol[] }> {
  let cols: ProjectCol[] =
    projectColsResolved ?? (Array.from(PROJECT_COL_CANDIDATES) as ProjectCol[]);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await run(cols);
      projectColsResolved = cols;
      return { result, cols };
    } catch (e: any) {
      const missing = parseMissingProjectColFromError(e);
      if (!missing) throw e;
      cols = cols.filter((c) => c !== missing);
      if (!cols.length) projectColsResolved = [];
    }
  }

  const finalCols: ProjectCol[] = [];
  const result = await run(finalCols);
  projectColsResolved = finalCols;
  return { result, cols: finalCols };
}

/* ---------------- route ---------------- */

export async function GET(req: Request) {
  const supabase = await createClient();

  const noStoreHeaders: HeadersInit = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
  };

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) return jsonErr(authErr.message, 401, undefined, noStoreHeaders);
  if (!auth?.user) return jsonErr("Auth session missing!", 401, undefined, noStoreHeaders);

  const url = new URL(req.url);

  const projectId = safeStr(url.searchParams.get("projectId")).trim();
  const q = safeStr(url.searchParams.get("q")).trim();
  const type = safeStr(url.searchParams.get("type")).trim();
  const includeTotals = parseBool(url.searchParams.get("includeTotals"));

  const limit = clampInt(url.searchParams.get("limit"), 1, 100, 50);
  const cursor = parseCursor(url.searchParams.get("cursor"));

  try {
    const { result: payload } = await withProjectColsRetry(async (projCols) => {
      const projectsSelect = buildProjectsSelect(projCols);

      const makeBase = (selectOverride?: string, withCountExact = true) => {
        let query = supabase
          .from("artifacts")
          .select(
            selectOverride ??
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
              ${projectsSelect}
            `,
            withCountExact ? ({ count: "exact" } as any) : undefined
          )
          .order("updated_at", { ascending: false })
          .order("created_at", { ascending: false })
          .eq("is_current", true);

        if (projectId) query = query.eq("project_id", projectId);
        if (type) query = query.eq("type", type);

        if (q) {
          const qq = `%${escapeIlike(q)}%`;
          query = query.or(
            `title.ilike.${qq},type.ilike.${qq},status.ilike.${qq},approval_status.ilike.${qq}`
          );
        }

        // ✅ critical: align with Projects "Active" definition
        query = applyExcludeInactiveProjects(query, projCols);
        query = applyExcludeClosedArtifacts(query);

        return query;
      };

      const from = cursor;
      const to = cursor + limit - 1;

      const { data, error, count } = await makeBase().range(from, to);
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
        project: r.projects
          ? {
              id: r.projects.id,
              title: r.projects.title,
              project_code: r.projects.project_code,
              ...(projCols.includes("status") ? { status: r.projects.status ?? null } : {}),
              ...(projCols.includes("state") ? { state: r.projects.state ?? null } : {}),
              ...(projCols.includes("lifecycle_status")
                ? { lifecycle_status: r.projects.lifecycle_status ?? null }
                : {}),
              ...(projCols.includes("lifecycle_state")
                ? { lifecycle_state: r.projects.lifecycle_state ?? null }
                : {}),
            }
          : null,
      }));

      const total = typeof count === "number" ? count : items.length;
      const nextCursor = from + items.length < total ? String(from + items.length) : null;

      const facetsTypes =
        type && type.length
          ? [type]
          : Array.from(new Set(items.map((x: any) => safeStr(x.type)).filter(Boolean))).sort((a, b) =>
              a.localeCompare(b)
            );

      let totalCount: number | null = null;
      let activeCount: number | null = null;
      let activeProjectCount: number | null = null;

      if (includeTotals) {
        // Total = count of active artifacts after filters (same as “activeCount” here)
        const { count: totalC, error: totalErr } = await makeBase(undefined, true).range(0, 0);
        if (totalErr) throw totalErr;
        if (typeof totalC === "number") totalCount = totalC;

        activeCount = totalCount;

        // Distinct project count across the base query
        const pidSelect = `project_id, ${projectsSelect}`;
        const { data: pidRows, error: pidErr } = await makeBase(pidSelect, false)
          .order("project_id", { ascending: true })
          .range(0, 9999);

        if (pidErr) throw pidErr;

        const set = new Set<string>();
        for (const r of (pidRows ?? []) as any[]) {
          const pid = safeStr(r.project_id).trim();
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
    });

    return jsonOk(payload, 200, noStoreHeaders);
  } catch (e: any) {
    const meta =
      e && typeof e === "object"
        ? { code: (e as any).code, hint: (e as any).hint, details: (e as any).details }
        : undefined;

    return jsonErr(e?.message || "Unknown error", 500, meta, noStoreHeaders);
  }
}