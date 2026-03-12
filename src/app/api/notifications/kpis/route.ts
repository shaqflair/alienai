// src/app/api/notifications/kpis/route.ts — REBUILT v3 (portfolio-scope + active-filter + no-store + debug-safe)
//
// Changes:
//   ✅ NK-F1: Shared portfolio scope first via resolvePortfolioScope
//   ✅ NK-F2: Membership fallback if portfolio scope yields none
//   ✅ NK-F3: Shared active exclusion via filterActiveProjectIds (closed/deleted/cancelled/archived etc.)
//   ✅ NK-F4: Cache-Control no-store on ALL responses (ok + err)
//   ✅ NK-F5: Scope rules preserved for NULL project_id rows
//            - if projectIds exist: (project_id IN ids) OR (project_id IS NULL)
//            - if none: NULL only
//   ✅ NK-F6: filterActiveProjectIds remains fail-open
//
// Notes:
// - This route counts notifications for the authenticated user only.
// - It intentionally does NOT “hydrate” project_id; many notifications may be NULL.

import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveActiveProjectScope, filterActiveProjectIds } from "@/lib/server/project-scope";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- helpers ---------------- */

function noStore(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
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

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
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

function clampDays(x: string | null, fallback = 14): 7 | 14 | 30 | 60 {
  const n = Number(x);
  const allowed = new Set([7, 14, 30, 60]);
  return Number.isFinite(n) && allowed.has(n) ? (n as any) : (fallback as any);
}

/**
 * Debug toggle:
 * - Non-prod: ?debug=1 works
 * - Prod: requires ALLOW_DEBUG_ROUTES=1 and x-aliena-debug-secret === DEBUG_ROUTE_SECRET
 */
function debugEnabled(req: Request) {
  const url = new URL(req.url);
  const wants = safeStr(url.searchParams.get("debug")).trim() === "1";
  if (!wants) return false;

  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) return true;

  const allowProdDebug = safeStr(process.env.ALLOW_DEBUG_ROUTES).trim() === "1";
  if (!allowProdDebug) return false;

  const expected = safeStr(process.env.DEBUG_ROUTE_SECRET).trim();
  const got = safeStr(req.headers.get("x-aliena-debug-secret")).trim();
  return Boolean(expected) && got === expected;
}

function daysAgoIso(days: number) {
  const ms = Math.max(0, days) * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
}

/**
 * Apply scope safely.
 *
 * IMPORTANT:
 * - KPIs route does NOT hydrate; many rows may have project_id NULL.
 * - To keep KPIs consistent with list:
 *   - If projectIds exist: include (project_id IN projectIds) OR (project_id IS NULL)
 *   - If none: keep NULL only (stable and safe)
 */
function applyScope(q: any, projectIds: string[]) {
  const ids = uniqStrings(projectIds);
  if (!ids.length) return q.is("project_id", null);
  return q.or(`project_id.in.(${ids.join(",")}),project_id.is.null`);
}

/** Apply time window if present */
function applyWindow(q: any, sinceIso: string) {
  return q.gte("created_at", sinceIso);
}

async function countExact(q: any) {
  const { count, error } = await q;
  if (error) throw error;
  return Number(count ?? 0);
}

async function countWithLabel(label: string, q: any, debugOn: boolean) {
  try {
    const n = await countExact(q);
    return { label, ok: true as const, count: n };
  } catch (e: any) {
    if (!debugOn) throw e;
    return {
      label,
      ok: false as const,
      count: 0,
      error: String(e?.message || e),
      hint: e?.hint ?? null,
      details: e?.details ?? null,
      code: e?.code ?? null,
    };
  }
}

/* ---------------- handler ---------------- */

