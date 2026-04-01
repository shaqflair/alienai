// GET /api/portfolio/budget-phasing?fy=2025&fyStart=4&scope=active|all
//
// Returns per-project monthly phasing (forecast, actual, budget) for the
// requested financial year across all (or active-only) projects.

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

function err(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function safeNum(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeStr(v: any): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

// Build ordered list of months for a financial year
// fyStart: 1=Jan, 4=Apr, 7=Jul, 10=Oct
// fyYear: the year the FY starts in
function buildFyMonths(fyStart: number, fyYear: number): { year: number; month: number; label: string }[] {
  const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const months = [];
  for (let i = 0; i < 12; i++) {
    const month = ((fyStart - 1 + i) % 12) + 1; // 1-12
    const year = fyYear + Math.floor((fyStart - 1 + i) / 12);
    months.push({ year, month, label: `${MONTH_NAMES[month - 1]} ${String(year).slice(2)}` });
  }
  return months;
}

// Map a "YYYY-MM" key to its column index in the FY months array
function buildMonthIndex(fyMonths: ReturnType<typeof buildFyMonths>): Map<string, number> {
  const map = new Map<string, number>();
  fyMonths.forEach(({ year, month }, i) => {
    map.set(`${year}-${String(month).padStart(2, "0")}`, i);
  });
  return map;
}

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return err("Unauthorized", 401);

    const url = new URL(req.url);

    // FY configuration
    const fyStart = Math.max(1, Math.min(12, parseInt(url.searchParams.get("fyStart") ?? "4", 10)));
    const nowYear = new Date().getFullYear();
    const nowMonth = new Date().getMonth() + 1;
    const defaultFyYear = nowMonth >= fyStart ? nowYear : nowYear - 1;
    const fyYear = parseInt(url.searchParams.get("fy") ?? String(defaultFyYear), 10);
    const scope = url.searchParams.get("scope") ?? "active"; // "active" | "all"

    const fyMonths = buildFyMonths(fyStart, fyYear);
    const monthIndex = buildMonthIndex(fyMonths);

    const fyStart_date = `${fyYear}-${String(fyStart).padStart(2, "0")}-01`;
    const fyEnd_month = ((fyStart - 2 + 12) % 12) + 1;
    const fyEnd_year = fyYear + 1;
    const fyEnd_date = `${fyEnd_year}-${String(fyEnd_month).padStart(2, "0")}-${new Date(fyEnd_year, fyEnd_month, 0).getDate()}`;

    // 1. Resolve organisation
    const { data: orgMem } = await supabase
      .from("organisation_members")
      .select("organisation_id")
      .eq("user_id", auth.user.id)
      .is("removed_at", null)
      .limit(1)
      .maybeSingle();

    const orgId = safeStr((orgMem as any)?.organisation_id);
    if (!orgId) return err("No organisation found", 404);

    // 2. Fetch projects
    let projectQuery = supabase
      .from("projects")
      .select("id, title, project_code, budget_amount, resource_status, deleted_at")
      .eq("organisation_id", orgId)
      .neq("resource_status", "pipeline");

    if (scope === "active") {
      projectQuery = projectQuery.is("deleted_at", null);
    }

    const { data: projectRows, error: projErr } = await projectQuery.order("title");
    if (projErr) return err(projErr.message, 500);

    const projects = (projectRows ?? []) as any[];
    if (!projects.length) {
      return NextResponse.json({ ok: true, fyYear, fyStart, fyMonths, projects: [], totals: buildEmptyTotals(fyMonths) });
    }

    const projectIds = projects.map((p: any) => p.id);

    // 3. Fetch financial plan artifacts (one per project — latest approved or current)
    const { data: artifactRows } = await supabase
      .from("artifacts")
      .select("id, project_id, content_json, approval_status, is_current")
      .in("project_id", projectIds)
      .eq("type", "financial_plan")
      .eq("is_current", true)
      .order("approved_at", { ascending: false });

    // Deduplicate: one artifact per project (prefer approved)
    const artifactByProject = new Map<string, any>();
    for (const a of (artifactRows ?? []) as any[]) {
      const pid = safeStr(a.project_id);
      if (!artifactByProject.has(pid)) {
        artifactByProject.set(pid, a);
      } else if (a.approval_status === "approved") {
        artifactByProject.set(pid, a);
      }
    }

    // 4. Fetch actual spend from project_spend table
    const { data: spendRows } = await supabase
      .from("project_spend")
      .select("project_id, amount, spend_date, category")
      .in("project_id", projectIds)
      .gte("spend_date", fyStart_date)
      .lte("spend_date", fyEnd_date);

    // Group actuals by project → month key → amount
    const actualsByProject = new Map<string, Map<string, number>>();
    for (const row of (spendRows ?? []) as any[]) {
      const pid = safeStr(row.project_id);
      const dateStr = safeStr(row.spend_date).slice(0, 7); // "YYYY-MM"
      const amount = safeNum(row.amount);
      if (!actualsByProject.has(pid)) actualsByProject.set(pid, new Map());
      const m = actualsByProject.get(pid)!;
      m.set(dateStr, (m.get(dateStr) ?? 0) + amount);
    }

    // 5. Process each project
    const projectData = projects.map((proj: any) => {
      const artifact = artifactByProject.get(proj.id);
      const budget = safeNum(proj.budget_amount);

      // Monthly budget = total budget / 12 (flat line)
      const monthlyBudget = budget / 12;

      // Init empty arrays
      const forecast = new Array(12).fill(0);
      const actual = new Array(12).fill(0);
      const budgetArr = new Array(12).fill(monthlyBudget);

      // Extract forecast from financial plan content_json
      if (artifact?.content_json) {
        const cj = artifact.content_json;
        const lines: any[] = Array.isArray(cj.lines) ? cj.lines : [];
        const monthlyData: Record<string, Record<string, any>> = cj.monthlyData ?? cj.monthly_data ?? {};

        for (const line of lines) {
          const lineId = safeStr(line.id);
          const lineMonthly = monthlyData[lineId] ?? {};
          for (const [monthKey, entry] of Object.entries(lineMonthly)) {
            const idx = monthIndex.get(monthKey);
            if (idx === undefined) continue;
            const fc = safeNum((entry as any)?.forecast ?? (entry as any)?.forecastAmount ?? 0);
            forecast[idx] += fc;
          }
        }
      }

      // Fill actuals from spend table
      const projectActuals = actualsByProject.get(proj.id) ?? new Map<string, number>();
      for (const [monthKey, amount] of projectActuals) {
        const idx = monthIndex.get(monthKey);
        if (idx !== undefined) actual[idx] = amount;
      }

      // Compute variance per month
      const variance = forecast.map((f, i) => f - budgetArr[i]);

      // Totals
      const totalForecast = forecast.reduce((a, b) => a + b, 0);
      const totalActual = actual.reduce((a, b) => a + b, 0);
      const totalBudget = budget;
      const totalVariance = totalForecast - totalBudget;

      return {
        id: proj.id,
        title: safeStr(proj.title) || "Untitled",
        projectCode: safeStr(proj.project_code),
        resourceStatus: safeStr(proj.resource_status),
        isArchived: !!proj.deleted_at,
        hasPlan: !!artifact,
        budget: totalBudget,
        forecast,
        actual,
        budgetArr,
        variance,
        totals: { forecast: totalForecast, actual: totalActual, budget: totalBudget, variance: totalVariance },
      };
    });

    // 6. Portfolio totals row
    const totals = buildTotalsRow(projectData, fyMonths);

    return NextResponse.json({ ok: true, fyYear, fyStart, fyMonths, projects: projectData, totals });
  } catch (e: any) {
    console.error("[portfolio/budget-phasing]", e);
    return err(String(e?.message ?? e ?? "Unknown error"), 500);
  }
}

