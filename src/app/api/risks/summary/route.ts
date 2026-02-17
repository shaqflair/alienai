// src/app/api/portfolio/risk-counts/route.ts
import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveActiveProjectScope } from "@/lib/server/project-scope";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();

  // ✅ auth
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (authErr || !userId) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  // ✅ ACTIVE + accessible projects (membership + not deleted/closed)
  const scoped = await resolveActiveProjectScope(supabase, userId);
  const ids = scoped.projectIds;

  if (!ids.length) {
    return NextResponse.json({
      ok: true,
      openRisks: 0,
      highRisks: 0,
      meta: { project_count: 0, active_only: true, scope: scoped.meta },
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
    meta: { project_count: ids.length, active_only: true, scope: scoped.meta },
  });
}

