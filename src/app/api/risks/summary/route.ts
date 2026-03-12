// src/app/api/risks/summary/route.ts
// ✅ Portfolio-scoped: all org members see portfolio-wide risk counts.
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveActiveProjectScope } from "@/lib/server/project-scope";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";

export const runtime = "nodejs";

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

export async function GET() {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (authErr || !userId) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  // Shared portfolio scope first, membership fallback if empty / failed
  let scoped: any = null;
  let ids: string[] = [];

  try {
    scoped = await resolvePortfolioScope(supabase, userId);
    ids = uniqStrings(scoped?.projectIds || []);
  } catch (e: any) {
    scoped = { ok: false, error: String(e?.message || e), projectIds: [], meta: null };
    ids = [];
  }

  if (!ids.length) {
    const fallback = await resolveActiveProjectScope(supabase);
    scoped = fallback;
    ids = uniqStrings(fallback?.projectIds || []);
  }

  if (!ids.length) {
    return NextResponse.json({
      ok: true,
      openRisks: 0,
      highRisks: 0,
      meta: {
        projectCount: 0,
        scope: "portfolio",
        active_only: true,
        scopeMeta: scoped?.meta ?? null,
      },
    });
  }

  const { data, error } = await supabase.rpc("get_portfolio_risk_counts", {
    p_project_ids: ids,
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    openRisks: Number((data as any)?.open_risks ?? 0),
    highRisks: Number((data as any)?.high_risks ?? 0),
    meta: {
      projectCount: ids.length,
      scope: "portfolio",
      active_only: true,
      scopeMeta: scoped?.meta ?? null,
    },
  });
}