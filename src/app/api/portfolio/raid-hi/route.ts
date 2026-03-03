// src/app/api/portfolio/raid-hi/route.ts — REBUILT v2 (ORG-wide + no-store)
// ✅ ORG-WIDE scope via resolveOrgActiveProjectScope (dashboard-aligned)
// ✅ membership fallback via resolveActiveProjectScope (safe)
// ✅ Cache-Control: no-store for all responses
//
// NOTE: This endpoint is defensive: if RAID schema differs across envs, it degrades gracefully.

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveOrgActiveProjectScope, resolveActiveProjectScope } from "@/lib/server/project-scope";

export const runtime = "nodejs";

function withNoStore(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function clampDays(v: string | null) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "all") return 60;
  const n = Number(s);
  const allowed = new Set([7, 14, 30, 60]);
  return allowed.has(n) ? n : 30;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const url = new URL(req.url);
  const days = clampDays(url.searchParams.get("days"));
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    // Prefer ORG-wide, fallback to member scope.
    const orgScope = await resolveOrgActiveProjectScope(supabase).catch(() => null);
    const fallbackScope = orgScope?.projectIds?.length
      ? null
      : await resolveActiveProjectScope(supabase).catch(() => null);

    const projectIds =
      orgScope?.projectIds?.length
        ? orgScope.projectIds
        : fallbackScope?.projectIds?.length
          ? fallbackScope.projectIds
          : [];

    if (!projectIds.length) {
      return withNoStore(
        NextResponse.json(
          { ok: true, window_days: days, since: sinceIso, items: [], meta: { reason: "no_projects_in_scope" } },
          { status: 200 },
        ),
      );
    }

    // Try a best-effort RAID query. If columns differ, return an empty payload with meta.
    // Common table name in your codebase: raid_items
    const q = supabase
      .from("raid_items")
      .select("id, project_id, title, type, status, severity, impact, probability, due_date, created_at, updated_at")
      .in("project_id", projectIds)
      .gte("updated_at", sinceIso)
      .limit(50);

    const { data, error } = await q;

    if (error) {
      return withNoStore(
        NextResponse.json(
          {
            ok: true,
            window_days: days,
            since: sinceIso,
            items: [],
            meta: {
              degraded: true,
              reason: "raid_query_failed",
              message: error.message,
            },
          },
          { status: 200 },
        ),
      );
    }

    // “HI” heuristic: prefer High/Critical severity if present; otherwise return recent items.
    const items = (data ?? []).filter((r: any) => {
      const sev = String(r?.severity ?? "").toLowerCase();
      if (!sev) return true;
      return sev.includes("high") || sev.includes("critical");
    });

    return withNoStore(
      NextResponse.json(
        {
          ok: true,
          window_days: days,
          since: sinceIso,
          items,
          meta: {
            scope: orgScope?.projectIds?.length ? "org" : "fallback",
            total_raw: (data ?? []).length,
            total_hi: items.length,
          },
        },
        { status: 200 },
      ),
    );
  } catch (e: any) {
    return withNoStore(
      NextResponse.json(
        {
          ok: false,
          window_days: days,
          since: sinceIso,
          error: String(e?.message ?? e),
        },
        { status: 500 },
      ),
    );
  }
}