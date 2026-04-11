// src/app/api/projects/[id]/timesheet-reconciliation/route.ts
// Returns per-person, per-month planned vs actual vs forecast data
// for the timesheet reconciliation view on the financial plan
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";
export const revalidate = 0;

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}
function safeStr(x: any): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function safeNum(x: any): number {
  const n = Number(x); return Number.isFinite(n) ? n : 0;
}

export type ReconciliationPerson = {
  user_id: string;
  name: string;
  email: string | null;
  role: string | null;
  rate_per_day: number;
  months: Record<string, {          // key: "YYYY-MM"
    planned_days: number;
    approved_days: number;
    forecast_days: number;
    planned_cost: number;
    actual_cost: number;
    forecast_cost: number;
    variance_cost: number;          // actual − planned (negative = under)
    variance_pct: number | null;
    flag: "over" | "under" | "ok";
  }>;
  totals: {
    planned_days: number;
    approved_days: number;
    forecast_days: number;
    planned_cost: number;
    actual_cost: number;
    forecast_cost: number;
    variance_cost: number;
    variance_pct: number | null;
    flag: "over" | "under" | "ok";
  };
};

function flagVariance(actualCost: number, forecastCost: number): "over" | "under" | "ok" {
  if (forecastCost === 0) return "ok";
  const pct = (actualCost - forecastCost) / forecastCost;
  if (pct >  0.1) return "over";
  if (pct < -0.1) return "under";
  return "ok";
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id?: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return jsonErr("Unauthorized", 401);

    const params    = await ctx.params;
    const projectId = safeStr(params?.id).trim();
    if (!projectId) return jsonErr("Missing project id", 400);

    // Check membership
    const { data: mem } = await supabase
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!mem) return jsonErr("Forbidden", 403);

    const admin = createAdminClient();

    // ── 1. Financial plan (planned days + rate per person + forecast) ──
    const { data: fpArt } = await admin
      .from("artifacts")
      .select("content_json")
      .eq("project_id", projectId)
      .eq("type", "financial_plan")
      .eq("is_current", true)
      .maybeSingle();

    const content     = (fpArt?.content_json as any) ?? {};
    const resources   = Array.isArray(content.resources)    ? content.resources    : [];
    const monthlyData = (content.monthly_data ?? {}) as Record<string, any>;
    const costLines   = Array.isArray(content.cost_lines)   ? content.cost_lines   : [];
    const fyConfig    = (content.fy_config ?? {}) as any;

    // Build month keys from FY config
    const monthKeys: string[] = [];
    if (fyConfig?.fy_start_month && fyConfig?.fy_start_year) {
      let mo = Number(fyConfig.fy_start_month);
      let yr = Number(fyConfig.fy_start_year);
      const num = Number(fyConfig.num_months) || 12;
      for (let i = 0; i < num; i++) {
        monthKeys.push(`${yr}-${String(mo).padStart(2, "0")}`);
        mo++;
        if (mo > 12) { mo = 1; yr++; }
      }
    } else {
      // Fallback: current FY
      const now = new Date();
      for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - 6 + i, 1);
        monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      }
    }

    // Map resource user_id → rate
    const resourceByUserId = new Map<string, { rate: number; role: string | null }>();
    for (const r of resources) {
      const uid  = safeStr(r.person_id || r.user_id).trim();
      const rate = safeNum(r.day_rate || r.cost_per_day || r.rate || 0);
      if (uid) resourceByUserId.set(uid, { rate, role: safeStr(r.role || r.job_title) || null });
    }

    // Monthly planned days per person from monthly_data
    // monthly_data structure: { [costLineId]: { [YYYY-MM]: { budget, actual, forecast } } }
    // We also try to get person-level data if stored
    const peopleCostLine = costLines.find((l: any) =>
      safeStr(l.category).toLowerCase().includes("people")
    );

    // ── 2. Approved timesheets ──────────────────────────────────────────
    const { data: timesheets } = await admin
      .from("timesheets")
      .select("id, user_id, week_start_date, status")
      .eq("project_id", projectId)
      .eq("status", "approved");

    const approvedTsIds = (timesheets ?? []).map((ts: any) => safeStr(ts.id));
    const tsUserById    = new Map<string, string>();
    const tsWeekById    = new Map<string, string>();
    for (const ts of (timesheets ?? [])) {
      tsUserById.set(safeStr(ts.id), safeStr(ts.user_id));
      tsWeekById.set(safeStr(ts.id), safeStr(ts.week_start_date));
    }

    // Get weekly entries for approved timesheets
    type ApprovedDaysByUserMonth = Map<string, Map<string, number>>; // user_id → month → days

    const approvedDaysByUserMonth: ApprovedDaysByUserMonth = new Map();

    if (approvedTsIds.length) {
      const { data: wEntries } = await admin
        .from("weekly_timesheet_entries")
        .select("timesheet_id, hours, project_id")
        .in("timesheet_id", approvedTsIds);

      for (const e of (wEntries ?? [])) {
        const tsId  = safeStr(e.timesheet_id);
        const uid   = tsUserById.get(tsId);
        const week  = tsWeekById.get(tsId);
        if (!uid || !week) continue;

        const monthKey = week.slice(0, 7); // YYYY-MM
        const days     = safeNum(e.hours) / 8;

        if (!approvedDaysByUserMonth.has(uid)) approvedDaysByUserMonth.set(uid, new Map());
        const userMap = approvedDaysByUserMonth.get(uid)!;
        userMap.set(monthKey, (userMap.get(monthKey) ?? 0) + days);
      }

      // Also check timesheet_entries table
      const { data: tsEntries } = await admin
        .from("timesheet_entries")
        .select("user_id, week_date, approved_days, hours, rate")
        .eq("project_id", projectId);

      for (const e of (tsEntries ?? [])) {
        const uid      = safeStr(e.user_id).trim();
        const weekDate = safeStr(e.week_date || e.week_start_date).trim();
        if (!uid || !weekDate) continue;
        const monthKey = weekDate.slice(0, 7);
        const days     = safeNum(e.approved_days) || safeNum(e.hours) / 8;

        if (!approvedDaysByUserMonth.has(uid)) approvedDaysByUserMonth.set(uid, new Map());
        const userMap = approvedDaysByUserMonth.get(uid)!;
        userMap.set(monthKey, (userMap.get(monthKey) ?? 0) + days);
      }
    }

    // ── 3. Build person list ────────────────────────────────────────────
    // Union of: resources[] + people who have timesheet entries
    const allUserIds = new Set<string>([
      ...resourceByUserId.keys(),
      ...approvedDaysByUserMonth.keys(),
    ]);

    if (!allUserIds.size) {
      return jsonOk({ project_id: projectId, months: monthKeys, people: [], generated_at: new Date().toISOString() });
    }

    // Load profiles
    const { data: profiles } = await admin
      .from("profiles")
      .select("user_id, full_name, email")
      .in("user_id", [...allUserIds]);

    const profileMap = new Map<string, { name: string; email: string | null }>();
    for (const p of (profiles ?? [])) {
      profileMap.set(safeStr(p.user_id), {
        name:  safeStr(p.full_name).trim() || safeStr(p.email).trim() || safeStr(p.user_id),
        email: safeStr(p.email).trim() || null,
      });
    }

    // ── 4. Assemble per-person reconciliation ───────────────────────────
    const people: ReconciliationPerson[] = [];

    for (const uid of allUserIds) {
      const profile  = profileMap.get(uid) ?? { name: uid, email: null };
      const resource = resourceByUserId.get(uid);
      const rate     = resource?.rate ?? 0;

      // Get monthly planned data from monthly_data (people cost line)
      // Falls back to evenly distributing planned total
      const plannedByMonth = new Map<string, number>();
      if (peopleCostLine?.id) {
        const lineData = monthlyData[peopleCostLine.id] ?? {};
        for (const mk of monthKeys) {
          const entry = lineData[mk] ?? {};
          // If resource has specific planned days stored, use those; else divide by headcount
          const headcount = Math.max(1, allUserIds.size);
          const planned   = safeNum(entry.budget ?? entry.budgeted ?? 0) / (rate || 1) / headcount;
          if (planned > 0) plannedByMonth.set(mk, planned);
        }
      }

      const userApproved = approvedDaysByUserMonth.get(uid) ?? new Map<string, number>();

      const months: ReconciliationPerson["months"] = {};
      let totPlanned  = 0, totApproved = 0, totForecast = 0;
      let totPlanCost = 0, totActCost  = 0, totFctCost  = 0;

      for (const mk of monthKeys) {
        const plannedDays  = plannedByMonth.get(mk)  ?? 0;
        const approvedDays = userApproved.get(mk)    ?? 0;
        // Forecast = approved days if past, else planned days
        const monthDate    = new Date(mk + "-01");
        const isPast       = monthDate < new Date();
        const forecastDays = isPast ? approvedDays : plannedDays;

        const plannedCost  = plannedDays  * rate;
        const actualCost   = approvedDays * rate;
        const forecastCost = forecastDays * rate;
        const varianceCost = actualCost   - plannedCost;
        const variancePct  = plannedCost > 0 ? (varianceCost / plannedCost) * 100 : null;

        totPlanned  += plannedDays;  totApproved += approvedDays; totForecast += forecastDays;
        totPlanCost += plannedCost;  totActCost  += actualCost;   totFctCost  += forecastCost;

        months[mk] = {
          planned_days:   Math.round(plannedDays  * 10) / 10,
          approved_days:  Math.round(approvedDays * 10) / 10,
          forecast_days:  Math.round(forecastDays * 10) / 10,
          planned_cost:   Math.round(plannedCost),
          actual_cost:    Math.round(actualCost),
          forecast_cost:  Math.round(forecastCost),
          variance_cost:  Math.round(varianceCost),
          variance_pct:   variancePct !== null ? Math.round(variancePct * 10) / 10 : null,
          flag:           flagVariance(actualCost, plannedCost),
        };
      }

      const totVariance    = totActCost - totPlanCost;
      const totVariancePct = totPlanCost > 0 ? (totVariance / totPlanCost) * 100 : null;

      people.push({
        user_id:      uid,
        name:         profile.name,
        email:        profile.email,
        role:         resource?.role ?? null,
        rate_per_day: rate,
        months,
        totals: {
          planned_days:   Math.round(totPlanned  * 10) / 10,
          approved_days:  Math.round(totApproved * 10) / 10,
          forecast_days:  Math.round(totForecast * 10) / 10,
          planned_cost:   Math.round(totPlanCost),
          actual_cost:    Math.round(totActCost),
          forecast_cost:  Math.round(totFctCost),
          variance_cost:  Math.round(totVariance),
          variance_pct:   totVariancePct !== null ? Math.round(totVariancePct * 10) / 10 : null,
          flag:           flagVariance(totActCost, totFctCost),
        },
      });
    }

    // Sort: most variance first (over > under > ok), then by name
    people.sort((a, b) => {
      const flagOrder = (f: string) => f === "over" ? 0 : f === "under" ? 1 : 2;
      if (flagOrder(a.totals.flag) !== flagOrder(b.totals.flag))
        return flagOrder(a.totals.flag) - flagOrder(b.totals.flag);
      return a.name.localeCompare(b.name);
    });

    return jsonOk({
      project_id:    projectId,
      months:        monthKeys,
      people,
      generated_at:  new Date().toISOString(),
    });

  } catch (e: any) {
    console.error("[timesheet-reconciliation]", e);
    return jsonErr(safeStr(e?.message) || "Failed", 500);
  }
}