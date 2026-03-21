import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  mapRoleRequirementsToAllocations,
  computeResourcePlanForecast,
  findOrCreatePeopleCostLine,
  formatMonthlySummary,
  type ResourceAllocation,
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

  if (!mem) throw new Error("Forbidden");

  const isAdmin = ["admin", "owner", "resource_manager"].includes(safeStr(mem.role).toLowerCase());
  return { organisation_id: proj.organisation_id, isAdmin };
}

async function loadRoleRequirements(supabase: any, projectId: string) {
  const { data, error } = await supabase
    .from("role_requirements")
    .select("id, role_title, seniority_level, required_days_per_week, start_date, end_date, filled_by_person_id, notes")
    .eq("project_id", projectId)
    .order("start_date", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as any[];
}

async function loadRateCardForRoles(
  supabase: any,
  orgId: string,
  roleRows: any[]
): Promise<Map<string, { day_rate: number; rate_source: "personal" | "role" }>> {
  const result = new Map<string, { day_rate: number; rate_source: "personal" | "role" }>();
  if (!roleRows.length) return result;

  const { data: rates } = await supabase
    .from("v_resource_rates_latest")
    .select("role_title, seniority_level, day_rate, rate_type, resource_type")
    .eq("organisation_id", orgId)
    .eq("rate_type", "day_rate");

  const ratesByRole = new Map<string, number>();
  for (const r of (rates ?? []) as any[]) {
    const key = safeStr(r.role_title).trim().toLowerCase();
    if (!ratesByRole.has(key)) ratesByRole.set(key, Number(r.day_rate));
  }

  const filledPersonIds = roleRows
    .map((r: any) => safeStr(r.filled_by_person_id).trim())
    .filter(Boolean);

  const personalRates = new Map<string, number>();
  if (filledPersonIds.length) {
    const { data: personal } = await supabase
      .from("v_resource_rates_latest")
      .select("user_id, day_rate, rate_type")
      .eq("organisation_id", orgId)
      .eq("rate_type", "day_rate")
      .in("user_id", filledPersonIds);

    for (const r of (personal ?? []) as any[]) {
      if (r.user_id) personalRates.set(r.user_id, Number(r.day_rate));
    }
  }

  for (const row of roleRows) {
    const personId  = safeStr(row.filled_by_person_id).trim();
    const roleKey   = safeStr(row.role_title).trim().toLowerCase();

    if (personId && personalRates.has(personId)) {
      result.set(row.id, { day_rate: personalRates.get(personId)!, rate_source: "personal" });
    } else if (ratesByRole.has(roleKey)) {
      result.set(row.id, { day_rate: ratesByRole.get(roleKey)!, rate_source: "role" });
    }
  }

  return result;
}

async function loadPersonNames(supabase: any, personIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!personIds.length) return map;

  const { data } = await supabase
    .from("profiles")
    .select("user_id, full_name, email")
    .in("user_id", personIds);

  for (const p of (data ?? []) as any[]) {
    const name = safeStr(p.full_name).trim() || safeStr(p.email).trim();
    if (p.user_id && name) map.set(p.user_id, name);
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

export async function GET(req: Request) {
  try {
    const supabase  = await createClient();
    const user      = await requireAuth(supabase);
    const url       = new URL(req.url);
    const projectId = safeStr(url.searchParams.get("projectId")).trim();
    const artifactId = safeStr(url.searchParams.get("artifactId")).trim();

    if (!projectId) return noStore({ ok: false, error: "Missing projectId" }, 400);

    const { organisation_id, isAdmin } = await requireProjectAccess(supabase, projectId, user.id);

    const roleRows   = await loadRoleRequirements(supabase, projectId);
    const rateMap    = await loadRateCardForRoles(supabase, organisation_id, roleRows);
    const personIds  = roleRows.map((r: any) => r.filled_by_person_id).filter(Boolean);
    const personNames = await loadPersonNames(supabase, personIds);

    const allocations = mapRoleRequirementsToAllocations(roleRows, rateMap, personNames);

    let fyConfig: FYConfig = { fy_start_month: 4, fy_start_year: new Date().getFullYear(), num_months: 12 };
    let existingMonthlyData: MonthlyData = {};
    let peopleCostLineId: string | null = null;
    let overriddenMonths: string[] = [];

    if (artifactId) {
      const fp = await loadFinancialPlanArtifact(supabase, artifactId);
      if (fp) {
        fyConfig = fp.fy_config ?? fyConfig;
        existingMonthlyData = fp.monthly_data ?? {};
        const { line } = findOrCreatePeopleCostLine(fp.cost_lines ?? []);
        peopleCostLineId = line.id;
        overriddenMonths = safeStr((fp as any)?.resource_plan_overridden_months ?? "")
          ? JSON.parse((fp as any).resource_plan_overridden_months)
          : [];
      }
    }

    if (!peopleCostLineId) {
      peopleCostLineId = "people-line-preview";
    }

    const forecast = computeResourcePlanForecast(
      allocations,
      peopleCostLineId,
      fyConfig,
      existingMonthlyData,
      new Set(overriddenMonths)
    );

    return noStore({
      ok: true,
      isAdmin,
      allocations,
      forecast: {
        monthly_totals:  forecast.monthly_totals,
        missing_rates:   forecast.missing_rates,
        summary:         formatMonthlySummary(forecast.monthly_totals, "GBP"),
        months_affected: Object.keys(forecast.monthly_totals).filter(mk => forecast.monthly_totals[mk].cost > 0).length,
      },
      role_count: roleRows.length,
      rate_coverage: `${allocations.filter(a => a.day_rate != null).length}/${allocations.length}`,
      overridden_months: overriddenMonths,
    });
  } catch (e: any) {
    return noStore({ ok: false, error: e.message ?? "Server error" }, e.message === "Unauthorized" ? 401 : 500);
  }
}

export async function POST(req: Request) {
  try {
    const supabase   = await createClient();
    const user       = await requireAuth(supabase);
    const url        = new URL(req.url);
    const projectId  = safeStr(url.searchParams.get("projectId")).trim();
    const artifactId = safeStr(url.searchParams.get("artifactId")).trim();

    if (!projectId || !artifactId) return noStore({ ok: false, error: "Missing projectId or artifactId" }, 400);

    const { organisation_id, isAdmin } = await requireProjectAccess(supabase, projectId, user.id);

    const body = await req.json().catch(() => ({}));
    const overriddenMonths: string[] = Array.isArray(body?.overridden_months) ? body.overridden_months : [];

    const roleRows   = await loadRoleRequirements(supabase, projectId);
    const rateMap    = await loadRateCardForRoles(supabase, organisation_id, roleRows);
    const personIds  = roleRows.map((r: any) => r.filled_by_person_id).filter(Boolean);
    const personNames = await loadPersonNames(supabase, personIds);
    const allocations = mapRoleRequirementsToAllocations(roleRows, rateMap, personNames);

    const fp = await loadFinancialPlanArtifact(supabase, artifactId);
    if (!fp) return noStore({ ok: false, error: "Financial plan artifact not found" }, 404);

    const fyConfig = fp.fy_config ?? { fy_start_month: 4, fy_start_year: new Date().getFullYear(), num_months: 12 };

    const { line: peopleLine, isNew } = findOrCreatePeopleCostLine(fp.cost_lines ?? []);
    const newCostLines = isNew ? [...(fp.cost_lines ?? []), peopleLine] : fp.cost_lines;

    const forecast = computeResourcePlanForecast(
      allocations,
      peopleLine.id,
      fyConfig,
      fp.monthly_data ?? {},
      new Set(overriddenMonths)
    );

    const totalForecast = Object.values(forecast.monthly_totals).reduce((s, t) => s + t.cost, 0);
    const updatedCostLines = newCostLines.map(l =>
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
      resource_plan_overridden_months: JSON.stringify(overriddenMonths)
    } as any;

    const { error: writeErr } = await supabase
      .from("artifacts")
      .update({ content_json: updatedContent, updated_at: new Date().toISOString() })
      .eq("id", artifactId);

    if (writeErr) throw new Error(writeErr.message);

    return noStore({
      ok: true,
      isAdmin,
      months_updated:  Object.keys(forecast.monthly_totals).filter(mk => forecast.monthly_totals[mk].cost > 0).length,
      total_forecast:  totalForecast,
      missing_rates:   forecast.missing_rates.length,
      overridden_months: overriddenMonths,
      summary:         formatMonthlySummary(forecast.monthly_totals, fp.currency ?? "GBP"),
    });
  } catch (e: any) {
    return noStore({ ok: false, error: e.message ?? "Server error" }, e.message === "Unauthorized" ? 401 : 500);
  }
}
