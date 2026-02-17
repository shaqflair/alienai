// src/app/api/portfolio/raid-score-series/route.ts
import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveActiveProjectScope } from "@/lib/server/project-scope";

export const runtime = "nodejs";

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
    if (seen.has(s)) continue;
    seen.add(s);
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
  const supabase = await createClient();
  const url = new URL(req.url);

  const points = clampPoints(url.searchParams.get("points"), 4);
  const ids = parseIds(url.searchParams.get("ids"));

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (authErr || !userId) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  if (!ids.length) return NextResponse.json({ ok: true, points, series: {}, meta: { requested: 0 } });

  // ✅ ACTIVE + accessible projects (membership + not deleted/closed)
  const scoped = await resolveActiveProjectScope(supabase, userId);
  const projectIds = scoped.projectIds;

  if (!projectIds.length) {
    return NextResponse.json({
      ok: true,
      points,
      series: {},
      meta: { requested: ids.length, allowed: 0, project_count: 0, active_only: true, scope: scoped.meta },
    });
  }

  // ✅ allowed items (must belong to an active project in scope)
  const { data: allowedItems, error: allowErr } = await supabase
    .from("raid_items")
    .select("id, project_id")
    .in("id", ids)
    .in("project_id", projectIds)
    .limit(1000);

  if (allowErr) return NextResponse.json({ ok: false, error: allowErr.message }, { status: 500 });

  const allowedIds = uniqStrings((allowedItems || []).map((r: any) => r?.id));

  if (!allowedIds.length) {
    return NextResponse.json({
      ok: true,
      points,
      series: {},
      meta: { requested: ids.length, allowed: 0, project_count: projectIds.length, active_only: true, scope: scoped.meta },
    });
  }

  // Pull latest score points (descending), then reverse per series for charting
  const { data: scores, error: sErr } = await supabase
    .from("raid_item_scores")
    .select("raid_item_id, score, scored_at")
    .in("raid_item_id", allowedIds)
    .order("scored_at", { ascending: false })
    .limit(20000);

  if (sErr) return NextResponse.json({ ok: false, error: sErr.message }, { status: 500 });

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

  return NextResponse.json({
    ok: true,
    points,
    series,
    meta: {
      requested: ids.length,
      allowed: allowedIds.length,
      project_count: projectIds.length,
      active_only: true,
      scope: scoped.meta,
    },
  });
}

