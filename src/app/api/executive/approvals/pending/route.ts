// src/app/api/executive/approvals/pending/route.ts — v4
// ✅ Queries exec_approval_cache for ALL orgs the user belongs to, merges + filters to window
// ✅ Safer: no select("*"), explicit columns, consistent error handling

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
  for (const b of [7, 14, 30, 60] as const) {
    if (Number.isFinite(n) && n <= b) return b;
  }
  return 60;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "200"), 1), 500);
    const days = clampDays(url.searchParams.get("days"));

    const supabase = await createClient();

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) {
      return noStoreJson({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const { data: memberships, error: memErr } = await supabase
      .from("organisation_members")
      .select("organisation_id")
      .eq("user_id", user.id)
      .is("removed_at", null)
      .limit(50);

    if (memErr) {
      return noStoreJson({ ok: false, error: memErr.message }, { status: 500 });
    }

    const orgIds = Array.from(
      new Set((memberships ?? []).map((m: any) => safeStr(m?.organisation_id)).filter(Boolean))
    );

    if (!orgIds.length) {
      return noStoreJson({ ok: false, error: "no_active_org" }, { status: 400 });
    }

    const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    let cacheData: any[] = [];
    const errors: { organisation_id: string; error: string }[] = [];

    for (const orgId of orgIds) {
      const { data, error } = await supabase
        .from("exec_approval_cache")
        .select(
          "organisation_id, project_id, project_title, project_code, sla_status, approver_label, window_days, computed_at"
        )
        .eq("organisation_id", orgId)
        .order("computed_at", { ascending: false })
        .limit(limit);

      if (error) {
        errors.push({ organisation_id: orgId, error: error.message });
        continue;
      }
      if (Array.isArray(data) && data.length) {
        cacheData.push(...data);
      }
    }

    if (!cacheData.length) {
      return noStoreJson({
        ok: true,
        scope: "org",
        orgIds,
        days,
        source: "none",
        items: [],
        meta: {
          cache_miss: true,
          orgs_checked: orgIds.length,
          window_days: days,
          errors,
        },
      });
    }

    // Filter to requested window. Prefer window_days if present; else compare computed_at.
    const filtered = cacheData.filter((row: any) => {
      const rowDays = Number(row?.window_days);
      if (Number.isFinite(rowDays)) return rowDays <= days;

      const computedAt = safeStr(row?.computed_at).trim();
      if (computedAt) return computedAt >= sinceIso;

      return true;
    });

    // De-dupe: keep newest per (project_id + approver_label + sla_status) to avoid spammy repeats
    const key = (r: any) =>
      `${safeStr(r?.project_id)}|${safeStr(r?.approver_label)}|${safeStr(r?.sla_status)}`;
    const best = new Map<string, any>();
    for (const r of filtered) {
      const k = key(r);
      const prev = best.get(k);
      if (!prev) best.set(k, r);
      else {
        const a = safeStr(prev?.computed_at);
        const b = safeStr(r?.computed_at);
        if (b && (!a || b > a)) best.set(k, r);
      }
    }

    const out = Array.from(best.values()).slice(0, limit);

    return noStoreJson({
      ok: true,
      scope: "org",
      orgIds,
      days,
      source: "exec_approval_cache",
      items: out,
      meta: {
        total_cached: cacheData.length,
        filtered_to_window: filtered.length,
        deduped: out.length,
        window_days: days,
        orgs_checked: orgIds.length,
        errors,
      },
    });
  } catch (e: any) {
    return noStoreJson(
      { ok: false, error: "pending_approvals_failed", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}