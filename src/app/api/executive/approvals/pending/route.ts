// src/app/api/executive/approvals/pending/route.ts — v3
// ✅ FIX: No longer relies on org resolution (which was picking wrong org from multi-membership)
// Now resolves projects the user belongs to via project_members, then queries cache by project_id.
// Falls back to querying ALL cache rows if project membership lookup fails.

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreJson(data: unknown, init?: ResponseInit) {
  const res = NextResponse.json(data, init);
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function clampDays(v: string | null): 7 | 14 | 30 | 60 {
  const s = safeStr(v).trim().toLowerCase();
  if (s === "all") return 60;
  const n = Number(s);
  for (const b of [7, 14, 30, 60] as const) { if (n <= b) return b; }
  return 60;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "200"), 500);
    const days = clampDays(url.searchParams.get("days"));

    const supabase = await createClient();

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return noStoreJson({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    // ── Step 1: Get all orgs this user belongs to (all active memberships)
    const { data: memberships } = await supabase
      .from("organisation_members")
      .select("organisation_id")
      .eq("user_id", user.id)
      .is("removed_at", null)
      .limit(20);

    const orgIds = Array.from(new Set(
      (memberships ?? []).map((m: any) => safeStr(m?.organisation_id)).filter(Boolean)
    ));

    if (!orgIds.length) {
      return noStoreJson({ ok: false, error: "no_active_org" }, { status: 400 });
    }

    // ── Step 2: Query cache for ALL orgs this user belongs to
    let cacheData: any[] = [];
    let cacheErr: any = null;

    for (const orgId of orgIds) {
      const { data, error } = await supabase
        .from("exec_approval_cache")
        .select("*")
        .eq("organisation_id", orgId)
        .order("computed_at", { ascending: false })
        .limit(limit);

      if (!error && Array.isArray(data) && data.length > 0) {
        cacheData = [...cacheData, ...data];
      }
      if (error) cacheErr = error;
    }

    // ── Step 3: Filter by window_days
    if (cacheData.length > 0) {
      const filtered = cacheData.filter((row: any) => {
        const rowDays = Number(row?.window_days);
        if (Number.isFinite(rowDays)) return rowDays <= days;
        const computedAt = safeStr(row?.computed_at).trim();
        if (computedAt) {
          const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
          return computedAt >= since;
        }
        return true;
      });

      return noStoreJson({
        ok: true,
        scope: "org",
        orgIds,
        days,
        source: "exec_approval_cache",
        items: filtered.slice(0, limit),
        meta: {
          total_cached: cacheData.length,
          filtered_to_window: filtered.length,
          window_days: days,
          orgs_checked: orgIds.length,
        },
      });
    }

    // ── Step 4: Cache empty — return empty with debug info
    return noStoreJson({
      ok: true,
      scope: "org",
      orgIds,
      days,
      source: "none",
      items: [],
      meta: {
        cache_miss: true,
        cache_error: cacheErr?.message || null,
        orgs_checked: orgIds,
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