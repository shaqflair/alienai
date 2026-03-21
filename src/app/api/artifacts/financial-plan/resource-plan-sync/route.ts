// src/app/api/artifacts/financial-plan/resource-plan-sync/route.ts
// GET  ?artifactId=xxx&projectId=xxx  → returns ResourceAllocation[] + forecast preview
// POST ?artifactId=xxx&projectId=xxx  → writes the forecast into the financial plan artifact

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  mapRoleRequirementsToAllocations,
  computeResourcePlanForecast,
  findOrCreatePeopleCostLine,
  formatMonthlySummary,
} from "@/lib/financial/resource-plan-to-financial";
import type { FYConfig, MonthlyData } from "@/components/artifacts/FinancialPlanMonthlyView";
import type { FinancialPlanContent } from "@/components/artifacts/FinancialPlanEditor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function noStore(data: any, status = 200) {
  const res = NextResponse.json(data, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

async function requireAuth(supabase: any) {
  const { data: auth, error } = await supabase.auth.getUser();
  if (error || !auth?.user) throw new Error("Unauthorized");
  return auth.user;
}

async function requireProjectAccess(supabase: any, projectId: string, userId: string) {
  const { data: proj } = await supabase
    .from("projects")
    .select("id, organisation_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!proj) throw new Error("Project not found");

  const { data: mem } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", proj.organisation_id)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (!mem) {
    // Fall back to project membership
    const { data: pmem } = await supabase
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .is("removed_at", null)
      .maybeSingle();
    if (!pmem) throw new Error("Forbidden");
    const role = safeStr(pmem.role).toLowerCase();
    return { organisation_id: proj.organisation_id, isAdmin: role === "owner" || role === "editor" };
  }

  const isAdmin = ["admin", "owner", "resource_manager"].includes(safeStr(mem.role).toLowerCase());
  return { organisation_id: proj.organisation_id, isAdmin };
}

/**
 * Load allocations from the `allocations` table (what drives the capacity heatmap).
 * Falls back to `role_requirements` if allocations table has no rows for this project.
 */
async function loadAllocationsForProject(supabase: any, projectId: string) {
  // Try allocations table first (heatmap source)
  const { data: allocs, error: allocErr } = await supabase
    .from("allocations")
    .select("*")
    .eq("project_id", projectId);

  if (!allocErr && Array.isArray(allocs) && allocs.length > 0) {
    return { source: "allocations" as const, rows: allocs };
  }

  // Fall back to role_requirements
  const { data: roleRows, error: roleErr } = await supabase
    .from("role_requirements")
    .select("id, role_title, seniority_level, required_days_per_week, start_date, end_date, filled_by_person_id, notes")
    .eq("project_id", projectId)
    .order("start_date", { ascending: true });

  if (roleErr) throw new Error(roleErr.message);
  return { source: "role_requirements" as const, rows: roleRows ?? [] };
}

/**
 * Load rate card using the actual column names: role_label, rate (not role_title, day_rate).
 * Tries v_resource_rates_latest view first, falls back to resource_rates table directly.
 */
async function loadRateCardForRoles(
  supabase: any,
  orgId: string,
  source: "allocations" | "role_requirements",
  rows: any[]
): Promise<Map<string, { day_rate: number; rate_source: "personal" | "role" }>> {
  const result = new Map<string, { day_rate: number; rate_source: "personal" | "role" }>();
  if (!rows.length) return result;

  // Determine role key field based on source
  const getRoleKey = (row: any): string => {
    return safeStr(
      row.role_label ?? row.role_title ?? row.role ?? ""
    ).trim().toLowerCase();
  };

  const getPersonId = (row: any): string => {
    return safeStr(
      row.user_id ?? row.filled_by_person_id ?? row.person_id ?? ""
    ).trim();
  };

  // Load role-based rates from resource_rates (using role_label column)
  const ratesByRoleLabel = new Map<string, number>();

  // Try v_resource_rates_latest first
  const { data: viewRates, error: viewErr } = await supabase
    .from("v_resource_rates_latest")
    .select("role_label, rate, rate_type, user_id")
    .eq("organisation_id", orgId)
    .eq("rate_type", "day_rate");

  if (!viewErr && Array.isArray(viewRates)) {
    for (const r of viewRates) {
      const key = safeStr(r.role_label ?? r.role_title ?? "").trim().toLowerCase();
      if (key && !ratesByRoleLabel.has(key)) {
        ratesByRoleLabel.set(key, Number(r.rate ?? r.day_rate ?? 0));
      }
    }
  } else {
    // Fall back to resource_rates table directly
    const { data: tableRates } = await supabase
      .from("resource_rates")
      .select("role_label, rate, rate_type, user_id")
      .eq("organisation_id", orgId)
      .eq("rate_type", "day_rate");

    for (const r of (tableRates ?? []) as any[]) {
      const key = safeStr(r.role_label ?? "").trim().toLowerCase();
      if (key && !ratesByRoleLabel.has(key)) {
        ratesByRoleLabel.set(key, Number(r.rate ?? 0));
      }
    }
  }

  // Load personal rates for users that appear in rows
  const personIds = Array.from(new Set(
    rows.map((r: any) => getPersonId(r)).filter(Boolean)
  ));

  const personalRates = new Map<string, number>();
  if (personIds.length) {
    // From view
    const { data: personalView, error: pvErr } = await supabase
      .from("v_resource_rates_latest")
      .select("user_id, rate, rate_type")
      .eq("organisation_id", orgId)
      .eq("rate_type", "day_rate")
      .in("user_id", personIds);

    if (!pvErr && Array.isArray(personalView)) {
      for (const r of personalView) {
        if (r.user_id) personalRates.set(r.user_id, Number(r.rate ?? r.day_rate ?? 0));
      }
    } else {
      // Fall back to resource_rates
      const { data: personalTable } = await supabase
        .from("resource_rates")
        .select("user_id, rate, rate_type")
        .eq("organisation_id", orgId)
        .eq("rate_type", "day_rate")
        .in("user_id", personIds);

      for (const r of (personalTable ?? []) as any[]) {
        if (r.user_id) personalRates.set(r.user_id, Number(r.rate ?? 0));
      }
    }
  }

  // Map each row to a rate
  for (const row of rows) {
    const personId = getPersonId(row);
    const roleKey  = getRoleKey(row);

    if (personId && personalRates.has(personId) && (personalRates.get(personId) ?? 0) > 0) {
      result.set(row.id, { day_rate: personalRates.get(personId)!, rate_source: "personal" });
    } else if (roleKey && ratesByRoleLabel.has(roleKey) && (ratesByRoleLabel.get(roleKey) ?? 0) > 0) {
      result.set(row.id, { day_rate: ratesByRoleLabel.get(roleKey)!, rate_source: "role" });
    }
  }

  return result;
}

/**
 * Normalise allocations rows into the shape mapRoleRequirementsToAllocations expects.
 * Works for both allocations table and role_requirements table.
 */
function normaliseRows(source: "allocations" | "role_requirements", rows: any[], personNames: Map<string, string>) {
  if (source === "role_requirements") {
    return rows.map((row: any) => ({
      id:                     row.id,
      person_id:              row.filled_by_person_id ?? null,
      person_name:            row.filled_by_person_id ? (personNames.get(row.filled_by_person_id) ?? null) : null,
      role_title:             safeStr(row.role_title ?? row.role_label ?? "Role"),
      seniority_level:        row.seniority_level ?? null,
      required_days_per_week: Number(row.required_days_per_week ?? 5),
      start_date:             safeStr(row.start_date),
      end_date:               safeStr(row.end_date),
      day_rate:               null as number | null,
      rate_source:            null as "personal" | "role" | null,
    }));
  }

  // allocations table — each row is a single week.
  // days_allocated = actual days that week (e.g. 1.0, 2.0, 3.0)
  // week_start_date = Monday of that week; derive end as +6 days (Sunday)
  return rows.map((row: any) => {
    const userId     = safeStr(row.person_id ?? row.user_id ?? "").trim();
    const daysAlloc  = Math.max(0, Number(row.days_allocated ?? 0));
    const weekStart  = safeStr(row.week_start_date ?? row.start_date ?? "").trim();

    if (!weekStart || daysAlloc <= 0) return null;

    // Derive week end date (6 days after week start = same week Sunday)
    let weekEnd = "";
    try {
      const d = new Date(weekStart + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 6);
      weekEnd = d.toISOString().slice(0, 10);
    } catch { return null; }

    return {
      id:                     row.id,
      person_id:              userId || null,
      person_name:            userId ? (personNames.get(userId) ?? null) : null,
      // Use role_on_project if set, otherwise look up from org member data
      role_title:             safeStr(row.role_on_project ?? row.role_label ?? row.role ?? row.role_title ?? "Team Member"),
      seniority_level:        null,
      // days_allocated is already days/week for this specific week
      required_days_per_week: daysAlloc,
      start_date:             weekStart,
      end_date:               weekEnd,
      day_rate:               null as number | null,
      rate_source:            null as "personal" | "role" | null,
    };
  }).filter(Boolean) as any[];
}

async function loadPersonNames(supabase: any, personIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!personIds.length) return map;

  const { data } = await supabase
    .from("profiles")
    .select("user_id, id, full_name, email")
    .or(`user_id.in.(${personIds.join(",")}),id.in.(${personIds.join(",")})`);

  for (const p of (data ?? []) as any[]) {
    const name = safeStr(p.full_name).trim() || safeStr(p.email).trim();
    if (p.user_id && name) map.set(p.user_id, name);
    if (p.id && name && !map.has(p.id)) map.set(p.id, name);
  }
  return map;
}