function buildEmptyTotals(fyMonths: any[]) {
  return {
    forecast: new Array(fyMonths.length).fill(0),
    actual: new Array(fyMonths.length).fill(0),
    budget: new Array(fyMonths.length).fill(0),
    variance: new Array(fyMonths.length).fill(0),
    totals: { forecast: 0, actual: 0, budget: 0, variance: 0 },
  };
}

function buildTotalsRow(projects: any[], fyMonths: any[]) {
  const forecast = new Array(fyMonths.length).fill(0);
  const actual = new Array(fyMonths.length).fill(0);
  const budget = new Array(fyMonths.length).fill(0);
  const variance = new Array(fyMonths.length).fill(0);

  for (const p of projects) {
    for (let i = 0; i < fyMonths.length; i++) {
      forecast[i] += p.forecast[i] ?? 0;
      actual[i] += p.actual[i] ?? 0;
      budget[i] += p.budgetArr[i] ?? 0;
      variance[i] += p.variance[i] ?? 0;
    }
  }

  return {
    forecast,
    actual,
    budget,
    variance,
    totals: {
      forecast: forecast.reduce((a, b) => a + b, 0),
      actual: actual.reduce((a, b) => a + b, 0),
      budget: budget.reduce((a, b) => a + b, 0),
      variance: variance.reduce((a, b) => a + b, 0),
    },
  };
}
