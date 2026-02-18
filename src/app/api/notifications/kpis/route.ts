// src/app/api/notifications/kpis/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveActiveProjectScope } from "@/lib/server/project-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- helpers ---------------- */

function ok(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function err(message: string, status = 400, meta?: any) {
  const res = NextResponse.json({ ok: false, error: message, ...(meta ? { meta } : {}) }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function clampDays(x: string | null, fallback = 14): 7 | 14 | 30 | 60 {
  const n = Number(x);
  const allowed = new Set([7, 14, 30, 60]);
  return Number.isFinite(n) && allowed.has(n) ? (n as any) : (fallback as any);
}

function isDebug(req: Request) {
  const url = new URL(req.url);
  return safeStr(url.searchParams.get("debug")).trim() === "1";
}

function daysAgoIso(days: number) {
  const ms = Math.max(0, days) * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
}

/**
 * Apply scope safely.
 *
 * IMPORTANT:
 * - Your LIST route can “hydrate” project_id using artifact_id ? artifacts.project_id.
 * - KPIs route does NOT hydrate; therefore many rows may have project_id NULL.
 *
 * To keep KPIs consistent with the list:
 * - If projectIds exist: include (project_id IN projectIds) OR (project_id IS NULL)
 * - If none: keep NULL only (stable and safe)
 */
function applyScope(q: any, projectIds: string[]) {
  if (!projectIds.length) return q.is("project_id", null);
  const ids = projectIds.filter(Boolean).join(",");
  // supabase/postgrest OR syntax: "a.in.(..),a.is.null"
  return q.or(`project_id.in.(${ids}),project_id.is.null`);
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
  const debugOn = isDebug(req);

  try {
    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    const userId = auth?.user?.id || null;
    if (authErr || !userId) {
      return err("Unauthorized", 401, { authErr: authErr?.message ?? null });
    }

    const url = new URL(req.url);
    const days = clampDays(url.searchParams.get("days"), 14);
    const sinceIso = daysAgoIso(days);

    const scoped = await resolveActiveProjectScope(supabase, userId);
    const projectIds = Array.isArray(scoped?.projectIds) ? scoped.projectIds.filter(Boolean) : [];

    const base = () =>
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);

    // Build each KPI query (window + scope applied consistently)
    const qTotal = applyScope(applyWindow(base(), sinceIso), projectIds);

    const qUnread = applyScope(applyWindow(base().eq("is_read", false), sinceIso), projectIds);

    // ? Use bucket ONLY (matches your generator; avoids fragile OR syntax)
    const qOverdueUnread = applyScope(
      applyWindow(base().eq("is_read", false).eq("bucket", "overdue"), sinceIso),
      projectIds
    );

    const qDueSoonUnread = applyScope(
      applyWindow(base().eq("is_read", false).eq("bucket", "due_soon"), sinceIso),
      projectIds
    );

    const qApprovalsUnread = applyScope(
      applyWindow(base().eq("is_read", false).ilike("type", "%approval%"), sinceIso),
      projectIds
    );

    const qAiUnread = applyScope(
      applyWindow(base().eq("is_read", false).or("type.ilike.%ai%,type.ilike.%slip%"), sinceIso),
      projectIds
    );

    const qRisksIssuesUnread = applyScope(
      applyWindow(base().eq("is_read", false).or("type.ilike.%risk%,type.ilike.%issue%"), sinceIso),
      projectIds
    );

    // Execute with labelled debug (so we can see exactly what fails)
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
      if (failed && !failed.ok) throw new Error(failed.error || "Query failed");
    }

    const map = new Map(results.map((r) => [r.label, r.count]));
    const payload = {
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
      ...(debugOn
        ? {
            meta: {
              userId,
              sinceIso,
              projectCount: projectIds.length,
              projectIds: projectIds.slice(0, 25),
              scopeMeta: scoped?.meta ?? null,
              perQuery: results,
            },
          }
        : {}),
    };

    return ok(payload);
  } catch (e: any) {
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
