// src/app/api/portfolio/raid-hi/route.ts
// ✅ Org-scoped: all org members see high-severity RAID items across all active projects.
// ✅ Auth-first: userId resolved before scope resolution.
// ✅ No-store cache on all responses.
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveOrgActiveProjectScope } from "@/lib/server/project-scope";

export const runtime = "nodejs";

/* ---------------- helpers ---------------- */

function noStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function jsonOk(data: any, status = 200): NextResponse {
  return noStore(NextResponse.json({ ok: true, ...data }, { status }));
}

function jsonErr(error: string, status = 400, meta?: any): NextResponse {
  return noStore(NextResponse.json({ ok: false, error, meta }, { status }));
}

function clampDays(v: string | null): number {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "all") return 60;
  const n = Number(s);
  const allowed = new Set([7, 14, 30, 60]);
  return allowed.has(n) ? n : 30;
}

function sinceIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function isHighSeverity(r: any): boolean {
  // Score-based (numeric) takes precedence: treat ≥ 70 as high.
  const score = Number(r?.score ?? r?.severity_score ?? NaN);
  if (Number.isFinite(score)) return score >= 70;

  // String-based severity label fallback.
  const sev = String(r?.severity ?? r?.impact ?? "").trim().toLowerCase();
  return sev === "high" || sev === "critical" || sev === "very high";
}

/* ---------------- GET ---------------- */

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const url      = new URL(req.url);
    const days     = clampDays(url.searchParams.get("days"));
    const since    = sinceIso(days);

    // ✅ Auth first — userId required for org scope resolution.
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (authErr || !userId) return jsonErr("Not authenticated", 401);

    // ✅ Org-wide scope — no member-scoped fallback.
    const scoped     = await resolveOrgActiveProjectScope(supabase, userId);
    const projectIds = scoped.projectIds;

    if (!projectIds.length) {
      return jsonOk({
        window_days: days,
        since,
        items: [],
        meta: {
          scope: "org",
          projectCount: 0,
          reason: "no_active_projects_in_org",
          organisationId: scoped.organisationId ?? null,
        },
      });
    }

    const { data, error } = await supabase
      .from("raid_items")
      .select(
        "id, project_id, title, type, status, severity, impact, probability, due_date, created_at, updated_at"
      )
      .in("project_id", projectIds)
      .gte("updated_at", since)
      .not("status", "in", '("Closed","Invalid")')
      .order("updated_at", { ascending: false })
      .limit(200);

    if (error) {
      // Degrade gracefully — schema differences across envs should not 500.
      return jsonOk({
        window_days: days,
        since,
        items: [],
        meta: {
          scope: "org",
          projectCount: projectIds.length,
          degraded: true,
          reason: "raid_query_failed",
          message: error.message,
        },
      });
    }

    const all   = data ?? [];
    const items = all.filter(isHighSeverity);

    return jsonOk({
      window_days: days,
      since,
      items,
      meta: {
        scope: "org",
        organisationId: scoped.organisationId ?? null,
        projectCount:   projectIds.length,
        total_raw:      all.length,
        total_hi:       items.length,
      },
    });
  } catch (e: any) {
    return jsonErr(String(e?.message ?? e), 500);
  }
}