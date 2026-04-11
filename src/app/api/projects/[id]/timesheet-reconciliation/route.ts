// src/app/api/projects/[id]/timesheet-reconciliation/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime   = "nodejs";
export const dynamic   = "force-dynamic";
export const revalidate = 0;

function jsonOk(data: any)          { return NextResponse.json({ ok: true,  ...data }); }
function jsonErr(e: string, s = 400){ return NextResponse.json({ ok: false, error: e }, { status: s }); }
function safeStr(x: any): string    { return typeof x === "string" ? x : x == null ? "" : String(x); }
function safeNum(x: any): number    { const n = Number(x); return Number.isFinite(n) ? n : 0; }
function flagVariance(actual: number, planned: number): "over"|"under"|"ok" {
  if (planned === 0 && actual === 0) return "ok";
  if (planned === 0) return "over";
  const pct = (actual - planned) / planned;
  if (pct >  0.1) return "over";
  if (pct < -0.1) return "under";
  return "ok";
}

const HOURS_PER_DAY = 8;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id?: string }> }) {
  try {
    const supabase  = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return jsonErr("Unauthorized", 401);

    const params    = await ctx.params;
    const projectId = safeStr(params?.id).trim();
    if (!projectId) return jsonErr("Missing project id", 400);

    // Check membership
    const { data: mem } = await supabase.from("project_members").select("role")
      .eq("project_id", projectId).eq("user_id", user.id).eq("is_active", true).maybeSingle();
    if (!mem) {
      // Allow org member too
      const { data: proj } = await supabase.from("projects").select("organisation_id").eq("id", projectId).maybeSingle();
      if (proj?.organisation_id) {
        const { data: orgMem } = await supabase.from("organisation_members").select("role")
          .eq("organisation_id", proj.organisation_id).eq("user_id", user.id).is("removed_at", null).maybeSingle();
        if (!orgMem) return jsonErr("Forbidden", 403);
      } else return jsonErr("Forbidden", 403);
    }

    // ── 1. Financial plan ─────────────────────────────────────────────────
    const { data: fpRow } = await supabase
      .from("artifacts").select("id, content_json")
      .eq("project_id", projectId).eq("type", "FINANCIAL_PLAN").eq("is_current", true).maybeSingle();

    const content     = (fpRow?.content_json as any) ?? {};
    const resources   = Array.isArray(content.resources)   ? content.resources   : [];
    const monthlyData = (content.monthly_data ?? {}) as Record<string, any>;
    const fyConfig    = (content.fy_config    ?? {}) as any;

    // Build month keys from FY config
    const monthKeys: string[] = [];
    if (fyConfig?.fy_start_month && fyConfig?.fy_start_year) {
      let mo = Number(fyConfig.fy_start_month), yr = Number(fyConfig.fy_start_year);
      const num = Number(fyConfig.num_months) || 12;
      for (let i = 0; i < num; i++) {
        monthKeys.push(`${yr}-${String(mo).padStart(2, "0")}`);
        mo++; if (mo > 12) { mo = 1; yr++; }
      }
    } else {
      const now = new Date();
      for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - 3 + i, 1);
        monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      }
    }

    // ── 2. Approved hours per user per month (mirrors getApprovedTimesheetEntries) ──
    // Uses weekly_timesheet_entries → timesheets join (same as financial plan actuals)
    const approvedDaysByUserMonth: Record<string, Record<string, number>> = {};
    const totalApprovedDaysByUser: Record<string, number> = {};

    const { data: weeklyRaw } = await supabase
      .from("weekly_timesheet_entries")
      .select("timesheet_id, work_date, hours")
      .eq("project_id", projectId)
      .gt("hours", 0);

    if (weeklyRaw?.length) {
      const tsIds = [...new Set(weeklyRaw.map((r: any) => safeStr(r.timesheet_id)))].filter(Boolean);

      const { data: approvedTs } = await supabase
        .from("timesheets").select("id, user_id")
        .in("id", tsIds).eq("status", "approved");

      const approvedMap = new Map<string, string>(); // tsId → userId
      for (const t of (approvedTs ?? [])) approvedMap.set(safeStr(t.id), safeStr(t.user_id));

      for (const row of weeklyRaw) {
        const userId = approvedMap.get(safeStr(row.timesheet_id));
        if (!userId) continue;
        const mk   = safeStr(row.work_date).slice(0, 7);
        const days = safeNum(row.hours) / HOURS_PER_DAY;
        if (!mk || days <= 0) continue;
        if (!approvedDaysByUserMonth[userId]) approvedDaysByUserMonth[userId] = {};
        approvedDaysByUserMonth[userId][mk] = (approvedDaysByUserMonth[userId][mk] ?? 0) + days;
        totalApprovedDaysByUser[userId] = (totalApprovedDaysByUser[userId] ?? 0) + days;
      }
    }

    // ── 3. Get org details for rate card ─────────────────────────────────
    const { data: projRow } = await supabase.from("projects").select("organisation_id").eq("id", projectId).maybeSingle();
    const orgId = safeStr(projRow?.organisation_id) || null;

    // Rate card
    const personalRateByUser = new Map<string, number>();
    const rateByLabel        = new Map<string, number>();
    if (orgId) {
      const { data: rates } = await supabase.from("resource_rates")
        .select("user_id, role_label, rate, rate_type")
        .eq("organisation_id", orgId).eq("rate_type", "day_rate");
      for (const r of (rates ?? [])) {
        if (!r.rate) continue;
        const rate = safeNum(r.rate);
        if (r.user_id) personalRateByUser.set(safeStr(r.user_id), rate);
        else if (r.role_label) rateByLabel.set(safeStr(r.role_label).toLowerCase().trim(), rate);
      }
    }

    // Job titles
    const jobTitleByUser = new Map<string, string>();
    const allUserIds = new Set<string>([
      ...Object.keys(approvedDaysByUserMonth),
      ...resources.map((r: any) => safeStr(r.user_id)).filter(Boolean),
    ]);

    if (allUserIds.size) {
      const uids = [...allUserIds];
      const { data: profiles } = await supabase.from("profiles").select("user_id, full_name, email, job_title").in("user_id", uids);
      const profileMap = new Map<string, any>();
      for (const p of (profiles ?? [])) profileMap.set(safeStr(p.user_id), p);

      if (orgId) {
        const { data: members } = await supabase.from("organisation_members")
          .select("user_id, job_title, role").eq("organisation_id", orgId).in("user_id", uids);
        for (const m of (members ?? [])) {
          const uid   = safeStr(m.user_id);
          const title = safeStr(m.job_title || m.role || "").trim();
          if (title && !jobTitleByUser.has(uid)) jobTitleByUser.set(uid, title);
        }
      }

      for (const [uid, p] of profileMap.entries()) {
        const title = safeStr(p?.job_title || "").trim();
        if (title) jobTitleByUser.set(uid, title);
      }

      // Build name map
      const nameMap = new Map<string, string>();
      for (const [uid, p] of profileMap.entries()) {
        nameMap.set(uid, safeStr(p?.full_name).trim() || safeStr(p?.email).trim() || uid);
      }
      (globalThis as any).__nameMap = nameMap;
    }

    function getDayRate(userId: string): number {
      const personal = personalRateByUser.get(userId);
      if (personal) return personal;
      // Try resource entry from financial plan
      const res = resources.find((r: any) => r.user_id === userId);
      if (res?.day_rate) return safeNum(res.day_rate);
      const jobTitle = jobTitleByUser.get(userId);
      if (jobTitle) {
        const roleRate = rateByLabel.get(jobTitle.toLowerCase().trim());
        if (roleRate) return roleRate;
      }
      return 0;
    }

    const nameMap: Map<string, string> = (globalThis as any).__nameMap ?? new Map();

    // ── 4. Heatmap planned days ───────────────────────────────────────────
    let heatmapPeople: any[] = [];
    if (fpRow?.id) {
      try {
        const url = new URL(`/api/artifacts/financial-plan/resource-plan-sync`, req.url);
        url.searchParams.set("projectId", projectId);
        url.searchParams.set("artifactId", fpRow.id);
        const hr  = await fetch(url.toString(), { headers: { cookie: req.headers.get("cookie") || "" }, cache: "no-store" });
        const hj  = await hr.json().catch(() => ({ ok: false }));
        if (hj.ok && Array.isArray(hj.people)) heatmapPeople = hj.people;
      } catch (e: any) { console.warn("[reconciliation] heatmap failed:", e?.message); }
    }

    // ── 5. Build people list ──────────────────────────────────────────────
    const people: any[] = [];

    for (const uid of allUserIds) {
      const heatmapPerson = heatmapPeople.find(p => p.person_id === uid);
      const resourceEntry = resources.find((r: any) => r.user_id === uid);
      const rate          = getDayRate(uid);
      const totalPlanned  = safeNum(heatmapPerson?.total_days) || safeNum(resourceEntry?.planned_days) || 0;
      const role          = safeStr(heatmapPerson?.job_title || heatmapPerson?.role_title || jobTitleByUser.get(uid) || resourceEntry?.role || "");
      const name          = nameMap.get(uid) || uid;
      const userMonths    = approvedDaysByUserMonth[uid] ?? {};

      const months: Record<string, any> = {};
      let totPlanned = 0, totApproved = 0, totPlanCost = 0, totActCost = 0;

      for (const mk of monthKeys) {
        // Planned days from monthly_data cost line
        let plannedDays = 0;
        const costLine = resources.find((r: any) => r.user_id === uid && r.cost_line_id);
        if (costLine?.cost_line_id && monthlyData[costLine.cost_line_id]?.[mk] && rate > 0) {
          plannedDays = safeNum(monthlyData[costLine.cost_line_id][mk].budget ?? monthlyData[costLine.cost_line_id][mk].budgeted) / rate;
        } else if (totalPlanned > 0 && monthKeys.length > 0) {
          plannedDays = totalPlanned / monthKeys.length;
        }

        const approvedDays  = userMonths[mk] ?? 0;
        const isPast        = new Date(mk + "-01") < new Date();
        const forecastDays  = isPast ? approvedDays : plannedDays;
        const plannedCost   = plannedDays  * rate;
        const actualCost    = approvedDays * rate;
        const forecastCost  = forecastDays * rate;
        const varianceCost  = actualCost - plannedCost;
        const variancePct   = plannedCost > 0 ? (varianceCost / plannedCost) * 100 : null;

        totPlanned  += plannedDays;
        totApproved += approvedDays;
        totPlanCost += plannedCost;
        totActCost  += actualCost;

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

      const totVariance    = totActCost  - totPlanCost;
      const totVariancePct = totPlanCost > 0 ? (totVariance / totPlanCost) * 100 : null;

      people.push({
        user_id: uid, name, role, rate_per_day: rate,
        months,
        totals: {
          planned_days:  Math.round(totPlanned  * 10) / 10,
          approved_days: Math.round(totApproved * 10) / 10,
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
      const o = (f: string) => f === "over" ? 0 : f === "under" ? 1 : 2;
      if (o(a.totals.flag) !== o(b.totals.flag)) return o(a.totals.flag) - o(b.totals.flag);
      return a.name.localeCompare(b.name);
    });

    return jsonOk({ project_id: projectId, months: monthKeys, people, generated_at: new Date().toISOString() });

  } catch (e: any) {
    console.error("[timesheet-reconciliation]", e);
    return jsonErr(safeStr(e?.message) || "Failed", 500);
  }
}