async function loadFinancialPlanArtifact(supabase: any, artifactId: string): Promise<FinancialPlanContent | null> {
  const { data } = await supabase
    .from("artifacts")
    .select("content_json")
    .eq("id", artifactId)
    .maybeSingle();

  if (!data?.content_json) return null;
  const cj = typeof data.content_json === "string"
    ? JSON.parse(data.content_json)
    : data.content_json;
  return cj as FinancialPlanContent;
}

/* ── GET: preview ── */
export async function GET(req: Request) {
  try {
    const supabase   = await createClient();
    const user       = await requireAuth(supabase);
    const url        = new URL(req.url);
    const projectId  = safeStr(url.searchParams.get("projectId")).trim();
    const artifactId = safeStr(url.searchParams.get("artifactId")).trim();

    if (!projectId) return noStore({ ok: false, error: "Missing projectId" }, 400);

    const { organisation_id, isAdmin } = await requireProjectAccess(supabase, projectId, user.id);
    const { source, rows } = await loadAllocationsForProject(supabase, projectId);

    const personIds = Array.from(new Set(
      rows.map((r: any) => safeStr(r.person_id ?? r.user_id ?? r.filled_by_person_id ?? "").trim()).filter(Boolean)
    ));
    const personNames = await loadPersonNames(supabase, personIds);
    const rateMap     = await loadRateCardForRoles(supabase, organisation_id, source, rows);
    const allocations = normaliseRows(source, rows, personNames);

    // Apply rates to allocations
    for (const alloc of allocations) {
      const rateMatch = rateMap.get(alloc.id);
      if (rateMatch) {
        alloc.day_rate    = rateMatch.day_rate;
        alloc.rate_source = rateMatch.rate_source;
      }
    }

    let fyConfig: FYConfig = { fy_start_month: 4, fy_start_year: new Date().getFullYear(), num_months: 12 };
    let existingMonthlyData: MonthlyData = {};
    let peopleCostLineId = "people-line-preview";
    let overriddenMonths: string[] = [];

    if (artifactId) {
      const fp = await loadFinancialPlanArtifact(supabase, artifactId);
      if (fp) {
        fyConfig = fp.fy_config ?? fyConfig;
        existingMonthlyData = fp.monthly_data ?? {};
        const { line } = findOrCreatePeopleCostLine(fp.cost_lines ?? []);
        peopleCostLineId = line.id;
        try {
          overriddenMonths = fp.resource_plan_overridden_months ? JSON.parse(fp.resource_plan_overridden_months) : [];
        } catch { overriddenMonths = []; }
      }
    }

    const forecast = computeResourcePlanForecast(
      allocations as any,
      peopleCostLineId,
      fyConfig,
      existingMonthlyData,
      new Set(overriddenMonths)
    );

    const missingRates = allocations.filter(a => a.day_rate == null).map(a => ({
      id:          a.id,
      role_title:  a.role_title,
      person_name: a.person_name,
    }));

    return noStore({
      ok: true,
      isAdmin,
      source,
      allocations: allocations.map(a => ({ id: a.id, person_name: a.person_name, role_title: a.role_title, day_rate: a.day_rate, rate_source: a.rate_source, required_days_per_week: a.required_days_per_week })),
      forecast: {
        monthly_totals:  forecast.monthly_totals,
        missing_rates:   missingRates,
        summary:         formatMonthlySummary(forecast.monthly_totals, "GBP"),
        months_affected: Object.keys(forecast.monthly_totals).filter(mk => forecast.monthly_totals[mk].cost > 0).length,
      },
      role_count:        allocations.length,
      rate_coverage:     `${allocations.filter(a => a.day_rate != null).length}/${allocations.length}`,
      overridden_months: overriddenMonths,
    });
  } catch (e: any) {
    return noStore({ ok: false, error: e.message ?? "Server error" }, e.message === "Unauthorized" ? 401 : 500);
  }
}

