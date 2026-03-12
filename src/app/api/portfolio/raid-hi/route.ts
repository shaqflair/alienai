// src/app/api/portfolio/raid-hi/route.ts — REBUILT v4 (PORTFOLIO-SCOPE + shared scope + ACTIVE FILTER normalized + no-store + project_code href)
// ✅ Org-scoped: all org members see high-severity RAID items across all active projects.
// ✅ Auth-first: userId resolved before scope resolution.
// ✅ Shared org-wide scope via resolvePortfolioScope().
// ✅ Active-only project filter (exclude closed/terminal) with FAIL-OPEN safeguard.
// ✅ No-store cache on all responses.
// ✅ clampDays supports "all" → 60
// ✅ Includes project title + project_code; links prefer project_code
// ✅ resolvePortfolioScope signature fixed (supabase, userId)

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { filterActiveProjectIds } from "@/lib/server/project-scope";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";

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

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
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

function projectCodeLabel(pc: any): string {
  if (typeof pc === "string") return pc.trim();
  if (typeof pc === "number" && Number.isFinite(pc)) return String(pc);
  if (pc && typeof pc === "object") {
    const v =
      safeStr(pc.project_code) ||
      safeStr(pc.code) ||
      safeStr(pc.value) ||
      safeStr(pc.id);
    return v.trim();
  }
  return "";
}

function projectRef(project: any, projectIdFallback?: string | null) {
  const code = projectCodeLabel(project?.project_code);
  return code || safeStr(projectIdFallback).trim() || "";
}

function raidHref(project: any, projectIdFallback?: string | null) {
  const ref = projectRef(project, projectIdFallback);
  return ref ? `/projects/${encodeURIComponent(ref)}/raid` : null;
}

function isHighSeverity(r: any): boolean {
  const score = Number(r?.score ?? r?.severity_score ?? r?.ai_score ?? NaN);
  if (Number.isFinite(score)) return score >= 70;

  const sev = String(r?.severity ?? r?.impact ?? "").trim().toLowerCase();
  return sev === "high" || sev === "critical" || sev === "very high";
}

async function normalizeActiveIds(supabase: any, rawIds: string[]) {
  const failOpen = (reason: string) => ({
    ids: rawIds,
    ok: false,
    error: reason,
  });

  try {
    const r: any = await filterActiveProjectIds(supabase, rawIds);

    if (Array.isArray(r)) {
      const ids = r.filter(Boolean);
      if (!ids.length && rawIds.length) {
        return failOpen("active filter returned 0 ids; failing open");
      }
      return { ids, ok: true, error: null as string | null };
    }

    const ids = Array.isArray(r?.projectIds) ? r.projectIds.filter(Boolean) : [];
    if (!ids.length && rawIds.length) {
      return failOpen("active filter returned 0 ids; failing open");
    }

    return {
      ids,
      ok: !r?.error,
      error: r?.error ? safeStr(r.error?.message || r.error) : null,
    };
  } catch (e: any) {
    return failOpen(safeStr(e?.message || e || "active filter failed"));
  }
}

/* ---------------- GET ---------------- */

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const url = new URL(req.url);
    const days = clampDays(url.searchParams.get("days"));
    const since = sinceIso(days);

    // ✅ Auth first — userId required for org scope resolution.
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (authErr || !userId) return jsonErr("Not authenticated", 401);

    // ✅ Shared org-wide scope
    const scope = await resolvePortfolioScope(supabase, userId);
    const organisationId = scope.organisationId ?? null;
    const scopedRaw: string[] = Array.isArray(scope.rawProjectIds)
      ? scope.rawProjectIds
      : Array.isArray(scope.projectIds)
        ? scope.projectIds
        : [];
    const scopeMeta = scope.meta ?? {};

    // ✅ Active-only filter (normalized + fail-open)
    const active = await normalizeActiveIds(supabase, scopedRaw);
    const projectIds = active.ids;

    if (!projectIds.length) {
      return jsonOk({
        window_days: days,
        since,
        items: [],
        meta: {
          scope: "org",
          active_only: true,
          projectCount: 0,
          reason: "no_active_projects_in_org",
          organisationId,
          scopeMeta,
          active_filter_ok: active.ok,
          active_filter_error: active.error,
        },
      });
    }

    const { data: baseRows, error: baseErr } = await supabase
      .from("raid_items")
      .select(
        `
        id, project_id, title, type, status, severity, impact, probability, due_date, created_at, updated_at,
        projects:projects ( id, title, project_code )
      `,
      )
      .in("project_id", projectIds)
      .gte("updated_at", since)
      .not("status", "in", '("Closed","Invalid")')
      .order("updated_at", { ascending: false })
      .limit(300);

    if (baseErr) {
      return jsonOk({
        window_days: days,
        since,
        items: [],
        meta: {
          scope: "org",
          active_only: true,
          projectCount: projectIds.length,
          degraded: true,
          reason: "raid_query_failed",
          message: baseErr.message,
          organisationId,
          scopeMeta,
          active_filter_ok: active.ok,
          active_filter_error: active.error,
        },
      });
    }

    const all = baseRows ?? [];
    const ids = all.map((r: any) => r?.id).filter(Boolean);

    const scoreByItem = new Map<string, number>();
    if (ids.length) {
      const { data: scores } = await supabase
        .from("raid_item_scores")
        .select("raid_item_id, score, scored_at")
        .in("raid_item_id", ids)
        .order("scored_at", { ascending: false })
        .limit(Math.min(5000, ids.length * 5));

      for (const s of scores ?? []) {
        const id = String((s as any)?.raid_item_id || "");
        if (!id) continue;
        if (!scoreByItem.has(id)) scoreByItem.set(id, Number((s as any)?.score));
      }
    }

    const enriched = all.map((r: any) => {
      const score = scoreByItem.has(r.id) ? scoreByItem.get(r.id) : null;
      const proj = r?.projects || null;

      return {
        ...r,
        score,
        project_title: proj?.title ?? null,
        project_code: proj?.project_code ?? null,
        project_code_label: projectCodeLabel(proj?.project_code) || null,
        href: raidHref(proj, r?.project_id),
      };
    });

    const items = enriched.filter((r: any) => isHighSeverity(r));

    return jsonOk({
      window_days: days,
      since,
      items,
      meta: {
        scope: "org",
        active_only: true,
        organisationId,
        scopeMeta,
        projectCount: projectIds.length,
        total_raw: all.length,
        total_hi: items.length,
        active_filter_ok: active.ok,
        active_filter_error: active.error,
      },
    });
  } catch (e: any) {
    return jsonErr(String(e?.message ?? e), 500);
  }
}