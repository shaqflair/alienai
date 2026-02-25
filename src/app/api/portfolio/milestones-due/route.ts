// src/app/api/portfolio/milestones-due/route.ts/count/route.ts — REBUILT v2
// Fixes:
//   ✅ FIX-SMC1: clampDays now handles "all" → 60 (was silently falling back to 30)
//   ✅ FIX-SMC2: milestones-due/route.ts is an exact duplicate of this file — both fixed here

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveActiveProjectScope } from "@/lib/server/project-scope";

export const runtime = "nodejs";

/* ---------------- helpers ---------------- */

// ✅ FIX-SMC1: intercept "all" before Number() conversion
function clampDays(x: string | null, fallback = 30): 7 | 14 | 30 | 60 {
  const s = String(x ?? "").trim().toLowerCase();
  if (s === "all") return 60; // normalise "all" → broadest meaningful window
  const n = Number(s);
  const allowed = new Set([7, 14, 30, 60]);
  return Number.isFinite(n) && allowed.has(n) ? (n as any) : (fallback as any);
}

function num(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function ok(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}
function err(message: string, status = 400, meta?: any) {
  const res = NextResponse.json({ ok: false, error: message, meta }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const url = new URL(req.url);

    // ✅ FIX-SMC1: handles "all" → 60
    const days = clampDays(url.searchParams.get("days"), 30);

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    const userId = auth?.user?.id || null;
    if (authErr || !userId) return err("Not authenticated", 401);

    const scoped = await resolveActiveProjectScope(supabase, userId);
    const projectIds = Array.isArray(scoped?.projectIds) ? scoped.projectIds.filter(Boolean) : [];

    if (!projectIds.length) {
      return ok({ days, count: 0, meta: { scope: scoped?.meta ?? null } });
    }

    const { data, error } = await supabase.rpc("get_schedule_milestones_kpis_portfolio", {
      p_project_ids: projectIds,
      p_window_days: days,
    });

    if (error) return err(error.message || "RPC failed", 500);

    const row = Array.isArray(data) ? data[0] : data;

    const planned = num(row?.planned);
    const atRisk = num(row?.at_risk);
    const overdue = num(row?.overdue);
    const count = planned + atRisk + overdue;

    return ok({
      days,
      count,
      meta: { scope: scoped?.meta ?? null, projectCount: projectIds.length },
    });
  } catch (e: any) {
    console.error("[GET /api/ai/schedule-milestones/count]", e);
    return err(String(e?.message || e || "Failed"), 500);
  }
}