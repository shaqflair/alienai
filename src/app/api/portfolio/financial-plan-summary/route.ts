import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

// GET /api/portfolio/financial-plan-summary
// Returns aggregated financial plan summaries across all projects
// the authenticated user has access to. Used by the What-if Simulator
// to show portfolio-level financial impact.

export async function GET() {
  const supabase = await createClient();

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1. Get all active projects the user is a member of
  const { data: memberships, error: memErr } = await supabase
    .from("project_members")
    .select("project_id, role")
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (memErr) {
    return NextResponse.json({ error: memErr.message }, { status: 500 });
  }

  if (!memberships?.length) {
    return NextResponse.json({ projects: [] });
  }

  const projectIds = memberships.map((m: any) => m.project_id);

  // 2. Fetch project details
  const { data: projects, error: projErr } = await supabase
    .from("projects")
    .select("id, title, project_code, colour, start_date, finish_date, resource_status")
    .in("id", projectIds)
    .order("title", { ascending: true });

  if (projErr) {
    return NextResponse.json({ error: projErr.message }, { status: 500 });
  }

  // 3. Fetch financial plan artifacts for all projects in one query
  const { data: artifacts, error: artErr } = await supabase
    .from("artifacts")
    .select("id, project_id, content, updated_at")
    .in("project_id", projectIds)
    .eq("type", "financial_plan")
    .order("updated_at", { ascending: false });

  if (artErr) {
    return NextResponse.json({ error: artErr.message }, { status: 500 });
  }

  // 4. Build a map: project_id → most recent financial plan artifact
  const planByProject = new Map<string, any>();
  for (const artifact of artifacts ?? []) {
    if (!planByProject.has(artifact.project_id)) {
      planByProject.set(artifact.project_id, artifact);
    }
  }

  // 5. Aggregate summaries per project
  const summaries = (projects ?? []).map((project: any) => {
    const artifact = planByProject.get(project.id);
    const content = artifact?.content ?? null;

    let totalBudget = 0;
    let totalForecast = 0;
    let totalActual = 0;
    let hasFinancialPlan = false;

    if (content?.costLines && Array.isArray(content.costLines)) {
      hasFinancialPlan = true;

      for (const line of content.costLines) {
        totalBudget   += Number(line.budget   ?? 0);
        totalForecast += Number(line.forecast  ?? 0);
        totalActual   += Number(line.actual    ?? 0);
      }
    }

    // Monthly breakdown from monthlyData if present
    const monthlyData = content?.monthlyData ?? {};
    const monthlyBreakdown: Record<string, { budget: number; forecast: number; actual: number }> = {};

    for (const [lineId, months] of Object.entries(monthlyData) as any) {
      for (const [monthKey, vals] of Object.entries(months as any)) {
        const v = vals as any;
        if (!monthlyBreakdown[monthKey]) {
          monthlyBreakdown[monthKey] = { budget: 0, forecast: 0, actual: 0 };
        }
        monthlyBreakdown[monthKey].budget   += Number(v.budget   ?? 0);
        monthlyBreakdown[monthKey].forecast += Number(v.forecast ?? 0);
        monthlyBreakdown[monthKey].actual   += Number(v.actual   ?? 0);
      }
    }

    const role = memberships.find((m: any) => m.project_id === project.id)?.role ?? "viewer";

    return {
      projectId:     project.id,
      projectCode:   project.project_code ?? null,
      title:         project.title,
      colour:        project.colour ?? "#00b8db",
      status:        project.resource_status ?? "confirmed",
      startDate:     project.start_date ?? null,
      finishDate:    project.finish_date ?? null,
      role,
      hasFinancialPlan,
      artifactId:    artifact?.id ?? null,
      lastUpdated:   artifact?.updated_at ?? null,
      totals: {
        budget:   totalBudget,
        forecast: totalForecast,
        actual:   totalActual,
        variance: totalForecast - totalBudget,
        burnPct:  totalBudget > 0 ? Math.round((totalActual / totalBudget) * 100) : 0,
      },
      monthlyBreakdown,
    };
  });

  // 6. Portfolio-level rollup
  const portfolio = {
    totalBudget:   summaries.reduce((s: number, p: any) => s + p.totals.budget, 0),
    totalForecast: summaries.reduce((s: number, p: any) => s + p.totals.forecast, 0),
    totalActual:   summaries.reduce((s: number, p: any) => s + p.totals.actual, 0),
    projectCount:  summaries.length,
    withPlanCount: summaries.filter((p: any) => p.hasFinancialPlan).length,
  };

  return NextResponse.json({
    portfolio,
    projects: summaries,
  });
}