export async function GET(req: Request) {
  const debugOn = debugEnabled(req);

  try {
    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    const userId = auth?.user?.id || null;
    if (authErr || !userId) {
      return err("Unauthorized", 401);
    }

    const url = new URL(req.url);
    const days = clampDays(url.searchParams.get("days"), 14);
    const sinceIso = daysAgoIso(days);

    // Shared portfolio scope first, then membership fallback
    let scoped: any = null;
    let scopedIdsRaw: string[] = [];

    try {
      scoped = await resolvePortfolioScope(supabase, userId);
      scopedIdsRaw = uniqStrings(scoped?.projectIds || []);
    } catch (e: any) {
      scoped = {
        ok: false,
        error: String(e?.message || e || "portfolio scope failed"),
        meta: null,
        projectIds: [],
      };
      scopedIdsRaw = [];
    }

    if (!scopedIdsRaw.length) {
      const fallback = await resolveActiveProjectScope(supabase);
      scoped = fallback;
      scopedIdsRaw = uniqStrings(fallback?.projectIds || []);
    }

    // Shared active exclusion list with fail-open preserved
    let activeProjectIds = uniqStrings(scopedIdsRaw);
    let activeFilterMeta: any = {
      before: scopedIdsRaw.length,
      after: scopedIdsRaw.length,
      fail_open: false,
    };

    try {
      const filtered = await filterActiveProjectIds(supabase, scopedIdsRaw);
      const filteredIds = uniqStrings(
        Array.isArray(filtered) ? filtered : (filtered as any)?.projectIds ?? [],
      );

      if (filteredIds.length > 0) {
        activeProjectIds = filteredIds;
        activeFilterMeta = {
          before: scopedIdsRaw.length,
          after: filteredIds.length,
          fail_open: false,
        };
      } else {
        activeProjectIds = uniqStrings(scopedIdsRaw);
        activeFilterMeta = {
          before: scopedIdsRaw.length,
          after: scopedIdsRaw.length,
          fail_open: true,
          reason: "filterActiveProjectIds returned 0 rows",
        };
      }
    } catch (e: any) {
      activeProjectIds = uniqStrings(scopedIdsRaw);
      activeFilterMeta = {
        before: scopedIdsRaw.length,
        after: scopedIdsRaw.length,
        fail_open: true,
        reason: String(e?.message || e),
      };
    }

    const base = () =>
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);

    // Build each KPI query (window + scope applied consistently)
    const qTotal = applyScope(applyWindow(base(), sinceIso), activeProjectIds);
    const qUnread = applyScope(applyWindow(base().eq("is_read", false), sinceIso), activeProjectIds);

    const qOverdueUnread = applyScope(
      applyWindow(base().eq("is_read", false).eq("bucket", "overdue"), sinceIso),
      activeProjectIds,
    );

    const qDueSoonUnread = applyScope(
      applyWindow(base().eq("is_read", false).eq("bucket", "due_soon"), sinceIso),
      activeProjectIds,
    );

    const qApprovalsUnread = applyScope(
      applyWindow(base().eq("is_read", false).ilike("type", "%approval%"), sinceIso),
      activeProjectIds,
    );

    const qAiUnread = applyScope(
      applyWindow(base().eq("is_read", false).or("type.ilike.%ai%,type.ilike.%slip%"), sinceIso),
      activeProjectIds,
    );

    const qRisksIssuesUnread = applyScope(
      applyWindow(base().eq("is_read", false).or("type.ilike.%risk%,type.ilike.%issue%"), sinceIso),
      activeProjectIds,
    );

    const results = await Promise.all([
      countWithLabel("total", qTotal, debugOn),
      countWithLabel("unread", qUnread, debugOn),
      countWithLabel("overdueUnread", qOverdueUnread, debugOn),
      countWithLabel("dueSoonUnread", qDueSoonUnread, debugOn),
      countWithLabel("approvalsUnread", qApprovalsUnread, debugOn),
      countWithLabel("aiUnread", qAiUnread, debugOn),
      countWithLabel("risksIssuesUnread", qRisksIssuesUnread, debugOn),
    ]);

    if (!debugOn) {
      const failed = results.find((r) => !r.ok);
      if (failed && !failed.ok) throw new Error("Query failed");
    }

    const map = new Map(results.map((r) => [r.label, r.count]));
    const payload: any = {
      days,
      kpis: {
        total: map.get("total") ?? 0,
        unread: map.get("unread") ?? 0,
        overdueUnread: map.get("overdueUnread") ?? 0,
        dueSoonUnread: map.get("dueSoonUnread") ?? 0,
        approvalsUnread: map.get("approvalsUnread") ?? 0,
        aiUnread: map.get("aiUnread") ?? 0,
        risksIssuesUnread: map.get("risksIssuesUnread") ?? 0,
      },
    };

    if (debugOn) {
      payload.meta = {
        debug: true,
        userId,
        sinceIso,
        scopedIds: scopedIdsRaw.length,
        activeIds: activeProjectIds.length,
        projectIds: activeProjectIds.slice(0, 25),
        scopeMeta: scoped?.meta ?? null,
        activeFilterMeta,
        perQuery: results,
      };
    }

    return ok(payload);
  } catch (e: any) {
    console.error("[notifications/kpis] failed:", e);

    if (debugOn) {
      return err("Failed", 500, {
        message: String(e?.message || e),
        hint: e?.hint ?? null,
        details: e?.details ?? null,
        code: e?.code ?? null,
      });
    }

    return err("Failed", 500);
  }
}