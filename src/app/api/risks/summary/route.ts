// src/app/api/risks/summary/route.ts
// ✅ Org-scoped: all org members see portfolio-wide risk counts.
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveOrgActiveProjectScope } from "@/lib/server/project-scope";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (authErr || !userId) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  // ✅ Org-wide scope
  const scoped = await resolveOrgActiveProjectScope(supabase, userId);
  const ids = scoped.projectIds;

  if (!ids.length) {
    return NextResponse.json({
      ok: true, openRisks: 0, highRisks: 0,
      meta: { projectCount: 0, scope: "org", active_only: true },
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
    meta: { projectCount: ids.length, scope: "org", active_only: true },
  });
}