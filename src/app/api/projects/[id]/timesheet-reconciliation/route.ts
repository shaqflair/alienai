// src/app/api/projects/[id]/timesheet-reconciliation/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

export const runtime   = "nodejs";
export const dynamic   = "force-dynamic";
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
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function flagVariance(actual: number, planned: number): "over" | "under" | "ok" {
  if (planned === 0) return "ok";
  const pct = (actual - planned) / planned;
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

    const { data: mem } = await supabase
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!mem) return jsonErr("Forbidden", 403);

    const admin = createAdminClient();

    // ── 1. Financial plan content ─────────────────────────────────────────
    const { data: fpRow } = await admin
      .from("artifacts")
      .select("id, content_json")
      .eq("project_id", projectId)
      .eq("type", "FINANCIAL_PLAN")
      .eq("is_current", true)
      .maybeSingle();

    const content     = (fpRow?.content_json as any) ?? {};
    const resources   = Array.isArray(content.resources) ? content.resources : [];
    const monthlyData = (content.monthly_data ?? {}) as Record<string, any>;
    const fyConfig    = (content.fy_config ?? {}) as any;

    // Build month keys
    const monthKeys: string[] = [];
    if (fyConfig?.fy_start_month && fyConfig?.fy_start_year) {
      let mo = Number(fyConfig.fy_start_month);
      let yr = Number(fyConfig.fy_start_year);
      const num = Number(fyConfig.num_months) || 12;
      for (let i = 0; i < num; i++) {
        monthKeys.push(`${yr}-${String(mo).padStart(2, "0")}`);
        mo++; if (mo > 12) { mo = 1; yr++; }
      }
    } else {
      const now = new Date();
      for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - 6 + i, 1);
        monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      }
    }

    // ── 2. Heatmap planned days ───────────────────────────────────────────
    let heatmapPeople: any[] = [];
    if (fpRow?.id) {
      try {
        const heatmapUrl = new URL(`/api/artifacts/financial-plan/resource-plan-sync`, req.url);
        heatmapUrl.searchParams.set("projectId", projectId);
        heatmapUrl.searchParams.set("artifactId", fpRow.id);
        const hr = await fetch(heatmapUrl.toString(), {
          headers: { cookie: req.headers.get("cookie") || "" },
          cache: "no-store",
        });
        const hj = await hr.json().catch(() => ({ ok: false }));
        if (hj.ok && Array.isArray(hj.people)) heatmapPeople = hj.people;
      } catch (e: any) {
        console.warn("[reconciliation] heatmap fetch failed:", e?.message);
      }
    }

    // ── 3. Approved hours per user per month ─────────────────────────────
    // timesheets: id, user_id, status (NO project_id)
    // timesheet_entries: timesheet_id, project_id, hours, work_date
    const approvedHoursByUserMonth: Record<string, Record<string, number>> = {};

    const { data: tsEntries } = await admin
      .from("timesheet_entries")
      .select("timesheet_id, hours, work_date")
      .eq("project_id", projectId);

    if (tsEntries?.length) {
      const tsIds = [...new Set(tsEntries.map((e: any) => safeStr(e.timesheet_id)))].filter(Boolean);

      const { data: approvedTs } = await admin
        .from("timesheets")
        .select("id, user_id, week_start_date")
        .in("id", tsIds)
        .eq("status", "approved");

      const tsMap = new Map<string, { user_id: string; week_start_date: string }>();
      for (const ts of (approvedTs ?? [])) {
        tsMap.set(safeStr(ts.id), { user_id: safeStr(ts.user_id), week_start_date: safeStr(ts.week_start_date) });
      }

      for (const entry of tsEntries) {
        const ts = tsMap.get(safeStr(entry.timesheet_id));
        if (!ts) continue;
        const uid      = ts.user_id;
        const workDate = safeStr(entry.work_date || ts.week_start_date);
        const monthKey = workDate.slice(0, 7);
        const hours    = safeNum(Number(entry.hours));
        if (!uid || !monthKey || hours <= 0) continue;
        if (!approvedHoursByUserMonth[uid]) approvedHoursByUserMonth[uid] = {};
        approvedHoursByUserMonth[uid][monthKey] = (approvedHoursByUserMonth[uid][monthKey] ?? 0) + hours;
      }
    }

    // Also try weekly_resource_allocations
    try {
      const { data: weeklyAllocs } = await admin
        .from("weekly_resource_allocations")
        .select("person_id, user_id, approved_days, week_start_date, cost_per_day")
        .eq("project_id", projectId)
        .eq("status", "approved");

      for (const alloc of (weeklyAllocs ?? [])) {
        const uid      = safeStr(alloc.person_id || alloc.user_id);
        const monthKey = safeStr(alloc.week_start_date).slice(0, 7);
        const days     = safeNum(alloc.approved_days);
        if (!uid || !monthKey || days <= 0) continue;
        if (!approvedHoursByUserMonth[uid]) approvedHoursByUserMonth[uid] = {};
        approvedHoursByUserMonth[uid][monthKey] = (approvedHoursByUserMonth[uid][monthKey] ?? 0) + (days * 8);
      }
    } catch { /* table may not exist */ }

    // ── 4. Build person list ──────────────────────────────────────────────
    const allUserIds = new Set<string>();
    heatmapPeople.forEach(p => { if (p.person_id) allUserIds.add(p.person_id); });
    resources.forEach((r: any) => { if (r.user_id) allUserIds.add(r.user_id); });
    Object.keys(approvedHoursByUserMonth).forEach(uid => allUserIds.add(uid));

    if (!allUserIds.size) {
      return jsonOk({
        project_id: projectId, months: monthKeys, people: [],
        generated_at: new Date().toISOString(),
        note: "No resource or timesheet data found.",
      });
    }

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

    // ── 5. Per-person reconciliation ──────────────────────────────────────
    const people: any[] = [];

    for (const uid of allUserIds) {
      const profile       = profileMap.get(uid) ?? { name: uid, email: null };
      const heatmapPerson = heatmapPeople.find(p => p.person_id === uid);
      const resourceEntry = resources.find((r: any) => r.user_id === uid);

      const rate             = safeNum(heatmapPerson?.cost_day_rate) || safeNum(resourceEntry?.day_rate) || 0;
      const totalPlannedDays = safeNum(heatmapPerson?.total_days) || safeNum(resourceEntry?.planned_days) || 0;
      const role             = safeStr(heatmapPerson?.job_title || heatmapPerson?.role_title || resourceEntry?.role || "");
      const userHours        = approvedHoursByUserMonth[uid] ?? {};

      const months: Record<string, any> = {};
      let totPlannedDays = 0, totApprovedDays = 0, totPlanCost = 0, totActCost = 0;

      for (const mk of monthKeys) {
        // Try to get planned days from monthly_data for the linked cost line
        let plannedDays = 0;
        const costLine = resources.find((r: any) => r.user_id === uid && r.cost_line_id);
        if (costLine?.cost_line_id && monthlyData[costLine.cost_line_id]?.[mk] && rate > 0) {
          const entry = monthlyData[costLine.cost_line_id][mk];
          plannedDays = safeNum(entry.budget ?? entry.budgeted) / rate;
        } else if (totalPlannedDays > 0 && monthKeys.length > 0) {
          plannedDays = totalPlannedDays / monthKeys.length;
        }

        const approvedDays  = (userHours[mk] ?? 0) / 8;
        const now           = new Date();
        const isPast        = new Date(mk + "-01") < now;
        const forecastDays  = isPast ? approvedDays : plannedDays;
        const plannedCost   = plannedDays  * rate;
        const actualCost    = approvedDays * rate;
        const forecastCost  = forecastDays * rate;
        const varianceCost  = actualCost - plannedCost;
        const variancePct   = plannedCost > 0 ? (varianceCost / plannedCost) * 100 : null;

        totPlannedDays  += plannedDays;
        totApprovedDays += approvedDays;
        totPlanCost     += plannedCost;
        totActCost      += actualCost;

        months[mk] = {
          planned_days:  Math.round(plannedDays  * 10) / 10,
          approved_days: Math.round(approvedDays * 10) / 10,
          forecast_days: Math.round(forecastDays * 10) / 10,
          planned_cost:  Math.round(plannedCost),
          actual_cost:   Math.round(actualCost),
          forecast_cost: Math.round(forecastCost),
          variance_cost: Math.round(varianceCost),
          variance_pct:  variancePct !== null ? Math.round(variancePct * 10) / 10 : null,
          flag:          flagVariance(actualCost, plannedCost),
        };
      }

      const totVariance    = totActCost - totPlanCost;
      const totVariancePct = totPlanCost > 0 ? (totVariance / totPlanCost) * 100 : null;

      people.push({
        user_id:      uid,
        name:         profile.name,
        email:        profile.email,
        role,
        rate_per_day: rate,
        months,
        totals: {
          planned_days:  Math.round(totPlannedDays  * 10) / 10,
          approved_days: Math.round(totApprovedDays * 10) / 10,
          forecast_days: Math.round(totApprovedDays * 10) / 10,
          planned_cost:  Math.round(totPlanCost),
          actual_cost:   Math.round(totActCost),
          forecast_cost: Math.round(totActCost),
          variance_cost: Math.round(totVariance),
          variance_pct:  totVariancePct !== null ? Math.round(totVariancePct * 10) / 10 : null,
          flag:          flagVariance(totActCost, totPlanCost),
        },
      });
    }

    people.sort((a, b) => {
      const order = (f: string) => f === "over" ? 0 : f === "under" ? 1 : 2;
      if (order(a.totals.flag) !== order(b.totals.flag)) return order(a.totals.flag) - order(b.totals.flag);
      return a.name.localeCompare(b.name);
    });

    return jsonOk({ project_id: projectId, months: monthKeys, people, generated_at: new Date().toISOString() });

  } catch (e: any) {
    console.error("[timesheet-reconciliation]", e);
    return jsonErr(safeStr(e?.message) || "Failed", 500);
  }
}