/* ── POST: apply sync ── */
export async function POST(req: Request) {
  try {
    const supabase   = await createClient();
    const user       = await requireAuth(supabase);
    const url        = new URL(req.url);
    const projectId  = safeStr(url.searchParams.get("projectId")).trim();
    const artifactId = safeStr(url.searchParams.get("artifactId")).trim();

    if (!projectId || !artifactId) return noStore({ ok: false, error: "Missing projectId or artifactId" }, 400);

    const { organisation_id, isAdmin } = await requireProjectAccess(supabase, projectId, user.id);

    const body             = await req.json().catch(() => ({}));
    const overriddenMonths: string[] = Array.isArray(body?.overridden_months) ? body.overridden_months : [];

    const { source, rows } = await loadAllocationsForProject(supabase, projectId);

    const personIds = Array.from(new Set(
      rows.map((r: any) => safeStr(r.person_id ?? r.user_id ?? r.filled_by_person_id ?? "").trim()).filter(Boolean)
    ));
    const personNames = await loadPersonNames(supabase, personIds);
    const rateMap     = await loadRateCardForRoles(supabase, organisation_id, source, rows);
    const allocations = normaliseRows(source, rows, personNames);

    for (const alloc of allocations) {
      const rateMatch = rateMap.get(alloc.id);
      if (rateMatch) {
        alloc.day_rate    = rateMatch.day_rate;
        alloc.rate_source = rateMatch.rate_source;
      }
    }

    const fp = await loadFinancialPlanArtifact(supabase, artifactId);
    if (!fp) return noStore({ ok: false, error: "Financial plan artifact not found" }, 404);

    const fyConfig = fp.fy_config ?? { fy_start_month: 4, fy_start_year: new Date().getFullYear(), num_months: 12 };

    const { line: peopleLine, isNew } = findOrCreatePeopleCostLine(fp.cost_lines ?? []);
    const newCostLines = isNew ? [...(fp.cost_lines ?? []), peopleLine] : fp.cost_lines;

    const forecast = computeResourcePlanForecast(
      allocations as any,
      peopleLine.id,
      fyConfig,
      fp.monthly_data ?? {},
      new Set(overriddenMonths)
    );

    const totalForecast = Object.values(forecast.monthly_totals).reduce((s, t) => s + t.cost, 0);

    const updatedCostLines = newCostLines.map((l: any) =>
      l.id === peopleLine.id
        ? { ...l, forecast: totalForecast, budgeted: l.override ? l.budgeted : (l.budgeted === "" ? totalForecast : l.budgeted) }
        : l
    );

    const updatedContent: FinancialPlanContent = {
      ...fp,
      cost_lines:   updatedCostLines,
      monthly_data: forecast.monthly_data_patch,
      last_updated_at: new Date().toISOString(),
      resource_plan_synced_at: new Date().toISOString(),
      resource_plan_overridden_months: JSON.stringify(overriddenMonths),
    };

    const { error: writeErr } = await supabase
      .from("artifacts")
      .update({ content_json: updatedContent, updated_at: new Date().toISOString() })
      .eq("id", artifactId);

    if (writeErr) throw new Error(writeErr.message);

    const missingRates = allocations.filter(a => a.day_rate == null);

    return noStore({
      ok: true,
      isAdmin,
      source,
      months_updated:    Object.keys(forecast.monthly_totals).filter(mk => forecast.monthly_totals[mk].cost > 0).length,
      total_forecast:    totalForecast,
      missing_rates:     missingRates.length,
      overridden_months: overriddenMonths,
      summary:           formatMonthlySummary(forecast.monthly_totals, fp.currency ?? "GBP"),
    });
  } catch (e: any) {
    return noStore({ ok: false, error: e.message ?? "Server error" }, e.message === "Unauthorized" ? 401 : 500);
  }
}