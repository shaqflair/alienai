// src/app/api/risk/score-history/route.ts
// Portfolio-scope upgrade:
// ✅ Shared portfolio scope via resolvePortfolioScope (portfolio-aligned)
// ✅ Active-only filter via filterActiveProjectIds
// ✅ Fail-open behaviour preserved for active filter
// ✅ no-store caching
//
// Returns score history series for requested RAID item ids, limited to items in active projects
// within the shared portfolio scope.

import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveActiveProjectScope, filterActiveProjectIds } from "@/lib/server/project-scope";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";

export const runtime = "nodejs";

/* ---------------- response helpers ---------------- */

function noStore(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function ok(data: any, status = 200) {
  return noStore(NextResponse.json({ ok: true, ...data }, { status }));
}

function err(message: string, status = 400, meta?: any) {
  return noStore(
    NextResponse.json({ ok: false, error: message, ...(meta ? { meta } : {}) }, { status }),
  );
}

/* ---------------- utils ---------------- */

function clampPoints(x: string | null, fallback = 4) {
  const n = Number(x);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(2, Math.min(12, Math.floor(n)));
}

function uniqStrings(xs: any[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs || []) {
    const s = String(x || "").trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function parseIds(x: string | null) {
  if (!x) return [];
  const raw = String(x)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 400);
  return uniqStrings(raw);
}

/* ---------------- handler ---------------- */

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const url = new URL(req.url);

    const points = clampPoints(url.searchParams.get("points"), 4);
    const ids = parseIds(url.searchParams.get("ids"));

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (authErr || !userId) {
      return err("Not authenticated", 401);
    }

    if (!ids.length) return ok({ points, series: {}, meta: { requested: 0 } });

    // Shared portfolio scope first; membership fallback if empty / failed
    let scoped: any = null;
    let scopedIds: string[] = [];

    try {
      scoped = await resolvePortfolioScope(supabase, userId);
      scopedIds = Array.isArray(scoped?.projectIds) ? uniqStrings(scoped.projectIds) : [];
    } catch (e: any) {
      scoped = { ok: false, error: String(e?.message || e), projectIds: [], meta: null };
      scopedIds = [];
    }

    if (!scopedIds.length) {
      const fallback = await resolveActiveProjectScope(supabase);
      scoped = fallback;
      scopedIds = Array.isArray(fallback?.projectIds) ? uniqStrings(fallback.projectIds) : [];
    }

    if (!scopedIds.length) {
      return ok({
        points,
        series: {},
        meta: {
          requested: ids.length,
          allowed: 0,
          project_count: 0,
          active_only: true,
          scope: scoped?.meta ?? null,
        },
      });
    }

    // Active-only filter with fail-open preserved
    let projectIds = uniqStrings(scopedIds);
    let activeFilterMeta: any = {
      before: scopedIds.length,
      after: scopedIds.length,
      fail_open: false,
    };

    try {
      const active = await filterActiveProjectIds(supabase, scopedIds);
      const filteredIds = uniqStrings(
        Array.isArray(active) ? active : (active as any)?.projectIds ?? [],
      );

      if (filteredIds.length > 0) {
        projectIds = filteredIds;
        activeFilterMeta = {
          before: scopedIds.length,
          after: filteredIds.length,
          fail_open: false,
          ok: (active as any)?.ok ?? true,
          error: (active as any)?.error ?? null,
        };
      } else {
        projectIds = uniqStrings(scopedIds);
        activeFilterMeta = {
          before: scopedIds.length,
          after: scopedIds.length,
          fail_open: true,
          ok: (active as any)?.ok ?? false,
          error: (active as any)?.error ?? "filterActiveProjectIds returned 0 rows",
        };
      }
    } catch (e: any) {
      projectIds = uniqStrings(scopedIds);
      activeFilterMeta = {
        before: scopedIds.length,
        after: scopedIds.length,
        fail_open: true,
        ok: false,
        error: String(e?.message || e),
      };
    }

    if (!projectIds.length) {
      return ok({
        points,
        series: {},
        meta: {
          requested: ids.length,
          allowed: 0,
          project_count: 0,
          active_only: true,
          scope: scoped?.meta ?? null,
          active_filter: activeFilterMeta,
        },
      });
    }

    // allowed items (must belong to an active project in scope)
    const { data: allowedItems, error: allowErr } = await supabase
      .from("raid_items")
      .select("id, project_id")
      .in("id", ids)
      .in("project_id", projectIds)
      .limit(1000);

    if (allowErr) return err(allowErr.message, 500);

    const allowedIds = uniqStrings((allowedItems || []).map((r: any) => r?.id));

    if (!allowedIds.length) {
      return ok({
        points,
        series: {},
        meta: {
          requested: ids.length,
          allowed: 0,
          project_count: projectIds.length,
          active_only: true,
          scope: scoped?.meta ?? null,
          active_filter: activeFilterMeta,
        },
      });
    }

    // Pull latest score points (descending), then reverse per series for charting
    const { data: scores, error: sErr } = await supabase
      .from("raid_item_scores")
      .select("raid_item_id, score, scored_at")
      .in("raid_item_id", allowedIds)
      .order("scored_at", { ascending: false })
      .limit(20000);

    if (sErr) return err(sErr.message, 500);

    const allowSet = new Set(allowedIds);
    const series: Record<string, number[]> = {};

    for (const row of scores || []) {
      const id = String((row as any).raid_item_id || "").trim();
      if (!id || !allowSet.has(id)) continue;

      if (!series[id]) series[id] = [];
      if (series[id].length >= points) continue;

      const sc = Number((row as any).score);
      if (!Number.isFinite(sc)) continue;

      series[id].push(sc);
    }

    for (const k of Object.keys(series)) series[k] = series[k].slice().reverse();

    return ok({
      points,
      series,
      meta: {
        requested: ids.length,
        allowed: allowedIds.length,
        project_count: projectIds.length,
        active_only: true,
        scope: scoped?.meta ?? null,
        active_filter: activeFilterMeta,
      },
    });
  } catch (e: any) {
    console.error("[GET /api/risk/score-history]", e);
    return err(String(e?.message || e || "Failed"), 500);
  }
}