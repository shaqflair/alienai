// src/app/api/risk/score-history/route.ts
// Org-scope upgrade:
// ✅ ORG-WIDE project scope via resolveOrgActiveProjectScope (portfolio-aligned)
// ✅ Active-only filter via filterActiveProjectIds
// ✅ no-store caching
//
// Returns score history series for requested RAID item ids, limited to items in org-active projects.

import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveOrgActiveProjectScope, filterActiveProjectIds } from "@/lib/server/project-scope";

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
  return noStore(NextResponse.json({ ok: false, error: message, ...(meta ? { meta } : {}) }, { status }));
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

    // ✅ ORG-wide scope (safe fallback is inside helper)
    const scoped = await resolveOrgActiveProjectScope(supabase);

    const scopedIds = Array.isArray(scoped?.projectIds) ? uniqStrings(scoped.projectIds) : [];
    if (!scopedIds.length) {
      return ok({
        points,
        series: {},
        meta: { requested: ids.length, allowed: 0, project_count: 0, active_only: true, scope: scoped?.meta ?? null },
      });
    }

    // ✅ Active-only filter (exclude closed/deleted/cancelled/archived etc.)
    const active = await filterActiveProjectIds(supabase, scopedIds);
    const projectIds = Array.isArray(active?.projectIds) ? uniqStrings(active.projectIds) : [];

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
          active_filter_ok: Boolean(active?.ok),
          active_filter_error: active?.error ?? null,
        },
      });
    }

    // ✅ allowed items (must belong to an active project in org scope)
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
          active_filter_ok: Boolean(active?.ok),
          active_filter_error: active?.error ?? null,
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
        active_filter_ok: Boolean(active?.ok),
        active_filter_error: active?.error ?? null,
      },
    });
  } catch (e: any) {
    console.error("[GET /api/risk/score-history]", e);
    return err(String(e?.message || e || "Failed"), 500);
  }
}