// src/app/api/executive/approvals/pending/route.ts — REBUILT v2
// Fixes:
//   ✅ FIX-AP1: `days` query param now read and passed into cache query
//              was: always returned full org cache regardless of ?days=
//              now: filters exec_approval_cache WHERE window_days <= days (or nearest bucket)
//              GovernanceIntelligence `days` prop wiring now actually works end-to-end
//   ✅ FIX-AP2: Org resolution uses organisation_members (robust) instead of profiles.active_organisation_id
//              profiles.active_organisation_id can be stale/null → silent 400
//              now: same membership query pattern used by every other route
//   ✅ FIX-AP3: Falls back gracefully when exec_approval_cache is missing / empty
//              instead of 500, returns ok:true with empty items + meta.source='direct'
//              by querying approval_steps directly in that case
//   ✅ FIX-AP4: `limit` param honoured but capped at 500 (was 500, unchanged — kept consistent)

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- helpers ---------------- */

function noStoreJson(data: unknown, init?: ResponseInit) {
  const res = NextResponse.json(data, init);
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function looksMissingRelation(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("relation") || msg.includes("42p01");
}

// ✅ FIX-AP1: Normalise days param to nearest allowed bucket (same convention as all other routes)
// "all" → 60 (executive context: treat as broadest meaningful window)
function clampDays(v: string | null): 7 | 14 | 30 | 60 {
  const s = safeStr(v).trim().toLowerCase();
  if (s === "all") return 60;
  const n = Number(s);
  const allowed: Array<7 | 14 | 30 | 60> = [7, 14, 30, 60];
  // snap to nearest bucket
  for (const b of allowed) { if (n <= b) return b; }
  return 60;
}

// ✅ FIX-AP2: Robust org resolution via organisation_members (not profiles.active_organisation_id)
async function resolveOrgId(supabase: any, userId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("organisation_members")
      .select("organisation_id")
      .eq("user_id", userId)
      .is("removed_at", null)
      .order("created_at", { ascending: true })
      .limit(5);

    if (error) return null;

    const row = (Array.isArray(data) ? data : [])[0];
    const id = safeStr(row?.organisation_id).trim();
    return id || null;
  } catch {
    return null;
  }
}

// ✅ FIX-AP3: Direct fallback — query approval_steps when cache is empty/missing
async function fetchDirectPending(supabase: any, orgId: string, days: number, limit: number) {
  try {
    // Get projects for this org
    const { data: projects, error: projErr } = await supabase
      .from("projects")
      .select("id")
      .eq("organisation_id", orgId)
      .is("deleted_at", null)
      .limit(5000);

    if (projErr || !projects?.length) return { ok: false, items: [] };

    const projectIds = (projects || []).map((p: any) => safeStr(p?.id)).filter(Boolean);

    const since = days < 60
      ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
      : undefined;

    let q = supabase
      .from("approval_steps")
      .select("id, project_id, status, decided_at, created_at, approver_user_id, approval_role, step_name")
      .in("project_id", projectIds)
      .is("decided_at", null)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (since) q = q.gte("created_at", since);

    const { data, error } = await q;
    if (error) {
      if (looksMissingRelation(error)) return { ok: false, items: [] };
      return { ok: false, items: [] };
    }

    const pending = (data || []).filter((r: any) => {
      const s = safeStr(r?.status).trim().toLowerCase();
      return s === "" || s === "pending" || s === "open";
    });

    return { ok: true, items: pending };
  } catch {
    return { ok: false, items: [] };
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "200"), 500);

    // ✅ FIX-AP1: read and normalise days param
    const days = clampDays(url.searchParams.get("days"));

    const supabase = await createClient();

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return noStoreJson({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    // ✅ FIX-AP2: robust org resolution
    const orgId = await resolveOrgId(supabase, user.id);
    if (!orgId) {
      return noStoreJson({ ok: false, error: "no_active_org" }, { status: 400 });
    }

    // ✅ FIX-AP1: try cache first, filter by days window
    const { data: cacheData, error: cacheErr } = await supabase
      .from("exec_approval_cache")
      .select("*")
      .eq("organisation_id", orgId)
      .order("computed_at", { ascending: false })
      .limit(limit);

    // Cache available and non-empty
    if (!cacheErr && Array.isArray(cacheData) && cacheData.length > 0) {
      // ✅ FIX-AP1: filter cache rows to the requested days window
      // Cache rows should have a computed_at or window_days field.
      // If window_days exists, keep rows where window_days <= days.
      // If only computed_at, filter by age.
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const filtered = cacheData.filter((row: any) => {
        // If row has window_days, use it as the primary filter
        const rowDays = Number(row?.window_days);
        if (Number.isFinite(rowDays)) return rowDays <= days;
        // Fallback: filter by computed_at age
        const computedAt = safeStr(row?.computed_at).trim();
        if (computedAt) return computedAt >= since;
        return true; // include if no timestamp info
      });

      return noStoreJson({
        ok: true,
        scope: "org",
        orgId,
        days,
        source: "exec_approval_cache",
        items: filtered,
        meta: {
          total_cached: cacheData.length,
          filtered_to_window: filtered.length,
          window_days: days,
        },
      });
    }

    // ✅ FIX-AP3: Cache empty or missing — fall back to direct approval_steps query
    const direct = await fetchDirectPending(supabase, orgId, days, limit);

    return noStoreJson({
      ok: true,
      scope: "org",
      orgId,
      days,
      source: direct.ok ? "approval_steps_direct" : "none",
      items: direct.items ?? [],
      meta: {
        cache_miss: true,
        cache_error: cacheErr?.message || null,
        direct_ok: direct.ok,
        window_days: days,
      },
    });

  } catch (e: any) {
    return noStoreJson(
      { ok: false, error: "pending_approvals_failed", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}